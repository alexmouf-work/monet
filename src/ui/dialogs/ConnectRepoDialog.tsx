/** Connect repository — docs/08 §5, docs/09 §6. */
import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { describeGhError, parseRepoRef } from '../../integrations/github/api';
import { DEFAULT_WORK_BRANCH, connectRepo } from '../../integrations/github/repoSource';
import {
  accessibleRepos,
  githubAppConfig,
  type GhInstallationRepo,
} from '../../integrations/github/auth';
import { installUrl } from '../../integrations/github/oauth';
import { GithubAccount, useAuthState } from '../GithubAccount';
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
  const { signedIn } = useAuthState();
  const hasCredentials = signedIn || !!readToken();
  const parsed = parseRepoRef(ref);

  // Signed in: offer the repositories the installation actually covers, so a typo or a repo the
  // App cannot see is not the first thing the user discovers.
  const [repos, setRepos] = useState<GhInstallationRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setRepos(null);
    setReposError(null);
    accessibleRepos().then(
      (list) => live && setRepos(list),
      (err: Error) => live && setReposError(err.message),
    );
    return () => {
      live = false;
    };
  }, [signedIn]);

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
      confirmDisabled={busy || !hasCredentials}
      onConfirm={() => void connect()}
    >
      {!hasCredentials && (
        <div className="notice">
          <p style={{ marginTop: 0 }}>Monet needs access to GitHub first.</p>
          <GithubAccount compact />
          <p style={{ marginBottom: 0 }}>
            <button className="linkbtn" onClick={onNeedToken}>
              Or use a personal access token
            </button>{' '}
            with <strong>Contents: Read and write</strong> on the repositories you want to edit.
          </p>
        </div>
      )}

      {signedIn && (
        <div className="field-col">
          <span className="field-label">
            Repositories Monet can access
            {repos ? ` (${repos.length})` : ''}
          </span>
          {repos === null && !reposError && <p className="panel__hint">Loading…</p>}
          {reposError && <p className="panel__hint">Could not list repositories: {reposError}</p>}
          {repos?.length === 0 && (
            <p className="panel__hint">
              The Monet app is not installed on any repository yet.{' '}
              <a href={installUrl(githubAppConfig().appSlug)} target="_blank" rel="noreferrer">
                Grant it access
              </a>
              , then reopen this dialog.
            </p>
          )}
          {!!repos?.length && (
            <div className="repolist">
              {repos.map((r) => (
                <button
                  key={r.full_name}
                  className={`repolist__item ${ref === r.full_name ? 'is-active' : ''}`}
                  onClick={() => setRef(r.full_name)}
                  title={
                    r.permissions?.push === false
                      ? 'Read-only for this account — saves would fail'
                      : r.full_name
                  }
                >
                  <span className="repolist__name">{r.full_name}</span>
                  <span className="repolist__meta">
                    {r.permissions?.push === false ? 'read-only' : r.default_branch}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="panel__hint">
            Missing one?{' '}
            <a href={installUrl(githubAppConfig().appSlug)} target="_blank" rel="noreferrer">
              Change which repositories Monet can access
            </a>
            .
          </p>
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
