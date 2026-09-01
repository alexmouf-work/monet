/** Noise tab — docs/09 §3.4, lifecycle per docs/04 §6. */
import { useEffect, useRef, useState } from 'react';
import { NOISE_GROUPS, type NoiseType } from '../../core/noise/fields';
import {
  DEFAULT_NOISE,
  applyNoise,
  buildNoiseMap,
  randomSeed,
  sliderFromZoom,
  zoomFromSlider,
  type NoiseParams,
} from '../../core/noise/apply';
import { useDocStore } from '../../app/docStore';
import {
  bakeAdjust,
  closeAdjust,
  docHasObjects,
  openAdjust,
  resyncAdjust,
  setPreviewEnabled,
  updateAdjust,
} from '../../app/adjustSession';
import { Slider } from '../controls/Slider';
import { NumBox } from '../controls/NumBox';
import { noiseOffset, setNoiseOffset, subscribeNoiseOffset } from '../../app/noisePanState';
import { useToolStore } from '../../app/toolStore';

export function NoisePanel() {
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  // Undo/redo/bake change the document under the session; resync so previews stay honest.
  const rev = useDocStore((s) => s.rev);
  const [params, setParams] = useState<NoiseParams>({ ...DEFAULT_NOISE, seed: randomSeed() });
  const [preview, setPreview] = useState(true);
  const mapRef = useRef<Float32Array | null>(null);
  const mapKeyRef = useRef('');
  // The offset lives in a leaf module because the canvas drag writes it too (docs/04 §7).
  const [, forceOffset] = useState(0);
  useEffect(() => subscribeNoiseOffset(() => forceOffset((n) => n + 1)), []);
  const offset = noiseOffset();

  // While this tab is open the canvas drags the pattern; leaving hands the tool back.
  useEffect(() => {
    const ts = useToolStore.getState();
    ts.pushTransient('noisePan');
    return () => useToolStore.getState().popTransient();
  }, []);

  // Open a session for this document and tear it down when the tab or document changes.
  useEffect(() => {
    if (!doc) return;
    openAdjust();
    return closeAdjust;
  }, [doc?.id, doc?.width, doc?.height, doc]);

  // Recompute on any parameter change; the field is only rebuilt when its inputs change.
  useEffect(() => {
    if (!doc) return;
    resyncAdjust();
    const field = { ...params, offsetX: offset.x, offsetY: offset.y };
    const key = `${field.type}|${field.rotationDeg}|${field.z}|${field.seed}|${field.offsetX},${field.offsetY}|${doc.width}x${doc.height}`;
    if (key !== mapKeyRef.current || !mapRef.current) {
      mapRef.current = buildNoiseMap(doc.width, doc.height, field);
      mapKeyRef.current = key;
    }
    const map = mapRef.current;
    updateAdjust((before, after) => applyNoise(before, after, map, field));
  }, [doc, doc?.width, doc?.height, params, offset.x, offset.y, rev]);

  useEffect(() => setPreviewEnabled(preview), [preview]);

  if (!doc) return <div className="panel__todo">Open a document first.</div>;
  const patch = (p: Partial<NoiseParams>) => setParams((prev) => ({ ...prev, ...p }));
  const nothingSelected = !params.brightness && !params.hue;

  return (
    <div className="panel">
      <h3 className="panel__title">Noise</h3>

      <label className="field-col">
        <span className="field-label">Type</span>
        <select value={params.type} onChange={(e) => patch({ type: e.target.value as NoiseType })}>
          {NOISE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <Slider
        label="Rotation"
        suffix="°"
        min={-360}
        max={360}
        emptyValue={0}
        value={Math.round(params.rotationDeg)}
        onChange={(v) => patch({ rotationDeg: v })}
      />
      <Slider
        label="Scale"
        min={-3}
        max={3}
        step={0.25}
        value={sliderFromZoom(params.z)}
        onChange={(v) => patch({ z: zoomFromSlider(v) })}
      />
      <p className="panel__hint">Feature size ×{params.z.toFixed(2)}</p>
      <Slider
        label="Intensity"
        suffix="%"
        min={-100}
        max={100}
        emptyValue={0}
        value={params.intensity}
        onChange={(v) => patch({ intensity: v })}
      />
      {params.intensity < 0 && (
        <p className="panel__hint">
          Negative intensity inverts the field — light where it would have been dark.
        </p>
      )}

      <span className="field-label">Offset (drag the canvas)</span>
      <div className="field-row">
        <label>
          X
          <NumBox value={offset.x} emptyValue={0} onCommit={(v) => setNoiseOffset(v, offset.y)} />
        </label>
        <label>
          Y
          <NumBox value={offset.y} emptyValue={0} onCommit={(v) => setNoiseOffset(offset.x, v)} />
        </label>
        <button
          className="iconbtn"
          title="Back to the origin"
          disabled={offset.x === 0 && offset.y === 0}
          onClick={() => setNoiseOffset(0, 0)}
        >
          ⌖
        </button>
      </div>

      <div className="field-row">
        <span className="field-label">Affect</span>
        <label className="check">
          <input
            type="checkbox"
            checked={params.brightness}
            onChange={(e) => patch({ brightness: e.target.checked })}
          />
          Brightness
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={params.hue}
            onChange={(e) => patch({ hue: e.target.checked })}
          />
          Hue
        </label>
      </div>
      {params.hue && <p className="panel__hint">Hue shifts are invisible on pure greys.</p>}

      <div className="field-row">
        <label>
          Seed
          <NumBox
            min={0}
            value={params.seed}
            onCommit={(v) => patch({ seed: Math.abs(Math.round(v)) || 0 })}
          />
        </label>
        <button
          className="iconbtn"
          title="New random seed"
          onClick={() => patch({ seed: randomSeed() })}
        >
          🎲
        </button>
      </div>

      <label className="check">
        <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
        Preview
      </label>

      {docHasObjects() && (
        <p className="panel__hint">
          Shapes &amp; text are not affected — flatten the image first (Ctrl+Shift+F) to include
          them.
        </p>
      )}

      <div className="field-row">
        <button
          className="btn btn--primary"
          disabled={nothingSelected}
          onClick={() => bakeAdjust(`Noise: ${params.type}`)}
        >
          Apply
        </button>
        <button
          className="btn"
          onClick={() => {
            setParams({ ...DEFAULT_NOISE, seed: randomSeed() });
            setNoiseOffset(0, 0);
          }}
        >
          Reset
        </button>
      </div>
      {nothingSelected && (
        <p className="panel__hint">Choose brightness, hue, or both to apply noise.</p>
      )}
    </div>
  );
}
