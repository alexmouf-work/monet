/**
 * Drag the noise pattern around — docs/04 §7 (owner request 2026-08-11). Active only while the
 * Noise tab is open: the panel pushes it as a transient tool on mount and pops it on unmount,
 * so leaving the tab hands the canvas straight back to whatever was painting before.
 *
 * The grab is direct — the pattern follows the pointer — which means the sampling offset moves
 * the OTHER way, since a larger offset reads the field further along.
 */
import { noiseOffset, setNoiseOffset } from '../app/noisePanState';
import { screenFromDoc, type View } from '../engine/viewport';
import type { Tool, ToolPointerEvent } from './types';

let drag: { grab: { x: number; y: number }; origin: { x: number; y: number } } | null = null;
let hover: { x: number; y: number } | null = null;

export const noisePanTool: Tool = {
  id: 'noisePan',
  cursor: 'grab',

  onPointerDown(e: ToolPointerEvent) {
    if (e.button !== 0) return;
    drag = { grab: { ...e.doc }, origin: { ...noiseOffset() } };
  },

  onPointerMove(e: ToolPointerEvent) {
    hover = { ...e.doc };
    if (!drag || !(e.buttons & 1)) return;
    setNoiseOffset(
      drag.origin.x - (e.doc.x - drag.grab.x),
      drag.origin.y - (e.doc.y - drag.grab.y),
    );
  },

  onPointerUp() {
    drag = null;
  },

  /** A crosshair at the field's origin, so "where am I in the noise" is visible while dragging. */
  drawOverlay(ctx: CanvasRenderingContext2D, view: View) {
    if (!hover && !drag) return;
    const o = noiseOffset();
    const p = screenFromDoc(view, { x: -o.x, y: -o.y });
    ctx.save();
    ctx.lineWidth = 1;
    for (const [color, w] of [
      ['#000', 3],
      ['#fff', 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y + 0.5);
      ctx.lineTo(p.x + 7, p.y + 0.5);
      ctx.moveTo(p.x + 0.5, p.y - 7);
      ctx.lineTo(p.x + 0.5, p.y + 7);
      ctx.stroke();
    }
    ctx.restore();
  },

  deactivate() {
    drag = null;
    hover = null;
  },
};
