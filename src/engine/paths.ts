/**
 * Contour (unit space) → Path2D (doc space) — docs/03 §2.3.
 * Building the path in doc space keeps outline weight uniform even for stretched or
 * rotated objects, and makes hit-testing use the very same path.
 */
import type { Transform, Vec2 } from '../core/model/types';
import { worldFromLocal, type Contour } from '../core/shapes/geometry';

export function docPath(contour: Contour, t: Transform): Path2D {
  const p = new Path2D();
  const W = (v: Vec2) => worldFromLocal(t, v);
  const s = W(contour.start);
  p.moveTo(s.x, s.y);
  for (const seg of contour.segs) {
    if (seg.type === 'line') {
      const a = W(seg.to);
      p.lineTo(a.x, a.y);
    } else {
      const c1 = W(seg.c1);
      const c2 = W(seg.c2);
      const to = W(seg.to);
      p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    }
  }
  if (contour.closed) p.closePath();
  return p;
}

/** Doc-space rectangle path for an object's bounding box (selection chrome, text box). */
export function boxPath(t: Transform): Path2D {
  const p = new Path2D();
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ].map((c) => worldFromLocal(t, c));
  p.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) p.lineTo(corners[i].x, corners[i].y);
  p.closePath();
  return p;
}
