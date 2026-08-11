/**
 * 3D view state shared across layers WITHOUT importing any ui module: the hover hit, its
 * subscribers, and the live renderer registry. Exists so `debugBridge` (app) can read hover
 * and the framebuffer without pulling the ui import chain — doing that eagerly re-entered
 * `sceneHooks` mid-evaluation and TDZ-crashed the whole boot ("Cannot access 'painters'
 * before initialization").
 */
import type { FaceHit } from '../core/model3d/types';
import type { ModelRenderer } from '../engine3d/glRenderer';

let hover: FaceHit | null = null;
const listeners = new Set<() => void>();
let flush = 0;

/** rAF-coalesced, like 2D's reportCursor — a fast mouse must not render per event. */
export function reportHover(h: FaceHit | null): void {
  hover = h;
  if (flush) return;
  flush = requestAnimationFrame(() => {
    flush = 0;
    for (const fn of listeners) fn();
  });
}

export const modelHover = (): FaceHit | null => hover;

export function subscribeModelHover(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let renderer: ModelRenderer | null = null;
export const setModelRenderer = (r: ModelRenderer | null): void => void (renderer = r);
export const modelRenderer = (): ModelRenderer | null => renderer;
