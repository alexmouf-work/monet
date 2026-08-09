/**
 * In-canvas text editing — docs/03 §6.3. A transparent <textarea> is transformed with CSS to
 * sit exactly over the object's box, so what you type is where it lands; the canvas render of
 * that object is suppressed while editing.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TextObject } from '../core/model/types';
import { cloneItem } from '../core/model/document';
import { UpdateItemCommand } from '../core/model/commands';
import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import { invalidate } from '../app/bus';
import { fontString, lineHeightOf } from '../engine/textLayout';
import { editingTextId, endEditing, subscribeTextEditing, syncTextBox } from '../tools/textTool';
import { setHiddenIds } from './sceneHooks';

export function TextEditOverlay() {
  const [editingId, setEditingId] = useState<number | null>(editingTextId());
  const ref = useRef<HTMLTextAreaElement>(null);
  const beforeRef = useRef<TextObject | null>(null);
  const commitRef = useRef<(() => void) | null>(null);
  useDocStore((s) => s.rev);
  const activeId = useDocStore((s) => s.activeId);
  const storedView = useViewStore((s) => (activeId ? s.views[activeId] : undefined));

  useEffect(() => subscribeTextEditing(() => setEditingId(editingTextId())), []);

  const doc = useDocStore.getState().active();
  const obj =
    editingId != null
      ? (doc?.stack.find((i) => i.id === editingId && i.kind === 'text') as TextObject | undefined)
      : undefined;

  // Hide the live render of the object being edited; the textarea is showing it instead.
  useEffect(() => {
    setHiddenIds(obj ? new Set([obj.id]) : null);
    invalidate();
    return () => {
      setHiddenIds(null);
      invalidate();
    };
  }, [obj?.id, obj]);

  useEffect(() => {
    if (obj && !beforeRef.current) beforeRef.current = cloneItem(obj);
    if (!obj) beforeRef.current = null;
  }, [obj]);

  /**
   * Focus the editor, then take it back once the click that opened it finishes: the
   * pointer-up lands on the (unfocusable) canvas and moves focus to <body>, which would
   * otherwise send every keystroke to the global shortcut handler instead of the text box.
   */
  useLayoutEffect(() => {
    if (!obj) return;
    const focus = () => ref.current?.focus();
    focus();
    const onUp = () => focus();
    window.addEventListener('pointerup', onUp, { once: true, capture: true });
    return () => window.removeEventListener('pointerup', onUp, true);
  }, [obj?.id, obj]);

  /**
   * Commit on a genuine outside click rather than on blur. The canvas is not focusable, so
   * the pointer-up that finishes placing the text moves focus to <body> and fires blur
   * immediately — committing there would delete the still-empty object before a key is
   * pressed. This listener is installed after that event, so it never self-triggers.
   */
  useEffect(() => {
    if (!obj) return;
    const onDown = (e: PointerEvent) => {
      if (e.target !== ref.current) commitRef.current?.();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [obj?.id, obj]);

  if (!obj || !doc) {
    commitRef.current = null;
    return null;
  }
  const view = storedView ?? { zoom: 8, panX: 0, panY: 0 };
  const t = obj.transform;

  // Place the box's top-left corner, then rotate about the box centre, matching the renderer.
  const left = view.panX + (t.cx - t.w / 2) * view.zoom;
  const top = view.panY + (t.cy - t.h / 2) * view.zoom;

  const commit = () => {
    const before = beforeRef.current;
    endEditing();
    const current = useDocStore
      .getState()
      .active()
      ?.stack.find((i) => i.id === obj.id);
    if (!before || !current) return;
    if (JSON.stringify(before) === JSON.stringify(current)) return;
    const cmd = new UpdateItemCommand('Edit text', obj.id, before, current as TextObject);
    cmd.undo(useDocStore.getState().active()!);
    useDocStore.getState().execute(cmd);
  };

  commitRef.current = commit;

  return (
    <textarea
      ref={ref}
      className="textedit"
      value={obj.text}
      spellCheck={false}
      style={{
        left,
        top,
        width: t.w * view.zoom,
        height: t.h * view.zoom,
        transform: `rotate(${t.rotation}deg) scaleX(${t.flipX ? -1 : 1}) scaleY(${t.flipY ? -1 : 1})`,
        transformOrigin: 'center center',
        font: fontString({ ...obj, sizePx: obj.sizePx * view.zoom }),
        lineHeight: `${lineHeightOf(obj.sizePx) * view.zoom}px`,
        color: obj.color,
        opacity: obj.alpha,
        textAlign: obj.align,
        textDecoration: obj.underline ? 'underline' : 'none',
      }}
      onChange={(e) => {
        const live = useDocStore
          .getState()
          .active()
          ?.stack.find((i) => i.id === obj.id);
        if (!live || live.kind !== 'text') return;
        live.text = e.target.value;
        syncTextBox(live);
        useDocStore.getState().bump();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          commit();
        }
        // Enter inserts a newline; everything else is left to the textarea.
        e.stopPropagation();
      }}
    />
  );
}
