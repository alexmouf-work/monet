/**
 * GitHub App sign-in session — docs/08 §4.1. Holds the user access token, refreshes it, and
 * answers "who is signed in" / "which repositories may I touch".
 *
 * The token lands in the browser, which is unavoidable for an app with no backend of its own;
 * what the App can reach is bounded by its installation (Contents on selected repositories),
 * so the blast radius is the user's own choice of repos rather than their whole account — which
 * is the main reason to prefer this over a hand-made PAT.
 */
import { toast } from '../../app/bus';
import { readToken } from '../../app/settingsStore';
import {
  buildAuthorizeUrl,
  callbackParams,
  canRefresh,
  isStale,
  isUsable,
  parseStoredSession,
  randomState,
  sessionFromPayload,
  type GhSession,
  type TokenPayload,
} from './oauth';

const SESSION_KEY = 'monet.github.session';
const STATE_KEY = 'monet.github.oauthState';

/**
 * Build-time config, with a runtime override for self-hosting (and for the harness, which has
 * no build step): set `window.__MONET_GITHUB__` before the app boots.
 */
interface GithubAppConfig {
  clientId: string;
  appSlug: string;
  tokenEndpoint: string;
}

export function githubAppConfig(): GithubAppConfig {
  const override = (window as unknown as { __MONET_GITHUB__?: Partial<GithubAppConfig> })
    .__MONET_GITHUB__;
  return {
    clientId: override?.clientId ?? import.meta.env.VITE_GITHUB_CLIENT_ID ?? '',
    appSlug: override?.appSlug ?? import.meta.env.VITE_GITHUB_APP_SLUG ?? 'monet',
    tokenEndpoint:
      override?.tokenEndpoint ?? import.meta.env.VITE_GITHUB_TOKEN_ENDPOINT ?? '/api/github/token',
  };
}

/** False when no App is configured for this deployment — sign-in is then simply unavailable. */
export const signInAvailable = () => !!githubAppConfig().clientId;

// ------------------------------------------------------------------ session storage

let session: GhSession | null = null;
let loaded = false;
const listeners = new Set<() => void>();

export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const announce = () => {
  for (const fn of listeners) fn();
};

function store(next: GhSession | null) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked — the session just won't survive a reload */
  }
  announce();
}

/** The stored session, dropped if it can no longer authenticate even after a refresh. */
export function currentSession(): GhSession | null {
  if (!loaded) {
    loaded = true;
    try {
      session = parseStoredSession(localStorage.getItem(SESSION_KEY));
    } catch {
      session = null;
    }
    if (session && !isUsable(session, Date.now())) session = null;
  }
  return session;
}

/**
 * Merge into whatever the session is *now*. Anything that reads the session, awaits, then writes
 * it back would otherwise discard a token refreshed while it was waiting — which is exactly what
 * `refreshIdentity` did, leaving a stale token stored behind a fresh one and forcing a second
 * refresh on the next call.
 */
function patchSession(patch: Partial<GhSession>) {
  const active = currentSession();
  if (!active) return;
  store({ ...active, ...patch });
}

export const isSignedIn = () => currentSession() !== null;
export const signedInAs = () => currentSession()?.login;
export const signedInAvatar = () => currentSession()?.avatarUrl;

export function signOut(): void {
  store(null);
  toast('Signed out of GitHub.');
}

// ------------------------------------------------------------------ the flow

/** Callback target: this page, without any query or hash of its own. */
const redirectUri = () => `${location.origin}${location.pathname}`;

export function beginSignIn(): void {
  const { clientId } = githubAppConfig();
  if (!clientId) {
    toast('No GitHub App is configured for this deployment — use a token instead.', 'error');
    return;
  }
  const state = randomState();
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    toast('Sign-in needs session storage, which this browser is blocking.', 'error');
    return;
  }
  location.assign(buildAuthorizeUrl({ clientId, redirectUri: redirectUri(), state }));
}

async function exchange(body: Record<string, string>): Promise<TokenPayload> {
  const res = await fetch(githubAppConfig().tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, redirect_uri: redirectUri() }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenPayload & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(
      data.error_description ||
        data.error ||
        (res.status === 404
          ? 'The sign-in endpoint is missing from this deployment.'
          : `Sign-in failed (${res.status}).`),
    );
  }
  return data;
}

