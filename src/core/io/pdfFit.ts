/**
 * PDF page fitting — docs/07 §6. The owner's rule is "fit the largest edge of the image to
 * the longest edge of the page, respecting landscape/portrait, no margin". Taken literally
 * that crops any image squarer than the page, so this is a contain-fit: the governed axis is
 * flush and the other centres. For any image at least as elongated as the page (aspect ≥ √2
 * for A4) the long edges coincide exactly, which is the intent.
 */

export const A4_PORTRAIT: [number, number] = [595.28, 841.89];

export interface PageFit {
  pageW: number;
  pageH: number;
  drawW: number;
  drawH: number;
  x: number;
  y: number;
  landscape: boolean;
}

export function fitToPage(
  imgW: number,
  imgH: number,
  page: [number, number] = A4_PORTRAIT,
): PageFit {
  const landscape = imgW >= imgH;
  const [pageW, pageH] = landscape ? [page[1], page[0]] : page;
  const s = Math.min(pageW / imgW, pageH / imgH);
  const drawW = imgW * s;
  const drawH = imgH * s;
  return {
    pageW,
    pageH,
    drawW,
    drawH,
    x: (pageW - drawW) / 2,
    y: (pageH - drawH) / 2,
    landscape,
  };
}
