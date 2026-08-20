/** Resize canvas — docs/06 §1.2. px/% units, aspect lock, and resize-image-with-canvas. */
import { useState } from 'react';
import { Dialog } from './Dialog';
import { NumBox } from '../controls/NumBox';
import { MAX_DIM } from '../../core/model/types';
import type { Resample } from '../../core/raster/transform';
import { clampDim, pctToPx, resizeCanvas } from '../../app/canvasActions';
import { useDocStore } from '../../app/docStore';

export function ResizeDialog({ onClose }: { onClose(): void }) {
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  const [unit, setUnit] = useState<'px' | '%'>('px');
  const [locked, setLocked] = useState(true);
  const [scaleContent, setScaleContent] = useState(true);
  const [method, setMethod] = useState<Resample>('nearest');
  const [w, setW] = useState(doc?.width ?? 16);
  const [h, setH] = useState(doc?.height ?? 16);
  // Ratio captured when the dialog opened, so repeated edits cannot drift.
  const [ratio] = useState((doc?.width ?? 1) / (doc?.height ?? 1));

  if (!doc) return null;

  const toPx = (value: number, base: number) =>
    unit === 'px' ? clampDim(value) : pctToPx(base, value);
  const targetW = toPx(w, doc.width);
  const targetH = toPx(h, doc.height);

  const setWidth = (value: number) => {
    setW(value);
    if (!locked) return;
    setH(unit === 'px' ? Math.max(1, Math.round(clampDim(value) / ratio)) : value);
  };
  const setHeight = (value: number) => {
    setH(value);
    if (!locked) return;
    setW(unit === 'px' ? Math.max(1, Math.round(clampDim(value) * ratio)) : value);
  };

  const switchUnit = (next: 'px' | '%') => {
    if (next === unit) return;
    if (next === '%') {
      setW(Math.round((toPx(w, doc.width) / doc.width) * 100));
      setH(Math.round((toPx(h, doc.height) / doc.height) * 100));
    } else {
      setW(toPx(w, doc.width));
      setH(toPx(h, doc.height));
    }
    setUnit(next);
  };

  return (
    <Dialog
      title="Resize canvas"
      onCancel={onClose}
      confirmLabel="Resize"
      onConfirm={() => {
        resizeCanvas({ width: targetW, height: targetH, scaleContent, method });
        onClose();
      }}
    >
      <div className="field-row">
        <div className="segmented">
          <button className={unit === 'px' ? 'is-active' : ''} onClick={() => switchUnit('px')}>
            px
          </button>
          <button className={unit === '%' ? 'is-active' : ''} onClick={() => switchUnit('%')}>
            %
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
          Lock aspect ratio
        </label>
      </div>

      <div className="field-row">
        <label>
          Width
          <NumBox min={1} max={unit === 'px' ? MAX_DIM : 1000} value={w} onCommit={setWidth} />
        </label>
        <label>
          Height
          <NumBox min={1} max={unit === 'px' ? MAX_DIM : 1000} value={h} onCommit={setHeight} />
        </label>
      </div>

      <p className="panel__hint">
        {doc.width} × {doc.height} →{' '}
        <strong>
          {targetW} × {targetH} px
        </strong>
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={scaleContent}
          onChange={(e) => setScaleContent(e.target.checked)}
        />
        Resize image with canvas
      </label>

      {scaleContent ? (
        <label className="field-col">
          <span className="field-label">Resample</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as Resample)}>
            <option value="nearest">Nearest (pixel art)</option>
            <option value="bilinear">Bilinear (smooth)</option>
          </select>
        </label>
      ) : (
        <p className="panel__hint">
          Content keeps its pixel position, anchored top-left: growing pads with transparency,
          shrinking crops.
        </p>
      )}
    </Dialog>
  );
}
