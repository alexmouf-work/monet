/**
 * The 3D workspace — docs/11 §5–§6. Owns the WebGL2 renderer's lifecycle and the
 * Onshape-mapped navigation (D11.2): middle-drag orbits, Ctrl/Shift+middle or Space
 * pans, wheel dollies at the cursor, right-drag is an orbit alias. Left-drag routes to
 * the active tool — paint strokes, select/gizmo, pan — and orbits otherwise.
 */
import { useEffect, useRef, useState } from 'react';
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
import { PatchElementCommand, PatchElementsCommand } from '../core/model3d/commands';
import type { Axis, ModelElement, Vec3 } from '../core/model3d/types';
import { displayMatrix, effectiveSlot } from '../core/model3d/display';
import { modelBounds } from '../core/model3d/geometry';
import { faceKey } from '../core/model3d/geometry';
import { pickModel } from '../core/model3d/pick';
import { elementsInBox, type ScreenRect } from '../core/model3d/screen';
import type { FaceHit, Model3D } from '../core/model3d/types';
import {
  displayPreview,
  selectionFilter,
  modelHover as hoverNow,
  modelRenderer as rendererNow,
  reportDragReadout,
  reportHover,
  setModelRenderer,
  subscribeModelHover,
} from '../app/modelViewState';
import { inferAxisSnap } from '../core/model3d/infer';
import {
  addCube,
  deleteSelectedElement,
  duplicateSelectedElement,
  mirrorSelectedElement,
  removeSelectedFace,
} from '../app/modelEditActions';
import { isTypingTarget } from './Workspace';

/** 3D view prefs shared with panels; module state — no store ceremony needed yet. */
export const viewPrefs = { flatShade: false, grid: true };

/**
 * A previewed `display` slot (docs/11 §10.2) draws the mesh through that slot's matrix, which
 * means the CPU pick geometry no longer matches what is on screen — so picking, painting and
 * the gizmo all stand down for the duration. The slot itself lives in app/modelViewState.
 */
export { displayPreview, setDisplayPreview } from '../app/modelViewState';
export { selectionFilter, setSelectionFilter, type SelectionFilter } from '../app/modelViewState';

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

/** Right-click context state: host-relative position + what was under the cursor. */
interface MenuState {
  x: number;
  y: number;
  hit: FaceHit | null;
}

