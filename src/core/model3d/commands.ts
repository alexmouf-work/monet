/**
 * Undoable model edits — docs/11 §10. Same command discipline as 2D: every geometry
 * mutation goes through docStore.executeModel, so history, the dirty flag and the
 * "reopen any parameter forever" promise all hold.
 */
import type { Model3D, ModelElement } from './types';

export interface ModelCommand {
  label: string;
  do(m: Model3D): void;
  undo(m: Model3D): void;
  /** Global edit order, stamped by the store (see core/model Command.seq). */
  seq?: number;
}

const cloneElement = (el: ModelElement): ModelElement => JSON.parse(JSON.stringify(el));

export class AddElementCommand implements ModelCommand {
  private snapshot: ModelElement;
  constructor(
    public label: string,
    element: ModelElement,
    private index?: number,
  ) {
    this.snapshot = cloneElement(element);
  }
  do(m: Model3D) {
    m.elements.splice(this.index ?? m.elements.length, 0, cloneElement(this.snapshot));
  }
  undo(m: Model3D) {
    const i = m.elements.findIndex((e) => e.id === this.snapshot.id);
    if (i >= 0) m.elements.splice(i, 1);
  }
}

export class RemoveElementsCommand implements ModelCommand {
  private removed: { index: number; element: ModelElement }[];
  constructor(
    public label: string,
    m: Model3D,
    ids: number[],
  ) {
    this.removed = m.elements
      .map((element, index) => ({ index, element }))
      .filter((x) => ids.includes(x.element.id))
      .map((x) => ({ index: x.index, element: cloneElement(x.element) }));
  }
  do(m: Model3D) {
    const ids = new Set(this.removed.map((r) => r.element.id));
    m.elements = m.elements.filter((e) => !ids.has(e.id));
  }
  undo(m: Model3D) {
    // Reinsert lowest index first so later indices stay valid.
    for (const r of [...this.removed].sort((a, b) => a.index - b.index)) {
      m.elements.splice(Math.min(r.index, m.elements.length), 0, cloneElement(r.element));
    }
  }
}

/**
 * The workhorse: any change to one element, captured as before/after snapshots. Numeric
 * fields, gizmo drags, mirrors, face edits — all of them are "the element was A, now it
 * is B", which is also exactly Onshape's re-editable-parameter promise (docs/11 §10.1).
 */
export class PatchElementCommand implements ModelCommand {
  private before: ModelElement;
  private after: ModelElement;
  constructor(
    public label: string,
    before: ModelElement,
    after: ModelElement,
  ) {
    this.before = cloneElement(before);
    this.after = cloneElement(after);
  }
  private swap(m: Model3D, to: ModelElement) {
    const i = m.elements.findIndex((e) => e.id === to.id);
    if (i >= 0) m.elements[i] = cloneElement(to);
  }
  do(m: Model3D) {
    this.swap(m, this.after);
  }
  undo(m: Model3D) {
    this.swap(m, this.before);
  }
}
