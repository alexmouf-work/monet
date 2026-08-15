/** Pixel pen, marker and eraser — docs/02. All three share the stroke engine. */
import { invalidate } from '../app/bus';
import { useDocStore } from '../app/docStore';
import { useToolStore, type BrushSettings } from '../app/toolStore';
import { screenFromDoc, type View } from '../engine/viewport';
import { tipOrigin } from '../core/raster/stamp';
import { beginStroke, endStroke, extendStroke, strokeActive } from './strokeEngine';
import type { Tool, ToolPointerEvent } from './types';

/**
 * The tip outline is drawn as an overlay so the brush's true footprint is visible at any zoom.
 * The system cursor stays visible on top of it (owner request): hiding it left nothing to
 * track at low zoom, where the outline is only a pixel or two across.
 */
let hover: { x: number; y: number } | null = null;

function settings(id: 'pen' | 'marker' | 'eraser'): BrushSettings {
  return useToolStore.getState()[id];
}

/**
 * The doc-space footprint the tip would stamp right now, or null when not hovering. The
 * outline MUST come from `tipOrigin` — the same function the stroke engine stamps through.
 * It used to do its own `Math.round(hover) - floor(size/2)`, which disagreed with the stamp
 * past a pixel's midpoint and again on every even size, so the highlighted pixel was not the
 * painted one (owner report 2026-08-11).
 */
export function brushOutlineRect(): { x: number; y: number; size: number } | null {
  const id = useToolStore.getState().active;
  if (!hover || (id !== 'pen' && id !== 'marker' && id !== 'eraser')) return null;
  const { size } = settings(id);
  return { ...tipOrigin(hover, size), size };
}

function drawTipOutline(
  ctx: CanvasRenderingContext2D,
  view: View,
  id: 'pen' | 'marker' | 'eraser',
) {
  if (!hover) return;
  const { size, tip } = settings(id);
  const p = screenFromDoc(view, tipOrigin(hover, size));
  const s = size * view.zoom;

  ctx.save();
  ctx.lineWidth = 1;
  for (const [color, inset] of [
    ['#000', 0],
    ['#fff', 1],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    if (tip === 'circle' && size > 2) {
      ctx.arc(p.x + s / 2, p.y + s / 2, Math.max(1, s / 2 - inset), 0, Math.PI * 2);
    } else {
      ctx.rect(p.x + inset + 0.5, p.y + inset + 0.5, s - 2 * inset - 1, s - 2 * inset - 1);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function makeBrush(id: 'pen' | 'marker' | 'eraser', label: string, graded: boolean): Tool {
  return {
    id,
    cursor: 'crosshair',

    onPointerDown(e: ToolPointerEvent) {
      if (e.button !== 0) return;
      const doc = useDocStore.getState().active();
      if (!doc) return;
      const { size, tip } = settings(id);
      beginStroke({
        kind: id === 'eraser' ? 'erase' : 'paint',
        size,
        shape: tip,
        graded,
        at: e.doc,
      });
    },

    onPointerMove(e: ToolPointerEvent) {
      hover = { ...e.doc };
      if (strokeActive() && e.buttons & 1) extendStroke(e.doc, graded);
      invalidate(false); // repaint the tip outline as the pointer moves
    },

    onPointerUp() {
      if (strokeActive()) endStroke(label);
    },

    drawOverlay(ctx, view) {
      drawTipOutline(ctx, view, id);
    },

    deactivate() {
      if (strokeActive()) endStroke(label);
      hover = null;
    },
  };
}

export const penTool = makeBrush('pen', 'Pixel pen', false);
export const markerTool = makeBrush('marker', 'Marker', true);
export const eraserTool = makeBrush('eraser', 'Eraser', false);
