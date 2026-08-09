/** Settings — docs/09 §6: GitHub token, cached jars, autosave, about. */
import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { readToken, useSettingsStore, writeToken } from '../../app/settingsStore';
import {
  cachedJarBytes,
  loadJarMetas,
  removeJarSource,
  type JarMeta,
} from '../../integrations/jar/jarSource';
import { removeSource } from '../../integrations/sources';
import { toast } from '../../app/bus';

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const [token, setToken] = useState(readToken());
  const [reveal, setReveal] = useState(false);
  const [jars, setJars] = useState<JarMeta[]>([]);
  const [cached, setCached] = useState(0);
  const autosaveSeconds = useSettingsStore((s) => s.autosaveSeconds);

  useEffect(() => {
    void loadJarMetas().then(setJars);
    void cachedJarBytes().then(setCached);
  }, []);

  const save = () => {
    writeToken(token.trim());
    toast(token.trim() ? 'GitHub token saved.' : 'GitHub token cleared.', 'ok');
    onClose();
  };

  return (
    <Dialog title="Settings" onCancel={onClose} confirmLabel="Save" onConfirm={save} wide>
      <section className="field-col">
        <span className="field-label">GitHub token</span>
        <div className="field-row">
          <input
            type={reveal ? 'text' : 'password'}
            style={{ flex: 1 }}
            placeholder="github_pat_… or ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn" onClick={() => setReveal((v) => !v)}>
            {reveal ? 'Hide' : 'Show'}
          </button>
          <button
            className="btn btn--danger"
            onClick={() => {
              setToken('');
              writeToken('');
              toast('GitHub token forgotten.');
            }}
          >
            Forget
          </button>
        </div>
        <p className="panel__hint">
          Create a <strong>fine-grained personal access token</strong>: Repository access → the
          repositories you will connect; Permissions → <strong>Contents: Read and write</strong>
          (Metadata is added automatically). Classic tokens with the <code>repo</code> scope also
          work. The token is stored in this browser only and is sent to <code>api.github.com</code>{' '}
          and nowhere else.
        </p>
      </section>

      <section className="field-col">
        <span className="field-label">Cached jars ({(cached / 1_048_576).toFixed(1)} MB)</span>
        {jars.length === 0 && <p className="panel__hint">No jars cached.</p>}
        {jars.map((j) => (
          <div className="field-row" key={j.id}>
            <span style={{ flex: 1 }}>{j.label}</span>
            <span className="panel__hint">{(j.bytes / 1_048_576).toFixed(1)} MB</span>
            <button
              className="btn btn--danger"
              onClick={() => {
                void removeJarSource(j.id).then(async () => {
                  removeSource(j.id);
                  setJars(await loadJarMetas());
                  setCached(await cachedJarBytes());
                });
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </section>

      <section className="field-col">
        <span className="field-label">Other</span>
        <p className="panel__hint">
          Autosave every {autosaveSeconds}s to this browser&apos;s storage · PDF page size A4 ·
          Monet v0.1.0
        </p>
      </section>
    </Dialog>
  );
}
