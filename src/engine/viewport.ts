/** Zoom/pan maths — docs/06 §2. Pure functions over a plain View. */
import type { Vec2 } from '../core/model/types';

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export const ZOOM_MIN = 1 / 16;
export const ZOOM_MAX = 128;
export const ZOOM_STEP = 1.25;

export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

export const screenFromDoc = (v: View, p: Vec2): Vec2 => ({
  x: p.x * v.zoom + v.panX,
  y: p.y * v.zoom + v.panY,
});

export const docFromScreen = (v: View, p: Vec2): Vec2 => ({
  x: (p.x - v.panX) / v.zoom,
  y: (p.y - v.panY) / v.zoom,
});

/** Zoom about a screen-space anchor so the hovered doc pixel stays under the pointer. */
export function zoomAt(v: View, anchor: Vec2, factor: number): View {
  const zoom = clampZoom(v.zoom * factor);
  if (zoom === v.zoom) return v;
  const k = zoom / v.zoom;
  return {
    zoom,
    panX: anchor.x - (anchor.x - v.panX) * k,
    panY: anchor.y - (anchor.y - v.panY) * k,
  };
}

/** Largest zoom in range that fits the doc plus padding, centred. */
export function fitView(
  docW: number,
  docH: number,
  viewW: number,
  viewH: number,
  padding = 32,
): View {
  const raw = Math.min((viewW - padding * 2) / docW, (viewH - padding * 2) / docH);
  const zoom = clampZoom(raw > 1 ? Math.max(1, Math.floor(raw)) : raw);
  return centerView(docW, docH, viewW, viewH, zoom);
}

export function centerView(
  docW: number,
  docH: number,
  viewW: number,
  viewH: number,
  zoom: number,
): View {
  return {
    zoom,
    panX: Math.round((viewW - docW * zoom) / 2),
    panY: Math.round((viewH - docH * zoom) / 2),
  };
}

/** Wheel delta → zoom factor. Up (negative deltaY) zooms in — docs/06 §2. */
export const wheelFactor = (deltaY: number) => (deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);

export const zoomPercent = (z: number) =>
  z >= 1 ? `${Math.round(z * 100)}%` : `${(z * 100).toFixed(z < 0.25 ? 1 : 0)}%`;
