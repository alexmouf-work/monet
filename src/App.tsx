import { useCallback, useEffect, useState } from 'react';
import { useDocStore } from './app/docStore';
import { useSettingsStore } from './app/settingsStore';
import { useToolStore } from './app/toolStore';
import { onToast, type Toast } from './app/bus';
import './tools';
import { TopBar } from './ui/TopBar';
import { DocTabs } from './ui/DocTabs';
import { Workspace } from './ui/Workspace';
import { StatusBar } from './ui/StatusBar';
import { OptionsPanel } from './ui/OptionsPanel';
import { NewDocDialog } from './ui/dialogs/NewDocDialog';
import { useShortcuts, type ShortcutActions } from './ui/useShortcuts';

type DialogId = 'new' | null;

export function App() {
  const [dialog, setDialog] = useState<DialogId>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const hasDocs = useDocStore((s) => s.order.length > 0);
  const loaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  // Colour/swatch state persists through settings.
  useEffect(() => {
    if (!loaded) return;
    const s = useSettingsStore.getState();
    useToolStore.getState().hydrate({
      swatches: s.swatches,
      recents: s.recents,
      color: s.color,
      alpha: s.alpha,
    });
  }, [loaded]);

  useEffect(
    () =>
      onToast((t) => {
        setToasts((prev) => [...prev, t]);
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 4000);
      }),
    [],
  );

  const notImplemented = useCallback(() => undefined, []);

  const actions: ShortcutActions = {
    newDoc: () => setDialog('new'),
    open: notImplemented,
    save: notImplemented,
    saveAs: notImplemented,
    exportAs: notImplemented,
    closeTab: () => {
      const id = useDocStore.getState().activeId;
      if (id) useDocStore.getState().closeDoc(id);
    },
    copy: notImplemented,
    cut: notImplemented,
    paste: notImplemented,
    del: notImplemented,
    selectAll: notImplemented,
    crop: notImplemented,
    flatten: notImplemented,
    duplicate: notImplemented,
    resizeCanvas: notImplemented,
    shortcutsHelp: notImplemented,
  };

  useShortcuts(actions);

  return (
    <div className="app">
      <TopBar
        onMenu={notImplemented}
        onSettings={notImplemented}
        onExport={notImplemented}
        onSync={notImplemented}
      />

      <div className="main">
        <aside className="sources">
          <div className="sources__header">Sources</div>
          <div className="panel__todo">Coming in a later milestone.</div>
        </aside>

        <section className="center">
          <DocTabs
            onNew={() => setDialog('new')}
            onClose={(id) => useDocStore.getState().closeDoc(id)}
          />
          {hasDocs ? (
            <Workspace />
          ) : (
            <div className="empty">
              <p>No document open.</p>
              <button className="btn btn--primary" onClick={() => setDialog('new')}>
                New document
              </button>
            </div>
          )}
        </section>

        <OptionsPanel />
      </div>

      <StatusBar />

      {dialog === 'new' && <NewDocDialog onClose={() => setDialog(null)} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
