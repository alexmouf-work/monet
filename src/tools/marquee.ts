/**
 * Rectangular selection — docs/06 §4.1. The rect is kept on pixel boundaries and clamped to
 * the document; marching ants are drawn in screen space.
 */
import type { Rect, Vec2 } from '../core/model/types';
import { clampRect, normalizeRect } from '../core/raster/pixels';
import { screenFromDoc, type View } from '../engine/viewport';
import { invalidate } from '../app/bus';
import { useDocStore } from '../app/docStore';

let anchor: Vec2 | null = null;
let live: Rect | null = null;

export const marqueeActive = () => anchor !== null;

const snap = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

export function beginMarquee(at: Vec2): void {
  anchor = snap(at);
  live = null;
  invalidate(false);
}

export function extendMarquee(to: Vec2, square = false): void {
  if (!anchor) return;
  const doc = useDocStore.getState().active();
  if (!doc) return;
  let end = snap(to);
  if (square) {
    const d = Math.max(Math.abs(end.x - anchor.x), Math.abs(end.y - anchor.y));
    end = {
      x: anchor.x + Math.sign(end.x - anchor.x) * d,
      y: anchor.y + Math.sign(end.y - anchor.y) * d,
    };
  }
  live = clampRect(normalizeRect(anchor, end), doc.width, doc.height);
  invalidate(false);
}

export function endMarquee(to: Vec2 | null, square = false): void {
  if (!anchor) return;
  if (to) extendMarquee(to, square);
  const rect = live;
  anchor = null;
  live = null;
  const ds = useDocStore.getState();
  // A click (no drag) clears the selection instead of making a zero-size one.
  ds.setSelection(rect && rect.w >= 1 && rect.h >= 1 ? { rect } : null);
}

export function cancelMarquee(): void {
  anchor = null;
  live = null;
  invalidate(false);
}

/** Select the whole canvas — Ctrl+A. */
export function selectAll(): void {
  const doc = useDocStore.getState().active();
  if (!doc) return;
  useDocStore.getState().setSelection({ rect: { x: 0, y: 0, w: doc.width, h: doc.height } });
}

let antPhase = 0;
let antTimer: ReturnType<typeof setInterval> | null = null;

function ensureAnts(on: boolean) {
  if (on && !antTimer) {
    antTimer = setInterval(() => {
      antPhase = (antPhase + 1) % 8;
      invalidate(false);
    }, 120);
  } else if (!on && antTimer) {
    clearInterval(antTimer);
    antTimer = null;
  }
}

/** Marching ants: 1px black dashes over 1px white — docs/09 §9. */
export function drawMarquee(ctx: CanvasRenderingContext2D, view: View): void {
  const stored = useDocStore.getState().selection?.rect ?? null;
  const rect = live ?? stored;
  ensureAnts(!!rect);
  if (!rect) return;

  const a = screenFromDoc(view, { x: rect.x, y: rect.y });
  const b = screenFromDoc(view, { x: rect.x + rect.w, y: rect.y + rect.h });
  const x = Math.round(a.x) + 0.5;
  const y = Math.round(a.y) + 0.5;
  const w = Math.round(b.x - a.x);
  const h = Math.round(b.y - a.y);

  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#fff';
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -antPhase;
  ctx.strokeStyle = '#000';
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
