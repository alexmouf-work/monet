/**
 * Source façade — docs/08. One entry point for "where does this document save to", so
 * fileActions never needs to know whether a source is a jar, a folder or a GitHub repo.
 * Individual providers register themselves here (jar: read-only; folder and repo: writable).
 */
import type { MonetDoc } from '../core/model/types';

export type SourceKind = 'jar' | 'folder' | 'repo';

export interface TextureNode {
  /** Full source-relative path, e.g. assets/minecraft/textures/item/sword.png */
  path: string;
  /** Provider-specific handle (zip entry name, blob sha, file handle …). */
  ref?: unknown;
  size?: number;
  /** True when a .monet project mirror exists for this texture (docs/08 §6.2). */
  hasProject?: boolean;
  /** Jar textures with a sibling .mcmeta are animated strips (docs/08 §2). */
  animated?: boolean;
}

export interface SourceProvider {
  id: string;
  kind: SourceKind;
  label: string;
  writable: boolean;
  /** Textures offered by this source, already filtered to PNGs. */
  list(): Promise<TextureNode[]>;
  /** Bytes of one texture (and its project mirror, when present). */
  read(node: TextureNode): Promise<{ png: Uint8Array; project?: Uint8Array }>;
  /** Write a texture plus its project mirror. Writable sources only. */
  write?(path: string, png: Uint8Array, project: Uint8Array): Promise<void>;
  /** Extra status line for the sidebar (branch state, cache size …). */
  status?(): string;
  refresh?(): Promise<void>;
  dispose?(): void;
}

const providers = new Map<string, SourceProvider>();
const listeners = new Set<() => void>();

export function registerSource(p: SourceProvider): void {
  providers.set(p.id, p);
  emit();
}

export function removeSource(id: string): void {
  providers.get(id)?.dispose?.();
  providers.delete(id);
  emit();
}

export const getSource = (id: string) => providers.get(id);
export const listSources = () => [...providers.values()];
export const sourceIsWritable = (id: string) => !!providers.get(id)?.writable;

export function onSourcesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emit(): void {
  for (const fn of listeners) fn();
}

/** Save a bound document back into its source (PNG + `.monet` mirror) — docs/08 §6.3. */
export async function saveToSource(doc: MonetDoc): Promise<void> {
  const { saveBoundDoc } = await import('./sourceSave');
  await saveBoundDoc(doc);
}
