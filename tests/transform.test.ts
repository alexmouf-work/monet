import { describe, it, expect } from 'vitest';
import {
  flipH,
  flipV,
  recanvas,
  resampleBilinear,
  resampleNearest,
  rotate90ACW,
  rotate90CW,
  rotatePixels,
} from '../src/core/raster/transform';
import { emptyPixels, idx } from '../src/core/raster/pixels';

/** Buffer whose red channel encodes x and green encodes y, so remaps are checkable. */
function coords(w: number, h: number) {
  const px = emptyPixels(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      px[i] = x;
      px[i + 1] = y;
      px[i + 2] = 0;
      px[i + 3] = 255;
    }
  return px;
}

const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => {
  const i = idx(x, y, w);
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
};

describe('rotate90', () => {
  it('CW maps dst(x,y) = src(y, H−1−x)', () => {
    const W = 4;
    const H = 3;
    const src = coords(W, H);
    const out = rotate90CW(src, W, H); // 3 wide, 4 tall
    expect(at(out, H, 0, 0)).toEqual([0, 2, 0, 255]); // src(0, 2)
    expect(at(out, H, 2, 0)).toEqual([0, 0, 0, 255]); // src(0, H−1−2) = src(0,0)
    expect(at(out, H, 0, 3)).toEqual([3, 2, 0, 255]); // src(3, 2) lands bottom-left
  });

  it('four CW rotations are the identity', () => {
    const W = 5;
    const H = 3;
    let px: Uint8ClampedArray = coords(W, H);
    let w = W;
    let h = H;
    for (let i = 0; i < 4; i++) {
      px = rotate90CW(px, w, h);
      [w, h] = [h, w];
    }
    expect([w, h]).toEqual([W, H]);
    expect([...px]).toEqual([...coords(W, H)]);
  });

  it('CW then ACW is the identity', () => {
    const W = 6;
    const H = 2;
    const src = coords(W, H);
    const back = rotate90ACW(rotate90CW(src, W, H), H, W);
    expect([...back]).toEqual([...src]);
  });
});

describe('flips', () => {
  it('are involutions', () => {
    const W = 4;
    const H = 3;
    const src = coords(W, H);
    expect([...flipH(flipH(src, W, H), W, H)]).toEqual([...src]);
    expect([...flipV(flipV(src, W, H), W, H)]).toEqual([...src]);
  });

  it('map the expected pixels', () => {
    const W = 4;
    const H = 3;
    const src = coords(W, H);
    expect(at(flipH(src, W, H), W, 0, 0)).toEqual([3, 0, 0, 255]);
    expect(at(flipV(src, W, H), W, 0, 0)).toEqual([0, 2, 0, 255]);
  });
});

describe('resampleNearest', () => {
  it('doubles every pixel exactly on a 2× upscale', () => {
    const src = coords(2, 2);
    const out = resampleNearest(src, 2, 2, 4, 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) expect(at(out, 4, x, y)).toEqual([x >> 1, y >> 1, 0, 255]);
  });

  it('halves by point-sampling', () => {
    const src = coords(4, 4);
    const out = resampleNearest(src, 4, 4, 2, 2);
    expect(at(out, 2, 0, 0)).toEqual([1, 1, 0, 255]);
    expect(at(out, 2, 1, 1)).toEqual([3, 3, 0, 255]);
  });

  it('is the identity at the same size', () => {
    const src = coords(3, 3);
    expect([...resampleNearest(src, 3, 3, 3, 3)]).toEqual([...src]);
  });
});

describe('resampleBilinear', () => {
  it('keeps colour clean next to transparency (no dark fringe)', () => {
    // Left pixel opaque red, right pixel fully transparent.
    const src = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
    const out = resampleBilinear(src, 2, 1, 4, 1);
    let visible = 0;
    for (let x = 0; x < 4; x++) {
      const [r, g, b, a] = at(out, 4, x, 0);
      if (a === 0) continue; // a fully transparent pixel carries no colour at all
      visible++;
      expect([r, g, b]).toEqual([255, 0, 0]); // never blended toward black
    }
    expect(visible).toBeGreaterThan(0);
    expect(at(out, 4, 0, 0)[3]).toBeGreaterThan(at(out, 4, 3, 0)[3]);
  });
});