/**
 * Finish a sign-in if this load is the OAuth callback. Returns true when it handled the URL,
 * so the caller knows the query string was ours. Always strips the code from the address bar:
 * a single-use code in history is noise at best.
 */
export async function completeSignIn(): Promise<boolean> {
  const params = callbackParams(location.search);
  if (!params) return false;

  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* treated as a mismatch below */
  }
  history.replaceState(null, '', `${location.pathname}${location.hash}`);

  // No state, or the wrong one: this code did not come from a sign-in we started.
  if (!expected || expected !== params.state) {
    toast('Sign-in could not be verified — please try again.', 'error');
    return true;
  }

  try {
    const payload = await exchange({ code: params.code });
    store(sessionFromPayload(payload, Date.now()));
    await refreshIdentity();
    toast(`Signed in to GitHub as ${signedInAs() ?? 'your account'}.`, 'ok');
  } catch (err) {
    toast(`GitHub sign-in failed: ${(err as Error).message}`, 'error');
  }
  return true;
}

/** One refresh at a time: several API calls can notice the same expiry in the same tick. */
let refreshing: Promise<GhSession | null> | null = null;

async function refreshSession(): Promise<GhSession | null> {
  const active = currentSession();
  if (!active?.refreshToken) return null;
  refreshing ??= (async () => {
    try {
      const payload = await exchange({ refresh_token: active.refreshToken as string });
      const next = sessionFromPayload(payload, Date.now());
      // Identity does not come back with a refresh; carry over whatever is current by now.
      const latest = currentSession();
      store({ ...next, login: latest?.login, avatarUrl: latest?.avatarUrl });
      return next;
    } catch {
      store(null);
      toast('GitHub sign-in expired — please sign in again.', 'error');
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * The bearer token for API calls: a fresh user token when signed in, else the PAT. Async because
 * a stale token is refreshed here rather than failing the call that noticed.
 */
export async function authToken(): Promise<string> {
  const active = currentSession();
  if (!active) return readToken();
  if (!isStale(active, Date.now())) return active.accessToken;
  if (!canRefresh(active, Date.now())) {
    store(null);
    toast('GitHub sign-in expired — please sign in again.', 'error');
    return readToken();
  }
  const next = await refreshSession();
  return next?.accessToken ?? readToken();
}

/** Called when the API rejects our token outright, so the UI stops claiming we are signed in. */
export function invalidateSession(): void {
  if (currentSession()) store(null);
}

// ------------------------------------------------------------------ identity & installations

export interface GhUser {
  login: string;
  avatar_url: string;
}

export interface GhInstallation {
  id: number;
  account: { login: string; avatar_url?: string } | null;
  repository_selection: 'all' | 'selected';
}

export interface GhInstallationRepo {
  full_name: string;
  default_branch: string;
  permissions?: { push?: boolean };
}

/** Fetch with the session token directly: these endpoints are user-to-server only. */
async function api<T>(path: string): Promise<T> {
  const token = await authToken();
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Store the login and avatar on the session so the UI can name the account offline. */
export async function refreshIdentity(): Promise<void> {
  if (!currentSession()) return;
  try {
    const user = await api<GhUser>('/user');
    patchSession({ login: user.login, avatarUrl: user.avatar_url });
  } catch {
    /* leave the session unnamed rather than signing the user out over a failed lookup */
  }
}

export const listInstallations = () =>
  api<{ installations: GhInstallation[] }>('/user/installations').then((r) => r.installations);

export const listInstallationRepos = (installationId: number) =>
  api<{ repositories: GhInstallationRepo[] }>(
    `/user/installations/${installationId}/repositories?per_page=100`,
  ).then((r) => r.repositories);

/**
 * Every repository the App can reach for this user, deduplicated and sorted. Installations the
 * lookup fails on are skipped rather than sinking the whole list.
 */
export async function accessibleRepos(): Promise<GhInstallationRepo[]> {
  const installs = await listInstallations();
  const lists = await Promise.all(
    installs.map((i) => listInstallationRepos(i.id).catch(() => [] as GhInstallationRepo[])),
  );
  const byName = new Map<string, GhInstallationRepo>();
  for (const repo of lists.flat()) byName.set(repo.full_name, repo);
  return [...byName.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
}
