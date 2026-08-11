import { describe, expect, it } from 'vitest';
import { vec3, type ModelElement } from '../src/core/model3d/types';
import {
  boxUV,
  cycleRotation,
  fitUV,
  mirrorUVu,
  mirrorUVv,
  uvTexelRect,
} from '../src/core/model3d/uv';
import { stToUV } from '../src/core/model3d/geometry';

const el = (from = vec3(0, 0, 0), to = vec3(16, 16, 16)): ModelElement => ({
  id: 1,
  name: 'cube',
  groupId: null,
  from,
  to,
  faces: {},
  visible: true,
  locked: false,
});

describe('box UV', () => {
  it('unwraps a full cube onto a 64×32 sheet at the classic cross positions', () => {
    const uv = boxUV(el(), 64, 32);
    // 16-texel faces; one x texel = 16/64 = 0.25 units, one y texel = 16/32 = 0.5 units.
    expect(uv.up).toEqual([4, 0, 8, 8]);
    expect(uv.down).toEqual([8, 0, 12, 8]);
    expect(uv.east).toEqual([0, 8, 4, 16]);
    expect(uv.north).toEqual([4, 8, 8, 16]);
    expect(uv.west).toEqual([8, 8, 12, 16]);
    expect(uv.south).toEqual([12, 8, 16, 16]);
  });

  it('sizes rects from element dimensions and offsets by the texel origin', () => {
    // w=4, h=7, d=2 on a 32×32 sheet (1 texel = 0.5 units), origin (2, 1).
    const uv = boxUV(el(vec3(6, 0, 6), vec3(10, 7, 8)), 32, 32, 2, 1);
    expect(uv.up).toEqual([2, 0.5, 4, 1.5]); // x: 2+2=4..8 texels, y: 1..3
    expect(uv.east).toEqual([1, 1.5, 2, 5]); // x: 2..4, y: 3..10
    expect(uv.north).toEqual([2, 1.5, 4, 5]); // x: 4..8
    expect(uv.south).toEqual([5, 1.5, 7, 5]); // x: 10..14
  });
});

describe('uv transforms', () => {
  it('mirrors by swapping endpoints; twice is identity', () => {
    expect(mirrorUVu([1, 2, 3, 4])).toEqual([3, 2, 1, 4]);
    expect(mirrorUVv([1, 2, 3, 4])).toEqual([1, 4, 3, 2]);
    expect(mirrorUVu(mirrorUVu([1, 2, 3, 4]))).toEqual([1, 2, 3, 4]);
  });

  it('a mirrored rect samples flipped — stToUV interpolates the endpoints', () => {
    // Top-left of the face (s=0,t=0) samples the RIGHT edge of a u-mirrored full rect.
    expect(stToUV(mirrorUVu([0, 0, 16, 16]), 0, 0, 0)).toEqual({ u: 1, v: 0 });
    expect(stToUV(mirrorUVu([0, 0, 16, 16]), 0, 1, 0)).toEqual({ u: 0, v: 0 });
  });

  it('cycles rotation through the four steps', () => {
    expect(cycleRotation(undefined)).toBe(90);
    expect(cycleRotation(90)).toBe(180);
    expect(cycleRotation(270)).toBe(0);
  });

  it('fit-to-face is the vanilla projection', () => {
    const box = el(vec3(2, 0, 4), vec3(14, 8, 12));
    expect(fitUV('south', box)).toEqual([2, 8, 14, 16]);
    expect(fitUV('up', box)).toEqual([2, 4, 14, 12]);
    expect(fitUV('north', box)).toEqual([2, 8, 14, 16]);
  });

  it('uvTexelRect converts units to sheet texels, negative when mirrored', () => {
    expect(uvTexelRect([4, 8, 8, 16], 64, 32)).toEqual({ x: 16, y: 16, w: 16, h: 16 });
    expect(uvTexelRect(mirrorUVu([4, 8, 8, 16]), 64, 32)).toEqual({
      x: 32,
      y: 16,
      w: -16,
      h: 16,
    });
  });
});
