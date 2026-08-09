/**
 * Selection lifecycle, clipboard, crop and flatten — docs/06 §4. Lives in `app` rather than
 * `core` because the selection is UI state (docStore) while the pixel edits are commands.
 */
import type { MonetDoc, Rect } from '../core/model/types';
import { isRaster } from '../core/model/types';
import { SnapshotCommand, StrokeCommand } from '../core/model/commands';
import { cloneDoc, ensureTopRasterLayer } from '../core/model/document';
import {
  blendRect,
  clampRect,
  clearRect,
  copyRect,
  emptyPixels,
  normalizeRect,
} from '../core/raster/pixels';
import { resampleNearest } from '../core/raster/transform';
import { compositePixels, renderComposite } from '../engine/compose';
import { canvasToBlob, decodeImage } from '../engine/exporters';
import { ctx2d, imageDataFrom, makeCanvas } from '../engine/layerCache';
import { toast } from './bus';
import { useDocStore, type FloatingSelection } from './docStore';
import { useViewStore } from './viewStore';
import { getComposeOpts } from '../ui/sceneHooks';

/** Raster-only composite of a rect — objects are unaffected by selection ops (A2). */
function rasterComposite(doc: MonetDoc, rect: Rect): Uint8ClampedArray {
  const out = emptyPixels(rect.w, rect.h);
  for (const layer of doc.stack) {
    if (!isRaster(layer)) continue;
    blendRect(
      out,
      rect.w,
      rect.h,
      { x: 0, y: 0, w: rect.w, h: rect.h },
      copyRect(layer.pixels, doc.width, rect),
    );
  }
  return out;
}

/** Lift the selected pixels off the raster layers into a floating selection. */
export function liftSelection(): FloatingSelection | null {
  const ds = useDocStore.getState();
  const doc = ds.active();
  const sel = ds.selection;
  if (!doc || !sel || sel.floating) return sel?.floating ?? null;

  const rect = clampRect(sel.rect, doc.width, doc.height);
  if (rect.w === 0 || rect.h === 0) return null;

  const pixels = rasterComposite(doc, rect);
  const layers = doc.stack.filter(isRaster);
  const before = new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)]));
  for (const l of layers) clearRect(l.pixels, doc.width, doc.height, rect);
  const cmd = StrokeCommand.capture(
    doc,
    'Lift selection',
    layers.map((l) => l.id),
    rect,
    before,
  );
  cmd.undo(doc);
  ds.execute(cmd);

  const floating: FloatingSelection = {
    pixels,
    w: rect.w,
    h: rect.h,
    x: rect.x,
    y: rect.y,
    source: { pixels: new Uint8ClampedArray(pixels), w: rect.w, h: rect.h },
  };
  ds.setSelection({ rect, floating });
  return floating;
}

export function moveFloat(dx: number, dy: number): void {
  const ds = useDocStore.getState();
  const sel = ds.selection;
  if (!sel?.floating) return;
  const f = sel.floating;
  ds.setSelection({
    rect: { x: Math.round(f.x + dx), y: Math.round(f.y + dy), w: f.w, h: f.h },
    floating: { ...f, x: Math.round(f.x + dx), y: Math.round(f.y + dy) },
  });
}

export function setFloatPosition(x: number, y: number): void {
  const ds = useDocStore.getState();
  const sel = ds.selection;
  if (!sel?.floating) return;
  const f = sel.floating;
  ds.setSelection({
    rect: { x: Math.round(x), y: Math.round(y), w: f.w, h: f.h },
    floating: { ...f, x: Math.round(x), y: Math.round(y) },
  });
}

/** Resize a float, always resampling from the pixels as originally lifted. */
export function resizeFloat(rect: Rect): void {
  const ds = useDocStore.getState();
  const sel = ds.selection;
  if (!sel?.floating) return;
  const f = sel.floating;
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const pixels = resampleNearest(f.source.pixels, f.source.w, f.source.h, w, h);
  ds.setSelection({
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w, h },
    floating: { ...f, pixels, w, h, x: Math.round(rect.x), y: Math.round(rect.y) },
  });
}

/** Drop the float into the top raster layer (Rule 1) and clear the selection. */
export function anchorSelection(): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  const sel = ds.selection;
  if (!doc || !sel?.floating) return;
  const f = sel.floating;

  const layer = ensureTopRasterLayer(doc);
  const rect = clampRect({ x: f.x, y: f.y, w: f.w, h: f.h }, doc.width, doc.height);
  const before = new Map([[layer.id, new Uint8ClampedArray(layer.pixels)]]);
  blendRect(layer.pixels, doc.width, doc.height, { x: f.x, y: f.y, w: f.w, h: f.h }, f.pixels);

  if (rect.w > 0 && rect.h > 0) {
    const cmd = StrokeCommand.capture(doc, 'Anchor selection', [layer.id], rect, before);
    cmd.undo(doc);
    ds.execute(cmd);
  }
  ds.setSelection(null);
}

/** Anchor first if a float is live — called before any new stroke (docs/06 §4.1 step 4). */
export function anchorIfFloating(): void {
  if (useDocStore.getState().selection?.floating) anchorSelection();
}

export const hasFloat = () => !!useDocStore.getState().selection?.floating;

// ------------------------------------------------------------------ clipboard

let internalClipboard: { pixels: Uint8ClampedArray; w: number; h: number } | null = null;

/**
 * The async clipboard can hang indefinitely rather than reject — it waits on a permission
 * prompt the user may never see (and headless browsers never show at all). Race it so the
 * internal clipboard fallback always gets its turn.
 */
