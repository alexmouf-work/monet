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
import type { Face, Model3D } from '../core/model3d/types';
import type { ModelCommand } from '../core/model3d/commands';
import { invalidateDoc, patchLayer } from '../engine/layerCache';
import { invalidate } from './bus';

/**
 * How the lifted pixels are being transformed, applied to `source` in this order: flip, scale
 * to (w,h), then rotate. Held as a description rather than as accumulated pixels so that every
 * change rebuilds from the ORIGINAL lift — twelve wheel notches cost one resample, not twelve
 * (docs/06 §4.1).
 */
export interface FloatTransform {
  /** Size the source is resampled to before rotating — what the resize handles set. */
  w: number;
  h: number;
  /** Clockwise degrees, 0–360. */
  angle: number;
  /** Mirrored left↔right / top↔bottom. */
  flipX: boolean;
  flipY: boolean;
}

export interface FloatingSelection {
  pixels: Uint8ClampedArray;
  /** Size of `pixels` — the rotated bounding box, so it grows off the right angles. */
  w: number;
  h: number;
  x: number;
  y: number;
  /** Pixels as originally lifted, so repeated scaling never compounds resampling. */
  source: { pixels: Uint8ClampedArray; w: number; h: number };
  xform: FloatTransform;
}

export interface SelectionState {
  rect: Rect;
  floating?: FloatingSelection;
}

interface History {
  undo: Command[];
  redo: Command[];
}

interface ModelHistory {
  undo: ModelCommand[];
  redo: ModelCommand[];
}

/** Monotonic stamp for every executed command, across ALL histories — the tie-breaker that
 *  lets a model's geometry history and its painted textures' histories undo newest-first. */
