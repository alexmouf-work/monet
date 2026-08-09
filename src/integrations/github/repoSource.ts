/**
 * GitHub repository source — docs/08 §5–7. Connect creates the working branch, every save is
 * one commit + push, and Sync fast-forwards a target branch (falling back to a merge commit).
 */
import type { SourceProvider, TextureNode } from '../sources';
import { emit, registerSource } from '../sources';
import { projectMirrorPath } from '../sourceSave';
import { idbGet, idbSet } from '../idb';
import {
  GhError,
  b64ToBytes,
  compare,
  createBlob,
  createCommit,
  createRef,
  createTree,
  getBlob,
  getCommit,
  getRef,
  getRepo,
  getTree,
  listBranches,
  mergeBranches,
  updateRef,
} from './api';

export const DEFAULT_WORK_BRANCH = 'monet';

export interface RepoConfig {
  id: string;
  owner: string;
  repo: string;
  baseBranch: string;
  workBranch: string;
}

const STORE_KEY = 'sources:repos';

export const loadRepoConfigs = async (): Promise<RepoConfig[]> =>
  ((await idbGet(STORE_KEY)) as RepoConfig[] | undefined) ?? [];

async function saveRepoConfigs(list: RepoConfig[]): Promise<void> {
  await idbSet(STORE_KEY, list);
}

export async function rememberRepo(cfg: RepoConfig): Promise<void> {
  const list = (await loadRepoConfigs()).filter((c) => c.id !== cfg.id);
  await saveRepoConfigs([...list, cfg]);
}

export async function forgetRepo(id: string): Promise<void> {
  await saveRepoConfigs((await loadRepoConfigs()).filter((c) => c.id !== id));
}

interface Head {
  commitSha: string;
  treeSha: string;
  entries: Map<string, { sha: string; size?: number }>;
  truncated: boolean;
}

class RepoSource implements SourceProvider {
  kind = 'repo' as const;
  writable = true;
  private head: Head | null = null;
  private lastPush = '';

  constructor(readonly cfg: RepoConfig) {}

  get id() {
    return this.cfg.id;
  }

  get label() {
    return `${this.cfg.owner}/${this.cfg.repo}`;
  }

  status(): string {
    return `${this.cfg.workBranch} ← ${this.cfg.baseBranch}${this.lastPush ? ` · ${this.lastPush}` : ''}`;
  }

  /** Fetch the working branch head and its full tree — docs/08 §6.1. */
  private async loadHead(force = false): Promise<Head> {
    if (this.head && !force) return this.head;
    const { owner, repo, workBranch } = this.cfg;
    const ref = await getRef(owner, repo, workBranch);
    const commit = await getCommit(owner, repo, ref.object.sha);
    const tree = await getTree(owner, repo, commit.tree.sha, true);
    const entries = new Map<string, { sha: string; size?: number }>();
    for (const e of tree.tree) {
      if (e.type === 'blob') entries.set(e.path, { sha: e.sha, size: e.size });
    }
    this.head = {
      commitSha: ref.object.sha,
      treeSha: commit.tree.sha,
      entries,
      truncated: tree.truncated,
    };
    return this.head;
  }

  async refresh(): Promise<void> {
    await this.loadHead(true);
    emit();
  }

