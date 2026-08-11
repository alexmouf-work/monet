/**
 * Overlay painter registry — a LEAF module (type-only imports, zero runtime deps) on purpose.
 * Tools register painters at module-evaluation time from inside an import cycle
 * (sceneHooks → tools → selectTool → register…), and a registry living in a cycling module
 * hits the temporal dead zone of its own array ("Cannot access 'painters' before
 * initialization" took the whole boot down). A leaf is fully evaluated the moment anything
 * imports it, so it is immune.
 */
import type { View } from '../engine/viewport';

export type OverlayPainter = (ctx: CanvasRenderingContext2D, view: View) => void;

const painters: OverlayPainter[] = [];

/** Registered by selection/object chrome modules; drawn after the active tool's overlay. */
export function registerOverlayPainter(p: OverlayPainter): void {
  painters.push(p);
}

export const overlayPainters = (): readonly OverlayPainter[] => painters;
