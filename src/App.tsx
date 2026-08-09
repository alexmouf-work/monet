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
import { Toolbar } from './ui/Toolbar';
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
import { ConnectRepoDialog } from './ui/dialogs/ConnectRepoDialog';
import { SyncDialog } from './ui/dialogs/SyncDialog';
import { SettingsDialog } from './ui/dialogs/SettingsDialog';
import { SourcesSidebar } from './ui/SourcesSidebar';
import { SaveAsDialog } from './ui/dialogs/SaveAsDialog';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { watchSystemTheme } from './app/themeMode';
import { addJarSource, restoreJarSources } from './integrations/jar/jarSource';
import {
  addFolderSource,
  folderSourcesSupported,
  restoreFolderSources,
} from './integrations/fsa/folderSource';
import { restoreRepoSources } from './integrations/github/repoSource';
import { listSources } from './integrations/sources';
import { pickOpenFiles } from './integrations/fsa/localFile';
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

type DialogId =
  'new' | 'recover' | 'shortcuts' | 'resize' | 'export' | 'repo' | 'settings' | 'saveAs' | null;

export function App() {
  const [dialog, setDialog] = useState<DialogId>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncSourceId, setSyncSourceId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const hasDocs = useDocStore((s) => s.order.length > 0);
  const loaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    void useSettingsStore.getState().load();
    // Reconnect stored sources; none of these touch the network until browsed.
    void restoreJarSources();
    void restoreFolderSources();
    void restoreRepoSources();
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

  useEffect(() => watchSystemTheme(() => useSettingsStore.getState().theme), []);

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
      // With writable sources connected, Save As offers them; otherwise go straight to a file.
      saveAs: () =>
        withActive(() =>
          listSources().some((s) => s.writable)
            ? setDialog('saveAs')
            : void saveDocAs(useDocStore.getState().active()!),
        ),
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
      addJar: async () => {
        const [file] = await pickOpenFiles(
          [
            {
              description: 'Minecraft or mod jar',
              accept: { 'application/java-archive': ['.jar', '.zip'] },
            },
          ],
          false,
        );
        if (!file) return;
        try {
          const source = await addJarSource(file);
          toast(`Added ${source.label}`, 'ok');
        } catch {
          toast(`${file.name} is not a readable jar or zip archive.`, 'error');
        }
      },
      addFolder: async () => {
        if (!folderSourcesSupported()) {
          toast('Local folders need a Chromium browser (File System Access).', 'error');
          return;
        }
        const source = await addFolderSource();
        if (source) toast(`Added folder ${source.label}`, 'ok');
      },
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
        onSettings={() => setDialog('settings')}
        onExport={actions.exportAs}
        onSync={() => {
          const active = useDocStore.getState().active();
          const bound = active?.binding
            ? listSources().find((s) => s.id === active.binding!.sourceId && s.kind === 'repo')
            : undefined;
          const repo = bound ?? listSources().find((s) => s.kind === 'repo');
          if (!repo) {
            toast('Connect a GitHub repository first.', 'error');
            return;
          }
          setSyncSourceId(repo.id);
        }}
      />
      {menuOpen && <AppMenu actions={actions} onClose={() => setMenuOpen(false)} />}
      <Toolbar actions={actions} />

      <div className="main">
        <SourcesSidebar
          onAddJar={() => void actions.addJar()}
          onAddRepo={() => setDialog('repo')}
          onAddFolder={() => void actions.addFolder()}
          onSync={(id) => setSyncSourceId(id)}
        />

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
      {dialog === 'repo' && (
        <ConnectRepoDialog
          onClose={() => setDialog(null)}
          onNeedToken={() => setDialog('settings')}
        />
      )}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'saveAs' && <SaveAsDialog onClose={() => setDialog(null)} />}
      {syncSourceId && <SyncDialog sourceId={syncSourceId} onClose={() => setSyncSourceId(null)} />}
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

      <UpdatePrompt />

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
