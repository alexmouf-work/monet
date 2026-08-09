/** Text layout — docs/03 §6.4. Needs measureText, so it lives in engine, not core. */
import type { TextObject } from '../core/model/types';
import { ctx2d, makeCanvas } from './layerCache';

let measureCtx: CanvasRenderingContext2D | null = null;
const measurer = () => (measureCtx ??= ctx2d(makeCanvas(1, 1)));

export const fontString = (t: Pick<TextObject, 'bold' | 'italic' | 'sizePx' | 'fontFamily'>) =>
  `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.sizePx}px "${t.fontFamily}"`;

export const lineHeightOf = (sizePx: number) => Math.ceil(sizePx * 1.25);
/** Fixed ratio, deliberately not fontBoundingBoxAscent — stable across browsers. */
export const ascentOf = (sizePx: number) => Math.round(sizePx * 0.8);

export interface TextLayout {
  lines: string[];
  widths: number[];
  lineHeight: number;
  ascent: number;
  maxWidth: number;
  height: number;
}

export function layoutText(t: TextObject): TextLayout {
  const ctx = measurer();
  ctx.font = fontString(t);
  const lines = t.text.split('\n');
  const widths = lines.map((l) => ctx.measureText(l).width);
  const lineHeight = lineHeightOf(t.sizePx);
  return {
    lines,
    widths,
    lineHeight,
    ascent: ascentOf(t.sizePx),
    maxWidth: Math.max(1, ...widths),
    height: Math.max(lineHeight, lines.length * lineHeight),
  };
}

/** x offset of a line inside the wrap width, per alignment. */
export function alignOffset(align: TextObject['align'], boxW: number, lineW: number): number {
  if (align === 'center') return (boxW - lineW) / 2;
  if (align === 'right') return boxW - lineW;
  return 0;
}
