import React, { useEffect, useMemo, useState } from 'react';

interface NumericCadInputProps {
  value: number;
  onChangeValue: (next: number) => void;
  minValid?: number;
  maxValid?: number;
  integer?: boolean;
  unit?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
  slider?: boolean;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  sliderScale?: 'linear' | 'log';
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function formatCadNumber(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs < 1e-4 || abs >= 1e7) {
    return v
      .toExponential(3)
      .replace(/(\.\d*?[1-9])0+e/, '$1e')
      .replace(/\.0+e/, 'e')
      .replace('e+', 'e');
  }
  return String(Number(v.toPrecision(6)));
}

export const NumericCadInput: React.FC<NumericCadInputProps> = ({
  value,
  onChangeValue,
  minValid,
  maxValid,
  integer = false,
  unit,
  ariaLabel,
  testId,
  className = '',
  slider = true,
  sliderMin,
  sliderMax,
  sliderStep,
  sliderScale = 'linear',
}) => {
  const [text, setText] = useState<string>(() => formatCadNumber(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(formatCadNumber(value));
    }
  }, [value, focused]);

  const { effMin, effMax, effStep, isLog } = useMemo(() => {
    const absV = Math.abs(value);
    const defaultMin =
      minValid !== undefined
        ? minValid
        : value < 0
          ? -Math.max(10, absV * 2)
          : 0;
    const min = sliderMin ?? defaultMin;
    const max =
      sliderMax ??
      (min >= 0
        ? Math.max(min + (integer ? 20 : 2), absV > 0 ? absV * 2.5 : 10)
        : Math.max(10, absV * 2));
    const safeMax = max > min ? max : min + (integer ? 10 : 1);
    const step =
      sliderStep ?? (integer ? 1 : Number(((safeMax - min) / 100).toPrecision(2)));
    const canLog = sliderScale === 'log' && min > 0 && safeMax > min;
    return { effMin: min, effMax: safeMax, effStep: step, isLog: canLog };
  }, [integer, minValid, sliderMax, sliderMin, sliderScale, sliderStep, value]);

  const sliderPos = useMemo(() => {
    if (!isLog) {
      return clamp(value, effMin, effMax);
    }
    const safeV = clamp(value, effMin, effMax);
    const logMin = Math.log(effMin);
    const logMax = Math.log(effMax);
    return ((Math.log(safeV) - logMin) / (logMax - logMin || 1)) * 1000;
  }, [effMax, effMin, isLog, value]);

  const parseAndValidate = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (
      trimmed === '' ||
      trimmed === '-' ||
      trimmed === '.' ||
      trimmed === '-.' ||
      /[eE][+-]?$/.test(trimmed)
    ) {
      return null;
    }
    const parsed = integer ? parseInt(trimmed, 10) : Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    if (minValid !== undefined && parsed < minValid) return null;
    if (maxValid !== undefined && parsed > maxValid) return null;
    return parsed;
  };

  const handleSliderChange = (rawPos: number) => {
    let nextVal: number;
    if (isLog) {
      const logMin = Math.log(effMin);
      const logMax = Math.log(effMax);
      const t = clamp(rawPos / 1000, 0, 1);
      const raw = Math.exp(logMin + t * (logMax - logMin));
      nextVal = integer ? Math.round(raw) : Number(raw.toPrecision(3));
    } else {
      nextVal = integer ? Math.round(rawPos) : Number(rawPos.toPrecision(5));
    }
    if (minValid !== undefined && nextVal < minValid) {
      nextVal = minValid;
    }
    if (maxValid !== undefined && nextVal > maxValid) {
      nextVal = maxValid;
    }
    setText(formatCadNumber(nextVal));
    onChangeValue(nextVal);
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="inline-flex items-center border border-slate-700/90 bg-[#050810] rounded-xs focus-within:border-sky-400 transition-colors">
        <input
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel}
          data-testid={testId}
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const parsed = parseAndValidate(next);
            if (parsed !== null) {
              onChangeValue(parsed);
            }
          }}
          onBlur={() => {
            setFocused(false);
            const parsed = parseAndValidate(text);
            if (parsed !== null) {
              onChangeValue(parsed);
              setText(formatCadNumber(parsed));
            } else {
              setText(formatCadNumber(value));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const dir = e.key === 'ArrowUp' ? 1 : -1;
              const next = isLog
                ? value * (dir > 0 ? 1.25 : 0.8)
                : value + effStep * dir;
              const clampedMin = minValid !== undefined ? Math.max(minValid, next) : next;
              const finalV = maxValid !== undefined ? Math.min(maxValid, clampedMin) : clampedMin;
              if (Number.isFinite(finalV)) {
                setText(formatCadNumber(finalV));
                onChangeValue(finalV);
              }
            }
          }}
          className="cad-num w-full min-w-0 bg-transparent px-1.5 py-0.5 text-[11px] font-mono-tabular text-slate-100 focus:outline-none text-right"
        />
        {unit && (
          <span className="pr-1.5 text-[10px] font-mono-tabular text-slate-400 select-none shrink-0">
            {unit}
          </span>
        )}
      </div>

      {slider && (
        <input
          type="range"
          tabIndex={-1}
          aria-label={ariaLabel ? `${ariaLabel}滑块` : undefined}
          data-testid={testId ? `${testId}-slider` : undefined}
          min={isLog ? 0 : effMin}
          max={isLog ? 1000 : effMax}
          step={isLog ? 1 : effStep}
          value={sliderPos}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          className="studio-slider w-full"
        />
      )}
    </div>
  );
};
