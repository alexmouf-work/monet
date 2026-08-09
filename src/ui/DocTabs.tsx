/** Open-document tabs: dirty dot, close, middle-click close, and the + new button. */
import { useDocStore } from '../app/docStore';

export function DocTabs({ onNew, onClose }: { onNew(): void; onClose(id: string): void }) {
  const order = useDocStore((s) => s.order);
  const docs = useDocStore((s) => s.docs);
  const activeId = useDocStore((s) => s.activeId);
  const setActive = useDocStore((s) => s.setActive);
  useDocStore((s) => s.rev); // re-render on dirty/name changes

  return (
    <div className="doctabs" role="tablist">
      {order.map((id) => {
        const doc = docs[id];
        if (!doc) return null;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={id === activeId}
            className={`doctab ${id === activeId ? 'is-active' : ''}`}
            onPointerDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(id);
              } else setActive(id);
            }}
            title={doc.binding ? doc.binding.path : doc.name}
          >
            {doc.dirty && <span className="doctab__dot" aria-label="unsaved" />}
            <span className="doctab__name">{doc.name}</span>
            <button
              className="doctab__close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(id);
              }}
              title="Close (Ctrl+W)"
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="doctabs__new" onClick={onNew} title="New document (Ctrl+N)">
        +
      </button>
    </div>
  );
}
