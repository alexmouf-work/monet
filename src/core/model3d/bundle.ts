/**
 * Model bundles — docs/11 §4.5. Working out what a model file NEEDS (parent models and
 * texture PNGs) and matching those needs against whatever files the user actually has, whether
 * they picked them one by one or pointed at a folder.
 *
 * Pure: the caller supplies the raw JSON of every model it has managed to read so far, and the
 * list of file paths on offer. No DOM, no pickers.
 */
import type { RawJavaModel } from './javaModel';
import { modelRefToPath, normalizeRef, textureRefToPath } from './javaModel';
import { builtinParent } from './vanillaParents';

export interface BundleNeeds {
  /** Asset paths of every texture the model resolves to, e.g. assets/minecraft/textures/… */
  textures: string[];
  /** Parent model asset paths still unread — the chain stops here until they arrive. */
  models: string[];
  /** Texture variables that resolve to another `#var` and never to a file. */
  unresolved: string[];
}

/** Case-insensitive basename, so `Stone.PNG` still matches `stone.png`. */
export const basename = (path: string): string => (path.split('/').pop() ?? path).toLowerCase();

/**
 * Which available path satisfies `want`. An exact match wins, then a path that ENDS with the
 * asset path (a folder pick usually starts somewhere above `assets/`), then the basename —
 * the loose case where someone dragged in a pile of PNGs with no directory structure.
 */
export function matchPath(want: string, available: Iterable<string>): string | null {
  const paths = [...available];
  const lower = want.toLowerCase();
  const exact = paths.find((p) => p.toLowerCase() === lower);
  if (exact) return exact;
  const suffix = paths.find((p) => p.toLowerCase().endsWith(`/${lower}`));
  if (suffix) return suffix;
  const base = basename(want);
  const byName = paths.filter((p) => basename(p) === base);
  return byName.length === 1 ? byName[0] : null;
}

/**
 * Walk the parent chain as far as the supplied models allow and report what is still needed.
 * `read` returns the raw JSON already in hand for an asset path, or null.
 *
 * Vanilla's own parents are covered by the builtin table (docs/11 §4.2), so a bundle only ever
 * has to carry a mod's own ancestors — the user is not asked for `block/cube_all`.
 */
export function bundleNeeds(
  root: RawJavaModel,
  read: (assetPath: string) => RawJavaModel | null,
): BundleNeeds {
  const models: string[] = [];
  const chain: RawJavaModel[] = [root];

  let current: RawJavaModel | null = root;
  const seen = new Set<string>();
  for (let depth = 0; depth < 16 && current?.parent; depth++) {
    const ref = normalizeRef(current.parent);
    if (seen.has(ref)) break;
    seen.add(ref);
    const path = modelRefToPath(ref);
    const have = read(path) ?? builtinParent(ref);
    if (!have) {
      models.push(path);
      break;
    }
    chain.push(have);
    current = have;
  }

  // Texture vars merge down the chain, child wins — the same rule resolveJavaModel applies.
  const vars: Record<string, string> = {};
  for (const model of [...chain].reverse()) Object.assign(vars, model.textures ?? {});

  const textures: string[] = [];
  const unresolved: string[] = [];
  for (const key of Object.keys(vars)) {
    let value = vars[key];
    const walked = new Set<string>([key]);
    while (value.startsWith('#')) {
      const next = value.slice(1);
      if (walked.has(next) || !(next in vars)) break;
      walked.add(next);
      value = vars[next];
    }
    if (value.startsWith('#')) unresolved.push(`#${key}`);
    else {
      const path = textureRefToPath(value);
      if (!textures.includes(path)) textures.push(path);
    }
  }

  return { textures, models, unresolved };
}

/** A 16×16 magenta/black checker as raw RGBA — the classic "texture is missing" stand-in. */
export function placeholderPixels(size = 16, cell = 8): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const magenta = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const i = (y * size + x) * 4;
      px[i] = magenta ? 248 : 0;
      px[i + 1] = 0;
      px[i + 2] = magenta ? 248 : 0;
      px[i + 3] = 255;
    }
  }
  return px;
}
