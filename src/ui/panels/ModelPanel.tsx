/**
 * Model tab panel — docs/11 §10–§11. Numeric-first (Onshape): every property is a typed
 * field accepting arithmetic; the gizmo is a convenience over the number, never the only
 * route. Vanilla legality validates continuously — vanillaMode snaps, free mode flags.
 */
import { useState } from 'react';
import { useDocStore } from '../../app/docStore';
import { invalidate } from '../../app/bus';
import { PatchElementCommand, SetDisplayCommand } from '../../core/model3d/commands';
import {
  addCube,
  deleteSelectedElement,
  duplicateSelectedElement,
  mirrorSelectedElement,
} from '../../app/modelEditActions';
import { snapLegalAngle, validateModel } from '../../core/model3d/validate';
import {
  DISPLAY_SLOTS,
  type Axis,
  type DisplaySlot,
  type DisplaySlotName,
  type ModelElement,
} from '../../core/model3d/types';
import { DISPLAY_LABEL, effectiveSlot } from '../../core/model3d/display';
import { frameModel, snapView, updateCamera, viewPrefs } from '../ModelWorkspace';
import {
  displayPreview,
  selectionFilter,
  setDisplayPreview,
  setSelectionFilter,
} from '../../app/modelViewState';
import { NumField } from '../controls/NumField';

export function ModelPanel() {
  const doc = useDocStore((s) => (s.activeId ? s.models[s.activeId] : null));
  const selectedId = useDocStore((s) => s.selectedElementId);
  const selectedIds = useDocStore((s) => s.selectedElementIds);
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

      <div className="field-row">
        <span className="field-label" title="What a click in the viewport selects">
          Click picks
        </span>
        <div className="segmented">
          <button
            className={selectionFilter() === 'element' ? 'is-active' : ''}
            onClick={toggle(() => setSelectionFilter('element'))}
            title="Elements — click again on the same element to reach its face"
          >
            Elements
          </button>
          <button
            className={selectionFilter() === 'face' ? 'is-active' : ''}
            onClick={toggle(() => setSelectionFilter('face'))}
            title="Faces — one click lands straight on the face under the cursor"
          >
            Faces
          </button>
        </div>
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
          <span className="field-label">
            Elements ({doc.elements.length})
            {selectedIds.length > 1 ? ` · ${selectedIds.length} selected` : ''}
          </span>
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
                  className={`outliner__row outliner__row--btn ${
                    selectedIds.includes(e.id) ? 'is-active' : ''
                  } ${e.id === selectedId && selectedIds.length > 1 ? 'is-primary' : ''}`}
                  onClick={(ev) => {
                    if (ev.ctrlKey || ev.metaKey || ev.shiftKey) ds.toggleElement(e.id);
                    else ds.selectElement(e.id === selectedId ? null : e.id);
                  }}
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
          {selectedIds.length > 1 && (
            <p className="panel__hint">
              {selectedIds.length} elements selected — the fields below edit #{el.id}; the gizmo,
              duplicate, delete and mirror act on all of them.
            </p>
          )}
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

      <DisplaySection />

      <p className="panel__hint">
        Click an element to select it, Ctrl/⇧-click to add, or drag a box over empty space. Drag the
        axis arrows to move (⇧ = ½ steps, Alt = free). Fields take arithmetic: 8+2, 16/3.
      </p>
    </div>
  );
}

/**
 * Display transforms — docs/11 §10.2. The eight slots Minecraft honours, each a
 * rotation/translation/scale it applies when the model is held, worn, dropped or drawn in the
 * inventory. Preview draws the model through the slot's matrix, so "looks right in the editor,
 * wrong in hand" is catchable here. A slot the model does not declare shows vanilla's own
 * default, and editing it writes the slot for real.
 */
function DisplaySection() {
  const doc = useDocStore((s) => (s.activeId ? s.models[s.activeId] : null));
  useDocStore((s) => s.rev);
  const [slot, setSlot] = useState<DisplaySlotName>('gui');
  const [, force] = useState(0);
  if (!doc) return null;

  const ds = useDocStore.getState();
  const declared = doc.display?.[slot];
  const value = effectiveSlot(slot, doc.display);
  const previewing = displayPreview() === slot;

  const repaint = () => {
    invalidate(false);
    force((n) => n + 1);
  };

  /** Commit the slot through the command system; `undefined` clears it back to inherited. */
  const commit = (label: string, next: DisplaySlot | undefined) => {
    ds.executeModel(new SetDisplayCommand(label, doc, slot, next));
    repaint();
  };

  const setPart = (part: 'rotation' | 'translation' | 'scale', axis: Axis) => (v: number) => {
    const next = JSON.parse(JSON.stringify(value)) as Required<DisplaySlot>;
    next[part][axis] = v;
    commit(`${DISPLAY_LABEL[slot]} ${part} ${axis}`, next);
  };

  const row = (label: string, part: 'rotation' | 'translation' | 'scale') => (
    <div className="field-row" key={part}>
      <span className="field-label">{label}</span>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <NumField
          key={axis}
          label={axis}
          value={value[part]![axis]}
          onCommit={setPart(part, axis)}
        />
      ))}
    </div>
  );

  return (
    <div className="panel__section">
      <div className="field-row">
        <span className="field-label">Display</span>
        <div className="segmented">
          {DISPLAY_SLOTS.map((s) => (
            <button
              key={s}
              className={s === slot ? 'is-active' : ''}
              style={doc.display?.[s] ? undefined : { opacity: 0.55 }}
              title={`${s}${doc.display?.[s] ? '' : ' (inheriting vanilla’s default)'}`}
              onClick={() => {
                setSlot(s);
                if (displayPreview()) setDisplayPreview(s);
                repaint();
              }}
            >
              {DISPLAY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {row('Rotate', 'rotation')}
      {row('Move', 'translation')}
      {row('Scale', 'scale')}

      <div className="field-row">
        <button
          className={`btn ${previewing ? 'is-active' : ''}`}
          onClick={() => {
            setDisplayPreview(previewing ? null : slot);
            repaint();
          }}
          title="Draw the model as Minecraft would in this slot"
        >
          {previewing ? '◉ Previewing' : '▷ Preview'}
        </button>
        <button
          className="btn"
          disabled={!declared}
          onClick={() => commit(`Clear ${DISPLAY_LABEL[slot]} display`, undefined)}
          title="Remove this slot so the parent’s (or vanilla’s) values apply again"
        >
          Reset
        </button>
        <span className="panel__hint" style={{ margin: 0 }}>
          {declared ? 'set on this model' : 'inherited'}
        </span>
      </div>

      {previewing && (
        <p className="panel__hint panel__hint--warn">
          Previewing {slot}: the model is drawn through the slot transform, so picking, painting and
          the gizmo are paused. Translations are 1/16 blocks (±80), scale caps at 4.
        </p>
      )}
    </div>
  );
}
