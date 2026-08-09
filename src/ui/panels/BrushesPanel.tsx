/** Brushes tab — docs/09 §3.1. */
import { BRUSH_TOOLS, useToolStore, type ToolId } from '../../app/toolStore';
import { Slider } from '../controls/Slider';

const LABELS: Record<string, { icon: string; name: string; key: string }> = {
  pen: { icon: '✏', name: 'Pixel pen', key: 'B' },
  marker: { icon: '🖊', name: 'Marker', key: 'M' },
  eraser: { icon: '⌫', name: 'Eraser', key: 'E' },
  bucket: { icon: '🪣', name: 'Paint bucket', key: 'F' },
  eyedropper: { icon: '💧', name: 'Eyedropper', key: 'I' },
};

export function BrushesPanel() {
  const active = useToolStore((s) => s.active);
  const setTool = useToolStore((s) => s.setTool);
  const pen = useToolStore((s) => s.pen);
  const marker = useToolStore((s) => s.marker);
  const eraser = useToolStore((s) => s.eraser);
  const bucket = useToolStore((s) => s.bucket);
  const setBrush = useToolStore((s) => s.setBrush);
  const setBucket = useToolStore((s) => s.setBucket);

  const brushTool = active === 'pen' || active === 'marker' || active === 'eraser' ? active : null;
  const settings = brushTool === 'pen' ? pen : brushTool === 'marker' ? marker : eraser;

  return (
    <div className="panel">
      <h3 className="panel__title">Brushes</h3>
      <div className="toolgrid">
        {BRUSH_TOOLS.map((id: ToolId) => (
          <button
            key={id}
            className={`toolgrid__btn ${active === id ? 'is-active' : ''}`}
            onClick={() => setTool(id)}
            title={`${LABELS[id].name} (${LABELS[id].key})`}
          >
            <span className="toolgrid__icon">{LABELS[id].icon}</span>
            <span className="toolgrid__label">{LABELS[id].name}</span>
          </button>
        ))}
      </div>

      {brushTool && (
        <>
          <Slider
            label="Size"
            min={1}
            max={64}
            value={settings.size}
            onChange={(v) => setBrush(brushTool, { size: v })}
            suffix="px"
          />
          <div className="field-row">
            <span className="field-label">Tip</span>
            <div className="segmented">
              <button
                className={settings.tip === 'circle' ? 'is-active' : ''}
                onClick={() => setBrush(brushTool, { tip: 'circle' })}
                title="Circular tip"
              >
                ◯
              </button>
              <button
                className={settings.tip === 'square' ? 'is-active' : ''}
                onClick={() => setBrush(brushTool, { tip: 'square' })}
                title="Square tip"
              >
                ▢
              </button>
            </div>
          </div>
        </>
      )}

      {active === 'bucket' && (
        <Slider
          label="Tolerance"
          min={0}
          max={100}
          value={bucket.tolerancePct}
          onChange={(v) => setBucket({ tolerancePct: v })}
          suffix="%"
        />
      )}

      <p className="panel__hint">
        To pick a colour, use 💧 in the colour panel, press I, or hold Alt with any tool.
      </p>
    </div>
  );
}
