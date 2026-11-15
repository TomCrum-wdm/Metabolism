import React, { useEffect, useState } from 'react';

interface NumericCadInputProps {
  value: number;
  onChangeValue: (next: number) => void;
  minValid?: number;
  integer?: boolean;
  unit?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
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

  return (
    <div
      className={`inline-flex items-center border border-slate-700/90 bg-[#050810] rounded-xs focus-within:border-sky-400 transition-colors ${className}`}
    >
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
  );
};
