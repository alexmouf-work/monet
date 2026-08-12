/**
 * Java block/item model parsing and parent resolution — docs/11 §4. Pure and synchronous:
 * the caller prefetches the raw JSON of every model in the parent chain (app layer, async)
 * and hands a lookup here.
 *
 * Vanilla merge semantics, which matter (docs/11 §4.2): a child's `elements` REPLACE the
 * parent's entirely; `textures` merge with the child winning; `display` merges per slot.
 * `#var` chains resolve to a fixed point with a cycle guard.
 */
import type { Face, ModelElement, ModelFace, Vec3 } from './types';
import { FACES, vec3 } from './types';

/** The raw JSON shape of a Java model file — everything optional, everything untrusted. */
export interface RawJavaModel {
  parent?: string;
  ambientocclusion?: boolean;
  gui_light?: string;
  textures?: Record<string, string>;
  elements?: RawElement[];
  display?: Record<string, unknown>;
  /** Anything else the file carries — preserved on save (docs/11 §13.1). */
  [key: string]: unknown;
}

export interface RawElement {
  name?: string;
  from?: number[];
  to?: number[];
  rotation?: { origin?: number[]; axis?: string; angle?: number; rescale?: boolean };
  shade?: boolean;
  faces?: Record<string, RawFace>;
  [key: string]: unknown;
}

interface RawFace {
  uv?: number[];
  texture?: string;
  rotation?: number;
  cullface?: string;
  tintindex?: number;
  [key: string]: unknown;
}

/** Keys this build models explicitly; everything else is carried through verbatim. */
const KNOWN_ELEMENT_KEYS = new Set(['name', 'from', 'to', 'rotation', 'shade', 'faces']);
const KNOWN_FACE_KEYS = new Set(['uv', 'texture', 'rotation', 'cullface', 'tintindex']);

/** The subset of `raw`'s own keys that `known` does not cover, or undefined when there are none. */
function unknownKeys(
  raw: Record<string, unknown>,
  known: Set<string>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const [k, v] of Object.entries(raw))
    if (!known.has(k)) {
      out[k] = v;
      any = true;
    }
  return any ? out : undefined;
}

export interface ResolvedJavaModel {
  elements: ModelElement[];
  /** var → fully-qualified texture ref (`minecraft:block/stone`) or `#…` when unresolved. */
  textures: Record<string, string>;
  display: Record<string, unknown>;
  ambientocclusion: boolean;
  guiLight?: 'front' | 'side';
  /** Ancestor refs, child first. */
  parentChain: string[];
  /** Model refs the lookup could not supply — the banner list, never a crash. */
  missing: string[];
  /** True when the chain ends in item/generated or item/handheld (docs/11 §4.4). */
  generated: boolean;
}

/** `block/cube_all` → `minecraft:block/cube_all`. */
export function normalizeRef(ref: string): string {
  const clean = ref.trim();
  return clean.includes(':') ? clean : `minecraft:${clean}`;
}

/** `minecraft:block/cube_all` → `assets/minecraft/models/block/cube_all.json`. */
export function modelRefToPath(ref: string): string {
  const [ns, rest] = normalizeRef(ref).split(':');
  return `assets/${ns}/models/${rest}.json`;
}

/** `minecraft:block/stone` → `assets/minecraft/textures/block/stone.png`. */
export function textureRefToPath(ref: string): string {
  const [ns, rest] = normalizeRef(ref).split(':');
  return `assets/${ns}/textures/${rest}.png`;
}

const GENERATED = new Set([
  'minecraft:item/generated',
  'minecraft:item/handheld',
  'minecraft:builtin/generated',
]);

/**
 * Walk `parent` refs (child → root) through `lookup`, then merge with vanilla semantics.
 * `lookup` returns the raw model for a normalized ref, or null when it has no such model —
 * unresolved ancestors land in `missing` and resolution carries on with what it has.
 */
