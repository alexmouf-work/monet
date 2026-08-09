/** Per-document view state — docs/01 §7, docs/06 §2. */
import { create } from 'zustand';
import type { Vec2 } from '../core/model/types';
import { centerView, clampZoom, fitView, zoomAt, type View } from '../engine/viewport';
import type { GridMode } from '../engine/renderer';
import { invalidate } from './bus';

const DEFAULT: View = { zoom: 8, panX: 0, panY: 0 };

interface ViewState {
  views: Record<string, View>;
  grid: GridMode;
  tiling: boolean;
  viewportW: number;
  viewportH: number;

  get(docId: string): View;
  set(docId: string, v: View): void;
  zoomAt(docId: string, anchor: Vec2, factor: number): void;
  setZoom(docId: string, zoom: number, docW: number, docH: number): void;
  pan(docId: string, dx: number, dy: number): void;
  fit(docId: string, docW: number, docH: number): void;
  hundred(docId: string, docW: number, docH: number): void;
  setViewport(w: number, h: number): void;
  cycleGrid(): void;
  setGrid(g: GridMode): void;
  toggleTiling(): void;
  forget(docId: string): void;
}

export const useViewStore = create<ViewState>((set, get) => ({
  views: {},
  grid: 'auto',
  tiling: false,
  viewportW: 0,
  viewportH: 0,

  get(docId) {
    return get().views[docId] ?? DEFAULT;
  },

  set(docId, v) {
    set((s) => ({ views: { ...s.views, [docId]: v } }));
    invalidate(false);
  },

  zoomAt(docId, anchor, factor) {
    get().set(docId, zoomAt(get().get(docId), anchor, factor));
  },

  setZoom(docId, zoom, docW, docH) {
    const { viewportW, viewportH } = get();
    get().set(docId, centerView(docW, docH, viewportW, viewportH, clampZoom(zoom)));
  },

  pan(docId, dx, dy) {
    const v = get().get(docId);
    get().set(docId, { ...v, panX: v.panX + dx, panY: v.panY + dy });
  },

  fit(docId, docW, docH) {
    const { viewportW, viewportH } = get();
    if (!viewportW || !viewportH) return;
    get().set(docId, fitView(docW, docH, viewportW, viewportH));
  },

  hundred(docId, docW, docH) {
    get().setZoom(docId, 1, docW, docH);
  },

  setViewport(w, h) {
    set({ viewportW: w, viewportH: h });
  },

  cycleGrid() {
    const order: GridMode[] = ['auto', 'on', 'off'];
    const next = order[(order.indexOf(get().grid) + 1) % order.length];
    set({ grid: next });
    invalidate(false);
  },

  setGrid(g) {
    set({ grid: g });
    invalidate(false);
  },

  toggleTiling() {
    set((s) => ({ tiling: !s.tiling }));
    invalidate(false);
  },

  forget(docId) {
    set((s) => {
      const views = { ...s.views };
      delete views[docId];
      return { views };
    });
  },
}));
