/**
 * Loading a Minecraft model from the user's own files — docs/11 §4.5 (owner request
 * 2026-08-11). Holds the draft between "they picked a JSON" and "the model is open", so the
 * dialog stays presentational.
 */
import { bundleNeeds, type BundleNeeds } from '../core/model3d/bundle';
import type { RawJavaModel } from '../core/model3d/javaModel';
import { writeJavaModel } from '../core/model3d/javaModelWriter';
import {
  bundlePathFor,
  createModelBundle,
  dropModelBundle,
  fileBytes,
  getModelBundle,
  pickDirectoryFiles,
  type ModelBundleSource,
} from '../integrations/fsa/modelBundle';
import { pickOpenFiles } from '../integrations/fsa/localFile';
import { encodePixelsToPng } from '../engine/exporters';
import { downloadBlob } from '../integrations/fsa/localFile';
import { modelTextures, openModelFromSource } from './modelActions';
import { toast } from './bus';
import type { Model3D } from '../core/model3d/types';

const TYPE_MODEL = {
  description: 'Minecraft model',
  accept: { 'application/json': ['.json'] },
};
const TYPE_TEXTURE = { description: 'PNG texture', accept: { 'image/png': ['.png'] } };

export interface TextureNeed {
  /** Asset path the model asks for. */
  path: string;
  /** Where it was found in the bundle, or null when still missing. */
  have: string | null;
  /** True when what we have is the magenta/black stand-in rather than real art. */
  placeholder: boolean;
}

export interface BundleDraft {
  source: ModelBundleSource;
  /** Asset path of the model JSON inside the bundle. */
  jsonPath: string;
  name: string;
  needs: BundleNeeds;
  textures: TextureNeed[];
  /** How the files arrived — the dialog explains the two routes differently. */
  origin: 'files' | 'folder';
}

let draft: BundleDraft | null = null;
const listeners = new Set<() => void>();

export const bundleDraft = (): BundleDraft | null => draft;
export function subscribeBundleDraft(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => {
  for (const fn of listeners) fn();
};

const parse = (bytes: Uint8Array): RawJavaModel | null => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as RawJavaModel;
  } catch {
    return null;
  }
};

/** Recompute what the draft still needs — after any file lands. */
export function analyseDraft(): void {
  if (!draft) return;
  const { source, jsonPath } = draft;
  const root = parse(source.rawBytes(jsonPath) ?? new Uint8Array());
  if (!root) return;
  const needs = bundleNeeds(root, (path) => {
    const bytes =
      source.rawBytes(path) ??
      (source.resolve(path) ? source.rawBytes(source.resolve(path)!) : null);
    return bytes ? parse(bytes) : null;
  });
  draft.needs = needs;
  draft.textures = needs.textures.map((path) => {
    const have = source.resolve(path);
    return { path, have, placeholder: !!have && source.placeholders.has(have) };
  });
  changed();
}

/** Route 1: pick the model JSON, then supply textures one lot at a time. */
export async function startBundleFromFiles(): Promise<void> {
  const [file] = await pickOpenFiles([TYPE_MODEL], false);
  if (!file) return;
  const bytes = await fileBytes(file);
  if (!parse(bytes)) {
    toast(`${file.name} is not valid JSON.`, 'error');
    return;
  }
  const source = createModelBundle(file.name.replace(/\.json$/i, ''));
  const jsonPath = bundlePathFor(file.name);
  source.put(jsonPath, bytes);
  draft = {
    source,
    jsonPath,
    name: file.name,
    needs: { textures: [], models: [], unresolved: [] },
    textures: [],
    origin: 'files',
  };
  analyseDraft();
}

