/**
 * GitHub App user-token exchange — the one server-side piece Monet needs (docs/08 §4.1).
 *
 * Why it exists: `https://github.com/login/oauth/access_token` requires the App's **client
 * secret**, which cannot ship in a browser bundle, and it sends no CORS headers, so the browser
 * cannot call it even for a public client (GitHub supports neither PKCE nor a browser-safe
 * flow). This endpoint holds the secret and does nothing else — it is stateless, stores nothing,
 * and returns only the token fields the client needs.
 *
 * Deliberately self-contained: everything that touches the secret is in this file.
 *
 * Env (Vercel project settings): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
 */
export const config = { runtime: 'edge' };

// The Edge runtime is not the DOM and not Node; declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** Origins allowed to use this endpoint, so it cannot be borrowed as a public exchange proxy. */
const ALLOWED_ORIGINS = [
  'https://monet.mouftools.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
];

function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  const self = process.env.VERCEL_URL;
  if (self && origin === `https://${self}`) return true;
  // Preview deployments of this project.
  try {
    return new URL(origin).hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(originAllowed(origin)
      ? {
          'Access-Control-Allow-Origin': origin as string,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        }
      : {}),
  };
}

const fail = (status: number, error: string, origin: string | null) =>
  new Response(JSON.stringify({ error }), { status, headers: corsHeaders(origin) });

/**
 * GitHub answers a *failed* exchange with HTTP 200 and an `error` field, so status alone is not
 * a success test. It also answers form-encoded unless asked for JSON — parse both, because a
 * silently form-encoded body would otherwise look like a missing token.
 */
async function readGitHubBody(res: Response): Promise<Record<string, string>> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', origin);
  if (!originAllowed(origin)) return fail(403, 'origin_not_allowed', origin);

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(503, 'app_not_configured', origin);

  let payload: { code?: string; refresh_token?: string; redirect_uri?: string };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return fail(400, 'invalid_json', origin);
  }

  // A redirect_uri is only echoed back to GitHub for validation, but pin it to the allowlist
  // anyway rather than forwarding whatever the caller sent.
  const redirectUri =
    payload.redirect_uri && originAllowed(new URL(payload.redirect_uri).origin)
      ? payload.redirect_uri
      : undefined;

  const body: Record<string, string> = { client_id: clientId, client_secret: clientSecret };
  if (payload.code) {
    body.code = payload.code;
    if (redirectUri) body.redirect_uri = redirectUri;
  } else if (payload.refresh_token) {
    body.grant_type = 'refresh_token';
    body.refresh_token = payload.refresh_token;
  } else {
    return fail(400, 'code_or_refresh_token_required', origin);
  }

  let ghRes: Response;
  try {
    ghRes = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return fail(502, 'github_unreachable', origin);
  }

  const data = await readGitHubBody(ghRes);
  if (data.error || !data.access_token) {
    // Pass GitHub's own reason through; it is the difference between "expired code, try again"
    // and "the App is misconfigured". Never echo the request back — it carried the secret.
    return new Response(
      JSON.stringify({
        error: data.error || 'no_access_token',
        error_description: data.error_description,
      }),
      { status: ghRes.ok ? 400 : ghRes.status, headers: corsHeaders(origin) },
    );
  }

  return new Response(
    JSON.stringify({
      access_token: data.access_token,
      token_type: data.token_type ?? 'bearer',
      expires_in: data.expires_in ? Number(data.expires_in) : undefined,
      refresh_token: data.refresh_token,
      refresh_token_expires_in: data.refresh_token_expires_in
        ? Number(data.refresh_token_expires_in)
        : undefined,
    }),
    { status: 200, headers: corsHeaders(origin) },
  );
}
