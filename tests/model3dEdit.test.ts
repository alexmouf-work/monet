import { describe, expect, it } from 'vitest';
import { vec3, FACES, type Model3D, type ModelElement } from '../src/core/model3d/types';
import {
  AddElementCommand,
  PatchElementCommand,
  RemoveElementsCommand,
} from '../src/core/model3d/commands';
import { duplicateElement, mirrorElement, newCube } from '../src/core/model3d/edit';
import { LEGAL_ANGLES, snapLegalAngle, validateElement } from '../src/core/model3d/validate';
import { pathToTextureRef, writeJavaModel } from '../src/core/model3d/javaModelWriter';
import { resolveJavaModel, type RawJavaModel } from '../src/core/model3d/javaModel';
import { evalExpr } from '../src/core/model3d/expr';

const el = (over: Partial<ModelElement> = {}): ModelElement => ({
  id: 1,
  name: 'cube 1',
  groupId: null,
  from: vec3(2, 0, 4),
  to: vec3(6, 8, 10),
  faces: Object.fromEntries(FACES.map((f) => [f, { uv: [0, 0, 16, 16], texture: 'all' }])),
  visible: true,
  locked: false,
  ...over,
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
  textures: {
    all: {
      kind: 'file',
      sourceId: 's',
      path: 'assets/minecraft/textures/block/stone.png',
      width: 16,
      height: 16,
    },
  },
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
});

describe('model commands', () => {
  it('add / remove / patch round-trip through do and undo', () => {
    const m = model([el()]);
    const add = new AddElementCommand('add', newCube(2));
    add.do(m);
    expect(m.elements).toHaveLength(2);
    add.undo(m);
    expect(m.elements).toHaveLength(1);

    const before = m.elements[0];
    const after = { ...JSON.parse(JSON.stringify(before)), to: vec3(16, 8, 10) };
    const patch = new PatchElementCommand('patch', before, after);
    patch.do(m);
    expect(m.elements[0].to.x).toBe(16);
    patch.undo(m);
    expect(m.elements[0].to.x).toBe(6);

    const rm = new RemoveElementsCommand('rm', m, [1]);
    rm.do(m);
    expect(m.elements).toHaveLength(0);
    rm.undo(m);
    expect(m.elements[0].id).toBe(1);
    expect(m.elements[0].from).toEqual(vec3(2, 0, 4));
  });

  it('commands snapshot: later mutations do not corrupt history', () => {
    const m = model([]);
    const cube = newCube(5);
    const add = new AddElementCommand('add', cube);
    add.do(m);
    m.elements[0].from.x = 99; // user keeps editing
    add.undo(m);
    add.do(m);
    expect(m.elements[0].from.x).toBe(6); // the snapshot, not the drifted value
  });
});

describe('editing helpers', () => {
  it('duplicate offsets and renames', () => {
    const d = duplicateElement(el(), 9);
    expect(d.id).toBe(9);
    expect(d.from.x).toBe(3);
    expect(d.name).toContain('copy');
  });

  it('mirror reflects about the block centre and swaps opposing faces', () => {
    const source = el({
      faces: {
        east: { uv: [0, 0, 4, 4], texture: 'a' },
        west: { uv: [4, 4, 8, 8], texture: 'b' },
        up: { uv: [0, 0, 16, 16], texture: 'c' },
      },
    });
    const m = mirrorElement(source, 'x');
    // from.x 2..6 reflected about 8 → 10..14.
    expect(m.from.x).toBe(10);
    expect(m.to.x).toBe(14);
    expect(m.faces.east!.texture).toBe('b'); // swapped
    expect(m.faces.west!.texture).toBe('a');
    expect(m.faces.up!.texture).toBe('c'); // untouched
    expect(m.from.y).toBe(source.from.y);
  });

  it('mirror negates rotations about other axes and keeps the mirror axis', () => {
    const spun = el({ rotation: { origin: vec3(4, 4, 4), axis: 'y', angle: 22.5 } });
    expect(mirrorElement(spun, 'x').rotation!.angle).toBe(-22.5);
    expect(mirrorElement(spun, 'y').rotation!.angle).toBe(22.5);
    expect(mirrorElement(spun, 'x').rotation!.origin.x).toBe(12);
  });
});

