/**
 * Painting on the model — docs/11 §8. The 3D side generates texture coordinates and hands
 * them to the EXISTING 2D stroke engine; pen, marker, eraser, bucket and eyedropper are the
 * same tools with the same settings, and a 4 px brush covers the same texels as in 2D.
 *
 * The rules this file owns:
 *  1. Interpolation happens in texture space. Consecutive hits on the SAME face join through
 *     the engine's Bresenham; crossing to another face calls breakStroke() so no line is
 *     drawn through unrelated texels — while staying ONE stroke and ONE undo step.
 *  2. Crossing to a face of a DIFFERENT texture ends the stroke and begins a new one on the
 *     other texture's document (separate documents cannot share an undo step).
 *  3. Painting a face whose texture has no open document opens one silently in the
 *     background — from the already-decoded texture store, synchronously — so every stroke
 *     lands in a real document with real undo and a real save path.
 */
import { useDocStore } from '../app/docStore';
import { useToolStore } from '../app/toolStore';
import { modelTextures } from '../app/modelActions';
import { boundImageDoc, syncModelTextures } from '../app/modelTextureSync';
import { invalidate } from '../app/bus';
import { createDoc } from '../core/model/document';
import { rgbToHex } from '../core/color/convert';
import type { MonetDoc } from '../core/model/types';
import type { FaceHit, Model3D } from '../core/model3d/types';
import { faceKey } from '../core/model3d/geometry';
import { compositePixels } from '../engine/compose';
import { getComposeOpts } from '../ui/sceneHooks';
import { applyBucket } from './bucketTool';
import { beginStroke, breakStroke, endStroke, extendStroke, strokeActive } from './strokeEngine';

export type PaintToolId = 'pen' | 'marker' | 'eraser' | 'bucket' | 'eyedropper';

export const isPaintTool = (id: string): id is PaintToolId =>
  id === 'pen' || id === 'marker' || id === 'eraser' || id === 'bucket' || id === 'eyedropper';

interface Session {
  modelId: string;
  textureVar: string;
  docId: string;
  face: number; // faceKey of the segment being painted
  graded: boolean;
  label: string;
}

let session: Session | null = null;

/** The texture doc most recently painted from 3D — Ctrl+Z's target while a model is active. */
let lastPaintedDocId: string | null = null;
export const lastPaintedDoc = () => lastPaintedDocId;

/**
 * The image document that owns a texture var's pixels, opened silently (and synchronously,
 * from the decoded store) when none is open yet. Returns null for unresolved textures.
 */
function targetDoc(model: Model3D, textureVar: string): MonetDoc | null {
  const entry = modelTextures(model.id).get(textureVar);
  if (!entry) return null;
  const existing = boundImageDoc(entry.sourceId, entry.path);
  if (existing) return existing;

  const ds = useDocStore.getState();
  const name = (entry.path ?? textureVar)
    .split('/')
    .pop()!
    .replace(/\.png$/i, '');
  const doc = createDoc({
    name,
    width: entry.width,
    height: entry.height,
    pixels: new Uint8ClampedArray(entry.pixels),
  });
  if (entry.sourceId && entry.path) doc.binding = { sourceId: entry.sourceId, path: entry.path };
  const modelId = ds.activeId;
  ds.addDoc(doc); // makes it active…
  if (modelId) ds.setActive(modelId); // …so put the model back in front, tab stays open behind
  return doc;
}

/** uvNorm → texture-space point (floats, so marker spacing stays smooth). */
function texelPoint(hit: FaceHit, doc: MonetDoc): { x: number; y: number } {
  return {
    x: Math.min(doc.width - 1e-4, Math.max(0, hit.uvNorm.u * doc.width)),
    y: Math.min(doc.height - 1e-4, Math.max(0, hit.uvNorm.v * doc.height)),
  };
}

/**
 * Push the in-progress stroke into the GL textures so the model previews it live. EVERY var
 * backed by this document's file updates — a cube's six faces are six vars over one file,
 * and painting through #south must show on the west face mid-stroke too.
 */
function previewToModel(model: Model3D, _textureVar: string, doc: MonetDoc): void {
  const store = modelTextures(model.id);
  let composite: Uint8ClampedArray | null = null;
  for (const entry of store.values()) {
    if (entry.sourceId !== doc.binding?.sourceId || entry.path !== doc.binding?.path) continue;
    // Composite WITH the stroke overlay (getComposeOpts carries it) — the live preview.
    composite ??= compositePixels(doc, getComposeOpts());
    entry.pixels = composite;
    entry.version += 1;
  }
  if (composite) invalidate(false);
}

