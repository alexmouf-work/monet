/**
 * "Sign in with GitHub" / signed-in account block — docs/08 §4.1, docs/09 §6. Shared by the
 * Settings dialog and the Connect-repository dialog so both show the same account state.
 */
import { useEffect, useState } from 'react';
import {
  beginSignIn,
  githubAppConfig,
  isSignedIn,
  onAuthChange,
  signInAvailable,
  signOut,
  signedInAs,
  signedInAvatar,
} from '../integrations/github/auth';
import { installUrl } from '../integrations/github/oauth';

/** Re-render on sign-in/out; the session lives outside React so components subscribe to it. */
export function useAuthState() {
  const [, force] = useState(0);
  useEffect(() => onAuthChange(() => force((n) => n + 1)), []);
  return { signedIn: isSignedIn(), login: signedInAs(), avatar: signedInAvatar() };
}

export function GithubAccount({ compact = false }: { compact?: boolean }) {
  const { signedIn, login, avatar } = useAuthState();
  const { appSlug } = githubAppConfig();

  if (signedIn) {
    return (
      <div className="account">
        {avatar && <img className="account__avatar" src={avatar} alt="" width={28} height={28} />}
        <span className="account__name">{login ? `@${login}` : 'Signed in to GitHub'}</span>
        <a
          className="linkbtn"
          href={installUrl(appSlug)}
          target="_blank"
          rel="noreferrer noopener"
          title="Choose which repositories Monet can read and write"
        >
          Repository access
        </a>
        <button className="btn" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  if (!signInAvailable()) {
    return compact ? null : (
      <p className="panel__hint">
        This deployment has no GitHub App configured, so sign-in is unavailable — use a personal
        access token below.
      </p>
    );
  }

  return (
    <div className="account">
      <button className="btn btn--primary" onClick={beginSignIn}>
        Sign in with GitHub
      </button>
      {!compact && (
        <span className="panel__hint" style={{ margin: 0 }}>
          Monet asks only for <strong>Contents</strong> on the repositories you choose.
        </span>
      )}
    </div>
  );
}
