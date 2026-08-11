import { describe, expect, it } from 'vitest';
import { vec3, FACES, type ModelElement } from '../src/core/model3d/types';
import { cross, invert, multiply, identity, sub, transformPoint } from '../src/core/model3d/vec';
import {
  DEFAULT_CAMERA,
  cameraPosition,
  dolly,
  frame,
  orbit,
  pan,
  projMatrix,
  screenRay,
  standardView,
  viewMatrix,
} from '../src/core/model3d/camera';
import {
  defaultUV,
  modelRefToPath,
  normalizeRef,
  resolveJavaModel,
  textureRefToPath,
  type RawJavaModel,
} from '../src/core/model3d/javaModel';
import { builtinParent } from '../src/core/model3d/vanillaParents';
import {
  applyElementRotation,
  buildMesh,
  faceCorners,
  faceST,
  modelBounds,
  rotateST,
  stToUV,
} from '../src/core/model3d/geometry';
import { pickModel } from '../src/core/model3d/pick';

const el = (over: Partial<ModelElement> = {}): ModelElement => ({
  id: 1,
  name: 'cube',
  groupId: null,
  from: vec3(0, 0, 0),
  to: vec3(16, 16, 16),
  faces: Object.fromEntries(FACES.map((f) => [f, { uv: [0, 0, 16, 16], texture: 'all' }])),
  visible: true,
  locked: false,
  ...over,
});

describe('mat4', () => {
  it('inverts', () => {
    const m = multiply(viewMatrix(DEFAULT_CAMERA), identity());
    const inv = invert(m);
    const p = transformPoint(multiply(m, inv), vec3(3, -4, 5));
    expect(p.x).toBeCloseTo(3, 4);
    expect(p.y).toBeCloseTo(-4, 4);
    expect(p.z).toBeCloseTo(5, 4);
  });
});

describe('camera', () => {
  it('front view puts the camera on +z looking at the target', () => {
    const cam = standardView({ ...DEFAULT_CAMERA, distance: 40 }, 'front');
    const pos = cameraPosition(cam);
    expect(pos.x).toBeCloseTo(cam.target.x, 3);
    expect(pos.y).toBeCloseTo(cam.target.y, 3);
    expect(pos.z).toBeCloseTo(cam.target.z + 40, 3);
  });

  it('a ray through the viewport centre passes through the target', () => {
    for (const proj of ['perspective', 'orthographic'] as const) {
      const cam = { ...DEFAULT_CAMERA, projection: proj };
      const ray = screenRay(cam, 1.5, 0, 0);
      const toTarget = sub(cam.target, ray.origin);
      const c = cross(toTarget, ray.dir);
      expect(Math.hypot(c.x, c.y, c.z)).toBeLessThan(0.01);
    }
  });

  it('orbit clamps pitch and wraps yaw', () => {
    let cam = DEFAULT_CAMERA;
    for (let i = 0; i < 100; i++) cam = orbit(cam, 20, 20);
    expect(Math.abs(cam.pitch)).toBeLessThanOrEqual(89.9);
    expect(Math.abs(cam.yaw)).toBeLessThan(360);
  });

  it('pan moves the target perpendicular to the view axis', () => {
    const cam = standardView(DEFAULT_CAMERA, 'front');
    const panned = pan(cam, 100, 0, 800);
    expect(panned.target.z).toBeCloseTo(cam.target.z, 3); // no dolly component
    expect(panned.target.x).not.toBeCloseTo(cam.target.x, 3);
  });

  it('dolly keeps the point under the cursor still', () => {
    const cam = { ...standardView(DEFAULT_CAMERA, 'front'), projection: 'orthographic' as const };
    const ray = screenRay(cam, 1, 0.5, 0.25);
    const before = dolly(cam, 1, ray); // factor 1: nothing changes
    expect(before.target).toEqual(cam.target);
    const zoomed = dolly(cam, 0.5, ray);
    // The cursor ray in the new camera must still pass through the same world point.
    const after = screenRay(zoomed, 1, 0.5, 0.25);
    const pivot = sub(ray.origin, after.origin);
    const c = cross(pivot, after.dir);
    expect(Math.hypot(c.x, c.y, c.z)).toBeLessThan(0.05);
  });

  it('frame centres the bounds and backs far enough away', () => {
    const cam = frame(DEFAULT_CAMERA, vec3(0, 0, 0), vec3(16, 16, 16));
    expect(cam.target).toEqual(vec3(8, 8, 8));
    expect(cam.distance).toBeGreaterThan(16);
  });

  it('ortho matches perspective scale at the target plane', () => {
    // Front view so an x-offset point stays exactly at target depth — the plane where the
    // ortho frustum is sized to agree with the perspective one (docs/11 §6).
    const cam = standardView(DEFAULT_CAMERA, 'front');
    const view = viewMatrix(cam);
    const pt = transformPoint(view, vec3(cam.target.x + 5, cam.target.y, cam.target.z));
    const px = transformPoint(projMatrix({ ...cam, projection: 'perspective' }, 1), pt).x;
    const ox = transformPoint(projMatrix({ ...cam, projection: 'orthographic' }, 1), pt).x;
    expect(px).toBeCloseTo(ox, 3);
  });
});

