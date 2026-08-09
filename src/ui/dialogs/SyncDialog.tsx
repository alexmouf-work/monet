/** Sync — docs/08 §7. Fast-forward a target branch to the working branch, or merge. */
import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { describeGhError } from '../../integrations/github/api';
import type { RepoSource } from '../../integrations/github/repoSource';
import { getSource } from '../../integrations/sources';
import { toast } from '../../app/bus';

export function SyncDialog({ sourceId, onClose }: { sourceId: string; onClose(): void }) {
  const source = getSource(sourceId) as RepoSource | undefined;
  const [branches, setBranches] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [state, setState] = useState<{ ahead: number; behind: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    void (async () => {
      try {
        const list = await source.branches();
        setBranches(list);
        const preferred = list.includes('main')
          ? 'main'
          : list.includes(source.cfg.baseBranch)
            ? source.cfg.baseBranch
            : (list[0] ?? '');
        setTarget(preferred);
      } catch (err) {
        setError(describeGhError(err));
      }
    })();
  }, [source]);

  useEffect(() => {
    if (!source || !target) return;
    setState(null);
    void source
      .aheadBehind(target)
      .then(setState)
      .catch((err) => setError(describeGhError(err)));
  }, [source, target]);

  if (!source) return null;
  const work = source.cfg.workBranch;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await source.sync(target);
      const msg =
        result.mode === 'fast-forward'
          ? `${target} fast-forwarded to ${work} (@${result.sha.slice(0, 7)})`
          : `Merged ${work} into ${target}; both now at @${result.sha.slice(0, 7)}`;
      setDone(msg);
      toast(msg, 'ok');
      setState(await source.aheadBehind(target));
    } catch (err) {
      setError(describeGhError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Sync ${source.label}`}
      onCancel={onClose}
      confirmLabel={busy ? 'Syncing…' : 'Sync'}
      confirmDisabled={busy || !target || target === work}
      onConfirm={() => void run()}
    >
      <label className="field-col">
        <span className="field-label">Bring this branch up to {work}</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {branches.map((b) => (
            <option key={b} value={b} disabled={b === work}>
              {b}
              {b === work ? ' (working branch)' : ''}
            </option>
          ))}
        </select>
      </label>

      {state && (
        <p className="panel__hint">
          <strong>{work}</strong> is {state.ahead} ahead, {state.behind} behind{' '}
          <strong>{target}</strong>.
          {state.behind > 0 && ' A fast-forward is impossible, so Monet will make a merge commit.'}
          {state.ahead === 0 && state.behind === 0 && ' Already in sync.'}
        </p>
      )}

      {done && <div className="notice notice--ok">{done}</div>}
      {error && (
        <div className="notice notice--error">
          {error}
          {error.includes('conflict') && (
            <>
              {' '}
              <a
                href={`https://github.com/${source.cfg.owner}/${source.cfg.repo}/compare/${target}...${work}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Compare on GitHub
              </a>
            </>
          )}
        </div>
      )}
      <p className="panel__hint">Monet never force-pushes.</p>
    </Dialog>
  );
}
