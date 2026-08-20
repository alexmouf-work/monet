/** Slider + numeric field pair, used by every options panel. */
import { NumBox } from './NumBox';

export function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix,
  disabled,
  emptyValue,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange(v: number): void;
  suffix?: string;
  disabled?: boolean;
  /** What the box becomes when it is left empty. Defaults to `min` (docs/09 §11.1). */
  emptyValue?: number;
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
          aria-label={label}
          onChange={(e) => onChange(clamp(+e.target.value))}
        />
        <NumBox
          className="slider__num"
          value={value}
          min={min}
          max={max}
          step={step}
          emptyValue={emptyValue ?? min}
          disabled={disabled}
          ariaLabel={label}
          onCommit={onChange}
        />
      </div>
    </div>
  );
}
