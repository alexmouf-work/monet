/**
 * Minecraft jar / mod jar source — docs/08 §2. Read-only. The jar bytes are cached in
 * IndexedDB so sources survive a reload, and indexing only reads entry paths (no decoding),
 * which keeps a ~25 MB vanilla jar well under the 2 s budget.
 */
import JSZip from 'jszip';
import type { SourceProvider, TextureNode } from '../sources';
import { emit, registerSource } from '../sources';
import { idbDel, idbGet, idbKeys, idbSet } from '../idb';

const BLOB_PREFIX = 'jar:';
const META_KEY = 'sources:jars';

export interface JarMeta {
  id: string;
  label: string;
  bytes: number;
}

const ASSET_PNG = /^assets\/[^/]+\/textures\/.+\.png$/i;
const ANY_PNG = /\.png$/i;
const MODEL_JSON = /^assets\/[^/]+\/models\/.+\.json$/i;

export const loadJarMetas = async (): Promise<JarMeta[]> =>
  ((await idbGet(META_KEY)) as JarMeta[] | undefined) ?? [];

async function saveJarMetas(list: JarMeta[]): Promise<void> {
  await idbSet(META_KEY, list);
}

class JarSource implements SourceProvider {
  kind = 'jar' as const;
  writable = false;
  private zip: JSZip | null = null;
  private nodes: TextureNode[] | null = null;
  /** Paths with an adjacent .mcmeta, i.e. animated strips. */
  private animated = new Set<string>();

  constructor(
    readonly id: string,
    readonly label: string,
    private byteLength: number,
  ) {}

  status(): string {
    return `${(this.byteLength / 1_048_576).toFixed(1)} MB cached`;
  }

  private async open(): Promise<JSZip> {
    if (this.zip) return this.zip;
    const bytes = (await idbGet(BLOB_PREFIX + this.id)) as Uint8Array | undefined;
    if (!bytes) throw new Error(`${this.label} is no longer cached — add the jar again.`);
    this.zip = await JSZip.loadAsync(bytes);
    return this.zip;
  }

  async list(): Promise<TextureNode[]> {
    if (this.nodes) return this.nodes;
    const zip = await this.open();
    const nodes: TextureNode[] = [];
    this.animated.clear();

    // Two passes: .mcmeta siblings can appear after the PNG they describe.
    zip.forEach((path, entry) => {
      if (!entry.dir && /\.png\.mcmeta$/i.test(path)) {
        this.animated.add(path.replace(/\.mcmeta$/i, ''));
      }
    });
    zip.forEach((path, entry) => {
      if (entry.dir || !ANY_PNG.test(path)) return;
      nodes.push({ path, ref: path, animated: this.animated.has(path) });
    });

    // Namespace textures first, then any other images — docs/08 §2.
    nodes.sort((a, b) => {
      const aAsset = ASSET_PNG.test(a.path) ? 0 : 1;
      const bAsset = ASSET_PNG.test(b.path) ? 0 : 1;
      return aAsset - bAsset || a.path.localeCompare(b.path);
    });
    this.nodes = nodes;
    return nodes;
  }

  isAnimated(path: string): boolean {
    return this.animated.has(path);
  }

  async read(node: TextureNode): Promise<{ png: Uint8Array }> {
    const zip = await this.open();
    const file = zip.file(String(node.ref ?? node.path));
    if (!file) throw new Error(`${node.path} is not in ${this.label}.`);
    return { png: await file.async('uint8array') };
  }

  async readPath(path: string): Promise<Uint8Array> {
    const zip = await this.open();
    const file = zip.file(path);
    if (!file) throw new Error(`${path} is not in ${this.label}.`);
    return file.async('uint8array');
  }

  async listModels(): Promise<string[]> {
    const zip = await this.open();
    const out: string[] = [];
    zip.forEach((path, entry) => {
      if (!entry.dir && MODEL_JSON.test(path)) out.push(path);
    });
    return out.sort();
  }

  dispose(): void {
    this.zip = null;
    this.nodes = null;
  }
}

export type { JarSource };

/** Cache a picked jar and register it as a source. */
export async function addJarSource(file: File): Promise<JarSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Fail fast on something that is not a zip, before caching megabytes of it.
  await JSZip.loadAsync(bytes);

  const id = `jar:${file.name}:${bytes.length}`;
  await idbSet(BLOB_PREFIX + id, bytes);
  const metas = (await loadJarMetas()).filter((m) => m.id !== id);
  const meta: JarMeta = { id, label: file.name, bytes: bytes.length };
  await saveJarMetas([...metas, meta]);

  const source = new JarSource(id, file.name, bytes.length);
  registerSource(source);
  return source;
}

export async function removeJarSource(id: string): Promise<void> {
  await idbDel(BLOB_PREFIX + id);
  await saveJarMetas((await loadJarMetas()).filter((m) => m.id !== id));
  emit();
}

export async function restoreJarSources(): Promise<void> {
  for (const meta of await loadJarMetas()) {
    registerSource(new JarSource(meta.id, meta.label, meta.bytes));
  }
}

/** Total cached jar bytes, for the settings dialog. */
export async function cachedJarBytes(): Promise<number> {
  const keys = (await idbKeys()).filter(
    (k): k is string => typeof k === 'string' && k.startsWith(BLOB_PREFIX),
  );
  let total = 0;
  for (const k of keys) {
    const v = (await idbGet(k)) as Uint8Array | undefined;
    total += v?.length ?? 0;
  }
  return total;
}
