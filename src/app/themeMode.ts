/**
 * Theme mode — `system` follows the OS, `light`/`dark` are explicit choices that override it.
 * The choice is stamped on <html data-theme> so the token blocks in theme.css pick it up, and
 * the canvas chrome cache is refreshed so the workspace surround follows along.
 */
import { invalidate } from './bus';
import { refreshThemeColors } from '../engine/themeColors';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export const THEME_LABEL: Record<ThemeMode, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

export const THEME_ICON: Record<ThemeMode, string> = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  refreshThemeColors();
  invalidate(false);
}

/** What the user actually sees right now, resolving `system`. */
export function resolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const nextThemeMode = (mode: ThemeMode): ThemeMode =>
  THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];

/** Keep the canvas in step when the OS flips while we are on `system`. */
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => undefined;
  const onChange = () => {
    if (getMode() === 'system') {
      refreshThemeColors();
      invalidate(false);
    }
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
