/**
 * Select tool — object transform (docs/03 §2.2) and the rectangular marquee (docs/06 §4).
 * Object hits take precedence; a drag on empty canvas starts a marquee.
 */
import type { ObjectItem, Vec2 } from '../core/model/types';
import { cloneItem } from '../core/model/document';
import { UpdateItemCommand } from '../core/model/commands';
import { localFromWorld } from '../core/shapes/geometry';
import {
  handleCursor,
  moveTransform,
  rotateTransform,
  scaleTransform,
  type HandleId,
} from '../core/shapes/transformOps';
import {
  hitChrome,
  drawObjectChrome,
  POINT_HANDLE_R,
  type ChromeHit,
} from '../engine/objectChrome';
import { insertPoint, removeNearestPoint } from '../core/shapes/spline';
import { hitObject } from '../engine/hitTest';
import { screenFromDoc, type View } from '../engine/viewport';
import { invalidate } from '../app/bus';
import { useDocStore, selectedObject } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import { registerOverlayPainter } from '../ui/sceneHooks';
import { beginMarquee, drawMarquee, extendMarquee, endMarquee, marqueeActive } from './marquee';
import { anchorSelection, liftSelection, setFloatPosition } from '../app/selectionActions';
import type { Tool, ToolPointerEvent } from './types';

type Drag =
  | { kind: 'move'; id: number; before: ObjectItem; grab: Vec2 }
  | { kind: 'float'; grab: Vec2; origin: Vec2 }
  | { kind: 'scale'; id: number; before: ObjectItem; handle: HandleId }
  | { kind: 'rotate'; id: number; before: ObjectItem }
  | { kind: 'point'; id: number; before: ObjectItem; index: number };

let drag: Drag | null = null;
let hoverCursor = 'default';

const view = (): View => {
  const id = useDocStore.getState().activeId;
  return id ? useViewStore.getState().get(id) : { zoom: 1, panX: 0, panY: 0 };
};

function commit() {
  if (!drag || drag.kind === 'float') {
    drag = null;
    return;
  }
  const d = drag;
  drag = null;
  const doc = useDocStore.getState().active();
  const after = doc?.stack.find((i) => i.id === d.id);
  if (!doc || !after) return;
  if (JSON.stringify(after) === JSON.stringify(d.before)) return;
  const cmd = new UpdateItemCommand(labelFor(d.kind), d.id, d.before, after as ObjectItem);
  // The live drag already mutated the item; rewind so execute() is the single source of truth.
  cmd.undo(doc);
  useDocStore.getState().execute(cmd);
}

const labelFor = (kind: Drag['kind']) =>
  kind === 'move'
    ? 'Move'
    : kind === 'scale'
      ? 'Resize'
      : kind === 'rotate'
        ? 'Rotate'
        : 'Edit points';

type ObjectDrag = Exclude<Drag, { kind: 'float' }>;

/** Mutates the live object during a drag; the command is captured on pointer-up. */
function mutate(fn: (obj: ObjectItem) => void) {
  const doc = useDocStore.getState().active();
  if (!doc || !drag || drag.kind === 'float') return;
  const obj = doc.stack.find((i) => i.id === (drag as ObjectDrag).id);
  if (!obj || obj.kind === 'raster') return;
  fn(obj);
  invalidate();
}

