/** Writing a bound document back to its source — docs/08 §6.3. */
import type { MonetDoc } from '../core/model/types';
import { writeMonet } from '../core/io/monetFile';
import { exportPngBytes } from '../engine/exporters';
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
    const [png, project] = await Promise.all([exportPngBytes(doc), writeMonet(doc)]);
    await source.write(binding.path, png, project);
    useDocStore.getState().markSaved(doc.id);
    void dropAutosave(doc.id);
    toast(`Saved ${binding.path}`, 'ok');
  } catch (err) {
    toast(`Save failed: ${(err as Error).message}`, 'error');
  }
}
