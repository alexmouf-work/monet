/**
 * Pure element-editing helpers — docs/11 §10.2: new cubes, duplication, mirroring. All of
 * them return fresh elements; commands do the mutating.
 */
import type { Axis, Face, ModelElement, ModelFace, Vec3 } from './types';
import { FACES, vec3 } from './types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A unit-friendly new cube: centred, 4×4×4, faces on #all so it renders immediately. */
export function newCube(id: number, name = `cube ${id}`): ModelElement {
  const faces: Partial<Record<Face, ModelFace>> = {};
  for (const f of FACES) faces[f] = { uv: [0, 0, 16, 16], texture: 'all' };
  return {
    id,
    name,
    groupId: null,
    from: vec3(6, 6, 6),
    to: vec3(10, 10, 10),
    faces,
    visible: true,
    locked: false,
  };
}

export function duplicateElement(el: ModelElement, id: number): ModelElement {
  const copy = clone(el);
  copy.id = id;
  copy.name = `${el.name} copy`;
  // Nudge like 2D's Ctrl+D so the copy is visible rather than hiding the original.
  copy.from = { x: el.from.x + 1, y: el.from.y, z: el.from.z + 1 };
  copy.to = { x: el.to.x + 1, y: el.to.y, z: el.to.z + 1 };
  if (copy.rotation) {
    copy.rotation.origin = {
      x: copy.rotation.origin.x + 1,
      y: copy.rotation.origin.y,
      z: copy.rotation.origin.z + 1,
    };
  }
  return copy;
}

/** Faces that swap when mirroring across an axis. */
const MIRROR_FACES: Record<Axis, [Face, Face]> = {
  x: ['east', 'west'],
  y: ['up', 'down'],
  z: ['north', 'south'],
};

const reflect = (v: Vec3, axis: Axis, about = 8): Vec3 => ({
  ...v,
  [axis]: about * 2 - v[axis],
});

/**
 * Mirror across the block's centre plane on one axis: geometry reflects, the two faces
 * perpendicular to the axis swap, and rotations about other axes negate. Face UVs are kept
 * as-is (mirroring uv content is a texture edit, not a geometry edit).
 */
export function mirrorElement(el: ModelElement, axis: Axis): ModelElement {
  const out = clone(el);
  const a = reflect(el.from, axis);
  const b = reflect(el.to, axis);
  out.from = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
  out.to = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };

  const [p, q] = MIRROR_FACES[axis];
  const fp = out.faces[p];
  const fq = out.faces[q];
  out.faces[p] = fq;
  out.faces[q] = fp;
  if (out.faces[p] === undefined) delete out.faces[p];
  if (out.faces[q] === undefined) delete out.faces[q];

  if (out.rotation) {
    out.rotation.origin = reflect(out.rotation.origin, axis);
    if (out.rotation.axis !== axis) out.rotation.angle = -out.rotation.angle;
  }
  return out;
}
