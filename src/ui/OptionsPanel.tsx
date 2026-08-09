/** Right-hand options panel: contents follow the active feature tab — docs/09 §3. */
import { useToolStore } from '../app/toolStore';
import { BrushesPanel } from './panels/BrushesPanel';
import { ColorPanel } from './ColorPanel';

export function OptionsPanel() {
  const tab = useToolStore((s) => s.tab);
  return (
    <aside className="options">
      <div className="options__scroll">
        {tab === 'brushes' && <BrushesPanel />}
        {tab !== 'brushes' && <div className="panel__todo">Coming in a later milestone.</div>}
      </div>
      <ColorPanel />
    </aside>
  );
}
