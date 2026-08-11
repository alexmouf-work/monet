/** Writing a bound document back to its source — docs/08 §6.3, docs/11 §9.2 (regions). */
import type { MonetDoc } from '../core/model/types';
import { writeMonet } from '../core/io/monetFile';
import { compositePixels } from '../engine/compose';
import { decodeImage, encodePixelsToPng, exportPngBytes } from '../engine/exporters';
import { getComposeOpts } from '../ui/sceneHooks';
import { toast } from '../app/bus';
import { useDocStore } from '../app/docStore';
import { dropAutosave } from './idb';
import { getSource } from './sources';

/** Project mirror path for a texture — repo-root `.monet/` tree (owner decision D6). */
export const projectMirrorPath = (texturePath: string) =>
  `.monet/${texturePath.replace(/\.png$/i, '')}.monet`;

export async function saveBoundDoc(doc: MonetDoc): Promise<void> {
  const binding = doc.binding;
  if (!binding) return;
  const source = getSource(binding.sourceId);
  if (!source?.write) {
    toast('That source is read-only — use Save As.', 'error');
    return;
  }
  try {
    let png: Uint8Array;
    if (binding.region) {
      // Region-bound document (docs/11 §9.2): read the sheet, blit this document's composite
      // into its rectangle, write the whole sheet back. The mirror still saves the layered
      // project of the REGION document, so the editable state survives too.
      if (!source.readPath) throw new Error('the source cannot read the sheet back');
      const sheetBytes = await source.readPath(binding.path);
      const sheet = await decodeImage(new Blob([sheetBytes as BlobPart], { type: 'image/png' }));
      const r = binding.region;
      const patch = compositePixels(doc, getComposeOpts());
      for (let y = 0; y < r.h && y + r.y < sheet.height; y++) {
        for (let x = 0; x < r.w && x + r.x < sheet.width; x++) {
          const si = ((y + r.y) * sheet.width + (x + r.x)) * 4;
          const pi = (y * doc.width + x) * 4;
          sheet.pixels[si] = patch[pi];
          sheet.pixels[si + 1] = patch[pi + 1];
          sheet.pixels[si + 2] = patch[pi + 2];
          sheet.pixels[si + 3] = patch[pi + 3];
        }
      }
      png = await encodePixelsToPng(sheet.pixels, sheet.width, sheet.height);
    } else {
      png = await exportPngBytes(doc);
    }
    const project = await writeMonet(doc);
    await source.write(binding.path, png, project);
    useDocStore.getState().markSaved(doc.id);
    void dropAutosave(doc.id);
    toast(`Saved ${binding.path}`, 'ok');
  } catch (err) {
    toast(`Save failed: ${(err as Error).message}`, 'error');
  }
}
