/**
 * Eyedropper — docs/02 §1. Picks from the visual composite (objects and background
 * included), including its alpha; over bare transparency it sets alpha 0 and keeps the hue.
 */
import { rgbToHex } from '../core/color/convert';
import { compositePixels } from '../engine/compose';
import { useDocStore } from '../app/docStore';
import { useToolStore } from '../app/toolStore';
import { getComposeOpts } from '../ui/sceneHooks';
import type { Tool, ToolPointerEvent } from './types';

/** Colour under a doc-space point, or null when outside the canvas. */
export function pickColorAt(x: number, y: number): { hex: string; alpha: number } | null {
  const doc = useDocStore.getState().active();
  if (!doc) return null;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return null;
  const data = compositePixels(doc, getComposeOpts());
  const i = (py * doc.width + px) * 4;
  const alpha = data[i + 3] / 255;
  return { hex: rgbToHex(data[i], data[i + 1], data[i + 2]), alpha };
}

function pick(e: ToolPointerEvent) {
  const hit = pickColorAt(e.doc.x, e.doc.y);
  if (!hit) return;
  const ts = useToolStore.getState();
  // Fully transparent: keep the current hue, take the alpha.
  if (hit.alpha === 0) ts.setColor(ts.color, 0);
  else ts.setColor(hit.hex, hit.alpha);
  ts.commitRecent();
}

export const eyedropperTool: Tool = {
  id: 'eyedropper',
  cursor: 'crosshair',

  onPointerDown(e) {
    if (e.button === 0) pick(e);
  },

  onPointerMove(e) {
    if (e.buttons & 1) pick(e);
  },
};
