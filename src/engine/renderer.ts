/**
 * The viewport renderer — docs/01 §4. One visible canvas, a rAF loop gated by an
 * invalidate flag: nothing is drawn unless something changed.
 */
import type { MonetDoc } from '../core/model/types';
import { ctx2d, makeCanvas } from './layerCache';
import { drawDocument, type ComposeOpts } from './compose';
import type { View } from './viewport';
import { themeColors } from './themeColors';

export type GridMode = 'auto' | 'on' | 'off';

export interface Scene {
  doc: MonetDoc | null;
  view: View;
  grid: GridMode;
  tiling: boolean;
  compose: ComposeOpts;
  /** Screen-space overlays: marquee, handles, brush cursor, text caret box. */
  overlay?: (ctx: CanvasRenderingContext2D, view: View) => void;
}

// Light checkerboard (was #cfcfcf/#a8a8a8): a mid-grey pixel grid is invisible against a
// mid-grey checker, and seeing pixel boundaries over transparency is the point of the grid.
const CHECK_LIGHT = '#ffffff';
const CHECK_DARK = '#d4d4d4';
const GRID = 'rgba(128,128,128,0.35)';
const GRID_16 = 'rgba(64,160,255,0.35)';

function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  const c = makeCanvas(16, 16);
  const cc = ctx2d(c);
  cc.fillStyle = CHECK_LIGHT;
  cc.fillRect(0, 0, 16, 16);
  cc.fillStyle = CHECK_DARK;
  cc.fillRect(0, 0, 8, 8);
  cc.fillRect(8, 8, 8, 8);
  return ctx.createPattern(c, 'repeat')!;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private composite = makeCanvas(1, 1);
  private compositeCtx = ctx2d(this.composite);
  private pattern: CanvasPattern | null = null;
  private raf = 0;
  private dirty = true;
  private compositeDirty = true;
  cssW = 0;
  cssH = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private getScene: () => Scene,
  ) {
    this.ctx = ctx2d(canvas);
  }

  /** Redraw next frame. `content` also re-composites the document. */
  invalidate(content = true) {
    this.dirty = true;
    if (content) this.compositeDirty = true;
  }

  start() {
    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
        this.draw();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  resize(cssW: number, cssH: number) {
    const dpr = window.devicePixelRatio || 1;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.invalidate();
  }

  /** The 1:1 composite of the current scene — eyedropper and bucket read this. */
  compositeSnapshot(): Uint8ClampedArray | null {
    const { doc } = this.getScene();
    if (!doc) return null;
    this.ensureComposite(doc);
    return this.compositeCtx.getImageData(0, 0, doc.width, doc.height).data;
  }

  private ensureComposite(doc: MonetDoc) {
    if (this.composite.width !== doc.width || this.composite.height !== doc.height) {
      this.composite = makeCanvas(doc.width, doc.height);
      this.compositeCtx = ctx2d(this.composite);
      this.compositeDirty = true;
    }
    if (!this.compositeDirty) return;
    const c = this.compositeCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, doc.width, doc.height);
    drawDocument(c, doc, this.getScene().compose);
    this.compositeDirty = false;
  }

  private draw() {
    const scene = this.getScene();
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = themeColors().surround;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const { doc, view } = scene;
    if (!doc) return;
    this.ensureComposite(doc);

    const w = doc.width * view.zoom;
    const h = doc.height * view.zoom;
    this.pattern ??= checkerPattern(ctx);

    const tiles: [number, number][] = scene.tiling
      ? [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [0, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1],
        ]
      : [[0, 0]];

    for (const [tx, ty] of tiles) {
      const x = view.panX + tx * w;
      const y = view.panY + ty * h;
      if (doc.background.mode === 'transparent') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillStyle = this.pattern;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
      ctx.drawImage(this.composite, 0, 0, doc.width, doc.height, x, y, w, h);
    }

    if (scene.tiling) {
      // Outline the origin tile so the seam under the cursor is unambiguous.
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000';
      ctx.strokeRect(view.panX - 0.5, view.panY - 0.5, w + 1, h + 1);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(view.panX + 0.5, view.panY + 0.5, w - 1, h - 1);
      ctx.restore();
    }

    this.drawGrid(ctx, doc, view, scene.grid);
    scene.overlay?.(ctx, view);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, doc: MonetDoc, view: View, mode: GridMode) {
    const show = mode === 'on' || (mode === 'auto' && view.zoom >= 8);
    if (!show || view.zoom < 2) return;
    const w = doc.width * view.zoom;
    const h = doc.height * view.zoom;
    const snap = (n: number) => Math.round(n) + 0.5;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    for (let x = 0; x <= doc.width; x++) {
      const sx = snap(view.panX + x * view.zoom);
      ctx.moveTo(sx, view.panY);
      ctx.lineTo(sx, view.panY + h);
    }
    for (let y = 0; y <= doc.height; y++) {
      const sy = snap(view.panY + y * view.zoom);
      ctx.moveTo(view.panX, sy);
      ctx.lineTo(view.panX + w, sy);
    }
    ctx.stroke();

    if (view.zoom >= 32) {
      ctx.strokeStyle = GRID_16;
      ctx.beginPath();
      for (let x = 0; x <= doc.width; x += 16) {
        const sx = snap(view.panX + x * view.zoom);
        ctx.moveTo(sx, view.panY);
        ctx.lineTo(sx, view.panY + h);
      }
      for (let y = 0; y <= doc.height; y += 16) {
        const sy = snap(view.panY + y * view.zoom);
        ctx.moveTo(view.panX, sy);
        ctx.lineTo(view.panX + w, sy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
