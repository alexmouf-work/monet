/**
 * Canvas-drawn chrome that has to follow the UI theme. The renderer cannot use CSS variables,
 * so it reads them once and caches; `refreshThemeColors()` is called when the theme changes.
 */
export interface ThemeColors {
  surround: string;
  accent: string;
}

const FALLBACK: ThemeColors = { surround: '#3d3d40', accent: '#3fa7d6' };

let cache: ThemeColors | null = null;

function read(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function themeColors(): ThemeColors {
  if (cache) return cache;
  try {
    cache = {
      surround: read('--surround', FALLBACK.surround),
      accent: read('--accent', FALLBACK.accent),
    };
  } catch {
    cache = { ...FALLBACK };
  }
  return cache;
}

export function refreshThemeColors(): void {
  cache = null;
}
