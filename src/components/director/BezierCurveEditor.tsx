import React, { useRef, useState } from 'react';
import { CubicBezier4, EASING_PRESETS, evaluateCubicBezierEasing } from '../../engine/director';

interface BezierCurveEditorProps {
  value: CubicBezier4;
  disabled?: boolean;
  onChange: (next: CubicBezier4) => void;
}

const SVG_W = 220;
const SVG_H = 156;
const PAD_X = 22;
const PAD_TOP = 26;
const PAD_BOTTOM = 22;
const PLOT_W = SVG_W - PAD_X * 2;
const PLOT_H = SVG_H - PAD_TOP - PAD_BOTTOM;

// Plot Y domain [-0.35, 1.35] so overshoot curves stay cleanly visible inside frame
const Y_MIN = -0.35;
const Y_MAX = 1.35;

function toSvgX(x: number): number {
  return PAD_X + x * PLOT_W;
}

function toSvgY(y: number): number {
  const norm = (y - Y_MIN) / (Y_MAX - Y_MIN);
  return PAD_TOP + (1 - norm) * PLOT_H;
}

function fromSvgX(sx: number): number {
  return Math.max(0, Math.min(1, (sx - PAD_X) / PLOT_W));
}

function fromSvgY(sy: number): number {
  const norm = 1 - (sy - PAD_TOP) / PLOT_H;
  return Math.max(-0.35, Math.min(1.45, Y_MIN + norm * (Y_MAX - Y_MIN)));
}

