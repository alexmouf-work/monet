/** The canvas workspace: renderer lifecycle, pointer routing, wheel zoom — docs/01 §4, §8. */
import { useEffect, useRef } from 'react';
import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import { useToolStore } from '../app/toolStore';
import { onInvalidate } from '../app/bus';
import { Renderer, type Scene } from '../engine/renderer';
import { docFromScreen, wheelFactor } from '../engine/viewport';
import { getTool } from '../tools';
import type { ToolPointerEvent } from '../tools/types';
import { getComposeOpts, getOverlayPainter } from './sceneHooks';
import { TextEditOverlay } from './TextEditOverlay';
import { beginEditing } from '../tools/textTool';
import { commitSplineNow, splineInProgress } from '../tools/shapeTool';
import { selectedObject } from '../app/docStore';

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

    return () => {
      off();
      ro.disconnect();
      renderer.stop();
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
    return {
      screen,
      doc: docFromScreen(view, screen),
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
        onWheel={(e) => {
          e.preventDefault();
          const doc = useDocStore.getState().active();
          if (!doc) return;
          const rect = canvasRef.current!.getBoundingClientRect();
          useViewStore
            .getState()
            .zoomAt(
              doc.id,
              { x: e.clientX - rect.left, y: e.clientY - rect.top },
              wheelFactor(e.deltaY),
            );
        }}
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

export const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/** Cursor doc coordinates for the status bar, kept out of React state for cheapness. */
let cursorPos: { x: number; y: number } | null = null;
const cursorListeners = new Set<() => void>();

function reportCursor(x: number | null, y: number | null) {
  cursorPos = x == null || y == null ? null : { x: Math.floor(x), y: Math.floor(y) };
  for (const fn of cursorListeners) fn();
}

export function subscribeCursor(fn: () => void) {
  cursorListeners.add(fn);
  return () => {
    cursorListeners.delete(fn);
  };
}

export const getCursor = () => cursorPos;
