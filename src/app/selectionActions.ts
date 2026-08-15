/**
 * Selection lifecycle, clipboard, crop and flatten — docs/06 §4. Lives in `app` rather than
 * `core` because the selection is UI state (docStore) while the pixel edits are commands.
 */
import type { MonetDoc, ObjectItem, Rect } from '../core/model/types';
import { isRaster } from '../core/model/types';
import {
  AddItemCommand,
  RemoveItemsCommand,
  SnapshotCommand,
  StrokeCommand,
} from '../core/model/commands';
import { cloneDoc, cloneItem, ensureTopRasterLayer } from '../core/model/document';
import {
  blendRect,
  clampRect,
  clearRect,
  copyRect,
  emptyPixels,
  normalizeRect,
} from '../core/raster/pixels';
import { flipH, flipV, resampleNearest, rotatePixels } from '../core/raster/transform';
import { compositePixels, renderComposite } from '../engine/compose';
import { drawObject } from '../engine/drawObjects';
import { canvasToBlob, decodeImage } from '../engine/exporters';
import { ctx2d, imageDataFrom, makeCanvas } from '../engine/layerCache';
import { toast } from './bus';
import { useDocStore, type FloatingSelection, type FloatTransform } from './docStore';
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
    xform: identityXform(rect.w, rect.h),
  };
  ds.setSelection({ rect, floating });
  return floating;
}

export const identityXform = (w: number, h: number): FloatTransform => ({
  w,
  h,
  angle: 0,
  flipX: false,
  flipY: false,
});

/**
 * Rebuild a float's pixels from the ORIGINAL lift under a new transform — flip, scale, rotate,
 * in that order — keeping its centre where it is, since rotating grows the bounding box and a
 * float that lurched sideways on every wheel notch would be unusable.
 */
function withXform(f: FloatingSelection, patch: Partial<FloatTransform>): FloatingSelection {
  const xform = { ...f.xform, ...patch };
  let px = f.source.pixels;
  let w = f.source.w;
  let h = f.source.h;
  if (xform.flipX) px = flipH(px, w, h);
  if (xform.flipY) px = flipV(px, w, h);
  if (xform.w !== w || xform.h !== h) {
    px = resampleNearest(px, w, h, xform.w, xform.h);
    w = xform.w;
    h = xform.h;
  }
  const rotated = rotatePixels(px, w, h, xform.angle);
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  return {
    ...f,
    xform,
    pixels: rotated.pixels,
    w: rotated.w,
    h: rotated.h,
    x: Math.round(cx - rotated.w / 2),
    y: Math.round(cy - rotated.h / 2),
  };
}

/** Apply a transform patch to the float, lifting a plain marquee first if need be. */
function transformFloat(patch: Partial<FloatTransform>): void {
  const ds = useDocStore.getState();
  const f = ds.selection?.floating ?? liftSelection();
  if (!f) return;
  const next = withXform(f, patch);
  ds.setSelection({
    rect: { x: next.x, y: next.y, w: next.w, h: next.h },
    floating: next,
  });
}

/**
 * Turn the selection by `delta` degrees clockwise (owner request 2026-08-11: the wheel does
 * this while a selection is live). Angles accumulate on the transform, never on the pixels, so
 * a full turn returns the original art rather than a pile of resampling.
 */
export function rotateFloat(delta: number): void {
  const f = useDocStore.getState().selection?.floating;
  const from = f ? f.xform.angle : 0;
  transformFloat({ angle: (((from + delta) % 360) + 360) % 360 });
}

/** Mirror the selection. `x` swaps left and right; `y` swaps top and bottom. */
export function flipFloat(axis: 'x' | 'y'): void {
  const f = useDocStore.getState().selection?.floating;
  if (axis === 'x') transformFloat({ flipX: !(f?.xform.flipX ?? false) });
  else transformFloat({ flipY: !(f?.xform.flipY ?? false) });
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
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const next = withXform(sel.floating, { w, h });
  ds.setSelection({
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: next.w, h: next.h },
    floating: { ...next, x: Math.round(rect.x), y: Math.round(rect.y) },
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
 * A copied shape or text object, kept as an object so pasting recreates a live, still-editable
 * item rather than pixels (owner request 2026-08-09). Set alongside `internalClipboard`, which
 * holds the same thing rasterised for other applications.
 */
let objectClipboard: ObjectItem | null = null;

/**
 * Exactly the bytes this app last put on the system clipboard. Paste compares against it to
 * tell "the PNG I wrote when copying a shape" from "an image the user copied elsewhere" — only
 * the former should paste back as an object.
 */
let wroteToSystem: Uint8Array | null = null;

async function sameAsOurCopy(blob: Blob): Promise<boolean> {
  if (!wroteToSystem || blob.size !== wroteToSystem.length) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== wroteToSystem[i]) return false;
  return true;
}

/** The selected shape/text object, when there is one and no marquee is competing for the copy. */
function selectedObjectForCopy(): ObjectItem | null {
  const ds = useDocStore.getState();
  if (ds.selection) return null;
  const obj = ds.active()?.stack.find((i) => i.id === ds.selectedObjectId);
  return obj && obj.kind !== 'raster' ? obj : null;
}

/** An object on its own, rasterised at document size and trimmed to what it covers. */
function objectPixels(obj: ObjectItem): { pixels: Uint8ClampedArray; w: number; h: number } | null {
  const doc = useDocStore.getState().active();
  if (!doc) return null;
  const canvas = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingEnabled = false;
  drawObject(ctx, obj, doc.width, doc.height);
  const full = ctx.getImageData(0, 0, doc.width, doc.height).data;
  const box = opaqueBounds(full, doc.width, doc.height);
  if (!box) return null;
  return { pixels: copyRect(full, doc.width, box), w: box.w, h: box.h };
}

/** Tight bounds of everything non-transparent, or null when the buffer is empty. */
function opaqueBounds(px: Uint8ClampedArray, w: number, h: number): Rect | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

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
    // Copy what you see inside the marquee, objects included — but NOT the background, which
    // would make every copied block opaque and stamp a rectangle over whatever it lands on.
    const full = compositePixels(doc, { ...getComposeOpts(), includeBackground: false });
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
  const obj = selectedObjectForCopy();
  const data = obj ? objectPixels(obj) : selectionPixels();
  if (!data) {
    toast(obj ? 'That object has nothing visible to copy.' : 'Nothing selected to copy.');
    return;
  }
  objectClipboard = obj ? cloneItem(obj) : null;
  internalClipboard = data;
  wroteToSystem = null;
  try {
    const blob = await canvasToBlob(toCanvas(data.pixels, data.w, data.h), 'image/png');
    // System clipboard may refuse or stall; the internal copy above already succeeded.
    const ok = await withTimeout(
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
    );
    // Remember what we wrote so paste can recognise its own PNG. For an object that restores
    // the live item; for pixels it keeps our own un-premultiplied alpha, because a PNG that
    // has been through the system clipboard can come back with transparency flattened —
    // which is what made a pasted block erase whatever was behind it (owner report
    // 2026-08-11).
    if (ok !== null) wroteToSystem = new Uint8Array(await blob.arrayBuffer());
  } catch {
    /* no system clipboard here */
  }
}