describe('recanvas', () => {
  it('pads on grow and crops on shrink, anchored top-left', () => {
    const src = coords(3, 3);
    const grown = recanvas(src, 3, 3, 5, 4);
    expect(at(grown, 5, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(grown, 5, 4, 3)).toEqual([0, 0, 0, 0]); // padded transparent
    const shrunk = recanvas(src, 3, 3, 2, 2);
    expect(at(shrunk, 2, 1, 1)).toEqual([1, 1, 0, 255]);
  });
});

describe('rotatePixels (free-angle selection rotation, docs/06 §4.1)', () => {
  it('0° is a copy, not the same buffer', () => {
    const src = coords(4, 3);
    const out = rotatePixels(src, 4, 3, 0);
    expect(out.w).toBe(4);
    expect(out.h).toBe(3);
    expect([...out.pixels]).toEqual([...src]);
    expect(out.pixels).not.toBe(src);
  });

  it('right angles route to the exact transposes — lossless, and the box transposes', () => {
    const src = coords(4, 3);
    expect([...rotatePixels(src, 4, 3, 90).pixels]).toEqual([...rotate90CW(src, 4, 3)]);
    expect([...rotatePixels(src, 4, 3, 270).pixels]).toEqual([...rotate90ACW(src, 4, 3)]);
    expect(rotatePixels(src, 4, 3, 90)).toMatchObject({ w: 3, h: 4 });
    expect([...rotatePixels(src, 4, 3, 180).pixels]).toEqual([...flipV(flipH(src, 4, 3), 4, 3)]);
  });

  it('normalises the angle: −90 = 270, 360 = 0, 450 = 90', () => {
    const src = coords(4, 3);
    expect([...rotatePixels(src, 4, 3, -90).pixels]).toEqual([
      ...rotatePixels(src, 4, 3, 270).pixels,
    ]);
    expect([...rotatePixels(src, 4, 3, 360).pixels]).toEqual([...src]);
    expect([...rotatePixels(src, 4, 3, 450).pixels]).toEqual([
      ...rotatePixels(src, 4, 3, 90).pixels,
    ]);
  });

  it('four 90° turns return the original exactly', () => {
    const src = coords(5, 3);
    let px: Uint8ClampedArray = src;
    let w = 5;
    let h = 3;
    for (let i = 0; i < 4; i++) {
      const r = rotatePixels(px, w, h, 90);
      px = r.pixels;
      w = r.w;
      h = r.h;
    }
    expect(w).toBe(5);
    expect(h).toBe(3);
    expect([...px]).toEqual([...src]);
  });

  it('turns clockwise: the top edge ends up on the right', () => {
    // A single opaque pixel at top-centre of a 3×3.
    const src = emptyPixels(3, 3);
    src.set([255, 0, 0, 255], idx(1, 0, 3));
    const out = rotatePixels(src, 3, 3, 90);
    expect(at(out.pixels, 3, 2, 1)).toEqual([255, 0, 0, 255]);
  });

  it('grows the bounding box for an off-axis angle and keeps the art inside it', () => {
    const src = coords(8, 4);
    const out = rotatePixels(src, 8, 4, 45);
    // |8cos45| + |4sin45| ≈ 8.49 both ways.
    expect(out.w).toBe(8);
    expect(out.h).toBe(8);
    expect(out.pixels.length).toBe(8 * 8 * 4);
    // Rotation conserves area: nearest-neighbour can sample a source pixel more than once, so
    // the count moves a little, but not by much.
    let opaque = 0;
    for (let i = 3; i < out.pixels.length; i += 4) if (out.pixels[i] > 0) opaque++;
    expect(opaque).toBeGreaterThan(8 * 4 * 0.75);
    expect(opaque).toBeLessThan(8 * 4 * 1.25);
  });

  it('leaves the corners of an off-axis rotation transparent rather than smeared', () => {
    const src = emptyPixels(8, 8);
    src.fill(255); // fully opaque white block
    const out = rotatePixels(src, 8, 8, 45);
    expect(at(out.pixels, out.w, 0, 0)[3]).toBe(0);
    expect(at(out.pixels, out.w, out.w - 1, 0)[3]).toBe(0);
    expect(at(out.pixels, out.w, Math.floor(out.w / 2), Math.floor(out.h / 2))[3]).toBe(255);
  });

  it('samples, never blends: every output pixel is one of the input colours', () => {
    const src = emptyPixels(6, 6);
    for (let i = 0; i < 6 * 6; i++) src.set(i % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    const out = rotatePixels(src, 6, 6, 30);
    for (let i = 0; i < out.pixels.length; i += 4) {
      if (out.pixels[i + 3] === 0) continue;
      const rgb = [out.pixels[i], out.pixels[i + 1], out.pixels[i + 2]].join();
      expect(['255,0,0', '0,0,255']).toContain(rgb);
    }
  });
});
