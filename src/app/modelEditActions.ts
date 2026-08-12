/**
 * Element-level edit actions on the active model — shared by the Model panel, the keyboard
 * map and the viewport context menu (docs/11 §10). All of them go through executeModel, so
 * every route into an edit is the same undoable command.
 */
import { useDocStore } from './docStore';
import {
  AddElementCommand,
  AddElementsCommand,
  PatchElementCommand,
  PatchElementsCommand,
  RemoveElementsCommand,
} from '../core/model3d/commands';
import { duplicateElement, mirrorElement, newCube } from '../core/model3d/edit';
import type { Axis, Face, Model3D, ModelElement } from '../core/model3d/types';

export function addCube(): void {
  const ds = useDocStore.getState();
  const m = ds.activeModel();
  if (!m) return;
  const el = newCube(m.nextItemId);
  m.nextItemId += 1;
  ds.executeModel(new AddElementCommand('Add cube', el));
  ds.selectElement(el.id);
}

/** The selected elements, in document order. */
function selection(): { m: Model3D | null; els: ModelElement[] } {
  const ds = useDocStore.getState();
  const m = ds.activeModel();
  const ids = new Set(ds.selectedElementIds);
  return { m, els: m ? m.elements.filter((e) => ids.has(e.id)) : [] };
}

/** Duplicate every selected element as ONE step, and select the copies. */
export function duplicateSelectedElement(): void {
  const ds = useDocStore.getState();
  const { m, els } = selection();
  if (!m || !els.length) return;
  const copies = els.map((el) => duplicateElement(el, m.nextItemId++));
  ds.executeModel(new AddElementsCommand('Duplicate elements', copies));
  ds.selectElements(copies.map((c) => c.id));
}

export function deleteSelectedElement(): void {
  const ds = useDocStore.getState();
  const { m, els } = selection();
  if (!m || !els.length) return;
  const ids = els.map((e) => e.id);
  ds.selectElement(null);
  ds.executeModel(
    new RemoveElementsCommand(ids.length > 1 ? 'Delete elements' : 'Delete element', m, ids),
  );
}

export function mirrorSelectedElement(axis: Axis): void {
  const ds = useDocStore.getState();
  const { m, els } = selection();
  if (!m || !els.length) return;
  if (els.length === 1) {
    ds.executeModel(new PatchElementCommand(`Mirror ${axis}`, els[0], mirrorElement(els[0], axis)));
    return;
  }
  ds.executeModel(
    new PatchElementsCommand(
      `Mirror ${axis}`,
      els.map((el) => ({ before: el, after: mirrorElement(el, axis) })),
    ),
  );
}

/** Turn one face of the selected element off (it stops rendering). */
export function removeSelectedFace(face: Face): void {
  const ds = useDocStore.getState();
  const m = ds.activeModel();
  const el = m?.elements.find((e) => e.id === ds.selectedElementId);
  if (!m || !el || !el.faces[face]) return;
  const after = JSON.parse(JSON.stringify(el)) as typeof el;
  delete after.faces[face];
  ds.executeModel(new PatchElementCommand(`Remove ${face} face`, el, after));
}
