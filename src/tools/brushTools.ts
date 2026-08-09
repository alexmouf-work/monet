/** Pixel pen, marker and eraser — docs/02. All three share the stroke engine. */
import { invalidate } from '../app/bus';
import { useDocStore } from '../app/docStore';
import { useToolStore, type BrushSettings } from '../app/toolStore';
import { screenFromDoc, type View } from '../engine/viewport';
import { beginStroke, endStroke, extendStroke, strokeActive } from './strokeEngine';
import type { Tool, ToolPointerEvent } from './types';

/** Cursor is drawn as an overlay so the tip's true footprint is visible at any zoom. */
let hover: { x: number; y: number } | null = null;

function settings(id: 'pen' | 'marker' | 'eraser'): BrushSettings {
  return useToolStore.getState()[id];
}

function drawTipOutline(
  ctx: CanvasRenderingContext2D,
  view: View,
  id: 'pen' | 'marker' | 'eraser',
) {
  if (!hover) return;
  const { size, tip } = settings(id);
  const half = Math.floor(size / 2);
  const originDoc = { x: Math.round(hover.x) - half, y: Math.round(hover.y) - half };
  const p = screenFromDoc(view, originDoc);
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
    cursor: 'none',

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
