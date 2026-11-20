import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture,
  Check,
  Clapperboard,
  Download,
  Film,
  Play,
  Plus,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  computePlanFrameCount,
  DIRECTOR_ACTIONS,
  DirectorActionType,
  DirectorExportFormat,
  DirectorKeyframe,
  DirectorRenderProgress,
  DirectorShotPlan,
  FPS_PRESETS,
  RESOLUTION_PRESETS,
  ScreenshotFormat,
} from '../engine/director';
import {
  createDefaultDirectorQuality,
  DirectorQualitySettings,
  OfflineAccumSamples,
  OfflineQualityOverride,
  ShadowQualityLevel,
} from '../engine/renderQuality';

export interface DirectorScreenshotResult {
  blob: Blob;
  actualWidth: number;
  actualHeight: number;
  previewDataUrl: string;
  format: ScreenshotFormat;
}

export interface DirectorVideoResult {
  blob: Blob;
  mimeType: string;
  filename: string;
  frameCount: number;
  actualWidth: number;
  actualHeight: number;
  fps: number;
  elapsedMs: number;
  encoderLabel: string;
}

interface DirectorStudioDrawerProps {
  plan: DirectorShotPlan;
  previewing: boolean;
  hardwareCaps: {
    maxGpuTextureDim: number;
    webCodecsAvailable: boolean;
    mediaRecorderAvailable: boolean;
  };
  viewportSize: { width: number; height: number };
  onUpdatePlan: (partial: Partial<DirectorShotPlan>) => void;
  onCaptureKeyframe: () => DirectorKeyframe;
  onStartPreview: () => void;
  onStopPreview: () => void;
  onCaptureScreenshot: (opts: {
    width: number;
    height: number;
    format: ScreenshotFormat;
    hideHelpers: boolean;
    qualityOverride?: OfflineQualityOverride;
    accumSamples?: OfflineAccumSamples;
    rayTracing?: boolean;
    volumetrics?: boolean;
    shadowQuality?: ShadowQualityLevel;
    pbrEnhanced?: boolean;
  }) => Promise<DirectorScreenshotResult>;
  onRenderOfflineVideo: (
    onProgress: (p: DirectorRenderProgress) => void,
    signal: AbortSignal,
  ) => Promise<DirectorVideoResult>;
  onClose: () => void;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function fmtTimeSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0s';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

export const DirectorStudioDrawer: React.FC<DirectorStudioDrawerProps> = ({
  plan,
  previewing,
  hardwareCaps,
  viewportSize,
  onUpdatePlan,
  onCaptureKeyframe,
  onStartPreview,
  onStopPreview,
  onCaptureScreenshot,
  onRenderOfflineVideo,
  onClose,
}) => {
  const [tab, setTab] = useState<'choreo' | 'render'>('choreo');

  // Screenshot configuration
  const [shotWidth, setShotWidth] = useState<number>(5760);
  const [shotHeight, setShotHeight] = useState<number>(3240);
  const [shotFormat, setShotFormat] = useState<ScreenshotFormat>('png');
  const [shotHideHelpers, setShotHideHelpers] = useState(true);
  const [shotBusy, setShotBusy] = useState(false);
  const [lastShotInfo, setLastShotInfo] = useState<{
    previewDataUrl: string;
    label: string;
  } | null>(null);

  // Offline render state
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<DirectorRenderProgress | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [lastVideo, setLastVideo] = useState<{
    result: DirectorVideoResult;
    objectUrl: string;
  } | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (lastVideo?.objectUrl) {
        URL.revokeObjectURL(lastVideo.objectUrl);
      }
    };
  }, [lastVideo]);

  const totalFrames = useMemo(() => computePlanFrameCount(plan), [plan]);
  const selectedActionMeta =
    DIRECTOR_ACTIONS.find((a) => a.id === plan.action) ?? DIRECTOR_ACTIONS[0];

  const offlineQuality = plan.offlineQuality ?? createDefaultDirectorQuality();
  const updateOfflineQuality = (partial: Partial<DirectorQualitySettings>) => {
    onUpdatePlan({
      offlineQuality: { ...offlineQuality, ...partial },
    });
  };

  const handleRunScreenshot = async () => {
    if (shotBusy || rendering) return;
    setShotBusy(true);
    try {
      const res = await onCaptureScreenshot({
        width: shotWidth,
        height: shotHeight,
        format: shotFormat,
        hideHelpers: shotHideHelpers,
        qualityOverride: offlineQuality.overrideMode,
        accumSamples: offlineQuality.accumSamples,
        rayTracing: offlineQuality.rayTracing,
        volumetrics: offlineQuality.volumetrics,
        shadowQuality: offlineQuality.shadowQuality,
        pbrEnhanced: offlineQuality.pbrEnhanced,
      });
      const ext = shotFormat === 'jpeg' ? 'jpg' : shotFormat;
      triggerBlobDownload(
        res.blob,
        `terrasphere-shot-${res.actualWidth}x${res.actualHeight}.${ext}`,
      );
      setLastShotInfo({
        previewDataUrl: res.previewDataUrl,
        label: `${res.actualWidth} × ${res.actualHeight} ${shotFormat.toUpperCase()} · ${offlineQuality.accumSamples}×SSAA (${(
          res.blob.size /
          (1024 * 1024)
        ).toFixed(2)} MB)`,
      });
    } finally {
      setShotBusy(false);
    }
  };

  const handleStartOfflineRender = async () => {
    if (rendering) return;
    if (plan.action === 'keyframe_path' && plan.keyframes.length < 2) {
      setRenderError('多机位关键帧模式至少需要记录 2 个机位关键帧');
      return;
    }
    setRenderError(null);
    setRendering(true);
    setRenderProgress({
      frame: 0,
      totalFrames,
      percent: 0,
      elapsedSec: 0,
      etaSec: 0,
      actualWidth: plan.width,
      actualHeight: plan.height,
      encoderLabel: '初始化离线渲染管道...',
      statusText: '准备首帧体素网格与编码器',
    });

    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    try {
      const result = await onRenderOfflineVideo(
        (p) => setRenderProgress(p),
        ctrl.signal,
      );
      if (lastVideo?.objectUrl) {
        URL.revokeObjectURL(lastVideo.objectUrl);
      }
      const objectUrl =
        result.mimeType === 'video/webm' ? URL.createObjectURL(result.blob) : '';
      setLastVideo({ result, objectUrl });
      triggerBlobDownload(result.blob, result.filename);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setRenderError('离线渲染已手动取消');
      } else {
        setRenderError(
          err instanceof Error ? err.message : '离线视频渲染失败',
        );
      }
    } finally {
      abortCtrlRef.current = null;
      setRendering(false);
    }
  };

  const handleAbortRender = () => {
    abortCtrlRef.current?.abort();
  };

  const handleAddKeyframe = () => {
    const kf = onCaptureKeyframe();
    onUpdatePlan({
      keyframes: [
        ...plan.keyframes,
        { ...kf, label: `机位 ${plan.keyframes.length + 1}` },
      ],
    });
  };

  const handleRemoveKeyframe = (id: string) => {
    onUpdatePlan({
      keyframes: plan.keyframes.filter((k) => k.id !== id),
    });
  };

  return (
    <section
      data-testid="director-studio-drawer"
      className="pointer-events-auto fixed right-2 top-11 bottom-16 z-[26] w-[372px] max-w-[calc(100vw-16px)] rounded-sm border border-slate-700 bg-[#090d18]/96 shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800 bg-[#0d1322] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Clapperboard className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <h2 className="font-display text-xs font-semibold text-white truncate">
            高级导演系统 · 截屏与离线录像
          </h2>
        </div>
        <button
          type="button"
          tabIndex={-1}
          data-testid="close-director-btn"
          onClick={onClose}
          disabled={rendering}
          className="w-6 h-6 rounded-xs hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
          aria-label="关闭高级导演系统"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="px-2.5 pt-2 pb-1.5 border-b border-slate-800/90 flex items-center gap-1 shrink-0">
        <button
          type="button"
          tabIndex={-1}
          data-testid="director-tab-choreo"
          onClick={() => setTab('choreo')}
          className={`flex-1 h-7 px-2 rounded-xs border text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
            tab === 'choreo'
              ? 'border-sky-400 bg-sky-950/70 text-white'
              : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-slate-200'
          }`}
        >
          <Aperture className="w-3.5 h-3.5 shrink-0" />
          <span>截屏与运镜动作</span>
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-testid="director-tab-render"
          onClick={() => setTab('render')}
          className={`flex-1 h-7 px-2 rounded-xs border text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
            tab === 'render'
              ? 'border-rose-400 bg-rose-950/60 text-white'
              : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-slate-200'
          }`}
        >
          <Film className="w-3.5 h-3.5 shrink-0" />
          <span>离线视频渲染 (6K/165fps)</span>
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-3 text-[11px] text-slate-200">
        {tab === 'choreo' ? (
          <>
            {/* Section 1: Ultra-High-Res Screenshot */}
            <div className="space-y-2 pb-3 border-b border-slate-800">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white text-[11px]">
                  高分辨率纯净截屏
                </span>
                <span className="font-mono-tabular text-[10px] text-slate-400">
                  GPU上限 {hardwareCaps.maxGpuTextureDim}px
                </span>
              </div>

              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setShotWidth(viewportSize.width);
                    setShotHeight(viewportSize.height);
                  }}
                  className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap ${
                    shotWidth === viewportSize.width && shotHeight === viewportSize.height
                      ? 'border-sky-400 bg-sky-950/70 text-white'
                      : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  视口原图
                </button>
                {RESOLUTION_PRESETS.filter((r) => r.id !== '1440p').map((r) => {
                  const active = shotWidth === r.width && shotHeight === r.height;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        setShotWidth(r.width);
                        setShotHeight(r.height);
                      }}
                      className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap ${
                        active
                          ? 'border-sky-400 bg-sky-950/70 text-white'
                          : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {r.id === '6k' ? '6K' : r.id === '6k-dci' ? '6K DCI' : r.id.toUpperCase()}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <label className="block space-y-0.5">
                  <span className="text-[10px] text-slate-400">宽度 (px)</span>
                  <input
                    type="number"
                    min={64}
                    max={8192}
                    value={shotWidth}
                    onChange={(e) =>
                      setShotWidth(Math.max(64, Math.min(8192, Number(e.target.value) || 1920)))
                    }
                    className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white font-mono-tabular text-[11px]"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-[10px] text-slate-400">高度 (px)</span>
                  <input
                    type="number"
                    min={64}
                    max={8192}
                    value={shotHeight}
                    onChange={(e) =>
                      setShotHeight(Math.max(64, Math.min(8192, Number(e.target.value) || 1080)))
                    }
                    className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white font-mono-tabular text-[11px]"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-[10px] text-slate-400">格式</span>
                  <select
                    value={shotFormat}
                    onChange={(e) => setShotFormat(e.target.value as ScreenshotFormat)}
                    className="w-full h-7 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[11px]"
                  >
                    <option value="png">PNG 无损</option>
                    <option value="webp">WebP</option>
                    <option value="jpeg">JPEG</option>
                  </select>
                </label>
              </div>

              {/* Quick Offline Quality Strip for High-Res Screenshots */}
              <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-1.5 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-300">截屏画质强化 (以时间换质量)</span>
                  <span className="font-mono-tabular text-cyan-300">
                    {offlineQuality.overrideMode === 'inherit'
                      ? '沿用实时'
                      : offlineQuality.overrideMode === 'cinematic'
                        ? '影院光追'
                        : '极限路径'}{' '}
                    · {offlineQuality.accumSamples}×SSAA
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ['inherit', '沿用实时'],
                      ['cinematic', '影院光追'],
                      ['offline_raytraced', '极限路径'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      tabIndex={-1}
                      disabled={shotBusy || rendering}
                      onClick={() =>
                        updateOfflineQuality({
                          overrideMode: mode,
                          accumSamples: mode === 'offline_raytraced' ? 4 : mode === 'cinematic' ? 2 : 1,
                        })
                      }
                      className={`h-6 rounded-xs border text-[10px] cursor-pointer ${
                        offlineQuality.overrideMode === mode
                          ? 'border-cyan-400 bg-cyan-950/60 text-white'
                          : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shotHideHelpers}
                    onChange={(e) => setShotHideHelpers(e.target.checked)}
                    className="accent-sky-400 cursor-pointer"
                  />
                  <span>隐藏笔刷/准星线</span>
                </label>

                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="director-capture-screenshot-btn"
                  disabled={shotBusy || rendering}
                  onClick={() => void handleRunScreenshot()}
                  className="h-7 px-3 rounded-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-[11px] font-medium cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Aperture className="w-3.5 h-3.5" />
                  <span>{shotBusy ? '采样渲染中...' : '立即截屏 [F10]'}</span>
                </button>
              </div>

              {lastShotInfo && (
                <div className="pt-1 space-y-1">
                  {lastShotInfo.previewDataUrl && (
                    <img
                      src={lastShotInfo.previewDataUrl}
                      alt="截屏预览"
                      className="w-full h-24 object-cover rounded-xs border border-slate-700"
                    />
                  )}
                  <div className="flex items-center gap-1 text-[10px] text-emerald-300 font-mono-tabular">
                    <Check className="w-3 h-3 shrink-0" />
                    <span>已保存：{lastShotInfo.label}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Camera Choreography */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white text-[11px]">
                  导演运镜动作编排
                </span>
                <span className="text-[10px] font-mono-tabular text-slate-400">
                  {plan.durationSec}s · {totalFrames} 帧
                </span>
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] text-slate-400">选择自动运镜脚本</span>
                <select
                  data-testid="director-action-select"
                  value={plan.action}
                  onChange={(e) =>
                    onUpdatePlan({ action: e.target.value as DirectorActionType })
                  }
                  className="w-full h-8 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[11px] focus:border-sky-400 focus:outline-none"
                >
                  {DIRECTOR_ACTIONS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  {selectedActionMeta.desc}
                </p>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-300">镜头时长</span>
                    <span className="font-mono-tabular text-sky-300">
                      {plan.durationSec.toFixed(1)} s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={0.5}
                    value={plan.durationSec}
                    onChange={(e) => onUpdatePlan({ durationSec: Number(e.target.value) })}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </label>

                <label className="block space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-300">太阳扫掠角</span>
                    <span className="font-mono-tabular text-amber-300">
                      {plan.sunSweepDeg >= 0 ? `+${plan.sunSweepDeg}` : plan.sunSweepDeg}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={plan.sunSweepDeg}
                    onChange={(e) => onUpdatePlan({ sunSweepDeg: Number(e.target.value) })}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </label>
              </div>

              {(plan.action === 'micro_to_planet' || plan.action === 'planet_to_micro') && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-300">最小体素倍率</span>
                      <span className="font-mono-tabular text-cyan-300">
                        {plan.microStartVoxelMult.toFixed(1)}×体素
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.8}
                      max={16}
                      step={0.2}
                      value={plan.microStartVoxelMult}
                      onChange={(e) =>
                        onUpdatePlan({ microStartVoxelMult: Number(e.target.value) })
                      }
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </label>

                  <label className="block space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-300">远景距 (×R₀)</span>
                      <span className="font-mono-tabular text-emerald-300">
                        {plan.planetEndDistMult.toFixed(2)} R₀
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1.4}
                      max={5.0}
                      step={0.05}
                      value={plan.planetEndDistMult}
                      onChange={(e) =>
                        onUpdatePlan({ planetEndDistMult: Number(e.target.value) })
                      }
                      className="w-full accent-emerald-400 cursor-pointer"
                    />
                  </label>
                </div>
              )}

              {(plan.action === 'orbit_360' ||
                plan.action === 'spiral_reveal' ||
                plan.action === 'surface_flyover') && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-300">环绕角度</span>
                        <span className="font-mono-tabular text-sky-300">
                          {Math.round(plan.orbitSweepDeg)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={60}
                        max={720}
                        step={15}
                        value={plan.orbitSweepDeg}
                        onChange={(e) =>
                          onUpdatePlan({ orbitSweepDeg: Number(e.target.value) })
                        }
                        className="w-full accent-sky-400 cursor-pointer"
                      />
                    </label>

                    <label className="block space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-300">
                          {plan.action === 'surface_flyover' ? '贴地高度 (×R₀)' : '轨道距离 (×R₀)'}
                        </span>
                        <span className="font-mono-tabular text-emerald-300">
                          {plan.planetEndDistMult.toFixed(2)} R₀
                        </span>
                      </div>
                      <input
                        type="range"
                        min={plan.action === 'surface_flyover' ? 1.12 : 1.35}
                        max={4.8}
                        step={0.05}
                        value={plan.planetEndDistMult}
                        onChange={(e) =>
                          onUpdatePlan({ planetEndDistMult: Number(e.target.value) })
                        }
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </label>
                  </div>

                  {plan.action !== 'surface_flyover' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block space-y-0.5">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-300">轨道基准仰角</span>
                          <span className="font-mono-tabular text-slate-200">
                            {Math.round(plan.orbitElevationDeg)}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-65}
                          max={65}
                          step={1}
                          value={plan.orbitElevationDeg}
                          onChange={(e) =>
                            onUpdatePlan({ orbitElevationDeg: Number(e.target.value) })
                          }
                          className="w-full accent-indigo-400 cursor-pointer"
                        />
                      </label>

                      <label className="block space-y-0.5">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-300">纬度起伏波幅</span>
                          <span className="font-mono-tabular text-slate-200">
                            ±{Math.round(plan.orbitWaveDeg)}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={45}
                          step={1}
                          value={plan.orbitWaveDeg}
                          onChange={(e) =>
                            onUpdatePlan({ orbitWaveDeg: Number(e.target.value) })
                          }
                          className="w-full accent-indigo-400 cursor-pointer"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {plan.action === 'keyframe_path' && (
                <div className="space-y-1.5 p-2 rounded-xs border border-slate-800 bg-[#0d1322]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-300">
                      已捕获机位 ({plan.keyframes.length})
                    </span>
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="director-add-keyframe-btn"
                      onClick={handleAddKeyframe}
                      className="h-6 px-2 rounded-xs border border-emerald-500/60 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-200 text-[10px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3 h-3" />
                      <span>记录当前机位</span>
                    </button>
                  </div>
                  {plan.keyframes.length === 0 ? (
                    <div className="text-[10px] text-slate-500 py-1">
                      移动相机到起始和目标点，依次点击「记录当前机位」（至少 2 个）。
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {plan.keyframes.map((kf, idx) => (
                        <div
                          key={kf.id}
                          className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-xs bg-[#090d18] border border-slate-800 text-[10px]"
                        >
                          <span className="text-slate-200 truncate">
                            #{idx + 1} {kf.label} · FOV {Math.round(kf.fovDeg)}°
                          </span>
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => handleRemoveKeyframe(kf.id)}
                            className="text-slate-400 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-300">物理时间流逝</span>
                    <span className="font-mono-tabular text-cyan-300">
                      {plan.simTimeScale.toFixed(1)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={0.1}
                    value={plan.simTimeScale}
                    onChange={(e) => onUpdatePlan({ simTimeScale: Number(e.target.value) })}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </label>

                <label className="block space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-300">基准视角 FOV</span>
                    <span className="font-mono-tabular text-slate-200">
                      {Math.round(plan.baseFovDeg)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={95}
                    step={1}
                    value={plan.baseFovDeg}
                    onChange={(e) => onUpdatePlan({ baseFovDeg: Number(e.target.value) })}
                    className="w-full accent-slate-300 cursor-pointer"
                  />
                </label>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="director-preview-toggle-btn"
                  disabled={rendering}
                  onClick={previewing ? onStopPreview : onStartPreview}
                  className={`flex-1 h-8 px-3 rounded-xs border text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                    previewing
                      ? 'border-amber-400 bg-amber-950/70 text-amber-200'
                      : 'border-slate-700 bg-[#0d1322] hover:border-sky-400 text-white'
                  }`}
                >
                  {previewing ? (
                    <>
                      <Square className="w-3 h-3" />
                      <span>停止预览运镜</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-sky-400" />
                      <span>实时预览运镜</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setTab('render')}
                  className="h-8 px-3 rounded-xs bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-medium cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>去离线渲染</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Tab 2: Offline High-Res & High-FPS Video Render */
          <div className="space-y-3">
            {/* Resolution Selection */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">输出视频分辨率</span>
                <span className="font-mono-tabular text-[10px] text-slate-400">
                  {plan.width} × {plan.height}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {RESOLUTION_PRESETS.map((r) => {
                  const active = plan.width === r.width && plan.height === r.height;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      data-testid={`director-res-${r.id}`}
                      onClick={() => onUpdatePlan({ width: r.width, height: r.height })}
                      className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap ${
                        active
                          ? 'border-rose-400 bg-rose-950/70 text-white'
                          : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-0.5">
                  <span className="text-[10px] text-slate-400">自定义宽 (px)</span>
                  <input
                    type="number"
                    min={128}
                    max={8192}
                    step={2}
                    disabled={rendering}
                    data-testid="director-width-input"
                    value={plan.width}
                    onChange={(e) =>
                      onUpdatePlan({
                        width: Math.max(128, Math.min(8192, Number(e.target.value) || 1920)),
                      })
                    }
                    className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white font-mono-tabular text-[11px]"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-[10px] text-slate-400">自定义高 (px)</span>
                  <input
                    type="number"
                    min={128}
                    max={8192}
                    step={2}
                    disabled={rendering}
                    data-testid="director-height-input"
                    value={plan.height}
                    onChange={(e) =>
                      onUpdatePlan({
                        height: Math.max(128, Math.min(8192, Number(e.target.value) || 1080)),
                      })
                    }
                    className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white font-mono-tabular text-[11px]"
                  />
                </label>
              </div>
            </div>

            {/* FPS Selection */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">离线帧率 (FPS)</span>
                <span className="font-mono-tabular text-[10px] text-emerald-300">
                  逐帧 Δt = {(1000 / Math.max(1, plan.fps)).toFixed(2)} ms
                </span>
              </div>
              <div className="flex flex-wrap gap-1 items-center">
                {FPS_PRESETS.map((fpsVal) => {
                  const active = plan.fps === fpsVal;
                  return (
                    <button
                      key={fpsVal}
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      data-testid={`director-fps-${fpsVal}`}
                      onClick={() => onUpdatePlan({ fps: fpsVal })}
                      className={`h-6 px-2 rounded-xs border text-[10px] font-mono-tabular cursor-pointer whitespace-nowrap ${
                        active
                          ? 'border-emerald-400 bg-emerald-950/70 text-white'
                          : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {fpsVal} FPS
                    </button>
                  );
                })}
                <input
                  type="number"
                  min={1}
                  max={300}
                  disabled={rendering}
                  data-testid="director-fps-input"
                  value={plan.fps}
                  onChange={(e) =>
                    onUpdatePlan({
                      fps: Math.max(1, Math.min(300, Math.round(Number(e.target.value) || 60))),
                    })
                  }
                  className="w-16 h-6 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-white font-mono-tabular text-[10px]"
                  title="自定义任意帧率 (1–300 FPS)"
                />
              </div>
            </div>

            {/* Codec & Export Format */}
            <div className="space-y-1.5">
              <span className="font-semibold text-white block">编码器与封装格式</span>
              <select
                disabled={rendering}
                value={plan.format}
                onChange={(e) =>
                  onUpdatePlan({ format: e.target.value as DirectorExportFormat })
                }
                className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[11px]"
              >
                <option value="webm-vp9">WebM · WebCodecs VP9 (支持 6K/8K 高帧率)</option>
                <option value="webm-vp8">WebM · WebCodecs VP8 (高兼容)</option>
                <option value="png-tar">PNG 无损逐帧序列包 (.tar)</option>
              </select>
              <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px]">
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={rendering}
                    checked={plan.forceMaxVoxelDetail}
                    onChange={(e) => onUpdatePlan({ forceMaxVoxelDetail: e.target.checked })}
                    className="accent-emerald-400 cursor-pointer"
                  />
                  <span>强制 LOD0 最高体素锐度</span>
                </label>
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={rendering}
                    checked={plan.cleanFrame}
                    onChange={(e) => onUpdatePlan({ cleanFrame: e.target.checked })}
                    className="accent-sky-400 cursor-pointer"
                  />
                  <span>纯净无辅助线</span>
                </label>
              </div>
            </div>

            {/* Offline Render Quality Upgrade (Time-for-Quality) */}
            <div
              data-testid="director-offline-quality-box"
              className="rounded-xs border border-cyan-500/35 bg-[#0d1322] p-2.5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">离线画质策略 · 以时间换质量</span>
                <span className="font-mono-tabular text-[10px] text-cyan-300">
                  {offlineQuality.accumSamples}× 超采样
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    ['inherit', '沿用实时画质'],
                    ['cinematic', '离线影院级'],
                    ['offline_raytraced', '极限路径累积'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    tabIndex={-1}
                    disabled={rendering}
                    data-testid={`director-quality-mode-${mode}`}
                    onClick={() =>
                      updateOfflineQuality({
                        overrideMode: mode,
                        accumSamples:
                          mode === 'offline_raytraced'
                            ? 4
                            : mode === 'cinematic'
                              ? 2
                              : offlineQuality.accumSamples,
                      })
                    }
                    className={`py-1 px-1 rounded-xs border text-[10px] font-medium cursor-pointer transition-colors ${
                      offlineQuality.overrideMode === mode
                        ? 'border-cyan-400 bg-cyan-950/60 text-white'
                        : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Subpixel Jitter Multi-Sample Accumulation */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>亚像素抖动超采样与光追去噪 (SSAA)</span>
                  <span className="font-mono-tabular text-emerald-300">
                    耗时 ×{offlineQuality.accumSamples}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {([1, 2, 4, 8] as OfflineAccumSamples[]).map((samples) => (
                    <button
                      key={samples}
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      data-testid={`director-accum-${samples}`}
                      onClick={() => updateOfflineQuality({ accumSamples: samples })}
                      className={`py-1 rounded-xs border text-[10px] font-mono-tabular cursor-pointer ${
                        offlineQuality.accumSamples === samples
                          ? 'border-emerald-400 bg-emerald-950/60 text-white'
                          : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {samples}× {samples === 1 ? '快速' : samples === 4 ? '推荐' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {offlineQuality.overrideMode !== 'inherit' && (
                <div className="space-y-1.5 pt-1 border-t border-slate-800/80 text-[10px]">
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      onClick={() =>
                        updateOfflineQuality({ rayTracing: !offlineQuality.rayTracing })
                      }
                      className={`py-1 px-1.5 rounded-xs border cursor-pointer ${
                        offlineQuality.rayTracing
                          ? 'border-cyan-500/70 bg-cyan-950/40 text-cyan-200'
                          : 'border-slate-800 bg-[#090d18] text-slate-400'
                      }`}
                    >
                      SSGI+SSR: {offlineQuality.rayTracing ? '开' : '关'}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      onClick={() =>
                        updateOfflineQuality({ volumetrics: !offlineQuality.volumetrics })
                      }
                      className={`py-1 px-1.5 rounded-xs border cursor-pointer ${
                        offlineQuality.volumetrics
                          ? 'border-sky-500/70 bg-sky-950/40 text-sky-200'
                          : 'border-slate-800 bg-[#090d18] text-slate-400'
                      }`}
                    >
                      体积雾散射: {offlineQuality.volumetrics ? '开' : '关'}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      onClick={() =>
                        updateOfflineQuality({ pbrEnhanced: !offlineQuality.pbrEnhanced })
                      }
                      className={`py-1 px-1.5 rounded-xs border cursor-pointer ${
                        offlineQuality.pbrEnhanced
                          ? 'border-emerald-500/70 bg-emerald-950/40 text-emerald-200'
                          : 'border-slate-800 bg-[#090d18] text-slate-400'
                      }`}
                    >
                      PBR微法线: {offlineQuality.pbrEnhanced ? '开' : '关'}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1">
                    {(['standard', 'high', 'ultra'] as ShadowQualityLevel[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        tabIndex={-1}
                        disabled={rendering}
                        onClick={() => updateOfflineQuality({ shadowQuality: lvl })}
                        className={`py-1 rounded-xs border text-[10px] cursor-pointer ${
                          offlineQuality.shadowQuality === lvl
                            ? 'border-amber-400 bg-amber-950/50 text-amber-200'
                            : 'border-slate-800 bg-[#090d18] text-slate-400'
                        }`}
                      >
                        阴影: {lvl === 'standard' ? '标准' : lvl === 'high' ? '高精' : '极限+接触'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-slate-400 leading-relaxed">
                离线阶段临时切换全原生分辨率缓冲并关闭帧率妥协，按 {offlineQuality.accumSamples}× Halton 亚像素采样消除锯齿与光追噪点。
              </p>
            </div>

            {/* Shot Summary Strip */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1 text-[10px] font-mono-tabular">
              <div className="flex justify-between text-slate-300">
                <span>运镜脚本</span>
                <span className="text-white">{selectedActionMeta.label}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>总渲染帧数</span>
                <span className="text-sky-300">
                  {totalFrames} 帧 ({plan.durationSec}s × {plan.fps} FPS)
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>浏览器编码引擎</span>
                <span className={hardwareCaps.webCodecsAvailable ? 'text-emerald-300' : 'text-amber-300'}>
                  {hardwareCaps.webCodecsAvailable ? 'WebCodecs 硬件加速可用' : 'PNG 序列回退'}
                </span>
              </div>
            </div>

            {/* Progress / Status */}
            {rendering && renderProgress && (
              <div
                data-testid="director-render-progress"
                className="rounded-xs border border-rose-500/40 bg-[#0d1322] p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-white">
                    {renderProgress.statusText}
                  </span>
                  <span className="font-mono-tabular text-rose-300">
                    {renderProgress.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-xs bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all duration-150"
                    style={{ width: `${Math.min(100, renderProgress.percent)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono-tabular text-slate-400">
                  <span>已用 {fmtTimeSec(renderProgress.elapsedSec)}</span>
                  <span>预计剩余 {fmtTimeSec(renderProgress.etaSec)}</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {renderProgress.encoderLabel}
                </div>
                {renderProgress.previewDataUrl && (
                  <img
                    src={renderProgress.previewDataUrl}
                    alt="渲染进度实时帧"
                    className="w-full h-24 object-cover rounded-xs border border-slate-700"
                  />
                )}
              </div>
            )}

            {renderError && (
              <div className="rounded-xs border border-rose-500/50 bg-rose-950/40 px-2.5 py-2 text-[11px] text-rose-200">
                {renderError}
              </div>
            )}

            {!rendering && lastVideo && (
              <div className="rounded-xs border border-emerald-500/50 bg-[#0d1322] p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono-tabular text-emerald-300">
                  <span>渲染完成 · {lastVideo.result.actualWidth}×{lastVideo.result.actualHeight} @ {lastVideo.result.fps}FPS</span>
                  <span>{fmtTimeSec(lastVideo.result.elapsedMs / 1000)}</span>
                </div>
                {lastVideo.objectUrl && (
                  <video
                    src={lastVideo.objectUrl}
                    controls
                    loop
                    playsInline
                    className="w-full max-h-36 rounded-xs border border-slate-700 bg-black"
                  />
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() =>
                    triggerBlobDownload(lastVideo.result.blob, lastVideo.result.filename)
                  }
                  className="w-full h-7 px-2 rounded-xs bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    再次下载 ({(lastVideo.result.blob.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer CTA for Render Tab */}
      {tab === 'render' && (
        <div className="p-2.5 border-t border-slate-800 bg-[#0d1322] flex items-center gap-2 shrink-0">
          {rendering ? (
            <button
              type="button"
              tabIndex={-1}
              data-testid="director-abort-render-btn"
              onClick={handleAbortRender}
              className="flex-1 h-8 px-3 rounded-xs bg-slate-700 hover:bg-rose-600 text-white text-xs font-medium cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5" />
              <span>中止离线渲染</span>
            </button>
          ) : (
            <button
              type="button"
              tabIndex={-1}
              data-testid="director-start-render-btn"
              onClick={() => void handleStartOfflineRender()}
              className="flex-1 h-8 px-3 rounded-xs bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Film className="w-3.5 h-3.5" />
              <span>开始离线渲染 ({plan.width}×{plan.height} · {plan.fps}FPS)</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
};
