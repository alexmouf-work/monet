/**
 * Whole-canvas raster transforms — docs/06 §1.2–1.3. Pure functions returning new buffers.
 */
import type { Rect } from '../model/types';
import { emptyPixels, idx } from './pixels';

/** Nearest-neighbour resample — the default for pixel art (docs/06 §1.2). */
export function resampleNearest(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = emptyPixels(dw, dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
      const s = idx(sx, sy, sw);
      const d = idx(x, y, dw);
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

/**
 * Bilinear resample with **alpha-weighted colour**: weighting each colour tap by its own
 * alpha and dividing by the total stops transparent pixels dragging edges toward black.
 */
export function resampleBilinear(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = emptyPixels(dw, dh);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let aw = 0;
      for (let j = 0; j <= 1; j++) {
        for (let i = 0; i <= 1; i++) {
          const sx = Math.max(0, Math.min(sw - 1, x0 + i));
          const sy = Math.max(0, Math.min(sh - 1, y0 + j));
          const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
          const s = idx(sx, sy, sw);
          const sa = src[s + 3] / 255;
          r += src[s] * w * sa;
          g += src[s + 1] * w * sa;
          b += src[s + 2] * w * sa;
          a += src[s + 3] * w;
          aw += w * sa;
        }
      }
      const d = idx(x, y, dw);
      if (aw > 0) {
        out[d] = Math.round(r / aw);
        out[d + 1] = Math.round(g / aw);
        out[d + 2] = Math.round(b / aw);
      }
      out[d + 3] = Math.round(a);
    }
  }
  return out;
}

export type Resample = 'nearest' | 'bilinear';

export const resample = (
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  method: Resample,
) =>
  method === 'bilinear'
    ? resampleBilinear(src, sw, sh, dw, dh)
    : resampleNearest(src, sw, sh, dw, dh);

/** Re-canvas without scaling: content keeps its pixel position, anchored top-left. */
export function recanvas(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = emptyPixels(dw, dh);
  const w = Math.min(sw, dw);
  const h = Math.min(sh, dh);
  for (let y = 0; y < h; y++) {
    const from = idx(0, y, sw);
    out.set(src.subarray(from, from + w * 4), idx(0, y, dw));
  }
  return out;
}

/** dst(x, y) = src(y, H − 1 − x) — 90° clockwise; the result is H×W. */
export function rotate90CW(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = emptyPixels(h, w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < h; x++) {
      const s = idx(y, h - 1 - x, w);
      const d = idx(x, y, h);
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

/** dst(x, y) = src(W − 1 − y, x) — 90° anticlockwise; the result is H×W. */
export function rotate90ACW(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = emptyPixels(h, w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < h; x++) {
      const s = idx(w - 1 - y, x, w);
      const d = idx(x, y, h);
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

export function flipH(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = emptyPixels(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = idx(w - 1 - x, y, w);
      const d = idx(x, y, w);
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

export function flipV(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = emptyPixels(w, h);
  for (let y = 0; y < h; y++) {
    const from = idx(0, h - 1 - y, w);
    out.set(src.subarray(from, from + w * 4), idx(0, y, w));
  }
  return out;
}

export const cropRect = (src: Uint8ClampedArray, sw: number, rect: Rect) => {
  const out = emptyPixels(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) {
    const from = idx(rect.x, rect.y + y, sw);
    out.set(src.subarray(from, from + rect.w * 4), y * rect.w * 4);
  }
  return out;
};
