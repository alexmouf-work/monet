/** Global keyboard shortcuts — docs/09 §7. Suppressed while typing in a field. */
import { useEffect } from 'react';
import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import { useToolStore, type FeatureTab, type ToolId } from '../app/toolStore';
import { getTool } from '../tools';
import { nudgeSelected } from '../tools/selectTool';
import { anchorSelection } from '../app/selectionActions';
import { isTypingTarget } from './Workspace';

export interface ShortcutActions {
  newDoc(): void;
  open(): void;
  save(): void;
  saveAs(): void;
  exportAs(): void;
  closeTab(): void;
  copy(): void;
  cut(): void;
  paste(): void;
  del(): void;
  selectAll(): void;
  crop(): void;
  flatten(): void;
  duplicate(): void;
  resizeCanvas(): void;
  shortcutsHelp(): void;
  addJar(): Promise<void> | void;
  addFolder(): Promise<void> | void;
}

const TOOL_KEYS: Record<string, ToolId> = {
  KeyB: 'pen',
  KeyM: 'marker',
  KeyE: 'eraser',
  KeyF: 'bucket',
  KeyI: 'eyedropper',
  KeyS: 'select',
  KeyH: 'pan',
};

const TAB_KEYS: Record<string, FeatureTab> = {
  KeyU: 'shapes',
  KeyT: 'text',
  KeyN: 'noise',
  KeyR: 'recolour',
  KeyC: 'canvas',
};

export function useShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const ds = useDocStore.getState();
      const vs = useViewStore.getState();
      const ts = useToolStore.getState();
      const doc = ds.active();
      const mod = e.ctrlKey || e.metaKey;

      // Tools get first refusal (spline Enter/Esc, text commit, …).
      if (getTool(ts.active).onKey?.(e)) {
        e.preventDefault();
        return;
      }

      if (mod) {
        switch (e.code) {
          case 'KeyZ':
            e.preventDefault();
            if (e.shiftKey) ds.redo();
            else ds.undo();
            return;
          case 'KeyY':
            e.preventDefault();
            ds.redo();
            return;
          case 'KeyS':
            e.preventDefault();
            if (e.shiftKey) actions.saveAs();
            else actions.save();
            return;
          case 'KeyE':
            e.preventDefault();
            if (e.shiftKey) actions.exportAs();
            else actions.resizeCanvas();
            return;
          case 'KeyN':
            e.preventDefault();
            actions.newDoc();
            return;
          case 'KeyO':
            e.preventDefault();
            actions.open();
            return;
          case 'KeyW':
            e.preventDefault();
            actions.closeTab();
            return;
          case 'KeyC':
            e.preventDefault();
            actions.copy();
            return;
          case 'KeyX':
            e.preventDefault();
            if (e.shiftKey) actions.crop();
            else actions.cut();
            return;
          case 'KeyV':
            e.preventDefault();
            actions.paste();
            return;
          case 'KeyA':
            e.preventDefault();
            actions.selectAll();
            return;
          case 'KeyD':
            e.preventDefault();
            actions.duplicate();
            return;
          case 'KeyF':
            if (e.shiftKey) {
              e.preventDefault();
              actions.flatten();
            }
            return;
          case 'KeyT':
            e.preventDefault();
            vs.toggleTiling();
            return;
          case 'Digit0':
            e.preventDefault();
            if (doc) vs.fit(doc.id, doc.width, doc.height);
            return;
          case 'Digit1':
            e.preventDefault();
            if (doc) vs.hundred(doc.id, doc.width, doc.height);
            return;
        }
        return;
      }

      const step = e.shiftKey ? 10 : 1;
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (nudges[e.code]) {
        if (nudgeSelected(...nudges[e.code])) e.preventDefault();
        return;
      }

      switch (e.code) {
        case 'Enter':
          if (ds.selection?.floating) {
            anchorSelection();
            e.preventDefault();
          }
          return;
        case 'Delete':
        case 'Backspace':
          actions.del();
          return;
        case 'Escape':
          // Give up on an armed pick before touching the selection.
          if (ts.active === 'eyedropper' && ts.previous) {
            ts.popTransient();
            return;
          }
          // A lifted float must be anchored, not dropped: its pixels were already cleared
          // from the layers, so discarding here would lose them (docs/06 §4.1 step 4).
          if (ds.selection?.floating) {
            anchorSelection();
            return;
          }
          ds.selectObject(null);
          ds.setSelection(null);
          return;
        case 'BracketLeft':
          ts.nudgeSize(-1);
          return;
        case 'BracketRight':
          ts.nudgeSize(1);
          return;
        case 'KeyG':
          vs.cycleGrid();
          return;
        case 'Equal':
        case 'NumpadAdd':
          if (doc) vs.zoomAt(doc.id, viewportCentre(), 1.25);
          return;
        case 'Minus':
        case 'NumpadSubtract':
          if (doc) vs.zoomAt(doc.id, viewportCentre(), 1 / 1.25);
          return;
        case 'Slash':
          if (e.shiftKey) actions.shortcutsHelp();
          return;
      }

      if (TOOL_KEYS[e.code]) {
        const id = TOOL_KEYS[e.code];
        // `I` arms a momentary pick: sampling hands back to the previous tool on release,
        // and it does not drag the Brushes tab along with it.
        if (id === 'eyedropper') {
          ts.pushTransient('eyedropper');
          return;
        }
        ts.setTool(id);
        if (id !== 'select' && id !== 'pan') ts.setTab('brushes');
        return;
      }
      if (TAB_KEYS[e.code]) ts.setTab(TAB_KEYS[e.code]);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}

function viewportCentre() {
  const { viewportW, viewportH } = useViewStore.getState();
  return { x: viewportW / 2, y: viewportH / 2 };
}
