/** Recover work? — docs/07 §9. Lists autosave snapshots with age and a thumbnail. */
import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { readMonet } from '../../core/io/monetFile';
import { renderComposite } from '../../engine/compose';
import { scaleNearest } from '../../engine/exporters';
import { dropAutosave, listAutosaves, type AutosaveEntry } from '../../integrations/idb';
import { useDocStore } from '../../app/docStore';
import { toast } from '../../app/bus';

const age = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

export function RecoverDialog({ onClose }: { onClose(): void }) {
  const [entries, setEntries] = useState<AutosaveEntry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const list = await listAutosaves();
      setEntries(list);
      const next: Record<string, string> = {};
      for (const e of list) {
        try {
          const doc = await readMonet(e.bytes, e.name);
          const c = scaleNearest(renderComposite(doc), 32, 32, true);
          next[e.docId] = c.toDataURL('image/png');
        } catch {
          /* an unreadable snapshot still gets a row, just no thumbnail */
        }
      }
      setThumbs(next);
    })();
  }, []);

  const open = async (e: AutosaveEntry) => {
    try {
      const doc = await readMonet(e.bytes, e.name);
      doc.dirty = true;
      useDocStore.getState().addDoc(doc);
      await dropAutosave(e.docId);
      setEntries((prev) => prev.filter((x) => x.docId !== e.docId));
    } catch (err) {
      toast(`Could not recover ${e.name}: ${(err as Error).message}`, 'error');
    }
  };

  const discard = async (e: AutosaveEntry) => {
    await dropAutosave(e.docId);
    setEntries((prev) => prev.filter((x) => x.docId !== e.docId));
  };

  return (
    <Dialog title="Recover work?" onCancel={onClose} confirmLabel="Done" onConfirm={onClose}>
      {entries.length === 0 && <p className="panel__hint">Nothing left to recover.</p>}
      {entries.map((e) => (
        <div key={e.docId} className="recover__row">
          {thumbs[e.docId] ? (
            <img className="recover__thumb" src={thumbs[e.docId]} alt="" width={32} height={32} />
          ) : (
            <span className="recover__thumb" />
          )}
          <span className="recover__name">
            {e.name}
            <small>
              {e.width}×{e.height} · {age(e.savedAt)}
            </small>
          </span>
          <button className="btn" onClick={() => void open(e)}>
            Open
          </button>
          <button className="btn btn--danger" onClick={() => void discard(e)}>
            Discard
          </button>
        </div>
      ))}
    </Dialog>
  );
}
