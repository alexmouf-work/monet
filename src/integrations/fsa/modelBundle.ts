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

  constructor(
    readonly id: string,
    public label: string,
  ) {}

  status(): string {
    const n = this.files.size;
    const missing = this.placeholders.size;
    return `${n} file${n === 1 ? '' : 's'}${missing ? ` · ${missing} placeholder` : ''}`;
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
 * Every file under a directory, keyed by its path relative to that directory. Bounded like the
 * folder source: a mispicked home directory must not hang the app.
 */
export async function indexDirectory(
  root: FileSystemDirectoryHandle,
  maxFiles = 20_000,
  maxDepth = 12,
): Promise<Map<string, File>> {
  const out = new Map<string, File>();
  const walk = async (dir: DirHandle, prefix: string, depth: number): Promise<void> => {
    if (depth > maxDepth || out.size >= maxFiles) return;
    for await (const entry of dir.values()) {
      if (out.size >= maxFiles) return;
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') await walk(entry as DirHandle, path, depth + 1);
      else if (/\.(png|json)$/i.test(entry.name)) {
        out.set(path, await (entry as FileSystemFileHandle).getFile());
      }
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

/**
 * Files under a directory the user picks, keyed by path relative to it. Uses the File System
 * Access picker where it exists and falls back to `<input webkitdirectory>`, which every
 * desktop browser supports and which reports the same relative paths.
 */
export async function pickDirectoryFiles(): Promise<Map<string, File>> {
  if (hasDirectoryPicker()) {
    try {
      const root = await w().showDirectoryPicker!();
      return await indexDirectory(root);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return new Map();
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => {
      const out = new Map<string, File>();
      for (const f of input.files ? [...input.files] : []) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        // Drop the picked folder's own name so paths are relative to it, like the FSA walk.
        out.set(rel.split('/').slice(1).join('/') || f.name, f);
      }
      resolve(out);
    };
    input.oncancel = () => resolve(new Map());
    input.click();
  });
}
