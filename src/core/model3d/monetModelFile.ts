/**
 * The `.monet_model` project format — docs/11 §3. Same zip container idea as `.monet`:
 * `manifest.json` + `model.json` + `camera.json`. Texture PIXELS are deliberately not
 * copied in — a model document's textures are references into sources, and duplicating them
 * would make the project file a stale copy of the art.
 *
 * Pre-1.0 there is no migration machinery: version 1 only (docs/07 §7).
 */
import JSZip from 'jszip';
import type { CameraState, Model3D, ModelElement, ModelGroup, TextureRef } from './types';
import { DEFAULT_CAMERA } from './camera';

export const MONET_MODEL_FORMAT = 'monet_model';
export const MONET_MODEL_VERSION = 1;

interface Manifest {
  format: string;
  version: number;
  name: string;
  modelFormat: Model3D['format'];
  vanillaMode: boolean;
  nextItemId: number;
  binding?: Model3D['binding'];
}

interface ModelPart {
  elements: ModelElement[];
  groups: ModelGroup[];
  textures: Record<string, TextureRef>;
  display?: Model3D['display'];
  ambientocclusion?: boolean;
  guiLight?: Model3D['guiLight'];
  raw?: Record<string, unknown>;
  baseline?: string;
}

export async function writeMonetModel(model: Model3D): Promise<Uint8Array> {
  const zip = new JSZip();
  const manifest: Manifest = {
    format: MONET_MODEL_FORMAT,
    version: MONET_MODEL_VERSION,
    name: model.name,
    modelFormat: model.format,
    vanillaMode: model.vanillaMode,
    nextItemId: model.nextItemId,
    binding: model.binding,
  };
  const part: ModelPart = {
    elements: model.elements,
    groups: model.groups,
    textures: model.textures,
    display: model.display,
    ambientocclusion: model.ambientocclusion,
    guiLight: model.guiLight,
    raw: model.raw,
    baseline: model.baseline,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('model.json', JSON.stringify(part, null, 2));
  zip.file('camera.json', JSON.stringify(model.camera, null, 2));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export class MonetModelFileError extends Error {}

/** Read a `.monet_model` back. `id` is supplied by the caller (docStore owns id minting). */
export async function readMonetModel(bytes: Uint8Array, id: string): Promise<Model3D> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new MonetModelFileError('Not a readable .monet_model file (bad archive).');
  }
  const manifestFile = zip.file('manifest.json');
  const modelFile = zip.file('model.json');
  if (!manifestFile || !modelFile) {
    throw new MonetModelFileError('.monet_model is missing its manifest or model.');
  }

  let manifest: Manifest;
  let part: ModelPart;
  try {
    manifest = JSON.parse(await manifestFile.async('string')) as Manifest;
    part = JSON.parse(await modelFile.async('string')) as ModelPart;
  } catch {
    throw new MonetModelFileError('.monet_model contains invalid JSON.');
  }
  if (manifest.format !== MONET_MODEL_FORMAT) {
    throw new MonetModelFileError('Not a Monet model project file.');
  }
  if (typeof manifest.version !== 'number' || manifest.version > MONET_MODEL_VERSION) {
    throw new MonetModelFileError(
      `This project was saved by a newer version of Monet (v${manifest.version}).`,
    );
  }
  if (!Array.isArray(part.elements)) {
    throw new MonetModelFileError('.monet_model has no element list.');
  }

  const cameraFile = zip.file('camera.json');
  let camera: CameraState = { ...DEFAULT_CAMERA };
  if (cameraFile) {
    try {
      camera = { ...DEFAULT_CAMERA, ...(JSON.parse(await cameraFile.async('string')) as object) };
    } catch {
      // A corrupt camera is not worth failing a load over: the default frames the model.
    }
  }

  const maxId = part.elements.reduce((n, e) => Math.max(n, e.id), 0);
  return {
    kind: 'model',
    id,
    name: manifest.name || 'model',
    dirty: false,
    binding: manifest.binding,
    format: manifest.modelFormat ?? 'java_block',
    unit: 16,
    elements: part.elements,
    groups: part.groups ?? [],
    textures: part.textures ?? {},
    missing: [],
    ambientocclusion: part.ambientocclusion,
    guiLight: part.guiLight,
    display: part.display,
    raw: part.raw,
    baseline: part.baseline,
    camera,
    vanillaMode: manifest.vanillaMode ?? true,
    nextItemId: Math.max(Number(manifest.nextItemId) || 1, maxId + 1),
  };
}
