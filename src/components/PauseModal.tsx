import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { SandboxTelemetry } from '../engine/webgpuScene';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';

interface PauseModalProps {
  telemetry: SandboxTelemetry;
  gravityScale: number;
  newTabUrl: string;
  onPrepareNewTab: () => void;
  onResume: () => void;
  onQuickSave: () => Promise<void>;
  onOpenSeedModal: () => void;
  onResetPlanet: () => void;
  onReturnTitle: () => void;
}

function fmtRadius(r: number): string {
  if (r >= 100) return `${r.toFixed(0)}m`;
  if (r >= 10) return `${r.toFixed(1)}m`;
  return `${r.toFixed(2)}m`;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  telemetry,
  gravityScale,
  newTabUrl,
  onPrepareNewTab,
  onResume,
  onQuickSave,
  onOpenSeedModal,
  onResetPlanet,
  onReturnTitle,
}) => {
  const [savedNotice, setSavedNotice] = useState(false);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(4, 7, 15, 0.80)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-title"
    >
      <div
        className="w-full max-w-md rounded-sm border border-slate-700/90 p-5"
        style={{ backgroundColor: 'rgba(9, 13, 24, 0.98)' }}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h2
              id="pause-title"
              className="font-display text-xl font-bold text-white"
            >
              模拟已暂停
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono-tabular">
              种子 #{telemetry.seed} · R₀={fmtRadius(telemetry.planetRadius)} · 物理步已冻结
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <OfflineIndicator />
            <PWAInstallButton compact />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5">
            <div className="text-[10px] text-slate-400">地形等值面</div>
            <div className="font-mono-tabular text-sm font-semibold text-white mt-0.5">
              {Math.round(telemetry.terrainVertices / 3)} 面
            </div>
          </div>
          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5">
            <div className="text-[10px] text-slate-400">水体粒子</div>
            <div className="font-mono-tabular text-sm font-semibold text-cyan-300 mt-0.5">
              {Math.round(telemetry.waterParticles)}
            </div>
          </div>
          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5">
            <div className="text-[10px] text-slate-400">重力倍率</div>
            <div className="font-mono-tabular text-sm font-semibold text-sky-300 mt-0.5">
              {Number(gravityScale.toFixed(3))} g
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onResume();
            }}
            className="w-full py-2.5 rounded-xs bg-sky-500 hover:bg-sky-400 text-slate-950 font-display font-semibold text-sm transition-colors cursor-pointer"
          >
            继续创造 (Esc / P)
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              void onQuickSave().then(() => setSavedNotice(true));
            }}
            className="w-full py-2 rounded-xs border border-emerald-500/60 hover:border-emerald-400 bg-emerald-950/30 text-emerald-200 text-xs font-medium transition-colors cursor-pointer"
          >
            {savedNotice ? '已持久化保存当前星球 ✓' : '保存当前体素与流体进度'}
          </button>
          <a
            href={newTabUrl}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={onPrepareNewTab}
            onClick={onPrepareNewTab}
            className="w-full py-2 rounded-xs border border-slate-700 hover:border-sky-400/80 bg-[#0d1322] text-slate-200 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
            <span>在新标签页中独立打开当前状态</span>
          </a>
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenSeedModal();
            }}
            className="w-full py-2 rounded-xs border border-slate-700 hover:border-sky-400/70 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
          >
            调整复杂种子 / 管理存档
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onResetPlanet();
            }}
            className="w-full py-2 rounded-xs border border-slate-700 hover:border-slate-500 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
          >
            生成新星球并重置水体
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onReturnTitle();
            }}
            className="w-full py-2 rounded-xs border border-slate-800 hover:border-slate-600 text-slate-400 hover:text-slate-200 text-xs transition-colors cursor-pointer"
          >
            返回主标题界面
          </button>
        </div>
      </div>
    </div>
  );
};
