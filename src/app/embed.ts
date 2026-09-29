/**
 * Embed mode (`?embed=1&w=&h=`): Monet inside another app's iframe, for LEMMA's drawing
 * element (docs/07 §12). The host speaks a small postMessage protocol:
 *
 *   host → Monet   {type:'monet:load', png?: ArrayBuffer, w, h}
 *   Monet → host   {type:'monet:ready'}, {type:'monet:save', png, w, h}, {type:'monet:cancel'}
 *
 * Origins are checked both ways. The host's origin is the one named in VITE_EMBED_ORIGINS
 * (comma-separated), else the origin of the page that framed Monet (document.referrer); a
 * message from anywhere else is ignored and nothing is ever posted to `*`.
 */
import {
  embedDim,
  hostOrigins,
  parseEmbed,
  type EmbedMessage,
  type EmbedParams,
} from '../core/io/embed';
import { exportRaster } from '../engine/exporters';
import { toast } from './bus';
import { useDocStore } from './docStore';
import { openFile } from './fileActions';

export type { EmbedMessage, EmbedParams };

/** The embed parameters of this page, or null when Monet is not embedded. */
export const embedParams = (search: string = location.search): EmbedParams | null =>
  parseEmbed(search);

export const isEmbedded = (): boolean => embedParams() !== null && window.parent !== window;

let host: string | null = null;

function post(msg: EmbedMessage, transfer: Transferable[] = []): void {
  if (!host) return;
  window.parent.postMessage(msg, host, transfer);
}

/** Start a blank document of the requested size and listen for the host. Returns a stop. */
export function startEmbed(params: EmbedParams): () => void {
  const allowed = hostOrigins(import.meta.env.VITE_EMBED_ORIGINS, document.referrer);
  host = allowed[0] ?? null;
  const ds = useDocStore.getState();
  let docId = ds.newDoc({
    name: 'Drawing',
    width: params.width,
    height: params.height,
    background: { mode: 'color', color: '#FFFFFF' },
  });

  const onMessage = async (e: MessageEvent) => {
    if (e.source !== window.parent || !allowed.includes(e.origin)) return;
    host = e.origin;
    const m = e.data as EmbedMessage;
    if (m?.type !== 'monet:load') return;
    const st = useDocStore.getState();
    if (m.png && m.png.byteLength) {
      const opened = await openFile(new Blob([m.png], { type: 'image/png' }), 'Drawing.png');
      if (opened) {
        st.closeDoc(docId);
        docId = opened;
      }
    } else if (m.w && m.h && (m.w !== params.width || m.h !== params.height)) {
      const fresh = st.newDoc({
        name: 'Drawing',
        width: embedDim(m.w),
        height: embedDim(m.h),
        background: { mode: 'color', color: '#FFFFFF' },
      });
      st.closeDoc(docId);
      docId = fresh;
    }
  };
  window.addEventListener('message', onMessage);
  if (host) post({ type: 'monet:ready' });
  else toast('Monet was opened for embedding, but no host page is allowed.', 'error');
  return () => window.removeEventListener('message', onMessage);
}

/** Save: the active document as a PNG, handed to the host. */
export async function embedSave(): Promise<void> {
  const doc = useDocStore.getState().active();
  if (!doc) return;
  const png = await (await exportRaster(doc, 'png')).arrayBuffer();
  post({ type: 'monet:save', png, w: doc.width, h: doc.height }, [png]);
  useDocStore.getState().markSaved(doc.id);
}

export function embedCancel(): void {
  post({ type: 'monet:cancel' });
}
