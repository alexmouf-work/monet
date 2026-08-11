/**
 * UV editing helpers — docs/11 §10.2 (M17). Pure functions over face uv rects, which live
 * in 0..16 texture units regardless of the sheet's pixel size (v downward). Mirroring works
 * by swapping rect endpoints: rendering and picking interpolate between them (stToUV), so an
 * inverted rect IS the mirrored face — no extra state.
 */
import type { Face, ModelElement } from './types';
import { defaultUV } from './javaModel';

export type UVRect = [number, number, number, number];
export type UVRotation = 0 | 90 | 180 | 270;

/** Next step in the 90° rotation cycle. */
export const cycleRotation = (r: UVRotation | undefined): UVRotation =>
  (((r ?? 0) + 90) % 360) as UVRotation;

export const mirrorUVu = (uv: UVRect): UVRect => [uv[2], uv[1], uv[0], uv[3]];
export const mirrorUVv = (uv: UVRect): UVRect => [uv[0], uv[3], uv[2], uv[1]];

/** The vanilla projection of this face of this box — "fit to element face" (§10.2). */
export const fitUV = (face: Face, el: ModelElement): UVRect => defaultUV(face, el.from, el.to);

/**
 * Box-unwrap an element onto a sheet: the classic cross at texel origin (u,v) —
 *
 *          u    u+d    u+d+w   u+d+2w  u+2d+w  u+2d+2w
 *   v          ┌─up──┬─down─┐
 *   v+d   ┌────┼─────┼──────┼──────┐
 *         │east│north│ west │south │
 *   v+d+h └────┴─────┴──────┴──────┘
 *
 * Face sizes come from the element's dimensions in model units (1 unit = 1 texel on a
 * 16×16); the returned rects are converted to 0..16 units over the given sheet size.
 * Callers apply rects only to faces the element actually has.
 */
export function boxUV(
  el: ModelElement,
  sheetW: number,
  sheetH: number,
  u = 0,
  v = 0,
): Record<Face, UVRect> {
  const w = Math.abs(el.to.x - el.from.x);
  const h = Math.abs(el.to.y - el.from.y);
  const d = Math.abs(el.to.z - el.from.z);
  const X = (t: number) => (t * 16) / sheetW;
  const Y = (t: number) => (t * 16) / sheetH;
  const rect = (x: number, y: number, rw: number, rh: number): UVRect => [
    X(x),
    Y(y),
    X(x + rw),
    Y(y + rh),
  ];
  return {
    up: rect(u + d, v, w, d),
    down: rect(u + d + w, v, w, d),
    east: rect(u, v + d, d, h),
    north: rect(u + d, v + d, w, h),
    west: rect(u + d + w, v + d, d, h),
    south: rect(u + d + w + d, v + d, w, h),
  };
}

/** A uv rect in texels of a w×h sheet — possibly negative-sized when mirrored. */
export function uvTexelRect(
  uv: UVRect,
  texW: number,
  texH: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: (uv[0] * texW) / 16,
    y: (uv[1] * texH) / 16,
    w: ((uv[2] - uv[0]) * texW) / 16,
    h: ((uv[3] - uv[1]) * texH) / 16,
  };
}
