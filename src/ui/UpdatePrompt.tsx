/**
 * Service-worker update prompt — docs/10 M12. Registration is `prompt`, not auto-reload:
 * reloading under someone mid-stroke would be its own kind of data loss.
 */
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [update, setUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => () => void updateSW(true));
      },
      onOfflineReady() {
        setReady(true);
        setTimeout(() => setReady(false), 4000);
      },
    });
  }, []);

  if (update) {
    return (
      <div className="swprompt">
        A new version of Monet is ready.
        <button className="btn btn--primary" onClick={update}>
          Reload
        </button>
        <button className="btn" onClick={() => setUpdate(null)}>
          Later
        </button>
      </div>
    );
  }
  if (ready) return <div className="swprompt">Monet is ready to work offline.</div>;
  return null;
}
