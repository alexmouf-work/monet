/** Swatch + hex field pair; also offers the active colour for one-click reuse. */
import { useEffect, useState } from 'react';
import { parseHexA } from '../../core/color/convert';
import { useToolStore } from '../../app/toolStore';

export function ColorField({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange(hex: string): void;
  disabled?: boolean;
  label?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const active = useToolStore((s) => s.color);

  const commit = () => {
    const parsed = parseHexA(text);
    if (parsed) onChange(parsed.hex);
    else setText(value);
  };

  return (
    <div className="field-row colorfield">
      {label && <span className="field-label">{label}</span>}
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-label={label ?? 'Colour'}
      />
      <input
        className="colorfield__hex"
        type="text"
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <button
        className="iconbtn iconbtn--tiny"
        title={`Use the active colour (${active})`}
        disabled={disabled}
        onClick={() => onChange(active)}
        style={{ background: active }}
      />
    </div>
  );
}