describe('vanilla validation', () => {
  it('accepts a legal element', () => {
    expect(validateElement(el())).toEqual([]);
  });

  it('flags out-of-range coords, inverted boxes, illegal angles and bad uvs', () => {
    const bad = el({
      from: vec3(-20, 0, 0),
      to: vec3(-18, -2, 16),
      rotation: { origin: vec3(8, 8, 8), axis: 'y', angle: 30 },
      faces: { up: { uv: [0, 0, 20, 16], texture: 'all' } },
    });
    const messages = validateElement(bad).map((i) => i.message);
    expect(messages.some((m) => m.includes('-16..32'))).toBe(true);
    expect(messages.some((m) => m.includes('to < from'))).toBe(true);
    expect(messages.some((m) => m.includes('not one of'))).toBe(true);
    expect(messages.some((m) => m.includes('uv outside'))).toBe(true);
  });

  it('snaps to the nearest legal angle', () => {
    expect(snapLegalAngle(30)).toBe(22.5);
    expect(snapLegalAngle(40)).toBe(45);
    expect(snapLegalAngle(-10)).toBe(0);
    for (const a of LEGAL_ANGLES) expect(snapLegalAngle(a)).toBe(a);
  });
});

describe('java model writer', () => {
  it('maps texture paths back to refs', () => {
    expect(pathToTextureRef('assets/minecraft/textures/block/stone.png')).toBe(
      'minecraft:block/stone',
    );
    expect(pathToTextureRef('assets/mymod/textures/item/wand.png')).toBe('mymod:item/wand');
  });

  it('round-trips: written JSON parses back to the same geometry', () => {
    const m = model([
      el(),
      el({
        id: 2,
        name: 'leg',
        from: vec3(1, 0, 1),
        to: vec3(3, 7, 3),
        rotation: { origin: vec3(2, 0, 2), axis: 'y', angle: 22.5, rescale: true },
        shade: false,
      }),
    ]);
    const json = writeJavaModel(m);
    const raw = JSON.parse(json) as RawJavaModel;
    expect(raw.textures).toEqual({ all: 'minecraft:block/stone' });

    const back = resolveJavaModel(raw, () => null);
    expect(back.missing).toEqual([]);
    expect(back.elements).toHaveLength(2);
    expect(back.elements[0].from).toEqual(m.elements[0].from);
    expect(back.elements[1].rotation).toEqual(m.elements[1].rotation);
    expect(back.elements[1].shade).toBe(false);
    expect(back.elements[1].faces.up?.uv).toEqual([0, 0, 16, 16]);
    expect(back.textures.all).toBe('minecraft:block/stone');
  });

  it('writes vanilla-shaped JSON: #-prefixed face textures, tab indentation', () => {
    const json = writeJavaModel(model([el()]));
    expect(json).toContain('"texture": "#all"');
    expect(json).toContain('\t');
    expect(json.endsWith('\n')).toBe(true);
  });
});

describe('expression fields', () => {
  it('evaluates arithmetic and rejects junk', () => {
    expect(evalExpr('8+2')).toBe(10);
    expect(evalExpr('16/3')).toBeCloseTo(5.3333, 3);
    expect(evalExpr(' (1+2)*4 ')).toBe(12);
    expect(evalExpr('-3.5')).toBe(-3.5);
    expect(evalExpr('1/0')).toBeNull();
    expect(evalExpr('8+')).toBeNull();
    expect(evalExpr('two')).toBeNull();
    expect(evalExpr('alert(1)')).toBeNull();
    expect(evalExpr('')).toBeNull();
  });
});
