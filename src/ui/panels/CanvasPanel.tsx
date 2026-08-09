/** Canvas tab — docs/09 §3.6. */
import { useDocStore } from '../../app/docStore';
import { useViewStore } from '../../app/viewStore';
import { setBackground, transformCanvas } from '../../app/canvasActions';
import { ColorField } from '../controls/ColorField';

export function CanvasPanel({ onResize }: { onResize(): void }) {
  useDocStore((s) => s.rev);
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  const grid = useViewStore((s) => s.grid);
  const tiling = useViewStore((s) => s.tiling);

  if (!doc) return <div className="panel__todo">Open a document first.</div>;
  const bg = doc.background;

  return (
    <div className="panel">
      <h3 className="panel__title">Canvas</h3>

      <div className="field-row">
        <span className="field-label">Background</span>
        <div className="segmented">
          <button
            className={bg.mode === 'transparent' ? 'is-active' : ''}
            onClick={() => setBackground({ ...bg, mode: 'transparent' })}
          >
            Transparent
          </button>
          <button
            className={bg.mode === 'color' ? 'is-active' : ''}
            onClick={() => setBackground({ ...bg, mode: 'color' })}
          >
            Colour
          </button>
        </div>
      </div>
      <ColorField
        label="Colour"
        value={bg.color}
        onChange={(hex) => setBackground({ mode: 'color', color: hex })}
      />
      <p className="panel__hint">The colour is remembered when you switch back to transparent.</p>

      <div className="panel__section">
        <div className="field-row">
          <span className="field-label">Size</span>
          <strong>
            {doc.width} × {doc.height} px
          </strong>
        </div>
        <button className="btn" onClick={onResize}>
          Resize canvas… (Ctrl+E)
        </button>
      </div>

      <div className="panel__section">
        <span className="field-label">Rotate & flip</span>
        <div className="field-row">
          <button
            className="iconbtn"
            title="Rotate 90° anticlockwise"
            onClick={() => transformCanvas('acw')}
          >
            ⟲
          </button>
          <button
            className="iconbtn"
            title="Rotate 90° clockwise"
            onClick={() => transformCanvas('cw')}
          >
            ⟳
          </button>
          <button
            className="iconbtn"
            title="Flip horizontally"
            onClick={() => transformCanvas('flipH')}
          >
            ↔
          </button>
          <button
            className="iconbtn"
            title="Flip vertically"
            onClick={() => transformCanvas('flipV')}
          >
            ↕
          </button>
        </div>
      </div>

      <div className="panel__section">
        <span className="field-label">View</span>
        <div className="field-row">
          <button className="btn" onClick={() => useViewStore.getState().cycleGrid()}>
            Pixel grid: {grid}
          </button>
          <button
            className={`btn ${tiling ? 'is-active' : ''}`}
            onClick={() => useViewStore.getState().toggleTiling()}
            title="Preview the texture tiled 3×3 (Ctrl+T)"
          >
            Tiling {tiling ? '✓' : ''}
          </button>
        </div>
        <p className="panel__hint">
          Tiling preview repeats the canvas 3×3 so seams are visible; painting still applies to the
          centre tile and wraps across its edges.
        </p>
      </div>
    </div>
  );
}
