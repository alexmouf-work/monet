/** Right-hand options panel: contents follow the active feature tab — docs/09 §3. */
import { useToolStore } from '../app/toolStore';
import { BrushesPanel } from './panels/BrushesPanel';
import { ShapesPanel } from './panels/ShapesPanel';
import { TextPanel } from './panels/TextPanel';
import { CanvasPanel } from './panels/CanvasPanel';
import { NoisePanel } from './panels/NoisePanel';
import { RecolourPanel } from './panels/RecolourPanel';
import { ColorPanel } from './ColorPanel';

export function OptionsPanel({ onResizeCanvas }: { onResizeCanvas(): void }) {
  const tab = useToolStore((s) => s.tab);
  return (
    <aside className="options">
      <div className="options__scroll">
        {tab === 'brushes' && <BrushesPanel />}
        {tab === 'shapes' && <ShapesPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'canvas' && <CanvasPanel onResize={onResizeCanvas} />}
        {tab === 'noise' && <NoisePanel />}
        {tab === 'recolour' && <RecolourPanel />}
      </div>
      <ColorPanel />
    </aside>
  );
}
