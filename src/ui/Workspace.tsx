/** The canvas workspace: renderer lifecycle, pointer routing, wheel zoom — docs/01 §4, §8. */
import { useEffect, useRef } from 'react';
import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import { useToolStore } from '../app/toolStore';
import { onInvalidate } from '../app/bus';
import { Renderer, setActiveRenderer, type Scene } from '../engine/renderer';
import { docFromScreen, wheelFactor } from '../engine/viewport';
import { getTool } from '../tools';
import type { ToolPointerEvent } from '../tools/types';
import { getComposeOpts, getOverlayPainter } from './sceneHooks';
import { TextEditOverlay } from './TextEditOverlay';
import { beginEditing } from '../tools/textTool';
import { commitSplineNow, splineInProgress } from '../tools/shapeTool';
import { selectedObject } from '../app/docStore';
import { rotateFloat } from '../app/selectionActions';

/** Degrees per wheel event: 15° a notch, 1° with Shift for a fine angle. Trackpads send many
 *  small deltas, so the step is per EVENT and the sign is all that is read — matching zoom. */
const rotationStep = (e: WheelEvent) => (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 1 : 15);

export function Workspace() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const fittedRef = useRef<Set<string>>(new Set());
  const spaceRef = useRef(false);

  // Subscribed so the cursor updates with the active tool.
  const activeTool = useToolStore((s) => s.active);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = hostRef.current!;

    const getScene = (): Scene => {
      const ds = useDocStore.getState();
      const vs = useViewStore.getState();
      const doc = ds.active();
      return {
        doc,
        view: doc ? vs.get(doc.id) : { zoom: 1, panX: 0, panY: 0 },
        grid: vs.grid,
        tiling: vs.tiling,
        compose: getComposeOpts(),
        overlay: getOverlayPainter(),
      };
    };

    const renderer = new Renderer(canvas, getScene);
    rendererRef.current = renderer;
    setActiveRenderer(renderer);
    renderer.start();

    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      renderer.resize(r.width, r.height);
      useViewStore.getState().setViewport(r.width, r.height);
      const doc = useDocStore.getState().active();
      if (doc && !fittedRef.current.has(doc.id)) {
        fittedRef.current.add(doc.id);
        useViewStore.getState().fit(doc.id, doc.width, doc.height);
      }
    });
    ro.observe(host);

    const off = onInvalidate((content) => renderer.invalidate(content));

    // Native listener, not React's onWheel: React registers wheel at the root as **passive**,
    // so preventDefault() there is ignored ("Unable to preventDefault inside passive event
    // listener") and the page keeps its own scroll/zoom while you are zooming the canvas.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const doc = useDocStore.getState().active();
      if (!doc) return;
      // With a selection live the wheel turns it instead of zooming (owner request
      // 2026-08-11) — you cannot rotate what you cannot reach, and zoom is still on
      // +/−, Ctrl+0/1 and the status bar. Esc drops the selection and hands the wheel back.
      if (useDocStore.getState().selection) {
        rotateFloat(rotationStep(e));
        return;
      }
      const r = canvas.getBoundingClientRect();
      useViewStore
        .getState()
        .zoomAt(doc.id, { x: e.clientX - r.left, y: e.clientY - r.top }, wheelFactor(e.deltaY));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      off();
      ro.disconnect();
      renderer.stop();
      setActiveRenderer(null);
      rendererRef.current = null;
    };
  }, []);

  // Fit each document the first time it becomes active.
  const activeId = useDocStore((s) => s.activeId);
  useEffect(() => {
    const doc = useDocStore.getState().active();
    if (!doc || fittedRef.current.has(doc.id)) return;
    const vs = useViewStore.getState();
    if (!vs.viewportW) return;
    fittedRef.current.add(doc.id);
    vs.fit(doc.id, doc.width, doc.height);
  }, [activeId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceRef.current && !isTypingTarget(e.target)) {
        spaceRef.current = true;
        useToolStore.getState().pushTransient('pan');
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceRef.current) {
        spaceRef.current = false;
        useToolStore.getState().popTransient();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const toEvent = (e: React.PointerEvent | React.MouseEvent): ToolPointerEvent => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const ds = useDocStore.getState();
    const doc = ds.active();
    const view = doc ? useViewStore.getState().get(doc.id) : { zoom: 1, panX: 0, panY: 0 };
    const raw = docFromScreen(view, screen);
    // In tiling preview the neighbour tiles are live: wrap their coordinates into the
    // centre tile so drawing across a seam continues on the opposite edge (docs/06 §3).
    const wrapped =
      useViewStore.getState().tiling && doc
        ? {
            x: ((raw.x % doc.width) + doc.width) % doc.width,
            y: ((raw.y % doc.height) + doc.height) % doc.height,
          }
        : raw;
    return {
      screen,
      doc: wrapped,
      buttons: e.buttons,
      button: (e as React.PointerEvent).button ?? 0,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
    };
  };

  /** Middle button pans regardless of the active tool; Alt picks colour (docs/02 §1). */
  const resolveTool = (e: ToolPointerEvent) => {
    const st = useToolStore.getState();
    if (e.buttons === 4 || e.button === 1) return getTool('pan');
    if (e.alt && st.active !== 'eyedropper') return getTool('eyedropper');
    return getTool(st.active);
  };

  const dragToolRef = useRef<ReturnType<typeof getTool> | null>(null);

  return (
    <div className="workspace" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="workspace__canvas"
        style={{ cursor: getTool(activeTool).cursor }}
        onPointerDown={(e) => {
          const ev = toEvent(e);
          const tool = resolveTool(ev);
          dragToolRef.current = tool;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          tool.onPointerDown?.(ev);
        }}
        onPointerMove={(e) => {
          const ev = toEvent(e);
          const tool = dragToolRef.current ?? resolveTool(ev);
          tool.onPointerMove?.(ev);
          reportCursor(ev.doc.x, ev.doc.y);
        }}
        onPointerUp={(e) => {
          const ev = toEvent(e);
          const tool = dragToolRef.current ?? resolveTool(ev);
          tool.onPointerUp?.(ev);
          dragToolRef.current = null;
        }}
        onPointerLeave={() => reportCursor(null, null)}
        onDoubleClick={() => {
          // Double-click finishes a spline, or re-opens a selected text object for editing.
          if (splineInProgress()) {
            commitSplineNow();
            return;
          }
          const obj = selectedObject();
          if (obj?.kind === 'text') beginEditing(obj.id);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <TextEditOverlay />
    </div>
  );
}

/** Input types that swallow keystrokes. Checkboxes, ranges and colour wells do not. */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'number',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'date',
  'time',
]);

