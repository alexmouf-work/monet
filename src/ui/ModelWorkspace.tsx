/**
 * The 3D workspace — docs/11 §5–§6. Owns the WebGL2 renderer's lifecycle and the
 * Onshape-mapped navigation (D11.2): middle-drag orbits, Ctrl/Shift+middle or Space
 * pans, wheel dollies at the cursor, right-drag is an orbit alias. Left-drag routes to
 * the active tool — paint strokes, select/gizmo, pan — and orbits otherwise.
 */
import { useEffect, useRef } from 'react';
import { useDocStore } from '../app/docStore';
import { useToolStore } from '../app/toolStore';
import { onInvalidate, invalidate } from '../app/bus';
import { modelTextures, openFaceTexture } from '../app/modelActions';
import {
  beginModelStroke,
  endModelStroke,
  extendModelStroke,
  isPaintTool,
  modelBucketAt,
  modelEyedropperAt,
  modelStrokeActive,
} from '../tools/modelPaint';
import { themeColors } from '../engine/themeColors';
import { GIZMO_LENGTH, ModelRenderer, type ModelScene } from '../engine3d/glRenderer';
import {
  dolly,
  frame,
  orbit,
  pan,
  projMatrix,
  screenRay,
  standardView,
  viewMatrix,
  type StandardView,
} from '../core/model3d/camera';
import { multiply, transformPoint } from '../core/model3d/vec';
import { PatchElementCommand } from '../core/model3d/commands';
import type { Axis, ModelElement, Vec3 } from '../core/model3d/types';
import { modelBounds } from '../core/model3d/geometry';
import { faceKey } from '../core/model3d/geometry';
import { pickModel } from '../core/model3d/pick';
import type { FaceHit, Model3D } from '../core/model3d/types';
import {
  modelHover as hoverNow,
  modelRenderer as rendererNow,
  reportHover,
  setModelRenderer,
  subscribeModelHover,
} from '../app/modelViewState';
import { isTypingTarget } from './Workspace';

/** 3D view prefs shared with panels; module state — no store ceremony needed yet. */
export const viewPrefs = { flatShade: false, grid: true };

// Hover + renderer registry live in app/modelViewState (no ui imports) so debugBridge can
// read them without dragging the ui module graph into its import chain.
export { modelHover } from '../app/modelViewState';
export { subscribeModelHover };

/** Mutate the active model's camera and repaint — camera moves are not undo steps. */
export function updateCamera(fn: (m: Model3D) => void): void {
  const model = useDocStore.getState().activeModel();
  if (!model) return;
  fn(model);
  invalidate(false);
}

export function frameModel(): void {
  updateCamera((m) => {
    const b = modelBounds(m.elements);
    m.camera = frame(m.camera, b.min, b.max);
  });
}

/**
 * Enter's target: the hovered face when the cursor is over one, else the face at the
 * viewport centre — literally "the one I am looking at" (docs/11 §9.1).
 */
export function lookedAtFace(): FaceHit | null {
  const model = useDocStore.getState().activeModel();
  if (!model) return null;
  const hovered = hoverNow();
  if (hovered) return hovered;
  const r = rendererNow();
  const aspect = r ? r.cssW / Math.max(1, r.cssH) : 1;
  return pickModel(model.elements, screenRay(model.camera, aspect, 0, 0));
}

export function openLookedAtTexture(wholeSheet = false): void {
  const model = useDocStore.getState().activeModel();
  const hit = lookedAtFace();
  if (model && hit) void openFaceTexture(model, hit, { wholeSheet });
}

/** Centre of an element's box (pre-rotation) — where its gizmo sits. */
export function elementCentre(el: ModelElement): Vec3 {
  return {
    x: (el.from.x + el.to.x) / 2,
    y: (el.from.y + el.to.y) / 2,
    z: (el.from.z + el.to.z) / 2,
  };
}

/** Shift an element along one axis by `delta`, from a base snapshot (no drift). */
function applyAxisDelta(el: ModelElement, base: ModelElement, axis: Axis, delta: number): void {
  el.from = { ...base.from, [axis]: base.from[axis] + delta };
  el.to = { ...base.to, [axis]: base.to[axis] + delta };
  if (base.rotation && el.rotation) {
    el.rotation = {
      ...base.rotation,
      origin: { ...base.rotation.origin, [axis]: base.rotation.origin[axis] + delta },
    };
  }
}

