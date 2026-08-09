/** Object hit-testing — docs/03 §3. Uses a throwaway context so the visible frame is safe. */
import type { MonetDoc, ObjectItem, Vec2 } from '../core/model/types';
import { localFromWorld } from '../core/shapes/geometry';
import { ctx2d, makeCanvas } from './layerCache';
import { shapePath } from './drawObjects';

let hitCtx: CanvasRenderingContext2D | null = null;
const ctx = () => (hitCtx ??= ctx2d(makeCanvas(1, 1)));

/** Topmost object at a doc-space point, or null. `zoom` widens thin outlines for grabbing. */
export function hitObject(doc: MonetDoc, p: Vec2, zoom: number): ObjectItem | null {
  const c = ctx();
  for (let i = doc.stack.length - 1; i >= 0; i--) {
    const item = doc.stack[i];
    if (item.kind === 'raster') continue;

    if (item.kind === 'text') {
      const l = localFromWorld(item.transform, p);
      if (l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1) return item;
      continue;
    }

    const path = shapePath(item);
    if (item.fill.enabled && item.shape !== 'line' && c.isPointInPath(path, p.x, p.y)) return item;
    // The outline is painted whether or not it is enabled (docs/03 §2.4), so it is always a
    // target — otherwise an outline-off shape could be seen but not clicked.
    c.lineWidth = Math.max(item.stroke.width, 6 / Math.max(zoom, 0.01));
    if (c.isPointInStroke(path, p.x, p.y)) return item;
    // Nothing visible at all (no fill, and its colour fully transparent): grabbable by box.
    if (!item.fill.enabled) {
      const l = localFromWorld(item.transform, p);
      if (l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1) return item;
    }
  }
  return null;
}
