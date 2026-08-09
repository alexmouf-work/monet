/**
 * Save As — docs/09 §6, source targets per docs/08 §6.3. Picks between a writable connected
 * source (with a repo-relative path, pre-filled from where the document came from) and a
 * local file.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from './Dialog';
import type { MonetDoc } from '../../core/model/types';
import { saveDocAs, suggestedPngName } from '../../app/fileActions';
import { useDocStore } from '../../app/docStore';
import { toast } from '../../app/bus';
import { listSources, getSource } from '../../integrations/sources';
import type { RepoSource } from '../../integrations/github/repoSource';
import { saveBoundDoc } from '../../integrations/sourceSave';

/**
 * Where a document opened from a jar would naturally live in a mod repo: keep the jar's
 * `assets/...` tail and hang it off the repo's own assets root.
 */
function suggestPath(doc: MonetDoc, roots: string[], sameSource: boolean): string {
  const from = doc.binding?.path;
  // Saving back into the source it came from: keep the exact path.
  if (from && sameSource) return from;
  const root = roots.find((r) => r.length > 0) ?? '';
  // Otherwise keep the `assets/...` tail (a jar path carries its category) under this repo's root.
  const i = from ? from.indexOf('assets/') : -1;
  const tail = i >= 0 ? from!.slice(i) : `assets/minecraft/textures/item/${suggestedPngName(doc)}`;
  return `${root}${tail}`;
}

export function SaveAsDialog({ onClose }: { onClose(): void }) {
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  const writable = useMemo(() => listSources().filter((s) => s.writable), []);
  // A document opened from a jar is bound to a read-only source, so only reuse that binding
  // when it can actually be written to.
  const boundWritable = doc?.binding && writable.some((s) => s.id === doc.binding!.sourceId);
  const [targetId, setTargetId] = useState<string>(
    (boundWritable ? doc!.binding!.sourceId : writable[0]?.id) ?? 'local',
  );
  const [roots, setRoots] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  const target = targetId === 'local' ? null : getSource(targetId);

  useEffect(() => {
    if (!doc) return;
    if (!target) return;
    const repo = target as unknown as RepoSource;
    void (async () => {
      const list =
        typeof repo.assetsRoots === 'function' ? await repo.assetsRoots().catch(() => []) : [];
      setRoots(list);
      setPath((prev) => prev || suggestPath(doc, list, doc.binding?.sourceId === target.id));
    })();
  }, [doc, target]);

  if (!doc) return null;

  const save = async () => {
    setBusy(true);
    try {
      if (!target) {
        await saveDocAs(doc);
        onClose();
        return;
      }
      const clean = path.replace(/^\/+/, '').trim();
      if (!/\.png$/i.test(clean)) {
        toast('The path needs to end in .png', 'error');
        return;
      }
      useDocStore.getState().bindDoc(doc.id, { sourceId: target.id, path: clean });
      await saveBoundDoc(useDocStore.getState().docs[doc.id]);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Save as"
      onCancel={onClose}
      confirmLabel={busy ? 'Saving…' : 'Save'}
      confirmDisabled={busy}
      onConfirm={() => void save()}
      wide
    >
      <label className="field-col">
        <span className="field-label">Where</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {writable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.kind === 'repo' ? '⎇' : '📁'} {s.label}
              {s.kind === 'repo' ? ' (commit + push)' : ' (write in place)'}
            </option>
          ))}
          <option value="local">💾 Local file…</option>
        </select>
      </label>

      {target ? (
        <>
          <label className="field-col">
            <span className="field-label">Path inside {target.label}</span>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              spellCheck={false}
            />
          </label>
          {roots.length > 1 && (
            <div className="presets">
              {roots.map((r) => (
                <button
                  key={r || '(root)'}
                  className="chipbtn"
                  onClick={() =>
                    setPath(
                      `${r}assets/minecraft/textures/item/${suggestedPngName(doc)}`.replace(
                        /^\/+/,
                        '',
                      ),
                    )
                  }
                  title="Use this assets root"
                >
                  {r || '(repo root)'}
                </button>
              ))}
            </div>
          )}
          <p className="panel__hint">
            Saving writes the PNG plus its layered project to{' '}
            <code>.monet/{path.replace(/\.png$/i, '')}.monet</code>, in one commit.
          </p>
        </>
      ) : (
        <p className="panel__hint">
          Choose a location on this computer. The format follows the filename&apos;s extension (.png
          or .monet).
        </p>
      )}
    </Dialog>
  );
}
