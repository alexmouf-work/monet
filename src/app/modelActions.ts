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
import { elementsSignature } from '../core/model3d/javaModelWriter';
import { decodeImage } from '../engine/exporters';
import { getSource, listSources, type SourceProvider } from '../integrations/sources';
import { MAX_DIM, type Rect } from '../core/model/types';
import { createDoc } from '../core/model/document';
import type { FaceHit } from '../core/model3d/types';
import { copyRect } from '../core/raster/pixels';
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
      display: Object.keys(resolved.display).length ? resolved.display : undefined,
      // Round-trip baseline (docs/11 §13.1): the file's OWN json plus the geometry as loaded,
      // so a save preserves `parent`/unknown keys and skips inherited, untouched `elements`.
      raw: root as Record<string, unknown>,
      baseline: elementsSignature(resolved.generated ? generatedElements() : resolved.elements),
      displayBaseline: JSON.stringify(resolved.display),
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

/** A fresh from-scratch model document: one starter cube, no textures yet (docs/11 §16 M16). */
export function newModelDoc(): void {
  const ds = useDocStore.getState();
  const id = newModelId();
  const cube = {
    id: 1,
    name: 'cube 1',
    groupId: null,
    from: { x: 4, y: 0, z: 4 },
    to: { x: 12, y: 8, z: 12 },
    faces: Object.fromEntries(
      ['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [
        f,
        { uv: [0, 0, 16, 16] as [number, number, number, number], texture: 'all' },
      ]),
    ),
    visible: true,
    locked: false,
  } as Model3D['elements'][number];
  const doc: Model3D = {
    kind: 'model',
    id,
    name: 'untitled model',
    dirty: false,
    format: 'java_block',
    unit: 16,
    elements: [cube],
    groups: [],
    textures: { all: { kind: 'unresolved', ref: '#all' } },
    missing: [],
    camera: frame(DEFAULT_CAMERA, { x: 0, y: 0, z: 0 }, { x: 16, y: 16, z: 16 }),
    vanillaMode: true,
    nextItemId: 2,
  };
  ds.addModel(doc);
}

/**
 * Save a model document — the M16 subset of docs/11 §13: vanilla JSON via download. Jar
 * sources are read-only, so until repo/folder model writing lands (M19) every model save is
 * a download; the file loads in Minecraft unmodified.
 */
export async function saveModelDoc(model: Model3D): Promise<void> {
  const { writeJavaModel } = await import('../core/model3d/javaModelWriter');
  const { downloadBlob } = await import('../integrations/fsa/localFile');
  const json = writeJavaModel(model);
  downloadBlob(
    new Blob([json], { type: 'application/json' }),
    `${model.name.replace(/\s+/g, '_')}.json`,
  );
  useDocStore.getState().markSaved(model.id);
  toast(`Saved ${model.name}.json`, 'ok');
}

// ------------------------------------------------------------------ face → texture (docs/11 §9)

/** The face's uv rect in TEXTURE PIXELS, normalized so inverted uvs still give w,h > 0. */
export function faceUVRect(model: Model3D, hit: FaceHit): Rect | null {
  const el = model.elements.find((e) => e.id === hit.elementId);
  const face = el?.faces[hit.face];
  const ref = model.textures[hit.textureVar];
  if (!face || !ref || ref.kind === 'unresolved') return null;
  const texW = ref.kind === 'file' ? ref.width : ref.rect.w;
  const texH = ref.kind === 'file' ? ref.height : ref.rect.h;
  const [u1, v1, u2, v2] = face.uv;
  const x0 = (Math.min(u1, u2) / 16) * texW;
  const y0 = (Math.min(v1, v2) / 16) * texH;
  const x1 = (Math.max(u1, u2) / 16) * texW;
  const y1 = (Math.max(v1, v2) / 16) * texH;
  return {
    x: Math.floor(x0),
    y: Math.floor(y0),
    w: Math.max(1, Math.round(x1 - x0)),
    h: Math.max(1, Math.round(y1 - y0)),
  };
}

/**
 * Open the texture behind a face — docs/11 §9.2. `file` refs open the whole PNG with the
 * face's uv rect selected; `region` refs extract the rectangle on demand into a document
 * whose binding writes back into the sheet. `wholeSheet` (Ctrl+Enter) forces the full file
 * even for a region ref.
 */
export async function openFaceTexture(
  model: Model3D,
  hit: FaceHit,
  opts: { wholeSheet?: boolean } = {},
): Promise<void> {
  const ref = model.textures[hit.textureVar];
  if (!ref || ref.kind === 'unresolved') {
    toast(`#${hit.textureVar} is unresolved — connect a jar with its assets.`, 'error');
    return;
  }
  const ds = useDocStore.getState();
  const sourceId = ref.sourceId;
  const path = ref.path;
  const region: Rect | undefined = ref.kind === 'region' && !opts.wholeSheet ? ref.rect : undefined;

  // Re-focus an existing tab rather than opening a second truth (docs/11 §9.2).
  const existing = Object.values(ds.docs).find(
    (d) =>
      d.binding?.sourceId === sourceId &&
      d.binding.path === path &&
      JSON.stringify(d.binding.region ?? null) === JSON.stringify(region ?? null),
  );
  if (existing) {
    ds.setActive(existing.id);
    if (!region) selectFaceRect(existing.id, model, hit);
    return;
  }

  const provider = getSource(sourceId);
  if (!provider) {
    toast('The texture’s source is no longer connected.', 'error');
    return;
  }
  try {
    const bytes = provider.readPath
      ? await provider.readPath(path)
      : (await provider.read({ path })).png;
    const decoded = await decodeImage(new Blob([bytes as BlobPart], { type: 'image/png' }));
    if (decoded.width > MAX_DIM || decoded.height > MAX_DIM) {
      toast(`${path} is larger than ${MAX_DIM}px.`, 'error');
      return;
    }
    const name = path
      .split('/')
      .pop()!
      .replace(/\.png$/i, '');

    if (region) {
      // On-demand extraction: the document is the region's pixels; the binding remembers the
      // rectangle so Ctrl+S blits it back into the sheet (integrations/sourceSave).
      const pixels = copyRect(decoded.pixels, decoded.width, region);
      const doc = createDoc({
        name: `${name} @${region.x},${region.y}`,
        width: region.w,
        height: region.h,
        pixels,
      });
      doc.binding = { sourceId, path, region };
      ds.addDoc(doc);
      return;
    }

    const doc = createDoc({
      name,
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.pixels,
    });
    doc.binding = { sourceId, path };
    ds.addDoc(doc);
    selectFaceRect(doc.id, model, hit);
  } catch (err) {
    toast(`Could not open ${path}: ${(err as Error).message}`, 'error');
  }
}

/** Select the face's uv rect in the (now active) image document so the area is obvious. */
function selectFaceRect(docId: string, model: Model3D, hit: FaceHit): void {
  const ds = useDocStore.getState();
  const rect = faceUVRect(model, hit);
  if (!rect || ds.activeId !== docId) return;
  ds.setSelection({ rect });
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