export async function cutSelection(): Promise<void> {
  const obj = selectedObjectForCopy();
  await copySelection();
  const ds = useDocStore.getState();
  const doc = ds.active();

  if (obj && doc) {
    ds.selectObject(null);
    ds.execute(new RemoveItemsCommand('Cut object', doc, [obj.id]));
    return;
  }
  if (!ds.selection) return;
  if (!ds.selection.floating) liftSelection();
  // Discarding the lifted float leaves the cleared region behind: that is the cut.
  ds.setSelection(null);
}

/**
 * One paste at a time. Ctrl+V reaches this twice — once from the shortcut table and once from
 * the browser's own `paste` event — and because reading the async clipboard is slow, both were
 * in flight together and each dropped its own float: the second paste anchored the first, and
 * the user was left with two copies of what they cut (owner report 2026-08-11).
 */
let pasting: Promise<void> | null = null;

export function pasteClipboard(): Promise<void> {
  pasting ??= runPaste().finally(() => (pasting = null));
  return pasting;
}

async function runPaste(): Promise<void> {
  let data = internalClipboard;
  let object = objectClipboard;
  try {
    const items = navigator.clipboard?.read ? await withTimeout(navigator.clipboard.read()) : null;
    for (const item of items ?? []) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      // Our own PNG still on the system clipboard: use what we hold rather than the blob. For
      // an object that restores the live item; for pixels it keeps the exact alpha we copied,
      // since a clipboard round trip can flatten transparency. Anything else outranks the
      // internal clipboard.
      if (await sameAsOurCopy(blob)) break;
      object = null;
      const decoded = await decodeImage(blob);
      data = { pixels: decoded.pixels, w: decoded.width, h: decoded.height };
      break;
    }
  } catch {
    // Fall back to the internal clipboard.
  }

  if (object) {
    pasteObject(object);
    return;
  }
  if (!data) {
    toast('Clipboard has no image to paste.');
    return;
  }
  await pastePixels(data);
}

/** Drop a block of pixels in as a floating selection, centred on the visible viewport. */
async function pastePixels(data: { pixels: Uint8ClampedArray; w: number; h: number }) {
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
      xform: identityXform(data.w, data.h),
    },
  });
}

/**
 * Insert a copied object on top of the stack, offset like Ctrl+D so the copy is visible rather
 * than exactly hiding the original, and with its centre kept inside the canvas — the source
 * document may have been larger than this one.
 */
function pasteObject(source: ObjectItem): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc) return;
  anchorIfFloating();

  const copy = cloneItem(source);
  copy.id = doc.nextItemId;
  doc.nextItemId += 1;
  copy.transform = {
    ...copy.transform,
    cx: Math.max(0, Math.min(doc.width, copy.transform.cx + 8)),
    cy: Math.max(0, Math.min(doc.height, copy.transform.cy + 8)),
  };
  ds.execute(new AddItemCommand('Paste object', copy, doc.stack.length));
  ds.selectObject(copy.id);
}

/**
 * Called from the browser's own paste event. Ctrl+V fires this AND the shortcut table, so it
 * must not start a second paste: it joins the one already running, and only pastes itself when
 * it got there first (the shortcut is suppressed, or the paste came from a menu).
 */
export async function pasteFromEvent(e: ClipboardEvent): Promise<boolean> {
  const file = [...(e.clipboardData?.items ?? [])]
    .find((i) => i.type.startsWith('image/'))
    ?.getAsFile();
  if (!file) return false;
  if (pasting) {
    await pasting;
    return true;
  }
  // Our own image coming back round: paste what we hold, with its alpha intact.
  if (await sameAsOurCopy(file)) {
    await pasteClipboard();
    return true;
  }
  const decoded = await decodeImage(file);
  internalClipboard = { pixels: decoded.pixels, w: decoded.width, h: decoded.height };
  // This image came from outside, so any object we were holding is no longer what to paste.
  objectClipboard = null;
  wroteToSystem = null;
  pasting = pastePixels(internalClipboard).finally(() => (pasting = null));
  await pasting;
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
