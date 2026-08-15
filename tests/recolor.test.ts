import { describe, it, expect } from 'vitest';
import { applyReplace, tolerancePctToThreshold } from '../src/core/recolor/replace';
import { applyTint } from '../src/core/recolor/tint';
import { hexToRgb, rgbToHsl } from '../src/core/color/convert';
import { emptyPixels } from '../src/core/raster/pixels';

function buf(colors: [number, number, number, number][]) {
  const px = emptyPixels(colors.length, 1);
  colors.forEach((c, i) => px.set(c, i * 4));
  return px;
}

const px4 = (b: Uint8ClampedArray, i: number) => [
  b[i * 4],
  b[i * 4 + 1],
  b[i * 4 + 2],
  b[i * 4 + 3],
];

describe('applyReplace', () => {
  it('replaces exactly the matching colours at tolerance 0', () => {
    const before = buf([
      [34, 177, 76, 255], // grass green
      [35, 177, 76, 255], // one off
      [0, 0, 255, 255],
    ]);
    const after = emptyPixels(3, 1);
    applyReplace(before, after, {
      targets: [{ r: 34, g: 177, b: 76 }],
      tolerance: 0,
      result: { r: 120, g: 80, b: 40 },
    });
    expect(px4(after, 0)).toEqual([120, 80, 40, 255]);
    expect(px4(after, 1)).toEqual([35, 177, 76, 255]); // untouched
    expect(px4(after, 2)).toEqual([0, 0, 255, 255]);
  });

  it('catches the near-miss at 1% tolerance', () => {
    const before = buf([[35, 177, 76, 255]]);
    const after = emptyPixels(1, 1);
    applyReplace(before, after, {
      targets: [{ r: 34, g: 177, b: 76 }],
      tolerance: tolerancePctToThreshold(1),
      result: { r: 1, g: 2, b: 3 },
      blend: 'flat',
    });
    expect(px4(after, 0)).toEqual([1, 2, 3, 255]);
  });

  it('a near-miss is recoloured but not flattened onto the result by default', () => {
    const before = buf([[35, 177, 76, 255]]);
    const after = emptyPixels(1, 1);
    applyReplace(before, after, {
      targets: [{ r: 34, g: 177, b: 76 }],
      tolerance: tolerancePctToThreshold(1),
      result: { r: 1, g: 2, b: 3 },
    });
    const out = px4(after, 0);
    expect(out).not.toEqual([35, 177, 76, 255]); // it WAS recoloured
    expect(out).not.toEqual([1, 2, 3, 255]); // …but it kept its distance from the target
    // Still within a couple of steps of the result, as the input was of the target.
    for (let c = 0; c < 3; c++) expect(Math.abs(out[c] - [1, 2, 3][c])).toBeLessThanOrEqual(2);
  });

  it('handles multiple targets', () => {
    const before = buf([
      [10, 10, 10, 255],
      [20, 20, 20, 255],
      [30, 30, 30, 255],
    ]);
    const after = emptyPixels(3, 1);
    applyReplace(before, after, {
      targets: [
        { r: 10, g: 10, b: 10 },
        { r: 30, g: 30, b: 30 },
      ],
      tolerance: 0,
      result: { r: 200, g: 0, b: 0 },
    });
    expect(px4(after, 0)).toEqual([200, 0, 0, 255]);
    expect(px4(after, 1)).toEqual([20, 20, 20, 255]);
    expect(px4(after, 2)).toEqual([200, 0, 0, 255]);
  });

  it('matches regardless of alpha and preserves it exactly', () => {
    const before = buf([
      [255, 0, 0, 128],
      [255, 0, 0, 3],
      [255, 0, 0, 0], // fully transparent: never rewritten
    ]);
    const after = emptyPixels(3, 1);
    applyReplace(before, after, {
      targets: [{ r: 255, g: 0, b: 0 }],
      tolerance: 0,
      result: { r: 0, g: 255, b: 0 },
    });
    expect(px4(after, 0)).toEqual([0, 255, 0, 128]);
    expect(px4(after, 1)).toEqual([0, 255, 0, 3]);
    expect(px4(after, 2)).toEqual([255, 0, 0, 0]);
  });

  it('with no targets is the identity', () => {
    const before = buf([[7, 8, 9, 255]]);
    const after = emptyPixels(1, 1);
    applyReplace(before, after, { targets: [], tolerance: 50, result: { r: 0, g: 0, b: 0 } });
    expect(px4(after, 0)).toEqual([7, 8, 9, 255]);
  });
});

