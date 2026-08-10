/**
 * Files handed to Monet by the operating system — docs/07 §10.
 *
 * When the installed PWA is used to open a file (Explorer's "Open with", double-click once
 * Monet is the default, `open`/`xdg-open`), Chromium launches the app and delivers
 * `FileSystemFileHandle`s through `window.launchQueue`. Handles, not blobs: the same object the
 * save picker produces, so `Ctrl+S` overwrites the file the user opened, in place, with no
 * dialog — which is the whole point of opening from the file manager.
 */
import { openFile } from './fileActions';
import { rememberHandle } from '../integrations/fsa/localFile';
import { toast } from './bus';

interface LaunchParams {
  files?: FileSystemFileHandle[];
  targetURL?: string;
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

export const hasFileHandling = () =>
  typeof window !== 'undefined' && 'launchQueue' in window && 'LaunchParams' in window;

let started = false;

/**
 * Registered once, as early as possible. The queue holds a launch until a consumer exists, so a
 * file that arrives before the app finished booting is not lost.
 *
 * Idempotent on purpose: React's StrictMode runs mount effects twice in development, and a second
 * consumer meant the launch was handled twice — every file opened as two documents.
 */
export function startFileHandling(): void {
  if (started) return;
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue) return;
  started = true;
  queue.setConsumer((params) => {
    void handleLaunch(params);
  });
}

async function handleLaunch(params: LaunchParams): Promise<void> {
  const handles = params.files ?? [];
  if (!handles.length) return;

  let opened = 0;
  for (const handle of handles) {
    try {
      const file = await handle.getFile();
      const docId = await openFile(file, file.name || handle.name);
      // Bind the document to the handle it came from, so saving writes back to that exact file
      // rather than asking where to put it. Write permission is requested at save time.
      if (docId) {
        rememberHandle(docId, handle);
        opened += 1;
      }
    } catch (err) {
      // A revoked or moved handle is the usual cause; name the file rather than failing mutely.
      toast(`Could not open ${handle.name || 'that file'}: ${(err as Error).message}`, 'error');
    }
  }

  if (opened > 1) toast(`Opened ${opened} files.`, 'ok');
}
