import React from 'react';
import { Activity, CheckCircle2, Film, Layers, ShieldCheck } from 'lucide-react';
import { DirectorRenderProgress, RgbHistogramBins } from '../../engine/director';
import { FrameFilmstripItem } from '../../engine/directorStorage';

interface RenderMonitorPaneProps {
  rendering: boolean;
  progress: DirectorRenderProgress | null;
  inspectedFrame: FrameFilmstripItem | null;
  targetWidth: number;
  targetHeight: number;
  fps: number;
}

function buildHistogramPath(values: number[], width: number, height: number): string {
  if (!values || values.length === 0) return '';
  const n = values.length;
  const stepX = width / Math.max(1, n - 1);
  let d = `M 0 ${height}`;
  for (let i = 0; i < n; i++) {
    const x = i * stepX;
    const y = height - Math.max(0, Math.min(1, values[i])) * (height - 4);
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${width} ${height} Z`;
  return d;
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0.0s';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${String(s).padStart(2, '0')}s`;
}

export const RenderMonitorPane: React.FC<RenderMonitorPaneProps> = ({
  rendering,
  progress,
  inspectedFrame,
  targetWidth,
  targetHeight,
  fps,
}) => {
  const previewUrl = inspectedFrame?.thumbDataUrl || progress?.previewDataUrl || '';
  const hist: RgbHistogramBins | undefined =
    inspectedFrame?.histogram ?? progress?.histogram;
  const meanLuma = inspectedFrame?.meanLuma ?? progress?.meanLuma;
  const alphaMin = inspectedFrame?.alphaMin ?? progress?.alphaMin;
  const frameMs = inspectedFrame?.renderMs ?? progress?.frameRenderMs;

  return (
    <div
      data-testid="render-output-inspector"
      className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#060911] border-l border-slate-800/90 overflow-hidden"
    >
      {/* Monitor Header */}
      <div className="h-7 px-2.5 border-b border-slate-800/80 bg-[#090d18] flex items-center justify-between text-[10px] shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Film className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span className="font-semibold text-slate-200 whitespace-nowrap">
            输出检视器 & 直方图 (Scope)
          </span>
          {inspectedFrame && (
            <span className="font-mono-tabular text-cyan-300 whitespace-nowrap">
              · 检视帧 #{inspectedFrame.frameIdx + 1}
              {inspectedFrame.isKeyFrame ? ' [I-KEY]' : ''}
            </span>
          )}
        </div>
        <div className="font-mono-tabular text-slate-400 whitespace-nowrap">
          {progress
            ? `${progress.actualWidth}×${progress.actualHeight} @ ${fps}fps`
            : `${targetWidth}×${targetHeight} @ ${fps}fps`}
        </div>
      </div>

      {/* Preview Frame Viewport */}
      <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 overflow-hidden">
        <div className="flex-1 min-h-0 rounded-xs border border-slate-800 bg-[#03050a] relative flex items-center justify-center overflow-hidden">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="离线渲染帧检视画面"
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <div className="text-center px-4 space-y-1">
              <Layers className="w-6 h-6 text-slate-600 mx-auto" />
              <div className="text-[11px] text-slate-400">
                等待离线渲染或点击下方胶片条预览已保存帧
              </div>
              <div className="text-[10px] text-slate-600">
                支持随时暂停保存断点 · 刷新恢复续渲染 · 局部安全导出
              </div>
            </div>
          )}

          {/* Live Telemetry Overlay */}
          {(rendering || progress || inspectedFrame) && (
            <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between gap-2 pointer-events-none text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded-xs bg-[#05070d]/85 border border-slate-700/80 text-slate-200">
                {progress?.statusText ?? 'IndexedDB 快照已加载'}
              </span>
              {progress?.checkpointSaved && (
                <span className="px-1.5 py-0.5 rounded-xs bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  断点已写入
                </span>
              )}
            </div>
          )}
        </div>

        {/* RGB + Luma Histogram & Frame Diagnostics */}
        <div className="h-[92px] shrink-0 rounded-xs border border-slate-800 bg-[#090d17] p-2 flex gap-3 items-stretch">
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-300 flex items-center gap-1">
                <Activity className="w-3 h-3 text-cyan-400" />
                RGB / Luma 波形直方图
              </span>
              {hist && (
                <span className="font-mono-tabular text-slate-400">
                  高光溢出 {hist.clipHighPct}% · 暗部 {hist.clipLowPct}%
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 mt-1 rounded-xs bg-[#04060c] border border-slate-800/80 overflow-hidden">
              {hist ? (
                <svg
                  viewBox="0 0 240 52"
                  preserveAspectRatio="none"
                  className="w-full h-full"
                >
                  <path d={buildHistogramPath(hist.r, 240, 52)} fill="rgba(244,63,94,0.28)" stroke="#f43f5e" strokeWidth={1} />
                  <path d={buildHistogramPath(hist.g, 240, 52)} fill="rgba(16,185,129,0.24)" stroke="#10b981" strokeWidth={1} />
                  <path d={buildHistogramPath(hist.b, 240, 52)} fill="rgba(56,189,248,0.28)" stroke="#38bdf8" strokeWidth={1} />
                  <path d={buildHistogramPath(hist.luma, 240, 52)} fill="none" stroke="rgba(248,250,252,0.75)" strokeWidth={1.1} />
                </svg>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-600">
                  无直方图采样数据
                </div>
              )}
            </div>
          </div>

          {/* Numeric Frame Telemetry Column */}
          <div className="w-44 shrink-0 border-l border-slate-800 pl-2.5 flex flex-col justify-between text-[10px] font-mono-tabular">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">平均亮度 Luma</span>
              <span className="text-slate-100">
                {meanLuma !== undefined ? meanLuma.toFixed(1) : '--'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">不透明度 AlphaMin</span>
              <span className="text-emerald-300 flex items-center gap-0.5">
                {alphaMin !== undefined ? (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    {alphaMin}
                  </>
                ) : (
                  '--'
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">单帧耗时</span>
              <span className="text-cyan-300">
                {frameMs !== undefined ? `${frameMs.toFixed(0)} ms` : '--'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">总进度 / ETA</span>
              <span className="text-amber-300">
                {progress
                  ? `${progress.percent.toFixed(1)}% · ${fmtDuration(progress.etaSec)}`
                  : '--'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface FilmstripGalleryProps {
  frames: FrameFilmstripItem[];
  selectedFrameIdx: number | null;
  onSelectFrame: (item: FrameFilmstripItem) => void;
}

export const FilmstripGallery: React.FC<FilmstripGalleryProps> = ({
  frames,
  selectedFrameIdx,
  onSelectFrame,
}) => {
  return (
    <div
      data-testid="director-filmstrip-gallery"
      className="h-[68px] shrink-0 border-t border-slate-800 bg-[#05070e] px-2.5 py-1.5 flex items-center gap-2 overflow-x-auto"
    >
      <div className="shrink-0 pr-2 border-r border-slate-800 text-[10px] space-y-0.5">
        <div className="text-slate-300 font-medium whitespace-nowrap">逐帧胶片条</div>
        <div className="font-mono-tabular text-slate-500 whitespace-nowrap">
          已存 {frames.length} 帧
        </div>
      </div>

      {frames.length === 0 ? (
        <div className="text-[10px] text-slate-600 px-2 whitespace-nowrap">
          开始渲染或从右侧队列加载历史断点任务后，将在此实时展示逐帧缩略图与 I 帧标记。
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {frames.map((item) => {
            const active = selectedFrameIdx === item.frameIdx;
            return (
              <button
                key={item.frameIdx}
                type="button"
                tabIndex={-1}
                onClick={() => onSelectFrame(item)}
                className={`relative shrink-0 h-12 w-20 rounded-xs border overflow-hidden cursor-pointer transition-colors ${
                  active
                    ? 'border-cyan-400 ring-1 ring-cyan-400/60'
                    : 'border-slate-800 hover:border-slate-600'
                }`}
              >
                {item.thumbDataUrl ? (
                  <img
                    src={item.thumbDataUrl}
                    alt={`帧 #${item.frameIdx + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-slate-900" />
                )}
                <span className="absolute bottom-0 left-0 right-0 px-1 bg-[#05070d]/80 text-[9px] font-mono-tabular text-slate-200 flex items-center justify-between">
                  <span>#{item.frameIdx + 1}</span>
                  {item.isKeyFrame && <span className="text-emerald-300">K</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