/** Route 2: point at the folder holding the model; textures come from around it. */
export async function startBundleFromFolder(): Promise<void> {
  const files = await pickDirectoryFiles();
  if (files.size === 0) return;
  const jsons = [...files.keys()].filter((p) => /\.json$/i.test(p));
  if (jsons.length === 0) {
    toast('That folder has no .json model in it.', 'error');
    return;
  }
  const source = createModelBundle('model folder');
  for (const [rel, file] of files) source.put(bundlePathFor(rel), await fileBytes(file));

  // Prefer a model that actually parses and declares geometry or a parent.
  const candidates = jsons.map((p) => bundlePathFor(p));
  const jsonPath =
    candidates.find((p) => {
      const raw = parse(source.rawBytes(p) ?? new Uint8Array());
      return !!raw && (!!raw.elements || !!raw.parent);
    }) ?? candidates[0];

  draft = {
    source,
    jsonPath,
    name: jsonPath.split('/').pop() ?? jsonPath,
    needs: { textures: [], models: [], unresolved: [] },
    textures: [],
    origin: 'folder',
  };
  analyseDraft();
  toast(`Indexed ${files.size} file${files.size === 1 ? '' : 's'} from the folder.`, 'ok');
}

/** Pick the model JSON to open when a folder holds several. */
export function chooseDraftModel(jsonPath: string): void {
  if (!draft) return;
  draft.jsonPath = jsonPath;
  draft.name = jsonPath.split('/').pop() ?? jsonPath;
  analyseDraft();
}

/** Add texture files by hand. Each lands under the asset path that was asking for it. */
export async function addDraftTextures(want?: string): Promise<void> {
  if (!draft) return;
  const files = await pickOpenFiles([TYPE_TEXTURE], !want);
  if (files.length === 0) return;
  if (want && files[0]) {
    draft.source.putAs(want, await fileBytes(files[0]));
  } else {
    for (const file of files) draft.source.put(bundlePathFor(file.name), await fileBytes(file));
  }
  analyseDraft();
}

/** Fill one still-missing texture with the magenta/black checker. */
export async function placeholderFor(path: string): Promise<void> {
  if (!draft) return;
  await draft.source.putPlaceholder(path);
  analyseDraft();
}

export async function placeholderForAll(): Promise<number> {
  if (!draft) return 0;
  const missing = draft.textures.filter((t) => !t.have);
  for (const t of missing) await draft.source.putPlaceholder(t.path);
  analyseDraft();
  return missing.length;
}

/** Open the drafted model. Anything still missing is filled with the placeholder first. */
export async function openDraft(): Promise<void> {
  if (!draft) return;
  const filled = await placeholderForAll();
  const { source, jsonPath } = draft;
  await openModelFromSource(source, jsonPath);
  if (filled) {
    toast(`Opened with ${filled} placeholder texture${filled === 1 ? '' : 's'}.`, 'ok');
  }
  draft = null;
  changed();
}

/** Abandon the draft, taking its half-built source with it. */
export function cancelDraft(): void {
  if (draft) dropModelBundle(draft.source.id);
  draft = null;
  changed();
}

/**
 * The whole bundle as a zip: the model JSON as it now stands plus every texture with the
 * pixels currently on the model, so a round of editing comes back out complete.
 */
export async function downloadBundleZip(model: Model3D): Promise<void> {
  const source = sourceOf(model);
  if (!source) {
    toast('This model did not come from a local bundle.', 'error');
    return;
  }
  const extra = new Map<string, Uint8Array>();
  if (model.binding?.path) {
    extra.set(model.binding.path, new TextEncoder().encode(writeJavaModel(model)));
  }
  for (const entry of modelTextures(model.id).values()) {
    if (!entry.path) continue;
    extra.set(entry.path, await encodePixelsToPng(entry.pixels, entry.width, entry.height));
  }
  const bytes = await source.toZip(extra);
  downloadBlob(
    new Blob([bytes as BlobPart], { type: 'application/zip' }),
    `${model.name.replace(/\s+/g, '_') || 'model'}.zip`,
  );
  toast(`Downloaded ${model.name}.zip (${source.paths().length} files)`, 'ok');
}

/** The bundle a model was opened from, when it was one. */
export const sourceOf = (model: Model3D): ModelBundleSource | null =>
  getModelBundle(model.binding?.sourceId);

/** True when this model can be exported as a bundle zip — the Export dialog asks. */
export const isBundleModel = (model: Model3D): boolean => sourceOf(model) !== null;
