import React from 'react';
import { ExternalLink } from 'lucide-react';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';

interface TitleOverlayProps {
  hasSavedWorld: boolean;
  savedWorldLabel?: string;
  newTabUrl: string;
  onStart: () => void;
  onContinueSaved: () => void;
  onOpenSeedModal: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  hasSavedWorld,
  savedWorldLabel,
  newTabUrl,
  onStart,
  onContinueSaved,
  onOpenSeedModal,
}) => {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-5 md:p-10">
      {/* Subtle radial contrast scrim preserving live orbiting planet */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 72% 48%, rgba(5, 8, 16, 0.05) 0%, rgba(5, 8, 16, 0.72) 68%, rgba(5, 8, 16, 0.92) 100%)',
        }}
      />

      {/* Top Engineering Strip: PWA Install & Offline Status */}
      <div className="relative z-10 flex items-center justify-end gap-2 pointer-events-auto">
        <OfflineIndicator />
        <PWAInstallButton />
        <a
          href={newTabUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded-sm border border-slate-700/90 bg-[#090d18]/90 hover:border-sky-400/80 text-xs font-medium text-slate-200 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap"
        >
          <ExternalLink className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>新标签页打开</span>
        </a>
      </div>

      {/* Main Workstation Launch Block */}
      <div className="relative z-10 max-w-xl my-auto pointer-events-auto">
        <div className="flex items-center gap-4 mb-4">
          <svg
            viewBox="0 0 56 56"
            className="w-11 h-11 shrink-0"
            aria-hidden="true"
          >
            <circle
              cx="28"
              cy="28"
              r="18"
              fill="#0c192c"
              stroke="#38bdf8"
              strokeWidth="2"
            />
            <path
              d="M12 24 C19 18, 28 21, 35 16 C40 13, 44 17, 45 22"
              fill="none"
              stroke="#34d399"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="M13 33 C20 37, 30 35, 39 39"
              fill="none"
              stroke="#22d3ee"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <ellipse
              cx="28"
              cy="28"
              rx="25"
              ry="8"
              transform="rotate(-22 28 28)"
              fill="none"
              stroke="#f97316"
              strokeWidth="1.6"
              strokeDasharray="4 3"
            />
            <circle cx="46" cy="18" r="2.6" fill="#fbbf24" />
          </svg>
          <div>
            <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight text-white">
              TerraSphere
            </h1>
            <p className="text-xs md:text-sm text-sky-300/90 mt-0.5 tracking-wide font-mono-tabular">
              星球体素工程沙盒 · 等值面地形与流体物理引擎
            </p>
          </div>
        </div>

        <p className="text-slate-300 text-sm md:text-base leading-relaxed max-w-md mb-6">
          基于 Marching Cubes 分块 LOD 等值面、无限制自由尺度参数、牛顿径向引力与 SPH
          物理流体模拟。支持离线 PWA 保存、触屏虚拟摇杆与独立标签页运行。
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStart();
            }}
            className="px-6 py-3 rounded-sm bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-slate-950 font-display font-semibold text-sm md:text-base tracking-wide transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            降落星球并开始创造
          </button>

          {hasSavedWorld && (
            <button
              type="button"
              data-testid="continue-saved-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                onContinueSaved();
              }}
              className="px-4 py-3 rounded-sm border border-emerald-400/70 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-200 font-display font-semibold text-sm transition-colors cursor-pointer"
            >
              继续存档{savedWorldLabel ? ` (${savedWorldLabel})` : ''}
            </button>
          )}

          <button
            type="button"
            data-testid="title-seed-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenSeedModal();
            }}
            className="px-4 py-3 rounded-sm border border-slate-700 hover:border-slate-500 bg-[#090d18]/90 text-slate-200 text-sm font-medium transition-colors cursor-pointer"
          >
            复杂种子与存档
          </button>
        </div>
      </div>

      {/* Flat borderless engineering control hint */}
      <div className="relative z-10 text-[11px] text-slate-400 font-mono-tabular">
        WASD 移动/飞行 · Space 跳跃/上升 · 右键 旋转视角 · Tab 切换探索/轨道/FPS视角 · F3 体素调试 · K 冻结模拟 · Enter 开始
      </div>
    </div>
  );
};
