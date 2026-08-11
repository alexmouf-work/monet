/**
 * The shared stroke engine — docs/02 §3. A stroke accumulates coverage into a scratch
 * buffer with `max` (so one stroke never darkens where it overlaps itself) and composites
 * once on pointer-up as a single undoable command.
 */
import type { MonetDoc, Rect } from '../core/model/types';
import { isRaster } from '../core/model/types';
import { hexToRgb } from '../core/color/convert';
import { StrokeCommand } from '../core/model/commands';
import { blendOver, unionRect } from '../core/raster/pixels';
import {
  bresenham,
  makeMarkerTip,
  makeTip,
  spacedPoints,
  tipOrigin,
  type TipMask,
} from '../core/raster/stamp';
import { ensureTopRasterLayer } from '../core/model/document';
import { ctx2d, imageDataFrom, makeCanvas } from '../engine/layerCache';
import { useDocStore } from '../app/docStore';
import { useToolStore, type TipShape } from '../app/toolStore';
import { setStrokeOverlay } from '../ui/sceneHooks';
import { anchorIfFloating } from '../app/selectionActions';
import { invalidate } from '../app/bus';

export type StrokeKind = 'paint' | 'erase';

interface Live {
  docId: string;
  w: number;
  h: number;
  cov: Float32Array;
  /** Everything the stroke has touched — the rect the final command commits. */
  dirty: Rect | null;
  /** Touched since the last overlay upload. Keeps the per-event upload proportional to the
   *  movement rather than to the whole stroke so far. */
  pending: Rect | null;
  tip: TipMask;
  kind: StrokeKind;
  /** rgb of the stroke; unused for erase. */
  rgb: { r: number; g: number; b: number };
  alpha: number;
  last: { x: number; y: number } | null;
  canvas: HTMLCanvasElement;
}

let live: Live | null = null;

const tipCache = new Map<string, TipMask>();

function tipFor(size: number, shape: TipShape, graded: boolean): TipMask {
  const key = `${graded ? 'm' : 'h'}${size}${shape}`;
  let t = tipCache.get(key);
  if (!t) {
    t = graded ? makeMarkerTip(size, shape) : makeTip(size, shape);
    tipCache.set(key, t);
  }
  return t;
}

export function beginStroke(opts: {
  kind: StrokeKind;
  size: number;
  shape: TipShape;
  graded: boolean;
  at: { x: number; y: number };
  /** Paint into this document instead of the active one — the 3D path (docs/11 §8), where
   *  the ACTIVE document is the model and the target is the face's texture document. */
  doc?: MonetDoc;
}): void {
  anchorIfFloating();
  const doc = opts.doc ?? useDocStore.getState().active();
  if (!doc) return;
  const { color, alpha } = useToolStore.getState();
  live = {
    docId: doc.id,
    w: doc.width,
    h: doc.height,
    cov: new Float32Array(doc.width * doc.height),
    dirty: null,
    pending: null,
    tip: tipFor(opts.size, opts.shape, opts.graded),
    kind: opts.kind,
    rgb: hexToRgb(color),
    alpha,
    last: null,
    canvas: makeCanvas(doc.width, doc.height),
  };
  setStrokeOverlay({ canvas: live.canvas, mode: opts.kind === 'erase' ? 'erase' : 'over' });
  stampAt(opts.at, opts.graded);
  paintOverlay();
}

/** One tip impression merged into the coverage buffer with max. */
function stamp(px: number, py: number) {
  if (!live) return;
  const { tip, cov, w, h } = live;
  const o = tipOrigin({ x: px, y: py }, tip.size);
  for (let ty = 0; ty < tip.size; ty++) {
    const y = o.y + ty;
    if (y < 0 || y >= h) continue;
    for (let tx = 0; tx < tip.size; tx++) {
      const m = tip.a[ty * tip.size + tx];
      if (m <= 0) continue;
      const x = o.x + tx;
      if (x < 0 || x >= w) continue;
      const i = y * w + x;
      if (m > cov[i]) cov[i] = m;
    }
  }
  const touched = { x: o.x, y: o.y, w: tip.size, h: tip.size };
  live.dirty = unionRect(live.dirty, touched);
  live.pending = unionRect(live.pending, touched);
}