describe('replace keeps similar colours similar (owner request 2026-08-11)', () => {
  const DARK_GREEN = hexToRgb('#1F5C1F');
  const VERY_DARK_GREEN = hexToRgb('#0F2E0F');
  const DARK_PURPLE = hexToRgb('#5C1F5C');

  /** The owner's example: two shades of green, the lighter one aimed at a dark purple. */
  const run = (blend?: 'relative' | 'flat') => {
    const before = buf([
      [DARK_GREEN.r, DARK_GREEN.g, DARK_GREEN.b, 255],
      [VERY_DARK_GREEN.r, VERY_DARK_GREEN.g, VERY_DARK_GREEN.b, 255],
    ]);
    const after = emptyPixels(2, 1);
    applyReplace(before, after, {
      targets: [DARK_GREEN],
      tolerance: tolerancePctToThreshold(20),
      result: DARK_PURPLE,
      blend,
    });
    return {
      after,
      hsl: (i: number) => rgbToHsl(after[i * 4], after[i * 4 + 1], after[i * 4 + 2]),
    };
  };

  it('the dark green becomes exactly the dark purple asked for', () => {
    expect(px4(run().after, 0)).toEqual([DARK_PURPLE.r, DARK_PURPLE.g, DARK_PURPLE.b, 255]);
  });

  it('the very dark green becomes a VERY dark purple, not the same purple', () => {
    const { after, hsl } = run();
    const [purpleH, , purpleL] = hsl(0);
    const [h, s, l] = hsl(1);
    // Same hue family as the purple it was pulled toward…
    expect(Math.abs(h - purpleH)).toBeLessThan(2);
    expect(s).toBeGreaterThan(0.2); // still a colour, not a grey
    // …but darker than it, and by the amount it was darker than the green.
    expect(l).toBeLessThan(purpleL);
    const before = rgbToHsl(VERY_DARK_GREEN.r, VERY_DARK_GREEN.g, VERY_DARK_GREEN.b)[2];
    const target = rgbToHsl(DARK_GREEN.r, DARK_GREEN.g, DARK_GREEN.b)[2];
    expect(Math.abs(purpleL - l - (target - before))).toBeLessThan(0.02);
    expect(px4(after, 1)).not.toEqual(px4(after, 0));
  });

  it('flat is still available and flattens both onto the result', () => {
    const { after } = run('flat');
    expect(px4(after, 0)).toEqual([DARK_PURPLE.r, DARK_PURPLE.g, DARK_PURPLE.b, 255]);
    expect(px4(after, 1)).toEqual([DARK_PURPLE.r, DARK_PURPLE.g, DARK_PURPLE.b, 255]);
  });

  it('order survives: a ramp stays a ramp, never collapsing to one colour', () => {
    const shades: [number, number, number, number][] = [
      [15, 46, 15, 255],
      [23, 69, 23, 255],
      [31, 92, 31, 255],
      [39, 115, 39, 255],
      [47, 138, 47, 255],
    ];
    const before = buf(shades);
    const after = emptyPixels(shades.length, 1);
    applyReplace(before, after, {
      targets: [{ r: 31, g: 92, b: 31 }],
      tolerance: tolerancePctToThreshold(25),
      result: hexToRgb('#5C1F5C'),
    });
    const ls = shades.map((_, i) => rgbToHsl(after[i * 4], after[i * 4 + 1], after[i * 4 + 2])[2]);
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1]);
    expect(new Set(ls).size).toBe(shades.length); // five shades in, five shades out
  });

  it('at tolerance 0 relative and flat agree — only the target is hit', () => {
    const before = buf([[31, 92, 31, 255]]);
    const rel = emptyPixels(1, 1);
    const flat = emptyPixels(1, 1);
    const p = {
      targets: [{ r: 31, g: 92, b: 31 }],
      tolerance: 0,
      result: hexToRgb('#5C1F5C'),
    };
    applyReplace(before, rel, p);
    applyReplace(before, flat, { ...p, blend: 'flat' as const });
    expect([...rel]).toEqual([...flat]);
  });

  it('recolours each pixel relative to the target IT matched', () => {
    const before = buf([
      [200, 40, 40, 255], // near target A
      [196, 36, 36, 255], // slightly darker than A
      [40, 40, 200, 255], // near target B
    ]);
    const after = emptyPixels(3, 1);
    applyReplace(before, after, {
      targets: [
        { r: 200, g: 40, b: 40 },
        { r: 40, g: 40, b: 200 },
      ],
      tolerance: tolerancePctToThreshold(5),
      result: hexToRgb('#00FF00'),
    });
    // Both targets land on the result exactly; the off-shade lands near it, not on it.
    expect(px4(after, 0)).toEqual([0, 255, 0, 255]);
    expect(px4(after, 2)).toEqual([0, 255, 0, 255]);
    expect(px4(after, 1)).not.toEqual([0, 255, 0, 255]);
    expect(rgbToHsl(after[4], after[5], after[6])[2]).toBeLessThan(
      rgbToHsl(after[0], after[1], after[2])[2],
    );
  });

  it('never touches a colour outside the tolerance, whatever the blend', () => {
    const before = buf([[10, 200, 10, 255]]);
    const after = emptyPixels(1, 1);
    applyReplace(before, after, {
      targets: [{ r: 200, g: 10, b: 10 }],
      tolerance: tolerancePctToThreshold(10),
      result: { r: 0, g: 0, b: 0 },
    });
    expect(px4(after, 0)).toEqual([10, 200, 10, 255]);
  });

  it('a grey pixel pulled toward a colour takes the result’s hue, not a rotated non-hue', () => {
    const before = buf([
      [120, 120, 120, 255], // the target: grey
      [128, 128, 128, 255], // a slightly lighter grey inside the tolerance
    ]);
    const after = emptyPixels(2, 1);
    applyReplace(before, after, {
      targets: [{ r: 120, g: 120, b: 120 }],
      tolerance: tolerancePctToThreshold(5),
      result: hexToRgb('#3FA7D6'),
    });
    const [th] = rgbToHsl(...(Object.values(hexToRgb('#3FA7D6')) as [number, number, number]));
    const [h, s, l] = rgbToHsl(after[4], after[5], after[6]);
    expect(Math.abs(h - th)).toBeLessThan(2);
    expect(s).toBeGreaterThan(0.3);
    expect(l).toBeGreaterThan(rgbToHsl(after[0], after[1], after[2])[2]);
  });
});

