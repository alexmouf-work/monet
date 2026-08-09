/** Export orchestration for all six formats — docs/07 §3–7. */
import type { MonetDoc } from '../core/model/types';
import { writeBmp } from '../core/io/bmp';
import { ICO_DEFAULT_SIZES, writeIco } from '../core/io/ico';
import { exportPdf } from '../core/io/pdfExport';
import { renderComposite } from '../engine/compose';
import {
  MIME,
  canvasToBlob,
  matteCanvas,
  scaleNearest,
  supportsWebp,
  type RasterFormat,
} from '../engine/exporters';
import { ctx2d } from '../engine/layerCache';
import { downloadBlob, pickSaveTarget, writeToTarget } from '../integrations/fsa/localFile';
import { toast } from './bus';

export type ExportFormat = RasterFormat | 'ico' | 'bmp' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  filename: string;
  /** JPEG/WebP quality, 0.05–1. */
  quality: number;
  /** ICO entry sizes. */
  icoSizes: number[];
}

export const defaultExportOptions = (doc: MonetDoc): ExportOptions => ({
  format: 'png',
  filename: `${doc.name.replace(/×/g, 'x').replace(/[^\w.-]+/g, '-') || 'texture'}`,
  quality: 0.92,
  icoSizes: [...ICO_DEFAULT_SIZES],
});

export const EXPORT_EXT: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  ico: 'ico',
  bmp: 'bmp',
  pdf: 'pdf',
};

export const availableFormats = (): ExportFormat[] =>
  (['png', 'jpeg', 'webp', 'ico', 'bmp', 'pdf'] as ExportFormat[]).filter(
    (f) => f !== 'webp' || supportsWebp(),
  );

/** Build the export payload. Separated from saving so it is easy to test or reuse. */
export async function buildExport(doc: MonetDoc, opts: ExportOptions): Promise<Blob> {
  const composite = renderComposite(doc);
  const matte = doc.background.mode === 'color' ? doc.background.color : '#FFFFFF';

  switch (opts.format) {
    case 'png':
      return canvasToBlob(composite, MIME.png);
    case 'jpeg':
      return canvasToBlob(matteCanvas(composite, matte), MIME.jpeg, opts.quality);
    case 'webp':
      return canvasToBlob(composite, MIME.webp, opts.quality);
    case 'bmp': {
      const data = ctx2d(composite).getImageData(0, 0, doc.width, doc.height).data;
      return new Blob([writeBmp(data, doc.width, doc.height) as BlobPart], {
        type: 'image/bmp',
      });
    }
    case 'ico': {
      const sizes = (opts.icoSizes.length ? opts.icoSizes : ICO_DEFAULT_SIZES)
        .filter((s) => s >= 1 && s <= 256)
        .sort((a, b) => a - b);
      const entries = [];
      for (const size of sizes) {
        // Letterbox non-square sources onto a transparent square first.
        const scaled = scaleNearest(composite, size, size, true);
        const blob = await canvasToBlob(scaled, MIME.png);
        entries.push({ size, png: new Uint8Array(await blob.arrayBuffer()) });
      }
      return new Blob([writeIco(entries) as BlobPart], { type: 'image/x-icon' });
    }
    case 'pdf': {
      const png = new Uint8Array(await (await canvasToBlob(composite, MIME.png)).arrayBuffer());
      const bytes = await exportPdf(png, doc.width, doc.height);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    }
  }
}

export async function exportDocument(doc: MonetDoc, opts: ExportOptions): Promise<void> {
  try {
    const blob = await buildExport(doc, opts);
    const name = `${opts.filename || 'texture'}.${EXPORT_EXT[opts.format]}`;
    const target = await pickSaveTarget(name, []);
    if (!target) return;
    await writeToTarget(target, blob);
    toast(`Exported ${name}`, 'ok');
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'error');
  }
}

/** Used by tests and the harness: export straight to a download, skipping the picker. */
export async function exportToDownload(doc: MonetDoc, opts: ExportOptions): Promise<void> {
  const blob = await buildExport(doc, opts);
  downloadBlob(blob, `${opts.filename || 'texture'}.${EXPORT_EXT[opts.format]}`);
}
