/** IndexedDB helpers: autosave snapshots and cached source payloads — docs/07 §9, docs/08. */
import { del, get, keys, set } from 'idb-keyval';
import type { MonetDoc } from '../core/model/types';
import { writeMonet } from '../core/io/monetFile';

const AUTOSAVE_PREFIX = 'autosave:';
export const AUTOSAVE_MAX = 10;

export interface AutosaveEntry {
  docId: string;
  name: string;
  savedAt: number;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export async function putAutosave(doc: MonetDoc): Promise<void> {
  const entry: AutosaveEntry = {
    docId: doc.id,
    name: doc.name,
    savedAt: Date.now(),
    width: doc.width,
    height: doc.height,
    bytes: await writeMonet(doc),
  };
  await set(AUTOSAVE_PREFIX + doc.id, entry);
  await trimAutosaves();
}

export const dropAutosave = (docId: string) => del(AUTOSAVE_PREFIX + docId);

export async function listAutosaves(): Promise<AutosaveEntry[]> {
  const ks = (await keys()).filter(
    (k): k is string => typeof k === 'string' && k.startsWith(AUTOSAVE_PREFIX),
  );
  const out: AutosaveEntry[] = [];
  for (const k of ks) {
    const e = (await get(k)) as AutosaveEntry | undefined;
    if (e?.bytes) out.push(e);
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** Keep the newest AUTOSAVE_MAX snapshots. */
async function trimAutosaves(): Promise<void> {
  const all = await listAutosaves();
  for (const e of all.slice(AUTOSAVE_MAX)) await dropAutosave(e.docId);
}

export const idbGet = get;
export const idbSet = set;
export const idbDel = del;
export const idbKeys = keys;
