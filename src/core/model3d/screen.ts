/**
 * Screen-space helpers for selection — docs/11 §10.1 item 3. Pure: the workspace supplies a
 * view-projection matrix and a viewport size, this returns pixel rectangles, so box-select can
 * be reasoned about (and tested) without a canvas.
 */
import type { ModelElement } from './types';
import { applyElementRotation } from './geometry';
import { transformPoint, type Mat4 } from './vec';
import { vec3 } from './types';

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The element's projected bounding rectangle in canvas pixels, or null when it lies entirely
 * behind the camera. All eight corners are projected (element rotation included), which is
 * exact enough for a marquee: it never misses a visible box.
 */
export function elementScreenRect(
  el: ModelElement,
  vp: Mat4,
  width: number,
  height: number,
): ScreenRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const cx of [el.from.x, el.to.x])
    for (const cy of [el.from.y, el.to.y])
      for (const cz of [el.from.z, el.to.z]) {
        const p = transformPoint(vp, applyElementRotation(el, vec3(cx, cy, cz)));
        // Behind the camera in clip space: skip the corner rather than mirroring it in front.
        if (p.z < -1) continue;
        any = true;
        const sx = ((p.x + 1) / 2) * width;
        const sy = ((1 - p.y) / 2) * height;
        minX = Math.min(minX, sx);
        minY = Math.min(minY, sy);
        maxX = Math.max(maxX, sx);
        maxY = Math.max(maxY, sy);
      }
  return any ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

export const rectsOverlap = (a: ScreenRect, b: ScreenRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Element ids whose projected rectangle meets `box` — the marquee's result. */
export function elementsInBox(
  elements: ModelElement[],
  box: ScreenRect,
  vp: Mat4,
  width: number,
  height: number,
): number[] {
  const out: number[] = [];
  for (const el of elements) {
    if (!el.visible) continue;
    const r = elementScreenRect(el, vp, width, height);
    if (r && rectsOverlap(r, box)) out.push(el.id);
  }
  return out;
}
