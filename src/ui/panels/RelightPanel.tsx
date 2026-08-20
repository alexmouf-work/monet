/** Relight tab — docs/05 §8. Recolour's cousin: hue never moves, only brightness. */
import { useEffect, useState } from 'react';
import { hexToRgb, isValidHex, rgbToHex } from '../../core/color/convert';
import { tolerancePctToThreshold } from '../../core/recolor/replace';
import {
  adjustMap,
  applyRelight,
  brightnessOf,
  matchMap,
  withBrightness,
  type Mapping,
  type Measure,
} from '../../core/relight/relight';
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

type Mode = 'match' | 'adjust';

/** Ordered by how often they are the right answer; `scale` is the default for that reason. */
const MAPPINGS: Mapping[] = ['scale', 'curve', 'shift'];

const MAPPING_HINT: Record<Mapping, string> = {
  scale:
    'Proportional, like turning the light down: shading ratios are kept. Bright pixels can clip.',
  curve:
    'Smooth: black and white stay put and nothing clips, but shades below the anchor compress hard.',
  shift:
    'Every pixel moves by the same amount: the spacing between shades is exact, and the ends clip.',
};

export function RelightPanel() {
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  const rev = useDocStore((s) => s.rev);
  const activeColor = useToolStore((s) => s.color);

  const [mode, setMode] = useState<Mode>('match');
  const [measure, setMeasure] = useState<Measure>('lightness');
  const [mapping, setMapping] = useState<Mapping>('scale');
  const [from, setFrom] = useState(activeColor);
  const [to, setTo] = useState('#14532D');
  const [amount, setAmount] = useState(100);
  const [limit, setLimit] = useState(false);
  const [tolerance, setTolerance] = useState(20);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [preview, setPreview] = useState(true);

  useEffect(() => {
    if (!doc) return;
    openAdjust();
    return closeAdjust;
  }, [doc?.id, doc?.width, doc?.height, doc]);

  const fromOk = isValidHex(from);
  const toOk = isValidHex(to);
  const fromL = fromOk ? brightnessOf(...rgbTuple(from), measure) : 0;
  const toL = toOk ? brightnessOf(...rgbTuple(to), measure) : 0;

  useEffect(() => {
    if (!doc) return;
    resyncAdjust();
    const map =
      mode === 'match'
        ? matchMap(fromL, toL, mapping)
        : adjustMap(brightness / 100, contrast / 100);
    const params = {
      measure,
      map,
      amount: amount / 100,
      limit:
        mode === 'match' && limit && fromOk
          ? { targets: [hexToRgb(from)], tolerance: tolerancePctToThreshold(tolerance) }
          : undefined,
    };
    updateAdjust((before, after) => applyRelight(before, after, params));
  }, [
    doc,
    mode,
    measure,
    mapping,
    from,
    to,
    fromL,
    toL,
    fromOk,
    amount,
    limit,
    tolerance,
    brightness,
    contrast,
    rev,
  ]);

  useEffect(() => setPreviewEnabled(preview), [preview]);

  if (!doc) return <div className="panel__todo">Open a document first.</div>;

  // What the `from` colour itself becomes — the swatch that answers "did I pick the right pair".
  const previewHex = fromOk
    ? rgbToHex(...withBrightness(...rgbTuple(from), matchMap(fromL, toL, mapping)(fromL), measure))
    : '#000000';

  return (
    <div className="panel">
      <h3 className="panel__title">Relight</h3>

      <div className="segmented">
        <button className={mode === 'match' ? 'is-active' : ''} onClick={() => setMode('match')}>
          Match
        </button>
        <button className={mode === 'adjust' ? 'is-active' : ''} onClick={() => setMode('adjust')}>
          Adjust
        </button>
      </div>

      {mode === 'match' ? (
        <>
          <p className="panel__hint">
            Pick a colour in the image and the brightness you want it to have. Every other pixel
            follows the same curve, so the shading stays coherent — and no hue changes.
          </p>

          <div className="panel__section">
            <span className="field-label">Relight this colour</span>
            <div className="chiprow">
              <ColorField value={from} onChange={setFrom} />
              <button
                className={`iconbtn iconbtn--tiny ${pickArmed() ? 'is-active' : ''}`}
                title="Pick from the canvas"
                onClick={() => armPick(setFrom)}
              >
                💧
              </button>
              <span className="panel__hint" style={{ margin: 0 }}>
                {Math.round(fromL * 100)}%
              </span>
            </div>

            <span className="field-label">To the brightness of</span>
            <div className="chiprow">
              <ColorField value={to} onChange={setTo} />
              <button
                className="iconbtn iconbtn--tiny"
                title="Pick from the canvas"
                onClick={() => armPick(setTo)}
              >
                💧
              </button>
              <span className="panel__hint" style={{ margin: 0 }}>
                {Math.round(toL * 100)}%
              </span>
            </div>

            <div className="chiprow" title="The picked colour at the target brightness">
              <span
                className="chiprow__swatch"
                style={{ background: fromOk ? from : 'transparent' }}
              />
              <span className="panel__hint" style={{ margin: 0 }}>
                →
              </span>
              <span className="chiprow__swatch" style={{ background: previewHex }} />
              <span className="panel__hint" style={{ margin: 0 }}>
                {previewHex}
              </span>
            </div>
          </div>

          <span className="field-label">The rest of the image</span>
          <div className="segmented">
            {MAPPINGS.map((m) => (
              <button
                key={m}
                className={mapping === m ? 'is-active' : ''}
                onClick={() => setMapping(m)}
                title={MAPPING_HINT[m]}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <p className="panel__hint">{MAPPING_HINT[mapping]}</p>

          <label className="check" title="Leave every other colour exactly as it is">
            <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} />
            Only this colour (and near it)
          </label>
          {limit && (
            <Slider
              label="Tolerance"
              suffix="%"
              min={0}
              max={100}
              value={tolerance}
              onChange={setTolerance}
            />
          )}
        </>
      ) : (
        <>
          <p className="panel__hint">
            Straight brightness controls over the whole image — hue and saturation are untouched.
          </p>
          <Slider
            label="Brightness"
            suffix="%"
            min={-100}
            max={100}
            value={brightness}
            onChange={setBrightness}
          />
          <Slider
            label="Contrast"
            suffix="%"
            min={-100}
            max={100}
            value={contrast}
            onChange={setContrast}
          />
        </>
      )}

      <div className="panel__section">
        <span className="field-label">Brightness means</span>
        <div className="segmented">
          <button
            className={measure === 'lightness' ? 'is-active' : ''}
            onClick={() => setMeasure('lightness')}
            title="HSL lightness — hue and saturation survive exactly, every target is reachable"
          >
            Lightness
          </button>
          <button
            className={measure === 'luma' ? 'is-active' : ''}
            onClick={() => setMeasure('luma')}
            title="Rec.709 perceived brightness — truer across hues, but saturated colours clamp"
          >
            Perceived
          </button>
        </div>
        {measure === 'luma' && (
          <p className="panel__hint">
            Perceived brightness is not always reachable: a saturated blue cannot be as bright as a
            mid green without whitening, so it clamps rather than shifting hue.
          </p>
        )}
      </div>

      <Slider label="Amount" suffix="%" min={0} max={100} value={amount} onChange={setAmount} />

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
        disabled={mode === 'match' && (!fromOk || !toOk)}
        onClick={() => {
          bakeAdjust(mode === 'match' ? 'Relight: match' : 'Relight: adjust');
          // Baking consumes the adjustment. The session re-snapshots from the baked pixels so
          // bakes can stack, which means the live preview would otherwise relight the ALREADY
          // relit image a second time — the canvas visibly darkens again the moment you click.
          // Re-anchoring on the colour it became (or zeroing the sliders) makes the map an
          // identity, so what you see after the bake is what you baked.
          if (mode === 'match') setFrom(previewHex);
          else {
            setBrightness(0);
            setContrast(0);
          }
        }}
      >
        Relight
      </button>
      {mode === 'match' && (!fromOk || !toOk) && (
        <p className="panel__hint">Both colours need to be valid hex values.</p>
      )}
    </div>
  );
}

/** hex → the (r, g, b) argument triple the core functions take. */
function rgbTuple(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  return [r, g, b];
}
