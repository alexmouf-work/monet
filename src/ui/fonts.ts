/**
 * Bundled text fonts — docs/03 §6.2.
 *
 * The spec named Monocraft as the default Minecraft-style face, but it is not published on
 * npm and this build environment cannot fetch font binaries from GitHub, so the three
 * vendored faces are OFL pixel fonts available as packages. **Silkscreen** is the default:
 * of the three it is closest to Minecraft's proportional pixel font and stays legible at
 * 8px. Dropping Monocraft in later only needs a new @font-face plus an entry here.
 */
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';

export interface FontChoice {
  family: string;
  label: string;
  pixel: boolean;
}

export const FONTS: FontChoice[] = [
  { family: 'Silkscreen', label: 'Silkscreen (pixel)', pixel: true },
  { family: 'Press Start 2P', label: 'Press Start 2P (pixel)', pixel: true },
  { family: 'VT323', label: 'VT323 (pixel)', pixel: true },
  { family: 'sans-serif', label: 'Sans-serif', pixel: false },
  { family: 'serif', label: 'Serif', pixel: false },
  { family: 'monospace', label: 'Monospace', pixel: false },
];

export const DEFAULT_FONT = 'Silkscreen';

/** Ensure a family's glyphs are loaded before the first canvas render that uses it. */
export async function ensureFont(family: string, sizePx = 16): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await document.fonts.load(`${sizePx}px "${family}"`);
  } catch {
    // A missing family simply falls back; nothing to recover from.
  }
}

export const loadAllFonts = () =>
  Promise.all(FONTS.filter((f) => f.pixel).map((f) => ensureFont(f.family)));

/** Chromium-only: offer the user's installed families (docs/03 §6.2, stretch). */
export function hasLocalFonts(): boolean {
  return typeof (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === 'function';
}

export async function queryLocalFamilies(): Promise<string[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> })
    .queryLocalFonts;
  if (!q) return [];
  try {
    const list = await q();
    return [...new Set(list.map((f) => f.family))].sort();
  } catch {
    return [];
  }
}
