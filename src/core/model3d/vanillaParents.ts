/**
 * Built-in table of the most common vanilla parent models — docs/11 §4.2 step 3 — so a
 * model opens usefully with NO jar connected. Geometry-faithful to vanilla (same elements,
 * same texture variables); not byte-faithful (comments, ordering and redundant keys differ),
 * which is fine because these are only ever merge inputs, never written back out.
 */
import type { RawJavaModel } from './javaModel';

const fullCubeFaces = {
  down: { texture: '#down', cullface: 'down' },
  up: { texture: '#up', cullface: 'up' },
  north: { texture: '#north', cullface: 'north' },
  south: { texture: '#south', cullface: 'south' },
  west: { texture: '#west', cullface: 'west' },
  east: { texture: '#east', cullface: 'east' },
};

export const VANILLA_PARENTS: Record<string, RawJavaModel> = {
  'minecraft:block/block': {},

  'minecraft:block/cube': {
    parent: 'block/block',
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: fullCubeFaces }],
  },

  'minecraft:block/cube_all': {
    parent: 'block/cube',
    textures: {
      particle: '#all',
      down: '#all',
      up: '#all',
      north: '#all',
      east: '#all',
      south: '#all',
      west: '#all',
    },
  },

  'minecraft:block/cube_column': {
    parent: 'block/cube',
    textures: {
      particle: '#side',
      down: '#end',
      up: '#end',
      north: '#side',
      east: '#side',
      south: '#side',
      west: '#side',
    },
  },

  'minecraft:block/cube_bottom_top': {
    parent: 'block/cube',
    textures: {
      particle: '#side',
      down: '#bottom',
      up: '#top',
      north: '#side',
      east: '#side',
      south: '#side',
      west: '#side',
    },
  },

  'minecraft:block/cube_top': {
    parent: 'block/cube',
    textures: {
      particle: '#side',
      down: '#side',
      up: '#top',
      north: '#side',
      east: '#side',
      south: '#side',
      west: '#side',
    },
  },

  'minecraft:block/orientable': {
    parent: 'block/cube',
    textures: {
      particle: '#front',
      down: '#top',
      up: '#top',
      north: '#front',
      east: '#side',
      south: '#side',
      west: '#side',
    },
  },

  'minecraft:block/cross': {
    elements: [
      {
        from: [0.8, 0, 8],
        to: [15.2, 16, 8],
        rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
        shade: false,
        faces: {
          north: { uv: [0, 0, 16, 16], texture: '#cross' },
          south: { uv: [0, 0, 16, 16], texture: '#cross' },
        },
      },
      {
        from: [8, 0, 0.8],
        to: [8, 16, 15.2],
        rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
        shade: false,
        faces: {
          west: { uv: [0, 0, 16, 16], texture: '#cross' },
          east: { uv: [0, 0, 16, 16], texture: '#cross' },
        },
      },
    ],
  },

  'minecraft:block/slab': {
    textures: { particle: '#side' },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 8, 16],
        faces: {
          down: { texture: '#bottom', cullface: 'down' },
          up: { texture: '#top' },
          north: { uv: [0, 8, 16, 16], texture: '#side', cullface: 'north' },
          south: { uv: [0, 8, 16, 16], texture: '#side', cullface: 'south' },
          west: { uv: [0, 8, 16, 16], texture: '#side', cullface: 'west' },
          east: { uv: [0, 8, 16, 16], texture: '#side', cullface: 'east' },
        },
      },
    ],
  },

  'minecraft:block/slab_top': {
    textures: { particle: '#side' },
    elements: [
      {
        from: [0, 8, 0],
        to: [16, 16, 16],
        faces: {
          down: { texture: '#bottom' },
          up: { texture: '#top', cullface: 'up' },
          north: { uv: [0, 0, 16, 8], texture: '#side', cullface: 'north' },
          south: { uv: [0, 0, 16, 8], texture: '#side', cullface: 'south' },
          west: { uv: [0, 0, 16, 8], texture: '#side', cullface: 'west' },
          east: { uv: [0, 0, 16, 8], texture: '#side', cullface: 'east' },
        },
      },
    ],
  },

  'minecraft:block/stairs': {
    textures: { particle: '#side' },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 8, 16],
        faces: {
          down: { texture: '#bottom', cullface: 'down' },
          up: { texture: '#top' },
          north: { uv: [0, 8, 16, 16], texture: '#side', cullface: 'north' },
          south: { uv: [0, 8, 16, 16], texture: '#side', cullface: 'south' },
          west: { uv: [0, 8, 16, 16], texture: '#side', cullface: 'west' },
          east: { uv: [0, 8, 16, 16], texture: '#side', cullface: 'east' },
        },
      },
      {
        from: [8, 8, 0],
        to: [16, 16, 16],
        faces: {
          up: { texture: '#top', cullface: 'up' },
          north: { uv: [0, 0, 8, 8], texture: '#side', cullface: 'north' },
          south: { uv: [8, 0, 16, 8], texture: '#side', cullface: 'south' },
          west: { uv: [0, 0, 16, 8], texture: '#side' },
          east: { uv: [0, 0, 16, 8], texture: '#side', cullface: 'east' },
        },
      },
    ],
  },
};

export const builtinParent = (ref: string): RawJavaModel | null => VANILLA_PARENTS[ref] ?? null;
