/** The ☰ menu — docs/09 §2. Grouped items mirroring the shortcut table. */
import { useEffect, useRef } from 'react';
import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';

export interface MenuActions {
  newDoc(): void;
  newModel(): void;
  open(): void;
  save(): void;
  saveAs(): void;
  saveProject(): void;
  exportAs(): void;
  recover(): void;
  copy(): void;
  cut(): void;
  paste(): void;
  del(): void;
  selectAll(): void;
  crop(): void;
  flatten(): void;
  resizeCanvas(): void;
  shortcutsHelp(): void;
  about(): void;
}

interface Row {
  label: string;
  keys?: string;
  run?: () => void;
  disabled?: boolean;
}

export function AppMenu({ actions, onClose }: { actions: MenuActions; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ds = useDocStore();
  const vs = useViewStore();
  const hasDoc = ds.activeId !== null;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const run = (fn?: () => void) => () => {
    onClose();
    fn?.();
  };

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: 'File',
      rows: [
        { label: 'New', keys: 'Ctrl+N', run: actions.newDoc },
        { label: 'New model (3D)', run: actions.newModel },
        { label: 'Open…', keys: 'Ctrl+O', run: actions.open },
        { label: 'Save', keys: 'Ctrl+S', run: actions.save, disabled: !hasDoc },
        { label: 'Save As…', keys: 'Ctrl+Shift+S', run: actions.saveAs, disabled: !hasDoc },
        { label: 'Save project (.monet)…', run: actions.saveProject, disabled: !hasDoc },
        { label: 'Export…', keys: 'Ctrl+Shift+E', run: actions.exportAs, disabled: !hasDoc },
        { label: 'Recover autosaves…', run: actions.recover },
      ],
    },
    {
      title: 'Edit',
      rows: [
        { label: 'Undo', keys: 'Ctrl+Z', run: ds.undo, disabled: !ds.canUndo() },
        { label: 'Redo', keys: 'Ctrl+Y', run: ds.redo, disabled: !ds.canRedo() },
        { label: 'Cut', keys: 'Ctrl+X', run: actions.cut, disabled: !hasDoc },
        { label: 'Copy', keys: 'Ctrl+C', run: actions.copy, disabled: !hasDoc },
        { label: 'Paste', keys: 'Ctrl+V', run: actions.paste },
        { label: 'Delete', keys: 'Del', run: actions.del, disabled: !hasDoc },
        { label: 'Select all', keys: 'Ctrl+A', run: actions.selectAll, disabled: !hasDoc },
        {
          label: 'Crop to selection',
          keys: 'Ctrl+Shift+X',
          run: actions.crop,
          disabled: !ds.selection,
        },
        { label: 'Flatten image', keys: 'Ctrl+Shift+F', run: actions.flatten, disabled: !hasDoc },
      ],
    },
    {
      title: 'View',
      rows: [
        { label: 'Resize canvas…', keys: 'Ctrl+E', run: actions.resizeCanvas, disabled: !hasDoc },
        {
          label: `Pixel grid: ${vs.grid}`,
          keys: 'G',
          run: vs.cycleGrid,
        },
        {
          label: `Tiling preview${vs.tiling ? ' ✓' : ''}`,
          keys: 'Ctrl+T',
          run: vs.toggleTiling,
          disabled: !hasDoc,
        },
      ],
    },
    {
      title: 'Help',
      rows: [
        { label: 'Shortcuts', keys: '?', run: actions.shortcutsHelp },
        { label: 'About Monet', run: actions.about },
      ],
    },
  ];

  return (
    <div className="menu" ref={ref} role="menu">
      {groups.map((g) => (
        <div className="menu__group" key={g.title}>
          <div className="menu__title">{g.title}</div>
          {g.rows.map((r) => (
            <button
              key={r.label}
              role="menuitem"
              className="menu__item"
              disabled={r.disabled}
              onClick={run(r.run)}
            >
              <span>{r.label}</span>
              {r.keys && <kbd>{r.keys}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