let editSeq = 0;

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
  modelHistories: Record<string, ModelHistory>;
  selection: SelectionState | null;
  selectedObjectId: number | null;
  /**
   * The PRIMARY selected 3D element — the one whose properties the panel edits and whose gizmo
   * is drawn (docs/11 §10.2). `selectedElementIds` is the whole selection; the primary is its
   * last member, so every single-selection consumer keeps working unchanged.
   */
  selectedElementId: number | null;
  /** Every selected element, for multi-select transforms (docs/11 §10.1). */
  selectedElementIds: number[];
  /** One level deeper (docs/11 §10.1 item 3): a face of the selected element, or null. */
  selectedFace: Face | null;
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
  /** Geometry edits on the active model — same 200-step discipline (docs/11 §10). */
  executeModel(cmd: ModelCommand): void;
  undo(): void;
  redo(): void;
  undoFor(docId: string): void;
  redoFor(docId: string): void;
  /**
   * Undo/redo across the active model's geometry history AND the given painted-texture
   * history, newest edit first (docs/11 §8.2) — with no model active they equal undo()/redo().
   */
  undoNewest(paintedDocId: string | null): void;
  redoNewest(paintedDocId: string | null): void;
  canUndo(): boolean;
  canRedo(): boolean;

  setSelection(s: SelectionState | null): void;
  selectObject(id: number | null): void;
  selectElement(id: number | null): void;
  /** Replace the whole element selection; the last id becomes primary. */
  selectElements(ids: number[]): void;
  /** Add or remove one element (Ctrl/Shift-click) keeping the rest. */
  toggleElement(id: number): void;
  selectFace(face: Face | null): void;
  /** Clear the element selection when history removed the element it pointed at. */
  dropStaleElementSelection(m: Model3D): void;
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
  modelHistories: {},
  selection: null,
  selectedObjectId: null,
  selectedElementId: null,
  selectedElementIds: [],
  selectedFace: null,
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
      const modelHistories = { ...s.modelHistories };
      delete modelHistories[id];
      const order = s.order.filter((o) => o !== id);
      const activeId = s.activeId === id ? (order[order.length - 1] ?? null) : s.activeId;
      return {
        docs,
        models,
        order,
        histories,
        modelHistories,
        activeId,
        selection: null,
        selectedObjectId: null,
        rev: s.rev + 1,
      };
    });
    invalidate();
  },

  setActive(id) {
    set({
      activeId: id,
      selection: null,
      selectedObjectId: null,
      selectedElementId: null,
      selectedElementIds: [],
      selectedFace: null,
    });
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

  executeModel(cmd) {
    const m = get().activeModel();
    if (!m) return;
    cmd.seq = ++editSeq;
    cmd.do(m);
    m.dirty = true;
    const h = get().modelHistories[m.id] ?? { undo: [], redo: [] };
    const undoStack = [...h.undo, cmd];
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    set((s) => ({
      modelHistories: { ...s.modelHistories, [m.id]: { undo: undoStack, redo: [] } },
    }));
    get().bump();
  },

  executeOn(docId, cmd) {
    const doc = get().docs[docId];
    if (!doc) return;
    cmd.seq = ++editSeq;
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
    const m = get().activeModel();
    if (m) {
      const h = get().modelHistories[m.id];
      if (!h?.undo.length) return;
      const cmd = h.undo[h.undo.length - 1];
      cmd.undo(m);
      m.dirty = true;
      set((s) => ({
        modelHistories: {
          ...s.modelHistories,
          [m.id]: { undo: h.undo.slice(0, -1), redo: [...h.redo, cmd] },
        },
      }));
      get().dropStaleElementSelection(m);
      get().bump();
      return;
    }
    const doc = get().active();
    if (!doc) return;
    get().undoFor(doc.id);
  },

  undoNewest(paintedDocId) {
    const s = get();
    const gid = s.activeId && s.models[s.activeId] ? s.activeId : null;
    const g = gid ? s.modelHistories[gid] : undefined;
    const p = paintedDocId ? s.histories[paintedDocId] : undefined;
    const gSeq = g?.undo.length ? (g.undo[g.undo.length - 1].seq ?? 0) : -1;
    const pSeq = p?.undo.length ? (p.undo[p.undo.length - 1].seq ?? 0) : -1;
    if (paintedDocId && pSeq > gSeq) get().undoFor(paintedDocId);
    else get().undo();
  },

  redoNewest(paintedDocId) {
    const s = get();
    const gid = s.activeId && s.models[s.activeId] ? s.activeId : null;
    const g = gid ? s.modelHistories[gid] : undefined;
    const p = paintedDocId ? s.histories[paintedDocId] : undefined;
    const gSeq = g?.redo.length ? (g.redo[g.redo.length - 1].seq ?? 0) : Infinity;
    const pSeq = p?.redo.length ? (p.redo[p.redo.length - 1].seq ?? 0) : Infinity;
    // Redo replays commit order — the smaller sequence number goes back on first.
    if (paintedDocId && pSeq < gSeq) get().redoFor(paintedDocId);
    else get().redo();
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
    const m = get().activeModel();
    if (m) {
      const h = get().modelHistories[m.id];
      if (!h?.redo.length) return;
      const cmd = h.redo[h.redo.length - 1];
      cmd.do(m);
      m.dirty = true;
      set((s) => ({
        modelHistories: {
          ...s.modelHistories,
          [m.id]: { undo: [...h.undo, cmd], redo: h.redo.slice(0, -1) },
        },
      }));
      get().dropStaleElementSelection(m);
      get().bump();
      return;
    }
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
    if (!id) return false;
    if (get().models[id]) return (get().modelHistories[id]?.undo.length ?? 0) > 0;
    return (get().histories[id]?.undo.length ?? 0) > 0;
  },

  canRedo() {
    const id = get().activeId;
    if (!id) return false;
    if (get().models[id]) return (get().modelHistories[id]?.redo.length ?? 0) > 0;
    return (get().histories[id]?.redo.length ?? 0) > 0;
  },

  selectElement(id) {
    // Changing depth-1 selection always climbs out of depth 2.
    set({ selectedElementId: id, selectedElementIds: id === null ? [] : [id], selectedFace: null });
    get().bump(false);
  },

  selectElements(ids) {
    set({
      selectedElementIds: [...ids],
      selectedElementId: ids.length ? ids[ids.length - 1] : null,
      selectedFace: null,
    });
    get().bump(false);
  },

  toggleElement(id) {
    const current = get().selectedElementIds;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    get().selectElements(next);
  },

  selectFace(face) {
    set({ selectedFace: face });
    get().bump(false);
  },

  dropStaleElementSelection(m) {
    const live = new Set(m.elements.map((e) => e.id));
    const ids = get().selectedElementIds.filter((id) => live.has(id));
    const primary = get().selectedElementId;
    if (ids.length !== get().selectedElementIds.length || (primary != null && !live.has(primary))) {
      set({
        selectedElementIds: ids,
        selectedElementId: ids.length ? ids[ids.length - 1] : null,
        selectedFace: null,
      });
    }
  },

  setSelection(s) {
    // A floating selection is composited into the document (compose.ts), so moving, resizing
    // or dropping one changes CONTENT. Only a plain marquee is pure screen-space chrome —
    // treating every selection change as chrome made a dragged float invisible until some
    // unrelated edit forced a recomposite (owner report 2026-08-11).
    const wasFloating = !!get().selection?.floating;
    set({ selection: s });
    get().bump(wasFloating || !!s?.floating);
  },

  selectObject(id) {
    const wasFloating = !!get().selection?.floating;
    set({ selectedObjectId: id, selection: null });
    get().bump(wasFloating);
  },
}));

/** The currently selected object, if any. */
export function selectedObject(): Item | null {
  const s = useDocStore.getState();
  const doc = s.active();
  if (!doc || s.selectedObjectId == null) return null;
  return doc.stack.find((i) => i.id === s.selectedObjectId) ?? null;
}
