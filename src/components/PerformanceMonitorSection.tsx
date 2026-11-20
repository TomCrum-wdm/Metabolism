import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Gauge,
  HardDrive,
  Layers,
} from 'lucide-react';
import {
  BackendDiagnosticInfo,
  PerformanceMetricsSnapshot,
} from '../engine/perfMonitor';

interface PerformanceMonitorSectionProps {
  perf: PerformanceMetricsSnapshot;
  backendInfo: BackendDiagnosticInfo;
  simPaused: boolean;
}

function formatBytesMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}

export const PerformanceMonitorSection: React.FC<PerformanceMonitorSectionProps> = ({
  perf,
  backendInfo,
  simPaused,
}) => {
  const isWebGPU = backendInfo.backend === 'WebGPU';
  const hasWarning = backendInfo.isDowngraded || backendInfo.downgradeSeverity !== 'none';

  const chartData = useMemo(() => {
    const samples = perf.history;
    const W = 316;
    const H = 84;
    const padX = 2;
    const padY = 6;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;

    let maxMs = 20;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.frameMs > maxMs) maxMs = s.frameMs;
      if (s.gpuMs !== null && s.gpuMs > maxMs) maxMs = s.gpuMs;
      if (s.cpuTickMs > maxMs) maxMs = s.cpuTickMs;
    }
    const yCeiling = Math.min(100, Math.ceil(maxMs / 5) * 5);

    const toY = (ms: number): number => {
      const clamped = Math.max(0, Math.min(yCeiling, ms));
      return padY + innerH * (1 - clamped / yCeiling);
    };

    const count = samples.length;
    const stepX = count > 1 ? innerW / (count - 1) : innerW;

    let framePoints = '';
    let cpuPoints = '';
    let gpuPoints = '';
    let gpuCount = 0;

    for (let i = 0; i < count; i++) {
      const x = (padX + i * stepX).toFixed(1);
      const s = samples[i];
      framePoints += `${x},${toY(s.frameMs).toFixed(1)} `;
      cpuPoints += `${x},${toY(s.cpuTickMs).toFixed(1)} `;
      if (s.gpuMs !== null) {
        gpuPoints += `${x},${toY(s.gpuMs).toFixed(1)} `;
        gpuCount++;
      }
    }

    const line16msY = toY(16.67);
    const line8msY = toY(8.33);

    return {
      W,
      H,
      yCeiling,
      framePoints: framePoints.trim(),
      cpuPoints: cpuPoints.trim(),
      gpuPoints: gpuPoints.trim(),
      gpuCount,
      line16msY,
      line8msY,
      count,
    };
  }, [perf.history]);

  // Stacked time breakdown widths relative to max(16.67ms, total accounted ms)
  const breakdownBars = useMemo(() => {
    const gpuVal = perf.gpuTimeMs ?? 0;
    const otherCpu = Math.max(0, perf.cpuTickMs - perf.simStepMs - perf.meshBuildMs - perf.renderSubmitMs);
    const totalTracked = Math.max(
      16.67,
      perf.simStepMs + perf.meshBuildMs + perf.renderSubmitMs + otherCpu + gpuVal,
    );
    const pct = (v: number) => `${Math.max(0, (v / totalTracked) * 100).toFixed(1)}%`;
    return {
      simPct: pct(perf.simStepMs),
      meshPct: pct(perf.meshBuildMs),
      submitPct: pct(perf.renderSubmitMs),
      otherPct: pct(otherCpu),
      gpuPct: pct(gpuVal),
    };
  }, [perf]);

  const gpuToneClass =
    perf.gpuTimeMs === null
      ? 'text-slate-300'
      : perf.gpuTimeMs <= 8.3
        ? 'text-emerald-300'
        : perf.gpuTimeMs <= 16.6
          ? 'text-amber-300'
          : 'text-rose-300';

  const fpsToneClass =
    perf.fps >= 55
      ? 'text-emerald-300'
      : perf.fps >= 30
        ? 'text-amber-300'
        : 'text-rose-300';

  return (
    <div className="space-y-2.5" data-testid="perf-monitor-section">
      {/* 1. Rendering Backend Identity & Explicit Downgrade Warning Card */}
      <div
        data-testid="backend-diagnostic-card"
        className={`rounded-xs border p-2.5 space-y-1.5 ${
          backendInfo.downgradeSeverity === 'critical'
            ? 'border-rose-500/80 bg-rose-950/35'
            : hasWarning
              ? 'border-amber-500/80 bg-amber-950/30'
              : 'border-emerald-500/50 bg-[#0d1624]'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {hasWarning ? (
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${
                  backendInfo.downgradeSeverity === 'critical'
                    ? 'text-rose-400'
                    : 'text-amber-400'
                }`}
              />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className="font-semibold text-xs text-white truncate">
              渲染后端: {isWebGPU ? 'WebGPU' : 'WebGL2'}
            </span>
          </div>

          <span
            data-testid="backend-status-tag"
            className={`px-1.5 py-0.5 rounded-xs border text-[10px] font-mono-tabular font-semibold shrink-0 ${
              backendInfo.isDowngraded
                ? backendInfo.downgradeSeverity === 'critical'
                  ? 'border-rose-400/70 bg-rose-900/60 text-rose-100'
                  : 'border-amber-400/70 bg-amber-900/60 text-amber-100'
                : hasWarning
                  ? 'border-amber-400/70 bg-amber-900/60 text-amber-100'
                  : 'border-emerald-400/60 bg-emerald-950/70 text-emerald-200'
            }`}
          >
            {backendInfo.isDowngraded
              ? '⚠ 已从 WebGPU 降级'
              : backendInfo.isSoftwareRenderer
                ? '⚠ 软光栅模式'
                : backendInfo.isCompatibilityMode
                  ? '兼容受限模式'
                  : '原生硬件管线'}
          </span>
        </div>

        {hasWarning && (
          <div
            data-testid="backend-downgrade-reason"
            className={`text-[11px] leading-relaxed px-2 py-1.5 rounded-xs border ${
              backendInfo.downgradeSeverity === 'critical'
                ? 'border-rose-500/50 bg-rose-950/50 text-rose-100'
                : 'border-amber-500/50 bg-amber-950/45 text-amber-100'
            }`}
          >
            {backendInfo.downgradeReason}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono-tabular text-slate-300 pt-0.5">
          <div className="truncate" title={backendInfo.adapterLabel}>
            适配器: <span className="text-white">{backendInfo.adapterLabel}</span>
          </div>
          <div className="truncate">
            GPU 计时:{' '}
            <span
              className={
                backendInfo.gpuTimestampSupported ? 'text-emerald-300' : 'text-amber-300'
              }
            >
              {backendInfo.gpuTimestampSupported ? '硬件时间戳已开启' : '驱动未开放'}
            </span>
          </div>
          <div>
            画布分辨率:{' '}
            <span className="text-slate-100">
              {perf.canvasWidth}×{perf.canvasHeight} ({perf.pixelRatio.toFixed(2)}x)
            </span>
          </div>
          <div>
            最大纹理上限: <span className="text-slate-100">{backendInfo.maxTextureDim}px</span>
          </div>
        </div>
      </div>

      {/* 2. Key Real-time Performance Readouts (FPS, GPU Time, CPU Time, DrawCalls) */}
      <div className="grid grid-cols-2 gap-1.5 font-mono-tabular">
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <Gauge className="w-3 h-3 text-emerald-400" />
              渲染帧率 / 帧间隔
            </span>
            <span className="text-slate-500">P95 {perf.frameTimeP95Ms.toFixed(1)}ms</span>
          </div>
          <div className={`text-sm font-semibold mt-0.5 ${fpsToneClass}`}>
            {perf.fps} FPS{' '}
            <span className="text-[11px] font-normal text-slate-400">
              ({perf.frameTimeMs.toFixed(1)} ms)
            </span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            1% Low: <span className="text-slate-200">{perf.fps1PercentLow} FPS</span> · 瞬时{' '}
            {perf.fpsInstant} FPS
          </div>
        </div>

        <div
          data-testid="gpu-time-card"
          className="rounded-xs border border-slate-800 bg-[#0d1322] p-2"
        >
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-cyan-400" />
              GPU 渲染时间
            </span>
            <span className="text-slate-500">
              {perf.gpuTimeP95Ms !== null ? `P95 ${perf.gpuTimeP95Ms.toFixed(2)}ms` : ''}
            </span>
          </div>
          <div className={`text-sm font-semibold mt-0.5 ${gpuToneClass}`}>
            {perf.gpuTimeMs !== null
              ? `${perf.gpuTimeMs.toFixed(2)} ms`
              : backendInfo.gpuTimestampSupported
                ? '采样中...'
                : '无硬件时间戳'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={backendInfo.gpuTimestampSource}>
            {perf.gpuTimeLastMs !== null
              ? `最新 ${perf.gpuTimeLastMs.toFixed(2)}ms · ${backendInfo.gpuTimestampSource}`
              : `CPU 提交 ${perf.renderSubmitMs.toFixed(2)}ms`}
          </div>
        </div>

        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-sky-400" />
              CPU 总计算耗时
            </span>
            <span className="text-slate-500">{simPaused ? '物理已暂停' : '运行中'}</span>
          </div>
          <div className="text-sm font-semibold text-sky-300 mt-0.5">
            {perf.cpuTickMs.toFixed(2)} ms
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            物理 {perf.simStepMs.toFixed(2)} · 构网 {perf.meshBuildMs.toFixed(2)} · 提交{' '}
            {perf.renderSubmitMs.toFixed(2)}
          </div>
        </div>

        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-amber-400" />
              绘制批次 &amp; 显存
            </span>
            <span className="text-slate-500">{perf.renderPasses} Pass</span>
          </div>
          <div className="text-sm font-semibold text-white mt-0.5">
            {perf.drawCalls} DrawCalls
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
            <HardDrive className="w-2.5 h-2.5 text-slate-500 shrink-0" />
            <span>
              显存 {formatBytesMb(perf.gpuMemoryBytes)}
              {perf.jsHeapUsedMb !== null ? ` · JS ${perf.jsHeapUsedMb}MB` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Frame Pipeline Budget Bar + Live 60-Sample Timeline Graph */}
      <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 space-y-2">
        <div className="flex items-center justify-between text-[10px] font-mono-tabular">
          <span className="font-semibold text-slate-200">
            管线耗时拆解 &amp; 近 {chartData.count} 帧波形
          </span>
          <span className="text-slate-400">上限 {chartData.yCeiling}ms · 基准 16.6ms(60Hz)</span>
        </div>

        {/* Stacked Stage Breakdown Bar */}
        <div className="h-2 w-full rounded-xs bg-slate-900 border border-slate-800 overflow-hidden flex">
          <div
            style={{ width: breakdownBars.simPct }}
            className="bg-emerald-400 h-full"
            title={`物理/SPH/实体: ${perf.simStepMs.toFixed(2)} ms`}
          />
          <div
            style={{ width: breakdownBars.meshPct }}
            className="bg-amber-400 h-full"
            title={`体素/SVO网格构建: ${perf.meshBuildMs.toFixed(2)} ms`}
          />
          <div
            style={{ width: breakdownBars.submitPct }}
            className="bg-sky-400 h-full"
            title={`CPU渲染提交: ${perf.renderSubmitMs.toFixed(2)} ms`}
          />
          <div
            style={{ width: breakdownBars.otherPct }}
            className="bg-slate-500 h-full"
            title="射线/相机/其他逻辑"
          />
          {perf.gpuTimeMs !== null && (
            <div
              style={{ width: breakdownBars.gpuPct }}
              className="bg-cyan-400 h-full"
              title={`GPU硬件渲染执行: ${perf.gpuTimeMs.toFixed(2)} ms`}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] font-mono-tabular text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-emerald-400 inline-block" />
            物理 {perf.simStepMs.toFixed(1)}ms
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-amber-400 inline-block" />
            构网 {perf.meshBuildMs.toFixed(1)}ms
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-sky-400 inline-block" />
            提交 {perf.renderSubmitMs.toFixed(1)}ms
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-cyan-400 inline-block" />
            GPU {perf.gpuTimeMs !== null ? `${perf.gpuTimeMs.toFixed(1)}ms` : 'N/A'}
          </span>
        </div>

        {/* SVG Sparkline Chart */}
        <div className="relative rounded-xs border border-slate-800/90 bg-[#070b14] p-1">
          <svg
            viewBox={`0 0 ${chartData.W} ${chartData.H}`}
            className="w-full h-20 block"
            aria-label="帧耗时与GPU耗时波形图"
          >
            {/* 16.67ms (60Hz) target guide */}
            {chartData.line16msY >= 2 && chartData.line16msY <= chartData.H - 2 && (
              <line
                x1={0}
                x2={chartData.W}
                y1={chartData.line16msY}
                y2={chartData.line16msY}
                stroke="#f59e0b"
                strokeOpacity="0.45"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            )}
            {/* 8.33ms (120Hz) target guide */}
            {chartData.line8msY >= 2 && chartData.line8msY <= chartData.H - 2 && (
              <line
                x1={0}
                x2={chartData.W}
                y1={chartData.line8msY}
                y2={chartData.line8msY}
                stroke="#10b981"
                strokeOpacity="0.32"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
            )}

            {/* Total frame interval line */}
            {chartData.count >= 2 && (
              <polyline
                fill="none"
                stroke="#64748b"
                strokeWidth="1.2"
                points={chartData.framePoints}
              />
            )}
            {/* CPU Tick ms line */}
            {chartData.count >= 2 && (
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.4"
                points={chartData.cpuPoints}
              />
            )}
            {/* GPU Hardware ms line */}
            {chartData.gpuCount >= 2 && (
              <polyline
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1.7"
                points={chartData.gpuPoints}
              />
            )}
          </svg>
          <div className="flex items-center justify-between px-1 pt-0.5 text-[9px] font-mono-tabular text-slate-500">
            <span>灰线: 帧间隔 · 蓝线: CPU耗时 · 青线: GPU耗时</span>
            <span>
              网格 {perf.geometriesCount} / 纹理 {perf.texturesCount} / RT {perf.renderTargetsCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