export const selectTool: Tool = {
  id: 'select',
  get cursor() {
    return hoverCursor;
  },

  onPointerDown(e: ToolPointerEvent) {
    if (e.button !== 0) return;
    const ds = useDocStore.getState();
    const doc = ds.active();
    if (!doc) return;
    const v = view();

    // Grabbing chrome on the already-selected object.
    const selected = selectedObject();
    if (selected && selected.kind !== 'raster') {
      // Alt+click on a point-based shape inserts or removes a vertex (docs/03 §2.2).
      if (e.alt && selected.kind === 'shape' && selected.points) {
        editPoints(selected, e.doc, v.zoom);
        return;
      }
      const hit: ChromeHit = hitChrome(selected, e.screen, v);
      if (hit) {
        const before = cloneItem(selected);
        if (hit.kind === 'scale')
          drag = { kind: 'scale', id: selected.id, before, handle: hit.handle };
        else if (hit.kind === 'rotate') drag = { kind: 'rotate', id: selected.id, before };
        else drag = { kind: 'point', id: selected.id, before, index: hit.index };
        return;
      }
    }

    // Dragging inside an existing marquee lifts those pixels and moves them (docs/06 §4.1).
    const sel = ds.selection;
    if (sel) {
      const r = sel.floating
        ? { x: sel.floating.x, y: sel.floating.y, w: sel.floating.w, h: sel.floating.h }
        : sel.rect;
      const inside = e.doc.x >= r.x && e.doc.y >= r.y && e.doc.x < r.x + r.w && e.doc.y < r.y + r.h;
      if (inside) {
        const f = sel.floating ?? liftSelection();
        if (f) {
          drag = { kind: 'float', grab: { ...e.doc }, origin: { x: f.x, y: f.y } };
          return;
        }
      }
    }

    const obj = hitObject(doc, e.doc, v.zoom);
    if (obj) {
      if (!selected || selected.id !== obj.id) ds.selectObject(obj.id);
      drag = { kind: 'move', id: obj.id, before: cloneItem(obj), grab: { ...e.doc } };
      return;
    }

    ds.selectObject(null);
    // Clicking outside a float anchors it before starting a new marquee.
    if (ds.selection?.floating) anchorSelection();
    beginMarquee(e.doc);
  },

  onPointerMove(e: ToolPointerEvent) {
    const v = view();

    if (!drag) {
      // Hover cursor: chrome > object > marquee crosshair.
      const selected = selectedObject();
      let next = 'default';
      if (selected && selected.kind !== 'raster') {
        const hit = hitChrome(selected, e.screen, v);
        if (hit?.kind === 'scale') next = handleCursor(hit.handle, selected.transform.rotation);
        else if (hit?.kind === 'rotate') next = 'grab';
        else if (hit?.kind === 'point') next = 'move';
      }
      if (next === 'default') {
        const doc = useDocStore.getState().active();
        const over = doc ? hitObject(doc, e.doc, v.zoom) : null;
        next = over ? 'move' : 'crosshair';
      }
      if (next !== hoverCursor) {
        hoverCursor = next;
        invalidate(false);
      }
      if (marqueeActive() && e.buttons & 1) extendMarquee(e.doc, e.shift);
      return;
    }

    if (drag.kind === 'float') {
      setFloatPosition(
        drag.origin.x + (e.doc.x - drag.grab.x),
        drag.origin.y + (e.doc.y - drag.grab.y),
      );
      return;
    }
    if (drag.kind === 'move') {
      const d = drag;
      const dx = e.doc.x - d.grab.x;
      const dy = e.doc.y - d.grab.y;
      mutate((obj) => {
        obj.transform = moveTransform(d.before.transform, dx, dy);
      });
      return;
    }
    if (drag.kind === 'scale') {
      mutate((obj) => {
        obj.transform = scaleTransform(
          (drag as Extract<Drag, { kind: 'scale' }>).before.transform,
          (drag as Extract<Drag, { kind: 'scale' }>).handle,
          e.doc,
          e.shift,
        );
      });
      return;
    }
    if (drag.kind === 'rotate') {
      const d = drag;
      mutate((obj) => {
        obj.transform = rotateTransform(d.before.transform, e.doc, e.shift);
      });
      return;
    }
    // Point drag: move a single vertex in unit space, leaving the transform alone.
    const idx = drag.index;
    mutate((obj) => {
      if (obj.kind !== 'shape' || !obj.points) return;
      const l = localFromWorld(obj.transform, e.doc);
      obj.points[idx] = { x: l.x, y: l.y };
    });
  },

  onPointerUp(e: ToolPointerEvent) {
    if (drag?.kind === 'float') {
      drag = null;
      return;
    }
    if (drag) {
      commit();
      return;
    }
    if (marqueeActive()) endMarquee(e.doc, e.shift);
  },

  drawOverlay(ctx, v) {
    drawMarquee(ctx, v);
  },

  deactivate() {
    commit();
    if (marqueeActive()) endMarquee(null, false);
  },
};

/**
 * Alt+click: remove the vertex under the pointer, or insert one on the nearest segment.
 * Both go through a single UpdateItemCommand so they undo as one step.
 */
function editPoints(obj: ObjectItem, at: Vec2, zoom: number) {
  if (obj.kind !== 'shape' || !obj.points) return;
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc) return;
  const local = localFromWorld(obj.transform, at);
  // Handle radius is in screen px; convert to unit space through the object's own size.
  const tolX = (POINT_HANDLE_R + 2) / Math.max(1e-6, zoom * obj.transform.w);
  const tolY = (POINT_HANDLE_R + 2) / Math.max(1e-6, zoom * obj.transform.h);
  const tol = Math.max(tolX, tolY);
  const shrunk = removeNearestPoint(obj.points, local, tol);
  const next = shrunk !== obj.points ? shrunk : insertPoint(obj.points, local);
  const before = cloneItem(obj);
  const after = cloneItem(obj) as typeof obj;
  after.points = next;
  ds.execute(new UpdateItemCommand('Edit points', obj.id, before, after));
}

/** Selected-object chrome is painted for every tool, not just Select. */
registerOverlayPainter((ctx, v) => {
  const obj = selectedObject();
  if (obj && obj.kind !== 'raster') drawObjectChrome(ctx, obj as ObjectItem, v);
});

/** Nudge the selected object — or a floating selection — with the arrow keys. */
export function nudgeSelected(dx: number, dy: number): boolean {
  if (useDocStore.getState().selection?.floating) {
    void import('../app/selectionActions').then((m) => m.moveFloat(dx, dy));
    return true;
  }
  const obj = selectedObject();
  if (!obj || obj.kind === 'raster') return false;
  const doc = useDocStore.getState().active();
  if (!doc) return false;
  const before = cloneItem(obj);
  const after = cloneItem(obj);
  after.transform = moveTransform(after.transform, dx, dy);
  useDocStore.getState().execute(new UpdateItemCommand('Nudge', obj.id, before, after));
  return true;
}

export const screenOf = (p: Vec2) => screenFromDoc(view(), p);