describe('java model refs', () => {
  it('normalizes and maps to paths', () => {
    expect(normalizeRef('block/cube_all')).toBe('minecraft:block/cube_all');
    expect(modelRefToPath('block/cube_all')).toBe('assets/minecraft/models/block/cube_all.json');
    expect(textureRefToPath('mymod:item/wand')).toBe('assets/mymod/textures/item/wand.png');
  });
});

describe('java model resolution', () => {
  const lookup = (models: Record<string, RawJavaModel>) => (ref: string) =>
    models[ref] ?? builtinParent(ref);

  it('resolves a cube_all chain via the builtin table', () => {
    const stone: RawJavaModel = { parent: 'block/cube_all', textures: { all: 'block/stone' } };
    const m = resolveJavaModel(stone, lookup({}));
    expect(m.missing).toEqual([]);
    expect(m.elements).toHaveLength(1);
    expect(Object.keys(m.elements[0].faces)).toHaveLength(6);
    // Faces keep their own variables (north, down, …); the TEXTURES map routes each of
    // them through #all to the concrete stone ref.
    for (const f of FACES) {
      const varName = m.elements[0].faces[f]!.texture;
      expect(m.textures[varName]).toBe('minecraft:block/stone');
    }
    expect(m.textures.all).toBe('minecraft:block/stone');
  });

  it("a child's elements replace the parent's entirely", () => {
    const models: Record<string, RawJavaModel> = {
      'minecraft:block/parent': {
        elements: [
          { from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#a' } } },
          { from: [0, 0, 0], to: [8, 8, 8], faces: { up: { texture: '#a' } } },
        ],
      },
    };
    const child: RawJavaModel = {
      parent: 'block/parent',
      elements: [{ from: [2, 2, 2], to: [14, 14, 14], faces: { up: { texture: '#a' } } }],
    };
    const m = resolveJavaModel(child, lookup(models));
    expect(m.elements).toHaveLength(1);
    expect(m.elements[0].from).toEqual(vec3(2, 2, 2));
  });

  it('texture merge is child-wins and follows #chains with a cycle guard', () => {
    const models: Record<string, RawJavaModel> = {
      'minecraft:block/p': {
        textures: { side: '#base', base: 'block/old', loop: '#loop2', loop2: '#loop' },
      },
    };
    const child: RawJavaModel = { parent: 'block/p', textures: { base: 'block/new' } };
    const m = resolveJavaModel(child, lookup(models));
    expect(m.textures.side).toBe('minecraft:block/new');
    expect(m.textures.loop.startsWith('#')).toBe(true); // cycle reported, not looped forever
  });

  it('an unknown parent lands in missing and still returns a model', () => {
    const m = resolveJavaModel({ parent: 'mymod:block/widget' }, () => null);
    expect(m.missing).toEqual(['mymod:block/widget']);
    expect(m.elements).toEqual([]);
  });

  it('item/generated is flagged, not resolved', () => {
    const m = resolveJavaModel(
      { parent: 'item/generated', textures: { layer0: 'item/apple' } },
      () => null,
    );
    expect(m.generated).toBe(true);
    expect(m.missing).toEqual([]);
  });

  it('stairs from the builtin table has two elements and side uvs', () => {
    const m = resolveJavaModel(
      {
        parent: 'block/stairs',
        textures: { bottom: 'block/stone', top: 'block/stone', side: 'block/stone' },
      },
      lookup({}),
    );
    expect(m.elements).toHaveLength(2);
    expect(m.elements[1].from.y).toBe(8);
  });
});

describe('default UVs', () => {
  it('a full cube gets the full texture on every face', () => {
    for (const f of FACES) {
      expect(defaultUV(f, vec3(0, 0, 0), vec3(16, 16, 16))).toEqual([0, 0, 16, 16]);
    }
  });

  it('a slab maps side faces to the lower half of the texture', () => {
    // Top of the element (y=8) must sample v=8 (from the texture top): 16-8.
    expect(defaultUV('north', vec3(0, 0, 0), vec3(16, 8, 16))).toEqual([0, 8, 16, 16]);
  });
});

describe('geometry', () => {
  it('winding is uniform: cross(sEdge, tEdge) points inward on every face', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(16, 16, 16);
    const outward = {
      north: vec3(0, 0, -1),
      south: vec3(0, 0, 1),
      east: vec3(1, 0, 0),
      west: vec3(-1, 0, 0),
      up: vec3(0, 1, 0),
      down: vec3(0, -1, 0),
    };
    for (const f of FACES) {
      const [c0, c1, , c3] = faceCorners(f, a, b);
      const n = cross(sub(c1, c0), sub(c3, c0));
      const dot = n.x * outward[f].x + n.y * outward[f].y + n.z * outward[f].z;
      expect(dot).toBeLessThan(0);
    }
  });

  it('faceST inverts faceCorners at all four corners', () => {
    const a = vec3(2, 3, 4);
    const b = vec3(10, 12, 9);
    const st: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (const f of FACES) {
      const corners = faceCorners(f, a, b);
      corners.forEach((c, i) => {
        const got = faceST(f, a, b, c);
        expect(got.s).toBeCloseTo(st[i][0], 6);
        expect(got.t).toBeCloseTo(st[i][1], 6);
      });
    }
  });

  it('rotateST composes: four 90s are identity, two are 180', () => {
    let p = { s: 0.25, t: 0.75 };
    for (let i = 0; i < 4; i++) p = rotateST(90, p.s, p.t);
    expect(p.s).toBeCloseTo(0.25);
    expect(p.t).toBeCloseTo(0.75);
    const once = rotateST(90, 0.25, 0.75);
    const twice = rotateST(90, once.s, once.t);
    const direct = rotateST(180, 0.25, 0.75);
    expect(twice).toEqual(direct);
  });

  it('stToUV maps the rect and normalizes', () => {
    const uv = stToUV([4, 8, 8, 16], 0, 0.5, 0.5);
    expect(uv.u).toBeCloseTo(6 / 16);
    expect(uv.v).toBeCloseTo(12 / 16);
  });

  it('builds 4 verts and 6 indices per face, batched per texture', () => {
    const two = [
      el(),
      el({
        id: 2,
        faces: { up: { uv: [0, 0, 16, 16], texture: 'other' } },
        from: vec3(0, 16, 0),
        to: vec3(16, 18, 16),
      }),
    ];
    const mesh = buildMesh(two);
    expect(mesh.faceCount).toBe(7);
    expect(mesh.positions.length).toBe(7 * 4 * 3);
    expect(mesh.indices.length).toBe(7 * 6);
    expect(mesh.batches.map((b) => b.textureVar).sort()).toEqual(['all', 'other']);
    expect(mesh.batches.reduce((n, b) => n + b.count, 0)).toBe(7 * 6);
  });

  it('rotation with rescale keeps a 45° cross plane spanning the block', () => {
    const plane = el({
      rotation: { origin: vec3(8, 8, 8), axis: 'y', angle: 45, rescale: true },
      from: vec3(0.8, 0, 8),
      to: vec3(15.2, 16, 8),
    });
    const p = applyElementRotation(plane, vec3(0.8, 0, 8));
    // Rescaled by 1/cos45 then rotated 45°: the corner lands near the block corner.
    expect(Math.hypot(p.x - 8, p.z - 8)).toBeGreaterThan(9.5);
    expect(p.y).toBe(0);
  });

  it('bounds cover rotated elements and default to the unit block when empty', () => {
    const b = modelBounds([el({ rotation: { origin: vec3(8, 8, 8), axis: 'y', angle: 45 } })]);
    expect(b.min.x).toBeLessThan(0);
    expect(b.max.x).toBeGreaterThan(16);
    expect(modelBounds([])).toEqual({ min: vec3(0, 0, 0), max: vec3(16, 16, 16) });
  });
});

