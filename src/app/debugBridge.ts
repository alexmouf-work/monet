/**
 * Debug bridge — exposes app state on `window.__monet` for the GUI harness
 * (`tests/manual/harness.mjs`) so a driving script can inspect the document, stores and
 * composited pixels instead of guessing from screenshots.
 *
 * Enabled when the build is a dev build **or** `?debug=1` is in the URL, so the harness can
 * use production builds too. It is read-only plumbing: no behaviour depends on it.
 */
import { useDocStore } from './docStore';
import { useToolStore } from './toolStore';
import { useViewStore } from './viewStore';
import { useSettingsStore } from './settingsStore';
import { compositePixels } from '../engine/compose';
import { activeRenderer } from '../engine/renderer';
import { displayPreview, modelHover, modelRenderer } from './modelViewState';
import { displayMatrix, effectiveSlot } from '../core/model3d/display';
import { projMatrix, viewMatrix } from '../core/model3d/camera';
import { multiply, transformPoint } from '../core/model3d/vec';
import { getComposeOpts } from '../ui/sceneHooks';
import { editingTextId } from '../tools/textTool';
import { brushOutlineRect } from '../tools/brushTools';
import { tipOrigin } from '../core/raster/stamp';

export interface MonetDebug {
  doc(): unknown;
  stack(): { id: number; kind: string; detail: string }[];
  stores(): unknown;
  editingTextId(): number | null;
  /** Count of pixels matching a hex colour (± tolerance) in the flattened composite. */
  countColor(hex: string, tolerance?: number): number;
  /**
   * Same count, but over the RASTER LAYERS ALONE — no background, no floating selection, no
   * live stroke overlay. "What is really in the document" as against "what is on screen".
   */
  layerColorCount(hex: string, tolerance?: number): number;
  /** Doc-space rect the brush tool is outlining under the cursor, or null when not hovering. */
  brushOutline(): { x: number; y: number; size: number } | null;
  /** Where the stroke engine would put that tip — the outline must agree with this. */
  stampOrigin(p: { x: number; y: number }, size: number): { x: number; y: number };
  /** Tight bounds of every non-transparent pixel in the raster layers, or null when empty. */
  layerBounds(): { x: number; y: number; w: number; h: number } | null;
  /** The floating selection's own pixels, so a scenario can see a flip in the data. */
  floatPixels(): { w: number; h: number; pixels: number[] } | null;
  pixelAt(x: number, y: number): [number, number, number, number] | null;
  /** Renderer frame costs since the last `resetPerf()` — the perf scenario's measuring stick. */
  perf(): { frames: number; totalMs: number; avgMs: number; maxMs: number; composites: number };
  resetPerf(): void;
  /** Active 3D model document state, camera and hover — null when a 2D doc is focused. */
  model(): unknown;
  /** The active model's elements — the harness aims gizmo drags and asserts uvs with this. */
  modelElements(): { id: number; from: number[]; to: number[]; faces: unknown }[];
  /** Model-space point → canvas CSS px through the live camera, or null. */
  modelToScreen(x: number, y: number, z: number): { x: number; y: number } | null;
  /** Centre pixel of the 3D framebuffer — the "did anything render" probe. */
  modelCenterPixel(): number[] | null;
  /** A clean render-to-PNG pass as plain arrays — what an exported icon contains (§13.3). */
  modelFrame(): { pixels: number[]; width: number; height: number } | null;
  /** A model point through the previewed display slot's matrix, or null when not previewing. */
  displayPreviewPoint(x: number, y: number, z: number): { x: number; y: number; z: number } | null;
  /** Every selected element id (docs/11 §10.1 multi-select). */
  selectedElements(): number[];
}

