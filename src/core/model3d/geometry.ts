/**
 * Element boxes → renderable mesh data — docs/11 §5. Pure typed arrays; the GL layer only
 * uploads. The corner and (s,t) tables here are THE authority shared with picking (pick.ts
 * imports them), so what the ray maths says you hit is exactly what the rasteriser drew.
 *
 * Conventions:
 * - Corner order per face is (s0,t0) (s1,t0) (s1,t1) (s0,t1) as seen from outside, where
 *   s→u and t→v (v downward, Minecraft's texture space). cross(sEdge, tEdge) points INWARD
 *   for every face — one uniform winding, so the renderer sets frontFace(CW) once.
 * - UVs are emitted normalized 0..1 (Minecraft uv/16); texture pixel size never enters here.
 */
import type { Face, ModelElement, Vec3 } from './types';
import { FACES, FACE_SHADE, vec3 } from './types';
import { DEG, rotateAbout, sub } from './vec';

/** Positions of a face's 4 corners for an axis-aligned box a..b, before element rotation. */
export function faceCorners(face: Face, a: Vec3, b: Vec3): [Vec3, Vec3, Vec3, Vec3] {
  switch (face) {
    case 'north':
      return [vec3(b.x, b.y, a.z), vec3(a.x, b.y, a.z), vec3(a.x, a.y, a.z), vec3(b.x, a.y, a.z)];
    case 'south':
      return [vec3(a.x, b.y, b.z), vec3(b.x, b.y, b.z), vec3(b.x, a.y, b.z), vec3(a.x, a.y, b.z)];
    case 'east':
      return [vec3(b.x, b.y, b.z), vec3(b.x, b.y, a.z), vec3(b.x, a.y, a.z), vec3(b.x, a.y, b.z)];
    case 'west':
      return [vec3(a.x, b.y, a.z), vec3(a.x, b.y, b.z), vec3(a.x, a.y, b.z), vec3(a.x, a.y, a.z)];
    case 'up':
      return [vec3(a.x, b.y, a.z), vec3(b.x, b.y, a.z), vec3(b.x, b.y, b.z), vec3(a.x, b.y, b.z)];
    case 'down':
      return [vec3(a.x, a.y, b.z), vec3(b.x, a.y, b.z), vec3(b.x, a.y, a.z), vec3(a.x, a.y, a.z)];
  }
}

/**
 * (s,t) of a point lying on `face` of the box a..b — the inverse of faceCorners' ordering,
 * matching the vanilla default-UV projections in javaModel.defaultUV.
 */
export function faceST(face: Face, a: Vec3, b: Vec3, p: Vec3): { s: number; t: number } {
  const w = b.x - a.x || 1;
  const h = b.y - a.y || 1;
  const d = b.z - a.z || 1;
  switch (face) {
    case 'north':
      return { s: (b.x - p.x) / w, t: (b.y - p.y) / h };
    case 'south':
      return { s: (p.x - a.x) / w, t: (b.y - p.y) / h };
    case 'east':
      return { s: (b.z - p.z) / d, t: (b.y - p.y) / h };
    case 'west':
      return { s: (p.z - a.z) / d, t: (b.y - p.y) / h };
    case 'up':
      return { s: (p.x - a.x) / w, t: (p.z - a.z) / d };
    case 'down':
      return { s: (p.x - a.x) / w, t: (b.z - p.z) / d };
  }
}

/** Face texture rotation: where sample coords (s,t) land after rotating the texture by r°. */
export function rotateST(r: 0 | 90 | 180 | 270, s: number, t: number): { s: number; t: number } {
  switch (r) {
    case 0:
      return { s, t };
    case 90:
      return { s: t, t: 1 - s };
    case 180:
      return { s: 1 - s, t: 1 - t };
    case 270:
      return { s: 1 - t, t: s };
  }
}

/** (s,t) → normalized uv within the face's 0..16 rect. */
export function stToUV(
  uv: [number, number, number, number],
  rotation: 0 | 90 | 180 | 270,
  s: number,
  t: number,
): { u: number; v: number } {
  const r = rotateST(rotation, s, t);
  return {
    u: (uv[0] + r.s * (uv[2] - uv[0])) / 16,
    v: (uv[1] + r.t * (uv[3] - uv[1])) / 16,
  };
}