describe('picking', () => {
  const cube = [el()];

  it('a ray straight at the south face hits it at the right texel', () => {
    const hit = pickModel(cube, { origin: vec3(4, 12, 40), dir: vec3(0, 0, -1) })!;
    expect(hit.face).toBe('south');
    expect(hit.elementId).toBe(1);
    // x=4 → s=0.25 → u=0.25; y=12 → t=(16-12)/16=0.25 → v=0.25.
    expect(hit.uvNorm.u).toBeCloseTo(0.25, 5);
    expect(hit.uvNorm.v).toBeCloseTo(0.25, 5);
    expect(hit.point.z).toBeCloseTo(16, 5);
  });

  it('picks the nearest of two boxes and respects visibility', () => {
    const near = el({ id: 2, from: vec3(0, 0, 20), to: vec3(16, 16, 24) });
    const hit = pickModel([...cube, near], { origin: vec3(8, 8, 40), dir: vec3(0, 0, -1) })!;
    expect(hit.elementId).toBe(2);
    const hidden = pickModel([cube[0], { ...near, visible: false }], {
      origin: vec3(8, 8, 40),
      dir: vec3(0, 0, -1),
    })!;
    expect(hidden.elementId).toBe(1);
  });

  it('a missing face is transparent: the ray hits what is behind', () => {
    const openFront = el({
      id: 3,
      from: vec3(0, 0, 20),
      to: vec3(16, 16, 24),
      faces: { up: { uv: [0, 0, 16, 16], texture: 'all' } }, // no south face
    });
    const hit = pickModel([cube[0], openFront], { origin: vec3(8, 8, 40), dir: vec3(0, 0, -1) })!;
    expect(hit.elementId).toBe(1);
    expect(hit.face).toBe('south');
  });

  it('misses cleanly and ignores rays starting inside', () => {
    expect(pickModel(cube, { origin: vec3(40, 40, 40), dir: vec3(0, 0, -1) })).toBeNull();
    expect(pickModel(cube, { origin: vec3(8, 8, 8), dir: vec3(0, 0, -1) })).toBeNull();
  });

  it('face uv rect and rotation flow into uvNorm', () => {
    const halfUV = el({
      faces: { south: { uv: [8, 0, 16, 8], texture: 'all', rotation: 180 } },
    });
    const hit = pickModel([halfUV], { origin: vec3(4, 12, 40), dir: vec3(0, 0, -1) })!;
    // s=0.25,t=0.25 → rot180 → (0.75,0.75) → u=(8+0.75*8)/16=0.875, v=(0+0.75*8)/16=0.375.
    expect(hit.uvNorm.u).toBeCloseTo(0.875, 5);
    expect(hit.uvNorm.v).toBeCloseTo(0.375, 5);
  });

  it('rotated elements pick in their rotated position', () => {
    const spun = el({ rotation: { origin: vec3(8, 8, 8), axis: 'y', angle: 45 } });
    // The 45°-rotated cube's corner pokes out to z ≈ 8 + 8√2: a centre ray must enter there,
    // beyond the unrotated box's z=16 face…
    const nose = pickModel([spun], { origin: vec3(8, 8, 40), dir: vec3(0, 0, -1) })!;
    expect(nose.point.z).toBeGreaterThan(16);
    // …and a ray outside the rotated footprint (x > 8 + 8√2) misses even though an
    // unrotated 0..16 box would not exist there either way.
    expect(pickModel([spun], { origin: vec3(19.9, 8, 40), dir: vec3(0, 0, -1) })).toBeNull();
  });

  it('picking agrees with geometry: the hit texel is the drawn texel', () => {
    // The invariant that makes 3D painting honest (docs/11 §7): sample the mesh's uv at the
    // hit's (s,t) corner interpolation and compare with the pick's uvNorm.
    const box = el({ from: vec3(2, 2, 2), to: vec3(14, 10, 12) });
    const hit = pickModel([box], { origin: vec3(5, 6, 40), dir: vec3(0, 0, -1) })!;
    const st = faceST('south', box.from, box.to, vec3(5, 6, box.to.z));
    const uv = stToUV(box.faces.south!.uv, 0, st.s, st.t);
    expect(hit.uvNorm.u).toBeCloseTo(uv.u, 6);
    expect(hit.uvNorm.v).toBeCloseTo(uv.v, 6);
  });
});
