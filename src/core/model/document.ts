/** Document helpers — creation, cloning, the auto-layering rules (docs/01 §3.1). */
import type { Background, Item, MonetDoc, ObjectItem, RasterLayer } from './types';
import { isRaster } from './types';
import { emptyPixels } from '../raster/pixels';

let docSeq = 0;
export const newDocId = () => `doc${++docSeq}-${Math.floor(performance.now())}`;

export function createDoc(opts: {
  name?: string;
  width: number;
  height: number;
  background?: Background;
  pixels?: Uint8ClampedArray;
}): MonetDoc {
  const { width, height } = opts;
  const layer: RasterLayer = {
    kind: 'raster',
    id: 1,
    pixels: opts.pixels ?? emptyPixels(width, height),
  };
  return {
    id: newDocId(),
    name: opts.name ?? 'Untitled',
    width,
    height,
    background: opts.background ?? { mode: 'transparent', color: '#FFFFFF' },
    stack: [layer],
    nextItemId: 2,
    dirty: false,
  };
}

export const cloneItem = <T extends Item>(item: T): T =>
  item.kind === 'raster'
    ? ({ ...item, pixels: new Uint8ClampedArray(item.pixels) } as T)
    : (structuredCloneItem(item) as T);

const structuredCloneItem = (item: Item): Item => JSON.parse(JSON.stringify(item));

export function cloneDoc(doc: MonetDoc): MonetDoc {
  return { ...doc, background: { ...doc.background }, stack: doc.stack.map(cloneItem) };
}

export const rasterLayers = (doc: MonetDoc): RasterLayer[] => doc.stack.filter(isRaster);

export const objectItems = (doc: MonetDoc): ObjectItem[] =>
  doc.stack.filter((i): i is ObjectItem => i.kind !== 'raster');

export const findItem = (doc: MonetDoc, id: number): Item | undefined =>
  doc.stack.find((i) => i.id === id);

export const hasObjects = (doc: MonetDoc): boolean => doc.stack.some((i) => i.kind !== 'raster');

/**
 * Auto-layering Rule 1 (docs/01 §3.1): brushes paint into the topmost item when it is
 * a raster layer, otherwise a fresh transparent layer is pushed on top. Mutates `doc`.
 */
export function ensureTopRasterLayer(doc: MonetDoc): RasterLayer {
  const top = doc.stack[doc.stack.length - 1];
  if (top && isRaster(top)) return top;
  const layer: RasterLayer = {
    kind: 'raster',
    id: doc.nextItemId++,
    pixels: emptyPixels(doc.width, doc.height),
  };
  doc.stack.push(layer);
  return layer;
}

/** Rule 2: objects go on top of the stack. Mutates `doc`; returns the assigned id. */
export function pushObject(doc: MonetDoc, make: (id: number) => ObjectItem): ObjectItem {
  const item = make(doc.nextItemId++);
  doc.stack.push(item);
  return item;
}

export const layerIndex = (doc: MonetDoc, id: number) => doc.stack.findIndex((i) => i.id === id);
