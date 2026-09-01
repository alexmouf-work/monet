/**
 * Where the noise field is sampled from — docs/04 §7 (owner request 2026-08-11).
 *
 * A leaf module rather than panel state, because two things write it: the Noise panel's X/Y
 * boxes and `tools/noisePanTool.ts`, which drags it on the canvas. One home means they cannot
 * disagree, and it keeps the tool from importing the panel (which would be a cycle).
 */
export interface NoiseOffset {
  x: number;
  y: number;
}

let offset: NoiseOffset = { x: 0, y: 0 };
const listeners = new Set<() => void>();

export const noiseOffset = (): NoiseOffset => offset;

export function setNoiseOffset(x: number, y: number): void {
  if (x === offset.x && y === offset.y) return;
  offset = { x: Math.round(x), y: Math.round(y) };
  for (const fn of listeners) fn();
}

export function subscribeNoiseOffset(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
