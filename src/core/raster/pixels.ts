/** Pixel buffer utilities — docs/01 §5. Un-premultiplied RGBA throughout. */
import type { Rect } from '../model/types';

export const idx = (x: number, y: number, width: number) => (y * width + x) * 4;

export const emptyPixels = (w: number, h: number) => new Uint8ClampedArray(w * h * 4);

/** Un-premultiplied source-over: composite one src pixel onto dst at byte offset i. */
export function blendOver(
  dst: Uint8ClampedArray,
  i: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number /* 0–1 */,
): void {
  if (sa <= 0) return;
  if (sa >= 1) {
    dst[i] = sr;
    dst[i + 1] = sg;
    dst[i + 2] = sb;
    dst[i + 3] = 255;
    return;
  }
  const da = dst[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) {
    dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0;
    return;
  }
  dst[i] = Math.round((sr * sa + dst[i] * da * (1 - sa)) / oa);
  dst[i + 1] = Math.round((sg * sa + dst[i + 1] * da * (1 - sa)) / oa);
  dst[i + 2] = Math.round((sb * sa + dst[i + 2] * da * (1 - sa)) / oa);
  dst[i + 3] = Math.round(oa * 255);
}

export function copyRect(src: Uint8ClampedArray, srcW: number, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = idx(r.x, r.y + y, srcW);
    out.set(src.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return out;
}

export function pasteRect(
  dst: Uint8ClampedArray,
  dstW: number,
  r: Rect,
  data: Uint8ClampedArray,
): void {
  for (let y = 0; y < r.h; y++) {
    dst.set(data.subarray(y * r.w * 4, (y + 1) * r.w * 4), idx(r.x, r.y + y, dstW));
  }
}

/** Composite `data` (a w*h RGBA block) over dst at r, source-over. */
export function blendRect(
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  r: Rect,
  data: Uint8ClampedArray,
): void {
  for (let y = 0; y < r.h; y++) {
    const dy = r.y + y;
    if (dy < 0 || dy >= dstH) continue;
    for (let x = 0; x < r.w; x++) {
      const dx = r.x + x;
      if (dx < 0 || dx >= dstW) continue;
      const s = (y * r.w + x) * 4;
      blendOver(dst, idx(dx, dy, dstW), data[s], data[s + 1], data[s + 2], data[s + 3] / 255);
    }
  }
}

export function clearRect(dst: Uint8ClampedArray, dstW: number, dstH: number, r: Rect): void {
  const c = clampRect(r, dstW, dstH);
  for (let y = 0; y < c.h; y++) {
    dst.fill(0, idx(c.x, c.y + y, dstW), idx(c.x + c.w, c.y + y, dstW));
  }
}

/** Intersect r with the document rect; returns a zero-size rect when disjoint. */
export function clampRect(r: Rect, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export const rectArea = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);

export const fullRect = (w: number, h: number): Rect => ({ x: 0, y: 0, w, h });

export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}
