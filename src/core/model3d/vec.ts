/**
 * Minimal vector / 4×4 matrix maths for the 3D viewport — docs/11 §5–§7. Column-major
 * Float32Array(16), matching WebGL's uniformMatrix4fv layout. Hand-written on purpose:
 * D11.1 chose raw WebGL2 over a library.
 */
import type { Vec3 } from './types';

export type Mat4 = Float32Array;

export const DEG = Math.PI / 180;

// ------------------------------------------------------------------ vec3

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

// ------------------------------------------------------------------ mat4

export const identity = (): Mat4 =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** out = a · b (column-major; applies b first). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export const translation = (v: Vec3): Mat4 =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v.x, v.y, v.z, 1]);

export function rotationX(rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotationY(rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function rotationZ(rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function perspective(fovYDeg: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan((fovYDeg * DEG) / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function ortho(l: number, r: number, b: number, t: number, near: number, far: number): Mat4 {
  const out = new Float32Array(16);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (far - near);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

/** General 4×4 inverse; returns identity for a singular input (never NaNs downstream). */
export function invert(m: Mat4): Mat4 {
  const inv = new Float32Array(16);
  const a = m;
  inv[0] =
    a[5] * a[10] * a[15] -
    a[5] * a[11] * a[14] -
    a[9] * a[6] * a[15] +
    a[9] * a[7] * a[14] +
    a[13] * a[6] * a[11] -
    a[13] * a[7] * a[10];
  inv[4] =
    -a[4] * a[10] * a[15] +
    a[4] * a[11] * a[14] +
    a[8] * a[6] * a[15] -
    a[8] * a[7] * a[14] -
    a[12] * a[6] * a[11] +
    a[12] * a[7] * a[10];
  inv[8] =
    a[4] * a[9] * a[15] -
    a[4] * a[11] * a[13] -
    a[8] * a[5] * a[15] +
    a[8] * a[7] * a[13] +
    a[12] * a[5] * a[11] -
    a[12] * a[7] * a[9];
  inv[12] =
    -a[4] * a[9] * a[14] +
    a[4] * a[10] * a[13] +
    a[8] * a[5] * a[14] -
    a[8] * a[6] * a[13] -
    a[12] * a[5] * a[10] +
    a[12] * a[6] * a[9];
  inv[1] =
    -a[1] * a[10] * a[15] +
    a[1] * a[11] * a[14] +
    a[9] * a[2] * a[15] -
    a[9] * a[3] * a[14] -
    a[13] * a[2] * a[11] +
    a[13] * a[3] * a[10];
  inv[5] =
    a[0] * a[10] * a[15] -
    a[0] * a[11] * a[14] -
    a[8] * a[2] * a[15] +
    a[8] * a[3] * a[14] +
    a[12] * a[2] * a[11] -
    a[12] * a[3] * a[10];
  inv[9] =
    -a[0] * a[9] * a[15] +
    a[0] * a[11] * a[13] +
    a[8] * a[1] * a[15] -
    a[8] * a[3] * a[13] -
    a[12] * a[1] * a[11] +
    a[12] * a[3] * a[9];
  inv[13] =
    a[0] * a[9] * a[14] -
    a[0] * a[10] * a[13] -
    a[8] * a[1] * a[14] +
    a[8] * a[2] * a[13] +
    a[12] * a[1] * a[10] -
    a[12] * a[2] * a[9];
  inv[2] =
    a[1] * a[6] * a[15] -
    a[1] * a[7] * a[14] -
    a[5] * a[2] * a[15] +
    a[5] * a[3] * a[14] +
    a[13] * a[2] * a[7] -
    a[13] * a[3] * a[6];
  inv[6] =
    -a[0] * a[6] * a[15] +
    a[0] * a[7] * a[14] +
    a[4] * a[2] * a[15] -
    a[4] * a[3] * a[14] -
    a[12] * a[2] * a[7] +
    a[12] * a[3] * a[6];
  inv[10] =
    a[0] * a[5] * a[15] -
    a[0] * a[7] * a[13] -
    a[4] * a[1] * a[15] +
    a[4] * a[3] * a[13] +
    a[12] * a[1] * a[7] -
    a[12] * a[3] * a[5];
  inv[14] =
    -a[0] * a[5] * a[14] +
    a[0] * a[6] * a[13] +
    a[4] * a[1] * a[14] -
    a[4] * a[2] * a[13] -
    a[12] * a[1] * a[6] +
    a[12] * a[2] * a[5];
  inv[3] =
    -a[1] * a[6] * a[11] +
    a[1] * a[7] * a[10] +
    a[5] * a[2] * a[11] -
    a[5] * a[3] * a[10] -
    a[9] * a[2] * a[7] +
    a[9] * a[3] * a[6];
  inv[7] =
    a[0] * a[6] * a[11] -
    a[0] * a[7] * a[10] -
    a[4] * a[2] * a[11] +
    a[4] * a[3] * a[10] +
    a[8] * a[2] * a[7] -
    a[8] * a[3] * a[6];
  inv[11] =
    -a[0] * a[5] * a[11] +
    a[0] * a[7] * a[9] +
    a[4] * a[1] * a[11] -
    a[4] * a[3] * a[9] -
    a[8] * a[1] * a[7] +
    a[8] * a[3] * a[5];
  inv[15] =
    a[0] * a[5] * a[10] -
    a[0] * a[6] * a[9] -
    a[4] * a[1] * a[10] +
    a[4] * a[2] * a[9] +
    a[8] * a[1] * a[6] -
    a[8] * a[2] * a[5];

  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!det) return identity();
  for (let i = 0; i < 16; i++) inv[i] /= det;
  return inv;
}

/** Transform a point (w = 1, perspective divide applied). */
export function transformPoint(m: Mat4, v: Vec3): Vec3 {
  const w = m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15] || 1;
  return {
    x: (m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12]) / w,
    y: (m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13]) / w,
    z: (m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14]) / w,
  };
}

/** Transform a direction (w = 0). */
export const transformDirection = (m: Mat4, v: Vec3): Vec3 => ({
  x: m[0] * v.x + m[4] * v.y + m[8] * v.z,
  y: m[1] * v.x + m[5] * v.y + m[9] * v.z,
  z: m[2] * v.x + m[6] * v.y + m[10] * v.z,
});

/** Rotate `p` about `origin` by `rad` on one axis (Minecraft element rotation). */
export function rotateAbout(p: Vec3, origin: Vec3, axis: 'x' | 'y' | 'z', rad: number): Vec3 {
  const d = sub(p, origin);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let r: Vec3;
  if (axis === 'x') r = { x: d.x, y: d.y * c - d.z * s, z: d.y * s + d.z * c };
  else if (axis === 'y') r = { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
  else r = { x: d.x * c - d.y * s, y: d.x * s + d.y * c, z: d.z };
  return add(r, origin);
}
