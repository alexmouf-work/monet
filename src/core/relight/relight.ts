/**
 * Relight — docs/05 §7. Recolour's cousin: it never touches hue, only how bright a pixel is.
 *
 * "Brightness" is genuinely ambiguous, so the measure is a choice:
 * - `lightness` (default) is HSL's L. Hue AND saturation survive exactly, and every target is
 *   reachable: a pale blue set to a dark green's L becomes a dark blue of the same hue.
 * - `luma` is Rec.709 perceived brightness. Truer to the eye when comparing different hues,
 *   but not always reachable — pure blue's luma tops out at 0.07, so matching a mid green
 *   means blending toward white (and losing saturation). It clamps rather than lying.
 *
 * The map is a whole-image curve, which is the point: anchoring it on one pixel pulls every
 * other pixel along the same curve, so the image stays coherent instead of one colour jumping.
 */
import type { Rgb } from '../model/types';
import { hslToRgb, rgbToHsl } from '../color/convert';

export type Measure = 'lightness' | 'luma';

/** How a from → to pair becomes a curve over the whole 0..1 brightness range. */
export type Mapping =
  /** l^γ through the anchor: ends stay pinned at 0 and 1, nothing clips. */
  | 'curve'
  /** every pixel moves by the same amount: local contrast is preserved exactly, ends clip. */
  | 'shift'
  /** every pixel scales by the same ratio: keeps proportions, the top end clips. */
  | 'scale';

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp255 = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

/** Rec.709 luma of sRGB values, 0..1. */
export const luma = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function brightnessOf(r: number, g: number, b: number, measure: Measure): number {
  return measure === 'luma' ? luma(r, g, b) : rgbToHsl(r, g, b)[2];
}

/**
 * The pixel at a new brightness, hue kept. For `lightness` this is exact. For `luma`,
 * darkening scales the channels (hue-preserving) and brightening blends toward white, which
 * is the only way to raise a saturated colour's luma at all.
 */
export function withBrightness(
  r: number,
  g: number,
  b: number,
  target: number,
  measure: Measure,
): [number, number, number] {
  const t = clamp01(target);
  if (measure === 'lightness') {
    const [h, s] = rgbToHsl(r, g, b);
    return hslToRgb(h, s, t);
  }
  const y = luma(r, g, b);
  if (t <= y) {
    const k = y === 0 ? 0 : t / y;
    return [clamp255(r * k), clamp255(g * k), clamp255(b * k)];
  }
  const k = y >= 1 ? 0 : (t - y) / (1 - y);
  return [clamp255(r + (255 - r) * k), clamp255(g + (255 - g) * k), clamp255(b + (255 - b) * k)];
}

/**
 * A monotone map over 0..1 sending `from` to `to`. Every mapping agrees at the anchor and
 * differs in what it does to the rest of the image — which is the whole choice on offer.
 */
export function matchMap(from: number, to: number, mapping: Mapping): (l: number) => number {
  const a = clamp01(from);
  const b = clamp01(to);
  if (mapping === 'shift') {
    const d = b - a;
    return (l) => clamp01(l + d);
  }
  if (mapping === 'scale') {
    const k = a === 0 ? 1 : b / a;
    return (l) => clamp01(l * k);
  }
  // Gamma through the anchor. Degenerate anchors (0 or 1) have no exponent that moves them,
  // so fall back to the two-segment line, which can.
  if (a <= 0 || a >= 1 || b <= 0 || b >= 1) {
    return (l) => {
      const x = clamp01(l);
      if (x <= a) return a === 0 ? b : (x / a) * b;
      return a === 1 ? b : b + ((x - a) / (1 - a)) * (1 - b);
    };
  }
  const g = Math.log(b) / Math.log(a);
  return (l) => clamp01(Math.pow(clamp01(l), g));
}

/**
 * Manual controls, both −1..1: brightness shifts every pixel, contrast pivots about mid-grey.
 * Contrast uses (1+c)/(1−c) so +c and −c are reciprocal factors — nudging it up and back down
 * by the same amount returns where you started.
 */
export function adjustMap(brightness: number, contrast: number): (l: number) => number {
  const c = Math.max(-0.98, Math.min(0.98, contrast));
  const k = (1 + c) / (1 - c);
  const shift = Math.max(-1, Math.min(1, brightness));
  return (l) => clamp01((clamp01(l) - 0.5) * k + 0.5 + shift);
}

export interface RelightParams {
  measure: Measure;
  /** Brightness in, brightness out — both 0..1. */
  map: (l: number) => number;
  /** 0–1 blend between the original pixel and the relit one. */
  amount: number;
  /**
   * Restrict the effect to colours near these, like Recolour's replace tolerance. Absent =
   * the whole image, which is the default: relighting one colour alone breaks the shading.
   */
  limit?: { targets: Rgb[]; tolerance: number };
}

const near = (before: Uint8ClampedArray, i: number, targets: Rgb[], tolerance: number): boolean => {
  for (const t of targets) {
    if (
      Math.max(
        Math.abs(before[i] - t.r),
        Math.abs(before[i + 1] - t.g),
        Math.abs(before[i + 2] - t.b),
      ) <= tolerance
    ) {
      return true;
    }
  }
  return false;
};

export function applyRelight(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  p: RelightParams,
): void {
  const amount = clamp01(p.amount);
  const limited = p.limit && p.limit.targets.length > 0 ? p.limit : null;
  for (let i = 0; i < before.length; i += 4) {
    const a = before[i + 3];
    after[i + 3] = a;
    const skip =
      a === 0 || amount === 0 || (limited && !near(before, i, limited.targets, limited.tolerance));
    if (skip) {
      after[i] = before[i];
      after[i + 1] = before[i + 1];
      after[i + 2] = before[i + 2];
      continue;
    }
    const l = brightnessOf(before[i], before[i + 1], before[i + 2], p.measure);
    const [r, g, b] = withBrightness(before[i], before[i + 1], before[i + 2], p.map(l), p.measure);
    after[i] = clamp255(before[i] + (r - before[i]) * amount);
    after[i + 1] = clamp255(before[i + 1] + (g - before[i + 1]) * amount);
    after[i + 2] = clamp255(before[i + 2] + (b - before[i + 2]) * amount);
  }
}
