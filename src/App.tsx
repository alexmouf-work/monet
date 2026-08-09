import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocStore } from './app/docStore';
import { useSettingsStore } from './app/settingsStore';
import { useToolStore } from './app/toolStore';
import { onToast, toast, type Toast } from './app/bus';
import { autosaveNow, startAutosave } from './app/autosave';
import { openFile, openLocalFiles, saveDoc, saveDocAs, saveProjectAs } from './app/fileActions';
import { listAutosaves } from './integrations/idb';
import { selectAll } from './tools/marquee';
import { isTypingTarget } from './ui/Workspace';
import './tools';
import { TopBar } from './ui/TopBar';
import { AppMenu, type MenuActions } from './ui/AppMenu';
import { DocTabs } from './ui/DocTabs';
import { Workspace } from './ui/Workspace';
import { StatusBar } from './ui/StatusBar';
import { OptionsPanel } from './ui/OptionsPanel';
import { NewDocDialog } from './ui/dialogs/NewDocDialog';
import { RecoverDialog } from './ui/dialogs/RecoverDialog';
import { UnsavedDialog } from './ui/dialogs/ConfirmDialog';
import { ShortcutsDialog } from './ui/dialogs/ShortcutsDialog';
import { ResizeDialog } from './ui/dialogs/ResizeDialog';
import { ExportDialog } from './ui/dialogs/ExportDialog';
import { useShortcuts, type ShortcutActions } from './ui/useShortcuts';
import { deleteSelection, duplicateSelected } from './app/editActions';
import {
  copySelection,
  cropToSelection,
  cutSelection,
  flattenDocument,
  pasteClipboard,
  pasteFromEvent,
} from './app/selectionActions';

type DialogId = 'new' | 'recover' | 'shortcuts' | 'resize' | 'export' | null;

export function App() {
  const [dialog, setDialog] = useState<DialogId>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const hasDocs = useDocStore((s) => s.order.length > 0);
  const loaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    void useSettingsStore.getState().load();
    const stop = startAutosave();
    void listAutosaves().then((l) => {
      if (l.length) setDialog('recover');
    });
    return stop;
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const s = useSettingsStore.getState();
    useToolStore
      .getState()
      .hydrate({ swatches: s.swatches, recents: s.recents, color: s.color, alpha: s.alpha });
  }, [loaded]);

  // Colour choices persist between sessions.
  useEffect(() => {
    const unsub = useToolStore.subscribe((s) =>
      useSettingsStore
        .getState()
        .patch({ color: s.color, alpha: s.alpha, swatches: s.swatches, recents: s.recents }),
    );
    return unsub;
  }, []);

  useEffect(
    () =>
      onToast((t) => {
        setToasts((prev) => [...prev, t]);
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 4000);
      }),
    [],
  );

  // Guard against losing work on reload, and take one last snapshot.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const dirty = Object.values(useDocStore.getState().docs).some((d) => d.dirty);
      if (!dirty) return;
      void autosaveNow();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Paste event as the fallback when the async clipboard API is unavailable.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      void pasteFromEvent(e).then((handled) => {
        if (handled) e.preventDefault();
      });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Window-wide drag and drop opens files.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      for (const f of files) void openFile(f);
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const withActive = useCallback((fn: (docId: string) => void) => {
    const id = useDocStore.getState().activeId;
    if (id) fn(id);
  }, []);

  const requestClose = useCallback((id: string) => {
    const doc = useDocStore.getState().docs[id];
    if (!doc) return;
    if (doc.dirty) setClosing(id);
    else useDocStore.getState().closeDoc(id);
  }, []);

  const notYet = useCallback(
    (what: string) => () => toast(`${what} arrives in a later milestone.`),
    [],
  );

  const actions: ShortcutActions & MenuActions = useMemo(
    () => ({
      newDoc: () => setDialog('new'),
      open: () => void openLocalFiles(),
      save: () => withActive((id) => void saveDoc(useDocStore.getState().docs[id])),
      saveAs: () => withActive((id) => void saveDocAs(useDocStore.getState().docs[id])),
      saveProject: () => withActive((id) => void saveProjectAs(useDocStore.getState().docs[id])),
      exportAs: () => setDialog('export'),
      recover: () => setDialog('recover'),
      closeTab: () => withActive(requestClose),
      copy: () => void copySelection(),
      cut: () => void cutSelection(),
      paste: () => void pasteClipboard(),
      del: () => deleteSelection(),
      selectAll: () => selectAll(),
      crop: () => cropToSelection(),
      flatten: () => flattenDocument(),
      duplicate: () => duplicateSelected(),
      resizeCanvas: () => setDialog('resize'),
      shortcutsHelp: () => setDialog('shortcuts'),
      about: () => toast('Monet — Paint 3D-style editor for Minecraft textures.'),
    }),
    [notYet, requestClose, withActive],
  );

  useShortcuts(actions);

  const closingDoc = closing ? useDocStore.getState().docs[closing] : null;

  return (
    <div className="app">
      <TopBar
        onMenu={() => setMenuOpen((v) => !v)}
        onSettings={notYet('Settings')}
        onExport={actions.exportAs}
        onSync={notYet('Repository sync')}
      />
      {menuOpen && <AppMenu actions={actions} onClose={() => setMenuOpen(false)} />}

      <div className="main">
        <aside className="sources">
          <div className="sources__header">Sources</div>
          <div className="panel__todo">Coming in a later milestone.</div>
        </aside>

        <section className="center">
          <DocTabs onNew={() => setDialog('new')} onClose={requestClose} />
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

        <OptionsPanel onResizeCanvas={() => setDialog('resize')} />
      </div>

      <StatusBar />

      {dialog === 'new' && <NewDocDialog onClose={() => setDialog(null)} />}
      {dialog === 'recover' && <RecoverDialog onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'resize' && <ResizeDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {closingDoc && (
        <UnsavedDialog
          name={closingDoc.name}
          onSave={() => {
            const id = closingDoc.id;
            setClosing(null);
            void saveDoc(closingDoc).then(() => {
              if (!useDocStore.getState().docs[id]?.dirty) useDocStore.getState().closeDoc(id);
            });
          }}
          onDiscard={() => {
            useDocStore.getState().closeDoc(closingDoc.id);
            setClosing(null);
          }}
          onCancel={() => setClosing(null)}
        />
      )}

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
