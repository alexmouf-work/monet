import { describe, it, expect } from 'vitest';
import { writeIco } from '../src/core/io/ico';
import { writeBmp } from '../src/core/io/bmp';
import { A4_PORTRAIT, fitToPage } from '../src/core/io/pdfFit';
import { emptyPixels, idx } from '../src/core/raster/pixels';

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) =>
  b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

describe('writeIco', () => {
  const png = (n: number) => new Uint8Array(n).fill(0xab);

  it('writes a well-formed directory for two sizes', () => {
    const ico = writeIco([
      { size: 32, png: png(50) },
      { size: 16, png: png(30) },
    ]);
    expect(u16(ico, 0)).toBe(0); // reserved
    expect(u16(ico, 2)).toBe(1); // type = icon
    expect(u16(ico, 4)).toBe(2); // count

    const headerSize = 6 + 16 * 2;
    expect(ico.length).toBe(headerSize + 30 + 50);

    // Entries are ordered smallest first.
    expect(ico[6]).toBe(16);
    expect(ico[7]).toBe(16);
    expect(u16(ico, 10)).toBe(1); // planes
    expect(u16(ico, 12)).toBe(32); // bpp
    expect(u32(ico, 14)).toBe(30); // bytesInRes
    expect(u32(ico, 18)).toBe(headerSize); // first image offset

    expect(ico[22]).toBe(32);
    expect(u32(ico, 30)).toBe(50);
    expect(u32(ico, 34)).toBe(headerSize + 30);
  });

  it('encodes 256 as 0 in the dimension bytes', () => {
    const ico = writeIco([{ size: 256, png: png(10) }]);
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
  });

  it('keeps offsets consistent for 1, 3 and 7 entries', () => {
    for (const count of [1, 3, 7]) {
      const entries = Array.from({ length: count }, (_, i) => ({
        size: 16 * (i + 1),
        png: png(20 + i),
      }));
      const ico = writeIco(entries);
      const headerSize = 6 + 16 * count;
      let expected = headerSize;
      for (let i = 0; i < count; i++) {
        const p = 6 + i * 16;
        expect(u32(ico, p + 12)).toBe(expected);
        expected += u32(ico, p + 8);
      }
      expect(ico.length).toBe(expected);
    }
  });

  it('rejects an empty icon', () => {
    expect(() => writeIco([])).toThrow();
  });
});

describe('writeBmp', () => {
  it('writes a V4 header with the expected masks and size', () => {
    const px = emptyPixels(3, 2);
    const bmp = writeBmp(px, 3, 2);
    expect([bmp[0], bmp[1]]).toEqual([0x42, 0x4d]); // 'BM'
    expect(u32(bmp, 2)).toBe(122 + 3 * 2 * 4);
    expect(u32(bmp, 10)).toBe(122); // pixel offset
    expect(u32(bmp, 14)).toBe(108); // V4 header size
    expect(u32(bmp, 18)).toBe(3);
    expect(u32(bmp, 22)).toBe(2);
    expect(u16(bmp, 28)).toBe(32); // bpp
    expect(u32(bmp, 30)).toBe(3); // BI_BITFIELDS
    expect(u32(bmp, 54) >>> 0).toBe(0x00ff0000);
    expect(u32(bmp, 58) >>> 0).toBe(0x0000ff00);
    expect(u32(bmp, 62) >>> 0).toBe(0x000000ff);
    expect(u32(bmp, 66) >>> 0).toBe(0xff000000);
    expect(u32(bmp, 70) >>> 0).toBe(0x73524742); // 'sRGB'
  });

  it('stores rows bottom-up as BGRA, alpha included', () => {
    const px = emptyPixels(2, 2);
    // Top-left red (half alpha), bottom-right blue.
    px.set([255, 0, 0, 128], idx(0, 0, 2));
    px.set([0, 0, 255, 255], idx(1, 1, 2));
    const bmp = writeBmp(px, 2, 2);
    const at = (i: number) => [...bmp.slice(122 + i * 4, 122 + i * 4 + 4)];
    // First stored row is the image's LAST row: (0,1) then (1,1).
    expect(at(0)).toEqual([0, 0, 0, 0]);
    expect(at(1)).toEqual([255, 0, 0, 255]); // blue → B,G,R,A
    // Second stored row is the image's first row.
    expect(at(2)).toEqual([0, 0, 255, 128]); // red at half alpha
  });
});

describe('fitToPage', () => {
  const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

  it('a 16:9 image goes landscape with the long edge flush', () => {
    const f = fitToPage(1920, 1080);
    expect(f.landscape).toBe(true);
    near(f.pageW, A4_PORTRAIT[1]);
    near(f.pageH, A4_PORTRAIT[0]);
    near(f.drawW, A4_PORTRAIT[1]);
    near(f.x, 0);
    expect(f.y).toBeGreaterThan(0);
  });

  it('a 9:16 image goes portrait with the long edge flush', () => {
    const f = fitToPage(1080, 1920);
    expect(f.landscape).toBe(false);
    near(f.pageW, A4_PORTRAIT[0]);
    near(f.drawH, A4_PORTRAIT[1]);
    near(f.y, 0);
    expect(f.x).toBeGreaterThan(0);
  });

  it('a square image is governed by the short axis and centred on the other', () => {
    const f = fitToPage(512, 512);
    expect(f.landscape).toBe(true); // w ≥ h
    near(f.drawH, A4_PORTRAIT[0]); // short page edge
    near(f.y, 0);
    expect(f.x).toBeGreaterThan(0);
    near(f.drawW, f.drawH);
  });

  it('never overflows the page and never scales beyond fit', () => {
    for (const [w, h] of [
      [16, 16],
      [64, 32],
      [4096, 16],
      [16, 4096],
      [1, 1],
    ]) {
      const f = fitToPage(w, h);
      expect(f.drawW).toBeLessThanOrEqual(f.pageW + 1e-6);
      expect(f.drawH).toBeLessThanOrEqual(f.pageH + 1e-6);
      // One axis is always flush: that is the no-margin requirement.
      const flush = Math.abs(f.drawW - f.pageW) < 1e-6 || Math.abs(f.drawH - f.pageH) < 1e-6;
      expect(flush, `${w}×${h} has a flush axis`).toBe(true);
    }
  });

  it('preserves the image aspect ratio', () => {
    const f = fitToPage(300, 100);
    near(f.drawW / f.drawH, 3);
  });
});
