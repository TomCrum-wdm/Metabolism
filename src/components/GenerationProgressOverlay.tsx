import React from 'react';
import { GenerationProgress } from '../engine/webgpuScene';

interface GenerationProgressOverlayProps {
  progress: GenerationProgress | null;
  onCancel?: () => void;
}

const STAGES = [
  { idx: 0, threshold: 4, label: '核心吸积 · 密度场' },
  { idx: 1, threshold: 44, label: '分块等值面构筑' },
  { idx: 2, threshold: 74, label: 'SPH 液态海洋注入' },
  { idx: 3, threshold: 92, label: '流式细化与大气揭幕' },
];

export const GenerationProgressOverlay: React.FC<GenerationProgressOverlayProps> = ({
  progress,
  onCancel,
}) => {
  if (!progress || !progress.active) return null;

  const pct = Math.max(0, Math.min(100, progress.percent));
  const phaseIdx =
    progress.phaseIndex ??
    (pct >= 92 ? 3 : pct >= 74 ? 2 : pct >= 44 ? 1 : 0);

  return (
    <div
      data-testid="generation-progress-overlay"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto w-full max-w-2xl rounded-sm border border-slate-700/90 bg-[#090d18]/94 p-3.5 shadow-2xl">
        <div className="flex items-center gap-3.5">
          {/* Interactive 4-Stage Planetary Cross-Section Schematic SVG */}
          <div className="w-16 h-16 shrink-0 rounded-xs border border-slate-800 bg-[#050810] flex items-center justify-center relative overflow-hidden">
            <svg viewBox="0 0 64 64" className="w-14 h-14" aria-hidden="true">
              {/* Outer Atmosphere Halo (Stage 3) */}
              <circle
                cx="32"
                cy="32"
                r="27"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity={phaseIdx >= 3 ? 0.95 : 0.22}
              />
              {/* Wireframe Cage (Stage 0) */}
              <circle
                cx="32"
                cy="32"
                r="22"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="0.9"
                opacity={0.45}
              />
              <ellipse
                cx="32"
                cy="32"
                rx="22"
                ry="8"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="0.8"
                opacity={0.4}
              />
              <ellipse
                cx="32"
                cy="32"
                rx="8"
                ry="22"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="0.8"
                opacity={0.4}
              />
              {/* Crust Chunk Shell (Stage 1) */}
              <circle
                cx="32"
                cy="32"
                r="20"
                fill="#1e293b"
                stroke="#64748b"
                strokeWidth="1.6"
                opacity={phaseIdx >= 1 ? 0.92 : 0.18}
              />
              {/* Hydrosphere Crater Ocean Fill (Stage 2) */}
              <path
                d="M15 35 A18 18 0 0 0 49 35 Q40 31 32 34 T15 35 Z"
                fill="#0284c7"
                opacity={phaseIdx >= 2 ? 0.88 : 0.12}
              />
              {/* Glowing Molten Core (Stage 0+) */}
              <circle
                cx="32"
                cy="32"
                r={phaseIdx === 0 ? 11 : 7}
                fill="#f97316"
                opacity={0.9}
              />
              <circle cx="32" cy="32" r="4" fill="#fde047" />
              {/* Progress Ring Arc */}
              <circle
                cx="32"
                cy="32"
                r="29"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeDasharray={`${Math.round((pct / 100) * 182.2)} 183`}
                transform="rotate(-90 32 32)"
              />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <div className="min-w-0">
                <div className="font-display text-xs font-bold text-white tracking-wide flex items-center gap-2">
                  <span>实时三维行星吸积构建</span>
                  <span className="font-mono-tabular text-[10px] font-normal text-slate-400 truncate">
                    #{progress.seed} · R₀={progress.radius}m · {progress.voxelRadius.toLocaleString()}块
                  </span>
                </div>
                <div
                  data-testid="generation-progress-stage"
                  className="text-[11px] text-cyan-300 font-medium truncate mt-0.5"
                >
                  {progress.stage}
                </div>
              </div>

              <div
                data-testid="generation-progress-percent"
                className="font-mono-tabular text-lg font-bold text-sky-400 shrink-0"
              >
                {pct}%
              </div>
            </div>

            {/* Linear Progress Bar */}
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              data-testid="generation-progress-bar"
              className="h-2 w-full rounded-xs bg-[#050810] border border-slate-800 overflow-hidden mb-2"
            >
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-sky-400 to-emerald-400 transition-[width] duration-150 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* 4-Stage Pipeline Row */}
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {STAGES.map((st) => {
                const active = phaseIdx === st.idx;
                const reached = phaseIdx > st.idx || pct >= st.threshold;
                return (
                  <div
                    key={st.label}
                    className={`px-1.5 py-0.5 rounded-xs border text-center text-[10px] font-mono-tabular truncate ${
                      active
                        ? 'border-cyan-400 bg-cyan-950/70 text-white font-semibold'
                        : reached
                          ? 'border-sky-500/50 bg-sky-950/35 text-sky-200'
                          : 'border-slate-800 bg-[#050810] text-slate-500'
                    }`}
                  >
                    {st.label}
                  </div>
                );
              })}
            </div>

            {/* Live Structural Counters & Cancel */}
            <div className="flex items-center justify-between gap-2 text-[10px] font-mono-tabular text-slate-400">
              <div className="flex items-center gap-3 min-w-0 truncate">
                <span className="truncate">{progress.detail}</span>
                {progress.totalChunks !== undefined && (
                  <span className="text-slate-300 shrink-0">
                    区块 {progress.builtChunks ?? 0}/{progress.totalChunks}
                  </span>
                )}
                {progress.terrainVertices !== undefined && progress.terrainVertices > 0 && (
                  <span className="text-emerald-300 shrink-0">
                    顶点 {progress.terrainVertices.toLocaleString()}
                  </span>
                )}
                {progress.waterParticles !== undefined && progress.waterParticles > 0 && (
                  <span className="text-sky-300 shrink-0">
                    水体 {progress.waterParticles.toLocaleString()}
                  </span>
                )}
              </div>

              {onCancel && (
                <button
                  type="button"
                  data-testid="generation-cancel-btn"
                  onClick={onCancel}
                  className="h-6 px-2.5 rounded-xs border border-slate-700 hover:border-rose-500/70 text-[10px] text-slate-300 hover:text-rose-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  取消构建
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