function stampAt(p: { x: number; y: number }, graded: boolean) {
  if (!live) return;
  if (!live.last) {
    stamp(p.x, p.y);
  } else if (graded) {
    // Marker: fixed spacing so overlapping falloffs stay smooth.
    for (const q of spacedPoints(live.last, p, Math.max(1, live.tip.size * 0.25))) stamp(q.x, q.y);
  } else {
    bresenham(live.last.x, live.last.y, p.x, p.y, (x, y) => stamp(x, y));
  }
  live.last = { ...p };
}

export function extendStroke(at: { x: number; y: number }, graded: boolean): void {
  if (!live) return;
  stampAt(at, graded);
  paintOverlay();
}

/**
 * Rebuilds the scratch canvas over the newly touched rect so the renderer can preview the
 * stroke. Uploading the *cumulative* rect instead made every pointer event cost the whole
 * area painted so far — a long stroke degraded as it went.
 */
function paintOverlay() {
  if (!live) return;
  const r = clampToDoc(live.pending, live.w, live.h);
  live.pending = null;
  if (!r) return;
  const buf = new Uint8ClampedArray(r.w * r.h * 4);
  const { cov, rgb, alpha, kind, w } = live;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const c = cov[(r.y + y) * w + (r.x + x)];
      if (c <= 0) continue;
      const o = (y * r.w + x) * 4;
      if (kind === 'erase') {
        // The overlay is punched out of each layer, so only its alpha matters.
        buf[o] = buf[o + 1] = buf[o + 2] = 0;
        buf[o + 3] = Math.round(c * 255);
      } else {
        buf[o] = rgb.r;
        buf[o + 1] = rgb.g;
        buf[o + 2] = rgb.b;
        buf[o + 3] = Math.round(c * alpha * 255);
      }
    }
  }
  ctx2d(live.canvas).putImageData(imageDataFrom(buf, r.w, r.h), r.x, r.y);
  invalidate(false);
}

function clampToDoc(r: Rect | null, w: number, h: number): Rect | null {
  if (!r) return null;
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  if (x1 <= x || y1 <= y) return null;
  return { x, y, w: x1 - x, h: y1 - y };
}

/** Composite the accumulated coverage into the document as one command — docs/02 §3.3. */
export function endStroke(label: string): void {
  if (!live) return;
  const current = live;
  live = null;
  setStrokeOverlay(null);

  const ds = useDocStore.getState();
  const doc = ds.docs[current.docId];
  const rect = clampToDoc(current.dirty, current.w, current.h);
  if (!doc || !rect) {
    invalidate();
    return;
  }

  // Eraser hits every raster layer; painting hits the auto-selected top layer (docs/01 §3.1).
  const targets =
    current.kind === 'erase' ? doc.stack.filter(isRaster) : [ensureTopRasterLayer(doc)];
  if (!targets.length) {
    invalidate();
    return;
  }

  const before = new Map<number, Uint8ClampedArray>();
  for (const t of targets) before.set(t.id, new Uint8ClampedArray(t.pixels));

  const { cov, rgb, alpha } = current;
  for (const layer of targets) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const c = cov[y * current.w + x];
        if (c <= 0) continue;
        const i = (y * current.w + x) * 4;
        if (current.kind === 'erase') {
          layer.pixels[i + 3] = Math.round(layer.pixels[i + 3] * (1 - c));
        } else {
          blendOver(layer.pixels, i, rgb.r, rgb.g, rgb.b, c * alpha);
        }
      }
    }
  }

  const cmd = StrokeCommand.capture(
    doc,
    label,
    targets.map((t) => t.id),
    rect,
    before,
  );
  // The pixels are already mutated, so replay the command's `before` and let execute() redo it.
  cmd.undo(doc);
  ds.executeOn(doc.id, cmd);
  useToolStore.getState().commitRecent();
}

export const strokeActive = () => live !== null;

/** The document the live stroke is painting into, or null. */
export const strokeDocId = () => live?.docId ?? null;

/**
 * Forget the last stamp point WITHOUT ending the stroke: the next stamp starts a fresh
 * segment instead of interpolating. This is how a 3D drag crosses a UV discontinuity —
 * interpolating across one would draw a line through unrelated texels (docs/11 §8.1) —
 * while still committing as ONE undo step on pointer-up.
 */
export function breakStroke(): void {
  if (live) live.last = null;
}

export function cancelStroke(): void {
  if (!live) return;
  live = null;
  setStrokeOverlay(null);
  invalidate();
}
