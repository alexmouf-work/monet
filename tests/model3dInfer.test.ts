import { describe, expect, it } from 'vitest';
import { vec3, type ModelElement } from '../src/core/model3d/types';
import { boxGaps, inferAxisSnap } from '../src/core/model3d/infer';

const box = (
  id: number,
  from: [number, number, number],
  to: [number, number, number],
  visible = true,
): ModelElement => ({
  id,
  name: `cube ${id}`,
  groupId: null,
  from: vec3(...from),
  to: vec3(...to),
  faces: {},
  visible,
  locked: false,
});

describe('axis inference', () => {
  const dragged = box(1, [10, 0, 2], [14, 4, 6]);
  const target = box(2, [1.7, 0, 2], [5.7, 4, 6]);

  it('snaps my from-face onto their to-face at a fractional coordinate', () => {
    // Perfect alignment needs delta = 5.7 - 10 = -4.3; we are dragging at -4.1.
    const s = inferAxisSnap(dragged, [dragged, target], 'x', -4.1, 0.35);
    expect(s).not.toBeNull();
    expect(s!.delta).toBeCloseTo(-4.3, 10);
    expect(s!.at).toBeCloseTo(5.7, 10);
    expect(s!.kind).toBe('face');
    expect(s!.otherId).toBe(2);
  });

  it('respects the radius — far from any alignment there is no snap', () => {
    expect(inferAxisSnap(dragged, [dragged, target], 'x', -2, 0.35)).toBeNull();
  });

  it('prefers the nearest alignment among candidates', () => {
    // Flush-left (from↔from, delta -8.3) vs touching (from↔to, delta -4.3): drag at -8.2.
    const s = inferAxisSnap(dragged, [dragged, target], 'x', -8.2, 0.35);
    expect(s!.delta).toBeCloseTo(-8.3, 10);
  });

  it('offers centre alignments and ignores self and hidden elements', () => {
    // Centres align when dragged centre (12) reaches their centre (3.7): delta -8.3...
    // use y instead where centres differ from faces: dragged y centre 2, target y centre 2 → 0.
    const sy = inferAxisSnap(dragged, [dragged, target], 'y', 0.1, 0.35);
    expect(sy!.delta).toBe(0);
    const hidden = box(3, [20, 0, 0], [24, 4, 4], false);
    expect(inferAxisSnap(dragged, [dragged, hidden], 'x', 9.9, 0.35)).toBeNull();
    expect(inferAxisSnap(dragged, [dragged], 'x', 0, 99)).toBeNull();
  });
});

describe('box gaps', () => {
  it('reports clear space, touching and overlap per axis', () => {
    const a = box(1, [0, 0, 0], [8, 4, 4]);
    const b = box(2, [10, 0, 2], [14, 4, 6]);
    const g = boxGaps(a, b);
    expect(g.x).toBe(2); // 2-texel gap — the acceptance measurement
    expect(g.y).toBeLessThan(0); // overlapping band
    expect(g.z).toBeLessThan(0);
    expect(boxGaps(a, box(3, [8, 0, 0], [12, 4, 4])).x).toBe(0); // touching
  });
});
