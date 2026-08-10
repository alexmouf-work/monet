/**
 * Pure halves of the GitHub App sign-in flow — docs/08 §4.1. No DOM, no storage, so the awkward
 * parts (state, expiry arithmetic, GitHub's several response shapes) are unit-testable.
 * The stateful side lives in `auth.ts`.
 */
export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

export interface TokenPayload {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export interface GhSession {
  accessToken: string;
  /** Epoch ms, or null when the App does not expire user tokens. */
  expiresAt: number | null;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
  login?: string;
  avatarUrl?: string;
}

/** Refresh this far before the token actually dies, so an in-flight save cannot straddle it. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  // No `scope`: a GitHub App's permissions come from the App itself, not the request.
  return `${GITHUB_AUTHORIZE_URL}?${q.toString()}`;
}

/** URL-safe random string for CSRF state. */
export function randomState(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

/** `?code=…&state=…` from a callback URL's query string, or null when this is not a callback. */
export function callbackParams(search: string): { code: string; state: string | null } | null {
  const q = new URLSearchParams(search);
  const code = q.get('code');
  if (!code) return null;
  return { code, state: q.get('state') };
}

export function sessionFromPayload(payload: TokenPayload, now: number): GhSession {
  return {
    accessToken: payload.access_token,
    expiresAt: payload.expires_in ? now + payload.expires_in * 1000 : null,
    refreshToken: payload.refresh_token ?? null,
    refreshExpiresAt: payload.refresh_token_expires_in
      ? now + payload.refresh_token_expires_in * 1000
      : null,
  };
}

/** True when the access token is gone or close enough to gone to be worth replacing. */
export function isStale(session: GhSession, now: number, skew = REFRESH_SKEW_MS): boolean {
  return session.expiresAt !== null && session.expiresAt - skew <= now;
}

export function canRefresh(session: GhSession, now: number): boolean {
  if (!session.refreshToken) return false;
  return session.refreshExpiresAt === null || session.refreshExpiresAt > now;
}

/** A session is worth keeping while it can still authenticate, now or after a refresh. */
export function isUsable(session: GhSession, now: number): boolean {
  return !isStale(session, now, 0) || canRefresh(session, now);
}

/** Reject anything that is not a session shape — persisted JSON is untrusted input. */
export function parseStoredSession(raw: string | null): GhSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GhSession>;
    if (typeof v.accessToken !== 'string' || !v.accessToken) return null;
    return {
      accessToken: v.accessToken,
      expiresAt: typeof v.expiresAt === 'number' ? v.expiresAt : null,
      refreshToken: typeof v.refreshToken === 'string' ? v.refreshToken : null,
      refreshExpiresAt: typeof v.refreshExpiresAt === 'number' ? v.refreshExpiresAt : null,
      login: typeof v.login === 'string' ? v.login : undefined,
      avatarUrl: typeof v.avatarUrl === 'string' ? v.avatarUrl : undefined,
    };
  } catch {
    return null;
  }
}

/** Where GitHub sends the user to add or change which repositories the App can reach. */
export const installUrl = (appSlug: string) =>
  `https://github.com/apps/${appSlug}/installations/new`;
