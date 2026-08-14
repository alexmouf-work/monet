/**
 * Local model bundle — docs/11 §4.5. A model JSON plus the textures it needs, held in memory
 * and registered as an ordinary source so everything downstream (parent resolution, the
 * viewport, face→texture, painting, saving) works exactly as it does for a jar.
 *
 * Two ways in, both from the owner's request:
 * - **Files**: pick the JSON, then hand over the PNGs. Anything still missing can be filled
 *   with the magenta/black placeholder so the model still opens and stays paintable.
 * - **Folder**: point at the directory holding the JSON and the textures are found relative to
 *   it, matched by asset path first and basename second.
 *
 * The bundle is writable in memory: edits land back in it, and it exports as a zip of the
 * model JSON plus every texture — the "download everything at the end" step.
 */
import JSZip from 'jszip';
import type { SourceProvider, TextureNode } from '../sources';
import { emit, registerSource, removeSource } from '../sources';
import { basename, matchPath, placeholderPixels } from '../../core/model3d/bundle';

let serial = 0;

export class ModelBundleSource implements SourceProvider {
  kind = 'folder' as const;
  writable = true;
  /** Asset path → bytes. PNGs and model JSON alike. */
  private files = new Map<string, Uint8Array>();
  /** Paths that were filled with the placeholder rather than supplied. */
  readonly placeholders = new Set<string>();
  /**
   * Write-back (owner request 2026-08-11), OFF by default: with it on, saving a texture
   * overwrites the file it came from on disk instead of only living in memory.
   */
  writeBack = false;
  /** Bundle path → the file handle it was read from. Only the FSA route provides these. */
  private handles = new Map<string, FileSystemFileHandle>();
  private root: FileSystemDirectoryHandle | null = null;

  constructor(
    readonly id: string,
    public label: string,
  ) {}

  status(): string {
    const n = this.files.size;
    const missing = this.placeholders.size;
    const back = this.writeBack ? ' · saving to folder' : '';
    return `${n} file${n === 1 ? '' : 's'}${missing ? ` · ${missing} placeholder` : ''}${back}`;
  }

  /** Remember where the files came from, so edits can go back to them. */
  attachDirectory(
    root: FileSystemDirectoryHandle,
    handles: Map<string, FileSystemFileHandle>,
  ): void {
    this.root = root;
    this.handles = handles;
  }

  /** True when this bundle COULD write back — the folder route on a browser that allows it. */
  canWriteBack(): boolean {
    return this.root !== null && this.handles.size > 0;
  }

  /** Paths that map to a real file on disk; everything else is Monet-only (zip to get it out). */
  get onDisk(): ReadonlySet<string> {
    return new Set(this.handles.keys());
  }

  /**
   * Turn write-back on, asking for write permission first — the directory pick only grants
   * read. A refusal leaves the toggle off rather than failing later at save time.
   */
  async enableWriteBack(on: boolean): Promise<boolean> {
    if (!on) {
      this.writeBack = false;
      emit();
      return true;
    }
    if (!this.canWriteBack()) return false;
    const dir = this.root as FileSystemDirectoryHandle & {
      queryPermission?(d: { mode: string }): Promise<PermissionState>;
      requestPermission?(d: { mode: string }): Promise<PermissionState>;
    };
    const q = await dir.queryPermission?.({ mode: 'readwrite' });
    const granted =
      q === 'granted' || (await dir.requestPermission?.({ mode: 'readwrite' })) === 'granted';
    this.writeBack = !!granted;
    emit();
    return this.writeBack;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  /** Bytes already held, synchronously — the draft analysis re-parses on every change. */
  rawBytes(path: string): Uint8Array | null {
    return this.files.get(path) ?? null;
  }

  paths(): string[] {
    return [...this.files.keys()];
  }

  put(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes);
    this.placeholders.delete(path);
    emit();
  }

  /** Store `bytes` under the asset path a model asked for, however the file was named. */
  putAs(assetPath: string, bytes: Uint8Array): void {
    this.put(assetPath, bytes);
  }

  async putPlaceholder(assetPath: string): Promise<void> {
    const { encodePixelsToPng } = await import('../../engine/exporters');
    this.files.set(assetPath, await encodePixelsToPng(placeholderPixels(), 16, 16));
    this.placeholders.add(assetPath);
    emit();
  }

  /** Find `want` among the files already held, matching loosely (see core matchPath). */
  resolve(want: string): string | null {
    return matchPath(want, this.files.keys());
  }

  async list(): Promise<TextureNode[]> {
    return [...this.files.keys()]
      .filter((p) => p.toLowerCase().endsWith('.png'))
      .sort()
      .map((path) => ({ path, size: this.files.get(path)!.byteLength }));
  }

  async read(node: TextureNode): Promise<{ png: Uint8Array; project?: Uint8Array }> {
    const png = this.files.get(node.path);
    if (!png) throw new Error(`${node.path} is not in this bundle`);
    return { png };
  }

