/** Connect repository — docs/08 §5, docs/09 §6. */
import { useState } from 'react';
import { Dialog } from './Dialog';
import { describeGhError, parseRepoRef } from '../../integrations/github/api';
import { DEFAULT_WORK_BRANCH, connectRepo } from '../../integrations/github/repoSource';
import { readToken } from '../../app/settingsStore';
import { toast } from '../../app/bus';

export function ConnectRepoDialog({
  onClose,
  onNeedToken,
}: {
  onClose(): void;
  onNeedToken(): void;
}) {
  const [ref, setRef] = useState('');
  const [workBranch, setWorkBranch] = useState(DEFAULT_WORK_BRANCH);
  const [baseBranch, setBaseBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasToken = !!readToken();
  const parsed = parseRepoRef(ref);

  const connect = async () => {
    if (!parsed) {
      setError('Enter a repository as owner/repo or a github.com URL.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const source = await connectRepo({
        owner: parsed.owner,
        repo: parsed.repo,
        workBranch: workBranch.trim() || DEFAULT_WORK_BRANCH,
        baseBranch: baseBranch.trim() || undefined,
      });
      toast(`Connected ${source.label} on branch ${source.cfg.workBranch}`, 'ok');
      onClose();
    } catch (err) {
      setError(describeGhError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Connect GitHub repository"
      onCancel={onClose}
      confirmLabel={busy ? 'Connecting…' : 'Connect'}
      confirmDisabled={busy || !hasToken}
      onConfirm={() => void connect()}
    >
      {!hasToken && (
        <div className="notice">
          No GitHub token yet.{' '}
          <button className="linkbtn" onClick={onNeedToken}>
            Add one in Settings
          </button>{' '}
          — a fine-grained token with <strong>Contents: Read and write</strong> on the repositories
          you want to edit.
        </div>
      )}

      <label className="field-col">
        <span className="field-label">Repository</span>
        <input
          type="text"
          placeholder="owner/repo or https://github.com/owner/repo"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
      </label>
      {ref && !parsed && <p className="panel__hint">Not a recognisable repository reference.</p>}

      <div className="field-row">
        <label className="field-col" style={{ flex: 1 }}>
          <span className="field-label">Working branch (Monet pushes here)</span>
          <input type="text" value={workBranch} onChange={(e) => setWorkBranch(e.target.value)} />
        </label>
        <label className="field-col" style={{ flex: 1 }}>
          <span className="field-label">Base branch (blank = default)</span>
          <input
            type="text"
            placeholder="main"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
          />
        </label>
      </div>

      <p className="panel__hint">
        Monet creates the working branch from the base branch if it does not exist, commits and
        pushes on every save, and never force-pushes.
      </p>
      {error && <div className="notice notice--error">{error}</div>}
    </Dialog>
  );
}
