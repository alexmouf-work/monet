/**
 * Shape geometry in unit space [0,1]² — docs/03 §1 — plus the object matrix (docs/01 §4.1).
 * Pure data: contours are emitted as start point + segments so `core` stays DOM-free
 * (Path2D construction lives in engine/paths.ts).
 */
import type { ShapeType, Transform, Vec2 } from '../model/types';
import { catmullRomToBezier } from './spline';

export type Seg = { type: 'line'; to: Vec2 } | { type: 'cubic'; c1: Vec2; c2: Vec2; to: Vec2 };

export interface Contour {
  start: Vec2;
  segs: Seg[];
  closed: boolean;
}

export function worldFromLocal(t: Transform, p: Vec2): Vec2 {
  const lx = (p.x - 0.5) * t.w * (t.flipX ? -1 : 1);
  const ly = (p.y - 0.5) * t.h * (t.flipY ? -1 : 1);
  const r = (t.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: t.cx + lx * c - ly * s, y: t.cy + lx * s + ly * c };
}

export function localFromWorld(t: Transform, p: Vec2): Vec2 {
  const dx = p.x - t.cx;
  const dy = p.y - t.cy;
  const r = (-t.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  let lx = dx * c - dy * s;
  let ly = dx * s + dy * c;
  lx /= t.w * (t.flipX ? -1 : 1) || 1;
  ly /= t.h * (t.flipY ? -1 : 1) || 1;
  return { x: lx + 0.5, y: ly + 0.5 };
}

const poly = (pts: Vec2[], closed = true): Contour => ({
  start: pts[0],
  segs: pts.slice(1).map((to) => ({ type: 'line', to }) as Seg),
  closed,
});

/** Regular n-gon inscribed in the unit square, first vertex pointing up. */
export function regularPolygon(n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const phi = (-90 + (k * 360) / n) * (Math.PI / 180);
    out.push({ x: 0.5 + 0.5 * Math.cos(phi), y: 0.5 + 0.5 * Math.sin(phi) });
  }
  return out;
}

const KAPPA = 0.5522847498307936;

/** Unit-square ellipse as four cubics (used for both `ellipse` and `circle`). */
export function ellipseContour(): Contour {
  const k = KAPPA * 0.5;
  return {
    start: { x: 1, y: 0.5 },
    segs: [
      { type: 'cubic', c1: { x: 1, y: 0.5 + k }, c2: { x: 0.5 + k, y: 1 }, to: { x: 0.5, y: 1 } },
      { type: 'cubic', c1: { x: 0.5 - k, y: 1 }, c2: { x: 0, y: 0.5 + k }, to: { x: 0, y: 0.5 } },
      { type: 'cubic', c1: { x: 0, y: 0.5 - k }, c2: { x: 0.5 - k, y: 0 }, to: { x: 0.5, y: 0 } },
      { type: 'cubic', c1: { x: 0.5 + k, y: 0 }, c2: { x: 1, y: 0.5 - k }, to: { x: 1, y: 0.5 } },
    ],
    closed: true,
  };
}

export const ARROW_POINTS: Vec2[] = [
  { x: 0, y: 0.3 },
  { x: 0.6, y: 0.3 },
  { x: 0.6, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.6, y: 1 },
  { x: 0.6, y: 0.7 },
  { x: 0, y: 0.7 },
];

export const DEFAULT_ARROWHEAD: Vec2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0, y: 1 },
];

export const DEFAULT_LINE: Vec2[] = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
];

/** True when the type carries user-editable `points`. */
export const usesPoints = (s: ShapeType) => s === 'line' || s === 'spline' || s === 'arrowhead';

export function defaultPoints(s: ShapeType): Vec2[] | undefined {
  if (s === 'line') return DEFAULT_LINE.map((p) => ({ ...p }));
  if (s === 'arrowhead') return DEFAULT_ARROWHEAD.map((p) => ({ ...p }));
  if (s === 'spline')
    return [
      { x: 0, y: 1 },
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
    ];
  return undefined;
}

/** The unit-space contour for a shape. `points` is required for line/spline/arrowhead. */
export function shapeContour(shape: ShapeType, points?: Vec2[]): Contour {
  switch (shape) {
    case 'rectangle':
      return poly([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]);
    case 'triangle':
      return poly([
        { x: 0.5, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]);
    case 'pentagon':
      return poly(regularPolygon(5));
    case 'hexagon':
      return poly(regularPolygon(6));
    case 'circle':
    case 'ellipse':
      return ellipseContour();
    case 'arrow':
      return poly(ARROW_POINTS);
    case 'arrowhead':
      return poly(points ?? DEFAULT_ARROWHEAD, false);
    case 'line':
      return poly(points ?? DEFAULT_LINE, false);
    case 'spline': {
      const pts = points ?? defaultPoints('spline')!;
      if (pts.length < 3) return poly(pts, false);
      return {
        start: pts[0],
        segs: catmullRomToBezier(pts).map((s) => ({ type: 'cubic', ...s }) as Seg),
        closed: false,
      };
    }
  }
}

/** Bounding box of a point set (used when committing a spline). */
export function bounds(pts: Vec2[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const normalizeAngle = (deg: number) => ((deg % 360) + 360) % 360;

export function makeTransform(cx: number, cy: number, w: number, h: number): Transform {
  return { cx, cy, w, h, rotation: 0, flipX: false, flipY: false };
}
