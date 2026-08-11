/**
 * The 3D workspace — docs/11 §5–§6. Owns the WebGL2 renderer's lifecycle and the
 * Onshape-mapped navigation (D11.2): middle-drag orbits, Ctrl/Shift+middle or Space
 * pans, wheel dollies at the cursor, right-drag is an orbit alias. Left-drag routes to
 * the active tool once painting lands (M15); until then it orbits too.
 */
import { useEffect, useRef } from 'react';
import { useDocStore } from '../app/docStore';
import { onInvalidate, invalidate } from '../app/bus';
import { modelTextures } from '../app/modelActions';
import { themeColors } from '../engine/themeColors';
import { ModelRenderer, type ModelScene } from '../engine3d/glRenderer';
import {
  dolly,
  frame,
  orbit,
  pan,
  screenRay,
  standardView,
  type StandardView,
} from '../core/model3d/camera';
import { modelBounds } from '../core/model3d/geometry';
import { faceKey } from '../core/model3d/geometry';
import { pickModel } from '../core/model3d/pick';
import type { FaceHit, Model3D } from '../core/model3d/types';
import { isTypingTarget } from './Workspace';

/** 3D view prefs shared with panels; module state — no store ceremony needed yet. */
export const viewPrefs = { flatShade: false, grid: true };

let activeModelRenderer: ModelRenderer | null = null;
export const modelRenderer = () => activeModelRenderer;

/** Hover state for the status bar and the renderer, coalesced like 2D's reportCursor. */
let hover: FaceHit | null = null;
const hoverListeners = new Set<() => void>();
let hoverFlush = 0;

function reportHover(h: FaceHit | null) {
  hover = h;
  if (hoverFlush) return;
  hoverFlush = requestAnimationFrame(() => {
    hoverFlush = 0;
    for (const fn of hoverListeners) fn();
  });
}

export const modelHover = () => hover;
export function subscribeModelHover(fn: () => void) {
  hoverListeners.add(fn);
  return () => {
    hoverListeners.delete(fn);
  };
}

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
      const model = useDocStore.getState().activeModel();
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
        hoverKey: hover ? faceKey(hover.elementId, hover.face) : -1,
        surround: themeColors().surround,
        flatShade: viewPrefs.flatShade,
        grid: viewPrefs.grid,
      };
    };

    const renderer = new ModelRenderer(canvas, getScene);
    activeModelRenderer = renderer;
    renderer.start();

    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      renderer.resize(r.width, r.height);
    });
    ro.observe(host);

    const offInvalidate = onInvalidate((content) => renderer.invalidate(content));
    const offHover = subscribeModelHover(() => renderer.invalidate(false));

    // --- navigation (D11.2) ---------------------------------------------------------
    type DragMode = 'orbit' | 'pan' | null;
    let drag: DragMode = null;
    let last = { x: 0, y: 0 };
    let moved = 0;

    const rayAt = (e: PointerEvent | WheelEvent) => {
      const model = useDocStore.getState().activeModel();
      if (!model) return null;
      const r = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ndcY = 1 - ((e.clientY - r.top) / r.height) * 2;
      return screenRay(model.camera, r.width / Math.max(1, r.height), ndcX, ndcY);
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      moved = 0;
      if (e.button === 1) drag = e.ctrlKey || e.shiftKey ? 'pan' : 'orbit';
      else if (e.button === 2) drag = 'orbit';
      else if (e.button === 0) drag = spaceRef.current ? 'pan' : 'orbit'; // tools take left in M15
      if (drag) e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
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
      const wasMiddleClick = drag === 'orbit' && e.button === 1 && moved < 3;
      drag = null;
      // A middle CLICK (no drag) opens the face's texture in M14 — recorded for then.
      void wasMiddleClick;
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
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      offInvalidate();
      offHover();
      ro.disconnect();
      renderer.dispose();
      if (activeModelRenderer === renderer) activeModelRenderer = null;
    };
  }, []);

  return (
    <div className="workspace workspace--model" ref={hostRef}>
      <canvas ref={canvasRef} className="workspace__canvas" style={{ cursor: 'default' }} />
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
