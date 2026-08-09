/**
 * Text tool — docs/03 §6.3. Clicking creates a text object and opens the editing overlay;
 * the object itself is a live item, so moving it later never disturbs strokes drawn on top.
 */
import type { TextObject } from '../core/model/types';
import { AddItemCommand } from '../core/model/commands';
import { makeTransform } from '../core/shapes/geometry';
import { layoutText } from '../engine/textLayout';
import { invalidate } from '../app/bus';
import { useDocStore } from '../app/docStore';
import { useToolStore } from '../app/toolStore';
import type { Tool, ToolPointerEvent } from './types';

/** The id currently being edited by the overlay, or null. */
let editingId: number | null = null;
const listeners = new Set<() => void>();

export const editingTextId = () => editingId;

export function subscribeTextEditing(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setEditing(id: number | null) {
  editingId = id;
  for (const fn of listeners) fn();
  invalidate();
}

export function beginEditing(id: number): void {
  setEditing(id);
}

/** Commit the overlay: empty text removes the object (docs/03 §6.3). */
export function endEditing(): void {
  const id = editingId;
  setEditing(null);
  if (id == null) return;
  const ds = useDocStore.getState();
  const doc = ds.active();
  const obj = doc?.stack.find((i) => i.id === id);
  if (!doc || !obj || obj.kind !== 'text') return;
  if (!obj.text.trim()) {
    ds.selectObject(null);
    // Remove through the history so the empty object never lingers.
    void import('../core/model/commands').then(({ RemoveItemsCommand }) =>
      ds.execute(new RemoveItemsCommand('Remove empty text', doc, [id])),
    );
  }
}

/** Keep transform.h in step with the laid-out line count — docs/03 §6.4. */
export function syncTextBox(obj: TextObject): void {
  const l = layoutText(obj);
  obj.transform.h = l.height;
  if (l.maxWidth > obj.transform.w) obj.transform.w = l.maxWidth;
}

export const textTool: Tool = {
  id: 'text',
  cursor: 'text',

  onPointerDown(e: ToolPointerEvent) {
    if (e.button !== 0) return;
    const ds = useDocStore.getState();
    const doc = ds.active();
    if (!doc) return;

    // Clicking an existing text object edits it instead of stacking a new one.
    const existing = [...doc.stack]
      .reverse()
      .find(
        (i): i is TextObject =>
          i.kind === 'text' &&
          Math.abs(e.doc.x - i.transform.cx) <= i.transform.w / 2 + 1 &&
          Math.abs(e.doc.y - i.transform.cy) <= i.transform.h / 2 + 1,
      );
    if (existing) {
      ds.selectObject(existing.id);
      beginEditing(existing.id);
      return;
    }

    const ts = useToolStore.getState();
    const sizePx = ts.text.sizePx || Math.max(8, Math.min(32, Math.round(doc.width / 8)));
    const boxW = Math.max(8, Math.round(doc.width * 0.4));
    const obj: TextObject = {
      kind: 'text',
      id: doc.nextItemId,
      transform: makeTransform(
        e.doc.x + boxW / 2,
        e.doc.y + Math.ceil(sizePx * 1.25) / 2,
        boxW,
        Math.ceil(sizePx * 1.25),
      ),
      text: '',
      fontFamily: ts.text.fontFamily,
      sizePx,
      bold: ts.text.bold,
      italic: ts.text.italic,
      underline: ts.text.underline,
      align: ts.text.align,
      color: ts.color,
      alpha: ts.alpha,
      crisp: ts.text.crisp,
    };
    doc.nextItemId += 1;
    ds.execute(new AddItemCommand('Add text', obj, doc.stack.length));
    ds.selectObject(obj.id);
    beginEditing(obj.id);
  },

  onKey(e: KeyboardEvent) {
    if (editingId != null && e.key === 'Escape') {
      endEditing();
      return true;
    }
    return false;
  },

  deactivate() {
    if (editingId != null) endEditing();
  },
};
