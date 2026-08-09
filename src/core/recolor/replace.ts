/**
 * Mode A — targeted replace — docs/05 §3. Matching ignores alpha and uses the same
 * per-channel Chebyshev tolerance as the bucket, so "does not touch a colour outside the
 * tolerance" holds by construction. Alpha is always preserved.
 */
import type { Rgb } from '../model/types';

export interface ReplaceParams {
  targets: Rgb[];
  /** 0–255 per-channel threshold. */
  tolerance: number;
  result: Rgb;
}

export function applyReplace(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  p: ReplaceParams,
): void {
  const { targets, tolerance, result } = p;
  for (let i = 0; i < before.length; i += 4) {
    const a = before[i + 3];
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
    after[i] = hit ? result.r : before[i];
    after[i + 1] = hit ? result.g : before[i + 1];
    after[i + 2] = hit ? result.b : before[i + 2];
    after[i + 3] = a;
  }
}

export const tolerancePctToThreshold = (pct: number) => Math.round((pct / 100) * 255);
