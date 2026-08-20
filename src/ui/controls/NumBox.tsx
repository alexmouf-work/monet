/**
 * The app's numeric text box — docs/09 §11.1.
 *
 * A bare `<input type="number" value={n} onChange={+e.target.value}>` cannot be emptied:
 * backspacing the last digit yields `''`, `+'' === 0`, and the controlled value snaps
 * straight back, so the digit appears never to delete (owner report 2026-08-11). The fix is
 * local text state — the box holds what you typed, including nothing at all — with the number
 * committed only when the text actually parses.
 *
 * Leaving it empty is therefore allowed while typing, and resolved when you leave: the field
 * falls back to `emptyValue` (the brush size to 1, an opacity to 255) rather than to whatever
 * it happened to say before.
 */
import { useEffect, useRef, useState } from 'react';

const parse = (t: string): number | null => {
  const s = t.trim();
  if (s === '' || s === '-' || s === '+' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function NumBox({
  value,
  onCommit,
  min,
  max,
  step = 1,
  emptyValue,
  disabled,
  className = 'numbox',
  ariaLabel,
  width,
}: {
  value: number;
  onCommit(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  /** What an empty (or unreadable) field becomes on blur. Defaults to `min`, else 0. */
  emptyValue?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  width?: number;
}) {
  const [text, setText] = useState(() => String(value));
  const textRef = useRef(text);
  textRef.current = text;

  // Follow the value when it moves for any other reason — a slider drag, `[`/`]`, a preset.
  // Skip it when the box already says this number, so "007" is not rewritten to "7" under the
  // caret mid-type, and an empty box stays empty until something else actually changes.
  useEffect(() => {
    if (parse(textRef.current) !== value) setText(String(value));
  }, [value]);

  const clamp = (n: number) =>
    Math.max(min ?? -Infinity, Math.min(max ?? Infinity, step === 1 ? Math.round(n) : n));

  const resolve = () => {
    const n = parse(text);
    const v = clamp(n ?? emptyValue ?? min ?? 0);
    setText(String(v));
    if (v !== value) onCommit(v);
  };

  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      style={width ? { width } : undefined}
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (n !== null) onCommit(clamp(n));
      }}
      onBlur={resolve}
      onKeyDown={(e) => {
        if (e.key === 'Enter') resolve();
      }}
    />
  );
}