export function beginModelStroke(model: Model3D, hit: FaceHit): void {
  const ts = useToolStore.getState();
  const tool = ts.active;
  if (tool !== 'pen' && tool !== 'marker' && tool !== 'eraser') return;
  const doc = targetDoc(model, hit.textureVar);
  if (!doc) return;

  const settings = ts[tool];
  session = {
    modelId: model.id,
    textureVar: hit.textureVar,
    docId: doc.id,
    face: faceKey(hit.elementId, hit.face),
    graded: tool === 'marker',
    label: tool === 'eraser' ? 'Eraser' : tool === 'marker' ? 'Marker' : 'Pixel pen',
  };
  lastPaintedDocId = doc.id;
  beginStroke({
    kind: tool === 'eraser' ? 'erase' : 'paint',
    size: settings.size,
    shape: settings.tip,
    graded: session.graded,
    at: texelPoint(hit, doc),
    doc,
  });
  previewToModel(model, hit.textureVar, doc);
}

export function extendModelStroke(model: Model3D, hit: FaceHit | null): void {
  if (!session || !strokeActive()) return;
  // Off the model entirely: keep the stroke alive but break the segment, so re-entering
  // does not draw a chord across the gap.
  if (!hit) {
    breakStroke();
    return;
  }

  // Identity is the target DOCUMENT, not the variable name: a cube's west and south faces
  // use different vars (#west, #south) that resolve to the same file — one texture, one
  // stroke, one undo step. Only a genuinely different underlying texture ends the stroke.
  if (hit.textureVar !== session.textureVar) {
    const next = targetDoc(model, hit.textureVar);
    if (!next) {
      breakStroke();
      return;
    }
    if (next.id !== session.docId) {
      const model3d = useDocStore.getState().models[session.modelId];
      endStroke(session.label);
      session = null;
      if (model3d) beginModelStroke(model3d, hit);
      return;
    }
    session.textureVar = hit.textureVar; // same doc via another var: carry on
  }

  const key = faceKey(hit.elementId, hit.face);
  if (key !== session.face) {
    breakStroke(); // same texture, new face: fresh segment, same undo step (docs/11 §8.1)
    session.face = key;
  }

  const doc = useDocStore.getState().docs[session.docId];
  if (!doc) return;
  extendStroke(texelPoint(hit, doc), session.graded);
  previewToModel(model, session.textureVar, doc);
}

export function endModelStroke(): void {
  if (!session) return;
  const { label, modelId, textureVar, docId } = session;
  session = null;
  endStroke(label);
  // The commit path invalidates content, which re-syncs the texture from the document —
  // but only for OPEN bound docs; force one pass so the preview never sticks.
  syncModelTextures();
  const model = useDocStore.getState().models[modelId];
  const doc = useDocStore.getState().docs[docId];
  if (model && doc) previewToModel(model, textureVar, doc);
}

export const modelStrokeActive = () => session !== null && strokeActive();

/** Bucket and eyedropper are single hits, not strokes. */
export function modelBucketAt(model: Model3D, hit: FaceHit): void {
  const doc = targetDoc(model, hit.textureVar);
  if (!doc) return;
  lastPaintedDocId = doc.id;
  const p = texelPoint(hit, doc);
  // Region growth reads the document's own composite — same rule as 2D (docs/02 §5).
  applyBucket(doc, Math.floor(p.x), Math.floor(p.y), compositePixels(doc, getComposeOpts()));
  previewToModel(model, hit.textureVar, doc);
}

export function modelEyedropperAt(model: Model3D, hit: FaceHit): void {
  const entry = modelTextures(model.id).get(hit.textureVar);
  if (!entry) return;
  const x = Math.min(entry.width - 1, Math.floor(hit.uvNorm.u * entry.width));
  const y = Math.min(entry.height - 1, Math.floor(hit.uvNorm.v * entry.height));
  const i = (y * entry.width + x) * 4;
  const ts = useToolStore.getState();
  const a = entry.pixels[i + 3];
  if (a === 0) {
    ts.setColor(ts.color, 0); // transparent texel: keep the hue, take the alpha (docs/02 §1)
  } else {
    ts.setColor(rgbToHex(entry.pixels[i], entry.pixels[i + 1], entry.pixels[i + 2]), a / 255);
  }
  ts.commitRecent();
}
