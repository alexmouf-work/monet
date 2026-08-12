/**
 * Bedrock `.geo.json` writer — docs/11 §13.3. Format 1.12.0, one bone holding every cube.
 *
 * The coordinate systems differ in two ways that matter, and both are handled here:
 * - Bedrock's origin is the block's bottom centre, so x and z shift by −8 (y is already
 *   bottom-up in both).
 * - Bedrock's x axis points the OTHER way, so a cube's origin takes `8 − to.x` (not
 *   `from.x − 8`), the east and west faces swap, and rotations about y and z negate.
 * UVs are texture PIXELS here, not Java's 0..16 units, so they scale by the sheet size.
 */
import type { Face, Model3D, ModelElement } from './types';
import { FACES } from './types';

const round = (n: number): number => Math.round(n * 10000) / 10000;

/** Java face → the Bedrock face that ends up in the same place after the x flip. */
const FLIPPED: Record<Face, Face> = {
  east: 'west',
  west: 'east',
  north: 'north',
  south: 'south',
  up: 'up',
  down: 'down',
};

/** Java model point → Bedrock model point. */
export const toBedrockPoint = (p: { x: number; y: number; z: number }): number[] => [
  round(8 - p.x),
  round(p.y),
  round(p.z - 8),
];

export interface BedrockOptions {
  /** Geometry identifier without the `geometry.` prefix; defaults to the model name. */
  identifier?: string;
  textureWidth?: number;
  textureHeight?: number;
}

function cubeJSON(el: ModelElement, texW: number, texH: number): Record<string, unknown> {
  // Bedrock origin is the cube's lowest corner in ITS space: x flips, so `to.x` leads.
  const origin = [round(8 - el.to.x), round(el.from.y), round(el.from.z - 8)];
  const size = [round(el.to.x - el.from.x), round(el.to.y - el.from.y), round(el.to.z - el.from.z)];

  const uv: Record<string, unknown> = {};
  for (const face of FACES) {
    const f = el.faces[face];
    if (!f) continue;
    const [u1, v1, u2, v2] = f.uv;
    const x = (Math.min(u1, u2) / 16) * texW;
    const y = (Math.min(v1, v2) / 16) * texH;
    const w = (Math.abs(u2 - u1) / 16) * texW;
    const h = (Math.abs(v2 - v1) / 16) * texH;
    uv[FLIPPED[face]] = { uv: [round(x), round(y)], uv_size: [round(w), round(h)] };
  }

  const cube: Record<string, unknown> = { origin, size, uv };
  if (el.rotation?.angle) {
    const { axis, angle, origin: o } = el.rotation;
    // Mirroring x negates rotations about the other two axes.
    const a = round(axis === 'x' ? angle : -angle);
    cube.pivot = toBedrockPoint(o);
    cube.rotation = [axis === 'x' ? a : 0, axis === 'y' ? a : 0, axis === 'z' ? a : 0];
  }
  return cube;
}

export function writeBedrockGeometry(model: Model3D, opts: BedrockOptions = {}): string {
  const first = Object.values(model.textures).find((t) => t.kind === 'file');
  const texW = opts.textureWidth ?? (first?.kind === 'file' ? first.width : 16);
  const texH = opts.textureHeight ?? (first?.kind === 'file' ? first.height : 16);
  const identifier = (opts.identifier ?? model.name)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${JSON.stringify(
    {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: {
            identifier: `geometry.${identifier || 'model'}`,
            texture_width: texW,
            texture_height: texH,
            visible_bounds_width: 2,
            visible_bounds_height: 2,
            visible_bounds_offset: [0, 1, 0],
          },
          bones: [
            {
              name: 'root',
              pivot: [0, 0, 0],
              cubes: model.elements.map((el) => cubeJSON(el, texW, texH)),
            },
          ],
        },
      ],
    },
    null,
    '\t',
  )}\n`;
}
