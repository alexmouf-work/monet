/**
 * Canvas-backed raster exports — docs/07 §2–3. These live in `engine`, not `core/io`,
 * because they need a real canvas encoder; the byte-level writers (ICO/BMP/PDF/.monet)
 * stay pure in `core/io`. (Spec correction to docs/01 §2's file list.)
 */
import type { MonetDoc } from '../core/model/types';
import { renderComposite } from './compose';
import { ctx2d, makeCanvas } from './layerCache';

export type RasterFormat = 'png' | 'jpeg' | 'webp';

export const MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

let webpSupported: boolean | null = null;

/** Feature-detect WebP encoding once (absent on Firefox/Safari — docs/07 §3). */
export function supportsWebp(): boolean {
  if (webpSupported === null) {
    const c = makeCanvas(1, 1);
    webpSupported = c.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpSupported;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Encoding to ${mime} failed.`))),
      mime,
      quality,
    );
  });
}

/** Composite with transparency flattened onto `matte` — JPEG and 24-bit BMP have no alpha. */
export function matteCanvas(src: HTMLCanvasElement, matte: string): HTMLCanvasElement {
  const out = makeCanvas(src.width, src.height);
  const ctx = ctx2d(out);
  ctx.fillStyle = matte;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  return out;
}

export interface ExportOptions {
  quality?: number;
  /** Colour used where the image is transparent, for formats without alpha. */
  matte?: string;
}

export async function exportRaster(
  doc: MonetDoc,
  format: RasterFormat,
  opts: ExportOptions = {},
): Promise<Blob> {
  let canvas = renderComposite(doc);
  if (format === 'jpeg') {
    // A6: JPEG mattes onto the background colour when set, else white.
    canvas = matteCanvas(
      canvas,
      opts.matte ?? (doc.background.mode === 'color' ? doc.background.color : '#FFFFFF'),
    );
  }
  return canvasToBlob(canvas, MIME[format], opts.quality);
}

export const exportPngBytes = async (doc: MonetDoc): Promise<Uint8Array> =>
  new Uint8Array(await (await exportRaster(doc, 'png')).arrayBuffer());

/** Nearest-neighbour rescale of a composite, used by ICO entries and thumbnails. */
export function scaleNearest(
  src: HTMLCanvasElement,
  w: number,
  h: number,
  letterbox = false,
): HTMLCanvasElement {
  const out = makeCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.imageSmoothingEnabled = false;
  if (!letterbox) {
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
    return out;
  }
  const s = Math.min(w / src.width, h / src.height);
  const dw = Math.max(1, Math.round(src.width * s));
  const dh = Math.max(1, Math.round(src.height * s));
  ctx.drawImage(
    src,
    0,
    0,
    src.width,
    src.height,
    Math.floor((w - dw) / 2),
    Math.floor((h - dh) / 2),
    dw,
    dh,
  );
  return out;
}

/** Decode an image file into a document-ready RGBA buffer (docs/07 §1). */
export async function decodeImage(
  file: Blob,
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: data.data, width: canvas.width, height: canvas.height };
}
