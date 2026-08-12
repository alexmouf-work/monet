/**
 * Java block/item model writer — docs/11 §13.1. A Model3D back to vanilla JSON that Minecraft
 * loads unmodified, in Minecraft's own key order and 0..16 numbers so diffs against
 * hand-written models stay readable.
 *
 * Round-trip rules (M19):
 * - The source file's own JSON is the baseline: `parent` and every key this build does not
 *   model (top level, per element, per face) are carried through verbatim.
 * - `elements` is written only when the file HAD its own, or the geometry has actually changed
 *   since load. A `parent`-only model whose geometry was never touched stays a two-line file
 *   instead of gaining a flattened copy of its parent's cubes.
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

/** Top-level keys written explicitly; anything else in `raw` is passed through first. */
const OWNED_TOP_KEYS = new Set([
  'parent',
  'ambientocclusion',
  'gui_light',
  'textures',
  'elements',
  'display',
]);

function faceJSON(el: ModelElement, face: Face): Record<string, unknown> | null {
  const f = el.faces[face];
  if (!f) return null;
  const out: Record<string, unknown> = { uv: f.uv.map(round), texture: `#${f.texture}` };
  if (f.rotation) out.rotation = f.rotation;
  if (f.cullface) out.cullface = f.cullface;
  if (f.tintindex !== undefined) out.tintindex = f.tintindex;
  return { ...out, ...f.extra };
}

export function elementJSON(el: ModelElement): Record<string, unknown> {
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
  return { ...e, ...el.extra };
}

/** Elements as a stable string — the baseline `Model3D.baseline` holds for comparison. */
export const elementsSignature = (elements: ModelElement[]): string =>
  JSON.stringify(elements.map(elementJSON));

export function writeJavaModel(model: Model3D): string {
  const raw = (model.raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Unknown top-level keys first: a mod's custom fields keep their place near the top.
  for (const [k, v] of Object.entries(raw)) if (!OWNED_TOP_KEYS.has(k)) out[k] = v;

  if (typeof raw.parent === 'string') out.parent = raw.parent;
  if (model.ambientocclusion === false) out.ambientocclusion = false;
  if (model.guiLight) out.gui_light = model.guiLight;

  const textures: Record<string, string> = {};
  for (const [key, ref] of Object.entries(model.textures)) {
    if (ref.kind === 'file' || ref.kind === 'region') textures[key] = pathToTextureRef(ref.path);
    else if (!ref.ref.startsWith('#')) textures[key] = ref.ref;
  }
  // Inherited vars are written only if the source declared them: re-declaring the whole
  // resolved set would bury the two lines a child model actually owns.
  const ownTextures = (raw.textures ?? null) as Record<string, string> | null;
  const outTextures = ownTextures
    ? Object.fromEntries(Object.keys(ownTextures).map((k) => [k, textures[k] ?? ownTextures[k]]))
    : textures;
  if (Object.keys(outTextures).length) out.textures = outTextures;

  const signature = elementsSignature(model.elements);
  const inherited = !Array.isArray(raw.elements);
  if (!inherited || model.baseline === undefined || signature !== model.baseline) {
    out.elements = model.elements.map(elementJSON);
  }

  if (model.display && Object.keys(model.display).length) out.display = model.display;

  return `${JSON.stringify(out, null, '\t')}\n`;
}
