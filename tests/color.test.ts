import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  parseHexA,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
} from '../src/core/color/convert';

describe('hex', () => {
  it('parses long, short and alpha forms', () => {
    expect(hexToRgb('#FF8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHexA('#FF000080')).toEqual({ hex: '#FF0000', alpha: 128 / 255 });
    expect(parseHexA('3FA7D6')).toEqual({ hex: '#3FA7D6', alpha: 1 });
    expect(parseHexA('nope')).toBeNull();
    expect(parseHexA('#12345')).toBeNull();
  });

  it('rgbToHex round-trips', () => {
    expect(rgbToHex(63, 167, 214)).toBe('#3FA7D6');
    expect(hexToRgb(rgbToHex(1, 2, 3))).toEqual({ r: 1, g: 2, b: 3 });
  });
});

describe('hsl', () => {
  it('matches known fixtures', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 1, 0.5]);
    expect(rgbToHsl(0, 0, 0)).toEqual([0, 0, 0]);
    expect(rgbToHsl(255, 255, 255)).toEqual([0, 0, 1]);
    const [h, s, l] = rgbToHsl(128, 128, 128);
    expect([h, s]).toEqual([0, 0]);
    expect(l).toBeCloseTo(0.502, 3);
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
  });

  it('round-trips every 8th rgb value within 1/255', () => {
    for (let r = 0; r < 256; r += 8)
      for (let g = 0; g < 256; g += 8)
        for (let b = 0; b < 256; b += 8) {
          const [h, s, l] = rgbToHsl(r, g, b);
          const [r2, g2, b2] = hslToRgb(h, s, l);
          expect(Math.abs(r2 - r)).toBeLessThanOrEqual(1);
          expect(Math.abs(g2 - g)).toBeLessThanOrEqual(1);
          expect(Math.abs(b2 - b)).toBeLessThanOrEqual(1);
        }
  });
});

describe('hsv', () => {
  it('matches fixtures and round-trips', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual([0, 1, 1]);
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
    expect(hsvToRgb(60, 1, 1)).toEqual([255, 255, 0]);
    for (let r = 0; r < 256; r += 16)
      for (let g = 0; g < 256; g += 16)
        for (let b = 0; b < 256; b += 16) {
          const [h, s, v] = rgbToHsv(r, g, b);
          const [r2, g2, b2] = hsvToRgb(h, s, v);
          expect(Math.abs(r2 - r) + Math.abs(g2 - g) + Math.abs(b2 - b)).toBeLessThanOrEqual(3);
        }
  });
});
