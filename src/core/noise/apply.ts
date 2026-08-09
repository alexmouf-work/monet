/** Noise map building and application — docs/04 §4–5. */
import { hslToRgb, rgbToHsl } from '../color/convert';
import { NOISE_CELL, sampleNoise, type NoiseType } from './fields';

export interface NoiseParams {
  type: NoiseType;
  rotationDeg: number;
  /** Feature scale multiplier; 2 = features twice as large. */
  z: number;
  seed: number;
  /** 0–100. */
  intensity: number;
  brightness: boolean;
  hue: boolean;
}

export const DEFAULT_NOISE: Omit<NoiseParams, 'seed'> = {
  type: 'perlin',
  rotationDeg: 0,
  z: 1,
  intensity: 50,
  brightness: true,
  hue: false,
};

/** Evaluate the field once per pixel — docs/04 §2. */
export function buildNoiseMap(W: number, H: number, p: NoiseParams): Float32Array {
  const out = new Float32Array(W * H);
  const th = (p.rotationDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const cell = NOISE_CELL * p.z;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const qx = x + 0.5 - W / 2;
      const qy = y + 0.5 - H / 2;
      // Inverse-rotate the lookup so the pattern itself rotates clockwise.
      const u = qx * c + qy * s;
      const v = -qx * s + qy * c;
      out[y * W + x] = sampleNoise(p.type, u / cell, v / cell, p.seed, {
        qx,
        qy,
        u,
        v,
        z: p.z,
        W,
        H,
      });
    }
  }
  return out;
}

/**
 * Apply the map to pixels — docs/04 §5. Brightness moves lightness by up to ±50 % and hue by
 * up to ±180° at full intensity. Alpha is never touched and transparent pixels are skipped.
 */
export function applyNoise(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  map: Float32Array,
  p: NoiseParams,
): void {
  const k = p.intensity / 100;
  const idle = !p.brightness && !p.hue;
  for (let px = 0, i = 0; px < map.length; px++, i += 4) {
    const a = before[i + 3];
    if (a === 0 || idle) {
      after[i] = before[i];
      after[i + 1] = before[i + 1];
      after[i + 2] = before[i + 2];
      after[i + 3] = a;
      continue;
    }
    let [h, s, l] = rgbToHsl(before[i], before[i + 1], before[i + 2]);
    const n = map[px];
    if (p.brightness) l = Math.max(0, Math.min(1, l + n * k * 0.5));
    if (p.hue) h = (h + n * k * 180 + 360) % 360;
    const [r, g, b] = hslToRgb(h, s, l);
    after[i] = r;
    after[i + 1] = g;
    after[i + 2] = b;
    after[i + 3] = a;
  }
}

/** Log2 slider position ⇄ zoom factor (docs/04 §1: −3…+3 → 0.125…8). */
export const zoomFromSlider = (s: number) => 2 ** s;
export const sliderFromZoom = (z: number) => Math.log2(z);

export const randomSeed = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
};