  async list(): Promise<TextureNode[]> {
    const head = await this.loadHead();
    const projects = new Set(
      [...head.entries.keys()].filter((p) => p.startsWith('.monet/') && p.endsWith('.monet')),
    );
    return [...head.entries.entries()]
      .filter(([path]) => /\.png$/i.test(path) && !path.startsWith('.monet/'))
      .map(([path, meta]) => ({
        path,
        ref: meta.sha,
        size: meta.size,
        hasProject: projects.has(projectMirrorPath(path)),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(node: TextureNode): Promise<{ png: Uint8Array; project?: Uint8Array }> {
    const { owner, repo } = this.cfg;
    const head = await this.loadHead();
    const pngSha = (node.ref as string) ?? head.entries.get(node.path)?.sha;
    if (!pngSha) throw new Error(`${node.path} is not in the ${this.cfg.workBranch} branch.`);
    const png = b64ToBytes((await getBlob(owner, repo, pngSha)).content);

    const mirror = head.entries.get(projectMirrorPath(node.path));
    const project = mirror
      ? b64ToBytes((await getBlob(owner, repo, mirror.sha)).content)
      : undefined;
    return { png, project };
  }

  /**
   * One commit containing the PNG and its project mirror, then a fast-forward of the working
   * branch. A 422 on the ref update means someone else moved it, so re-read and retry: the
   * blobs are content-addressed, so re-parenting is free.
   */
  async write(path: string, png: Uint8Array, project: Uint8Array): Promise<void> {
    const { owner, repo, workBranch } = this.cfg;
    const mirror = projectMirrorPath(path);

    const [pngBlob, projectBlob] = await Promise.all([
      createBlob(owner, repo, png),
      createBlob(owner, repo, project),
    ]);

    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await this.loadHead(attempt > 0);
      const existed = head.entries.has(path);
      const commitInfo = await getCommit(owner, repo, head.commitSha);
      const tree = await createTree(owner, repo, commitInfo.tree.sha, [
        { path, sha: pngBlob.sha },
        { path: mirror, sha: projectBlob.sha },
      ]);
      const message = `monet: ${existed ? 'update' : 'add'} ${path}\n\n+ ${mirror}`;
      const commit = await createCommit(owner, repo, message, tree.sha, [head.commitSha]);
      try {
        await updateRef(owner, repo, workBranch, commit.sha);
        this.lastPush = `pushed @${commit.sha.slice(0, 7)}`;
        await this.loadHead(true);
        emit();
        return;
      } catch (err) {
        if (err instanceof GhError && err.status === 422 && attempt < 2) continue;
        throw err;
      }
    }
  }

  /** Sync: fast-forward `target` to the working branch, or merge when it has diverged. */
  async sync(target: string): Promise<{ mode: 'fast-forward' | 'merge'; sha: string }> {
    const { owner, repo, workBranch } = this.cfg;
    const head = await this.loadHead(true);
    try {
      await updateRef(owner, repo, target, head.commitSha);
      return { mode: 'fast-forward', sha: head.commitSha };
    } catch (err) {
      if (!(err instanceof GhError) || err.status !== 422) throw err;
      // Diverged: merge the working branch into the target, then fast-forward the working
      // branch onto the merge commit so both end at the same state (docs/08 §7).
      const merge = await mergeBranches(
        owner,
        repo,
        target,
        workBranch,
        `Merge ${workBranch} into ${target}`,
      );
      await updateRef(owner, repo, workBranch, merge.sha);
      await this.loadHead(true);
      return { mode: 'merge', sha: merge.sha };
    }
  }

  async branches(): Promise<string[]> {
    return (await listBranches(this.cfg.owner, this.cfg.repo)).map((b) => b.name);
  }

  async aheadBehind(target: string): Promise<{ ahead: number; behind: number }> {
    const c = await compare(this.cfg.owner, this.cfg.repo, target, this.cfg.workBranch);
    return { ahead: c.ahead_by, behind: c.behind_by };
  }

  /** Prefixes that look like an assets root, for the Save-As path suggester (docs/08 §6.3). */
  async assetsRoots(): Promise<string[]> {
    const head = await this.loadHead();
    const roots = new Set<string>();
    for (const path of head.entries.keys()) {
      // Skip our own project mirrors, or `.monet/…/assets/` would look like an assets root.
      if (path.startsWith('.monet/')) continue;
      const i = path.indexOf('assets/');
      if (i > 0) roots.add(path.slice(0, i));
      else if (i === 0) roots.add('');
    }
    return [...roots].sort();
  }

  treeTruncated(): boolean {
    return this.head?.truncated ?? false;
  }
}

export type { RepoSource };

/** Connect a repository: verify push access, then create (or reuse) the working branch. */
export async function connectRepo(opts: {
  owner: string;
  repo: string;
  baseBranch?: string;
  workBranch?: string;
}): Promise<RepoSource> {
  const info = await getRepo(opts.owner, opts.repo);
  if (!info.permissions?.push) {
    throw new Error(`The token cannot push to ${opts.owner}/${opts.repo}.`);
  }
  const baseBranch = opts.baseBranch || info.default_branch;
  const workBranch = opts.workBranch || DEFAULT_WORK_BRANCH;

  let baseSha: string;
  try {
    baseSha = (await getRef(opts.owner, opts.repo, baseBranch)).object.sha;
  } catch (err) {
    if (err instanceof GhError && err.status === 404) {
      throw new Error(
        `${opts.owner}/${opts.repo} has no commits on ${baseBranch} — create an initial commit on GitHub first.`,
      );
    }
    throw err;
  }

  if (workBranch !== baseBranch) {
    try {
      await createRef(opts.owner, opts.repo, workBranch, baseSha);
    } catch (err) {
      // 422 "Reference already exists" is fine: reuse the branch as it stands.
      if (!(err instanceof GhError) || err.status !== 422) throw err;
    }
  }

  const cfg: RepoConfig = {
    id: `repo:${opts.owner}/${opts.repo}`,
    owner: opts.owner,
    repo: opts.repo,
    baseBranch,
    workBranch,
  };
  const source = new RepoSource(cfg);
  registerSource(source);
  await rememberRepo(cfg);
  return source;
}

/** Re-register stored repositories on boot (no network until the tree is browsed). */
export async function restoreRepoSources(): Promise<void> {
  for (const cfg of await loadRepoConfigs()) registerSource(new RepoSource(cfg));
}
