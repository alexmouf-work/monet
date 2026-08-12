/**
 * Element-level edit actions on the active model — shared by the Model panel, the keyboard
 * map and the viewport context menu (docs/11 §10). All of them go through executeModel, so
 * every route into an edit is the same undoable command.
 */
import { useDocStore } from './docStore';
import {
  AddElementCommand,
  PatchElementCommand,
  RemoveElementsCommand,
} from '../core/model3d/commands';
import { duplicateElement, mirrorElement, newCube } from '../core/model3d/edit';
import type { Axis, Face } from '../core/model3d/types';

export function addCube(): void {
  const ds = useDocStore.getState();
  const m = ds.activeModel();
  if (!m) return;
  const el = newCube(m.nextItemId);
  m.nextItemId += 1;
  ds.executeModel(new AddElementCommand('Add cube', el));
  ds.selectElement(el.id);
}

export function duplicateSelectedElement(): void {
  const ds = useDocStore.getState();
  const m = ds.activeModel();
  const el = m?.elements.find((e) => e.id === ds.selectedElementId);
  if (!m || !el) return;
  const copy = duplicateElement(el, m.nextItemId);
  m.nextItemId += 1;
  ds.executeModel(new AddElementCommand('Duplicate element', copy));
  ds.selectElement(copy.id);
}

export function deleteSelectedElement(): void {
  const ds = useDocStore.getState();
  const m = ds.activeModel();
  if (!m || ds.selectedElementId == null) return;
  const id = ds.selectedElementId;
  ds.selectElement(null);
  ds.executeModel(new RemoveElementsCommand('Delete element', m, [id]));
}

export function mirrorSelectedElement(axis: Axis): void {
  const ds = useDocStore.getState();
  const m = ds.activeModel();
  const el = m?.elements.find((e) => e.id === ds.selectedElementId);
  if (!m || !el) return;
  ds.executeModel(new PatchElementCommand(`Mirror ${axis}`, el, mirrorElement(el, axis)));
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
