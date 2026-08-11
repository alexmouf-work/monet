/**
 * Numeric field with arithmetic (docs/11 §10.1): `8+2`, `16/3` — commits on Enter/blur,
 * reverts on parse failure. Shared by the Model and UV panels.
 */
import { useEffect, useState } from 'react';
import { evalExpr } from '../../core/model3d/expr';

export function NumField({
  label,
  value,
  onCommit,
  width = 52,
}: {
  label: string;
  value: number;
  onCommit(v: number): void;
  width?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = evalExpr(text);
    if (v === null) setText(String(value));
    else if (v !== value) onCommit(v);
  };
  return (
    <label className="numfield" title={label}>
      <span>{label}</span>
      <input
        type="text"
        style={{ width }}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}
