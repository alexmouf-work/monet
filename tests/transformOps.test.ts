import { describe, it, expect } from 'vitest';
import {
  handleCursor,
  moveTransform,
  rotateTransform,
  scaleTransform,
} from '../src/core/shapes/transformOps';
import { localFromWorld, worldFromLocal, makeTransform } from '../src/core/shapes/geometry';
import type { Transform } from '../src/core/model/types';

const box = (): Transform => makeTransform(5, 5, 10, 10); // spans (0,0)–(10,10)

const corner = (t: Transform, u: number, v: number) => worldFromLocal(t, { x: u, y: v });

describe('scaleTransform', () => {
  it('keeps the opposite corner fixed', () => {
    const t = scaleTransform(box(), 'se', { x: 20, y: 20 });
    expect(t.w).toBeCloseTo(20);
    expect(t.h).toBeCloseTo(20);
    const nw = corner(t, 0, 0);
    expect(nw.x).toBeCloseTo(0);
    expect(nw.y).toBeCloseTo(0);
  });

  it('edge handles move a single axis', () => {
    const t = scaleTransform(box(), 'e', { x: 30, y: 999 });
    expect(t.w).toBeCloseTo(30);
    expect(t.h).toBeCloseTo(10);
    expect(corner(t, 0, 0).x).toBeCloseTo(0);
  });

  it('keepAspect scales both axes by one factor', () => {
    const t = scaleTransform(box(), 'se', { x: 30, y: 12 }, true);
    expect(t.w / t.h).toBeCloseTo(1);
    expect(t.w).toBeCloseTo(30);
  });

  it('clamps to a minimum of 1px', () => {
    const t = scaleTransform(box(), 'se', { x: 0, y: 0 });
    expect(t.w).toBeGreaterThanOrEqual(1);
    expect(t.h).toBeGreaterThanOrEqual(1);
  });

  it('drag-through toggles the flip flags', () => {
    const t = scaleTransform(box(), 'e', { x: -10, y: 5 });
    expect(t.flipX).toBe(true);
    expect(t.flipY).toBe(false);
    expect(t.w).toBeCloseTo(10); // |−10 − 0| measured from the pinned left edge
  });

  it('honours rotation: the opposite corner stays pinned for a rotated object', () => {
    const t0: Transform = { ...box(), rotation: 30 };
    const pinnedBefore = corner(t0, 0, 0);
    const t1 = scaleTransform(t0, 'se', { x: 25, y: 18 });
    const pinnedAfter = corner(t1, 0, 0);
    expect(pinnedAfter.x).toBeCloseTo(pinnedBefore.x, 6);
    expect(pinnedAfter.y).toBeCloseTo(pinnedBefore.y, 6);
  });
});

describe('rotateTransform', () => {
  it('points the top edge at the pointer', () => {
    // Pointer directly above the centre ⇒ rotation 0.
    expect(rotateTransform(box(), { x: 5, y: -20 }).rotation).toBeCloseTo(0);
    // Pointer to the right ⇒ 90°.
    expect(rotateTransform(box(), { x: 40, y: 5 }).rotation).toBeCloseTo(90);
    // Below ⇒ 180°.
    expect(rotateTransform(box(), { x: 5, y: 40 }).rotation).toBeCloseTo(180);
  });

  it('snaps to 15° steps with shift', () => {
    const t = rotateTransform(box(), { x: 20, y: -19 }, true);
    expect(t.rotation % 15).toBeCloseTo(0);
  });

  it('normalises into 0–360', () => {
    const t = rotateTransform(box(), { x: -20, y: 5 }, false);
    expect(t.rotation).toBeGreaterThanOrEqual(0);
    expect(t.rotation).toBeLessThan(360);
  });
});

describe('move and coordinate round-trip', () => {
  it('moveTransform shifts the centre only', () => {
    const t = moveTransform(box(), 3, -4);
    expect([t.cx, t.cy, t.w, t.h]).toEqual([8, 1, 10, 10]);
  });

  it('worldFromLocal and localFromWorld invert each other under rotation and flips', () => {
    const t: Transform = { cx: 12, cy: 7, w: 8, h: 20, rotation: 47, flipX: true, flipY: true };
    for (const p of [
      { x: 0, y: 0 },
      { x: 1, y: 0.25 },
      { x: 0.5, y: 1 },
    ]) {
      const back = localFromWorld(t, worldFromLocal(t, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe('handleCursor', () => {
  it('rotates with the object', () => {
    expect(handleCursor('n', 0)).toBe('ns-resize');
    expect(handleCursor('n', 90)).toBe('ew-resize');
    expect(handleCursor('ne', 0)).toBe('nesw-resize');
    expect(handleCursor('ne', 45)).toBe('ew-resize');
  });
});
