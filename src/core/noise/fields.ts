/**
 * The 13 noise fields — docs/04 §3. Every field is deterministic from one integer hash: no
 * Math.random anywhere, so the same seed always reproduces the same texture.
 */

/** Deterministic hash → [0,1). Never change these constants once shipped. */
export function hash2(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));
const frac = (t: number) => t - Math.floor(t);
/** Triangle wave over [−1,1]. */
const tri = (t: number) => 1 - 4 * Math.abs(frac(t) - 0.5);

function gdot(ix: number, iy: number, dx: number, dy: number, seed: number): number {
  const a = hash2(ix, iy, seed) * Math.PI * 2;
  return Math.cos(a) * dx + Math.sin(a) * dy;
}

export function perlin(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fade(fx);
  const v = fade(fy);
  const n00 = gdot(x0, y0, fx, fy, seed);
  const n10 = gdot(x0 + 1, y0, fx - 1, fy, seed);
  const n01 = gdot(x0, y0 + 1, fx, fy - 1, seed);
  const n11 = gdot(x0 + 1, y0 + 1, fx - 1, fy - 1, seed);
  return clamp1(lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) / 0.70710678);
}

export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = fade(x - x0);
  const v = fade(y - y0);
  return (
    lerp(
      lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), u),
      lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), u),
      v,
    ) *
      2 -
    1
  );
}

/** Four octaves of Perlin. */
export function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  for (let o = 0; o < 4; o++) {
    sum += amp * perlin(x * (1 << o), y * (1 << o), seed + o);
    amp *= 0.5;
  }
  return clamp1(sum / 0.9375);
}

/** Worley F1 — −1 at cell centres, rising toward cell borders. */
export function cells(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = Infinity;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 101);
      f1 = Math.min(f1, Math.hypot(px - x, py - y));
    }
  }
  return clamp1(Math.min(f1, 1) * 2 - 1);
}

export type NoiseType =
  | 'perlin'
  | 'clouds'
  | 'value'
  | 'cells'
  | 'marble'
  | 'wood'
  | 'stripes'
  | 'zigzag'
  | 'checker'
  | 'rings'
  | 'gradient'
  | 'radial'
  | 'white';

export interface NoiseGroup {
  label: string;
  types: { id: NoiseType; label: string }[];
}

/** Grouped for the dropdown — docs/04 §3. */
export const NOISE_GROUPS: NoiseGroup[] = [
  {
    label: 'Organic',
    types: [
      { id: 'perlin', label: 'Perlin' },
      { id: 'clouds', label: 'Clouds (fBm)' },
      { id: 'value', label: 'Soft blobs' },
      { id: 'cells', label: 'Cells (Worley)' },
      { id: 'marble', label: 'Marble' },
      { id: 'wood', label: 'Wood' },
    ],
  },
  {
    label: 'Geometric',
    types: [
      { id: 'stripes', label: 'Stripes' },
      { id: 'zigzag', label: 'Zigzag' },
      { id: 'checker', label: 'Checker' },
      { id: 'rings', label: 'Rings' },
    ],
  },
  {
    label: 'Gradients',
    types: [
      { id: 'gradient', label: 'Up/down gradient' },
      { id: 'radial', label: 'Radial' },
    ],
  },
  { label: 'Random', types: [{ id: 'white', label: 'White noise' }] },
];

export const NOISE_TYPES: NoiseType[] = NOISE_GROUPS.flatMap((g) => g.types.map((t) => t.id));

export interface NoiseEnv {
  /** Centred doc coords, unrotated. */
  qx: number;
  qy: number;
  /** Centred doc coords after the inverse rotation, in px. */
  u: number;
  v: number;
  z: number;
  W: number;
  H: number;
}

/** Scalar field in [−1, 1]. `nx, ny` are the rotated coords divided by the feature size. */
export function sampleNoise(
  t: NoiseType,
  nx: number,
  ny: number,
  seed: number,
  e: NoiseEnv,
): number {
  switch (t) {
    case 'perlin':
      return perlin(nx, ny, seed);
    case 'clouds':
      return fbm(nx, ny, seed);
    case 'value':
      return valueNoise(nx, ny, seed);
    case 'cells':
      return cells(nx, ny, seed);
    case 'marble':
      return clamp1(Math.sin(2 * Math.PI * (nx + 1.5 * fbm(nx * 0.5, ny * 0.5, seed))));
    case 'wood':
      return tri(Math.hypot(nx, ny) + 0.8 * fbm(nx * 0.7, ny * 0.7, seed + 7));
    case 'stripes':
      return frac(nx) < 0.5 ? 1 : -1;
    case 'zigzag':
      return tri(nx + 0.5 * tri(ny));
    case 'checker':
      return (Math.floor(nx) + Math.floor(ny)) & 1 ? -1 : 1;
    case 'rings':
      return Math.sin(2 * Math.PI * Math.hypot(nx, ny));
    case 'gradient':
      // Dark at the top, light at the bottom; rotation gives any direction.
      return clamp1(e.v / ((e.z * e.H) / 2));
    case 'radial':
      return clamp1(1 - 2 * Math.min(1, Math.hypot(e.qx, e.qy) / ((e.z * Math.min(e.W, e.H)) / 2)));
    case 'white':
      // Per-pixel at zoom 1 (CELL = 1 rather than 8).
      return hash2(Math.floor(e.u / e.z), Math.floor(e.v / e.z), seed) * 2 - 1;
  }
}

/** Base feature size in px before the zoom multiplier. */
export const NOISE_CELL = 8;
