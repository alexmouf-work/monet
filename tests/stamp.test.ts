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
  it('stamps the pixel the cursor is inside, anywhere within it', () => {
    // The whole of pixel (5,7) — including its right and bottom halves, which used to round
    // up and paint (6,8) instead: one right and one below the pixel under the cursor.
    for (const [x, y] of [
      [5, 7],
      [5.2, 7.2],
      [5.5, 7.5],
      [5.99, 7.99],
    ]) {
      expect(tipOrigin({ x, y }, 1)).toEqual({ x: 5, y: 7 });
    }
    expect(tipOrigin({ x: -0.4, y: -0.1 }, 1)).toEqual({ x: -1, y: -1 }); // left of the canvas
  });

  it('centres odd tips on that pixel and puts even tips top-left of it', () => {
    expect(tipOrigin({ x: 5.9, y: 5.1 }, 3)).toEqual({ x: 4, y: 4 }); // 5±1
    expect(tipOrigin({ x: 5.9, y: 5.1 }, 5)).toEqual({ x: 3, y: 3 }); // 5±2
    expect(tipOrigin({ x: 5.9, y: 5.1 }, 2)).toEqual({ x: 5, y: 5 }); // covers 5..6
    expect(tipOrigin({ x: 5.9, y: 5.1 }, 4)).toEqual({ x: 4, y: 4 }); // covers 4..7
  });

  it('bresenham walks from the pixel under the start to the pixel under the end', () => {
    const pts: [number, number][] = [];
    bresenham(2.9, 2.9, 5.1, 2.1, (x, y) => pts.push([x, y]));
    expect(pts[0]).toEqual([2, 2]); // not [3, 3]
    expect(pts[pts.length - 1]).toEqual([5, 2]);
  });

  it('spacedPoints ends exactly on the target', () => {
    const pts = spacedPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
    expect(pts).toHaveLength(5);
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 0 });
  });
});
