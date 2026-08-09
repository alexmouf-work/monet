/**
 * The compositor — docs/01 §4 steps 4–6. Draws background + stack in doc coordinates.
 * Shared by the viewport renderer, exports and flatten, so what you see is what you save.
 */
import type { MonetDoc } from '../core/model/types';
import { isRaster } from '../core/model/types';
import { ctx2d, getLayerCanvas, makeCanvas } from './layerCache';
import { drawObject } from './drawObjects';

export interface StrokeOverlay {
  canvas: HTMLCanvasElement;
  /** 'over' = pen/marker preview; 'erase' = eraser preview (punched through each layer). */
  mode: 'over' | 'erase';
}

export interface ComposeOpts {
  /** Live noise/recolour previews: layer id → canvas drawn instead of the layer. */
  previews?: Map<number, HTMLCanvasElement> | null;
  strokeOverlay?: StrokeOverlay | null;
  /** Items suppressed from the render (e.g. the text object being edited). */
  hideIds?: Set<number> | null;
  floating?: { canvas: HTMLCanvasElement; x: number; y: number } | null;
  includeBackground?: boolean;
}

let eraseTemp: HTMLCanvasElement | null = null;
function eraseScratch(w: number, h: number) {
  if (!eraseTemp || eraseTemp.width !== w || eraseTemp.height !== h) eraseTemp = makeCanvas(w, h);
  const ctx = ctx2d(eraseTemp);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

export function drawDocument(
  ctx: CanvasRenderingContext2D,
  doc: MonetDoc,
  opts: ComposeOpts = {},
): void {
  const { width: W, height: H } = doc;
  const includeBg = opts.includeBackground ?? true;

  if (includeBg && doc.background.mode === 'color') {
    ctx.save();
    ctx.fillStyle = doc.background.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  for (const item of doc.stack) {
    if (opts.hideIds?.has(item.id)) continue;

    if (isRaster(item)) {
      const source = opts.previews?.get(item.id) ?? getLayerCanvas(doc, item);
      if (opts.strokeOverlay?.mode === 'erase') {
        const t = eraseScratch(W, H);
        t.drawImage(source, 0, 0);
        t.globalCompositeOperation = 'destination-out';
        t.drawImage(opts.strokeOverlay.canvas, 0, 0);
        ctx.drawImage(t.canvas, 0, 0);
      } else {
        ctx.drawImage(source, 0, 0);
      }
      continue;
    }

    drawObject(ctx, item, W, H);
  }

  if (opts.strokeOverlay?.mode === 'over') ctx.drawImage(opts.strokeOverlay.canvas, 0, 0);
  if (opts.floating) ctx.drawImage(opts.floating.canvas, opts.floating.x, opts.floating.y);
}

/** Flattened composite at 1:1 — the basis of every export (docs/07 §2). */
export function renderComposite(doc: MonetDoc, opts: ComposeOpts = {}): HTMLCanvasElement {
  const canvas = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingEnabled = false;
  drawDocument(ctx, doc, opts);
  return canvas;
}

export function compositePixels(doc: MonetDoc, opts: ComposeOpts = {}): Uint8ClampedArray {
  const canvas = renderComposite(doc, opts);
  return ctx2d(canvas).getImageData(0, 0, doc.width, doc.height).data;
}
