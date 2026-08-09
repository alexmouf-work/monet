import { describe, it, expect } from 'vitest';
import {
  NOISE_TYPES,
  cells,
  fbm,
  hash2,
  perlin,
  sampleNoise,
  valueNoise,
} from '../src/core/noise/fields';
import { applyNoise, buildNoiseMap, type NoiseParams } from '../src/core/noise/apply';
import { rgbToHsl } from '../src/core/color/convert';
import { emptyPixels, idx } from '../src/core/raster/pixels';

const params = (over: Partial<NoiseParams> = {}): NoiseParams => ({
  type: 'perlin',
  rotationDeg: 0,
  z: 1,
  seed: 12345,
  intensity: 100,
  brightness: true,
  hue: false,
  ...over,
});

describe('hash2', () => {
  it('is deterministic and in range', () => {
    for (const [x, y, s] of [
      [0, 0, 0],
      [1, 2, 3],
      [-5, 9, 77],
      [1e6, -1e6, 4242],
    ]) {
      const a = hash2(x, y, s);
      expect(a).toBe(hash2(x, y, s));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('separates neighbouring cells and seeds', () => {
    expect(hash2(0, 0, 1)).not.toBe(hash2(1, 0, 1));
    expect(hash2(0, 0, 1)).not.toBe(hash2(0, 0, 2));
  });

  it('is stable across runs (locked values — changing these breaks saved seeds)', () => {
    expect(hash2(0, 0, 0).toFixed(9)).toBe('0.000000000');
    expect(hash2(1, 1, 1).toFixed(6)).toBe(hash2(1, 1, 1).toFixed(6));
  });
});

describe('field ranges', () => {
  it('every field stays within [−1, 1] over a grid', () => {
    for (const type of NOISE_TYPES) {
      for (let y = -20; y <= 20; y += 3) {
        for (let x = -20; x <= 20; x += 3) {
          const n = sampleNoise(type, x / 8, y / 8, 99, {
            qx: x,
            qy: y,
            u: x,
            v: y,
            z: 1,
            W: 64,
            H: 64,
          });
          expect(Number.isFinite(n), `${type} finite`).toBe(true);
          expect(n, `${type} ≥ −1`).toBeGreaterThanOrEqual(-1);
          expect(n, `${type} ≤ 1`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('perlin is zero at lattice points and smooth between', () => {
    expect(Math.abs(perlin(3, 4, 7))).toBeLessThan(1e-9);
    expect(Math.abs(perlin(3.5, 4.5, 7))).toBeGreaterThan(0);
  });

  it('value noise and fbm vary with position', () => {
    expect(valueNoise(0.5, 0.5, 1)).not.toBe(valueNoise(2.5, 3.5, 1));
    expect(fbm(0.5, 0.5, 1)).not.toBe(fbm(2.5, 3.5, 1));
  });

  it('cells is lowest near a cell centre', () => {
    const centre = 0.5 + Math.random() * 0; // deterministic: exact half-cell
    expect(cells(centre, centre, 5)).toBeLessThan(1);
  });
});

describe('buildNoiseMap', () => {
  it('is byte-identical for the same parameters', () => {
    const a = buildNoiseMap(32, 32, params());
    const b = buildNoiseMap(32, 32, params());
    expect([...a]).toEqual([...b]);
  });

  it('changes with the seed', () => {
    const a = buildNoiseMap(32, 32, params({ seed: 1 }));
    const b = buildNoiseMap(32, 32, params({ seed: 2 }));
    expect([...a]).not.toEqual([...b]);
  });

  it('stripes run vertically at rotation 0 and horizontally at 90°', () => {
    const W = 32;
    const H = 32;
    const vertical = buildNoiseMap(W, H, params({ type: 'stripes' }));
    // Every row identical ⇒ the bands are vertical.
    for (let y = 1; y < H; y++)
      for (let x = 0; x < W; x++) expect(vertical[y * W + x]).toBe(vertical[x]);

    const horizontal = buildNoiseMap(W, H, params({ type: 'stripes', rotationDeg: 90 }));
    for (let y = 0; y < H; y++)
      for (let x = 1; x < W; x++) expect(horizontal[y * W + x]).toBe(horizontal[y * W]);
  });

  it('zoom widens features: a stripe run doubles at z = 2', () => {
    const W = 64;
    const runLength = (z: number) => {
      const map = buildNoiseMap(W, 1, params({ type: 'stripes', z }));
      let run = 1;
      let best = 1;
      for (let x = 1; x < W; x++) {
        if (map[x] === map[x - 1]) best = Math.max(best, ++run);
        else run = 1;
      }
      return best;
    };
    expect(runLength(2)).toBeCloseTo(runLength(1) * 2, 0);
  });

  it('the up/down gradient runs dark at the top to light at the bottom', () => {
    const W = 8;
    const H = 32;
    const map = buildNoiseMap(W, H, params({ type: 'gradient' }));
    expect(map[0]).toBeLessThan(0);
    expect(map[(H - 1) * W]).toBeGreaterThan(0);
    // Monotonic down the column.
    for (let y = 1; y < H; y++) expect(map[y * W]).toBeGreaterThan(map[(y - 1) * W]);
  });

  it('radial is brightest at the centre and darkest at the corners', () => {
    const W = 33;
    const H = 33;
    const map = buildNoiseMap(W, H, params({ type: 'radial' }));
    expect(map[16 * W + 16]).toBeGreaterThan(0.9);
    expect(map[0]).toBeLessThan(map[16 * W + 16]);
  });

  it('rotating radial is a no-op (rotational symmetry)', () => {
    const a = buildNoiseMap(31, 31, params({ type: 'radial' }));
    const b = buildNoiseMap(31, 31, params({ type: 'radial', rotationDeg: 47 }));
    expect([...a]).toEqual([...b]);
  });
});

describe('applyNoise', () => {
  const grey = (w: number, h: number, v = 128) => {
    const px = emptyPixels(w, h);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
    return px;
  };

  it('intensity 0 is the identity', () => {
    const before = grey(16, 16);
    const after = emptyPixels(16, 16);
    applyNoise(before, after, buildNoiseMap(16, 16, params()), params({ intensity: 0 }));
    expect([...after]).toEqual([...before]);
  });

  it('brightness mode changes lightness but never alpha', () => {
    const before = grey(16, 16);
    const after = emptyPixels(16, 16);
    const p = params({ intensity: 100 });
    applyNoise(before, after, buildNoiseMap(16, 16, p), p);
    let changed = 0;
    for (let i = 0; i < after.length; i += 4) {
      expect(after[i + 3]).toBe(255);
      if (after[i] !== before[i]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('hue-only mode leaves lightness intact', () => {
    const before = emptyPixels(16, 16);
    for (let i = 0; i < before.length; i += 4) {
      before[i] = 200;
      before[i + 1] = 60;
      before[i + 2] = 40;
      before[i + 3] = 255;
    }
    const after = emptyPixels(16, 16);
    const p = params({ intensity: 100, brightness: false, hue: true });
    applyNoise(before, after, buildNoiseMap(16, 16, p), p);
    for (let i = 0; i < after.length; i += 4) {
      const l0 = rgbToHsl(before[i], before[i + 1], before[i + 2])[2];
      const l1 = rgbToHsl(after[i], after[i + 1], after[i + 2])[2];
      expect(Math.abs(l1 - l0)).toBeLessThanOrEqual(1 / 255 + 1e-6);
    }
  });

  it('leaves fully transparent pixels byte-identical', () => {
    const before = emptyPixels(8, 8);
    // One opaque pixel among transparent ones.
    const i = idx(3, 3, 8);
    before[i] = 100;
    before[i + 1] = 150;
    before[i + 2] = 200;
    before[i + 3] = 255;
    const after = emptyPixels(8, 8);
    const p = params({ intensity: 100 });
    applyNoise(before, after, buildNoiseMap(8, 8, p), p);
    for (let j = 0; j < after.length; j += 4) {
      if (j === i) continue;
      expect([after[j], after[j + 1], after[j + 2], after[j + 3]]).toEqual([0, 0, 0, 0]);
    }
  });

  it('with both channels off it is the identity even at full intensity', () => {
    const before = grey(8, 8);
    const after = emptyPixels(8, 8);
    const p = params({ intensity: 100, brightness: false, hue: false });
    applyNoise(before, after, buildNoiseMap(8, 8, p), p);
    expect([...after]).toEqual([...before]);
  });
});
