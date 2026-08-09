/** Text tab — docs/09 §3.3. Edits the selected text object, or the defaults for the next one. */
import { useState } from 'react';
import type { TextAlign, TextObject } from '../../core/model/types';
import { cloneItem } from '../../core/model/document';
import { UpdateItemCommand } from '../../core/model/commands';
import { normalizeAngle } from '../../core/shapes/geometry';
import { selectedObject, useDocStore } from '../../app/docStore';
import { useToolStore } from '../../app/toolStore';
import { FONTS, ensureFont, hasLocalFonts, queryLocalFamilies } from '../fonts';
import { Slider } from '../controls/Slider';
import { ColorField } from '../controls/ColorField';
import { syncTextBox } from '../../tools/textTool';

const ALIGNS: { id: TextAlign; icon: string; name: string }[] = [
  { id: 'left', icon: '⇤', name: 'Left' },
  { id: 'center', icon: '⇔', name: 'Centre' },
  { id: 'right', icon: '⇥', name: 'Right' },
];

export function TextPanel() {
  const text = useToolStore((s) => s.text);
  const setText = useToolStore((s) => s.setText);
  const setTool = useToolStore((s) => s.setTool);
  useDocStore((s) => s.rev);
  const selected = selectedObject();
  const obj = selected && selected.kind === 'text' ? (selected as TextObject) : null;
  const [localFamilies, setLocalFamilies] = useState<string[]>([]);

  const patch = (fn: (o: TextObject) => void, label: string) => {
    const doc = useDocStore.getState().active();
    if (!doc || !obj) return;
    const before = cloneItem(obj);
    const after = cloneItem(obj);
    fn(after);
    syncTextBox(after);
    useDocStore.getState().execute(new UpdateItemCommand(label, obj.id, before, after));
  };

  const v = obj ?? { ...text, color: undefined as string | undefined, alpha: 1 };
  const families = [...FONTS.map((f) => f.family), ...localFamilies];

  return (
    <div className="panel">
      <h3 className="panel__title">Text</h3>

      <label className="field-col">
        <span className="field-label">Font</span>
        <select
          value={v.fontFamily}
          onChange={(e) => {
            const family = e.target.value;
            void ensureFont(family, obj?.sizePx ?? text.sizePx);
            if (obj) patch((o) => (o.fontFamily = family), 'Font');
            else setText({ fontFamily: family });
          }}
        >
          {FONTS.map((f) => (
            <option key={f.family} value={f.family}>
              {f.label}
            </option>
          ))}
          {localFamilies.length > 0 && (
            <optgroup label="Installed on this computer">
              {localFamilies.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {hasLocalFonts() && !localFamilies.length && (
        <button className="btn" onClick={() => void queryLocalFamilies().then(setLocalFamilies)}>
          Use system fonts…
        </button>
      )}
      {!families.includes(v.fontFamily) && (
        <p className="panel__hint">“{v.fontFamily}” is not loaded — text falls back.</p>
      )}

      <Slider
        label="Size"
        suffix="px"
        min={4}
        max={256}
        value={v.sizePx}
        onChange={(n) => (obj ? patch((o) => (o.sizePx = n), 'Text size') : setText({ sizePx: n }))}
      />

      <div className="field-row">
        <div className="segmented">
          <button
            className={v.bold ? 'is-active' : ''}
            style={{ fontWeight: 700 }}
            title="Bold"
            onClick={() =>
              obj ? patch((o) => (o.bold = !o.bold), 'Bold') : setText({ bold: !text.bold })
            }
          >
            B
          </button>
          <button
            className={v.italic ? 'is-active' : ''}
            style={{ fontStyle: 'italic' }}
            title="Italic"
            onClick={() =>
              obj
                ? patch((o) => (o.italic = !o.italic), 'Italic')
                : setText({ italic: !text.italic })
            }
          >
            I
          </button>
          <button
            className={v.underline ? 'is-active' : ''}
            style={{ textDecoration: 'underline' }}
            title="Underline"
            onClick={() =>
              obj
                ? patch((o) => (o.underline = !o.underline), 'Underline')
                : setText({ underline: !text.underline })
            }
          >
            U
          </button>
        </div>
        <div className="segmented">
          {ALIGNS.map((a) => (
            <button
              key={a.id}
              className={v.align === a.id ? 'is-active' : ''}
              title={a.name}
              onClick={() =>
                obj ? patch((o) => (o.align = a.id), 'Align') : setText({ align: a.id })
              }
            >
              {a.icon}
            </button>
          ))}
        </div>
      </div>

      {obj ? (
        <>
          <ColorField
            label="Colour"
            value={obj.color}
            onChange={(hex) => patch((o) => (o.color = hex), 'Text colour')}
          />
          <Slider
            label="Opacity"
            suffix="%"
            min={0}
            max={100}
            value={Math.round(obj.alpha * 100)}
            onChange={(n) => patch((o) => (o.alpha = n / 100), 'Text opacity')}
          />
          <Slider
            label="Rotation"
            suffix="°"
            min={0}
            max={360}
            value={Math.round(obj.transform.rotation)}
            onChange={(n) =>
              patch((o) => (o.transform.rotation = normalizeAngle(n)), 'Rotate text')
            }
          />
        </>
      ) : (
        <p className="panel__hint">New text uses the active colour and opacity.</p>
      )}

      <label className="check">
        <input
          type="checkbox"
          checked={obj ? obj.crisp : text.crisp}
          onChange={(e) =>
            obj
              ? patch((o) => (o.crisp = e.target.checked), 'Crisp text')
              : setText({ crisp: e.target.checked })
          }
        />
        Crisp edges (pixel-exact)
      </label>

      <p className="panel__hint">
        {obj
          ? 'Double-click the text on canvas to edit it again.'
          : 'Click the canvas to place text.'}
      </p>
      {!obj && (
        <button className="btn" onClick={() => setTool('text')}>
          Place text
        </button>
      )}
    </div>
  );
}
