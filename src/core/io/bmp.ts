/**
 * BMP writer — docs/07 §5. 32-bit BGRA with a BITMAPV4HEADER so alpha survives in apps that
 * honour it. Rows are stored bottom-up; at 32 bpp the stride needs no padding.
 */

export function writeBmp(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const PIXEL_OFFSET = 122; // 14-byte file header + 108-byte V4 header
  const imageSize = width * height * 4;
  const out = new Uint8Array(PIXEL_OFFSET + imageSize);
  const view = new DataView(out.buffer);

  // BITMAPFILEHEADER
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  view.setUint32(2, out.length, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint32(10, PIXEL_OFFSET, true);

  // BITMAPV4HEADER
  view.setUint32(14, 108, true); // header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive ⇒ bottom-up rows
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 32, true); // bits per pixel
  view.setUint32(30, 3, true); // BI_BITFIELDS
  view.setUint32(34, imageSize, true);
  view.setInt32(38, 2835, true); // ~72 dpi
  view.setInt32(42, 2835, true);
  view.setUint32(46, 0, true); // palette colours used
  view.setUint32(50, 0, true); // important colours
  view.setUint32(54, 0x00ff0000, true); // red mask
  view.setUint32(58, 0x0000ff00, true); // green mask
  view.setUint32(62, 0x000000ff, true); // blue mask
  view.setUint32(66, 0xff000000, true); // alpha mask
  view.setUint32(70, 0x73524742, true); // 'sRGB' colour space
  // 74–109: CIEXYZTRIPLE endpoints, unused for sRGB. 110–121: gammas, all zero.

  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    let dst = PIXEL_OFFSET + y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      out[dst] = pixels[s + 2]; // B
      out[dst + 1] = pixels[s + 1]; // G
      out[dst + 2] = pixels[s]; // R
      out[dst + 3] = pixels[s + 3]; // A
      dst += 4;
    }
  }

  return out;
}
