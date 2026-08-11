/**
 * Document store — docs/01 §7. Holds documents by reference (pixel buffers are huge, so
 * mutation is in place) and exposes a `rev` counter that components subscribe to.
 * Every mutation goes through execute() so undo/redo and cache patching stay honest.
 */
import { create } from 'zustand';
import type { Item, MonetDoc, Rect, SourceBinding } from '../core/model/types';
import { isRaster } from '../core/model/types';
import { HISTORY_LIMIT, type Command } from '../core/model/commands';
import { createDoc } from '../core/model/document';
import type { Model3D } from '../core/model3d/types';
import { invalidateDoc, patchLayer } from '../engine/layerCache';
import { invalidate } from './bus';

export interface FloatingSelection {
  pixels: Uint8ClampedArray;
  w: number;
  h: number;
  x: number;
  y: number;
  /** Pixels as originally lifted, so repeated scaling never compounds resampling. */
  source: { pixels: Uint8ClampedArray; w: number; h: number };
}

export interface SelectionState {
  rect: Rect;
  floating?: FloatingSelection;
}

interface History {
  undo: Command[];
  redo: Command[];
}

interface DocState {
  docs: Record<string, MonetDoc>;
  /**
   * Model documents (docs/11) share `order` and `activeId` with image documents but live in
   * their own map — deliberately NOT the spec's single union type (deviation recorded in
   * docs/11 §3): `active()` returning null for a model id means every existing 2D consumer
   * degrades to its no-document state with zero changes, instead of every one of them
   * learning a second document kind.
   */
  models: Record<string, Model3D>;
  order: string[];
  activeId: string | null;
  histories: Record<string, History>;
  selection: SelectionState | null;
  selectedObjectId: number | null;
  rev: number;

  active(): MonetDoc | null;
  activeModel(): Model3D | null;
  bump(content?: boolean): void;
  addDoc(doc: MonetDoc): string;
  addModel(doc: Model3D): string;
  newDoc(opts: Parameters<typeof createDoc>[0]): string;
  closeDoc(id: string): void;
  setActive(id: string): void;
  renameDoc(id: string, name: string): void;
  bindDoc(id: string, binding: SourceBinding | undefined): void;
  markSaved(id: string): void;

  execute(cmd: Command): void;
  /** Execute against a specific document — the 3D paint path, where the ACTIVE doc is the
   *  model and the stroke's target is a texture document (docs/11 §8). */
  executeOn(docId: string, cmd: Command): void;
  undo(): void;
  redo(): void;
  undoFor(docId: string): void;
  redoFor(docId: string): void;
  canUndo(): boolean;
  canRedo(): boolean;

  setSelection(s: SelectionState | null): void;
  selectObject(id: number | null): void;
}

function applyCaches(doc: MonetDoc, cmd: Command) {
  const touched = cmd.touched();
  if (touched === 'all') {
    invalidateDoc(doc.id);
    return;
  }
  for (const id of touched) {
    const layer = doc.stack.find((i) => i.id === id);
    if (layer && isRaster(layer)) patchLayer(doc, layer, null);
  }
}

