/**
 * Model tab panel — docs/11 §11. M13 scope: view controls, model facts, the missing-refs
 * banner and a read-only outliner. Element editing arrives with M16.
 */
import { useState } from 'react';
import { useDocStore } from '../../app/docStore';
import { invalidate } from '../../app/bus';
import { frameModel, snapView, updateCamera, viewPrefs } from '../ModelWorkspace';

export function ModelPanel() {
  const doc = useDocStore((s) => (s.activeId ? s.models[s.activeId] : null));
  useDocStore((s) => s.rev);
  const [, force] = useState(0);
  if (!doc) return null;

  const toggle = (fn: () => void) => () => {
    fn();
    invalidate(false);
    force((n) => n + 1);
  };

  return (
    <div className="panel">
      <h3 className="panel__title">Model</h3>

      {doc.missing.length > 0 && (
        <div className="notice notice--error">
          Could not resolve: {doc.missing.join(', ')}. Connect a jar with these assets and reopen.
        </div>
      )}

      <div className="field-row">
        <span className="field-label">View</span>
        <div className="segmented">
          <button onClick={() => snapView('front')} title="Front (1)">
            S
          </button>
          <button onClick={() => snapView('right')} title="Right (3)">
            E
          </button>
          <button onClick={() => snapView('top')} title="Top (7)">
            U
          </button>
          <button onClick={frameModel} title="Frame model (Ctrl+0)">
            ⤡
          </button>
        </div>
      </div>

      <div className="field-row">
        <span className="field-label">Projection</span>
        <div className="segmented">
          <button
            className={doc.camera.projection === 'perspective' ? 'is-active' : ''}
            onClick={toggle(() =>
              updateCamera((m) => {
                m.camera = { ...m.camera, projection: 'perspective' };
              }),
            )}
          >
            Persp
          </button>
          <button
            className={doc.camera.projection === 'orthographic' ? 'is-active' : ''}
            onClick={toggle(() =>
              updateCamera((m) => {
                m.camera = { ...m.camera, projection: 'orthographic' };
              }),
            )}
            title="Orthographic (5)"
          >
            Ortho
          </button>
        </div>
      </div>

      <div className="field-row">
        <span className="field-label">Shading</span>
        <div className="segmented">
          <button
            className={!viewPrefs.flatShade ? 'is-active' : ''}
            onClick={toggle(() => (viewPrefs.flatShade = false))}
            title="Minecraft's fixed directional shading"
          >
            MC
          </button>
          <button
            className={viewPrefs.flatShade ? 'is-active' : ''}
            onClick={toggle(() => (viewPrefs.flatShade = true))}
          >
            Flat
          </button>
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={viewPrefs.grid}
          onChange={toggle(() => (viewPrefs.grid = !viewPrefs.grid))}
        />
        Grid, bounds &amp; axes
      </label>

      <div className="panel__section">
        <span className="field-label">
          Elements ({doc.elements.length}) — editing lands in a later milestone
        </span>
        <ul className="outliner">
          {doc.elements.map((el) => (
            <li key={el.id} className="outliner__row" title={`${fmt(el.from)} → ${fmt(el.to)}`}>
              <span className="outliner__icon">▣</span>
              {el.name}
              {el.rotation ? ` · ${el.rotation.angle}° ${el.rotation.axis}` : ''}
            </li>
          ))}
        </ul>
      </div>

      <div className="panel__section">
        <span className="field-label">Textures</span>
        <ul className="outliner">
          {Object.entries(doc.textures).map(([key, ref]) => (
            <li key={key} className="outliner__row" title={ref.kind === 'file' ? ref.path : ''}>
              <span className="outliner__icon">▤</span>#{key} —{' '}
              {ref.kind === 'file'
                ? `${ref.width}×${ref.height}`
                : ref.kind === 'region'
                  ? `${ref.rect.w}×${ref.rect.h} in sheet`
                  : `unresolved (${ref.ref})`}
            </li>
          ))}
        </ul>
      </div>

      <p className="panel__hint">
        Middle-drag orbits · Ctrl+middle or Space pans · wheel zooms · right-drag orbits too.
      </p>
    </div>
  );
}

const fmt = (v: { x: number; y: number; z: number }) => `${v.x},${v.y},${v.z}`;
