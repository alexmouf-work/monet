/**
 * Shared preview/bake lifecycle for the previewed adjustments — noise (docs/04 §6) and
 * recolour (docs/05 §5). Snapshot the raster layers on open, recompute previews on every
 * parameter change, bake into one undoable command, then re-snapshot so bakes stack.
 */
import type { MonetDoc, RasterLayer } from '../core/model/types';
import { isRaster } from '../core/model/types';
import { StrokeCommand } from '../core/model/commands';
import { fullRect } from '../core/raster/pixels';
import { ctx2d, imageDataFrom, makeCanvas } from '../engine/layerCache';
import { setPreviewCanvases } from '../ui/sceneHooks';
import { invalidate } from './bus';
import { useDocStore } from './docStore';

interface Session {
  docId: string;
  width: number;
  height: number;
  /** Pixels as they were when the panel opened — the source for every preview. */
  snapshots: Map<number, Uint8ClampedArray>;
  /** Working buffers holding the previewed result. */
  buffers: Map<number, Uint8ClampedArray>;
  canvases: Map<number, HTMLCanvasElement>;
}

let session: Session | null = null;
let previewOn = true;

export type AdjustFn = (
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  layer: RasterLayer,
) => void;

function rasterLayers(doc: MonetDoc): RasterLayer[] {
  return doc.stack.filter(isRaster);
}

/** Begin a session for the active document. Safe to call repeatedly. */
export function openAdjust(): boolean {
  const doc = useDocStore.getState().active();
  if (!doc) return false;
  if (session?.docId === doc.id && session.width === doc.width && session.height === doc.height) {
    return true;
  }
  closeAdjust();
  const layers = rasterLayers(doc);
  session = {
    docId: doc.id,
    width: doc.width,
    height: doc.height,
    snapshots: new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)])),
    buffers: new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)])),
    canvases: new Map(layers.map((l) => [l.id, makeCanvas(doc.width, doc.height)])),
  };
  previewOn = true;
  return true;
}

export const adjustOpen = () => session !== null;

export function setPreviewEnabled(on: boolean): void {
  previewOn = on;
  if (!session) return;
  setPreviewCanvases(on ? session.canvases : null);
  invalidate();
}

export const previewEnabled = () => previewOn;

/**
 * Re-take the snapshots from the document's current pixels. Needed whenever the document
 * changes underneath a live session — an undo, a redo, or a bake — otherwise the previews keep
 * showing a result derived from pixels that no longer exist.
 */
export function resyncAdjust(): void {
  const doc = useDocStore.getState().active();
  if (!session || !doc || doc.id !== session.docId) return;
  if (doc.width !== session.width || doc.height !== session.height) {
    openAdjust();
    return;
  }
  const layers = rasterLayers(doc);
  session.snapshots = new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)]));
  session.buffers = new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)]));
  for (const l of layers) {
    if (!session.canvases.has(l.id))
      session.canvases.set(l.id, makeCanvas(session.width, session.height));
  }
}

/** Recompute every layer's preview from its snapshot. */
export function updateAdjust(fn: AdjustFn): void {
  if (!session) return;
  const doc = useDocStore.getState().active();
  if (!doc || doc.id !== session.docId) return;

  for (const layer of rasterLayers(doc)) {
    const before = session.snapshots.get(layer.id);
    const after = session.buffers.get(layer.id);
    const canvas = session.canvases.get(layer.id);
    if (!before || !after || !canvas) continue;
    fn(before, after, layer);
    ctx2d(canvas).putImageData(imageDataFrom(after, session.width, session.height), 0, 0);
  }
  setPreviewCanvases(previewOn ? session.canvases : null);
  invalidate();
}

/** Write the previews into the document as a single command, then re-snapshot. */
export function bakeAdjust(label: string): void {
  if (!session) return;
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc || doc.id !== session.docId) return;

  const layers = rasterLayers(doc);
  const before = new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)]));
  let touched = false;
  for (const layer of layers) {
    const buf = session.buffers.get(layer.id);
    if (!buf) continue;
    layer.pixels.set(buf);
    touched = true;
  }
  if (!touched) return;

  const cmd = StrokeCommand.capture(
    doc,
    label,
    layers.map((l) => l.id),
    fullRect(doc.width, doc.height),
    before,
  );
  cmd.undo(doc);
  ds.execute(cmd);

  // Fresh snapshots so a second bake stacks on the first.
  session.snapshots = new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)]));
  session.buffers = new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)]));
}

/** Drop previews; the document is untouched unless a bake happened. */
export function closeAdjust(): void {
  if (!session) return;
  session = null;
  setPreviewCanvases(null);
  invalidate();
}

/** True when the document holds shapes or text, which adjustments cannot reach (A2). */
export function docHasObjects(): boolean {
  const doc = useDocStore.getState().active();
  return !!doc && doc.stack.some((i) => !isRaster(i));
}
