/** Brush tip masks — docs/02 §2 (hard) and §4 (graded marker). */
export interface TipMask {
  size: number;
  /** size*size coverage, 0–1. */
  a: Float32Array;
}

export type TipShape = 'circle' | 'square';

/** Hard, aliased tip: every covered pixel gets the full colour (pixel-art correct). */
export function makeTip(size: number, tip: TipShape): TipMask {
  const a = new Float32Array(size * size);
  if (tip === 'square') {
    a.fill(1);
    return { size, a };
  }
  const c = (size - 1) / 2;
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d2 = (x - c) ** 2 + (y - c) ** 2;
      a[y * size + x] = d2 <= r * r ? 1 : 0;
    }
  }
  return { size, a };
}

/** Marker tip: 1 at the centre falling to 0 at the radius (Chebyshev for square tips). */
export function makeMarkerTip(size: number, tip: TipShape): TipMask {
  const a = new Float32Array(size * size);
  const c = (size - 1) / 2;
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - c);
      const dy = Math.abs(y - c);
      const d = tip === 'circle' ? Math.hypot(dx, dy) : Math.max(dx, dy);
      const t = Math.min(1, d / r);
      a[y * size + x] = (1 - t) ** 2;
    }
  }
  return { size, a };
}

/** Top-left placement of a tip stamped at doc-space point p — docs/02 §2. */
export const tipOrigin = (p: { x: number; y: number }, size: number) => ({
  x: Math.round(p.x) - Math.floor(size / 2),
  y: Math.round(p.y) - Math.floor(size / 2),
});

/** Integer Bresenham walk, inclusive of both ends — gap-free 1-px lines. */
export function bresenham(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    visit(x, y);
    if (x === ex && y === ey) return;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Evenly spaced sample points along a segment, used by the marker. */
export function spacedPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  spacing: number,
): { x: number; y: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / spacing));
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push({ x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps });
  }
  return out;
}