export const BezierCurveEditor: React.FC<BezierCurveEditorProps> = ({
  value,
  disabled,
  onChange,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'cp1' | 'cp2' | null>(null);

  const [x1, y1, x2, y2] = value;

  const updateFromPointer = (clientX: number, clientY: number, handle: 'cp1' | 'cp2') => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const sx = ((clientX - rect.left) / rect.width) * SVG_W;
    const sy = ((clientY - rect.top) / rect.height) * SVG_H;
    const nx = Number(fromSvgX(sx).toFixed(3));
    const ny = Number(fromSvgY(sy).toFixed(3));
    if (handle === 'cp1') {
      onChange([nx, ny, x2, y2]);
    } else {
      onChange([x1, y1, nx, ny]);
    }
  };

  // Sample exact solved easing curve for visual accuracy including overshoot
  const curvePath = (() => {
    const pts: string[] = [];
    const samples = 44;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const y = evaluateCubicBezierEasing(value, t);
      pts.push(`${i === 0 ? 'M' : 'L'} ${toSvgX(t).toFixed(1)} ${toSvgY(y).toFixed(1)}`);
    }
    return pts.join(' ');
  })();

  const p0x = toSvgX(0);
  const p0y = toSvgY(0);
  const p3x = toSvgX(1);
  const p3y = toSvgY(1);
  const c1x = toSvgX(x1);
  const c1y = toSvgY(y1);
  const c2x = toSvgX(x2);
  const c2y = toSvgY(y2);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-200 font-medium">缓动贝塞尔曲线 (Cubic-Bezier)</span>
        <span className="font-mono-tabular text-[10px] text-cyan-300">
          ({x1.toFixed(2)}, {y1.toFixed(2)}, {x2.toFixed(2)}, {y2.toFixed(2)})
        </span>
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap gap-1">
        {EASING_PRESETS.map((preset) => {
          const isMatch =
            Math.abs(preset.bezier[0] - x1) < 0.02 &&
            Math.abs(preset.bezier[1] - y1) < 0.02 &&
            Math.abs(preset.bezier[2] - x2) < 0.02 &&
            Math.abs(preset.bezier[3] - y2) < 0.02;
          return (
            <button
              key={preset.id}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => onChange([...preset.bezier])}
              className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap transition-colors ${
                isMatch
                  ? 'border-cyan-400 bg-cyan-950/60 text-white'
                  : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Interactive SVG Curve Graph */}
      <div className="rounded-xs border border-slate-800 bg-[#060912] p-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-36 select-none touch-none"
          onPointerMove={(e) => {
            if (!draggingHandle || disabled) return;
            updateFromPointer(e.clientX, e.clientY, draggingHandle);
          }}
          onPointerUp={() => setDraggingHandle(null)}
          onPointerCancel={() => setDraggingHandle(null)}
        >
          {/* Unit [0,1]x[0,1] bounding box */}
          <rect
            x={p0x}
            y={p3y}
            width={PLOT_W}
            height={p0y - p3y}
            fill="rgba(15, 23, 42, 0.45)"
            stroke="rgba(100, 116, 139, 0.35)"
            strokeWidth={1}
          />

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((g) => (
            <g key={g}>
              <line
                x1={toSvgX(g)}
                y1={p3y}
                x2={toSvgX(g)}
                y2={p0y}
                stroke="rgba(71, 85, 105, 0.28)"
                strokeDasharray="2 2"
              />
              <line
                x1={p0x}
                y1={toSvgY(g)}
                x2={p3x}
                y2={toSvgY(g)}
                stroke="rgba(71, 85, 105, 0.28)"
                strokeDasharray="2 2"
              />
            </g>
          ))}

          {/* Linear diagonal reference */}
          <line
            x1={p0x}
            y1={p0y}
            x2={p3x}
            y2={p3y}
            stroke="rgba(148, 163, 184, 0.25)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />

          {/* Handle stems */}
          <line x1={p0x} y1={p0y} x2={c1x} y2={c1y} stroke="#22d3ee" strokeWidth={1.2} strokeOpacity={0.75} />
          <line x1={p3x} y1={p3y} x2={c2x} y2={c2y} stroke="#f59e0b" strokeWidth={1.2} strokeOpacity={0.75} />

          {/* Easing curve */}
          <path d={curvePath} fill="none" stroke="#e2e8f0" strokeWidth={2} strokeLinecap="round" />

          {/* Fixed endpoints */}
          <circle cx={p0x} cy={p0y} r={3} fill="#94a3b8" />
          <circle cx={p3x} cy={p3y} r={3} fill="#94a3b8" />

          {/* Draggable CP1 */}
          <circle
            cx={c1x}
            cy={c1y}
            r={6}
            fill="#06b6d4"
            stroke="#05070d"
            strokeWidth={1.5}
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => {
              if (disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDraggingHandle('cp1');
              updateFromPointer(e.clientX, e.clientY, 'cp1');
            }}
          />

          {/* Draggable CP2 */}
          <circle
            cx={c2x}
            cy={c2y}
            r={6}
            fill="#f59e0b"
            stroke="#05070d"
            strokeWidth={1.5}
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => {
              if (disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDraggingHandle('cp2');
              updateFromPointer(e.clientX, e.clientY, 'cp2');
            }}
          />
        </svg>
      </div>

      {/* Fine Numeric Inputs */}
      <div className="grid grid-cols-4 gap-1 text-[10px]">
        {(
          [
            ['X1', x1, 0, 1, 0],
            ['Y1', y1, -0.35, 1.45, 1],
            ['X2', x2, 0, 1, 2],
            ['Y2', y2, -0.35, 1.45, 3],
          ] as const
        ).map(([lbl, val, min, max, idx]) => (
          <label key={lbl} className="block space-y-0.5">
            <span className="text-slate-400">{lbl}</span>
            <input
              type="number"
              min={min}
              max={max}
              step={0.02}
              disabled={disabled}
              value={Number(val.toFixed(2))}
              onChange={(e) => {
                const v = Math.max(min, Math.min(max, Number(e.target.value) || 0));
                const next: CubicBezier4 = [...value];
                next[idx] = v;
                onChange(next);
              }}
              className="cad-num w-full h-6 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-slate-100 text-[10px]"
            />
          </label>
        ))}
      </div>
    </div>
  );
};
