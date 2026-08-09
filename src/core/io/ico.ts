/**
 * ICO writer — docs/07 §4. A container of PNG-compressed entries, which Windows Vista+ and
 * every browser accept at all sizes. Pure bytes in, bytes out.
 */

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
export const ICO_DEFAULT_SIZES = [16, 32, 48, 256];

export interface IcoEntry {
  /** Square edge in px, 1–256. */
  size: number;
  /** PNG-encoded bytes for that size. */
  png: Uint8Array;
}

export function writeIco(entries: IcoEntry[]): Uint8Array {
  if (!entries.length) throw new Error('An ICO needs at least one image.');
  const sorted = [...entries].sort((a, b) => a.size - b.size);

  const headerSize = 6 + 16 * sorted.length;
  const total = sorted.reduce((n, e) => n + e.png.length, headerSize);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  // ICONDIR
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type 1 = icon
  view.setUint16(4, sorted.length, true);

  let offset = headerSize;
  sorted.forEach((entry, i) => {
    const p = 6 + i * 16;
    // 0 means 256 in both dimension bytes.
    out[p] = entry.size >= 256 ? 0 : entry.size;
    out[p + 1] = entry.size >= 256 ? 0 : entry.size;
    out[p + 2] = 0; // palette size
    out[p + 3] = 0; // reserved
    view.setUint16(p + 4, 1, true); // colour planes
    view.setUint16(p + 6, 32, true); // bits per pixel
    view.setUint32(p + 8, entry.png.length, true);
    view.setUint32(p + 12, offset, true);
    out.set(entry.png, offset);
    offset += entry.png.length;
  });

  return out;
}
