/** RasterLayer id → offscreen canvas cache — docs/01 §4. Canvases are caches, never truth. */
import type { MonetDoc, RasterLayer, Rect } from '../core/model/types';
import { clampRect, copyRect } from '../core/raster/pixels';

interface Entry {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

const entries = new Map<string, Entry>();

const key = (docId: string, layerId: number) => `${docId}:${layerId}`;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

/** The layer's canvas, fully repainted when size or identity changed. */
export function getLayerCanvas(doc: MonetDoc, layer: RasterLayer): HTMLCanvasElement {
  const k = key(doc.id, layer.id);
  let e = entries.get(k);
  if (!e || e.w !== doc.width || e.h !== doc.height) {
    const canvas = makeCanvas(doc.width, doc.height);
    e = { canvas, ctx: ctx2d(canvas), w: doc.width, h: doc.height };
    entries.set(k, e);
    full(doc, layer, e);
  }
  return e.canvas;
}

/**
 * ImageData from an RGBA buffer. The cast is the one deliberate `any` at the DOM
 * boundary: TS 5.7 types typed arrays over ArrayBufferLike, while ImageData insists on
 * ArrayBuffer. Copying first keeps the caller's buffer detached from the ImageData.
 */
export function imageDataFrom(px: Uint8ClampedArray, w: number, h: number): ImageData {
  return new ImageData(new Uint8ClampedArray(px) as any, w, h);
}

function full(doc: MonetDoc, layer: RasterLayer, e: Entry) {
  e.ctx.putImageData(imageDataFrom(layer.pixels, doc.width, doc.height), 0, 0);
}

/** Repaint just `rect` (or everything when null) from the layer's pixel buffer. */
export function patchLayer(doc: MonetDoc, layer: RasterLayer, rect: Rect | null): void {
  const k = key(doc.id, layer.id);
  const e = entries.get(k);
  if (!e || e.w !== doc.width || e.h !== doc.height) {
    getLayerCanvas(doc, layer);
    return;
  }
  if (!rect) {
    full(doc, layer, e);
    return;
  }
  const r = clampRect(rect, doc.width, doc.height);
  if (r.w === 0 || r.h === 0) return;
  e.ctx.putImageData(imageDataFrom(copyRect(layer.pixels, doc.width, r), r.w, r.h), r.x, r.y);
}

export function invalidateLayer(docId: string, layerId: number): void {
  entries.delete(key(docId, layerId));
}

export function invalidateDoc(docId: string): void {
  for (const k of [...entries.keys()]) if (k.startsWith(`${docId}:`)) entries.delete(k);
}