/**
 * True when the event target is genuinely typing text, so global shortcuts should stand
 * aside. Sliders, checkboxes and colour wells are inputs too — treating them as text entry
 * silently killed every shortcut after touching a slider.
 */
export const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return TEXT_INPUT_TYPES.has(((el as HTMLInputElement).type || 'text').toLowerCase());
};

/** Cursor doc coordinates for the status bar, kept out of React state for cheapness. */
let cursorPos: { x: number; y: number } | null = null;
const cursorListeners = new Set<() => void>();
let cursorFlush = 0;

/**
 * Notifications are coalesced to one per frame. A high-polling mouse fires pointermove far
 * faster than 60 Hz, and each notification re-renders the status bar — so the uncoalesced
 * version spent hundreds of React renders a second on a coordinate readout.
 */
function reportCursor(x: number | null, y: number | null) {
  cursorPos = x == null || y == null ? null : { x: Math.floor(x), y: Math.floor(y) };
  if (cursorFlush) return;
  cursorFlush = requestAnimationFrame(() => {
    cursorFlush = 0;
    for (const fn of cursorListeners) fn();
  });
}

export function subscribeCursor(fn: () => void) {
  cursorListeners.add(fn);
  return () => {
    cursorListeners.delete(fn);
  };
}

export const getCursor = () => cursorPos;