export function resolveJavaModel(
  root: RawJavaModel,
  lookup: (ref: string) => RawJavaModel | null,
): ResolvedJavaModel {
  const chain: RawJavaModel[] = [root];
  const parentChain: string[] = [];
  const missing: string[] = [];
  let generated = false;

  let current = root;
  const seen = new Set<string>();
  for (let depth = 0; depth < 16 && current.parent; depth++) {
    const ref = normalizeRef(current.parent);
    if (seen.has(ref)) break; // parent cycle — stop rather than loop
    seen.add(ref);
    parentChain.push(ref);
    if (GENERATED.has(ref)) {
      generated = true;
      break;
    }
    const parent = lookup(ref);
    if (!parent) {
      missing.push(ref);
      break;
    }
    chain.push(parent);
    current = parent;
  }

  // Merge child-wins: walk root-most first so nearer models overwrite.
  const textures: Record<string, string> = {};
  const display: Record<string, unknown> = {};
  let elements: RawElement[] | undefined;
  let ambientocclusion = true;
  let guiLight: 'front' | 'side' | undefined;
  for (const model of [...chain].reverse()) {
    if (model.textures) Object.assign(textures, model.textures);
    if (model.display) Object.assign(display, model.display);
    if (model.elements) elements = model.elements; // replace, never merge
    if (model.ambientocclusion !== undefined) ambientocclusion = model.ambientocclusion;
    if (model.gui_light === 'front' || model.gui_light === 'side') guiLight = model.gui_light;
  }

  // Resolve #var chains to fixed points. `#missing` stays as-is and is reported.
  const resolvedTextures: Record<string, string> = {};
  for (const key of Object.keys(textures)) {
    let value = textures[key];
    const walked = new Set<string>([key]);
    while (value.startsWith('#')) {
      const next = value.slice(1);
      if (walked.has(next) || !(next in textures)) break; // cycle or dangling
      walked.add(next);
      value = textures[next];
    }
    resolvedTextures[key] = value.startsWith('#') ? value : normalizeRef(value);
  }

  return {
    elements: (elements ?? []).map((raw, i) => normalizeElement(raw, i + 1)),
    textures: resolvedTextures,
    display,
    ambientocclusion,
    guiLight,
    parentChain,
    missing,
    generated,
  };
}

const toVec3 = (a: number[] | undefined, fallback: Vec3): Vec3 =>
  a && a.length >= 3 ? vec3(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0) : fallback;

function normalizeElement(raw: RawElement, id: number): ModelElement {
  const from = toVec3(raw.from, vec3(0, 0, 0));
  const to = toVec3(raw.to, vec3(16, 16, 16));
  const faces: Partial<Record<Face, ModelFace>> = {};
  for (const face of FACES) {
    const f = raw.faces?.[face];
    if (!f) continue;
    faces[face] = {
      uv: (f.uv && f.uv.length === 4
        ? [f.uv[0], f.uv[1], f.uv[2], f.uv[3]]
        : defaultUV(face, from, to)) as [number, number, number, number],
      texture: (f.texture ?? '#missing').replace(/^#/, ''),
      rotation: f.rotation === 90 || f.rotation === 180 || f.rotation === 270 ? f.rotation : 0,
      cullface: FACES.includes(f.cullface as Face) ? (f.cullface as Face) : undefined,
      tintindex: typeof f.tintindex === 'number' ? f.tintindex : undefined,
      extra: unknownKeys(f, KNOWN_FACE_KEYS),
    };
  }
  const rot = raw.rotation;
  return {
    id,
    name: raw.name ?? `cube ${id}`,
    groupId: null,
    from,
    to,
    rotation:
      rot && (rot.axis === 'x' || rot.axis === 'y' || rot.axis === 'z')
        ? {
            origin: toVec3(rot.origin, vec3(8, 8, 8)),
            axis: rot.axis,
            angle: Number(rot.angle) || 0,
            rescale: !!rot.rescale,
          }
        : undefined,
    faces,
    shade: raw.shade,
    visible: true,
    locked: false,
    extra: unknownKeys(raw, KNOWN_ELEMENT_KEYS),
  };
}

/**
 * Vanilla default UVs when a face omits `uv`: the element's own extent projected onto the
 * face's plane (v measured from the texture top, hence the 16− terms).
 */
export function defaultUV(face: Face, from: Vec3, to: Vec3): [number, number, number, number] {
  switch (face) {
    case 'down':
      return [from.x, 16 - to.z, to.x, 16 - from.z];
    case 'up':
      return [from.x, from.z, to.x, to.z];
    case 'north':
      return [16 - to.x, 16 - to.y, 16 - from.x, 16 - from.y];
    case 'south':
      return [from.x, 16 - to.y, to.x, 16 - from.y];
    case 'west':
      return [from.z, 16 - to.y, to.z, 16 - from.y];
    case 'east':
      return [16 - to.z, 16 - to.y, 16 - from.z, 16 - from.y];
  }
}
