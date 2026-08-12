/** Status bar: cursor position, doc size, zoom slider, active colour, save state. */
import { useEffect, useState } from 'react';
import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import { useToolStore } from '../app/toolStore';
import { zoomPercent, ZOOM_MAX, ZOOM_MIN } from '../engine/viewport';
import { getCursor, subscribeCursor } from './Workspace';
import { modelHover, subscribeModelHover } from './ModelWorkspace';
import { dragReadout, subscribeDragReadout } from '../app/modelViewState';
import { boxGaps } from '../core/model3d/infer';

const DEFAULT_VIEW = { zoom: 8, panX: 0, panY: 0 };

export function StatusBar() {
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  const model = useDocStore((s) => (s.activeId ? s.models[s.activeId] : null));
  useDocStore((s) => s.rev);
  // Selectors must never allocate: a fresh object every call fails zustand's equality
  // check and re-renders forever. Read the stored view, default outside the selector.
  const stored = useViewStore((s) => (doc ? s.views[doc.id] : undefined));
  const view = doc ? (stored ?? DEFAULT_VIEW) : null;
  const grid = useViewStore((s) => s.grid);
  const tiling = useViewStore((s) => s.tiling);
  const color = useToolStore((s) => s.color);
  const alpha = useToolStore((s) => s.alpha);

  const selectedElementId = useDocStore((s) => s.selectedElementId);
  const [, force] = useState(0);
  useEffect(() => subscribeCursor(() => force((n) => n + 1)), []);
  useEffect(() => subscribeModelHover(() => force((n) => n + 1)), []);
  useEffect(() => subscribeDragReadout(() => force((n) => n + 1)), []);
  const cursor = getCursor();

  if (model) {
    const h = modelHover();
    const cam = model.camera;
    const tex = h ? model.textures[h.textureVar] : null;
    const texel =
      h && tex && tex.kind === 'file'
        ? `${Math.min(tex.width - 1, Math.floor(h.uvNorm.u * tex.width))}, ${Math.min(tex.height - 1, Math.floor(h.uvNorm.v * tex.height))}`
        : null;
    // Live drag readout (docs/11 §10.1 item 4) and the selected↔hovered measurement
    // (item 6): axis-aligned clear space, in model units = texels at 16 px per block.
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const dr = dragReadout();
    const sel = model.elements.find((e) => e.id === selectedElementId);
    const hov =
      h && h.elementId !== sel?.id ? model.elements.find((e) => e.id === h.elementId) : null;
    let measure = '';
    if (sel && hov) {
      const gaps = boxGaps(sel, hov);
      const parts = (['x', 'y', 'z'] as const)
        .filter((a) => gaps[a] > 0)
        .map((a) => `${a} ${r2(gaps[a])}`);
      measure = `#${sel.id}↔#${hov.id} ${parts.length ? `gap ${parts.join(' · ')} px` : 'touching'}`;
    }
    return (
      <footer className="statusbar">
        <span className="statusbar__cell statusbar__coords">
          {h ? `#${h.elementId} ${h.face}` : '—'}
        </span>
        <span className="statusbar__cell">{texel ? `texel ${texel}` : ''}</span>
        <span className="statusbar__cell statusbar__measure">
          {dr
            ? `Δ${dr.axis} ${dr.delta >= 0 ? '+' : ''}${r2(dr.delta)}${dr.inference ? ' ⌖ aligned' : ''}`
            : measure}
        </span>
        <span className="statusbar__cell">
          {model.elements.length} element{model.elements.length === 1 ? '' : 's'}
        </span>
        <span className="statusbar__cell statusbar__flags">
          yaw {Math.round(cam.yaw)}° · pitch {Math.round(cam.pitch)}° ·{' '}
          {cam.projection === 'orthographic' ? 'ortho' : 'persp'}
        </span>
        <span className="statusbar__cell statusbar__save">
          {model.dirty ? '● unsaved' : '✓ saved'}
        </span>
      </footer>
    );
  }

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
