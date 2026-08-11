/**
 * Model documents: opening, texture resolution, and the pixel store the 3D renderer draws
 * from — docs/11 §4. Parent chains resolve through the document's own source first, then any
 * other source that can serve raw paths, then the built-in vanilla table, so a model opens
 * usefully with no jar connected and degrades to a banner rather than a crash.
 */
import type { Model3D, TextureRef } from '../core/model3d/types';
import { DEFAULT_CAMERA, frame } from '../core/model3d/camera';
import { modelBounds } from '../core/model3d/geometry';
import {
  modelRefToPath,
  resolveJavaModel,
  textureRefToPath,
  type RawJavaModel,
} from '../core/model3d/javaModel';
import { builtinParent } from '../core/model3d/vanillaParents';
import { decodeImage } from '../engine/exporters';
import { listSources, type SourceProvider } from '../integrations/sources';
import { toast } from './bus';
import { useDocStore } from './docStore';

let serial = 0;
const newModelId = () => `mdl${++serial}-${Math.floor(Math.random() * 10000)}`;

export interface ModelTexturePixels {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Bumped on every pixel change; the GL layer re-uploads when it sees a new version. */
  version: number;
  sourceId?: string;
  path?: string;
}

/** docId → texture var → pixels. Module state, not React state: the renderer polls by version. */
const texturePixels = new Map<string, Map<string, ModelTexturePixels>>();

export const modelTextures = (docId: string): Map<string, ModelTexturePixels> => {
  let m = texturePixels.get(docId);
  if (!m) {
    m = new Map();
    texturePixels.set(docId, m);
  }
  return m;
};

export const dropModelTextures = (docId: string): void => {
  texturePixels.delete(docId);
};

/** Every provider that can serve raw paths, the preferred one first. */
function pathReaders(preferred?: SourceProvider): SourceProvider[] {
  const rest = listSources().filter((s) => s.readPath && s.id !== preferred?.id);
  return preferred?.readPath ? [preferred, ...rest] : rest;
}

async function readFirst(providers: SourceProvider[], path: string) {
  for (const p of providers) {
    try {
      return { bytes: await p.readPath!(path), provider: p };
    } catch {
      /* try the next source */
    }
  }
  return null;
}

/** Open a Minecraft model JSON from a source as a model document (docs/11 §4). */
export async function openModelFromSource(source: SourceProvider, path: string): Promise<void> {
  const ds = useDocStore.getState();
  const existing = Object.values(ds.models).find(
    (m) => m.binding?.sourceId === source.id && m.binding.path === path,
  );
  if (existing) {
    ds.setActive(existing.id);
    return;
  }

  try {
    const readers = pathReaders(source);
    const rootBytes = await source.readPath!(path);
    const root = JSON.parse(new TextDecoder().decode(rootBytes)) as RawJavaModel;

    // Prefetch the parent chain (async) so the pure resolver can stay synchronous.
    const fetched = new Map<string, RawJavaModel | null>();
    let cursor: RawJavaModel | undefined = root;
    for (let depth = 0; depth < 16 && cursor?.parent; depth++) {
      const ref: string = cursor.parent.includes(':')
        ? cursor.parent
        : `minecraft:${cursor.parent}`;
      if (fetched.has(ref)) break;
      const hit = await readFirst(readers, modelRefToPath(ref));
      let parsed: RawJavaModel | null = null;
      if (hit) {
        try {
          parsed = JSON.parse(new TextDecoder().decode(hit.bytes)) as RawJavaModel;
        } catch {
          parsed = null;
        }
      }
      fetched.set(ref, parsed ?? builtinParent(ref));
      cursor = fetched.get(ref) ?? undefined;
    }

    const resolved = resolveJavaModel(root, (ref) => fetched.get(ref) ?? builtinParent(ref));

    const name = path
      .split('/')
      .pop()!
      .replace(/\.json$/i, '');
    const id = newModelId();

    // Resolve texture variables to pixels. Missing ones render as the classic magenta/black
    // checker via the GL layer's fallback; they are also listed on the model banner.
    const textures: Record<string, TextureRef> = {};
    const store = modelTextures(id);
    const missingTextures: string[] = [];
    for (const [key, texRef] of Object.entries(resolved.textures)) {
      if (texRef.startsWith('#')) {
        textures[key] = { kind: 'unresolved', ref: texRef };
        missingTextures.push(`#${key}`);
        continue;
      }
      const texPath = textureRefToPath(texRef);
      const hit = await readFirst(readers, texPath);
      if (!hit) {
        textures[key] = { kind: 'unresolved', ref: texRef };
        missingTextures.push(texRef);
        continue;
      }
      try {
        const decoded = await decodeImage(new Blob([hit.bytes as BlobPart], { type: 'image/png' }));
        textures[key] = {
          kind: 'file',
          sourceId: hit.provider.id,
          path: texPath,
          width: decoded.width,
          height: decoded.height,
        };
        store.set(key, {
          pixels: decoded.pixels,
          width: decoded.width,
          height: decoded.height,
          version: 1,
          sourceId: hit.provider.id,
          path: texPath,
        });
      } catch {
        textures[key] = { kind: 'unresolved', ref: texRef };
        missingTextures.push(texRef);
      }
    }

    const isItem = /\/models\/item\//.test(path);
    const doc: Model3D = {
      kind: 'model',
      id,
      name,
      dirty: false,
      binding: { sourceId: source.id, path },
      format: isItem ? 'java_item' : 'java_block',
      unit: 16,
      elements: resolved.generated ? generatedElements() : resolved.elements,
      groups: [],
      textures,
      missing: [...resolved.missing, ...missingTextures],
      ambientocclusion: resolved.ambientocclusion,
      guiLight: resolved.guiLight,
      camera: frame(DEFAULT_CAMERA, ...boundsOf(resolved)),
      vanillaMode: true,
      nextItemId: resolved.elements.length + 1,
    };
    ds.addModel(doc);
  } catch (err) {
    toast(`Could not open ${path}: ${(err as Error).message}`, 'error');
  }
}

function boundsOf(resolved: { elements: Model3D['elements'] }) {
  const b = modelBounds(resolved.elements);
  return [b.min, b.max] as const;
}

/**
 * item/generated stand-in — docs/11 §4.4: a flat two-sided quad showing layer0. Real
 * silhouette extrusion is a later item; this renders the sprite in 3D and is paintable.
 */
function generatedElements(): Model3D['elements'] {
  const face = { uv: [0, 0, 16, 16] as [number, number, number, number], texture: 'layer0' };
  return [
    {
      id: 1,
      name: 'sprite',
      groupId: null,
      from: { x: 0, y: 0, z: 7.5 },
      to: { x: 16, y: 16, z: 8.5 },
      faces: { south: { ...face }, north: { ...face } },
      shade: false,
      visible: true,
      locked: true,
    },
  ];
}