export const useDocStore = create<DocState>((set, get) => ({
  docs: {},
  models: {},
  order: [],
  activeId: null,
  histories: {},
  selection: null,
  selectedObjectId: null,
  rev: 0,

  active() {
    const { docs, activeId } = get();
    return activeId ? (docs[activeId] ?? null) : null;
  },

  activeModel() {
    const { models, activeId } = get();
    return activeId ? (models[activeId] ?? null) : null;
  },

  bump(content = true) {
    set((s) => ({ rev: s.rev + 1 }));
    invalidate(content);
  },

  addDoc(doc) {
    set((s) => ({
      docs: { ...s.docs, [doc.id]: doc },
      order: [...s.order, doc.id],
      activeId: doc.id,
      histories: { ...s.histories, [doc.id]: { undo: [], redo: [] } },
      selection: null,
      selectedObjectId: null,
      rev: s.rev + 1,
    }));
    invalidate();
    return doc.id;
  },

  newDoc(opts) {
    return get().addDoc(createDoc(opts));
  },

  addModel(doc) {
    set((s) => ({
      models: { ...s.models, [doc.id]: doc },
      order: [...s.order, doc.id],
      activeId: doc.id,
      selection: null,
      selectedObjectId: null,
      rev: s.rev + 1,
    }));
    invalidate();
    return doc.id;
  },

  closeDoc(id) {
    invalidateDoc(id);
    set((s) => {
      const docs = { ...s.docs };
      delete docs[id];
      const models = { ...s.models };
      delete models[id];
      const histories = { ...s.histories };
      delete histories[id];
      const order = s.order.filter((o) => o !== id);
      const activeId = s.activeId === id ? (order[order.length - 1] ?? null) : s.activeId;
      return {
        docs,
        models,
        order,
        histories,
        activeId,
        selection: null,
        selectedObjectId: null,
        rev: s.rev + 1,
      };
    });
    invalidate();
  },

  setActive(id) {
    set({ activeId: id, selection: null, selectedObjectId: null });
    get().bump();
  },

  renameDoc(id, name) {
    const doc = get().docs[id] ?? get().models[id];
    if (doc) {
      doc.name = name;
      get().bump(false);
    }
  },

  bindDoc(id, binding) {
    const doc = get().docs[id];
    if (doc) {
      doc.binding = binding;
      get().bump(false);
    }
  },

  markSaved(id) {
    const doc = get().docs[id] ?? get().models[id];
    if (doc) {
      doc.dirty = false;
      get().bump(false);
    }
  },

  execute(cmd) {
    const doc = get().active();
    if (doc) get().executeOn(doc.id, cmd);
  },

  executeOn(docId, cmd) {
    const doc = get().docs[docId];
    if (!doc) return;
    cmd.do(doc);
    doc.dirty = true;
    applyCaches(doc, cmd);
    const h = get().histories[doc.id] ?? { undo: [], redo: [] };
    const undoStack = [...h.undo, cmd];
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    set((s) => ({ histories: { ...s.histories, [doc.id]: { undo: undoStack, redo: [] } } }));
    get().bump();
  },

  undo() {
    const doc = get().active();
    if (!doc) return;
    get().undoFor(doc.id);
  },

  undoFor(docId) {
    const doc = get().docs[docId];
    if (!doc) return;
    const h = get().histories[doc.id];
    if (!h?.undo.length) return;
    const cmd = h.undo[h.undo.length - 1];
    cmd.undo(doc);
    doc.dirty = true;
    applyCaches(doc, cmd);
    set((s) => ({
      histories: {
        ...s.histories,
        [doc.id]: { undo: h.undo.slice(0, -1), redo: [...h.redo, cmd] },
      },
      selection: null,
    }));
    get().bump();
  },

  redo() {
    const doc = get().active();
    if (!doc) return;
    get().redoFor(doc.id);
  },

  redoFor(docId) {
    const doc = get().docs[docId];
    if (!doc) return;
    const h = get().histories[doc.id];
    if (!h?.redo.length) return;
    const cmd = h.redo[h.redo.length - 1];
    cmd.do(doc);
    doc.dirty = true;
    applyCaches(doc, cmd);
    set((s) => ({
      histories: {
        ...s.histories,
        [doc.id]: { undo: [...h.undo, cmd], redo: h.redo.slice(0, -1) },
      },
      selection: null,
    }));
    get().bump();
  },

  canUndo() {
    const id = get().activeId;
    return !!id && (get().histories[id]?.undo.length ?? 0) > 0;
  },

  canRedo() {
    const id = get().activeId;
    return !!id && (get().histories[id]?.redo.length ?? 0) > 0;
  },

  setSelection(s) {
    set({ selection: s });
    get().bump(false);
  },

  selectObject(id) {
    set({ selectedObjectId: id, selection: null });
    get().bump(false);
  },
}));

/** The currently selected object, if any. */
export function selectedObject(): Item | null {
  const s = useDocStore.getState();
  const doc = s.active();
  if (!doc || s.selectedObjectId == null) return null;
  return doc.stack.find((i) => i.id === s.selectedObjectId) ?? null;
}