export function snapView(view: StandardView, orthographic = true): void {
  updateCamera((m) => {
    m.camera = standardView(m.camera, view);
    if (orthographic) m.camera.projection = 'orthographic';
  });
}

export function ModelWorkspace() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spaceRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = hostRef.current!;

    const getScene = (): ModelScene => {
      const ds = useDocStore.getState();
      const model = ds.activeModel();
      const selected =
        model && ds.selectedElementId != null
          ? (model.elements.find((e) => e.id === ds.selectedElementId) ?? null)
          : null;
      return {
        model,
        camera: model?.camera ?? {
          target: { x: 8, y: 8, z: 8 },
          yaw: 0,
          pitch: 0,
          distance: 40,
          projection: 'perspective',
          fov: 50,
        },
        textures: model ? modelTextures(model.id) : new Map(),
        hoverKey: hoverNow() ? faceKey(hoverNow()!.elementId, hoverNow()!.face) : -1,
        selectedElement: selected?.id ?? -1,
        accent: themeColors().accent,
        gizmo: selected ? elementCentre(selected) : null,
        surround: themeColors().surround,
        flatShade: viewPrefs.flatShade,
        grid: viewPrefs.grid,
      };
    };

    const renderer = new ModelRenderer(canvas, getScene);
    setModelRenderer(renderer);
    renderer.start();

    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      renderer.resize(r.width, r.height);
    });
    ro.observe(host);

    const offInvalidate = onInvalidate((content) => renderer.invalidate(content));
    const offHover = subscribeModelHover(() => renderer.invalidate(false));

    // --- navigation (D11.2) + tools (docs/11 §8, §10) --------------------------------
    type DragMode = 'orbit' | 'pan' | 'paint' | 'gizmo' | null;
    let drag: DragMode = null;
    let last = { x: 0, y: 0 };
    let moved = 0;
    let gizmoDrag: {
      axis: Axis;
      before: ModelElement;
      startT: number;
    } | null = null;

    /** Model-space point → canvas px, through the same matrices the renderer uses. */
    const toScreen = (p: Vec3) => {
      const model = useDocStore.getState().activeModel();
      if (!model) return null;
      const r = canvas.getBoundingClientRect();
      const mvp = multiply(
        projMatrix(model.camera, r.width / Math.max(1, r.height)),
        viewMatrix(model.camera),
      );
      const ndc = transformPoint(mvp, p);
      return { x: ((ndc.x + 1) / 2) * r.width, y: ((1 - ndc.y) / 2) * r.height };
    };

    const canvasPoint = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    /** Parameter of the closest point on axis line (origin, dir) to a pointer ray. */
    const axisParam = (originV: Vec3, axis: Axis, e: PointerEvent): number => {
      const ray = rayAt(e);
      if (!ray) return 0;
      const u = { x: axis === 'x' ? 1 : 0, y: axis === 'y' ? 1 : 0, z: axis === 'z' ? 1 : 0 };
      const w0 = {
        x: originV.x - ray.origin.x,
        y: originV.y - ray.origin.y,
        z: originV.z - ray.origin.z,
      };
      const b = u.x * ray.dir.x + u.y * ray.dir.y + u.z * ray.dir.z;
      const d0 = u.x * w0.x + u.y * w0.y + u.z * w0.z;
      const e0 = ray.dir.x * w0.x + ray.dir.y * w0.y + ray.dir.z * w0.z;
      const denom = 1 - b * b; // u is unit; ray.dir is unit
      if (Math.abs(denom) < 1e-6) return 0; // axis parallel to the view ray
      return (b * e0 - d0) / denom;
    };

    /** Which gizmo axis (if any) is within grab range of the pointer. */
    const gizmoAxisAt = (e: PointerEvent): { axis: Axis; origin: Vec3 } | null => {
      const ds = useDocStore.getState();
      const model = ds.activeModel();
      const el = model?.elements.find((x) => x.id === ds.selectedElementId);
      if (!model || !el || useToolStore.getState().active !== 'select') return null;
      const origin = elementCentre(el);
      const o = toScreen(origin);
      if (!o) return null;
      const p = canvasPoint(e);
      for (const axis of ['x', 'y', 'z'] as const) {
        const tip = toScreen({
          x: origin.x + (axis === 'x' ? GIZMO_LENGTH : 0),
          y: origin.y + (axis === 'y' ? GIZMO_LENGTH : 0),
          z: origin.z + (axis === 'z' ? GIZMO_LENGTH : 0),
        });
        if (!tip) continue;
        // Distance from the pointer to the screen-space segment o→tip.
        const vx = tip.x - o.x;
        const vy = tip.y - o.y;
        const len2 = vx * vx + vy * vy || 1;
        const t = Math.max(0.15, Math.min(1, ((p.x - o.x) * vx + (p.y - o.y) * vy) / len2));
        const dx = p.x - (o.x + vx * t);
        const dy = p.y - (o.y + vy * t);
        if (dx * dx + dy * dy < 100) return { axis, origin };
      }
      return null;
    };

    const rayAt = (e: PointerEvent | WheelEvent) => {
      const model = useDocStore.getState().activeModel();
      if (!model) return null;
      const r = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ndcY = 1 - ((e.clientY - r.top) / r.height) * 2;
      return screenRay(model.camera, r.width / Math.max(1, r.height), ndcX, ndcY);
    };

    const hitAt = (e: PointerEvent) => {
      const model = useDocStore.getState().activeModel();
      const ray = rayAt(e);
      return model && ray ? pickModel(model.elements, ray) : null;
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      moved = 0;
      if (e.button === 1) {
        drag = e.ctrlKey || e.shiftKey ? 'pan' : 'orbit';
      } else if (e.button === 2) {
        drag = 'orbit';
      } else if (e.button === 0) {
        const model = useDocStore.getState().activeModel();
        const tool = useToolStore.getState().active;
        const hit = hitAt(e);
        const grab = gizmoAxisAt(e);
        if (spaceRef.current) {
          drag = 'pan';
        } else if (model && grab) {
          const ds = useDocStore.getState();
          const el = model.elements.find((x) => x.id === ds.selectedElementId)!;
          gizmoDrag = {
            axis: grab.axis,
            before: JSON.parse(JSON.stringify(el)),
            startT: axisParam(grab.origin, grab.axis, e),
          };
          drag = 'gizmo';
        } else if (model && hit && (e.altKey || tool === 'eyedropper')) {
          // Alt picks colour with any tool — 2D parity (docs/02 §1). Picking is momentary
          // (owner directive): the previous tool comes straight back.
          modelEyedropperAt(model, hit);
          if (tool === 'eyedropper') useToolStore.getState().popTransient();
          drag = null;
        } else if (model && hit && tool === 'bucket') {
          modelBucketAt(model, hit);
          drag = null;
        } else if (model && hit && isPaintTool(tool)) {
          beginModelStroke(model, hit);
          drag = 'paint';
        } else {
          // Pan tool pans; anything else (no face, select over empty space, …) orbits.
          drag = tool === 'pan' ? 'pan' : 'orbit';
        }
      }
      if (drag) e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (drag === 'paint') {
        last = { x: e.clientX, y: e.clientY };
        const model = useDocStore.getState().activeModel();
        if (model) extendModelStroke(model, hitAt(e));
        return;
      }
      if (drag === 'gizmo' && gizmoDrag) {
        const ds = useDocStore.getState();
        const model = ds.activeModel();
        const el = model?.elements.find((x) => x.id === ds.selectedElementId);
        if (!model || !el) return;
        const origin = elementCentre(gizmoDrag.before);
        let delta = axisParam(origin, gizmoDrag.axis, e) - gizmoDrag.startT;
        // Snapping (docs/11 §10.1): the 1/16 lattice by default, ⇧ for half, Alt for free.
        if (!e.altKey) delta = Math.round(delta / (e.shiftKey ? 0.5 : 1)) * (e.shiftKey ? 0.5 : 1);
        applyAxisDelta(el, gizmoDrag.before, gizmoDrag.axis, delta);
        invalidate(true); // geometry changed → mesh rebuild
        return;
      }
      if (drag) {
        last = { x: e.clientX, y: e.clientY };
        moved += Math.abs(dx) + Math.abs(dy);
        updateCamera((m) => {
          m.camera =
            drag === 'pan' ? pan(m.camera, dx, dy, canvas.clientHeight) : orbit(m.camera, dx, dy);
        });
        return;
      }
      // Hover pick, rAF-coalesced; the ray cast is microseconds (docs/11 §7).
      const model = useDocStore.getState().activeModel();
      const ray = rayAt(e);
      reportHover(model && ray ? pickModel(model.elements, ray) : null);
    };

    const endDrag = (e: PointerEvent) => {
      if (drag === 'gizmo' && gizmoDrag) {
        const ds = useDocStore.getState();
        const model = ds.activeModel();
        const el = model?.elements.find((x) => x.id === ds.selectedElementId);
        if (model && el) {
          const after = JSON.parse(JSON.stringify(el)) as ModelElement;
          // Rewind to `before`, then let the command's do() apply `after` — history and the
          // live document can never disagree (the 2D stroke pattern).
          const idx = model.elements.findIndex((x) => x.id === el.id);
          model.elements[idx] = JSON.parse(JSON.stringify(gizmoDrag.before));
          if (JSON.stringify(after) !== JSON.stringify(gizmoDrag.before)) {
            ds.executeModel(new PatchElementCommand('Move element', gizmoDrag.before, after));
          } else {
            invalidate(true);
          }
        }
        gizmoDrag = null;
        drag = null;
        return;
      }
      if (drag === 'paint' || modelStrokeActive()) {
        endModelStroke();
        drag = null;
        return;
      }
      // Select tool: a left CLICK (no drag) picks the element under the cursor.
      if (
        drag === 'orbit' &&
        e.button === 0 &&
        moved < 3 &&
        useToolStore.getState().active === 'select'
      ) {
        const hit = hitAt(e);
        useDocStore.getState().selectElement(hit ? hit.elementId : null);
      }
      // A middle CLICK (no drag) opens the face's texture (docs/11 §9.1); the 3-px slop is
      // what separates it from the start of an orbit.
      const wasMiddleClick = drag === 'orbit' && e.button === 1 && moved < 3;
      drag = null;
      if (wasMiddleClick) {
        const model = useDocStore.getState().activeModel();
        const ray = rayAt(e);
        const hit = model && ray ? pickModel(model.elements, ray) : null;
        if (model && hit) void openFaceTexture(model, hit);
      }
    };

    const onDoubleClick = (e: MouseEvent) => {
      const model = useDocStore.getState().activeModel();
      if (!model) return;
      const ray = rayAt(e as unknown as PointerEvent);
      const hit = ray ? pickModel(model.elements, ray) : null;
      if (hit) void openFaceTexture(model, hit);
      else frameModel(); // double-click empty space: harmless, discoverable (docs/11 §9.1)
    };

    const onPointerLeave = () => reportHover(null);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.001);
      const ray = rayAt(e) ?? undefined;
      updateCamera((m) => {
        m.camera = dolly(m.camera, factor, ray);
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        spaceRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };

    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      offInvalidate();
      offHover();
      ro.disconnect();
      renderer.dispose();
      if (rendererNow() === renderer) setModelRenderer(null);
    };
  }, []);

  const activeTool = useToolStore((s) => s.active);
  return (
    <div className="workspace workspace--model" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="workspace__canvas"
        style={{ cursor: isPaintTool(activeTool) ? 'crosshair' : 'default' }}
      />
      <ViewCube />
    </div>
  );
}

