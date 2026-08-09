/**
 * Live object rendering — shapes (docs/03 §2.3) and text (docs/03 §6.4), with crisp
 * mode (docs/03 §5) applied per colour pass so each pass keeps its exact colour.
 */
import type { ObjectItem, ShapeObject, TextObject } from '../core/model/types';
import { hexToRgb } from '../core/color/convert';
import { shapeContour } from '../core/shapes/geometry';
import { thresholdAlpha } from '../core/raster/crisp';
import { ctx2d, makeCanvas } from './layerCache';
import { docPath } from './paths';
import { alignOffset, fontString, layoutText } from './textLayout';

/**
 * Sizes the shared scratch canvas to the document and clears it. Reused rather than allocated:
 * crisp mode runs one pass per colour per object per frame, so allocating here meant a fresh
 * doc-sized canvas several times a frame while dragging a shape.
 */
let scratchCanvas: HTMLCanvasElement | null = null;

function scratch(w: number, h: number): CanvasRenderingContext2D {
  if (!scratchCanvas || scratchCanvas.width !== w || scratchCanvas.height !== h) {
    scratchCanvas = makeCanvas(w, h);
  }
  const ctx = ctx2d(scratchCanvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Draw one colour pass, thresholded, then blit at the pass's alpha. */
function crispPass(
  target: CanvasRenderingContext2D,
  w: number,
  h: number,
  colorHex: string,
  alpha: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  if (alpha <= 0) return;
  const s = scratch(w, h);
  paint(s);
  const data = s.getImageData(0, 0, w, h);
  thresholdAlpha(data.data, hexToRgb(colorHex));
  s.putImageData(data, 0, 0);
  const prev = target.globalAlpha;
  target.globalAlpha = alpha;
  target.drawImage(s.canvas, 0, 0);
  target.globalAlpha = prev;
}

/**
 * Paints overlapping geometry of one colour through a single blend. Drawing straight onto the
 * target is only safe at full opacity — below that, anywhere two sub-paths overlap would blend
 * twice and read as a darker seam.
 */
function singlePass(
  target: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  if (alpha <= 0) return;
  if (alpha >= 1) {
    paint(target);
    return;
  }
  const s = scratch(w, h);
  paint(s);
  const prev = target.globalAlpha;
  target.globalAlpha = alpha;
  target.drawImage(s.canvas, 0, 0);
  target.globalAlpha = prev;
}

export function shapePath(obj: ShapeObject): Path2D {
  return docPath(shapeContour(obj.shape, obj.points), obj.transform);
}

/** Draws a shape in doc space (caller has the identity doc transform set). */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  obj: ShapeObject,
  docW: number,
  docH: number,
): void {
  const path = shapePath(obj);
  const fillable = obj.shape !== 'line';

  const paintFill = (c: CanvasRenderingContext2D) => {
    c.fillStyle = obj.fill.color;
    c.fill(path);
  };
  const strokeIn = (c: CanvasRenderingContext2D, color: string) => {
    c.strokeStyle = color;
    c.lineWidth = Math.max(0.01, obj.stroke.width);
    c.lineJoin = 'miter';
    c.lineCap = 'butt';
    c.stroke(path);
  };

  // The outline is always painted (docs/03 §2.4, owner directive 2026-08-09); switching it off
  // only makes it the fill's colour. The footprint is then identical across the toggle, and an
  // unfilled shape or a line with no outline stays visible instead of becoming an object you
  // can select but not see.
  if (!obj.stroke.enabled) {
    // One colour, so one composite: painting fill and edge as separate passes would blend the
    // boundary twice and leave a darker rim on anything below full opacity.
    const paint = (c: CanvasRenderingContext2D) => {
      if (obj.fill.enabled && fillable) paintFill(c);
      strokeIn(c, obj.fill.color);
    };
    if (obj.crisp) crispPass(ctx, docW, docH, obj.fill.color, obj.fill.alpha, paint);
    else singlePass(ctx, docW, docH, obj.fill.alpha, paint);
    return;
  }

  if (obj.crisp) {
    if (obj.fill.enabled && fillable)
      crispPass(ctx, docW, docH, obj.fill.color, obj.fill.alpha, paintFill);
    crispPass(ctx, docW, docH, obj.stroke.color, obj.stroke.alpha, (c) =>
      strokeIn(c, obj.stroke.color),
    );
    return;
  }

  ctx.save();
  if (obj.fill.enabled && fillable) {
    ctx.globalAlpha = obj.fill.alpha;
    paintFill(ctx);
  }
  ctx.globalAlpha = obj.stroke.alpha;
  strokeIn(ctx, obj.stroke.color);
  ctx.restore();
}

/** Applies a text object's box matrix, then paints its lines in local (unrotated) space. */
function paintTextLines(ctx: CanvasRenderingContext2D, obj: TextObject, colorOverride?: string) {
  const l = layoutText(obj);
  const t = obj.transform;
  ctx.save();
  ctx.translate(t.cx, t.cy);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
  ctx.translate(-t.w / 2, -t.h / 2);
  ctx.font = fontString(obj);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = colorOverride ?? obj.color;
  l.lines.forEach((line, i) => {
    const x = alignOffset(obj.align, t.w, l.widths[i]);
    const y = i * l.lineHeight + l.ascent;
    ctx.fillText(line, x, y);
    if (obj.underline && line.length) {
      const uy = y + Math.max(2, Math.round(obj.sizePx / 8));
      ctx.fillRect(x, uy, l.widths[i], Math.max(1, Math.round(obj.sizePx / 12)));
    }
  });
  ctx.restore();
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  obj: TextObject,
  docW: number,
  docH: number,
): void {
  if (obj.crisp) {
    crispPass(ctx, docW, docH, obj.color, obj.alpha, (c) => paintTextLines(c, obj));
    return;
  }
  ctx.save();
  ctx.globalAlpha = obj.alpha;
  paintTextLines(ctx, obj);
  ctx.restore();
}

export function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: ObjectItem,
  docW: number,
  docH: number,
): void {
  if (obj.kind === 'shape') drawShape(ctx, obj, docW, docH);
  else drawText(ctx, obj, docW, docH);
}
