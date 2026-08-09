/** The MS-Paint 20 palette, in fixed order — docs/09 §5. */
import type { Hex } from '../model/types';

export const PAINT_PALETTE: Hex[] = [
  '#000000',
  '#7F7F7F',
  '#880015',
  '#ED1C24',
  '#FF7F27',
  '#FFF200',
  '#22B14C',
  '#00A2E8',
  '#3F48CC',
  '#A349A4',
  '#FFFFFF',
  '#C3C3C3',
  '#B97A57',
  '#FFAEC9',
  '#FFC90E',
  '#EFE4B0',
  '#B5E61D',
  '#99D9EA',
  '#7092BE',
  '#C8BFE7',
];

export const RECENTS_MAX = 12;

export function pushRecent(recents: Hex[], hex: Hex): Hex[] {
  const next = [hex, ...recents.filter((h) => h.toUpperCase() !== hex.toUpperCase())];
  return next.slice(0, RECENTS_MAX);
}
