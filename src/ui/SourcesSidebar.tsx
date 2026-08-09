/** Sources sidebar — docs/08 §1, docs/09 §4. One texture tree per connected source. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MAX_DIM } from '../core/model/types';
import { createDoc } from '../core/model/document';
import { readMonet } from '../core/io/monetFile';
import { decodeImage } from '../engine/exporters';
import { toast } from '../app/bus';
import { useDocStore } from '../app/docStore';
import {
  listSources,
  onSourcesChanged,
  removeSource,
  type SourceProvider,
  type TextureNode,
} from '../integrations/sources';
import { removeJarSource } from '../integrations/jar/jarSource';
import { removeFolderSource } from '../integrations/fsa/folderSource';
import { forgetRepo } from '../integrations/github/repoSource';

const ICONS = { jar: '🫙', repo: '⎇', folder: '📁' } as const;

export function SourcesSidebar({
  onAddJar,
  onAddRepo,
  onAddFolder,
  onSync,
}: {
  onAddJar(): void;
  onAddRepo(): void;
  onAddFolder(): void;
  onSync(sourceId: string): void;
}) {
  const [, bump] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => onSourcesChanged(() => bump((n) => n + 1)), []);
  const sources = listSources();

  return (
    <aside className="sources">
      <div className="sources__header">
        <span>Sources</span>
        <button
          className="iconbtn iconbtn--tiny"
          onClick={() => setAddOpen((v) => !v)}
          title="Add a source"
        >
          +
        </button>
      </div>
      {addOpen && (
        <div className="sources__add">
          <button
            className="btn"
            onClick={() => {
              setAddOpen(false);
              onAddJar();
            }}
          >
            Minecraft / mod jar…
          </button>
          <button
            className="btn"
            onClick={() => {
              setAddOpen(false);
              onAddRepo();
            }}
          >
            GitHub repository…
          </button>
          <button
            className="btn"
            onClick={() => {
              setAddOpen(false);
              onAddFolder();
            }}
          >
            Local folder…
          </button>
        </div>
      )}

      {sources.length === 0 && (
        <p className="panel__hint" style={{ padding: '10px' }}>
          Add a Minecraft jar to browse vanilla textures, a GitHub repository to edit and push a
          mod&apos;s textures, or a local folder.
        </p>
      )}

      {sources.map((s) => (
        <SourceBlock key={s.id} source={s} onSync={onSync} />
      ))}
    </aside>
  );
}

function SourceBlock({
  source,
  onSync,
}: {
  source: SourceProvider;
  onSync(sourceId: string): void;
}) {
  const [open, setOpen] = useState(true);
  const [nodes, setNodes] = useState<TextureNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNodes(await source.list());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    // Load lazily on first expand; `load` is stable enough for this and re-running on every
    // render would hammer the GitHub API.
    if (open && !nodes && !loading && !error) void load();
  }, [open, nodes, loading, error, load]);

  const shown = useMemo(() => {
    if (!nodes) return [];
    const f = filter.trim().toLowerCase();
    const list = f ? nodes.filter((n) => n.path.toLowerCase().includes(f)) : nodes;
    return list.slice(0, 400);
  }, [nodes, filter]);

  const remove = async () => {
    if (source.kind === 'jar') await removeJarSource(source.id);
    else if (source.kind === 'folder') await removeFolderSource(source.id);
    else await forgetRepo(source.id);
    removeSource(source.id);
  };

  return (
    <div className="srcblock">
      <div className="srcblock__head">
        <button className="srcblock__toggle" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'} {ICONS[source.kind]} <strong>{source.label}</strong>
        </button>
        <div className="srcblock__actions">
          {source.kind === 'repo' && (
            <button
              className="iconbtn iconbtn--tiny"
              title="Sync branches"
              onClick={() => onSync(source.id)}
            >
              ⟳
            </button>
          )}
          <button className="iconbtn iconbtn--tiny" title="Refresh" onClick={() => void load()}>
            ↻
          </button>
          <button
            className="iconbtn iconbtn--tiny"
            title="Remove source"
            onClick={() => void remove()}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="srcblock__status">{source.status?.() ?? source.kind}</div>

      {open && (
        <>
          <input
            className="srcblock__filter"
            type="text"
            placeholder="Filter by path…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {loading && <div className="srcblock__note">Loading…</div>}
          {error && <div className="srcblock__note srcblock__note--error">{error}</div>}
          {nodes && (
            <div className="srcblock__note">
              {nodes.length} texture{nodes.length === 1 ? '' : 's'}
              {shown.length < (filter ? nodes.length : nodes.length) && filter
                ? ` · ${shown.length} shown`
                : ''}
              {!filter && nodes.length > 400 ? ' · showing first 400, use the filter' : ''}
            </div>
          )}
          <ul className="srctree">
            {shown.map((n) => (
              <li key={n.path}>
                <button
                  className="srctree__item"
                  title={n.path}
                  onDoubleClick={() => void openTexture(source, n)}
                  onClick={() => void openTexture(source, n)}
                >
                  <span className="srctree__name">{n.path.split('/').pop()}</span>
                  {n.hasProject && (
                    <span className="srctree__badge" title="Has a layered project" />
                  )}
                  {n.animated && (
                    <span
                      className="srctree__badge srctree__badge--anim"
                      title="Animated (.mcmeta)"
                    />
                  )}
                  <span className="srctree__path">{n.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Open a texture: its `.monet` project when one exists, else the flat PNG — docs/08 §6.2. */
async function openTexture(source: SourceProvider, node: TextureNode): Promise<void> {
  const ds = useDocStore.getState();
  const existing = Object.values(ds.docs).find(
    (d) => d.binding?.sourceId === source.id && d.binding.path === node.path,
  );
  if (existing) {
    ds.setActive(existing.id);
    return;
  }

  try {
    const { png, project } = await source.read(node);
    const name = node.path
      .split('/')
      .pop()!
      .replace(/\.png$/i, '');
    if (project) {
      const doc = await readMonet(project, name);
      doc.binding = { sourceId: source.id, path: node.path };
      ds.addDoc(doc);
      return;
    }
    const { pixels, width, height } = await decodeImage(
      new Blob([png as BlobPart], { type: 'image/png' }),
    );
    if (width > MAX_DIM || height > MAX_DIM) {
      toast(`${node.path} is larger than ${MAX_DIM}px.`, 'error');
      return;
    }
    const doc = createDoc({ name, width, height, pixels });
    // Read-only sources (jars) get a binding too: saveDoc checks writability and routes to
    // Save As, and the recorded path pre-fills the target path there (docs/08 §6.3).
    doc.binding = { sourceId: source.id, path: node.path };
    ds.addDoc(doc);
  } catch (err) {
    toast(`Could not open ${node.path}: ${(err as Error).message}`, 'error');
  }
}
