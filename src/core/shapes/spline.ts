/** Uniform Catmull-Rom → cubic Bézier — docs/03 §4. */
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
