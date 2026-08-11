/**
 * Test-jar builder. Runs in Node (scenarios are Node modules), writes a real zip with real
 * PNGs so the app's jszip/createImageBitmap paths are exercised, not mocked. Exists because
 * scenarios used to lean on a /tmp/fake.jar nothing recreated — a fresh clone broke them.
 */
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

// ---------------------------------------------------------------- tiny PNG encoder

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

/** Solid-colour (or per-pixel callback) RGBA PNG. */
export function makePng(width, height, colorOrFn) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = typeof colorOrFn === 'function' ? colorOrFn(x, y) : colorOrFn;
      const o = row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- fixture jars

/** Vanilla-faithful model JSON used by the 3D scenarios. */
const MODELS = {
  'assets/minecraft/models/block/block.json': {},
  'assets/minecraft/models/block/cube.json': {
    parent: 'block/block',
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          down: { texture: '#down', cullface: 'down' },
          up: { texture: '#up', cullface: 'up' },
          north: { texture: '#north', cullface: 'north' },
          south: { texture: '#south', cullface: 'south' },
          west: { texture: '#west', cullface: 'west' },
          east: { texture: '#east', cullface: 'east' },
        },
      },
    ],
  },
  'assets/minecraft/models/block/cube_all.json': {
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
  'assets/minecraft/models/block/stone.json': {
    parent: 'minecraft:block/cube_all',
    textures: { all: 'minecraft:block/stone' },
  },
  'assets/minecraft/models/block/stairs.json': {
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
  'assets/minecraft/models/block/stone_stairs.json': {
    parent: 'minecraft:block/stairs',
    textures: {
      bottom: 'minecraft:block/stone',
      top: 'minecraft:block/stone',
      side: 'minecraft:block/stone',
    },
  },
  // Unknown namespace parent: must open with a banner, never crash (docs/11 §4.2).
  'assets/minecraft/models/block/broken.json': {
    parent: 'mymod:block/does_not_exist',
  },
  'assets/minecraft/models/item/apple.json': {
    parent: 'minecraft:item/generated',
    textures: { layer0: 'minecraft:item/apple' },
  },
};

/**
 * The 3D-mode fixture jar: textures + model JSONs with a real parent chain in the jar.
 * The stone texture is deliberately non-uniform (two greys, one red texel at 1,1) so
 * orientation and texel addressing are visible in probes.
 */
export async function writeModelJar(path) {
  const zip = new JSZip();
  zip.file(
    'assets/minecraft/textures/block/stone.png',
    makePng(16, 16, (x, y) =>
      x === 1 && y === 1
        ? [224, 60, 60, 255]
        : (x + y) % 2
          ? [128, 128, 128, 255]
          : [143, 143, 143, 255],
    ),
  );
  zip.file('assets/minecraft/textures/item/apple.png', makePng(16, 16, [224, 60, 60, 255]));
  for (const [p, json] of Object.entries(MODELS)) zip.file(p, JSON.stringify(json));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(path, bytes);
  return path;
}

/** The four-texture jar the `sources` scenario has always used. */
export async function writeTextureJar(path) {
  const zip = new JSZip();
  zip.file('assets/minecraft/textures/block/stone.png', makePng(16, 16, [143, 143, 143, 255]));
  zip.file(
    'assets/minecraft/textures/block/water_still.png',
    makePng(16, 512, [63, 118, 228, 255]),
  );
  zip.file('assets/minecraft/textures/item/apple.png', makePng(16, 16, [224, 60, 60, 255]));
  zip.file(
    'assets/minecraft/textures/item/diamond_sword.png',
    makePng(16, 16, [92, 219, 213, 255]),
  );
  zip.file(
    'assets/minecraft/textures/block/water_still.png.mcmeta',
    JSON.stringify({ animation: {} }),
  );
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(path, bytes);
  return path;
}
