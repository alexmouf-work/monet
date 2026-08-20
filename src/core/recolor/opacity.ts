/**
 * Mode C — opacity — docs/05 §5 (owner request 2026-08-11). Multiply the alpha of one colour
 * (and anything within the tolerance of it) by a given amount, leaving every other pixel and
 * every RGB value untouched.
 *
 * The amount is stated on the **0–255 scale alpha itself uses**: 255 multiplies by 1 and
 * changes nothing, 128 halves the opacity, 0 makes the matched colour invisible. So the
 * identity is also the default, and there is only one number in play rather than a percentage
 * that has to be converted in the reader's head.
 *
 * Matching follows Replace exactly (§3): per-channel Chebyshev over RGB, alpha ignored when
 * deciding, and fully transparent pixels are never rewritten.
 */
import type { Rgb } from '../model/types';

export interface OpacityParams {
  targets: Rgb[];
  /** 0–255 per-channel threshold, as Replace. */
  tolerance: number;
  /** 0–255; the multiplier is `amount / 255`. */
  amount: number;
}

export function applyOpacity(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  p: OpacityParams,
): void {
  const { targets, tolerance } = p;
  const factor = Math.max(0, Math.min(255, p.amount)) / 255;
  for (let i = 0; i < before.length; i += 4) {
    const a = before[i + 3];
    after[i] = before[i];
    after[i + 1] = before[i + 1];
    after[i + 2] = before[i + 2];
    let hit = false;
    if (a !== 0) {
      for (const t of targets) {
        if (
          Math.max(
            Math.abs(before[i] - t.r),
            Math.abs(before[i + 1] - t.g),
            Math.abs(before[i + 2] - t.b),
          ) <= tolerance
        ) {
          hit = true;
          break;
        }
      }
    }
    after[i + 3] = hit ? Math.round(a * factor) : a;
  }
}
