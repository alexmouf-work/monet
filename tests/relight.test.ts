import { describe, expect, it } from 'vitest';
import {
  adjustMap,
  applyRelight,
  brightnessOf,
  luma,
  matchMap,
  withBrightness,
} from '../src/core/relight/relight';
import { hexToRgb, rgbToHex, rgbToHsl } from '../src/core/color/convert';

const px = (...hexes: string[]): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(hexes.length * 4);
  hexes.forEach((h, i) => {
    const { r, g, b } = hexToRgb(h);
    out.set([r, g, b, 255], i * 4);
  });
  return out;
};
const hexAt = (a: Uint8ClampedArray, i: number) => rgbToHex(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]);
const L = (hex: string) =>
  rgbToHsl(...(Object.values(hexToRgb(hex)) as [number, number, number]))[2];

describe('brightness measures', () => {
  it('lightness keeps hue and saturation exactly', () => {
    const [r, g, b] = withBrightness(0xad, 0xd8, 0xe6, 0.25, 'lightness'); // pale blue
    const [h, s, l] = rgbToHsl(r, g, b);
    const [h0, s0] = rgbToHsl(0xad, 0xd8, 0xe6);
    // Hue is in DEGREES: 8-bit channels quantise it, so the bound is a fraction of a degree,
    // not toBeCloseTo's decimal places.
    expect(Math.abs(h - h0)).toBeLessThan(1.5);
    expect(Math.abs(s - s0)).toBeLessThan(0.03);
    expect(l).toBeCloseTo(0.25, 2);
  });

  it('luma darkens by scaling (hue kept) and brightens toward white', () => {
    const dark = withBrightness(200, 100, 50, luma(200, 100, 50) / 2, 'luma');
    expect(dark[0] / dark[1]).toBeCloseTo(2, 1); // channel ratios — hue — survive
    const bright = withBrightness(0, 0, 255, 0.6, 'luma');
    expect(luma(...bright)).toBeCloseTo(0.6, 2);
    expect(bright[0]).toBeGreaterThan(0); // pure blue cannot reach 0.6 without whitening
  });

  it('brightnessOf reads the chosen measure', () => {
    expect(brightnessOf(255, 255, 255, 'lightness')).toBe(1);
    expect(brightnessOf(0, 0, 255, 'lightness')).toBeCloseTo(0.5, 3);
    expect(brightnessOf(0, 0, 255, 'luma')).toBeCloseTo(0.0722, 4);
  });
});

