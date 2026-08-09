/** Edit-menu operations that span tools — delete, duplicate, clear — docs/06 §4, docs/09 §2. */
import type { RasterLayer } from '../core/model/types';
import { isRaster } from '../core/model/types';
import { RemoveItemsCommand, StrokeCommand, AddItemCommand } from '../core/model/commands';
import { cloneItem } from '../core/model/document';
import { clampRect, clearRect } from '../core/raster/pixels';
import { useDocStore } from './docStore';

/**
 * Del: with an object selected, remove it; with a floating selection, drop it; with a
 * marquee, clear those pixels across every raster layer (docs/06 §4.1 step 5).
 */
export function deleteSelection(): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc) return;

  if (ds.selectedObjectId != null) {
    const id = ds.selectedObjectId;
    ds.selectObject(null);
    ds.execute(new RemoveItemsCommand('Delete object', doc, [id]));
    return;
  }

  const sel = ds.selection;
  if (!sel) return;

  if (sel.floating) {
    // Discarding a float leaves the already-cleared source region as it is.
    ds.setSelection({ rect: sel.rect });
    return;
  }

  const rect = clampRect(sel.rect, doc.width, doc.height);
  if (rect.w === 0 || rect.h === 0) return;
  const layers = doc.stack.filter(isRaster) as RasterLayer[];
  if (!layers.length) return;

  const before = new Map(layers.map((l) => [l.id, new Uint8ClampedArray(l.pixels)]));
  for (const l of layers) clearRect(l.pixels, doc.width, doc.height, rect);
  const cmd = StrokeCommand.capture(
    doc,
    'Clear selection',
    layers.map((l) => l.id),
    rect,
    before,
  );
  cmd.undo(doc);
  ds.execute(cmd);
}

/** Ctrl+D — duplicate the selected object, offset by 8px (docs/03 §2.2). */
export function duplicateSelected(): void {
  const ds = useDocStore.getState();
  const doc = ds.active();
  if (!doc || ds.selectedObjectId == null) return;
  const src = doc.stack.find((i) => i.id === ds.selectedObjectId);
  if (!src || src.kind === 'raster') return;

  const copy = cloneItem(src);
  copy.id = doc.nextItemId;
  doc.nextItemId += 1;
  copy.transform = { ...copy.transform, cx: copy.transform.cx + 8, cy: copy.transform.cy + 8 };
  ds.execute(new AddItemCommand('Duplicate', copy, doc.stack.length));
  ds.selectObject(copy.id);
}
