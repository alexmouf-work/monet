import { describe, it, expect } from 'vitest';
import { floodFill, toleranceToThreshold } from '../src/core/raster/floodfill';
import { emptyPixels, idx } from '../src/core/raster/pixels';

/** Build a W*H RGBA buffer from a character map plus a palette. */
function bitmap(rows: string[], palette: Record<string, [number, number, number, number]>) {
  const H = rows.length;
  const W = rows[0].length;
  const px = emptyPixels(W, H);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const [r, g, b, a] = palette[ch];
      const i = idx(x, y, W);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a;
    }),
  );
  return { px, W, H };
}

const count = (mask: Uint8Array) => mask.reduce((n, v) => n + v, 0);

const P = {
  '.': [0, 0, 0, 0] as [number, number, number, number],
  W: [255, 255, 255, 255] as [number, number, number, number],
  K: [0, 0, 0, 255] as [number, number, number, number],
  N: [250, 250, 250, 255] as [number, number, number, number], // near-white
};

describe('floodFill', () => {
  it('fills a contiguous region and reports its bounds', () => {
    const { px, W, H } = bitmap(['WWWW', 'WKKW', 'WKKW', 'WWWW'], P);
    const r = floodFill(px, W, H, 1, 1, 0)!;
    expect(count(r.mask)).toBe(4);
    expect(r.rect).toEqual({ x: 1, y: 1, w: 2, h: 2 });
  });

  it('never crosses a 1px outline of another colour', () => {
    const { px, W, H } = bitmap(['.....', '.KKK.', '.K.K.', '.KKK.', '.....'], P);
    const inside = floodFill(px, W, H, 2, 2, 0)!;
    expect(count(inside.mask)).toBe(1); // the single interior pixel only
    const outside = floodFill(px, W, H, 0, 0, 0)!;
    expect(count(outside.mask)).toBe(16); // the ring of transparency around the box
  });

  it('tolerance 0 separates near-identical colours; 1% merges them', () => {
    const { px, W, H } = bitmap(['WN', 'WN'], P);
    expect(count(floodFill(px, W, H, 0, 0, 0)!.mask)).toBe(2);
    expect(count(floodFill(px, W, H, 0, 0, toleranceToThreshold(3))!.mask)).toBe(4);
  });

  it('tolerance 100% fills the entire canvas', () => {
    const { px, W, H } = bitmap(['WK.', 'KWN', '.NW'], P);
    expect(count(floodFill(px, W, H, 0, 0, 255)!.mask)).toBe(9);
  });

  it('handles a seed on the edge and a single-pixel region', () => {
    const { px, W, H } = bitmap(['K..', '...', '...'], P);
    const single = floodFill(px, W, H, 0, 0, 0)!;
    expect(count(single.mask)).toBe(1);
    expect(single.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const rest = floodFill(px, W, H, 2, 2, 0)!;
    expect(count(rest.mask)).toBe(8);
  });

  it('returns null outside the canvas', () => {
    const { px, W, H } = bitmap(['WW', 'WW'], P);
    expect(floodFill(px, W, H, -1, 0, 0)).toBeNull();
    expect(floodFill(px, W, H, 2, 0, 0)).toBeNull();
  });

  it('treats alpha as a matched channel', () => {
    // Same RGB, different alpha: an opaque white run must not leak into transparency.
    const px = emptyPixels(2, 1);
    px.set([255, 255, 255, 255], 0);
    px.set([255, 255, 255, 0], 4);
    expect(count(floodFill(px, 2, 1, 0, 0, 0)!.mask)).toBe(1);
  });

  it('fills a large open area without blowing the stack', () => {
    const W = 256;
    const H = 256;
    const px = emptyPixels(W, H);
    const r = floodFill(px, W, H, 128, 128, 0)!;
    expect(count(r.mask)).toBe(W * H);
  });
});
