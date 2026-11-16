import React, { useEffect, useMemo, useState } from 'react';

interface NumericCadInputProps {
  value: number;
  onChangeValue: (next: number) => void;
  minValid?: number;
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

export const NumericCadInput: React.FC<NumericCadInputProps> = ({
  value,
  onChangeValue,
  minValid,
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
  const formatVal = (v: number) =>
    Number.isFinite(v) ? String(Number(v.toFixed(4))) : '0';

  const [text, setText] = useState<string>(() => formatVal(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(formatVal(value));
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

  const commitIfValid = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
      return;
    }
    const parsed = integer ? parseInt(trimmed, 10) : Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    if (minValid !== undefined && parsed < minValid) return;
    onChangeValue(parsed);
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
      nextVal = integer ? Math.round(rawPos) : Number(rawPos.toFixed(4));
    }
    if (minValid !== undefined && nextVal < minValid) {
      nextVal = minValid;
    }
    setText(formatVal(nextVal));
    onChangeValue(nextVal);
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="inline-flex items-center border border-slate-700/90 bg-[#050810] rounded-xs focus-within:border-sky-400 transition-colors">
        <input
          type="number"
          step="any"
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
            commitIfValid(next);
          }}
          onBlur={() => {
            setFocused(false);
            const trimmed = text.trim();
            const parsed = integer ? parseInt(trimmed, 10) : Number(trimmed);
            if (
              Number.isFinite(parsed) &&
              (minValid === undefined || parsed >= minValid)
            ) {
              onChangeValue(parsed);
              setText(formatVal(parsed));
            } else {
              setText(formatVal(value));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
          className="cad-num w-full min-w-0 bg-transparent px-1.5 py-0.5 text-[11px] text-slate-100 focus:outline-none text-right"
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
