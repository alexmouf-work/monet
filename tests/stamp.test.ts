import { describe, it, expect } from 'vitest';
import {
  bresenham,
  makeMarkerTip,
  makeTip,
  spacedPoints,
  tipOrigin,
} from '../src/core/raster/stamp';

describe('makeTip', () => {
  it('square tips are fully covered', () => {
    const t = makeTip(4, 'square');
    expect([...t.a].every((v) => v === 1)).toBe(true);
  });

  it('circle tips are hard-edged discs (only 0 or 1)', () => {
    const t = makeTip(8, 'circle');
    expect([...t.a].every((v) => v === 0 || v === 1)).toBe(true);
    // Centre covered, corners not.
    expect(t.a[4 * 8 + 4]).toBe(1);
    expect(t.a[0]).toBe(0);
  });

  it('sizes 1 and 2 degenerate to squares', () => {
    for (const size of [1, 2]) {
      expect([...makeTip(size, 'circle').a]).toEqual([...makeTip(size, 'square').a]);
    }
  });
});

describe('makeMarkerTip', () => {
  it('falls monotonically to zero along a radius', () => {
    const size = 15; // odd, so the centre lands exactly on a pixel
    const t = makeMarkerTip(size, 'circle');
    const mid = Math.floor(size / 2);
    let prev = Infinity;
    for (let x = mid; x < size; x++) {
      const v = t.a[mid * size + x];
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    expect(t.a[mid * size + mid]).toBe(1);
    expect(t.a[mid * size + size - 1]).toBeLessThan(0.06);
  });

  it('square markers have square isolines (corner equals edge at same Chebyshev distance)', () => {
    const size = 9;
    const t = makeMarkerTip(size, 'square');
    const c = 4;
    const d = 3;
    expect(t.a[(c - d) * size + (c - d)]).toBeCloseTo(t.a[c * size + (c - d)], 10);
  });
});

describe('bresenham', () => {
  it('produces a gap-free 1px line', () => {
    const pts: [number, number][] = [];
    bresenham(0, 0, 5, 3, (x, y) => pts.push([x, y]));
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([5, 3]);
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
      const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
      expect(Math.max(dx, dy)).toBe(1);
    }
  });

  it('handles a single point and reversed directions', () => {
    const one: unknown[] = [];
    bresenham(2, 2, 2, 2, () => one.push(1));
    expect(one).toHaveLength(1);
    const back: [number, number][] = [];
    bresenham(4, 4, 0, 0, (x, y) => back.push([x, y]));
    expect(back[back.length - 1]).toEqual([0, 0]);
  });
});

describe('placement and spacing', () => {
  it('odd tips centre on the hovered pixel', () => {
    expect(tipOrigin({ x: 5.2, y: 7.8 }, 1)).toEqual({ x: 5, y: 8 });
    expect(tipOrigin({ x: 5, y: 5 }, 3)).toEqual({ x: 4, y: 4 });
  });

  it('spacedPoints ends exactly on the target', () => {
    const pts = spacedPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
    expect(pts).toHaveLength(5);
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 0 });
  });
});
