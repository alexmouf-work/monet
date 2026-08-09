/**
 * Mode B — uniform tint — docs/05 §4. Every pixel takes the result colour's hue and
 * saturation and keeps its own lightness, so shading survives; `amount` blends the effect.
 */
import type { Rgb } from '../model/types';
import { hslToRgb, rgbToHsl } from '../color/convert';

export interface TintParams {
  result: Rgb;
  /** 0–1. */
  amount: number;
}

export function applyTint(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  p: TintParams,
): void {
  const [th, ts] = rgbToHsl(p.result.r, p.result.g, p.result.b);
  const k = Math.max(0, Math.min(1, p.amount));
  for (let i = 0; i < before.length; i += 4) {
    const a = before[i + 3];
    if (a === 0) {
      after[i] = before[i];
      after[i + 1] = before[i + 1];
      after[i + 2] = before[i + 2];
      after[i + 3] = a;
      continue;
    }
    const l = rgbToHsl(before[i], before[i + 1], before[i + 2])[2];
    const [tr, tg, tb] = hslToRgb(th, ts, l);
    after[i] = Math.round(before[i] + (tr - before[i]) * k);
    after[i + 1] = Math.round(before[i + 1] + (tg - before[i + 1]) * k);
    after[i + 2] = Math.round(before[i + 2] + (tb - before[i + 2]) * k);
    after[i + 3] = a;
  }
}
