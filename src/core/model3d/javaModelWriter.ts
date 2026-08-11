/**
 * Java block/item model writer — the M16 subset of docs/11 §13: a Model3D back to vanilla
 * JSON that Minecraft loads unmodified. Written in Minecraft's own key order and 0..16
 * numbers so diffs against hand-written models stay readable. (Round-tripping a model READ
 * from a parent chain writes the flattened elements — correct for editing; preserving an
 * unexpanded `parent` reference is the M19 refinement.)
 */
import type { Face, Model3D, ModelElement } from './types';
import { FACES } from './types';

/** `assets/minecraft/textures/block/stone.png` → `minecraft:block/stone`. */
export function pathToTextureRef(path: string): string {
  const m = path.match(/^assets\/([^/]+)\/textures\/(.+)\.png$/i);
  return m ? `${m[1]}:${m[2]}` : path;
}

const round = (n: number): number => Math.round(n * 10000) / 10000;
const vec = (v: { x: number; y: number; z: number }): number[] => [
  round(v.x),
  round(v.y),
  round(v.z),
];

function faceJSON(el: ModelElement, face: Face): Record<string, unknown> | null {
  const f = el.faces[face];
  if (!f) return null;
  const out: Record<string, unknown> = { uv: f.uv.map(round), texture: `#${f.texture}` };
  if (f.rotation) out.rotation = f.rotation;
  if (f.cullface) out.cullface = f.cullface;
  if (f.tintindex !== undefined) out.tintindex = f.tintindex;
  return out;
}

export function writeJavaModel(model: Model3D): string {
  const out: Record<string, unknown> = {};
  if (model.ambientocclusion === false) out.ambientocclusion = false;
  if (model.guiLight) out.gui_light = model.guiLight;

  const textures: Record<string, string> = {};
  for (const [key, ref] of Object.entries(model.textures)) {
    if (ref.kind === 'file' || ref.kind === 'region') textures[key] = pathToTextureRef(ref.path);
    else if (!ref.ref.startsWith('#')) textures[key] = ref.ref;
  }
  if (Object.keys(textures).length) out.textures = textures;

  out.elements = model.elements.map((el) => {
    const e: Record<string, unknown> = { from: vec(el.from), to: vec(el.to) };
    if (el.name && !/^cube \d+$/.test(el.name)) e.name = el.name;
    if (el.rotation) {
      e.rotation = {
        origin: vec(el.rotation.origin),
        axis: el.rotation.axis,
        angle: round(el.rotation.angle),
        ...(el.rotation.rescale ? { rescale: true } : {}),
      };
    }
    if (el.shade === false) e.shade = false;
    const faces: Record<string, unknown> = {};
    for (const face of FACES) {
      const f = faceJSON(el, face);
      if (f) faces[face] = f;
    }
    e.faces = faces;
    return e;
  });

  return `${JSON.stringify(out, null, '\t')}\n`;
}
