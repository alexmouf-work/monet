/**
 * Mode A — targeted replace — docs/05 §3. Matching ignores alpha and uses the same
 * per-channel Chebyshev tolerance as the bucket, so "does not touch a colour outside the
 * tolerance" holds by construction. Alpha is always preserved.
 *
 * With a tolerance, matched pixels are recoloured **relative to the target they matched**
 * (owner request 2026-08-11): the target lands exactly on the result, and every other matched
 * pixel keeps its distance from it — a dark green and a very dark green become a dark purple
 * and a very dark purple, not two identical purples. `flat` is the old snap-everything-to-one
 * behaviour, kept because "make all of these exactly this colour" is a real, different job.
 */
import type { Rgb } from '../model/types';
import { hslToRgb, rgbToHsl } from '../color/convert';
import { matchMap } from '../relight/relight';

export type ReplaceBlend =
  /** Keep each matched pixel's distance from the target it matched. */
  | 'relative'
  /** Every matched pixel becomes the result colour exactly. */
  | 'flat';

export interface ReplaceParams {
  targets: Rgb[];
  /** 0–255 per-channel threshold. */
  tolerance: number;
  result: Rgb;
  /** Default `relative`. */
  blend?: ReplaceBlend;
}

/** Below this a colour has no meaningful hue — 1/255 of saturation. */
const ACHROMATIC = 1 / 255;

/**
 * The recolouring one target implies: rotate hue by the same amount, and move saturation and
 * lightness by the same amount. Saturation and lightness use the **shift** map rather than
 * `scale`, because matched pixels are by definition *near* the target, and shift is the one
 * that carries a small difference across unchanged — a ratio would multiply it by whatever
 * `result/target` happens to be, which for a near-black target is enormous.
 */
function relativeMap(target: Rgb, result: Rgb) {
  const [th, ts, tl] = rgbToHsl(target.r, target.g, target.b);
  const [rh, rs, rl] = rgbToHsl(result.r, result.g, result.b);
  const sMap = matchMap(ts, rs, 'shift');
  const lMap = matchMap(tl, rl, 'shift');
  // A grey target has no hue to rotate away from, so its result's hue is used outright.
  const dh = ts < ACHROMATIC ? null : rh - th;
  return (r: number, g: number, b: number): [number, number, number] => {
    // The target itself lands on the result EXACTLY, rather than within the ±1 an HSL round
    // trip costs. It is the anchor; everything else is measured from it.
    if (r === target.r && g === target.g && b === target.b) return [result.r, result.g, result.b];
    const [h, s, l] = rgbToHsl(r, g, b);
    // A grey pixel has no hue of its own either: if it gains saturation here, the colour it
    // gains is the result's, not an arbitrary rotation of an undefined hue.
    const hue = dh === null || s < ACHROMATIC ? rh : h + dh;
    return hslToRgb(((hue % 360) + 360) % 360, sMap(s), lMap(l));
  };
}

export function applyReplace(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  p: ReplaceParams,
): void {
  const { targets, tolerance, result } = p;
  const relative = (p.blend ?? 'relative') === 'relative';
  // One map per target, built once: a pixel is recoloured relative to the target it matched.
  const maps = relative ? targets.map((t) => relativeMap(t, result)) : null;

  for (let i = 0; i < before.length; i += 4) {
    const a = before[i + 3];
    let hit = -1;
    if (a !== 0) {
      for (let t = 0; t < targets.length; t++) {
        if (
          Math.max(
            Math.abs(before[i] - targets[t].r),
            Math.abs(before[i + 1] - targets[t].g),
            Math.abs(before[i + 2] - targets[t].b),
          ) <= tolerance
        ) {
          hit = t;
          break;
        }
      }
    }
    if (hit < 0) {
      after[i] = before[i];
      after[i + 1] = before[i + 1];
      after[i + 2] = before[i + 2];
    } else if (maps) {
      const [r, g, b] = maps[hit](before[i], before[i + 1], before[i + 2]);
      after[i] = r;
      after[i + 1] = g;
      after[i + 2] = b;
    } else {
      after[i] = result.r;
      after[i + 1] = result.g;
      after[i + 2] = result.b;
    }
    after[i + 3] = a;
  }
}

export const tolerancePctToThreshold = (pct: number) => Math.round((pct / 100) * 255);