export function ModelWorkspace() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spaceRef = useRef(false);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

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
        selectedBoxes: model
          ? model.elements
              .filter((e) => ds.selectedElementIds.includes(e.id))
              .map((e) => modelBounds([e]))
          : [],
        accent: themeColors().accent,
        gizmo: selected ? elementCentre(selected) : null,
        snapLine: snapPlane,
        surround: themeColors().surround,
        flatShade: viewPrefs.flatShade,
        grid: viewPrefs.grid,
        modelMatrix: displayPreview()
          ? displayMatrix(effectiveSlot(displayPreview()!, model?.display))
          : null,
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
    type DragMode = 'orbit' | 'pan' | 'paint' | 'gizmo' | 'marquee' | null;
    let drag: DragMode = null;
    let last = { x: 0, y: 0 };
    let moved = 0;
    let gizmoDrag: {
      axis: Axis;
      before: ModelElement;
      /** Every selected element as it was when the drag began — they all move together. */
      others: ModelElement[];
      startT: number;
    } | null = null;
    /** Inference plane held by the current drag — getScene hands it to the renderer. */
    let snapPlane: { axis: Axis; value: number } | null = null;
    /** Box-select in progress: canvas-space start point, and whether it adds to the selection. */
    let marquee: { x: number; y: number; add: boolean } | null = null;
    let currentBox: ScreenRect = { x: 0, y: 0, w: 0, h: 0 };
    /** Drive the marquee straight through the DOM — a rubber band must not re-render React. */
    const setBox = (r: ScreenRect | null) => {
      currentBox = r ?? { x: 0, y: 0, w: 0, h: 0 };
      const box = marqueeRef.current;
      if (!box) return;
      box.style.display = r ? 'block' : 'none';
      if (!r) return;
      box.style.left = `${r.x}px`;
      box.style.top = `${r.y}px`;
      box.style.width = `${r.w}px`;
      box.style.height = `${r.h}px`;
    };

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
      if (!model || !el || displayPreview()) return null;
      if (useToolStore.getState().active !== 'select') return null;
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
        const len2 = vx * vx + vy * vy;
        // An arm pointing at the camera projects to (nearly) a point — in a front view that is
        // the z arm, sitting exactly on the element centre. Dragging it means nothing, and
        // treating it as grabbable swallows every click on the middle of the element.
        if (len2 < 12 * 12) continue;
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
      // While a display slot is previewed the mesh is transformed but pick geometry is not,
      // so every hit would be a lie: report nothing and let the drag orbit (docs/11 §10.2).
      if (displayPreview()) return null;
      const model = useDocStore.getState().activeModel();
      const ray = rayAt(e);
      return model && ray ? pickModel(model.elements, ray) : null;
    };

    const onPointerDown = (e: PointerEvent) => {
      setMenu(null);
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
          const ids = new Set(ds.selectedElementIds);
          gizmoDrag = {
            axis: grab.axis,
            before: JSON.parse(JSON.stringify(el)),
            others: model.elements
              .filter((x) => ids.has(x.id))
              .map((x) => JSON.parse(JSON.stringify(x)) as ModelElement),
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
        } else if (tool === 'select' && !hit && !displayPreview()) {
          // Empty space with the select tool: box-select (docs/11 §10.1 item 3). Ctrl/Shift
          // adds to the selection; a plain drag replaces it.
          const p = canvasPoint(e);
          marquee = { x: p.x, y: p.y, add: e.ctrlKey || e.metaKey || e.shiftKey };
          setBox({ x: p.x, y: p.y, w: 0, h: 0 });
          drag = 'marquee';
        } else {
          // Pan tool pans; anything else (no face on a non-select tool, …) orbits.
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
      if (drag === 'marquee' && marquee) {
        const p = canvasPoint(e);
        setBox({
          x: Math.min(marquee.x, p.x),
          y: Math.min(marquee.y, p.y),
          w: Math.abs(p.x - marquee.x),
          h: Math.abs(p.y - marquee.y),
        });
        return;
      }
      if (drag === 'gizmo' && gizmoDrag) {
        const ds = useDocStore.getState();
        const model = ds.activeModel();
        const el = model?.elements.find((x) => x.id === ds.selectedElementId);
        if (!model || !el) return;
        const origin = elementCentre(gizmoDrag.before);
        let delta = axisParam(origin, gizmoDrag.axis, e) - gizmoDrag.startT;
        // Snapping (docs/11 §10.1): the 1/16 lattice by default, ⇧ for half, Alt for free —
        // and inference beats the lattice near an alignment with another element's
        // face/centre, which is how a fractional neighbour is reached without typing.
        let snap: ReturnType<typeof inferAxisSnap> = null;
        if (!e.altKey) {
          const step = e.shiftKey ? 0.5 : 1;
          snap = inferAxisSnap(gizmoDrag.before, model.elements, gizmoDrag.axis, delta, 0.35);
          delta = snap ? snap.delta : Math.round(delta / step) * step;
        }
        snapPlane = snap ? { axis: gizmoDrag.axis, value: snap.at } : null;
        reportDragReadout({ axis: gizmoDrag.axis, delta, inference: !!snap });
        // Every selected element moves by the same delta, from its own grab-time snapshot.
        for (const base of gizmoDrag.others) {
          const live = model.elements.find((x) => x.id === base.id);
          if (live) applyAxisDelta(live, base, gizmoDrag.axis, delta);
        }
        if (!gizmoDrag.others.length) applyAxisDelta(el, gizmoDrag.before, gizmoDrag.axis, delta);
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
      if (displayPreview()) {
        reportHover(null);
        return;
      }
      const model = useDocStore.getState().activeModel();
      const ray = rayAt(e);
      reportHover(model && ray ? pickModel(model.elements, ray) : null);
    };

    const endDrag = (e: PointerEvent) => {
      if (drag === 'marquee' && marquee) {
        const box = { ...currentBox };
        const add = marquee.add;
        marquee = null;
        setBox(null);
        drag = null;
        const ds = useDocStore.getState();
        const model = ds.activeModel();
        const r = canvas.getBoundingClientRect();
        if (model && box.w * box.h > 9) {
          const vp = multiply(
            projMatrix(model.camera, r.width / Math.max(1, r.height)),
            viewMatrix(model.camera),
          );
          const hits = elementsInBox(model.elements, box, vp, r.width, r.height);
          ds.selectElements(add ? [...new Set([...ds.selectedElementIds, ...hits])] : hits);
        } else if (!add) {
          ds.selectElement(null); // a click on empty space clears the selection
        }
        return;
      }
      if (drag === 'gizmo' && gizmoDrag) {
        const ds = useDocStore.getState();
        const model = ds.activeModel();
        const el = model?.elements.find((x) => x.id === ds.selectedElementId);
        if (model && el) {
          // Rewind every dragged element to its grab-time snapshot, then let the command's do()
          // apply the result — history and the live document can never disagree (2D's pattern).
          const bases = gizmoDrag.others.length ? gizmoDrag.others : [gizmoDrag.before];
          const pairs = bases.map((base) => {
            const live = model.elements.find((x) => x.id === base.id)!;
            const after = JSON.parse(JSON.stringify(live)) as ModelElement;
            const idx = model.elements.findIndex((x) => x.id === base.id);
            model.elements[idx] = JSON.parse(JSON.stringify(base)) as ModelElement;
            return { before: base, after };
          });
          const changed = pairs.some((p) => JSON.stringify(p.before) !== JSON.stringify(p.after));
          if (!changed) invalidate(true);
          else if (pairs.length === 1) {
            ds.executeModel(
              new PatchElementCommand('Move element', pairs[0].before, pairs[0].after),
            );
          } else {
            ds.executeModel(new PatchElementsCommand('Move elements', pairs));
          }
        }
        gizmoDrag = null;
        snapPlane = null;
        reportDragReadout(null);
        drag = null;
        return;
      }
      if (drag === 'paint' || modelStrokeActive()) {
        endModelStroke();
        drag = null;
        return;
      }
      // Select tool: a left CLICK (no drag) picks the element under the cursor — and a
      // second click on the already-selected element goes one level deeper, to the face
      // under the cursor (docs/11 §10.1 item 3: click cycles depth, Esc climbs out).
      if (
        drag === 'orbit' &&
        e.button === 0 &&
        moved < 3 &&
        useToolStore.getState().active === 'select'
      ) {
        const hit = hitAt(e);
        const ds = useDocStore.getState();
        if (hit && (e.ctrlKey || e.metaKey || e.shiftKey)) {
          ds.toggleElement(hit.elementId); // add to / remove from the selection
        } else if (hit && selectionFilter() === 'face') {
          // Face filter: one click lands on the face, no element step (docs/11 §10.1 item 3).
          ds.selectElement(hit.elementId);
          ds.selectFace(hit.face);
        } else if (
          hit &&
          hit.elementId === ds.selectedElementId &&
          ds.selectedElementIds.length === 1
        ) {
          ds.selectFace(hit.face);
        } else {
          ds.selectElement(hit ? hit.elementId : null);
        }
      }
      // A right CLICK (no drag) opens the context menu for what is under the cursor
      // (docs/11 §10.1 item 5); right-DRAG stays the orbit alias.
      const wasRightClick = drag === 'orbit' && e.button === 2 && moved < 3;
      // A middle CLICK (no drag) opens the face's texture (docs/11 §9.1); the 3-px slop is
      // what separates it from the start of an orbit.
      const wasMiddleClick = drag === 'orbit' && e.button === 1 && moved < 3;
      drag = null;
      if (wasRightClick) {
        const ds = useDocStore.getState();
        const model = ds.activeModel();
        const ray = rayAt(e);
        const hit = model && ray ? pickModel(model.elements, ray) : null;
        if (hit) ds.selectElement(hit.elementId); // menu actions target the selection
        const r = host.getBoundingClientRect();
        setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, hit });
      }
      if (wasMiddleClick) {
        const model = useDocStore.getState().activeModel();
        const ray = rayAt(e);
        const hit = model && ray ? pickModel(model.elements, ray) : null;
        if (model && hit) void openFaceTexture(model, hit);
      }
    };

    const onDoubleClick = (e: MouseEvent) => {
      const model = useDocStore.getState().activeModel();
      if (!model || displayPreview()) return;
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
      <div className="marquee3d" ref={marqueeRef} style={{ display: 'none' }} />
      <ViewCube />
      {menu && <ModelContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * Right-click menu — docs/11 §10.1 item 5: the operations relevant to what was clicked.
 * Actions run against the selection (the opener selected the hit element first).
 */
function ModelContextMenu({ menu, onClose }: { menu: MenuState; onClose(): void }) {
  useEffect(() => {
    // Any outside press or Escape closes; capture-phase Escape also keeps the global
    // selection ladder from firing on the same press.
    const down = () => onClose();
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const hit = menu.hit;
  const items: { label: string; action(): void }[] = hit
    ? [
        { label: 'Duplicate (Ctrl+D)', action: duplicateSelectedElement },
        { label: 'Mirror x', action: () => mirrorSelectedElement('x') },
        { label: 'Mirror y', action: () => mirrorSelectedElement('y') },
        { label: 'Mirror z', action: () => mirrorSelectedElement('z') },
        {
          label: `Open ${hit.face} texture (Enter)`,
          action: () => {
            const model = useDocStore.getState().activeModel();
            if (model) void openFaceTexture(model, hit);
          },
        },
        { label: `Turn ${hit.face} face off`, action: () => removeSelectedFace(hit.face) },
        { label: 'Delete (Del)', action: deleteSelectedElement },
      ]
    : [
        { label: 'Add cube (N)', action: addCube },
        { label: 'Frame model (Ctrl+0)', action: frameModel },
        { label: 'Front view (1)', action: () => snapView('front') },
        { label: 'Right view (3)', action: () => snapView('right') },
        { label: 'Top view (7)', action: () => snapView('top') },
      ];

  return (
    <div
      className="ctxmenu"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button key={item.label} className="ctxmenu__item" onClick={run(item.action)}>
          {item.label}
        </button>
      ))}
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