describe('match mappings', () => {
  const from = 0.75;
  const to = 0.25;

  it('every mapping hits the anchor exactly', () => {
    for (const m of ['curve', 'shift', 'scale'] as const) {
      expect(matchMap(from, to, m)(from)).toBeCloseTo(to, 6);
    }
  });

  it('curve pins the ends, shift preserves differences, scale preserves ratios', () => {
    const curve = matchMap(from, to, 'curve');
    expect(curve(0)).toBeCloseTo(0, 6);
    expect(curve(1)).toBeCloseTo(1, 6);

    const shift = matchMap(from, to, 'shift');
    expect(shift(0.6) - shift(0.5)).toBeCloseTo(0.1, 6); // contrast untouched

    const scale = matchMap(from, to, 'scale');
    expect(scale(0.5) / scale(0.25)).toBeCloseTo(2, 6);
  });

  it('is monotone, so shading order never inverts', () => {
    for (const m of ['curve', 'shift', 'scale'] as const) {
      const f = matchMap(from, to, m);
      let prev = -1;
      for (let l = 0; l <= 1.0001; l += 0.05) {
        const v = f(l);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('handles anchors at the ends instead of dividing by a log of 0', () => {
    expect(matchMap(0, 0.5, 'curve')(0)).toBeCloseTo(0.5, 6);
    expect(matchMap(1, 0.5, 'curve')(1)).toBeCloseTo(0.5, 6);
    expect(Number.isFinite(matchMap(0, 1, 'scale')(0.5))).toBe(true);
  });
});

describe('the owner’s scenario: pale blue matched to a dark green', () => {
  const paleBlue = '#ADD8E6';
  const darkGreen = '#14532D';

  it('turns the pale blue into a dark blue at the green’s brightness, hue intact', () => {
    const before = px(paleBlue);
    const after = new Uint8ClampedArray(before.length);
    const map = matchMap(L(paleBlue), L(darkGreen), 'curve');
    applyRelight(before, after, { measure: 'lightness', map, amount: 1 });

    const [h, , l] = rgbToHsl(after[0], after[1], after[2]);
    const h0 = rgbToHsl(...(Object.values(hexToRgb(paleBlue)) as [number, number, number]))[0];
    expect(l).toBeCloseTo(L(darkGreen), 2); // same brightness as the dark green
    expect(Math.abs(h - h0)).toBeLessThan(1.5); // still blue (degrees, 8-bit quantised)
    expect(l).toBeLessThan(L(paleBlue)); // and it is now DARK blue
  });

  it('pulls the rest of the image along the same curve', () => {
    // A sprite of four blues: the relit result must stay ordered and all get darker.
    const before = px('#ADD8E6', '#7EC0E4', '#4A90C2', '#1F3F5B');
    const after = new Uint8ClampedArray(before.length);
    const map = matchMap(L('#ADD8E6'), L(darkGreen), 'curve');
    applyRelight(before, after, { measure: 'lightness', map, amount: 1 });

    const ls = [0, 1, 2, 3].map(
      (i) => rgbToHsl(after[i * 4], after[i * 4 + 1], after[i * 4 + 2])[2],
    );
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThan(ls[i - 1]); // order kept
    for (let i = 0; i < 4; i++) {
      expect(ls[i]).toBeLessThan(rgbToHsl(before[i * 4], before[i * 4 + 1], before[i * 4 + 2])[2]);
    }
  });
});

describe('applyRelight', () => {
  it('leaves fully transparent pixels alone, alpha included', () => {
    const before = new Uint8ClampedArray([10, 20, 30, 0, 200, 200, 200, 128]);
    const after = new Uint8ClampedArray(before.length);
    applyRelight(before, after, { measure: 'lightness', map: () => 0, amount: 1 });
    expect([...after.slice(0, 4)]).toEqual([10, 20, 30, 0]);
    expect(after[7]).toBe(128); // partial alpha kept as-is
    expect(after[4]).toBe(0); // …but its colour is relit
  });

  it('amount blends, and 0 is a no-op', () => {
    const before = px('#FFFFFF');
    const half = new Uint8ClampedArray(4);
    const none = new Uint8ClampedArray(4);
    applyRelight(before, half, { measure: 'lightness', map: () => 0, amount: 0.5 });
    applyRelight(before, none, { measure: 'lightness', map: () => 0, amount: 0 });
    expect(half[0]).toBeCloseTo(128, -1);
    expect(hexAt(none, 0)).toBe('#FFFFFF');
  });

  it('an optional limit restricts the effect to colours near the targets', () => {
    const before = px('#ADD8E6', '#E6ADD8'); // a blue and a pink
    const after = new Uint8ClampedArray(before.length);
    applyRelight(before, after, {
      measure: 'lightness',
      map: () => 0.2,
      amount: 1,
      limit: { targets: [hexToRgb('#ADD8E6')], tolerance: 10 },
    });
    expect(rgbToHsl(after[0], after[1], after[2])[2]).toBeCloseTo(0.2, 2);
    expect(hexAt(after, 1)).toBe('#E6ADD8'); // untouched
  });
});

describe('adjustMap', () => {
  it('brightness shifts and clamps', () => {
    expect(adjustMap(0.2, 0)(0.5)).toBeCloseTo(0.7, 6);
    expect(adjustMap(0.9, 0)(0.5)).toBe(1);
    expect(adjustMap(-0.9, 0)(0.5)).toBe(0);
  });

  it('contrast pivots about mid-grey and is reciprocal until it clips', () => {
    expect(adjustMap(0, 0.5)(0.5)).toBeCloseTo(0.5, 6); // pivot fixed
    const up = adjustMap(0, 0.5);
    const down = adjustMap(0, -0.5);
    expect(down(up(0.55))).toBeCloseTo(0.55, 6); // +c then −c returns…
    expect(up(0.7)).toBeGreaterThan(0.7);
    // …unless the value clipped on the way out: 0.7 → 1.1 → 1, and 1 cannot come back.
    expect(up(0.7)).toBe(1);
    expect(down(up(0.7))).toBeCloseTo(0.6667, 3);
  });
});
