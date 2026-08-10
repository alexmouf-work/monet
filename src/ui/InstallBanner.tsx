/**
 * Install affordance — docs/07 §10.1. Shown only when the browser says Monet is installable and
 * the user has not dismissed it. The pitch is the file association, because that is the thing
 * installing actually unlocks: Windows can only offer "Open with → Monet" for an installed app.
 */
import { useEffect, useState } from 'react';
import { canInstall, isInstalled, onInstallStateChange, promptInstall } from '../app/installPrompt';
import { hasFileHandling } from '../app/launchFiles';
import { toast } from '../app/bus';

const DISMISSED_KEY = 'monet.install.dismissed';

/** Cosmetic: name the thing the user is actually looking at. A wrong guess costs a word. */
const fileManager = () => (/windows/i.test(navigator.userAgent) ? 'File Explorer' : 'your files');

const wasDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

export function InstallBanner() {
  const [available, setAvailable] = useState(canInstall());
  const [dismissed, setDismissed] = useState(wasDismissed);

  useEffect(() => onInstallStateChange(() => setAvailable(canInstall())), []);

  if (!available || dismissed || isInstalled()) return null;

  return (
    <div className="swprompt">
      <span>
        {hasFileHandling()
          ? `Install Monet to open textures straight from ${fileManager()} — right-click a PNG → Open with → Monet.`
          : 'Install Monet to run it in its own window, offline.'}
      </span>
      <button
        className="btn btn--primary"
        onClick={() => {
          void promptInstall().then((outcome) => {
            if (outcome === 'accepted')
              toast('Monet installed — image files can open with it now.', 'ok');
          });
        }}
      >
        Install
      </button>
      <button
        className="btn"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(DISMISSED_KEY, '1');
          } catch {
            /* dismissal just won't persist */
          }
        }}
      >
        Not now
      </button>
    </div>
  );
}
