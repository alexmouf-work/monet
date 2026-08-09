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
  // Narrow selectors on purpose. Subscribing to whole stores re-rendered all 21 buttons on
  // every pan and wheel event, which is the kind of thing that reads as "the app is laggy".
  const hasDoc = useDocStore((s) => s.activeId !== null);
  const hasSelection = useDocStore((s) => s.selection !== null);
  const hasObject = useDocStore((s) => s.selectedObjectId !== null);
  const undoDepth = useDocStore((s) => (s.activeId ? (s.histories[s.activeId]?.undo.length ?? 0) : 0));
  const redoDepth = useDocStore((s) => (s.activeId ? (s.histories[s.activeId]?.redo.length ?? 0) : 0));
  const grid = useViewStore((s) => s.grid);
  const tiling = useViewStore((s) => s.tiling);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  /** Actions are stable; read them at click time so the toolbar needn't subscribe to them. */
  const withDoc = (fn: (id: string, w: number, h: number) => void) => () => {
    const doc = useDocStore.getState().active();
    if (doc) fn(doc.id, doc.width, doc.height);
  };

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
        {
          icon: '↶',
          title: 'Undo (Ctrl+Z)',
          run: () => useDocStore.getState().undo(),
          disabled: !undoDepth,
        },
        {
          icon: '↷',
          title: 'Redo (Ctrl+Y)',
          run: () => useDocStore.getState().redo(),
          disabled: !redoDepth,
        },
      ],
    },
    {
      label: 'Clipboard',
      items: [
        {
          icon: '⧉',
          title: 'Copy (Ctrl+C)',
          run: () => void copySelection(),
          disabled: !hasSelection && !hasObject,
        },
        {
          icon: '✂',
          title: 'Cut (Ctrl+X)',
          run: () => void cutSelection(),
          disabled: !hasSelection && !hasObject,
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
          run: withDoc((id, w, h) => useViewStore.getState().fit(id, w, h)),
          disabled: !hasDoc,
        },
        {
          icon: '1:1',
          title: 'Actual size (Ctrl+1)',
          run: withDoc((id, w, h) => useViewStore.getState().hundred(id, w, h)),
          disabled: !hasDoc,
        },
        {
          icon: '▦',
          title: `Pixel grid: ${grid} (G)`,
          run: () => useViewStore.getState().cycleGrid(),
          active: grid === 'on',
        },
        {
          icon: '⊞',
          title: 'Tiling preview (Ctrl+T)',
          run: () => useViewStore.getState().toggleTiling(),
          active: tiling,
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
