/** New document — docs/09 §6. Remembers the last used size/background (A7). */
import { useState } from 'react';
import { Dialog } from './Dialog';
import { NumBox } from '../controls/NumBox';
import { MAX_DIM, type Background } from '../../core/model/types';
import { useDocStore } from '../../app/docStore';
import { useSettingsStore } from '../../app/settingsStore';

const PRESETS = [16, 32, 64, 128, 256, 512];

export function NewDocDialog({ onClose }: { onClose(): void }) {
  const last = useSettingsStore((s) => s.lastDoc);
  const setLastDoc = useSettingsStore((s) => s.setLastDoc);
  const [w, setW] = useState(last.width);
  const [h, setH] = useState(last.height);
  const [linked, setLinked] = useState(last.width === last.height);
  const [bg, setBg] = useState<Background>({ ...last.background });

  const clamp = (n: number) => Math.max(1, Math.min(MAX_DIM, Math.round(n) || 1));

  const setWidth = (n: number) => {
    const v = clamp(n);
    setW(v);
    if (linked) setH(v);
  };
  const setHeight = (n: number) => {
    const v = clamp(n);
    setH(v);
    if (linked) setW(v);
  };

  const create = () => {
    setLastDoc({ width: w, height: h, background: bg });
    useDocStore.getState().newDoc({
      name: `Untitled ${w}×${h}`,
      width: w,
      height: h,
      background: { ...bg },
    });
    onClose();
  };

  return (
    <Dialog title="New document" onCancel={onClose} onConfirm={create} confirmLabel="Create">
      <div className="field-row">
        <label>
          Width
          <NumBox min={1} max={MAX_DIM} value={w} onCommit={setWidth} />
        </label>
        <label>
          Height
          <NumBox min={1} max={MAX_DIM} value={h} onCommit={setHeight} />
        </label>
        <button
          className={`iconbtn ${linked ? 'is-active' : ''}`}
          onClick={() => setLinked((v) => !v)}
          title="Link width and height"
        >
          ⛓
        </button>
      </div>

      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            className={`chipbtn ${w === p && h === p ? 'is-active' : ''}`}
            onClick={() => {
              setW(p);
              setH(p);
            }}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="field-row">
        <div className="segmented">
          <button
            className={bg.mode === 'transparent' ? 'is-active' : ''}
            onClick={() => setBg({ ...bg, mode: 'transparent' })}
          >
            Transparent
          </button>
          <button
            className={bg.mode === 'color' ? 'is-active' : ''}
            onClick={() => setBg({ ...bg, mode: 'color' })}
          >
            Colour
          </button>
        </div>
        <input
          type="color"
          value={bg.color}
          onChange={(e) => setBg({ mode: 'color', color: e.target.value.toUpperCase() })}
          title="Background colour"
        />
      </div>
    </Dialog>
  );
}
