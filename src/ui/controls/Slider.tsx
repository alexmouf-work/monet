/** Slider + numeric field pair, used by every options panel. */
export function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix,
  disabled,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange(v: number): void;
  suffix?: string;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="slider">
      <label className="slider__label">
        {label}
        {suffix ? ` (${suffix})` : ''}
      </label>
      <div className="slider__row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clamp(+e.target.value))}
        />
        <input
          className="slider__num"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clamp(+e.target.value))}
        />
      </div>
    </div>
  );
}
