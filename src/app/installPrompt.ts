/**
 * PWA installation state — docs/07 §10.1.
 *
 * This matters beyond tidiness: **file associations only exist for an installed app.** Chromium
 * registers Monet's `file_handlers` with Windows (and macOS/Linux) at install time, so "Open with
 * → Monet" in Explorer is downstream of the user having installed it. Hence a visible install
 * affordance rather than leaving it to the browser's address-bar icon.
 */
type InstallOutcome = 'accepted' | 'dismissed';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome }>;
}

let pending: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

const announce = () => {
  for (const fn of listeners) fn();
};

export function onInstallStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * True when the page is running as an installed app. `display-mode: browser` means a tab, and
 * iOS reports `navigator.standalone` instead — Monet's file handling is Chromium-only, but the
 * check is cheap and keeps the banner honest everywhere.
 */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return !!standalone;
}

export const canInstall = () => pending !== null;

/** Registered once at boot; the browser fires this only when the app is installable. */
export function watchInstallability(): () => void {
  const onPrompt = (e: Event) => {
    // Keeping the event is what allows an in-app button later; without preventDefault the
    // browser shows its own mini-infobar and the event is spent.
    e.preventDefault();
    pending = e as InstallPromptEvent;
    announce();
  };
  const onInstalled = () => {
    pending = null;
    announce();
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

/** Shows the browser's install dialog. Resolves to what the user chose. */
export async function promptInstall(): Promise<InstallOutcome | 'unavailable'> {
  const event = pending;
  if (!event) return 'unavailable';
  // The event is single-use whatever the outcome; drop it before awaiting the choice.
  pending = null;
  announce();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
