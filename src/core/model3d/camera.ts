/**
 * Orbit camera — docs/11 §6. Pure state → matrices/rays; the Onshape-mapped input handling
 * lives in the UI, which calls the mutators here.
 */
import type { CameraState, Vec3 } from './types';
import { vec3 } from './types';
import {
  DEG,
  add,
  invert,
  lerp3,
  multiply,
  normalize,
  ortho,
  perspective,
  rotationX,
  rotationY,
  scale,
  sub,
  transformPoint,
  translation,
  type Mat4,
} from './vec';

export const DEFAULT_CAMERA: CameraState = {
  target: vec3(8, 8, 8),
  yaw: 35,
  pitch: 25,
  distance: 42,
  projection: 'perspective',
  fov: 50,
};

const PITCH_LIMIT = 89.9;
const DIST_MIN = 2;
const DIST_MAX = 600;

export function viewMatrix(cam: CameraState): Mat4 {
  // T(0,0,-d) · Rx(pitch) · Ry(yaw) · T(-target)
  let m = translation(scale(cam.target, -1));
  m = multiply(rotationY(cam.yaw * DEG), m);
  m = multiply(rotationX(cam.pitch * DEG), m);
  m = multiply(translation(vec3(0, 0, -cam.distance)), m);
  return m;
}

export function projMatrix(cam: CameraState, aspect: number): Mat4 {
  const near = Math.max(0.1, cam.distance * 0.02);
  const far = cam.distance * 10 + 200;
  if (cam.projection === 'perspective') return perspective(cam.fov, aspect, near, far);
  // Half-height matched to the perspective frustum at the target plane, so toggling
  // projection keeps the model the same apparent size (docs/11 §6).
  const halfH = cam.distance * Math.tan((cam.fov * DEG) / 2);
  return ortho(-halfH * aspect, halfH * aspect, -halfH, halfH, -far, far);
}

/** World-space position of the camera itself. */
export function cameraPosition(cam: CameraState): Vec3 {
  const inv = invert(viewMatrix(cam));
  return transformPoint(inv, vec3(0, 0, 0));
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/**
 * Ray through NDC (x,y in -1..1, y up). Unprojects two depths so the same code serves
 * perspective and orthographic.
 */
export function screenRay(cam: CameraState, aspect: number, ndcX: number, ndcY: number): Ray {
  const inv = invert(multiply(projMatrix(cam, aspect), viewMatrix(cam)));
  const near = transformPoint(inv, vec3(ndcX, ndcY, -1));
  const far = transformPoint(inv, vec3(ndcX, ndcY, 1));
  return { origin: near, dir: normalize(sub(far, near)) };
}

// ------------------------------------------------------------------ mutations (return new state)

export function orbit(cam: CameraState, dxPx: number, dyPx: number): CameraState {
  const yaw = (cam.yaw + dxPx * 0.4) % 360;
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch + dyPx * 0.4));
  return { ...cam, yaw, pitch };
}

/** Pan in screen space: the target slides along the camera's right/up axes. */
export function pan(cam: CameraState, dxPx: number, dyPx: number, viewportH: number): CameraState {
  const worldPerPx = (2 * cam.distance * Math.tan((cam.fov * DEG) / 2)) / Math.max(1, viewportH);
  const inv = invert(viewMatrix(cam));
  const right = normalize(
    sub(transformPoint(inv, vec3(1, 0, 0)), transformPoint(inv, vec3(0, 0, 0))),
  );
  const up = normalize(sub(transformPoint(inv, vec3(0, 1, 0)), transformPoint(inv, vec3(0, 0, 0))));
  const move = add(scale(right, -dxPx * worldPerPx), scale(up, dyPx * worldPerPx));
  return { ...cam, target: add(cam.target, move) };
}

/**
 * Dolly toward/away from the point under the cursor: the target slides toward the cursor's
 * point at target depth by the zoom fraction, so that point stays put (exact in ortho,
 * near-exact in perspective) — the 3D twin of 2D's zoom-at-cursor.
 */
export function dolly(cam: CameraState, factor: number, cursor?: Ray): CameraState {
  const distance = Math.max(DIST_MIN, Math.min(DIST_MAX, cam.distance * factor));
  if (!cursor) return { ...cam, distance };
  const camPos = cameraPosition(cam);
  const toTarget = sub(cam.target, camPos);
  const depth = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
  const pivot = add(cursor.origin, scale(cursor.dir, depth));
  const target = lerp3(pivot, cam.target, distance / cam.distance);
  return { ...cam, distance, target };
}

/** Frame a bounding box: centre it and back off far enough to see all of it. */
export function frame(cam: CameraState, min: Vec3, max: Vec3): CameraState {
  const target = scale(add(min, max), 0.5);
  const radius = Math.max(1, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2);
  const distance = Math.max(DIST_MIN, (radius / Math.tan((cam.fov * DEG) / 2)) * 1.25);
  return { ...cam, target, distance };
}

export type StandardView = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';

/** Snap yaw/pitch to a canonical view. front = camera on +z, i.e. the south face. */
export function standardView(cam: CameraState, view: StandardView): CameraState {
  const table: Record<StandardView, { yaw: number; pitch: number }> = {
    front: { yaw: 0, pitch: 0 },
    back: { yaw: 180, pitch: 0 },
    right: { yaw: 90, pitch: 0 },
    left: { yaw: -90, pitch: 0 },
    top: { yaw: cam.yaw, pitch: PITCH_LIMIT },
    bottom: { yaw: cam.yaw, pitch: -PITCH_LIMIT },
  };
  return { ...cam, ...table[view] };
}
