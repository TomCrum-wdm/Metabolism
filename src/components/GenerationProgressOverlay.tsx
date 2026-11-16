import React from 'react';
import { GenerationProgress } from '../engine/webgpuScene';

interface GenerationProgressOverlayProps {
  progress: GenerationProgress | null;
  onCancel?: () => void;
}

const STAGES = [
  { threshold: 4, label: '体素密度场' },
  { threshold: 44, label: '分块等值面' },
  { threshold: 74, label: 'SPH 流体' },
  { threshold: 94, label: '高精度流式块' },
];

export const GenerationProgressOverlay: React.FC<GenerationProgressOverlayProps> = ({
  progress,
  onCancel,
}) => {
  if (!progress || !progress.active) return null;

  const pct = Math.max(0, Math.min(100, progress.percent));

  return (
    <div
      data-testid="generation-progress-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050810]/85 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-md rounded-sm border border-slate-700/90 bg-[#090d18] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <svg
              viewBox="0 0 36 36"
              className="w-9 h-9 shrink-0 animate-spin"
              style={{ animationDuration: '5s' }}
              aria-hidden="true"
            >
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke="#1e293b"
                strokeWidth="2.2"
              />
              <path
                d="M18 4 A14 14 0 0 1 32 18"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <circle cx="18" cy="18" r="5" fill="#0ea5e9" opacity="0.35" />
            </svg>
            <div className="min-w-0">
              <div className="font-display text-sm font-bold text-white tracking-wide">
                正在异步构建星球世界
              </div>
              <div className="font-mono-tabular text-[11px] text-slate-400 truncate mt-0.5">
                #{progress.seed} · R₀={progress.radius}m · 分辨率={progress.voxelRadius.toLocaleString()}块
              </div>
            </div>
          </div>

          <div
            data-testid="generation-progress-percent"
            className="font-mono-tabular text-xl font-bold text-sky-400 shrink-0"
          >
            {pct}%
          </div>
        </div>

        {/* Progress Bar */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          data-testid="generation-progress-bar"
          className="h-2.5 w-full rounded-xs bg-[#050810] border border-slate-800 overflow-hidden mb-3"
        >
          <div
            className="h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Stage Step Indicators */}
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {STAGES.map((st) => {
            const reached = pct >= st.threshold;
            return (
              <div
                key={st.label}
                className={`px-1.5 py-1 rounded-xs border text-center text-[10px] font-mono-tabular transition-colors ${
                  reached
                    ? 'border-sky-500/60 bg-sky-950/50 text-sky-200'
                    : 'border-slate-800 bg-[#050810] text-slate-500'
                }`}
              >
                {st.label}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/90">
          <div className="min-w-0">
            <div
              data-testid="generation-progress-stage"
              className="text-xs font-medium text-slate-100 truncate"
            >
              {progress.stage}
            </div>
            <div className="text-[11px] font-mono-tabular text-slate-400 truncate">
              {progress.detail}
            </div>
          </div>

          {onCancel && (
            <button
              type="button"
              data-testid="generation-cancel-btn"
              onClick={onCancel}
              className="h-7 px-2.5 rounded-xs border border-slate-700 hover:border-rose-500/70 text-[11px] text-slate-300 hover:text-rose-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
