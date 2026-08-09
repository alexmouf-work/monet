/**
 * Contiguous flood fill with tolerance — docs/02 §5. Scanline span fill: no recursion, and
 * the match predicate is Chebyshev distance over RGBA (A8) so a fill never escapes into a
 * colour outside the tolerance.
 */
import type { Rect } from '../model/types';
import { idx } from './pixels';

export interface FillRegion {
  mask: Uint8Array;
  rect: Rect;
}

export function floodFill(
  pick: Uint8ClampedArray,
  W: number,
  H: number,
  sx: number,
  sy: number,
  T: number,
): FillRegion | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;

  const s = idx(sx, sy, W);
  const r0 = pick[s];
  const g0 = pick[s + 1];
  const b0 = pick[s + 2];
  const a0 = pick[s + 3];
  const match = (i: number) =>
    Math.max(
      Math.abs(pick[i] - r0),
      Math.abs(pick[i + 1] - g0),
      Math.abs(pick[i + 2] - b0),
      Math.abs(pick[i + 3] - a0),
    ) <= T;

  const mask = new Uint8Array(W * H);
  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;
  const stack: number[] = [sx, sy];

  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (mask[y * W + x]) continue;

    let x0 = x;
    while (x0 >= 0 && !mask[y * W + x0] && match(idx(x0, y, W))) x0--;
    x0++;
    let x1 = x;
    while (x1 < W && !mask[y * W + x1] && match(idx(x1, y, W))) x1++;
    x1--;
    if (x1 < x0) continue;

    for (let xi = x0; xi <= x1; xi++) mask[y * W + xi] = 1;
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= H) continue;
      let xi = x0;
      while (xi <= x1) {
        if (!mask[ny * W + xi] && match(idx(xi, ny, W))) {
          stack.push(xi, ny);
          while (xi <= x1 && !mask[ny * W + xi] && match(idx(xi, ny, W))) xi++;
        } else xi++;
      }
    }
  }

  return { mask, rect: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/** Tolerance percent → 0–255 channel threshold. */
export const toleranceToThreshold = (pct: number) => Math.round((pct / 100) * 255);
