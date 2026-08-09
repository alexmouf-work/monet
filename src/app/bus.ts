/** Minimal event bus so stores can nudge the renderer without importing it. */
type Fn = () => void;

const invalidators = new Set<(content: boolean) => void>();
const toasts = new Set<(t: Toast) => void>();

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'error';
}

let toastSeq = 0;

export function onInvalidate(fn: (content: boolean) => void): Fn {
  invalidators.add(fn);
  return () => invalidators.delete(fn);
}

export function invalidate(content = true): void {
  for (const fn of invalidators) fn(content);
}

export function onToast(fn: (t: Toast) => void): Fn {
  toasts.add(fn);
  return () => toasts.delete(fn);
}

export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const t = { id: ++toastSeq, text, kind };
  for (const fn of toasts) fn(t);
}
