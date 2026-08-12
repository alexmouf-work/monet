/**
 * Model tab panel — docs/11 §10–§11. Numeric-first (Onshape): every property is a typed
 * field accepting arithmetic; the gizmo is a convenience over the number, never the only
 * route. Vanilla legality validates continuously — vanillaMode snaps, free mode flags.
 */
import { useState } from 'react';
import { useDocStore } from '../../app/docStore';
import { invalidate } from '../../app/bus';
import { PatchElementCommand } from '../../core/model3d/commands';
import {
  addCube,
  deleteSelectedElement,
  duplicateSelectedElement,
  mirrorSelectedElement,
} from '../../app/modelEditActions';
import { snapLegalAngle, validateModel } from '../../core/model3d/validate';
import type { Axis, ModelElement } from '../../core/model3d/types';
import { frameModel, snapView, updateCamera, viewPrefs } from '../ModelWorkspace';
import { NumField } from '../controls/NumField';

export function ModelPanel() {
  const doc = useDocStore((s) => (s.activeId ? s.models[s.activeId] : null));
  const selectedId = useDocStore((s) => s.selectedElementId);
  useDocStore((s) => s.rev);
  const [, force] = useState(0);
  if (!doc) return null;

  const ds = useDocStore.getState();
  const el = doc.elements.find((e) => e.id === selectedId) ?? null;
  const issues = validateModel(doc.elements);

  const toggle = (fn: () => void) => () => {
    fn();
    invalidate(false);
    force((n) => n + 1);
  };

  /** Patch the selected element through the command system (docs/11 §10). */
  const patch = (label: string, fn: (draft: ModelElement) => void) => {
    if (!el) return;
    const after = JSON.parse(JSON.stringify(el)) as ModelElement;
    fn(after);
    if (doc.vanillaMode && after.rotation) {
      after.rotation.angle = snapLegalAngle(after.rotation.angle);
    }
    ds.executeModel(new PatchElementCommand(label, el, after));
  };

  const mirror = (axis: Axis) => () => mirrorSelectedElement(axis);

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
        <label className="check">
          <input
            type="checkbox"
            checked={viewPrefs.grid}
            onChange={toggle(() => (viewPrefs.grid = !viewPrefs.grid))}
          />
          Grid
        </label>
      </div>

      <label className="check" title="Refuse edits vanilla Minecraft would reject (docs/11 §13.2)">
        <input
          type="checkbox"
          checked={doc.vanillaMode}
          onChange={toggle(() => {
            doc.vanillaMode = !doc.vanillaMode;
          })}
        />
        Vanilla mode (snap illegal rotations)
      </label>

      <div className="panel__section">
        <div className="field-row">
          <span className="field-label">Elements ({doc.elements.length})</span>
          <button className="btn" onClick={addCube} title="Add cube (N)">
            + Cube
          </button>
        </div>
        <ul className="outliner">
          {doc.elements.map((e) => {
            const bad = issues.some((i) => i.elementId === e.id);
            return (
              <li key={e.id}>
                <button
                  className={`outliner__row outliner__row--btn ${e.id === selectedId ? 'is-active' : ''}`}
                  onClick={() => ds.selectElement(e.id === selectedId ? null : e.id)}
                  title={`${e.from.x},${e.from.y},${e.from.z} → ${e.to.x},${e.to.y},${e.to.z}`}
                >
                  <span className="outliner__icon">▣</span>
                  {e.name}
                  {e.rotation ? ` · ${e.rotation.angle}° ${e.rotation.axis}` : ''}
                  {bad && (
                    <span className="outliner__warn" title="Not vanilla-legal">
                      ⚠
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {el && (
        <div className="panel__section">
          <div className="field-row">
            <span className="field-label">#{el.id}</span>
            <input
              type="text"
              style={{ flex: 1 }}
              value={el.name}
              onChange={(e) => patch('Rename', (d) => (d.name = e.target.value))}
            />
          </div>
          <div className="field-row">
            <span className="field-label">From</span>
            <NumField
              label="x"
              value={el.from.x}
              onCommit={(v) => patch('From x', (d) => (d.from.x = v))}
            />
            <NumField
              label="y"
              value={el.from.y}
              onCommit={(v) => patch('From y', (d) => (d.from.y = v))}
            />
            <NumField
              label="z"
              value={el.from.z}
              onCommit={(v) => patch('From z', (d) => (d.from.z = v))}
            />
          </div>
          <div className="field-row">
            <span className="field-label">To</span>
            <NumField
              label="x"
              value={el.to.x}
              onCommit={(v) => patch('To x', (d) => (d.to.x = v))}
            />
            <NumField
              label="y"
              value={el.to.y}
              onCommit={(v) => patch('To y', (d) => (d.to.y = v))}
            />
            <NumField
              label="z"
              value={el.to.z}
              onCommit={(v) => patch('To z', (d) => (d.to.z = v))}
            />
          </div>

          <div className="field-row">
            <label className="check">
              <input
                type="checkbox"
                checked={!!el.rotation}
                onChange={(e) =>
                  patch('Rotation', (d) => {
                    d.rotation = e.target.checked
                      ? { origin: { x: 8, y: 8, z: 8 }, axis: 'y', angle: 22.5 }
                      : undefined;
                  })
                }
              />
              Rotation
            </label>
            {el.rotation && (
              <>
                <select
                  value={el.rotation.axis}
                  onChange={(e) =>
                    patch('Rotation axis', (d) => (d.rotation!.axis = e.target.value as Axis))
                  }
                >
                  <option value="x">x</option>
                  <option value="y">y</option>
                  <option value="z">z</option>
                </select>
                <NumField
                  label="angle"
                  value={el.rotation.angle}
                  onCommit={(v) => patch('Rotation angle', (d) => (d.rotation!.angle = v))}
                />
              </>
            )}
          </div>
          {el.rotation && (
            <div className="field-row">
              <span className="field-label">Pivot</span>
              <NumField
                label="x"
                value={el.rotation.origin.x}
                onCommit={(v) => patch('Pivot x', (d) => (d.rotation!.origin.x = v))}
              />
              <NumField
                label="y"
                value={el.rotation.origin.y}
                onCommit={(v) => patch('Pivot y', (d) => (d.rotation!.origin.y = v))}
              />
              <NumField
                label="z"
                value={el.rotation.origin.z}
                onCommit={(v) => patch('Pivot z', (d) => (d.rotation!.origin.z = v))}
              />
            </div>
          )}

          <div className="field-row">
            <button className="btn" onClick={duplicateSelectedElement} title="Ctrl+D">
              Duplicate
            </button>
            <button className="btn btn--danger" onClick={deleteSelectedElement} title="Del">
              Delete
            </button>
            <div className="segmented" title="Mirror across the block centre">
              <button onClick={mirror('x')}>⇋x</button>
              <button onClick={mirror('y')}>⇋y</button>
              <button onClick={mirror('z')}>⇋z</button>
            </div>
          </div>

          {issues
            .filter((i) => i.elementId === el.id)
            .map((i, n) => (
              <p className="panel__hint panel__hint--warn" key={n}>
                ⚠ {i.message}
              </p>
            ))}
        </div>
      )}

      <p className="panel__hint">
        Click an element to select it; drag its axis arrows to move (⇧ = ½ steps, Alt = free).
        Fields take arithmetic: 8+2, 16/3.
      </p>
    </div>
  );
}
