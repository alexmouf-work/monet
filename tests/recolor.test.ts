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
    });
    expect(px4(after, 0)).toEqual([1, 2, 3, 255]);
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
