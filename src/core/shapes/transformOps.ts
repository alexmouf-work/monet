/**
 * Object transform operations — docs/03 §2.2. Pure maths over a Transform: scaling from any
 * of eight handles with the opposite handle pinned, rotation about the centre, and the
 * flip toggles that make a drag-through mirror the object.
 */
import type { Transform, Vec2 } from '../model/types';
import { normalizeAngle } from './geometry';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Handle positions in unit space. */
export const HANDLE_LOCAL: Record<HandleId, Vec2> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

export const MIN_SIZE = 1;

const rot = (v: Vec2, deg: number): Vec2 => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

/**
 * Scale `t` by dragging `handle` to `pointer` (doc space). The opposite handle stays put;
 * edge handles move one axis only; `keepAspect` scales both by the same factor.
 */
export function scaleTransform(
  t: Transform,
  handle: HandleId,
  pointer: Vec2,
  keepAspect = false,
): Transform {
  const h = HANDLE_LOCAL[handle];
  const movesX = h.x !== 0.5;
  const movesY = h.y !== 0.5;

  // Work in the object's unrotated frame, centred on the object.
  const q = rot({ x: pointer.x - t.cx, y: pointer.y - t.cy }, -t.rotation);
  const fixed = { x: (1 - h.x - 0.5) * t.w, y: (1 - h.y - 0.5) * t.h };

  let w = movesX ? Math.abs(q.x - fixed.x) : t.w;
  let hh = movesY ? Math.abs(q.y - fixed.y) : t.h;

  if (keepAspect && movesX && movesY) {
    const k = Math.max(w / Math.max(t.w, 1e-6), hh / Math.max(t.h, 1e-6));
    w = t.w * k;
    hh = t.h * k;
  }
  w = Math.max(MIN_SIZE, w);
  hh = Math.max(MIN_SIZE, hh);

  const expectedX = h.x > 0.5 ? 1 : -1;
  const expectedY = h.y > 0.5 ? 1 : -1;
  const dirX = movesX ? Math.sign(q.x - fixed.x) || expectedX : expectedX;
  const dirY = movesY ? Math.sign(q.y - fixed.y) || expectedY : expectedY;

  const offset = {
    x: movesX ? fixed.x + (dirX * w) / 2 : 0,
    y: movesY ? fixed.y + (dirY * hh) / 2 : 0,
  };
  const world = rot(offset, t.rotation);

  return {
    ...t,
    w,
    h: hh,
    cx: t.cx + world.x,
    cy: t.cy + world.y,
    flipX: movesX && dirX !== expectedX ? !t.flipX : t.flipX,
    flipY: movesY && dirY !== expectedY ? !t.flipY : t.flipY,
  };
}

/** Rotate so the rotation handle (which sits above the top edge) points at `pointer`. */
export function rotateTransform(t: Transform, pointer: Vec2, snap = false): Transform {
  const deg = (Math.atan2(pointer.y - t.cy, pointer.x - t.cx) * 180) / Math.PI + 90;
  const snapped = snap ? Math.round(deg / 15) * 15 : deg;
  return { ...t, rotation: normalizeAngle(snapped) };
}

export function moveTransform(t: Transform, dx: number, dy: number): Transform {
  return { ...t, cx: t.cx + dx, cy: t.cy + dy };
}

/** Cursor direction for a handle, accounting for the object's rotation (docs/09 §8). */
export function handleCursor(handle: HandleId, rotation: number): string {
  const base: Record<HandleId, number> = {
    n: 0,
    ne: 45,
    e: 90,
    se: 135,
    s: 180,
    sw: 225,
    w: 270,
    nw: 315,
  };
  const a = normalizeAngle(base[handle] + rotation);
  const names = [
    'ns-resize',
    'nesw-resize',
    'ew-resize',
    'nwse-resize',
    'ns-resize',
    'nesw-resize',
    'ew-resize',
    'nwse-resize',
  ];
  return names[Math.round(a / 45) % 8];
}
