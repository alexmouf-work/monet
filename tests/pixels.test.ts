import { describe, it, expect } from 'vitest';
import {
  blendOver,
  clampRect,
  copyRect,
  emptyPixels,
  idx,
  normalizeRect,
  pasteRect,
  unionRect,
} from '../src/core/raster/pixels';

describe('blendOver', () => {
  it('is a straight replacement at alpha 1', () => {
    const p = emptyPixels(1, 1);
    blendOver(p, 0, 10, 20, 30, 1);
    expect([...p]).toEqual([10, 20, 30, 255]);
  });

  it('leaves the destination untouched at alpha 0', () => {
    const p = new Uint8ClampedArray([1, 2, 3, 4]);
    blendOver(p, 0, 200, 200, 200, 0);
    expect([...p]).toEqual([1, 2, 3, 4]);
  });

  it('half-alpha white over opaque black gives mid grey', () => {
    const p = new Uint8ClampedArray([0, 0, 0, 255]);
    blendOver(p, 0, 255, 255, 255, 0.5);
    expect(p[0]).toBe(128);
    expect(p[3]).toBe(255);
  });

  it('half-alpha over transparent keeps colour un-premultiplied', () => {
    const p = emptyPixels(1, 1);
    blendOver(p, 0, 255, 0, 0, 0.5);
    expect([...p]).toEqual([255, 0, 0, 128]);
  });

  it('accumulates alpha correctly over two half-alpha passes', () => {
    const p = emptyPixels(1, 1);
    blendOver(p, 0, 255, 0, 0, 0.5);
    blendOver(p, 0, 255, 0, 0, 0.5);
    // 0.5 then 0.5 over 128/255 ⇒ 0.751 ⇒ 192 (the extra step comes from 8-bit storage).
    expect(p[3]).toBe(192);
  });
});

describe('rect helpers', () => {
  it('copyRect/pasteRect round-trip', () => {
    const src = emptyPixels(4, 4);
    for (let i = 0; i < src.length; i++) src[i] = i % 256;
    const crop = copyRect(src, 4, { x: 1, y: 1, w: 2, h: 2 });
    const dst = emptyPixels(4, 4);
    pasteRect(dst, 4, { x: 1, y: 1, w: 2, h: 2 }, crop);
    expect([...copyRect(dst, 4, { x: 1, y: 1, w: 2, h: 2 })]).toEqual([...crop]);
    expect(dst[idx(0, 0, 4)]).toBe(0); // outside the rect untouched
  });

  it('clampRect intersects with the document', () => {
    expect(clampRect({ x: -5, y: -5, w: 20, h: 20 }, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(clampRect({ x: 20, y: 0, w: 5, h: 5 }, 10, 10).w).toBe(0);
  });

  it('unionRect grows to cover both', () => {
    expect(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 4, y: 4, w: 1, h: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 5,
      h: 5,
    });
    expect(unionRect(null, { x: 3, y: 3, w: 1, h: 1 })).toEqual({ x: 3, y: 3, w: 1, h: 1 });
  });

  it('normalizeRect handles reversed drags', () => {
    expect(normalizeRect({ x: 5, y: 7 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 4, h: 5 });
  });
});
