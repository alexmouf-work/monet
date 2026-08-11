/**
 * CPU ray picking — docs/11 §7. Slab-test each element's box in its LOCAL space (the ray is
 * transformed by the inverse element rotation), keep the nearest entry face. Exact for boxes,
 * microseconds for tens of elements, and — the point — no readPixels per pointer event.
 */
import type { Face, FaceHit, ModelElement, Vec3 } from './types';
import { faceST, stToUV } from './geometry';
import { DEG, add, rotateAbout, scale, sub } from './vec';
import type { Ray } from './camera';

/** The face a ray entered an AABB through, given the entry axis and ray direction. */
function entryFace(axis: 'x' | 'y' | 'z', dirPositive: boolean): Face {
  if (axis === 'x') return dirPositive ? 'west' : 'east';
  if (axis === 'y') return dirPositive ? 'down' : 'up';
  return dirPositive ? 'north' : 'south';
}

/** Ray transformed into an element's unrotated local frame (inverse rotation + rescale). */
function localRay(el: ModelElement, ray: Ray): Ray {
  const rot = el.rotation;
  if (!rot || !rot.angle) return ray;
  const rad = rot.angle * DEG;
  let origin = rotateAbout(ray.origin, rot.origin, rot.axis, -rad);
  let dir = sub(rotateAbout(add(ray.origin, ray.dir), rot.origin, rot.axis, -rad), origin);
  if (rot.rescale) {
    const f = Math.cos(rad) || 1; // inverse of the 1/cos stretch
    const undo = (p: Vec3): Vec3 => ({
      x: rot.origin.x + (p.x - rot.origin.x) * (rot.axis === 'x' ? 1 : f),
      y: rot.origin.y + (p.y - rot.origin.y) * (rot.axis === 'y' ? 1 : f),
      z: rot.origin.z + (p.z - rot.origin.z) * (rot.axis === 'z' ? 1 : f),
    });
    const o2 = undo(origin);
    dir = sub(undo(add(origin, dir)), o2);
    origin = o2;
  }
  return { origin, dir };
}

/** Nearest face hit, or null. Invisible elements and absent faces are transparent to the ray. */
export function pickModel(elements: ModelElement[], ray: Ray): FaceHit | null {
  let best: FaceHit | null = null;

  for (const el of elements) {
    if (!el.visible) continue;
    const r = localRay(el, ray);

    let tMin = -Infinity;
    let tMax = Infinity;
    let axis: 'x' | 'y' | 'z' = 'x';
    for (const a of ['x', 'y', 'z'] as const) {
      const o = r.origin[a];
      const d = r.dir[a];
      const lo = el.from[a];
      const hi = el.to[a];
      if (Math.abs(d) < 1e-9) {
        if (o < lo - 1e-9 || o > hi + 1e-9) {
          tMin = Infinity; // misses the slab entirely
          break;
        }
        continue;
      }
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tMin) {
        tMin = t1;
        axis = a;
      }
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) break;
    }
    // No entry, or the camera is inside the box: painting the inside is never wanted.
    if (tMin > tMax || tMin <= 0 || !isFinite(tMin)) continue;
    if (best && tMin >= best.distance) continue;

    const face = entryFace(axis, r.dir[axis] > 0);
    const modelFace = el.faces[face];
    if (!modelFace) continue; // faceless side: the ray passes on to whatever is behind

    const local = add(r.origin, scale(r.dir, tMin));
    const st = faceST(face, el.from, el.to, local);
    const uvNorm = stToUV(modelFace.uv, modelFace.rotation ?? 0, st.s, st.t);
    // Report the hit point in model space (the caller may draw a marker there).
    const world = add(ray.origin, scale(ray.dir, tMin));

    best = {
      elementId: el.id,
      face,
      point: world,
      uvNorm,
      textureVar: modelFace.texture,
      distance: tMin,
    };
  }
  return best;
}
