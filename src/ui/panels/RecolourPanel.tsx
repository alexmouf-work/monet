/** Recolour tab — docs/09 §3.5, both modes per docs/05. */
import { useEffect, useState } from 'react';
import { hexToRgb, isValidHex, parseHexA } from '../../core/color/convert';
import {
  applyReplace,
  tolerancePctToThreshold,
  type ReplaceBlend,
} from '../../core/recolor/replace';
import { applyOpacity } from '../../core/recolor/opacity';
import { applyTint } from '../../core/recolor/tint';
import { useDocStore } from '../../app/docStore';
import { useToolStore } from '../../app/toolStore';
import {
  bakeAdjust,
  closeAdjust,
  docHasObjects,
  openAdjust,
  resyncAdjust,
  setPreviewEnabled,
  updateAdjust,
} from '../../app/adjustSession';
import { armPick, pickArmed } from '../../tools/eyedropperTool';
import { Slider } from '../controls/Slider';
import { ColorField } from '../controls/ColorField';

type Mode = 'replace' | 'opacity' | 'tint';

export function RecolourPanel() {
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  const rev = useDocStore((s) => s.rev);
  const activeColor = useToolStore((s) => s.color);

  const [mode, setMode] = useState<Mode>('replace');
  const [targets, setTargets] = useState<string[]>([activeColor]);
  const [result, setResult] = useState('#FFFFFF');
  const [tolerance, setTolerance] = useState(0);
  const [blend, setBlend] = useState<ReplaceBlend>('relative');
  const [amount, setAmount] = useState(100);
  /** Opacity mode's multiplier, on alpha's own 0–255 scale: 255 is the identity (docs/05 §5). */
  const [opacity, setOpacity] = useState(255);
  const [preview, setPreview] = useState(true);

  useEffect(() => {
    if (!doc) return;
    openAdjust();
    return closeAdjust;
  }, [doc?.id, doc?.width, doc?.height, doc]);

  useEffect(() => {
    if (!doc) return;
    resyncAdjust();
    const valid = targets.filter(isValidHex).map(hexToRgb);
    if (mode === 'replace') {
      const params = {
        targets: valid,
        tolerance: tolerancePctToThreshold(tolerance),
        result: hexToRgb(result),
        blend,
      };
      updateAdjust((before, after) => applyReplace(before, after, params));
    } else if (mode === 'opacity') {
      const params = {
        targets: valid,
        tolerance: tolerancePctToThreshold(tolerance),
        amount: opacity,
      };
      updateAdjust((before, after) => applyOpacity(before, after, params));
    } else {
      const params = { result: hexToRgb(result), amount: amount / 100 };
      updateAdjust((before, after) => applyTint(before, after, params));
    }
  }, [doc, mode, targets, result, tolerance, blend, amount, opacity, rev]);

  useEffect(() => setPreviewEnabled(preview), [preview]);

  if (!doc) return <div className="panel__todo">Open a document first.</div>;

  const setTarget = (i: number, hex: string) =>
    setTargets((prev) => prev.map((t, j) => (j === i ? hex : t)));
  const validTargets = targets.filter(isValidHex).length;

  return (
    <div className="panel">
      <h3 className="panel__title">Recolour</h3>

      <div className="segmented">
        <button
          className={mode === 'replace' ? 'is-active' : ''}
          onClick={() => setMode('replace')}
        >
          Replace
        </button>
        <button
          className={mode === 'opacity' ? 'is-active' : ''}
          onClick={() => setMode('opacity')}
        >
          Opacity
        </button>
        <button className={mode === 'tint' ? 'is-active' : ''} onClick={() => setMode('tint')}>
          Tint
        </button>
      </div>

      {mode !== 'tint' ? (
        <>
          <span className="field-label">Target colours</span>
          {targets.map((t, i) => (
            <div className="chiprow" key={i}>
              <span
                className="chiprow__swatch"
                style={{ background: isValidHex(t) ? t : 'transparent' }}
              />
              <input
                className={`chiprow__hex ${isValidHex(t) ? '' : 'is-invalid'}`}
                type="text"
                value={t}
                spellCheck={false}
                onChange={(e) => setTarget(i, e.target.value)}
              />
              <button
                className={`iconbtn iconbtn--tiny ${pickArmed() ? 'is-active' : ''}`}
                title="Pick this colour from the canvas"
                onClick={() => armPick((hex) => setTarget(i, hex))}
              >
                💧
              </button>
              <button
                className="iconbtn iconbtn--tiny"
                title="Remove"
                disabled={targets.length === 1}
                onClick={() => setTargets((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn"
            onClick={() => setTargets((prev) => [...prev, useToolStore.getState().color])}
          >
            + Add target
          </button>
          <Slider
            label="Tolerance"
            suffix="%"
            min={0}
            max={100}
            value={tolerance}
            onChange={setTolerance}
          />

          {mode === 'replace' && (
            <>
              <span className="field-label">Similar colours</span>
              <div className="segmented">
                <button
                  className={blend === 'relative' ? 'is-active' : ''}
                  title="A dark green and a very dark green become a dark purple and a very dark purple"
                  onClick={() => setBlend('relative')}
                >
                  Keep their differences
                </button>
                <button
                  className={blend === 'flat' ? 'is-active' : ''}
                  title="Every matched pixel becomes exactly the result colour"
                  onClick={() => setBlend('flat')}
                >
                  Flatten to one
                </button>
              </div>
              <p className="panel__hint">
                {tolerance === 0
                  ? 'At 0 % tolerance only the exact target colour is matched, so this makes no difference.'
                  : blend === 'relative'
                    ? 'Each matched pixel keeps its distance from the target, so shading survives the swap.'
                    : 'Every matched pixel becomes the result colour exactly, flattening any shading.'}
              </p>
            </>
          )}

          {mode === 'opacity' && (
            <>
              <Slider
                label="Opacity ×"
                min={0}
                max={255}
                value={opacity}
                emptyValue={255}
                onChange={setOpacity}
              />
              <p className="panel__hint">
                Multiplies the alpha of the target colours by {opacity}/255
                {opacity === 255
                  ? ' — the identity, so nothing changes yet.'
                  : opacity === 0
                    ? ' — they become fully transparent.'
                    : `, so a fully opaque pixel ends up at ${opacity}/255.`}{' '}
                Colours are left exactly as they are; only alpha moves.
              </p>
            </>
          )}
        </>
      ) : (
        <p className="panel__hint">
          The whole image becomes this colour, keeping each pixel&apos;s brightness.
        </p>
      )}

      {mode !== 'opacity' && (
        <div className="panel__section">
          <span className="field-label">Result colour</span>
          <div className="chiprow">
            <ColorField value={result} onChange={setResult} />
            <button
              className="iconbtn iconbtn--tiny"
              title="Pick from the canvas"
              onClick={() => armPick(setResult)}
            >
              💧
            </button>
          </div>
        </div>
      )}

      {mode === 'tint' && (
        <Slider label="Amount" suffix="%" min={0} max={100} value={amount} onChange={setAmount} />
      )}

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

      <button
        className="btn btn--primary"
        disabled={mode !== 'tint' && validTargets === 0}
        onClick={() => {
          bakeAdjust(
            mode === 'replace'
              ? 'Recolour: replace'
              : mode === 'opacity'
                ? 'Recolour: opacity'
                : 'Recolour: tint',
          );
          // The bake CONSUMES the multiplier. adjustSession re-snapshots so that bakes stack,
          // which for a multiply means the panel would immediately halve the already-halved
          // pixels again; 255 is the identity, so resetting to it leaves the baked result
          // alone. (Replace and Tint are naturally idempotent — a second pass finds nothing
          // left to change — so only this mode needs it.)
          if (mode === 'opacity') setOpacity(255);
        }}
      >
        Recolour
      </button>
      {mode !== 'tint' && validTargets === 0 && (
        <p className="panel__hint">Enter at least one valid target colour.</p>
      )}
      {mode === 'replace' && !parseHexA(result) && (
        <p className="panel__hint">The result colour is not a valid hex value.</p>
      )}
    </div>
  );
}
