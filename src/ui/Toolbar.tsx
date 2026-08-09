/**
 * Always-visible action bar (owner request: everything as few clicks as possible). The ☰ menu
 * still lists the same actions with their shortcuts for discovery, but nothing needed while
 * working is hidden behind it — file, history, canvas transforms, view and theme all live here.
 */
import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import { useSettingsStore } from '../app/settingsStore';
import { transformCanvas } from '../app/canvasActions';
import { copySelection, cutSelection, pasteClipboard } from '../app/selectionActions';
import type { MenuActions } from './AppMenu';
import { THEME_ICON, THEME_LABEL, nextThemeMode } from '../app/themeMode';

interface Group {
  label: string;
  items: {
    icon: string;
    title: string;
    run(): void;
    disabled?: boolean;
    active?: boolean;
    danger?: boolean;
  }[];
}

export function Toolbar({ actions }: { actions: MenuActions }) {
  const ds = useDocStore();
  const vs = useViewStore();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const doc = ds.activeId ? ds.docs[ds.activeId] : null;
  const hasDoc = !!doc;
  const hasSelection = !!ds.selection;

  const groups: Group[] = [
    {
      label: 'File',
      items: [
        { icon: '🗋', title: 'New document (Ctrl+N)', run: actions.newDoc },
        { icon: '🗀', title: 'Open… (Ctrl+O)', run: actions.open },
        { icon: '🖫', title: 'Save (Ctrl+S)', run: actions.save, disabled: !hasDoc },
        { icon: '⤓', title: 'Export… (Ctrl+Shift+E)', run: actions.exportAs, disabled: !hasDoc },
      ],
    },
    {
      label: 'History',
      items: [
        { icon: '↶', title: 'Undo (Ctrl+Z)', run: ds.undo, disabled: !ds.canUndo() },
        { icon: '↷', title: 'Redo (Ctrl+Y)', run: ds.redo, disabled: !ds.canRedo() },
      ],
    },
    {
      label: 'Clipboard',
      items: [
        { icon: '⧉', title: 'Copy (Ctrl+C)', run: () => void copySelection(), disabled: !hasDoc },
        {
          icon: '✂',
          title: 'Cut (Ctrl+X)',
          run: () => void cutSelection(),
          disabled: !hasSelection,
        },
        { icon: '⎘', title: 'Paste (Ctrl+V)', run: () => void pasteClipboard() },
      ],
    },
    {
      label: 'Canvas',
      items: [
        {
          icon: '⤢',
          title: 'Resize canvas… (Ctrl+E)',
          run: actions.resizeCanvas,
          disabled: !hasDoc,
        },
        {
          icon: '⟲',
          title: 'Rotate 90° anticlockwise',
          run: () => transformCanvas('acw'),
          disabled: !hasDoc,
        },
        {
          icon: '⟳',
          title: 'Rotate 90° clockwise',
          run: () => transformCanvas('cw'),
          disabled: !hasDoc,
        },
        {
          icon: '↔',
          title: 'Flip horizontally',
          run: () => transformCanvas('flipH'),
          disabled: !hasDoc,
        },
        {
          icon: '↕',
          title: 'Flip vertically',
          run: () => transformCanvas('flipV'),
          disabled: !hasDoc,
        },
        {
          icon: '⛶',
          title: 'Crop to selection (Ctrl+Shift+X)',
          run: actions.crop,
          disabled: !hasSelection,
        },
        {
          icon: '≡',
          title: 'Flatten image (Ctrl+Shift+F)',
          run: actions.flatten,
          disabled: !hasDoc,
        },
      ],
    },
    {
      label: 'View',
      items: [
        {
          icon: '⤡',
          title: 'Fit to window (Ctrl+0)',
          run: () => doc && vs.fit(doc.id, doc.width, doc.height),
          disabled: !hasDoc,
        },
        {
          icon: '1:1',
          title: 'Actual size (Ctrl+1)',
          run: () => doc && vs.hundred(doc.id, doc.width, doc.height),
          disabled: !hasDoc,
        },
        {
          icon: '▦',
          title: `Pixel grid: ${vs.grid} (G)`,
          run: vs.cycleGrid,
          active: vs.grid === 'on',
        },
        {
          icon: '⊞',
          title: 'Tiling preview (Ctrl+T)',
          run: vs.toggleTiling,
          active: vs.tiling,
          disabled: !hasDoc,
        },
      ],
    },
  ];

  return (
    <div className="toolbar" role="toolbar" aria-label="Actions">
      {groups.map((group) => (
        <div className="toolbar__group" key={group.label} aria-label={group.label}>
          {group.items.map((item) => (
            <button
              key={item.title}
              className={`tbtn ${item.active ? 'is-active' : ''}`}
              title={item.title}
              aria-label={item.title}
              aria-pressed={item.active}
              disabled={item.disabled}
              onClick={item.run}
            >
              {item.icon}
            </button>
          ))}
        </div>
      ))}

      <div className="toolbar__spacer" />

      <div className="toolbar__group">
        <button
          className="tbtn"
          title={`Theme: ${THEME_LABEL[theme]} — click to change`}
          aria-label={`Theme: ${THEME_LABEL[theme]}`}
          onClick={() => setTheme(nextThemeMode(theme))}
        >
          {THEME_ICON[theme]}
        </button>
      </div>
    </div>
  );
}
