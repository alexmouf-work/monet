import { describe, expect, it } from 'vitest';
import { vec3, type Model3D, type ModelElement } from '../src/core/model3d/types';
import { elementsSignature, writeJavaModel } from '../src/core/model3d/javaModelWriter';
import { toBedrockPoint, writeBedrockGeometry } from '../src/core/model3d/bedrockWriter';
import { readMonetModel, writeMonetModel } from '../src/core/model3d/monetModelFile';
import { resolveJavaModel, type RawJavaModel } from '../src/core/model3d/javaModel';

const el = (over: Partial<ModelElement> = {}): ModelElement => ({
  id: 1,
  name: 'cube 1',
  groupId: null,
  from: vec3(2, 0, 4),
  to: vec3(6, 8, 10),
  faces: {
    north: { uv: [0, 0, 16, 16], texture: 'all' },
    east: { uv: [0, 0, 8, 16], texture: 'all' },
    up: { uv: [0, 0, 16, 16], texture: 'all' },
  },
  visible: true,
  locked: false,
  ...over,
});

const model = (over: Partial<Model3D> = {}): Model3D => ({
  kind: 'model',
  id: 'm1',
  name: 'test model',
  dirty: false,
  format: 'java_block',
  unit: 16,
  elements: [el()],
  groups: [],
  textures: {
    all: {
      kind: 'file',
      sourceId: 's',
      path: 'assets/minecraft/textures/block/stone.png',
      width: 64,
      height: 32,
    },
  },
  missing: [],
  camera: {
    target: vec3(8, 8, 8),
    yaw: 20,
    pitch: 10,
    distance: 40,
    projection: 'orthographic',
    fov: 50,
  },
  vanillaMode: true,
  nextItemId: 2,
  ...over,
});

describe('java writer round-trip (docs/11 §13.1)', () => {
  const raw: RawJavaModel = {
    parent: 'minecraft:block/cube_all',
    textures: { all: 'minecraft:block/stone' },
    custom_mod_key: { anything: [1, 2, 3] },
  };

  it('preserves parent and unknown top-level keys', () => {
    const json = writeJavaModel(model({ raw: raw as Record<string, unknown> }));
    const back = JSON.parse(json) as RawJavaModel;
    expect(back.parent).toBe('minecraft:block/cube_all');
    expect(back.custom_mod_key).toEqual({ anything: [1, 2, 3] });
  });

  it('leaves inherited geometry inherited when it has not been touched', () => {
    const elements = [el()];
    const m = model({
      raw: raw as Record<string, unknown>,
      elements,
      baseline: elementsSignature(elements),
    });
    expect(JSON.parse(writeJavaModel(m)).elements).toBeUndefined();

    // Move one corner: the file must now carry its own elements.
    m.elements[0].to = vec3(7, 8, 10);
    const out = JSON.parse(writeJavaModel(m)) as RawJavaModel;
    expect(out.elements).toHaveLength(1);
    expect(out.elements![0].to).toEqual([7, 8, 10]);
    expect(out.parent).toBe('minecraft:block/cube_all'); // child elements replace, parent stays
  });

  it('writes elements for a model that owns them, keeping per-element and per-face extras', () => {
    const m = model({
      raw: { elements: [{}] } as unknown as Record<string, unknown>,
      elements: [
        el({
          extra: { mod_flag: true },
          faces: { north: { uv: [0, 0, 16, 16], texture: 'all', extra: { emissive: 15 } } },
        }),
      ],
    });
    const out = JSON.parse(writeJavaModel(m)) as RawJavaModel;
    expect(out.elements![0].mod_flag).toBe(true);
    expect(out.elements![0].faces!.north.emissive).toBe(15);
    expect(out.elements![0].faces!.north.texture).toBe('#all');
  });

  it('parse → write → parse keeps unknown keys alive through a real resolve', () => {
    const source: RawJavaModel = {
      textures: { all: 'minecraft:block/stone' },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          weird_key: 'kept',
          faces: { up: { texture: '#all', uv: [0, 0, 16, 16], forge_data: 7 } },
        },
      ],
    };
    const resolved = resolveJavaModel(source, () => null);
    expect(resolved.elements[0].extra).toEqual({ weird_key: 'kept' });
    expect(resolved.elements[0].faces.up!.extra).toEqual({ forge_data: 7 });

    const again = JSON.parse(
      writeJavaModel(
        model({ elements: resolved.elements, raw: source as Record<string, unknown> }),
      ),
    ) as RawJavaModel;
    expect(again.elements![0].weird_key).toBe('kept');
    expect(again.elements![0].faces!.up.forge_data).toBe(7);
  });

  it('re-declares only the texture vars the source owned', () => {
    const m = model({
      raw: {
        parent: 'minecraft:block/cube_all',
        textures: { all: 'minecraft:block/dirt' },
      } as Record<string, unknown>,
      textures: {
        all: {
          kind: 'file',
          sourceId: 's',
          path: 'assets/minecraft/textures/block/stone.png',
          width: 16,
          height: 16,
        },
        // Inherited from the parent chain — not the child's to declare.
        particle: { kind: 'unresolved', ref: 'minecraft:block/dirt' },
      },
    });
    expect(JSON.parse(writeJavaModel(m)).textures).toEqual({ all: 'minecraft:block/stone' });
  });
});

