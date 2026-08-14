/**
 * Load a Minecraft model from the user's own files — docs/11 §4.5. Two routes in: pick the
 * JSON and hand over textures, or point at the folder and let them be found. Either way the
 * dialog shows exactly what the model asks for and what is still missing, and anything missing
 * can be filled with the magenta/black placeholder so the model still opens and stays editable.
 */
import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import {
  addDraftTextures,
  bundleDraft,
  cancelDraft,
  chooseDraftModel,
  openDraft,
  placeholderFor,
  placeholderForAll,
  startBundleFromFiles,
  startBundleFromFolder,
  subscribeBundleDraft,
} from '../../app/modelBundleActions';

export function LoadModelDialog({ onClose }: { onClose(): void }) {
  const [, force] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeBundleDraft(() => force((n) => n + 1)), []);

  const draft = bundleDraft();
  const run = (fn: () => Promise<unknown> | unknown) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const missing = draft?.textures.filter((t) => !t.have).length ?? 0;
  const placeholders = draft?.textures.filter((t) => t.placeholder).length ?? 0;
  const models = draft ? [...new Set(draft.source.paths().filter((p) => /\.json$/i.test(p)))] : [];

  return (
    <Dialog
      title="Open a Minecraft model"
      wide
      onCancel={() => {
        cancelDraft();
        onClose();
      }}
      confirmLabel={
        !draft
          ? 'Open'
          : missing
            ? `Open with ${missing} placeholder${missing === 1 ? '' : 's'}`
            : 'Open model'
      }
      confirmDisabled={!draft || busy}
      onConfirm={run(async () => {
        await openDraft();
        onClose();
      })}
    >
      {!draft ? (
        <>
          <p className="panel__hint">
            Open a model JSON from your machine. Monet works out which textures it references and
            asks for those; anything you do not have can use the placeholder checker.
          </p>
          <div className="field-row">
            <button className="btn" disabled={busy} onClick={run(startBundleFromFiles)}>
              Choose model JSON…
            </button>
            <button className="btn" disabled={busy} onClick={run(startBundleFromFolder)}>
              Choose the folder it lives in…
            </button>
          </div>
          <p className="panel__hint">
            Choosing the folder finds the textures next to the model automatically — matched by
            their asset path, or by filename when the folder is flat.
          </p>
        </>
      ) : (
        <>
          <div className="field-row">
            <span className="field-label">Model</span>
            {models.length > 1 ? (
              <select
                value={draft.jsonPath}
                onChange={(e) => chooseDraftModel(e.target.value)}
                style={{ flex: 1 }}
              >
                {models.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ flex: 1 }}>{draft.jsonPath}</span>
            )}
          </div>

          {draft.needs.models.length > 0 && (
            <div className="notice notice--error">
              This model inherits from {draft.needs.models.join(', ')}, which is not a vanilla
              parent and is not here. Add that JSON to the folder (or open the folder route) —
              without it the geometry may be incomplete.
            </div>
          )}

          <span className="field-label">
            Textures ({draft.textures.length - missing}/{draft.textures.length} found
            {placeholders ? `, ${placeholders} placeholder` : ''})
          </span>

          {draft.textures.length === 0 && (
            <p className="panel__hint">
              This model references no textures directly — it may inherit them from a parent.
            </p>
          )}

          <ul className="needlist">
            {draft.textures.map((t) => (
              <li className="needlist__row" key={t.path}>
                <span
                  className={`needlist__dot ${t.have ? (t.placeholder ? 'is-placeholder' : 'is-found') : 'is-missing'}`}
                  title={t.placeholder ? 'placeholder' : t.have ? 'found' : 'missing'}
                />
                <span className="needlist__path" title={t.path}>
                  {t.path.replace(/^assets\//, '')}
                </span>
                {t.have && !t.placeholder ? (
                  <span className="panel__hint" style={{ margin: 0 }}>
                    found
                  </span>
                ) : (
                  <>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={run(() => addDraftTextures(t.path))}
                    >
                      Add file…
                    </button>
                    {!t.placeholder && (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={run(() => placeholderFor(t.path))}
                        title="Use the magenta/black checker for now — you can paint on it"
                      >
                        Placeholder
                      </button>
                    )}
                    {t.placeholder && (
                      <span className="panel__hint" style={{ margin: 0 }}>
                        placeholder
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="field-row">
            <button className="btn" disabled={busy} onClick={run(() => addDraftTextures())}>
              Add textures…
            </button>
            <button
              className="btn"
              disabled={busy || missing === 0}
              onClick={run(placeholderForAll)}
            >
              Fill {missing || 'all'} missing with placeholder
            </button>
          </div>

          {draft.needs.unresolved.length > 0 && (
            <p className="panel__hint">
              {draft.needs.unresolved.join(', ')} point at another variable that nothing defines —
              those faces will show the missing-texture checker.
            </p>
          )}

          <p className="panel__hint">
            When you have finished editing, Export → Model bundle (.zip) gives you the model and
            every texture back, with your changes in them.
          </p>
        </>
      )}
    </Dialog>
  );
}
