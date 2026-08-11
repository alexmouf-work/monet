/**
 * The live two-way link — docs/11 §9.3. While an image document bound to a texture's
 * (sourceId, path) is open, THAT document is the source of truth for the texture: the 3D
 * viewport re-composites from its pixels on every content change, so painting in 2D updates
 * the model live. (The other direction — 3D strokes writing into the image document — is the
 * M15 painting path; this module is what makes those strokes visible in 2D instantly too.)
 */
import { compositePixels } from '../engine/compose';
import { getComposeOpts } from '../ui/sceneHooks';
import { onInvalidate } from './bus';
import { useDocStore } from './docStore';
import { modelTextures } from './modelActions';
import type { MonetDoc } from '../core/model/types';

/** docId:var → the image-doc rev last composited into the GL store, to skip no-op syncs. */
const lastSynced = new Map<string, number>();

/** The open image document bound to (sourceId, path), if any. */
export function boundImageDoc(sourceId?: string, path?: string): MonetDoc | null {
  if (!sourceId || !path) return null;
  const ds = useDocStore.getState();
  for (const doc of Object.values(ds.docs)) {
    if (doc.binding?.sourceId === sourceId && doc.binding.path === path && !doc.binding.region) {
      return doc;
    }
  }
  return null;
}

/** One sync pass: push every linked open document's composite into the model texture store. */
export function syncModelTextures(): void {
  const ds = useDocStore.getState();
  const models = Object.values(ds.models);
  if (!models.length) return;

  for (const model of models) {
    const store = modelTextures(model.id);
    for (const [key, entry] of store) {
      const doc = boundImageDoc(entry.sourceId, entry.path);
      if (!doc) continue;
      const syncKey = `${model.id}:${key}`;
      if (lastSynced.get(syncKey) === ds.rev) continue;
      lastSynced.set(syncKey, ds.rev);
      // Texture-sized documents composite in microseconds; rev gating keeps this off the
      // camera-move path entirely (invalidate(false) never lands here).
      const pixels = compositePixels(doc, getComposeOpts());
      entry.pixels = pixels;
      entry.width = doc.width;
      entry.height = doc.height;
      entry.version += 1;
    }
  }
}

/** Wire the sync to content invalidations. Idempotent; returns an unsubscribe. */
let started = false;
export function startModelTextureSync(): () => void {
  if (started) return () => undefined;
  started = true;
  const off = onInvalidate((content) => {
    if (content) syncModelTextures();
  });
  return () => {
    started = false;
    off();
  };
}
