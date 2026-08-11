/**
 * Vanilla legality — docs/11 §13.2. Free-form editing can produce models Minecraft silently
 * refuses; these checks run continuously and either snap (vanillaMode) or flag.
 */
import type { ModelElement } from './types';

export const LEGAL_ANGLES = [-45, -22.5, 0, 22.5, 45] as const;

export const snapLegalAngle = (angle: number): number =>
  LEGAL_ANGLES.reduce((best, a) => (Math.abs(a - angle) < Math.abs(best - angle) ? a : best), 0);

export interface ElementIssue {
  elementId: number;
  message: string;
}

/** Everything vanilla would reject or render oddly, as human-readable flags. */
export function validateElement(el: ModelElement): ElementIssue[] {
  const issues: ElementIssue[] = [];
  const flag = (message: string) => issues.push({ elementId: el.id, message });

  for (const axis of ['x', 'y', 'z'] as const) {
    for (const end of [el.from, el.to]) {
      if (end[axis] < -16 || end[axis] > 32) {
        flag(`${axis} = ${end[axis]} is outside vanilla's -16..32`);
        break;
      }
    }
    if (el.to[axis] < el.from[axis]) flag(`${axis}: to < from`);
  }

  const rot = el.rotation;
  if (rot && !LEGAL_ANGLES.includes(rot.angle as (typeof LEGAL_ANGLES)[number])) {
    flag(`rotation ${rot.angle}° is not one of ±45, ±22.5, 0`);
  }

  for (const [face, f] of Object.entries(el.faces)) {
    if (!f) continue;
    if (f.uv.some((v) => v < 0 || v > 16)) flag(`${face} uv outside 0..16`);
  }

  return issues;
}

export const validateModel = (elements: ModelElement[]): ElementIssue[] =>
  elements.flatMap(validateElement);