/** Element rotation applied to a model-space point (angle°, one axis, optional rescale). */
export function applyElementRotation(el: ModelElement, p: Vec3): Vec3 {
  const rot = el.rotation;
  if (!rot || !rot.angle) return p;
  let q = p;
  if (rot.rescale) {
    // Minecraft's rescale: stretch the two perpendicular axes by 1/cos so a 45° cross still
    // spans the full block.
    const f = 1 / Math.cos(rot.angle * DEG) || 1;
    const d = sub(p, rot.origin);
    q = {
      x: rot.origin.x + d.x * (rot.axis === 'x' ? 1 : f),
      y: rot.origin.y + d.y * (rot.axis === 'y' ? 1 : f),
      z: rot.origin.z + d.z * (rot.axis === 'z' ? 1 : f),
    };
  }
  return rotateAbout(q, rot.origin, rot.axis, rot.angle * DEG);
}

/** Stable int id for one face of one element — the hover/pick key attribute. */
export const faceKey = (elementId: number, face: Face): number =>
  elementId * 8 + FACES.indexOf(face);

export interface MeshBatch {
  textureVar: string;
  /** Offset and count in INDICES (elements of the index buffer). */
  start: number;
  count: number;
}

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  shades: Float32Array;
  keys: Float32Array;
  indices: Uint32Array;
  batches: MeshBatch[];
  faceCount: number;
}

/** Build the whole model's mesh, batched per texture variable. */
export function buildMesh(elements: ModelElement[]): MeshData {
  interface FaceOut {
    corners: Vec3[];
    uv: { u: number; v: number }[];
    shade: number;
    key: number;
  }
  const byVar = new Map<string, FaceOut[]>();

  for (const el of elements) {
    if (!el.visible) continue;
    for (const face of FACES) {
      const f = el.faces[face];
      if (!f) continue;
      const corners = faceCorners(face, el.from, el.to).map((c) => applyElementRotation(el, c));
      const st: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const uv = st.map(([s, t]) => stToUV(f.uv, f.rotation ?? 0, s, t));
      const shade = el.shade === false ? 1 : FACE_SHADE[face];
      const out: FaceOut = { corners, uv, shade, key: faceKey(el.id, face) };
      const list = byVar.get(f.texture) ?? [];
      list.push(out);
      byVar.set(f.texture, list);
    }
  }

  let faceCount = 0;
  for (const list of byVar.values()) faceCount += list.length;

  const positions = new Float32Array(faceCount * 4 * 3);
  const uvs = new Float32Array(faceCount * 4 * 2);
  const shades = new Float32Array(faceCount * 4);
  const keys = new Float32Array(faceCount * 4);
  const indices = new Uint32Array(faceCount * 6);
  const batches: MeshBatch[] = [];

  let v = 0;
  let i = 0;
  for (const [textureVar, faces] of byVar) {
    const start = i;
    for (const face of faces) {
      const base = v;
      for (let c = 0; c < 4; c++) {
        positions[(v + c) * 3] = face.corners[c].x;
        positions[(v + c) * 3 + 1] = face.corners[c].y;
        positions[(v + c) * 3 + 2] = face.corners[c].z;
        uvs[(v + c) * 2] = face.uv[c].u;
        uvs[(v + c) * 2 + 1] = face.uv[c].v;
        shades[v + c] = face.shade;
        keys[v + c] = face.key;
      }
      indices[i++] = base;
      indices[i++] = base + 1;
      indices[i++] = base + 2;
      indices[i++] = base;
      indices[i++] = base + 2;
      indices[i++] = base + 3;
      v += 4;
    }
    batches.push({ textureVar, start, count: i - start });
  }

  return { positions, uvs, shades, keys, indices, batches, faceCount };
}

/** Model-space bounds over every visible element, rotation included. Empty model → unit block. */
export function modelBounds(elements: ModelElement[]): { min: Vec3; max: Vec3 } {
  let has = false;
  const min = vec3(Infinity, Infinity, Infinity);
  const max = vec3(-Infinity, -Infinity, -Infinity);
  for (const el of elements) {
    if (!el.visible) continue;
    for (const cx of [el.from.x, el.to.x])
      for (const cy of [el.from.y, el.to.y])
        for (const cz of [el.from.z, el.to.z]) {
          const p = applyElementRotation(el, vec3(cx, cy, cz));
          has = true;
          min.x = Math.min(min.x, p.x);
          min.y = Math.min(min.y, p.y);
          min.z = Math.min(min.z, p.z);
          max.x = Math.max(max.x, p.x);
          max.y = Math.max(max.y, p.y);
          max.z = Math.max(max.z, p.z);
        }
  }
  return has ? { min, max } : { min: vec3(0, 0, 0), max: vec3(16, 16, 16) };
}