function withTimeout<T>(p: Promise<T>, ms = 600): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function selectionPixels(): { pixels: Uint8ClampedArray; w: number; h: number } | null {
  const ds = useDocStore.getState();
  const doc = ds.active();
  const sel = ds.selection;
  if (!doc) return null;
  if (sel?.floating) {
    const f = sel.floating;
    return { pixels: new Uint8ClampedArray(f.pixels), w: f.w, h: f.h };
  }
  const rect = sel ? clampRect(sel.rect, doc.width, doc.height) : null;
  if (rect && rect.w > 0 && rect.h > 0) {
    // Copy what you see inside the marquee, objects included.
    const full = compositePixels(doc, getComposeOpts());
    return { pixels: copyRect(full, doc.width, rect), w: rect.w, h: rect.h };
  }
  return null;
}

function toCanvas(px: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  ctx2d(c).putImageData(imageDataFrom(px, w, h), 0, 0);
  return c;
}

export async function copySelection(): Promise<void> {
  const data = selectionPixels();
  if (!data) {
    toast('Nothing selected to copy.');
    return;
  }
  internalClipboard = data;
  try {
    const blob = await canvasToBlob(toCanvas(data.pixels, data.w, data.h), 'image/png');
    // System clipboard may refuse or stall; the internal copy above already succeeded.
    await withTimeout(navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]));
  } catch {
    /* no system clipboard here */
  }
}

export async function cutSelection(): Promise<void> {
  await copySelection();
  const ds = useDocStore.getState();
  if (!ds.selection) return;
  if (!ds.selection.floating) liftSelection();
  // Discarding the lifted float leaves the cleared region behind: that is the cut.
  ds.setSelection(null);
}

export async function pasteClipboard(): Promise<void> {
  let data = internalClipboard;
  try {
    const items = navigator.clipboard?.read ? await withTimeout(navigator.clipboard.read()) : null;
    for (const item of items ?? []) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const decoded = await decodeImage(blob);
      data = { pixels: decoded.pixels, w: decoded.width, h: decoded.height };
      break;
    }
  } catch {
    // Fall back to the internal clipboard.
  }
  if (!data) {
    toast('Clipboard has no image to paste.');
    return;
  }

  const ds = useDocStore.getState();
  let doc = ds.active();
  if (!doc) {
    const { createDoc } = await import('../core/model/document');
    ds.addDoc(createDoc({ name: 'Pasted', width: data.w, height: data.h, pixels: data.pixels }));
    return;
  }
  doc = ds.active()!;

  // Centre the paste on the visible viewport, clamped inside the canvas.
  const view = useViewStore.getState().get(doc.id);
  const { viewportW, viewportH } = useViewStore.getState();
  const centre = {
    x: (viewportW / 2 - view.panX) / view.zoom,
    y: (viewportH / 2 - view.panY) / view.zoom,
  };
  const x = Math.round(Math.max(0, Math.min(doc.width - 1, centre.x - data.w / 2)));
  const y = Math.round(Math.max(0, Math.min(doc.height - 1, centre.y - data.h / 2)));

  anchorIfFloating();
  ds.setSelection({
    rect: { x, y, w: data.w, h: data.h },
    floating: {
      pixels: new Uint8ClampedArray(data.pixels),
      w: data.w,
      h: data.h,
      x,
      y,
      source: { pixels: new Uint8ClampedArray(data.pixels), w: data.w, h: data.h },
    },
  });
}

/** Called from a paste event when the async clipboard API is unavailable. */
export async function pasteFromEvent(e: ClipboardEvent): Promise<boolean> {
  const file = [...(e.clipboardData?.items ?? [])]
    .find((i) => i.type.startsWith('image/'))
    ?.getAsFile();
  if (!file) return false;
  const decoded = await decodeImage(file);
  internalClipboard = { pixels: decoded.pixels, w: decoded.width, h: decoded.height };
  await pasteClipboard();
  return true;
}

// ------------------------------------------------------------------ crop & flatten

export function cropToSelection(): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  const sel = ds.selection;
  if (!doc || !sel) {
    toast('Select an area to crop to first.');
    return;
  }
  anchorIfFloating();
  const rect = clampRect(sel.rect, doc.width, doc.height);
  if (rect.w === 0 || rect.h === 0) return;

  const before = cloneDoc(doc);
  const after = cloneDoc(doc);
  after.width = rect.w;
  after.height = rect.h;
  after.stack = after.stack.map((item) => {
    if (isRaster(item)) return { ...item, pixels: copyRect(item.pixels, doc.width, rect) };
    return {
      ...item,
      transform: {
        ...item.transform,
        cx: item.transform.cx - rect.x,
        cy: item.transform.cy - rect.y,
      },
    };
  });
  ds.setSelection(null);
  ds.execute(new SnapshotCommand('Crop to selection', before, after));
  useViewStore.getState().fit(doc.id, rect.w, rect.h);
}

/** Rasterise the whole stack into one layer — docs/06 §4.3. */
export function flattenDocument(): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc) return;
  anchorIfFloating();

  const canvas = renderComposite(doc, { ...getComposeOpts(), includeBackground: false });
  const flat = ctx2d(canvas).getImageData(0, 0, doc.width, doc.height).data;

  const before = cloneDoc(doc);
  const after = cloneDoc(doc);
  after.stack = [{ kind: 'raster', id: after.nextItemId, pixels: flat }];
  after.nextItemId += 1;
  ds.selectObject(null);
  ds.execute(new SnapshotCommand('Flatten image', before, after));
}

/** Marquee helper shared with the select tool. */
export const rectFromDrag = normalizeRect;
