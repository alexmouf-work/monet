/** Colour panel — docs/09 §5: swatch, hex+alpha, HSV picker, palette, customs, recents. */
import { useEffect, useRef, useState } from 'react';
import { hexToRgb, hsvToRgb, parseHexA, rgbToHex, rgbToHsv } from '../core/color/convert';
import { NumBox } from './controls/NumBox';
import { PAINT_PALETTE } from '../core/color/palette';
import { useToolStore } from '../app/toolStore';

const SV_W = 168;
const SV_H = 110;
const HUE_H = 14;

export function ColorPanel() {
  const color = useToolStore((s) => s.color);
  const alpha = useToolStore((s) => s.alpha);
  const swatches = useToolStore((s) => s.swatches);
  const recents = useToolStore((s) => s.recents);
  const setColor = useToolStore((s) => s.setColor);
  const setAlpha = useToolStore((s) => s.setAlpha);
  const addSwatch = useToolStore((s) => s.addSwatch);
  const removeSwatch = useToolStore((s) => s.removeSwatch);

  const [hexText, setHexText] = useState(color);
  useEffect(() => setHexText(color), [color]);

  // The eyedropper lives here, not in the Brushes tool grid (owner directive): the colour panel
  // is visible from every tab, and picking is part of choosing a colour.
  const activeTool = useToolStore((s) => s.active);
  const pushTransient = useToolStore((s) => s.pushTransient);
  const popTransient = useToolStore((s) => s.popTransient);
  const picking = activeTool === 'eyedropper';

  const rgb = hexToRgb(color);
  const [h, s, v] = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const [hue, setHue] = useState(h);
  // Keep the hue strip in step with colours chosen elsewhere, but don't fight the user
  // while they drag inside the grey column (where hue is undefined).
  useEffect(() => {
    if (s > 0.01 && v > 0.01) setHue(h);
  }, [h, s, v]);

  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = svRef.current!;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(SV_W, SV_H);
    for (let y = 0; y < SV_H; y++) {
      for (let x = 0; x < SV_W; x++) {
        const [r, g, b] = hsvToRgb(hue, x / (SV_W - 1), 1 - y / (SV_H - 1));
        const i = (y * SV_W + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hue]);

  useEffect(() => {
    const c = hueRef.current!;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(SV_W, HUE_H);
    for (let x = 0; x < SV_W; x++) {
      const [r, g, b] = hsvToRgb((x / (SV_W - 1)) * 360, 1, 1);
      for (let y = 0; y < HUE_H; y++) {
        const i = (y * SV_W + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  const dragSV = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const sy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const [rr, gg, bb] = hsvToRgb(hue, sx, 1 - sy);
    setColor(rgbToHex(rr, gg, bb));
  };

  const dragHue = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const nextHue = t * 360;
    setHue(nextHue);
    const [rr, gg, bb] = hsvToRgb(nextHue, Math.max(s, 0.01), Math.max(v, 0.01));
    setColor(rgbToHex(rr, gg, bb));
  };

  const commitHex = () => {
    const parsed = parseHexA(hexText);
    if (!parsed) {
      setHexText(color);
      return;
    }
    setColor(parsed.hex, parsed.alpha);
  };

  return (
    <div className="colorpanel">
      <div className="colorpanel__top">
        <span
          className="colorpanel__current"
          style={{ '--c': color, '--a': alpha } as React.CSSProperties}
          title={`${color} at ${Math.round(alpha * 100)}%`}
        />
        <button
          className={`iconbtn colorpanel__pick ${picking ? 'is-active' : ''}`}
          onClick={() => (picking ? popTransient() : pushTransient('eyedropper'))}
          title={
            picking
              ? 'Picking — click the canvas to sample (Esc cancels)'
              : 'Pick a colour from the canvas (I, or hold Alt)'
          }
          aria-pressed={picking}
        >
          💧
        </button>
        <div className="colorpanel__fields">
          <input
            className="colorpanel__hex"
            type="text"
            value={hexText}
            spellCheck={false}
            aria-label="Hex colour"
            onChange={(e) => setHexText(e.target.value)}
            onBlur={commitHex}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHex();
            }}
          />
          {/* 0–255, not 0–100 %: alpha is a byte everywhere else in a texture pipeline, and
              the owner asked for a typeable opacity that falls back to 255 (docs/09 §5). */}
          <label className="colorpanel__alpha">
            <span>Alpha</span>
            <input
              type="range"
              min={0}
              max={255}
              value={Math.round(alpha * 255)}
              aria-label="Alpha"
              onChange={(e) => setAlpha(+e.target.value / 255)}
            />
            <NumBox
              className="colorpanel__alphanum"
              value={Math.round(alpha * 255)}
              min={0}
              max={255}
              emptyValue={255}
              ariaLabel="Alpha"
              onCommit={(v) => setAlpha(v / 255)}
            />
          </label>
        </div>
      </div>

      <canvas
        ref={svRef}
        width={SV_W}
        height={SV_H}
        className="colorpanel__sv"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragSV(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) dragSV(e);
        }}
      />
      <canvas
        ref={hueRef}
        width={SV_W}
        height={HUE_H}
        className="colorpanel__hue"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragHue(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) dragHue(e);
        }}
      />

      <Swatches label="Palette" colors={PAINT_PALETTE} onPick={setColor} />

      <div className="swatches__head">
        <span>Custom</span>
        <button
          className="iconbtn iconbtn--tiny"
          onClick={() => addSwatch()}
          title="Add current colour"
        >
          +
        </button>
      </div>
      <div className="swatches">
        {swatches.map((c) => (
          <button
            key={c}
            className="swatch"
            style={{ background: c }}
            title={`${c} — right-click to remove`}
            onClick={() => setColor(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              removeSwatch(c);
            }}
          />
        ))}
        {!swatches.length && <span className="swatches__empty">none yet</span>}
      </div>

      <Swatches label="Recent" colors={recents} onPick={setColor} />
    </div>
  );
}

function Swatches({
  label,
  colors,
  onPick,
}: {
  label: string;
  colors: string[];
  onPick(c: string): void;
}) {
  return (
    <>
      <div className="swatches__head">
        <span>{label}</span>
      </div>
      <div className="swatches">
        {colors.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className="swatch"
            style={{ background: c }}
            title={c}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
    </>
  );
}
