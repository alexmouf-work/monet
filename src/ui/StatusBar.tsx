/** Status bar: cursor position, doc size, zoom slider, active colour, save state. */
import { useEffect, useState } from 'react';
import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import { useToolStore } from '../app/toolStore';
import { zoomPercent, ZOOM_MAX, ZOOM_MIN } from '../engine/viewport';
import { getCursor, subscribeCursor } from './Workspace';

const DEFAULT_VIEW = { zoom: 8, panX: 0, panY: 0 };

export function StatusBar() {
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  useDocStore((s) => s.rev);
  // Selectors must never allocate: a fresh object every call fails zustand's equality
  // check and re-renders forever. Read the stored view, default outside the selector.
  const stored = useViewStore((s) => (doc ? s.views[doc.id] : undefined));
  const view = doc ? (stored ?? DEFAULT_VIEW) : null;
  const grid = useViewStore((s) => s.grid);
  const tiling = useViewStore((s) => s.tiling);
  const color = useToolStore((s) => s.color);
  const alpha = useToolStore((s) => s.alpha);

  const [, force] = useState(0);
  useEffect(() => subscribeCursor(() => force((n) => n + 1)), []);
  const cursor = getCursor();

  return (
    <footer className="statusbar">
      <span className="statusbar__cell statusbar__coords">
        {cursor ? `${cursor.x}, ${cursor.y}` : '—'}
      </span>
      <span className="statusbar__cell">{doc ? `${doc.width} × ${doc.height}` : '—'}</span>
      <span className="statusbar__cell statusbar__zoom">
        <input
          type="range"
          min={Math.log2(ZOOM_MIN)}
          max={Math.log2(ZOOM_MAX)}
          step={0.25}
          value={view ? Math.log2(view.zoom) : 0}
          disabled={!doc}
          onChange={(e) =>
            doc &&
            useViewStore.getState().setZoom(doc.id, 2 ** +e.target.value, doc.width, doc.height)
          }
          title="Zoom"
        />
        <span className="statusbar__zoomval">{view ? zoomPercent(view.zoom) : '—'}</span>
        <button
          className="linkbtn"
          disabled={!doc}
          onClick={() => doc && useViewStore.getState().fit(doc.id, doc.width, doc.height)}
          title="Fit (Ctrl+0)"
        >
          ⛶ fit
        </button>
      </span>
      <span className="statusbar__cell">
        <span className="statusbar__swatch" style={{ background: color }} />
        {color}
        {alpha < 1 ? ` · ${Math.round(alpha * 100)}%` : ''}
      </span>
      <span className="statusbar__cell statusbar__flags">
        {grid !== 'auto' && <span title="Pixel grid (G)">grid: {grid}</span>}
        {tiling && <span title="Tiling preview (Ctrl+T)">tiling</span>}
      </span>
      <span className="statusbar__cell statusbar__save">
        {doc ? (doc.dirty ? '● unsaved' : '✓ saved') : ''}
      </span>
    </footer>
  );
}
