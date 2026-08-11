/**
 * Scene extras the renderer needs but that live outside the document: in-progress stroke
 * overlays, live noise/recolour previews, suppressed items, the floating selection, and
 * screen-space overlay painters. Tools and panels write here; the renderer reads.
 */
import type { ComposeOpts, StrokeOverlay } from '../engine/compose';
import { overlayPainters } from '../app/overlayRegistry';
import { ctx2d, imageDataFrom, makeCanvas } from '../engine/layerCache';
import type { View } from '../engine/viewport';
import { useDocStore, type FloatingSelection } from '../app/docStore';
import { useToolStore } from '../app/toolStore';
import { getTool } from '../tools';

let strokeOverlay: StrokeOverlay | null = null;
let previews: Map<number, HTMLCanvasElement> | null = null;
let hiddenIds: Set<number> | null = null;

export const setStrokeOverlay = (o: StrokeOverlay | null) => void (strokeOverlay = o);
export const setPreviewCanvases = (p: Map<number, HTMLCanvasElement> | null) => void (previews = p);
export const setHiddenIds = (s: Set<number> | null) => void (hiddenIds = s);

/** Floating-selection pixels → canvas, rebuilt only when the buffer identity changes. */
let floatCache: { key: Uint8ClampedArray; canvas: HTMLCanvasElement } | null = null;

function floatingCanvas(f: FloatingSelection): HTMLCanvasElement {
  if (floatCache?.key === f.pixels && floatCache.canvas.width === f.w) return floatCache.canvas;
  const canvas = makeCanvas(f.w, f.h);
  ctx2d(canvas).putImageData(imageDataFrom(f.pixels, f.w, f.h), 0, 0);
  floatCache = { key: f.pixels, canvas };
  return canvas;
}

export function getComposeOpts(): ComposeOpts {
  const { selection } = useDocStore.getState();
  const f = selection?.floating;
  return {
    strokeOverlay,
    previews,
    hideIds: hiddenIds,
    floating: f ? { canvas: floatingCanvas(f), x: f.x, y: f.y } : null,
  };
}

export { registerOverlayPainter, type OverlayPainter } from '../app/overlayRegistry';

export function getOverlayPainter(): (ctx: CanvasRenderingContext2D, view: View) => void {
  return (ctx, view) => {
    getTool(useToolStore.getState().active).drawOverlay?.(ctx, view);
    for (const p of overlayPainters()) p(ctx, view);
  };
}
