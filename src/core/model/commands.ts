/** Undo/redo commands — docs/01 §6. Every document mutation goes through one. */
import type { Background, Item, MonetDoc, Rect } from './types';
import { isRaster } from './types';
import { copyRect, pasteRect } from '../raster/pixels';
import { cloneDoc, cloneItem } from './document';

export interface Command {
  label: string;
  /** Rects (doc space) whose layer caches need patching after do/undo; null = whole doc. */
  do(doc: MonetDoc): void;
  undo(doc: MonetDoc): void;
  /** Layer ids touched, or 'all' when the stack itself changed. */
  touched(): number[] | 'all';
}

export const HISTORY_LIMIT = 200;

export interface LayerPatch {
  layerId: number;
  rect: Rect;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
}

/** Captures a per-layer pixel crop pair. Used by every raster-mutating operation. */
export class StrokeCommand implements Command {
  constructor(
    public label: string,
    private patches: LayerPatch[],
  ) {}

  static capture(
    doc: MonetDoc,
    label: string,
    layerIds: number[],
    rect: Rect,
    before: Map<number, Uint8ClampedArray>,
  ): StrokeCommand {
    const patches: LayerPatch[] = [];
    for (const id of layerIds) {
      const layer = doc.stack.find((i) => i.id === id);
      if (!layer || !isRaster(layer)) continue;
      const beforeFull = before.get(id);
      if (!beforeFull) continue;
      patches.push({
        layerId: id,
        rect,
        before: copyRect(beforeFull, doc.width, rect),
        after: copyRect(layer.pixels, doc.width, rect),
      });
    }
    return new StrokeCommand(label, patches);
  }

  private apply(doc: MonetDoc, which: 'before' | 'after') {
    for (const p of this.patches) {
      const layer = doc.stack.find((i) => i.id === p.layerId);
      if (layer && isRaster(layer)) pasteRect(layer.pixels, doc.width, p.rect, p[which]);
    }
  }

  do(doc: MonetDoc) {
    this.apply(doc, 'after');
  }
  undo(doc: MonetDoc) {
    this.apply(doc, 'before');
  }
  touched() {
    return this.patches.map((p) => p.layerId);
  }
}

export class AddItemCommand implements Command {
  private snapshot: Item;
  constructor(
    public label: string,
    item: Item,
    private index: number,
  ) {
    this.snapshot = cloneItem(item);
  }
  do(doc: MonetDoc) {
    doc.stack.splice(this.index, 0, cloneItem(this.snapshot));
  }
  undo(doc: MonetDoc) {
    doc.stack.splice(this.index, 1);
  }
  touched(): 'all' {
    return 'all';
  }
}

export class RemoveItemsCommand implements Command {
  private removed: { index: number; item: Item }[];
  constructor(
    public label: string,
    doc: MonetDoc,
    ids: number[],
  ) {
    this.removed = doc.stack
      .map((item, index) => ({ index, item }))
      .filter((e) => ids.includes(e.item.id))
      .map((e) => ({ index: e.index, item: cloneItem(e.item) }));
  }
  do(doc: MonetDoc) {
    const ids = this.removed.map((r) => r.item.id);
    doc.stack = doc.stack.filter((i) => !ids.includes(i.id));
  }
  undo(doc: MonetDoc) {
    for (const r of [...this.removed].sort((a, b) => a.index - b.index)) {
      doc.stack.splice(r.index, 0, cloneItem(r.item));
    }
  }
  touched(): 'all' {
    return 'all';
  }
}

/** Move/resize/rotate/style/text edits. Drags coalesce into one of these on pointer-up. */
export class UpdateItemCommand implements Command {
  constructor(
    public label: string,
    private id: number,
    private before: Item,
    private after: Item,
  ) {
    this.before = cloneItem(before);
    this.after = cloneItem(after);
  }
  private set(doc: MonetDoc, v: Item) {
    const i = doc.stack.findIndex((it) => it.id === this.id);
    if (i >= 0) doc.stack[i] = cloneItem(v);
  }
  do(doc: MonetDoc) {
    this.set(doc, this.after);
  }
  undo(doc: MonetDoc) {
    this.set(doc, this.before);
  }
  touched() {
    return [this.id];
  }
}

/** Whole-document snapshot command — canvas resize/rotate/flip/crop/flatten. */
export class SnapshotCommand implements Command {
  private beforeDoc: MonetDoc;
  private afterDoc: MonetDoc;
  constructor(
    public label: string,
    before: MonetDoc,
    after: MonetDoc,
  ) {
    this.beforeDoc = cloneDoc(before);
    this.afterDoc = cloneDoc(after);
  }
  private restore(doc: MonetDoc, from: MonetDoc) {
    const c = cloneDoc(from);
    doc.width = c.width;
    doc.height = c.height;
    doc.background = c.background;
    doc.stack = c.stack;
    doc.nextItemId = c.nextItemId;
  }
  do(doc: MonetDoc) {
    this.restore(doc, this.afterDoc);
  }
  undo(doc: MonetDoc) {
    this.restore(doc, this.beforeDoc);
  }
  touched(): 'all' {
    return 'all';
  }
}

export class BackgroundCommand implements Command {
  label = 'Background';
  constructor(
    private before: Background,
    private after: Background,
  ) {}
  do(doc: MonetDoc) {
    doc.background = { ...this.after };
  }
  undo(doc: MonetDoc) {
    doc.background = { ...this.before };
  }
  touched(): 'all' {
    return 'all';
  }
}
