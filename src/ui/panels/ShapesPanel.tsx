/** Shapes tab — docs/09 §3.2. Edits the selected object, or the defaults for the next one. */
import type { ShapeObject, ShapeType } from '../../core/model/types';
import { cloneItem } from '../../core/model/document';
import { UpdateItemCommand } from '../../core/model/commands';
import { normalizeAngle } from '../../core/shapes/geometry';
import { selectedObject, useDocStore } from '../../app/docStore';
import { useToolStore } from '../../app/toolStore';
import { Slider } from '../controls/Slider';
import { NumBox } from '../controls/NumBox';
import { ColorField } from '../controls/ColorField';

const TYPES: { id: ShapeType; icon: string; name: string }[] = [
  { id: 'triangle', icon: '▲', name: 'Triangle' },
  { id: 'rectangle', icon: '▭', name: 'Rectangle' },
  { id: 'pentagon', icon: '⬟', name: 'Pentagon' },
  { id: 'hexagon', icon: '⬢', name: 'Hexagon' },
  { id: 'circle', icon: '●', name: 'Circle' },
  { id: 'ellipse', icon: '⬭', name: 'Ellipse' },
  { id: 'arrow', icon: '➜', name: 'Arrow' },
  { id: 'arrowhead', icon: '›', name: 'Arrowhead' },
  { id: 'line', icon: '╱', name: 'Line' },
  { id: 'spline', icon: '∿', name: 'Spline' },
];

export function ShapesPanel() {
  const shape = useToolStore((s) => s.shape);
  const setShape = useToolStore((s) => s.setShape);
  const setTool = useToolStore((s) => s.setTool);
  useDocStore((s) => s.rev);
  const selectedId = useDocStore((s) => s.selectedObjectId);
  const selected = selectedObject();
  const obj = selected && selected.kind === 'shape' ? (selected as ShapeObject) : null;

  /** Edits go to the selected object when there is one, otherwise to the defaults. */
  const patchObject = (fn: (o: ShapeObject) => void, label: string) => {
    const doc = useDocStore.getState().active();
    if (!doc || !obj) return;
    const before = cloneItem(obj);
    const after = cloneItem(obj);
    fn(after);
    useDocStore.getState().execute(new UpdateItemCommand(label, obj.id, before, after));
  };

  const fill = obj
    ? obj.fill
    : { enabled: shape.fillEnabled, color: shape.fillColor, alpha: shape.fillAlpha };
  const stroke = obj
    ? obj.stroke
    : {
        enabled: shape.strokeEnabled,
        color: shape.strokeColor,
        alpha: shape.strokeAlpha,
        width: shape.strokeWidth,
      };
  const crisp = obj ? obj.crisp : shape.crisp;
  const lineOnly = (obj ? obj.shape : shape.type) === 'line';

  return (
    <div className="panel">
      <h3 className="panel__title">Shapes</h3>
      <div className="shapegrid">
        {TYPES.map((t) => (
          <button
            key={t.id}
            className={`shapegrid__btn ${shape.type === t.id ? 'is-active' : ''}`}
            title={t.name}
            onClick={() => {
              setShape({ type: t.id });
              setTool('shape');
            }}
          >
            <span aria-hidden>{t.icon}</span>
          </button>
        ))}
      </div>
      {shape.type === 'spline' && !obj && (
        <p className="panel__hint">
          Click to add points — Enter finishes, Esc cancels, Backspace removes the last.
        </p>
      )}

      <div className="panel__section">
        <label className="check">
          <input
            type="checkbox"
            checked={fill.enabled && !lineOnly}
            disabled={lineOnly}
            onChange={(e) =>
              obj
                ? patchObject((o) => (o.fill.enabled = e.target.checked), 'Fill')
                : setShape({ fillEnabled: e.target.checked })
            }
          />
          Fill
        </label>
        <ColorField
          value={fill.color}
          disabled={lineOnly}
          onChange={(hex) =>
            obj
              ? patchObject((o) => (o.fill.color = hex), 'Fill colour')
              : setShape({ fillColor: hex })
          }
        />
        <Slider
          label="Fill opacity"
          suffix="%"
          min={0}
          max={100}
          disabled={lineOnly}
          value={Math.round(fill.alpha * 100)}
          onChange={(v) =>
            obj
              ? patchObject((o) => (o.fill.alpha = v / 100), 'Fill opacity')
              : setShape({ fillAlpha: v / 100 })
          }
        />
      </div>

      <div className="panel__section">
        <label className="check">
          <input
            type="checkbox"
            checked={stroke.enabled}
            onChange={(e) =>
              obj
                ? patchObject((o) => (o.stroke.enabled = e.target.checked), 'Outline')
                : setShape({ strokeEnabled: e.target.checked })
            }
          />
          Outline
        </label>
        <ColorField
          value={stroke.color}
          onChange={(hex) =>
            obj
              ? patchObject((o) => (o.stroke.color = hex), 'Outline colour')
              : setShape({ strokeColor: hex })
          }
        />
        <Slider
          label="Outline opacity"
          suffix="%"
          min={0}
          max={100}
          value={Math.round(stroke.alpha * 100)}
          onChange={(v) =>
            obj
              ? patchObject((o) => (o.stroke.alpha = v / 100), 'Outline opacity')
              : setShape({ strokeAlpha: v / 100 })
          }
        />
        <Slider
          label="Outline weight"
          suffix="px"
          min={1}
          max={64}
          value={stroke.width}
          onChange={(v) =>
            obj
              ? patchObject((o) => (o.stroke.width = v), 'Outline weight')
              : setShape({ strokeWidth: v })
          }
        />
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={crisp}
          onChange={(e) =>
            obj
              ? patchObject((o) => (o.crisp = e.target.checked), 'Crisp edges')
              : setShape({ crisp: e.target.checked })
          }
        />
        Crisp edges (pixel-exact)
      </label>

      {obj && (
        <div className="panel__section">
          <div className="field-row">
            <label>
              X
              <NumBox
                value={Math.round(obj.transform.cx)}
                onCommit={(v) => patchObject((o) => (o.transform.cx = v), 'Move')}
              />
            </label>
            <label>
              Y
              <NumBox
                value={Math.round(obj.transform.cy)}
                onCommit={(v) => patchObject((o) => (o.transform.cy = v), 'Move')}
              />
            </label>
          </div>
          <div className="field-row">
            <label>
              W
              <NumBox
                min={1}
                value={Math.round(obj.transform.w)}
                onCommit={(v) => patchObject((o) => (o.transform.w = v), 'Resize')}
              />
            </label>
            <label>
              H
              <NumBox
                min={1}
                value={Math.round(obj.transform.h)}
                onCommit={(v) => patchObject((o) => (o.transform.h = v), 'Resize')}
              />
            </label>
          </div>
          <Slider
            label="Rotation"
            suffix="°"
            min={0}
            max={360}
            value={Math.round(obj.transform.rotation)}
            onChange={(v) =>
              patchObject((o) => (o.transform.rotation = normalizeAngle(v)), 'Rotate')
            }
          />
          <p className="panel__hint">
            Selected: {obj.shape} · id {selectedId}. Drag handles to resize, the stick above to
            rotate.
            {obj.points ? ' Alt+click a point to remove it, a segment to add one.' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