describe('applyTint', () => {
  const ramp = () => {
    const px = emptyPixels(5, 1);
    [0, 64, 128, 192, 255].forEach((v, i) => px.set([v, v, v, 255], i * 4));
    return px;
  };

  it('amount 0 is the identity', () => {
    const before = ramp();
    const after = emptyPixels(5, 1);
    applyTint(before, after, { result: hexToRgb('#3FA7D6'), amount: 0 });
    expect([...after]).toEqual([...before]);
  });

  it('amount 1 keeps every pixel’s lightness', () => {
    const before = ramp();
    const after = emptyPixels(5, 1);
    applyTint(before, after, { result: hexToRgb('#3FA7D6'), amount: 1 });
    for (let i = 0; i < 5; i++) {
      const l0 = rgbToHsl(before[i * 4], before[i * 4 + 1], before[i * 4 + 2])[2];
      const l1 = rgbToHsl(after[i * 4], after[i * 4 + 1], after[i * 4 + 2])[2];
      expect(Math.abs(l1 - l0)).toBeLessThanOrEqual(2 / 255);
    }
  });

  it('amount 1 adopts the target hue and saturation on mid tones', () => {
    const before = buf([[128, 128, 128, 255]]);
    const after = emptyPixels(1, 1);
    const target = hexToRgb('#3FA7D6');
    applyTint(before, after, { result: target, amount: 1 });
    const [th, ts] = rgbToHsl(target.r, target.g, target.b);
    const [h, s] = rgbToHsl(after[0], after[1], after[2]);
    expect(Math.abs(h - th)).toBeLessThan(1);
    expect(Math.abs(s - ts)).toBeLessThan(0.05);
  });

  it('a grey target desaturates while keeping lightness', () => {
    const before = buf([[200, 40, 40, 255]]);
    const after = emptyPixels(1, 1);
    applyTint(before, after, { result: { r: 128, g: 128, b: 128 }, amount: 1 });
    const [, s] = rgbToHsl(after[0], after[1], after[2]);
    expect(s).toBeLessThan(0.02);
  });

  it('amount 0.5 lands between source and full tint', () => {
    const before = buf([[128, 128, 128, 255]]);
    const half = emptyPixels(1, 1);
    const full = emptyPixels(1, 1);
    const target = hexToRgb('#3FA7D6');
    applyTint(before, half, { result: target, amount: 0.5 });
    applyTint(before, full, { result: target, amount: 1 });
    expect(half[2]).toBeGreaterThan(before[2]);
    expect(half[2]).toBeLessThan(full[2]);
  });

  it('leaves transparent pixels byte-identical', () => {
    const before = buf([[10, 20, 30, 0]]);
    const after = emptyPixels(1, 1);
    applyTint(before, after, { result: { r: 255, g: 0, b: 0 }, amount: 1 });
    expect(px4(after, 0)).toEqual([10, 20, 30, 0]);
  });
});