export function installDebugBridge(): void {
  const enabled = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
  if (!enabled) return;

  const api: MonetDebug = {
    doc() {
      const d = useDocStore.getState().active();
      if (!d) return null;
      return {
        id: d.id,
        name: d.name,
        width: d.width,
        height: d.height,
        background: d.background,
        dirty: d.dirty,
        nextItemId: d.nextItemId,
        items: d.stack.length,
      };
    },
    stack() {
      const d = useDocStore.getState().active();
      if (!d) return [];
      return d.stack.map((i) => ({
        id: i.id,
        kind: i.kind,
        detail:
          i.kind === 'raster'
            ? `${i.pixels.length} bytes`
            : i.kind === 'text'
              ? `"${i.text}" ${Math.round(i.transform.cx)},${Math.round(i.transform.cy)} ${i.sizePx}px ${i.fontFamily}`
              : `${i.shape} ${Math.round(i.transform.w)}×${Math.round(i.transform.h)} rot ${Math.round(i.transform.rotation)}`,
      }));
    },
    stores() {
      const ds = useDocStore.getState();
      const ts = useToolStore.getState();
      const vs = useViewStore.getState();
      return {
        activeId: ds.activeId,
        docs: ds.order.length,
        selectedObjectId: ds.selectedObjectId,
        selection: ds.selection
          ? { rect: ds.selection.rect, floating: !!ds.selection.floating }
          : null,
        undo: ds.activeId ? (ds.histories[ds.activeId]?.undo.length ?? 0) : 0,
        redo: ds.activeId ? (ds.histories[ds.activeId]?.redo.length ?? 0) : 0,
        tool: ts.active,
        tab: ts.tab,
        color: ts.color,
        alpha: ts.alpha,
        view: ds.activeId ? vs.get(ds.activeId) : null,
        grid: vs.grid,
        tiling: vs.tiling,
        settingsLoaded: useSettingsStore.getState().loaded,
      };
    },
    editingTextId: () => editingTextId(),
    countColor(hex, tolerance = 8) {
      const d = useDocStore.getState().active();
      if (!d) return 0;
      const px = compositePixels(d, getComposeOpts());
      const n = parseInt(hex.replace('#', ''), 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      let count = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 8) continue;
        if (
          Math.abs(px[i] - r) <= tolerance &&
          Math.abs(px[i + 1] - g) <= tolerance &&
          Math.abs(px[i + 2] - b) <= tolerance
        )
          count++;
      }
      return count;
    },
    layerColorCount(hex, tolerance = 8) {
      const d = useDocStore.getState().active();
      if (!d) return 0;
      const n = parseInt(hex.replace('#', ''), 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      let count = 0;
      for (const item of d.stack) {
        if (item.kind !== 'raster') continue;
        const px = item.pixels;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 128) continue;
          if (
            Math.abs(px[i] - r) <= tolerance &&
            Math.abs(px[i + 1] - g) <= tolerance &&
            Math.abs(px[i + 2] - b) <= tolerance
          )
            count++;
        }
      }
      return count;
    },
    floatPixels() {
      const f = useDocStore.getState().selection?.floating;
      return f ? { w: f.w, h: f.h, pixels: Array.from(f.pixels) } : null;
    },
    brushOutline: () => brushOutlineRect(),
    stampOrigin: (p, size) => tipOrigin(p, size),
    layerBounds() {
      const d = useDocStore.getState().active();
      if (!d) return null;
      let x0 = d.width;
      let y0 = d.height;
      let x1 = -1;
      let y1 = -1;
      for (const item of d.stack) {
        if (item.kind !== 'raster') continue;
        for (let y = 0; y < d.height; y++) {
          for (let x = 0; x < d.width; x++) {
            if (item.pixels[(y * d.width + x) * 4 + 3] === 0) continue;
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
          }
        }
      }
      return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    },
    perf() {
      const s = activeRenderer()?.stats;
      if (!s) return { frames: 0, totalMs: 0, avgMs: 0, maxMs: 0, composites: 0 };
      return {
        frames: s.frames,
        totalMs: Math.round(s.totalMs * 100) / 100,
        avgMs: s.frames ? Math.round((s.totalMs / s.frames) * 100) / 100 : 0,
        maxMs: Math.round(s.maxMs * 100) / 100,
        composites: s.composites,
      };
    },
    resetPerf() {
      const s = activeRenderer()?.stats;
      if (!s) return;
      s.frames = 0;
      s.totalMs = 0;
      s.maxMs = 0;
      s.lastMs = 0;
      s.composites = 0;
    },
    model() {
      const m = useDocStore.getState().activeModel();
      if (!m) return null;
      return {
        id: m.id,
        name: m.name,
        format: m.format,
        // Which source this model came from — several bundles can hold a model of the same name.
        binding: m.binding ?? null,
        elements: m.elements.length,
        missing: m.missing,
        textures: Object.fromEntries(
          Object.entries(m.textures).map(([k, t]) => [
            k,
            t.kind === 'file' ? `${t.width}x${t.height}` : t.kind,
          ]),
        ),
        camera: {
          yaw: Math.round(m.camera.yaw * 10) / 10,
          pitch: Math.round(m.camera.pitch * 10) / 10,
          distance: Math.round(m.camera.distance * 10) / 10,
          projection: m.camera.projection,
          target: m.camera.target,
        },
        hover: modelHover()
          ? {
              elementId: modelHover()!.elementId,
              face: modelHover()!.face,
              u: Math.round(modelHover()!.uvNorm.u * 1000) / 1000,
              v: Math.round(modelHover()!.uvNorm.v * 1000) / 1000,
            }
          : null,
        display: m.display,
        displayPreview: displayPreview(),
        // Selection depth (docs/11 §10.1 item 3): element, then face, then nothing.
        selected: {
          element: useDocStore.getState().selectedElementId,
          face: useDocStore.getState().selectedFace,
        },
      };
    },
    modelCenterPixel() {
      const r = modelRenderer();
      return r ? [...r.readCenter()] : null;
    },
    modelFrame() {
      const frame = modelRenderer()?.readFrame();
      return frame ? { ...frame, pixels: Array.from(frame.pixels) } : null;
    },
    selectedElements() {
      return [...useDocStore.getState().selectedElementIds];
    },
    displayPreviewPoint(x, y, z) {
      const slot = displayPreview();
      const m = useDocStore.getState().activeModel();
      if (!slot || !m) return null;
      return transformPoint(displayMatrix(effectiveSlot(slot, m.display)), { x, y, z });
    },
    modelElements() {
      const m = useDocStore.getState().activeModel();
      return (m?.elements ?? []).map((e) => ({
        id: e.id,
        from: [e.from.x, e.from.y, e.from.z],
        to: [e.to.x, e.to.y, e.to.z],
        faces: JSON.parse(JSON.stringify(e.faces)) as typeof e.faces,
      }));
    },
    modelToScreen(x, y, z) {
      const m = useDocStore.getState().activeModel();
      const r = modelRenderer();
      if (!m || !r) return null;
      const mvp = multiply(
        projMatrix(m.camera, r.cssW / Math.max(1, r.cssH)),
        viewMatrix(m.camera),
      );
      const ndc = transformPoint(mvp, { x, y, z });
      return { x: ((ndc.x + 1) / 2) * r.cssW, y: ((1 - ndc.y) / 2) * r.cssH };
    },
    pixelAt(x, y) {
      const d = useDocStore.getState().active();
      if (!d || x < 0 || y < 0 || x >= d.width || y >= d.height) return null;
      const px = compositePixels(d, getComposeOpts());
      const i = (Math.floor(y) * d.width + Math.floor(x)) * 4;
      return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    },
  };

  (window as unknown as { __monet: MonetDebug }).__monet = api;
}
