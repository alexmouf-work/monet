/**
 * Inference and measurement — docs/11 §10.1 items 2 and 6 (M18). Pure maths: the workspace
 * feeds it drags and hovers, the renderer draws what it returns.
 */
import type { Axis, ModelElement } from './types';

export interface AxisSnap {
  /** The drag delta that produces the alignment. */
  delta: number;
  /** The aligned coordinate on the axis — where the inference plane is drawn. */
  at: number;
  kind: 'face' | 'centre';
  otherId: number;
}

/**
 * The best inference alignment for dragging `el` by `delta` along `axis`: my from/to/centre
 * against every other visible element's from/to/centre. Wins over the lattice only within
 * `radius` of an exact alignment, so integer geometry snaps as before and fractional
 * alignments (the face of a 5.7-wide neighbour) become reachable without typing.
 */
export function inferAxisSnap(
  el: ModelElement,
  elements: ModelElement[],
  axis: Axis,
  delta: number,
  radius: number,
): AxisSnap | null {
  const own = [el.from[axis], el.to[axis], (el.from[axis] + el.to[axis]) / 2];
  let best: AxisSnap | null = null;
  let bestErr = radius;
  for (const o of elements) {
    if (o.id === el.id || !o.visible) continue;
    const theirs: [number, AxisSnap['kind']][] = [
      [o.from[axis], 'face'],
      [o.to[axis], 'face'],
      [(o.from[axis] + o.to[axis]) / 2, 'centre'],
    ];
    for (const [t, kind] of theirs)
      for (const mine of own) {
        const cand = t - mine;
        const err = Math.abs(cand - delta);
        if (err <= bestErr) {
          bestErr = err;
          best = { delta: cand, at: t, kind, otherId: o.id };
        }
      }
  }
  return best;
}

/**
 * Axis-aligned clear space between two boxes, per axis: positive = gap, 0 = touching,
 * negative = overlap on that axis. Model units — which are texels at the standard
 * 16-px-per-block density.
 */
export function boxGaps(a: ModelElement, b: ModelElement): Record<Axis, number> {
  const gap = (ax: Axis) => Math.max(b.from[ax] - a.to[ax], a.from[ax] - b.to[ax]);
  return { x: gap('x'), y: gap('y'), z: gap('z') };
}