  async write(path: string, png: Uint8Array): Promise<void> {
    this.put(path, png);
    if (!this.writeBack) return;
    // Only ever overwrite a file we actually read. A placeholder or a hand-picked PNG has no
    // home in the user's folder, and inventing one would scatter files they never asked for —
    // those come out through the zip instead.
    const handle = this.handles.get(path);
    if (!handle) return;
    const writable = await (
      handle as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }
    ).createWritable();
    await writable.write(png as BlobPart);
    await writable.close();
  }

  async readPath(path: string): Promise<Uint8Array> {
    const hit =
      this.files.get(path) ??
      (this.resolve(path) ? this.files.get(this.resolve(path)!) : undefined);
    if (!hit) throw new Error(`${path} is not in this bundle`);
    return hit;
  }

  async listModels(): Promise<string[]> {
    return [...this.files.keys()].filter((p) => /\.json$/i.test(p)).sort();
  }

  /** Everything in the bundle as a zip, with `extra` (the edited model JSON, live texture
   *  pixels) overriding what is held. */
  async toZip(extra: Map<string, Uint8Array> = new Map()): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const [path, bytes] of this.files) {
      zip.file(path, (extra.get(path) ?? bytes) as Uint8Array);
    }
    for (const [path, bytes] of extra) if (!this.files.has(path)) zip.file(path, bytes);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
}

/** Live bundles by id, so a model opened from one can find it again (zip export). */
const bundles = new Map<string, ModelBundleSource>();
export const getModelBundle = (id: string | undefined): ModelBundleSource | null =>
  (id && bundles.get(id)) || null;

export function createModelBundle(label: string): ModelBundleSource {
  const source = new ModelBundleSource(`bundle${++serial}`, label);
  bundles.set(source.id, source);
  registerSource(source);
  return source;
}

export function dropModelBundle(id: string): void {
  bundles.delete(id);
  removeSource(id);
}

// ---------------------------------------------------------------- picking files

interface DirHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

const SKIP = new Set(['.git', 'node_modules', '.monet', 'build', 'dist', '.gradle']);

/**
 * Every file under a directory, keyed by its path relative to that directory — as HANDLES, so
 * a bundle can write an edited texture back to the very file it came from. Bounded like the
 * folder source: a mispicked home directory must not hang the app.
 */
export async function indexDirectory(
  root: FileSystemDirectoryHandle,
  maxFiles = 20_000,
  maxDepth = 12,
): Promise<Map<string, FileSystemFileHandle>> {
  const out = new Map<string, FileSystemFileHandle>();
  const walk = async (dir: DirHandle, prefix: string, depth: number): Promise<void> => {
    if (depth > maxDepth || out.size >= maxFiles) return;
    for await (const entry of dir.values()) {
      if (out.size >= maxFiles) return;
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') await walk(entry as DirHandle, path, depth + 1);
      else if (/\.(png|json)$/i.test(entry.name)) out.set(path, entry as FileSystemFileHandle);
    }
  };
  await walk(root as DirHandle, '', 0);
  return out;
}

/** The bytes of a File. */
export const fileBytes = async (file: File): Promise<Uint8Array> =>
  new Uint8Array(await file.arrayBuffer());

/**
 * Where a picked file should live inside the bundle. A file picked from a directory keeps its
 * relative path; a loose file gets a synthetic assets path so model refs can find it by name.
 */
export function bundlePathFor(relativePath: string, fallbackNamespace = 'minecraft'): string {
  const clean = relativePath.replace(/^\.\//, '');
  if (/(^|\/)assets\//i.test(clean)) return clean.slice(clean.toLowerCase().indexOf('assets/'));
  if (/\.json$/i.test(clean)) return `assets/${fallbackNamespace}/models/${basename(clean)}`;
  return `assets/${fallbackNamespace}/textures/${basename(clean)}`;
}

// ---------------------------------------------------------------- pickers

const w = () =>
  window as unknown as {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  };

export const hasDirectoryPicker = () => typeof w().showDirectoryPicker === 'function';

export interface PickedDirectory {
  files: Map<string, File>;
  /** Present only via the File System Access picker — the input fallback cannot write back. */
  handles: Map<string, FileSystemFileHandle> | null;
  root: FileSystemDirectoryHandle | null;
}

/**
 * Files under a directory the user picks, keyed by path relative to it. Uses the File System
 * Access picker where it exists — which also yields handles, the only route to writing edits
 * back — and falls back to `<input webkitdirectory>`, which every desktop browser supports and
 * which reports the same relative paths but is read-only.
 */
export async function pickDirectoryFiles(): Promise<PickedDirectory> {
  const empty: PickedDirectory = { files: new Map(), handles: null, root: null };
  if (hasDirectoryPicker()) {
    try {
      const root = await w().showDirectoryPicker!();
      const handles = await indexDirectory(root);
      const files = new Map<string, File>();
      for (const [path, handle] of handles) files.set(path, await handle.getFile());
      return { files, handles, root };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return empty;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => {
      const files = new Map<string, File>();
      for (const f of input.files ? [...input.files] : []) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        // Drop the picked folder's own name so paths are relative to it, like the FSA walk.
        files.set(rel.split('/').slice(1).join('/') || f.name, f);
      }
      resolve({ files, handles: null, root: null });
    };
    input.oncancel = () => resolve(empty);
    input.click();
  });
}
