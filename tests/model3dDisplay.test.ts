import { describe, expect, it } from 'vitest';
import { vec3, type DisplaySlot, type Model3D, type ModelElement } from '../src/core/model3d/types';
import {
  VANILLA_BLOCK_DISPLAY,
  clampScale,
  clampTranslation,
  displayMatrix,
  effectiveSlot,
} from '../src/core/model3d/display';
import { transformPoint } from '../src/core/model3d/vec';
import { SetDisplayCommand } from '../src/core/model3d/commands';

const el = (): ModelElement => ({
  id: 1,
  name: 'cube 1',
  groupId: null,
  from: vec3(0, 0, 0),
  to: vec3(16, 16, 16),
  faces: {},
  visible: true,
  locked: false,
});

const model = (over: Partial<Model3D> = {}): Model3D => ({
  kind: 'model',
  id: 'm1',
  name: 'test',
  dirty: false,
  format: 'java_block',
  unit: 16,
  elements: [el()],
  groups: [],
  textures: {},
  missing: [],
  camera: {
    target: vec3(8, 8, 8),
    yaw: 0,
    pitch: 0,
    distance: 40,
    projection: 'perspective',
    fov: 50,
  },
  vanillaMode: true,
  nextItemId: 2,
  ...over,
});

describe('display slots', () => {
  it('falls back to vanilla defaults, and the model wins per field', () => {
    expect(effectiveSlot('gui', undefined).rotation).toEqual(vec3(30, 225, 0));
    expect(effectiveSlot('gui', undefined).scale).toEqual(vec3(0.625, 0.625, 0.625));
    // Declaring only a scale keeps vanilla's gui rotation.
    const mine: Record<string, DisplaySlot> = { gui: { scale: vec3(1, 1, 1) } };
    const eff = effectiveSlot('gui', mine);
    expect(eff.scale).toEqual(vec3(1, 1, 1));
    expect(eff.rotation).toEqual(VANILLA_BLOCK_DISPLAY.gui!.rotation);
  });

  it('gives an undeclared, non-vanilla slot an identity transform', () => {
    const eff = effectiveSlot('thirdperson_lefthand', undefined);
    expect(eff.scale).toEqual(vec3(0.375, 0.375, 0.375));
    const m = displayMatrix(effectiveSlot('fixed', { fixed: {} }));
    // fixed's own default halves the model about the centre: corner 0 → 4.
    expect(transformPoint(m, vec3(0, 0, 0))).toEqual({ x: 4, y: 4, z: 4 });
  });

  it('scales and rotates about the block centre, not the origin', () => {
    const half = displayMatrix({ scale: vec3(0.5, 0.5, 0.5) });
    expect(transformPoint(half, vec3(8, 8, 8))).toEqual({ x: 8, y: 8, z: 8 }); // centre fixed
    expect(transformPoint(half, vec3(16, 16, 16))).toEqual({ x: 12, y: 12, z: 12 });

    const spin = displayMatrix({ rotation: vec3(0, 90, 0) });
    const p = transformPoint(spin, vec3(16, 8, 8)); // +x edge, 90° about y
    expect(p.x).toBeCloseTo(8, 5);
    expect(p.y).toBeCloseTo(8, 5);
    expect(p.z).toBeCloseTo(0, 5); // swung to −z
  });

  it('translates in model units', () => {
    const m = displayMatrix({ translation: vec3(0, 3, 0) });
    expect(transformPoint(m, vec3(8, 0, 8))).toEqual({ x: 8, y: 3, z: 8 });
  });

  it('clamps translation to ±80 and scale to 4, as Minecraft does', () => {
    expect(clampTranslation(200)).toBe(80);
    expect(clampTranslation(-200)).toBe(-80);
    expect(clampScale(9)).toBe(4);
    const m = displayMatrix({ scale: vec3(9, 9, 9) });
    expect(transformPoint(m, vec3(16, 8, 8)).x).toBe(40); // 8 + 8×4, not 8 + 8×9
  });
});

describe('SetDisplayCommand', () => {
  it('sets, clears and undoes one slot without touching the others', () => {
    const m = model({ display: { head: { scale: vec3(1, 1, 1) } } });
    const set = new SetDisplayCommand('set gui', m, 'gui', { rotation: vec3(0, 45, 0) });
    set.do(m);
    expect(m.display!.gui).toEqual({ rotation: vec3(0, 45, 0) });
    expect(m.display!.head).toEqual({ scale: vec3(1, 1, 1) });
    set.undo(m);
    expect(m.display!.gui).toBeUndefined();
    expect(m.display!.head).toEqual({ scale: vec3(1, 1, 1) });

    const clear = new SetDisplayCommand('clear head', m, 'head', undefined);
    clear.do(m);
    expect(m.display).toBeUndefined(); // last slot gone → no empty object left behind
    clear.undo(m);
    expect(m.display!.head).toEqual({ scale: vec3(1, 1, 1) });
  });

  it('snapshots, so later edits cannot rewrite history', () => {
    const m = model();
    const slot: DisplaySlot = { rotation: vec3(0, 45, 0) };
    const cmd = new SetDisplayCommand('set', m, 'gui', slot);
    cmd.do(m);
    slot.rotation!.y = 999; // caller keeps fiddling with the object it passed in
    m.display!.gui!.rotation!.y = 123; // and the document is edited afterwards
    cmd.undo(m);
    cmd.do(m);
    expect(m.display!.gui!.rotation!.y).toBe(45);
  });
});