/**
 * The Onshape view cube — docs/11 §6 — as a DOM element: a CSS-3D cube driven by the camera
 * angles, with clickable faces that snap to orthographic standard views and a drag surface
 * that orbits. DOM rather than GL keeps it themable and out of the render loop.
 */
function ViewCube() {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Follow the camera by reading it on every invalidate — cheap, and never re-renders React.
    const sync = () => {
      const cam = useDocStore.getState().activeModel()?.camera;
      if (cam && boxRef.current) {
        boxRef.current.style.transform = `rotateX(${cam.pitch}deg) rotateY(${-cam.yaw}deg)`;
      }
    };
    sync();
    return onInvalidate(sync);
  }, []);

  useEffect(() => {
    const el = boxRef.current?.parentElement;
    if (!el) return;
    let dragging = false;
    let last = { x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      updateCamera((m) => {
        m.camera = orbit(m.camera, dx, dy);
      });
    };
    const up = () => {
      dragging = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
  }, []);

  const face = (view: StandardView, cls: string, label: string) => (
    <button
      className={`viewcube__face viewcube__face--${cls}`}
      title={`${label} view (orthographic)`}
      onClick={() => snapView(view)}
    >
      {label}
    </button>
  );

  return (
    <div className="viewcube" title="Drag to orbit; click a face to snap">
      <div className="viewcube__box" ref={boxRef}>
        {face('front', 'front', 'S')}
        {face('back', 'back', 'N')}
        {face('right', 'right', 'E')}
        {face('left', 'left', 'W')}
        {face('top', 'top', 'U')}
        {face('bottom', 'bottom', 'D')}
      </div>
    </div>
  );
}
