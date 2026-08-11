/** Top bar: app menu, feature tabs, persistent Select/Pan tools, Sync/settings/export. */
import { useToolStore, type FeatureTab } from '../app/toolStore';
import { useDocStore } from '../app/docStore';

const TABS: { id: FeatureTab; label: string; key: string }[] = [
  { id: 'brushes', label: 'Brushes', key: 'B' },
  { id: 'shapes', label: 'Shapes', key: 'U' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'noise', label: 'Noise', key: 'N' },
  { id: 'recolour', label: 'Recolour', key: 'R' },
  { id: 'canvas', label: 'Canvas', key: 'C' },
];

/** A model document swaps the tab strip — same chrome, different sections (docs/11 §11). */
const MODEL_TABS: { id: FeatureTab; label: string; key: string }[] = [
  { id: 'model', label: 'Model', key: '' },
  { id: 'uv', label: 'UV', key: 'U' },
  { id: 'brushes', label: 'Brushes', key: 'B' },
];

export function TopBar({
  onMenu,
  onSettings,
  onExport,
  onSync,
}: {
  onMenu(): void;
  onSettings(): void;
  onExport(): void;
  onSync(): void;
}) {
  const tab = useToolStore((s) => s.tab);
  const active = useToolStore((s) => s.active);
  const setTab = useToolStore((s) => s.setTab);
  const setTool = useToolStore((s) => s.setTool);
  const hasDoc = useDocStore((s) => s.activeId !== null);
  const isModel = useDocStore((s) => (s.activeId ? s.activeId in s.models : false));
  const tabs = isModel ? MODEL_TABS : TABS;

  return (
    <header className="topbar">
      <button className="topbar__menu" onClick={onMenu} title="Menu">
        ☰
      </button>
      <span className="topbar__brand">Monet</span>

      <div className="topbar__tools">
        <button
          className={`iconbtn ${active === 'select' ? 'is-active' : ''}`}
          onClick={() => setTool('select')}
          title="Select (S)"
        >
          ⬚
        </button>
        <button
          className={`iconbtn ${active === 'pan' ? 'is-active' : ''}`}
          onClick={() => setTool('pan')}
          title="Pan (H, or hold Space)"
        >
          ✥
        </button>
      </div>

      <nav className="topbar__tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
            title={t.key ? `${t.label} (${t.key})` : t.label}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="topbar__right">
        <button
          className="btn"
          onClick={onSync}
          disabled={!hasDoc}
          title="Sync repository branches"
        >
          ⟳ Sync
        </button>
        <button
          className="iconbtn"
          onClick={onExport}
          disabled={!hasDoc}
          title="Export (Ctrl+Shift+E)"
        >
          ⤓
        </button>
        <button className="iconbtn" onClick={onSettings} title="Settings">
          ⚙
        </button>
      </div>
    </header>
  );
}
