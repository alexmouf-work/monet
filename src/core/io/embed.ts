/**
 * Embed mode's pure parts (docs/07 §12): reading `?embed=1&w=&h=` and deciding which origins
 * may host Monet. DOM-free, like the rest of src/core; src/app/embed.ts does the talking.
 */
import { MAX_DIM } from '../model/types';

export interface EmbedParams {
  width: number;
  height: number;
}

/** The postMessage protocol shared with the host (LEMMA's contracts.md §Monet). */
export type EmbedMessage =
  | { type: 'monet:load'; png?: ArrayBuffer; w?: number; h?: number }
  | { type: 'monet:ready' }
  | { type: 'monet:save'; png: ArrayBuffer; w: number; h: number }
  | { type: 'monet:cancel' };

export const EMBED_DEFAULT_SIZE = 1024;

/** A requested side length: whole pixels, 1 to MAX_DIM, else the default. */
export function embedDim(v: string | number | null | undefined): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_DIM) : EMBED_DEFAULT_SIZE;
}

/** The embed parameters in a query string, or null when Monet is not embedded. */
export function parseEmbed(search: string): EmbedParams | null {
  const q = new URLSearchParams(search);
  if (q.get('embed') !== '1') return null;
  return { width: embedDim(q.get('w')), height: embedDim(q.get('h')) };
}

/** Origins allowed to host Monet: the configured list if any, else the framing page's origin. */
export function hostOrigins(configured: string | undefined, referrer: string): string[] {
  const list = (configured ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (list.length) return list;
  try {
    return referrer ? [new URL(referrer).origin] : [];
  } catch {
    return [];
  }
}
