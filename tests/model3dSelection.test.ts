import { describe, expect, it } from 'vitest';
import { vec3, type Model3D, type ModelElement } from '../src/core/model3d/types';
import { elementScreenRect, elementsInBox, rectsOverlap } from '../src/core/model3d/screen';
import { AddElementsCommand, PatchElementsCommand } from '../src/core/model3d/commands';
import { projMatrix, viewMatrix } from '../src/core/model3d/camera';
import { multiply } from '../src/core/model3d/vec';

const el = (
  id: number,
  from: [number, number, number],
  to: [number, number, number],
  visible = true,
): ModelElement => ({
  id,
  name: `cube ${id}`,
  groupId: null,
  from: vec3(...from),
  to: vec3(...to),
  faces: {},
  visible,
  locked: false,
});

const model = (elements: ModelElement[]): Model3D => ({
  kind: 'model',
  id: 'm1',
  name: 'test',
  dirty: false,
  format: 'java_block',
  unit: 16,
  elements,
  groups: [],
  textures: {},
  missing: [],
  camera: {
    target: vec3(8, 8, 8),
    yaw: 0,
    pitch: 0,
    distance: 40,
    projection: 'orthographic',
    fov: 50,
  },
  vanillaMode: true,
  nextItemId: 9,
});

/** Front orthographic view, 200×200 — x runs right, y runs up, so screen y is inverted. */
const frontVP = () => {
  const cam = model([]).camera;
  return multiply(projMatrix(cam, 1), viewMatrix(cam));
};

describe('screen projection for box-select', () => {
  it('projects a block-filling cube to a centred rectangle', () => {
    const r = elementScreenRect(el(1, [0, 0, 0], [16, 16, 16]), frontVP(), 200, 200)!;
    expect(r.x).toBeCloseTo(100 - r.w / 2, 4); // centred horizontally
    expect(r.w).toBeCloseTo(r.h, 4); // square in a square viewport
    expect(r.w).toBeGreaterThan(0);
  });

  it('a smaller element projects to a smaller, offset rectangle', () => {
    const big = elementScreenRect(el(1, [0, 0, 0], [16, 16, 16]), frontVP(), 200, 200)!;
    const small = elementScreenRect(el(2, [0, 0, 0], [4, 4, 4]), frontVP(), 200, 200)!;
    expect(small.w).toBeLessThan(big.w);
    expect(small.x).toBeCloseTo(big.x, 4); // shares the -x edge
    // Screen y is inverted, so a low element sits at the BOTTOM: larger y.
    expect(small.y + small.h).toBeCloseTo(big.y + big.h, 4);
  });

  it('rectsOverlap is edge-exclusive', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsOverlap(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it('selects only the elements a box touches, skipping hidden ones', () => {
    const vp = frontVP();
    const left = el(1, [0, 0, 0], [4, 16, 4]);
    const right = el(2, [12, 0, 0], [16, 16, 4]);
    const hidden = el(3, [0, 0, 0], [16, 16, 16], false);
    const all = [left, right, hidden];
    // A box over the left half of a 200-px viewport.
    expect(elementsInBox(all, { x: 0, y: 0, w: 100, h: 200 }, vp, 200, 200)).toEqual([1]);
    expect(elementsInBox(all, { x: 100, y: 0, w: 100, h: 200 }, vp, 200, 200)).toEqual([2]);
    expect(elementsInBox(all, { x: 0, y: 0, w: 200, h: 200 }, vp, 200, 200)).toEqual([1, 2]);
    expect(elementsInBox(all, { x: 0, y: 0, w: 1, h: 1 }, vp, 200, 200)).toEqual([]);
  });
});

describe('multi-element commands', () => {
  it('patches several elements as one step and undoes them together', () => {
    const m = model([el(1, [0, 0, 0], [4, 4, 4]), el(2, [8, 0, 0], [12, 4, 4])]);
    const pairs = m.elements.map((e) => ({
      before: e,
      after: { ...JSON.parse(JSON.stringify(e)), from: vec3(e.from.x + 2, e.from.y, e.from.z) },
    }));
    const cmd = new PatchElementsCommand('move', pairs);
    cmd.do(m);
    expect(m.elements.map((e) => e.from.x)).toEqual([2, 10]);
    cmd.undo(m);
    expect(m.elements.map((e) => e.from.x)).toEqual([0, 8]);
  });

  it('adds several elements as one step, snapshot-isolated', () => {
    const m = model([el(1, [0, 0, 0], [4, 4, 4])]);
    const copies = [el(2, [4, 0, 0], [8, 4, 4]), el(3, [8, 0, 0], [12, 4, 4])];
    const cmd = new AddElementsCommand('duplicate', copies);
    cmd.do(m);
    expect(m.elements.map((e) => e.id)).toEqual([1, 2, 3]);
    m.elements[1].from.x = 99; // keep editing after the command ran
    cmd.undo(m);
    expect(m.elements.map((e) => e.id)).toEqual([1]);
    cmd.do(m);
    expect(m.elements[1].from.x).toBe(4); // the snapshot, not the drifted value
  });
});
