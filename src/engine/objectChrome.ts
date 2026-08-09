/**
 * Selection chrome for live objects — docs/03 §2.2. Screen-space so handles stay the same
 * size at every zoom; positions derive from the object's transform.
 */
import type { ObjectItem, Transform, Vec2 } from '../core/model/types';
import { worldFromLocal } from '../core/shapes/geometry';
import { usesPoints } from '../core/shapes/geometry';
import { HANDLE_IDS, HANDLE_LOCAL, type HandleId } from '../core/shapes/transformOps';
import { screenFromDoc, type View } from './viewport';

export const HANDLE_SIZE = 8;
export const ROTATE_OFFSET = 24;
export const POINT_HANDLE_R = 5;

const ACCENT = '#3fa7d6';

/** Unit-up direction of the object in screen space. */
function upVector(t: Transform): Vec2 {
  const r = (t.rotation * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

export const handleScreenPos = (t: Transform, id: HandleId, view: View): Vec2 =>
  screenFromDoc(view, worldFromLocal(t, HANDLE_LOCAL[id]));

export function rotateHandleScreenPos(t: Transform, view: View): Vec2 {
  const top = screenFromDoc(view, worldFromLocal(t, { x: 0.5, y: 0 }));
  const up = upVector(t);
  return { x: top.x + up.x * ROTATE_OFFSET, y: top.y + up.y * ROTATE_OFFSET };
}

export type ChromeHit =
  | { kind: 'scale'; handle: HandleId }
  | { kind: 'rotate' }
  | { kind: 'point'; index: number }
  | null;

/** What (if anything) the pointer is grabbing, in screen space. */
export function hitChrome(obj: ObjectItem, screen: Vec2, view: View): ChromeHit {
  const near = (p: Vec2, r: number) =>
    Math.abs(screen.x - p.x) <= r && Math.abs(screen.y - p.y) <= r;

  if (near(rotateHandleScreenPos(obj.transform, view), HANDLE_SIZE)) return { kind: 'rotate' };

  if (obj.kind === 'shape' && obj.points && usesPoints(obj.shape)) {
    for (let i = 0; i < obj.points.length; i++) {
      const p = screenFromDoc(view, worldFromLocal(obj.transform, obj.points[i]));
      if (near(p, POINT_HANDLE_R + 2)) return { kind: 'point', index: i };
    }
  }

  for (const id of HANDLE_IDS) {
    if (near(handleScreenPos(obj.transform, id, view), HANDLE_SIZE / 2 + 2))
      return { kind: 'scale', handle: id };
  }
  return null;
}

export function drawObjectChrome(ctx: CanvasRenderingContext2D, obj: ObjectItem, view: View): void {
  const t = obj.transform;
  const corners = (
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ] as Vec2[]
  ).map((c) => screenFromDoc(view, worldFromLocal(t, c)));

  ctx.save();
  ctx.lineWidth = 1;

  // Bounding box.
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Rotation stick + handle.
  const top = screenFromDoc(view, worldFromLocal(t, { x: 0.5, y: 0 }));
  const rotate = rotateHandleScreenPos(t, view);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(rotate.x, rotate.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rotate.x, rotate.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.stroke();

  // Scale handles.
  for (const id of HANDLE_IDS) {
    const p = handleScreenPos(t, id, view);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.fillRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(
      p.x - HANDLE_SIZE / 2 + 0.5,
      p.y - HANDLE_SIZE / 2 + 0.5,
      HANDLE_SIZE - 1,
      HANDLE_SIZE - 1,
    );
  }

  // Point handles for line / spline / arrowhead.
  if (obj.kind === 'shape' && obj.points && usesPoints(obj.shape)) {
    for (const pt of obj.points) {
      const p = screenFromDoc(view, worldFromLocal(t, pt));
      ctx.beginPath();
      ctx.arc(p.x, p.y, POINT_HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }

  ctx.restore();
}
