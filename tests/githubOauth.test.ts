import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  callbackParams,
  canRefresh,
  GITHUB_AUTHORIZE_URL,
  installUrl,
  isStale,
  isUsable,
  parseStoredSession,
  randomState,
  REFRESH_SKEW_MS,
  sessionFromPayload,
  type GhSession,
} from '../src/integrations/github/oauth';

const NOW = 1_700_000_000_000;

describe('authorize url', () => {
  it('carries client id, redirect and state, and no scope', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'Iv1.abc',
        redirectUri: 'https://monet.mouftools.com/',
        state: 'xyz',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(GITHUB_AUTHORIZE_URL);
    expect(url.searchParams.get('client_id')).toBe('Iv1.abc');
    expect(url.searchParams.get('redirect_uri')).toBe('https://monet.mouftools.com/');
    expect(url.searchParams.get('state')).toBe('xyz');
    // A GitHub App's permissions come from the App, so a scope here would be a mistake.
    expect(url.searchParams.get('scope')).toBeNull();
  });

  it('escapes a redirect that carries a port and path', () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: 'c', redirectUri: 'http://localhost:5173/', state: 's' }),
    );
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/');
  });
});

describe('state', () => {
  it('is long, hex, and different every time', () => {
    const a = randomState();
    const b = randomState();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });
});

describe('callback params', () => {
  it('reads code and state', () => {
    expect(callbackParams('?code=abc&state=st')).toEqual({ code: 'abc', state: 'st' });
  });

  it('is null without a code', () => {
    expect(callbackParams('')).toBeNull();
    expect(callbackParams('?state=only')).toBeNull();
    expect(callbackParams('?error=access_denied')).toBeNull();
  });

  it('reports a missing state so the caller can reject the code', () => {
    expect(callbackParams('?code=abc')).toEqual({ code: 'abc', state: null });
  });
});

describe('session from payload', () => {
  it('turns lifetimes into absolute deadlines', () => {
    const s = sessionFromPayload(
      {
        access_token: 'ghu_x',
        expires_in: 28_800,
        refresh_token: 'ghr_y',
        refresh_token_expires_in: 15_897_600,
      },
      NOW,
    );
    expect(s).toEqual({
      accessToken: 'ghu_x',
      expiresAt: NOW + 28_800_000,
      refreshToken: 'ghr_y',
      refreshExpiresAt: NOW + 15_897_600_000,
    });
  });

  it('treats a missing expires_in as a non-expiring token', () => {
    const s = sessionFromPayload({ access_token: 'ghu_x' }, NOW);
    expect(s.expiresAt).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(isStale(s, NOW + 1e12)).toBe(false);
  });
});

describe('staleness and refresh', () => {
  const fresh: GhSession = {
    accessToken: 'a',
    expiresAt: NOW + 3_600_000,
    refreshToken: 'r',
    refreshExpiresAt: NOW + 1e10,
  };

  it('is not stale well before expiry', () => {
    expect(isStale(fresh, NOW)).toBe(false);
  });

  it('goes stale within the skew window, before the token actually dies', () => {
    const justInside = fresh.expiresAt! - REFRESH_SKEW_MS + 1000;
    expect(isStale(fresh, justInside)).toBe(true);
    // …and the token is genuinely still valid at that moment.
    expect(isStale(fresh, justInside, 0)).toBe(false);
  });

  it('can refresh while the refresh token lives, and not after', () => {
    expect(canRefresh(fresh, NOW)).toBe(true);
    expect(canRefresh(fresh, fresh.refreshExpiresAt! + 1)).toBe(false);
    expect(canRefresh({ ...fresh, refreshToken: null }, NOW)).toBe(false);
  });

  it('keeps an expired session that can still be refreshed, and drops one that cannot', () => {
    const expired = { ...fresh, expiresAt: NOW - 1 };
    expect(isUsable(expired, NOW)).toBe(true);
    expect(isUsable({ ...expired, refreshToken: null }, NOW)).toBe(false);
  });
});

describe('stored session parsing', () => {
  it('round-trips a real session', () => {
    const s = sessionFromPayload({ access_token: 'ghu_x', expires_in: 100 }, NOW);
    expect(parseStoredSession(JSON.stringify(s))).toEqual(s);
  });

  it('keeps the cached identity', () => {
    const stored = JSON.stringify({ accessToken: 'a', login: 'octocat', avatarUrl: 'u' });
    expect(parseStoredSession(stored)).toMatchObject({ login: 'octocat', avatarUrl: 'u' });
  });

  it('rejects junk rather than trusting persisted input', () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession('not json')).toBeNull();
    expect(parseStoredSession('{}')).toBeNull();
    expect(parseStoredSession('{"accessToken":""}')).toBeNull();
    expect(parseStoredSession('{"accessToken":123}')).toBeNull();
    expect(parseStoredSession('[]')).toBeNull();
    // Wrong types are dropped to their safe defaults, not carried through.
    expect(parseStoredSession('{"accessToken":"a","expiresAt":"soon"}')).toEqual({
      accessToken: 'a',
      expiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
      login: undefined,
      avatarUrl: undefined,
    });
  });
});

describe('install url', () => {
  it('points at the app installation page', () => {
    expect(installUrl('monet-textures')).toBe(
      'https://github.com/apps/monet-textures/installations/new',
    );
  });
});
