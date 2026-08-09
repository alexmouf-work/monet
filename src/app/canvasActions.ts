/** Canvas operations — docs/06 §1. All snapshot commands, objects and rasters kept aligned. */
import type { Background, Item, MonetDoc } from '../core/model/types';
import { isRaster, MAX_DIM } from '../core/model/types';
import { BackgroundCommand, SnapshotCommand } from '../core/model/commands';
import { cloneDoc } from '../core/model/document';
import { normalizeAngle } from '../core/shapes/geometry';
import {
  flipH,
  flipV,
  recanvas,
  resample,
  rotate90ACW,
  rotate90CW,
  type Resample,
} from '../core/raster/transform';
import { useDocStore } from './docStore';
import { useViewStore } from './viewStore';
import { anchorIfFloating } from './selectionActions';

export function setBackground(next: Background): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc) return;
  ds.execute(new BackgroundCommand({ ...doc.background }, { ...next }));
}

export interface ResizeOptions {
  width: number;
  height: number;
  /** true = scale the content with the canvas; false = re-canvas, anchored top-left. */
  scaleContent: boolean;
  method: Resample;
}

export function resizeCanvas(opts: ResizeOptions): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc) return;
  const width = clampDim(opts.width);
  const height = clampDim(opts.height);
  if (width === doc.width && height === doc.height) return;
  anchorIfFloating();

  const before = cloneDoc(doc);
  const after = cloneDoc(doc);
  after.width = width;
  after.height = height;

  if (opts.scaleContent) {
    const kx = width / doc.width;
    const ky = height / doc.height;
    after.stack = after.stack.map((item): Item => {
      if (isRaster(item)) {
        return {
          ...item,
          pixels: resample(item.pixels, doc.width, doc.height, width, height, opts.method),
        };
      }
      return {
        ...item,
        transform: {
          ...item.transform,
          cx: item.transform.cx * kx,
          cy: item.transform.cy * ky,
          w: Math.max(1, item.transform.w * kx),
          h: Math.max(1, item.transform.h * ky),
        },
      };
    });
    // Text size must follow the scale, or scaled text stops matching its box.
    after.stack = after.stack.map((item) =>
      item.kind === 'text' ? { ...item, sizePx: Math.max(1, Math.round(item.sizePx * ky)) } : item,
    );
  } else {
    after.stack = after.stack.map((item): Item =>
      isRaster(item)
        ? { ...item, pixels: recanvas(item.pixels, doc.width, doc.height, width, height) }
        : item,
    );
  }

  ds.execute(new SnapshotCommand('Resize canvas', before, after));
  useViewStore.getState().fit(doc.id, width, height);
}

export type CanvasOp = 'cw' | 'acw' | 'flipH' | 'flipV';

const LABEL: Record<CanvasOp, string> = {
  cw: 'Rotate 90° CW',
  acw: 'Rotate 90° ACW',
  flipH: 'Flip horizontal',
  flipV: 'Flip vertical',
};

/** Rotate/flip the whole document — docs/06 §1.3. */
export function transformCanvas(op: CanvasOp): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc) return;
  anchorIfFloating();

  const W = doc.width;
  const H = doc.height;
  const before = cloneDoc(doc);
  const after = cloneDoc(doc);
  const swaps = op === 'cw' || op === 'acw';
  after.width = swaps ? H : W;
  after.height = swaps ? W : H;

  after.stack = after.stack.map((item): Item => {
    if (isRaster(item)) {
      const px =
        op === 'cw'
          ? rotate90CW(item.pixels, W, H)
          : op === 'acw'
            ? rotate90ACW(item.pixels, W, H)
            : op === 'flipH'
              ? flipH(item.pixels, W, H)
              : flipV(item.pixels, W, H);
      return { ...item, pixels: px };
    }

    const t = { ...item.transform };
    if (op === 'cw') {
      const { cx, cy } = t;
      t.cx = H - cy;
      t.cy = cx;
      t.rotation = normalizeAngle(t.rotation + 90);
      [t.w, t.h] = [t.w, t.h];
    } else if (op === 'acw') {
      const { cx, cy } = t;
      t.cx = cy;
      t.cy = W - cx;
      t.rotation = normalizeAngle(t.rotation - 90);
    } else if (op === 'flipH') {
      t.cx = W - t.cx;
      t.flipX = !t.flipX;
      t.rotation = normalizeAngle(360 - t.rotation);
    } else {
      t.cy = H - t.cy;
      t.flipY = !t.flipY;
      t.rotation = normalizeAngle(360 - t.rotation);
    }
    return { ...item, transform: t };
  });

  ds.execute(new SnapshotCommand(LABEL[op], before, after));
  useViewStore.getState().fit(doc.id, after.width, after.height);
}

export const clampDim = (n: number) => Math.max(1, Math.min(MAX_DIM, Math.round(n) || 1));

/** Percent ⇄ pixel conversion for the resize dialog. */
export const pctToPx = (base: number, pct: number) => clampDim((base * pct) / 100);
export const pxToPct = (base: number, px: number) => Math.round((px / base) * 1000) / 10;

export const docSize = (doc: MonetDoc | null) => (doc ? `${doc.width} × ${doc.height} px` : '—');
