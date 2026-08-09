/**
 * GitHub REST wrapper — docs/08 §4. api.github.com sends CORS headers, so the browser can do
 * all of this with a user PAT: no server, no git binary. The token is only ever sent here.
 */
import { readToken } from '../../app/settingsStore';

const API = 'https://api.github.com';

export class GhError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
  }
}

/** Human-readable mapping of the statuses this integration actually hits (docs/08 §4). */
export function describeGhError(err: unknown): string {
  if (!(err instanceof GhError)) return (err as Error)?.message || 'Unknown error';
  const apiMessage =
    typeof err.body === 'object' && err.body && 'message' in err.body
      ? String((err.body as { message: unknown }).message)
      : '';
  switch (err.status) {
    case 401:
      return 'GitHub token is invalid or expired — update it in Settings.';
    case 403:
    case 429:
      return 'GitHub rate limit reached — try again in a minute.';
    case 404:
      return 'Not found: the repository may not exist, or the token lacks access to it.';
    case 409:
      return apiMessage || 'Conflict — the branches have diverged.';
    case 422:
      return apiMessage || 'GitHub rejected the request (422).';
    default:
      return `GitHub error ${err.status}${apiMessage ? `: ${apiMessage}` : ''}`;
  }
}

export async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = readToken();
  if (!token) throw new GhError(401, {}, 'No GitHub token set.');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({}));
    throw new GhError(res.status, parsed, `GitHub ${method} ${path} → ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- base64 helpers

/** Bytes → base64 without blowing the stack on large blobs. */
export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/** base64 → bytes. GitHub returns blob content with embedded newlines, so strip whitespace. */
export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- typed endpoints

export interface GhRepo {
  full_name: string;
  default_branch: string;
  permissions?: { push?: boolean; admin?: boolean };
}

export interface GhRef {
  ref: string;
  object: { sha: string };
}

export interface GhCommit {
  sha: string;
  tree: { sha: string };
}

export interface GhTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

export interface GhTree {
  sha: string;
  tree: GhTreeEntry[];
  truncated: boolean;
}

export interface GhBranch {
  name: string;
  commit: { sha: string };
}

export interface GhCompare {
  ahead_by: number;
  behind_by: number;
  status: 'diverged' | 'ahead' | 'behind' | 'identical';
}

const repoPath = (owner: string, repo: string) => `/repos/${owner}/${repo}`;

export const getRepo = (owner: string, repo: string) => gh<GhRepo>('GET', repoPath(owner, repo));

export const getRef = (owner: string, repo: string, branch: string) =>
  gh<GhRef>('GET', `${repoPath(owner, repo)}/git/ref/heads/${encodeURIComponent(branch)}`);

export const createRef = (owner: string, repo: string, branch: string, sha: string) =>
  gh<GhRef>('POST', `${repoPath(owner, repo)}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha,
  });

/** No `force`, so the server accepts it only as a fast-forward — docs/08 §7. */
export const updateRef = (
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  force = false,
) =>
  gh<GhRef>('PATCH', `${repoPath(owner, repo)}/git/refs/heads/${encodeURIComponent(branch)}`, {
    sha,
    ...(force ? { force: true } : {}),
  });

export const getCommit = (owner: string, repo: string, sha: string) =>
  gh<GhCommit>('GET', `${repoPath(owner, repo)}/git/commits/${sha}`);

export const getTree = (owner: string, repo: string, sha: string, recursive = true) =>
  gh<GhTree>('GET', `${repoPath(owner, repo)}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`);

export const createBlob = (owner: string, repo: string, bytes: Uint8Array) =>
  gh<{ sha: string }>('POST', `${repoPath(owner, repo)}/git/blobs`, {
    content: bytesToB64(bytes),
    encoding: 'base64',
  });

export const getBlob = (owner: string, repo: string, sha: string) =>
  gh<{ content: string; encoding: string }>('GET', `${repoPath(owner, repo)}/git/blobs/${sha}`);

export const createTree = (
  owner: string,
  repo: string,
  baseTree: string,
  entries: { path: string; sha: string }[],
) =>
  gh<{ sha: string }>('POST', `${repoPath(owner, repo)}/git/trees`, {
    base_tree: baseTree,
    tree: entries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })),
  });

export const createCommit = (
  owner: string,
  repo: string,
  message: string,
  tree: string,
  parents: string[],
) =>
  gh<{ sha: string }>('POST', `${repoPath(owner, repo)}/git/commits`, {
    message,
    tree,
    parents,
  });

export const listBranches = (owner: string, repo: string) =>
  gh<GhBranch[]>('GET', `${repoPath(owner, repo)}/branches?per_page=100`);

export const compare = (owner: string, repo: string, base: string, head: string) =>
  gh<GhCompare>(
    'GET',
    `${repoPath(owner, repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  );

export const mergeBranches = (
  owner: string,
  repo: string,
  base: string,
  head: string,
  message: string,
) =>
  gh<{ sha: string }>('POST', `${repoPath(owner, repo)}/merges`, {
    base,
    head,
    commit_message: message,
  });

/** Accepts a URL or `owner/repo`. */
export function parseRepoRef(input: string): { owner: string; repo: string } | null {
  const text = input.trim().replace(/\.git$/, '');
  const url = text.match(/github\.com[/:]([^/]+)\/([^/?#]+)/i);
  if (url) return { owner: url[1], repo: url[2] };
  const short = text.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { owner: short[1], repo: short[2] };
  return null;
}
