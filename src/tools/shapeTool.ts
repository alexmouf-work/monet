/**
 * Shape creation — docs/03 §2.1. Most types drag-create; the spline collects clicked points
 * until Enter or a double-click commits it.
 */
import type { ShapeObject, ShapeType, Vec2 } from '../core/model/types';
import { AddItemCommand } from '../core/model/commands';
import { bounds, defaultPoints, makeTransform } from '../core/shapes/geometry';
import { catmullRomToBezier } from '../core/shapes/spline';
import { screenFromDoc, type View } from '../engine/viewport';
import { invalidate } from '../app/bus';
import { useDocStore } from '../app/docStore';
import { useToolStore, type ShapeSettings } from '../app/toolStore';
import type { Tool, ToolPointerEvent } from './types';

const MIN_DRAG = 3;

let dragStart: Vec2 | null = null;
let dragNow: Vec2 | null = null;
/** Spline in progress: committed points plus the cursor's live preview point. */
let splinePts: Vec2[] | null = null;
let splineHover: Vec2 | null = null;

function styleFrom(s: ShapeSettings) {
  return {
    fill: { enabled: s.fillEnabled, color: s.fillColor, alpha: s.fillAlpha },
    stroke: {
      enabled: s.strokeEnabled,
      color: s.strokeColor,
      alpha: s.strokeAlpha,
      width: s.strokeWidth,
    },
    crisp: s.crisp,
  };
}

function createShape(
  type: ShapeType,
  cx: number,
  cy: number,
  w: number,
  h: number,
  points?: Vec2[],
) {
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc) return;
  const s = useToolStore.getState().shape;
  const obj: ShapeObject = {
    kind: 'shape',
    id: doc.nextItemId,
    shape: type,
    transform: makeTransform(cx, cy, Math.max(1, w), Math.max(1, h)),
    points: points ?? defaultPoints(type),
    ...styleFrom(s),
  };
  doc.nextItemId += 1;
  ds.execute(new AddItemCommand(`Add ${type}`, obj, doc.stack.length));
  ds.selectObject(obj.id);
}

/** Default size for a click (rather than drag) creation: ¼ of the short side, max 32px. */
function defaultSize(): number {
  const doc = useDocStore.getState().active();
  if (!doc) return 32;
  return Math.max(4, Math.min(32, Math.round(Math.min(doc.width, doc.height) / 4)));
}

function commitSpline() {
  if (!splinePts || splinePts.length < 2) {
    splinePts = null;
    splineHover = null;
    invalidate(false);
    return;
  }
  const pts = splinePts;
  splinePts = null;
  splineHover = null;
  const bb = bounds(pts);
  const w = Math.max(1, bb.w);
  const h = Math.max(1, bb.h);
  const unit = pts.map((p) => ({ x: (p.x - bb.x) / w, y: (p.y - bb.y) / h }));
  createShape('spline', bb.x + w / 2, bb.y + h / 2, w, h, unit);
}

export const shapeTool: Tool = {
  id: 'shape',
  cursor: 'crosshair',

  onPointerDown(e: ToolPointerEvent) {
    if (e.button !== 0) return;
    const type = useToolStore.getState().shape.type;
    if (type === 'spline') {
      splinePts = [...(splinePts ?? []), { ...e.doc }];
      invalidate(false);
      return;
    }
    dragStart = { ...e.doc };
    dragNow = { ...e.doc };
  },

  onPointerMove(e: ToolPointerEvent) {
    if (splinePts) {
      splineHover = { ...e.doc };
      invalidate(false);
      return;
    }
    if (!dragStart) return;
    dragNow = { ...e.doc };
    invalidate(false);
  },

  onPointerUp(e: ToolPointerEvent) {
    if (splinePts) return;
    if (!dragStart) return;
    const start = dragStart;
    dragStart = null;
    dragNow = null;
    invalidate(false);

    const type = useToolStore.getState().shape.type;
    let dx = e.doc.x - start.x;
    let dy = e.doc.y - start.y;

    // Circles are always constrained; Shift constrains everything else.
    if (type === 'circle' || (e.shift && type !== 'line')) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * d;
      dy = Math.sign(dy || 1) * d;
    }
    if (type === 'line' && e.shift) {
      // Snap the segment's angle to 45° steps.
      const len = Math.hypot(dx, dy);
      const a = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
      dx = Math.cos(a) * len;
      dy = Math.sin(a) * len;
    }

    if (Math.abs(dx) < MIN_DRAG && Math.abs(dy) < MIN_DRAG) {
      const s = defaultSize();
      createShape(type, start.x, start.y, s, s);
      return;
    }

    if (type === 'line') {
      // The transform spans the drawn segment; endpoints live in `points`.
      const w = Math.abs(dx) || 1;
      const h = Math.abs(dy) || 1;
      const p0 = { x: dx >= 0 ? 0 : 1, y: dy >= 0 ? 0 : 1 };
      const p1 = { x: dx >= 0 ? 1 : 0, y: dy >= 0 ? 1 : 0 };
      createShape('line', start.x + dx / 2, start.y + dy / 2, w, h, [p0, p1]);
      return;
    }

    createShape(type, start.x + dx / 2, start.y + dy / 2, Math.abs(dx), Math.abs(dy));
  },

  onKey(e: KeyboardEvent) {
    if (!splinePts) return false;
    if (e.key === 'Enter') {
      commitSpline();
      return true;
    }
    if (e.key === 'Escape') {
      splinePts = null;
      splineHover = null;
      invalidate(false);
      return true;
    }
    if (e.key === 'Backspace') {
      splinePts = splinePts.slice(0, -1);
      if (!splinePts.length) splinePts = null;
      invalidate(false);
      return true;
    }
    return false;
  },

  drawOverlay(ctx, view: View) {
    ctx.save();
    ctx.strokeStyle = '#3fa7d6';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);

    if (dragStart && dragNow) {
      const a = screenFromDoc(view, dragStart);
      const b = screenFromDoc(view, dragNow);
      ctx.strokeRect(
        Math.round(Math.min(a.x, b.x)) + 0.5,
        Math.round(Math.min(a.y, b.y)) + 0.5,
        Math.round(Math.abs(b.x - a.x)),
        Math.round(Math.abs(b.y - a.y)),
      );
    }

    if (splinePts?.length) {
      const pts = splineHover ? [...splinePts, splineHover] : splinePts;
      const screen = pts.map((p) => screenFromDoc(view, p));
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(screen[0].x, screen[0].y);
      if (screen.length < 3) {
        for (const p of screen.slice(1)) ctx.lineTo(p.x, p.y);
      } else {
        for (const s of catmullRomToBezier(screen))
          ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y);
      }
      ctx.stroke();
      for (const p of screen) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  deactivate() {
    if (splinePts) commitSpline();
    dragStart = null;
    dragNow = null;
  },
};

/** Double-click also commits a spline (docs/03 §2.1). */
export function splineInProgress(): boolean {
  return splinePts !== null;
}

export function commitSplineNow(): void {
  commitSpline();
}
