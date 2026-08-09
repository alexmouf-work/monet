/**
 * Open/save/export orchestration — docs/07 §1. Routing: a bound document saves back into
 * its source (docs/08), a document with a local handle overwrites in place, anything else
 * goes through Save As.
 */
import type { MonetDoc } from '../core/model/types';
import { MAX_DIM } from '../core/model/types';
import { createDoc } from '../core/model/document';
import { MonetFileError, readMonet, writeMonet } from '../core/io/monetFile';
import { exportRaster } from '../engine/exporters';
import { decodeImage } from '../engine/exporters';
import {
  TYPE_IMAGES,
  TYPE_MONET,
  TYPE_PNG,
  ensureWritePermission,
  forgetHandle,
  pickOpenFiles,
  pickSaveTarget,
  recallHandle,
  rememberHandle,
  writeToTarget,
  type SaveTarget,
} from '../integrations/fsa/localFile';
import { dropAutosave } from '../integrations/idb';
import { toast } from './bus';
import { useDocStore } from './docStore';
import { saveToSource, sourceIsWritable } from '../integrations/sources';

const stripExt = (name: string) => name.replace(/\.[^./\\]+$/, '');

/** Filename-safe: drop path separators and control characters, map × (from doc names) to x. */
const safeName = (name: string) =>
  name
    .replace(/×/g, 'x')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120) || 'texture';

export const suggestedPngName = (doc: MonetDoc) =>
  `${safeName(stripExt(doc.binding ? doc.binding.path.split('/').pop()! : doc.name))}.png`;

/** Ctrl+S — docs/07 §1. */
export async function saveDoc(doc: MonetDoc): Promise<void> {
  if (doc.binding && sourceIsWritable(doc.binding.sourceId)) {
    await saveToSource(doc);
    return;
  }
  const handle = recallHandle(doc.id);
  if (handle) {
    if (!(await ensureWritePermission(handle))) {
      toast('Permission to write that file was declined.', 'error');
      forgetHandle(doc.id);
      return;
    }
    await writeBlobFor(doc, handle.name, { kind: 'handle', handle, name: handle.name });
    return;
  }
  await saveDocAs(doc);
}

/** Ctrl+Shift+S — the format follows the chosen filename's extension. */
export async function saveDocAs(doc: MonetDoc): Promise<void> {
  const target = await pickSaveTarget(suggestedPngName(doc), [TYPE_PNG, TYPE_MONET]);
  if (!target) return;
  if (target.kind === 'handle') rememberHandle(doc.id, target.handle);
  await writeBlobFor(doc, target.name, target);
}

export async function saveProjectAs(doc: MonetDoc): Promise<void> {
  const target = await pickSaveTarget(`${safeName(stripExt(doc.name))}.monet`, [TYPE_MONET]);
  if (!target) return;
  const bytes = await writeMonet(doc);
  await writeToTarget(target, new Blob([bytes as BlobPart], { type: 'application/zip' }));
  finishSave(doc, target.name);
}

async function writeBlobFor(doc: MonetDoc, name: string, target: SaveTarget): Promise<void> {
  try {
    const blob = name.toLowerCase().endsWith('.monet')
      ? new Blob([(await writeMonet(doc)) as BlobPart], { type: 'application/zip' })
      : await exportRaster(doc, 'png');
    await writeToTarget(target, blob);
    finishSave(doc, name);
  } catch (err) {
    toast(`Save failed: ${(err as Error).message}`, 'error');
  }
}

function finishSave(doc: MonetDoc, name: string) {
  const ds = useDocStore.getState();
  ds.renameDoc(doc.id, name.replace(/\.(png|monet)$/i, ''));
  ds.markSaved(doc.id);
  void dropAutosave(doc.id);
  toast(`Saved ${name}`, 'ok');
}

/** Ctrl+O and window drag-drop. */
export async function openLocalFiles(): Promise<void> {
  const files = await pickOpenFiles([TYPE_IMAGES], true);
  for (const file of files) await openFile(file);
}

export async function openFile(file: File | Blob, nameHint?: string): Promise<void> {
  const name = nameHint ?? (file as File).name ?? 'Untitled';
  try {
    if (name.toLowerCase().endsWith('.monet')) {
      const doc = await readMonet(new Uint8Array(await file.arrayBuffer()), stripExt(name));
      useDocStore.getState().addDoc(doc);
      return;
    }
    const { pixels, width, height } = await decodeImage(file);
    if (width > MAX_DIM || height > MAX_DIM) {
      toast(`${name} is larger than ${MAX_DIM}px and cannot be opened.`, 'error');
      return;
    }
    useDocStore.getState().addDoc(createDoc({ name: stripExt(name), width, height, pixels }));
  } catch (err) {
    const msg = err instanceof MonetFileError ? err.message : `Could not open ${name}.`;
    toast(msg, 'error');
  }
}
