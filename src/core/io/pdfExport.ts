/** PDF export — docs/07 §6. Uses pdf-lib; the fit maths lives in pdfFit.ts and is tested. */
import { PDFDocument } from 'pdf-lib';
import { A4_PORTRAIT, fitToPage } from './pdfFit';

export async function exportPdf(
  png: Uint8Array,
  width: number,
  height: number,
  page: [number, number] = A4_PORTRAIT,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const fit = fitToPage(width, height, page);
  const p = doc.addPage([fit.pageW, fit.pageH]);
  p.drawImage(img, { x: fit.x, y: fit.y, width: fit.drawW, height: fit.drawH });
  return doc.save();
}
