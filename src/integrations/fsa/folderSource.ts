/**
 * Local folder source — docs/08 §3. Chromium only (File System Access). Handles persist in
 * IndexedDB; the permission grant does not, so a reconnect step re-requests it.
 */
import type { SourceProvider, TextureNode } from '../sources';
import { emit, registerSource } from '../sources';
import { projectMirrorPath } from '../sourceSave';
import { idbDel, idbGet, idbKeys, idbSet } from '../idb';
import { hasFsaDirectory } from './localFile';

const HANDLE_PREFIX = 'folder:';
const SKIP = new Set(['.git', 'node_modules', '.monet', 'build', 'dist', '.gradle']);
const MAX_DEPTH = 12;
const MAX_FILES = 20_000;

interface DirHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
  queryPermission?(d: { mode: string }): Promise<PermissionState>;
  requestPermission?(d: { mode: string }): Promise<PermissionState>;
}

class FolderSource implements SourceProvider {
  kind = 'folder' as const;
  writable = true;
  private nodes: TextureNode[] | null = null;
  private granted = true;

  constructor(
    readonly id: string,
    readonly label: string,
    private root: DirHandle,
  ) {}

  status(): string {
    return this.granted ? 'local folder' : 'needs reconnecting';
  }

  needsReconnect(): boolean {
    return !this.granted;
  }

  async ensurePermission(): Promise<boolean> {
    const q = await this.root.queryPermission?.({ mode: 'readwrite' });
    if (q === 'granted') {
      this.granted = true;
      return true;
    }
    const r = await this.root.requestPermission?.({ mode: 'readwrite' });
    this.granted = r === 'granted';
    emit();
    return this.granted;
  }

  async list(): Promise<TextureNode[]> {
    if (this.nodes) return this.nodes;
    if (!(await this.ensurePermission())) return [];
    const found: TextureNode[] = [];
    const projects = new Set<string>();

    const walk = async (dir: DirHandle, prefix: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
      for await (const entry of dir.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          if (SKIP.has(entry.name)) {
            if (entry.name === '.monet') await collectProjects(entry as DirHandle, '.monet');
            continue;
          }
          await walk(entry as DirHandle, path, depth + 1);
        } else if (/\.png$/i.test(entry.name)) {
          found.push({ path });
        }
      }
    };

    const collectProjects = async (dir: DirHandle, prefix: string): Promise<void> => {
      for await (const entry of dir.values()) {
        const path = `${prefix}/${entry.name}`;
        if (entry.kind === 'directory') await collectProjects(entry as DirHandle, path);
        else if (/\.monet$/i.test(entry.name)) projects.add(path);
      }
    };

    await walk(this.root, '', 0);
    this.nodes = found
      .map((n) => ({ ...n, hasProject: projects.has(projectMirrorPath(n.path)) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return this.nodes;
  }

  async refresh(): Promise<void> {
    this.nodes = null;
    await this.list();
    emit();
  }

  private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const parts = path.split('/');
    const name = parts.pop()!;
    let dir = this.root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir.getFileHandle(name, { create });
  }

  async read(node: TextureNode): Promise<{ png: Uint8Array; project?: Uint8Array }> {
    const png = new Uint8Array(
      await (await (await this.fileHandle(node.path, false)).getFile()).arrayBuffer(),
    );
    let project: Uint8Array | undefined;
    if (node.hasProject) {
      try {
        const handle = await this.fileHandle(projectMirrorPath(node.path), false);
        project = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch {
        /* mirror vanished since the listing — open the flat PNG instead */
      }
    }
    return { png, project };
  }

  async write(path: string, png: Uint8Array, project: Uint8Array): Promise<void> {
    if (!(await this.ensurePermission())) throw new Error('Write permission was declined.');
    await this.writeFile(path, png);
    await this.writeFile(projectMirrorPath(path), project);
    this.nodes = null;
    emit();
  }

  private async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const handle = await this.fileHandle(path, true);
    const w = await (
      handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }
    ).createWritable();
    await w.write(bytes as unknown as BufferSource);
    await w.close();
  }
}

export type { FolderSource };

export const folderSourcesSupported = hasFsaDirectory;

export async function addFolderSource(): Promise<FolderSource | null> {
  const picker = (
    window as unknown as { showDirectoryPicker?(o: { mode: string }): Promise<DirHandle> }
  ).showDirectoryPicker;
  if (!picker) return null;
  let root: DirHandle;
  try {
    root = await picker({ mode: 'readwrite' });
  } catch {
    return null; // cancelled
  }
  const id = `folder:${root.name}`;
  await idbSet(HANDLE_PREFIX + id, root);
  const source = new FolderSource(id, root.name, root);
  registerSource(source);
  return source;
}

export async function removeFolderSource(id: string): Promise<void> {
  await idbDel(HANDLE_PREFIX + id);
  emit();
}

/** IndexedDB stores handles natively, so folders come back after a reload. */
export async function restoreFolderSources(): Promise<void> {
  const keys = (await idbKeys()).filter(
    (k): k is string => typeof k === 'string' && k.startsWith(HANDLE_PREFIX),
  );
  for (const key of keys) {
    const handle = (await idbGet(key)) as DirHandle | undefined;
    if (!handle) continue;
    const id = key.slice(HANDLE_PREFIX.length);
    registerSource(new FolderSource(id, handle.name, handle));
  }
}
