/**
 * The `.monet` project format — docs/07 §7. A zip of `manifest.json` plus one raw RGBA
 * blob per raster layer. Raw (not PNG) so round-trips are byte-exact and `core` needs no
 * image decoder; DEFLATE keeps pixel art tiny.
 */
import JSZip from 'jszip';
import type { Item, MonetDoc } from '../model/types';
import { newDocId } from '../model/document';

export const MONET_FORMAT = 'monet';
export const MONET_VERSION = 1;

type StackEntry = (Omit<Item, 'pixels'> & { file?: string }) | Record<string, unknown>;

interface Manifest {
  format: string;
  version: number;
  name: string;
  width: number;
  height: number;
  background: MonetDoc['background'];
  nextItemId: number;
  stack: StackEntry[];
}

const layerPath = (id: number) => `layers/${id}.raw`;

export async function writeMonet(doc: MonetDoc): Promise<Uint8Array> {
  const zip = new JSZip();
  const stack: StackEntry[] = doc.stack.map((item) => {
    if (item.kind === 'raster') {
      // jszip accepts Uint8Array but not Uint8ClampedArray — same bytes, no copy.
      zip.file(
        layerPath(item.id),
        new Uint8Array(item.pixels.buffer, item.pixels.byteOffset, item.pixels.byteLength),
      );
      return { kind: 'raster', id: item.id, file: layerPath(item.id) };
    }
    return JSON.parse(JSON.stringify(item));
  });

  const manifest: Manifest = {
    format: MONET_FORMAT,
    version: MONET_VERSION,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    background: doc.background,
    nextItemId: doc.nextItemId,
    stack,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export class MonetFileError extends Error {}

export async function readMonet(bytes: Uint8Array, fallbackName = 'Untitled'): Promise<MonetDoc> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new MonetFileError('Not a readable .monet file (bad archive).');
  }

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new MonetFileError('.monet file has no manifest.');

  let m: Manifest;
  try {
    m = JSON.parse(await manifestFile.async('string')) as Manifest;
  } catch {
    throw new MonetFileError('.monet manifest is not valid JSON.');
  }

  if (m.format !== MONET_FORMAT) throw new MonetFileError('Not a Monet project file.');
  if (typeof m.version !== 'number' || m.version > MONET_VERSION) {
    throw new MonetFileError(`This project was saved by a newer version of Monet (v${m.version}).`);
  }
  if (!isDim(m.width) || !isDim(m.height)) throw new MonetFileError('.monet has invalid size.');
  if (!Array.isArray(m.stack)) throw new MonetFileError('.monet has no item stack.');

  const expected = m.width * m.height * 4;
  const stack: Item[] = [];
  for (const entry of m.stack as any[]) {
    if (entry?.kind === 'raster') {
      const file = zip.file(String(entry.file ?? layerPath(entry.id)));
      if (!file) throw new MonetFileError(`.monet is missing layer data for id ${entry.id}.`);
      const pixels = new Uint8ClampedArray(await file.async('uint8array'));
      if (pixels.length !== expected) {
        throw new MonetFileError(
          `.monet layer ${entry.id} is ${pixels.length} bytes, expected ${expected}.`,
        );
      }
      stack.push({ kind: 'raster', id: Number(entry.id), pixels });
    } else if (entry?.kind === 'shape' || entry?.kind === 'text') {
      stack.push(entry as Item);
    } else {
      throw new MonetFileError(`.monet contains an unknown item kind: ${String(entry?.kind)}`);
    }
  }

  const maxId = stack.reduce((n, i) => Math.max(n, i.id), 0);
  return {
    id: newDocId(),
    name: m.name || fallbackName,
    width: m.width,
    height: m.height,
    background: m.background ?? { mode: 'transparent', color: '#FFFFFF' },
    stack,
    nextItemId: Math.max(Number(m.nextItemId) || 1, maxId + 1),
    dirty: false,
  };
}

const isDim = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 4096;
