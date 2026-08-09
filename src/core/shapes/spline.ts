/** Uniform Catmull-Rom → cubic Bézier and point editing — docs/03 §4, §2.2. */
import type { Vec2 } from '../model/types';

export function catmullRomToBezier(pts: Vec2[]): { c1: Vec2; c2: Vec2; to: Vec2 }[] {
  const segs: { c1: Vec2; c2: Vec2; to: Vec2 }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[0];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[pts.length - 1];
    segs.push({
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      to: p2,
    });
  }
  return segs;
}

/** Squared distance from p to segment ab, plus the projection parameter t ∈ [0,1]. */
function projectToSegment(p: Vec2, a: Vec2, b: Vec2): { d2: number; t: number; at: Vec2 } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  const at = { x: a.x + vx * t, y: a.y + vy * t };
  return { d2: (p.x - at.x) ** 2 + (p.y - at.y) ** 2, t, at };
}

/**
 * Insert a point where `at` falls on the polyline through `points` — docs/03 §2.2
 * (Alt+click a segment). Returns a new array; the index of the inserted point follows the
 * segment it split.
 */
export function insertPoint(points: Vec2[], at: Vec2): Vec2[] {
  if (points.length < 2) return [...points, { ...at }];
  let best = { i: 0, d2: Infinity, at };
  for (let i = 0; i < points.length - 1; i++) {
    const p = projectToSegment(at, points[i], points[i + 1]);
    if (p.d2 < best.d2) best = { i, d2: p.d2, at: p.at };
  }
  const out = [...points];
  out.splice(best.i + 1, 0, { ...at });
  return out;
}

/** Remove the point nearest `at`, keeping at least two — docs/03 §2.2 (Alt+click a point). */
export function removeNearestPoint(points: Vec2[], at: Vec2, maxDist = Infinity): Vec2[] {
  if (points.length <= 2) return points;
  let bestI = -1;
  let bestD2 = Infinity;
  points.forEach((p, i) => {
    const d2 = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = i;
    }
  });
  if (bestI < 0 || bestD2 > maxDist * maxDist) return points;
  return points.filter((_, i) => i !== bestI);
}