describe('bedrock geometry writer (docs/11 §13.3)', () => {
  it('mirrors x and re-centres, so the origin comes from `to.x`', () => {
    // Java 2..6 in x becomes 2..6 mirrored about 8 → Bedrock 2..6 as [8-6, 8-2] = [2, 6].
    expect(toBedrockPoint(vec3(6, 0, 4))).toEqual([2, 0, -4]);
    const geo = JSON.parse(writeBedrockGeometry(model())) as {
      'minecraft:geometry': { bones: { cubes: Record<string, unknown>[] }[] }[];
    };
    const cube = geo['minecraft:geometry'][0].bones[0].cubes[0];
    expect(cube.origin).toEqual([2, 0, -4]); // 8 − to.x, from.y, from.z − 8
    expect(cube.size).toEqual([4, 8, 6]);
  });

  it('swaps east and west and converts uv units to texture pixels', () => {
    const geo = JSON.parse(writeBedrockGeometry(model())) as {
      'minecraft:geometry': {
        description: Record<string, unknown>;
        bones: { cubes: { uv: Record<string, { uv: number[]; uv_size: number[] }> }[] }[];
      }[];
    };
    const entry = geo['minecraft:geometry'][0];
    expect(entry.description.texture_width).toBe(64);
    expect(entry.description.texture_height).toBe(32);
    const uv = entry.bones[0].cubes[0].uv;
    // Java's east face lands on Bedrock's west; uv [0,0,8,16] over 64×32 → 32×32 px.
    expect(uv.west.uv_size).toEqual([32, 32]);
    expect(uv.east).toBeUndefined();
    expect(uv.north.uv_size).toEqual([64, 32]);
  });

  it('negates y/z rotations (x is mirrored) and keeps x rotations', () => {
    const spinY = writeBedrockGeometry(
      model({ elements: [el({ rotation: { origin: vec3(4, 0, 4), axis: 'y', angle: 22.5 } })] }),
    );
    const cubeY = JSON.parse(spinY)['minecraft:geometry'][0].bones[0].cubes[0];
    expect(cubeY.rotation).toEqual([0, -22.5, 0]);
    expect(cubeY.pivot).toEqual([4, 0, -4]);

    const spinX = writeBedrockGeometry(
      model({ elements: [el({ rotation: { origin: vec3(4, 0, 4), axis: 'x', angle: 22.5 } })] }),
    );
    expect(JSON.parse(spinX)['minecraft:geometry'][0].bones[0].cubes[0].rotation).toEqual([
      22.5, 0, 0,
    ]);
  });

  it('sanitises the identifier', () => {
    const geo = JSON.parse(writeBedrockGeometry(model({ name: 'My Cool Model!' })));
    expect(geo['minecraft:geometry'][0].description.identifier).toBe('geometry.my_cool_model');
  });
});

describe('.monet_model project file (docs/11 §3)', () => {
  it('round-trips geometry, textures, camera and the round-trip baseline', async () => {
    const source = model({
      raw: { parent: 'minecraft:block/cube_all' } as Record<string, unknown>,
      baseline: 'sig',
      display: { gui: { rotation: vec3(30, 225, 0), scale: vec3(0.625, 0.625, 0.625) } },
      vanillaMode: false,
    });
    const back = await readMonetModel(await writeMonetModel(source), 'm2');
    expect(back.id).toBe('m2');
    expect(back.name).toBe('test model');
    expect(back.elements).toEqual(source.elements);
    expect(back.textures).toEqual(source.textures);
    expect(back.camera).toEqual(source.camera);
    expect(back.raw).toEqual({ parent: 'minecraft:block/cube_all' });
    expect(back.baseline).toBe('sig');
    expect(back.display).toEqual(source.display);
    expect(back.vanillaMode).toBe(false);
    expect(back.dirty).toBe(false);
    expect(back.nextItemId).toBe(2);
  });

  it('rejects files that are not Monet model projects', async () => {
    await expect(readMonetModel(new Uint8Array([1, 2, 3]), 'x')).rejects.toThrow(/bad archive/);
  });
});
