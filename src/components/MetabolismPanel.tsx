import React from 'react';
import {
  Activity,
  Box,
  Cpu,
  Flame,
  FlaskConical,
  GitBranch,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  StepForward,
  X,
} from 'lucide-react';
import { SandboxConfig } from '../engine/webgpuScene';
import {
  FVM_RESOLUTION_PRESETS,
  FvmComputeBackendKind,
  FvmResolutionCells,
  MATTER_PHASE_LABELS,
  MatterPhase,
  MetabolismDemoMode,
  MetabolismSummarySnapshot,
  MetabolismVisualChannel,
  PlanetaryFeedbackConfig,
} from '../engine/metabolism';

interface MetabolismPanelProps {
  snapshot: MetabolismSummarySnapshot;
  config: SandboxConfig;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onSetMode: (mode: MetabolismDemoMode) => void;
  onSetBackend: (cellsPerAxis: FvmResolutionCells, backend: FvmComputeBackendKind) => void;
  onSetRunning: (running: boolean) => void;
  onStepOnce: () => void;
  onSetParams: (params: {
    feedRatePerSec?: number;
    exhaustRatePerSec?: number;
    ambientTempK?: number;
    timeScale?: number;
  }) => void;
  onInjectPerturbation: () => void;
  onRunBifurcationSweep: () => void;
  onRunMicroCalibration: (zoneId?: string) => void;
  onSetAutoCalibrate: (enabled: boolean) => void;
  onSetFeedbackConfig: (partial: Partial<PlanetaryFeedbackConfig>) => void;
  onClose: () => void;
}

const CHANNEL_OPTIONS: ReadonlyArray<{
  id: MetabolismVisualChannel;
  label: string;
}> = [
  { id: 'species', label: '组分浓度' },
  { id: 'energy', label: '内能温度' },
  { id: 'phase', label: '相态字段' },
  { id: 'flux', label: '通量 |J|' },
];

const RESOLUTION_TIERS: ReadonlyArray<FvmResolutionCells> = [24, 64, 96, 128];

export const MetabolismPanel: React.FC<MetabolismPanelProps> = ({
  snapshot,
  config,
  onUpdateConfig,
  onSetMode,
  onSetBackend,
  onSetRunning,
  onStepOnce,
  onSetParams,
  onInjectPerturbation,
  onRunBifurcationSweep,
  onRunMicroCalibration,
  onSetAutoCalibrate,
  onSetFeedbackConfig,
  onClose,
}) => {
  const {
    hypergraph,
    telemetry,
    history,
    zones,
    lastZoneBoundary,
    lastCalibrationRecord,
    feedbackConfig,
    feedbackStats,
    bifurcationReport,
  } = snapshot;
  const cons = telemetry.conservation;
  const activeChannel = config.metabolismChannel ?? snapshot.visualChannel ?? 'species';
  const overlayOn = config.terrainOverlay === 'metabolism';
  const [feedRateUi, setFeedRateUi] = React.useState(0.42);
  const [exhaustRateUi, setExhaustRateUi] = React.useState(0.36);

  React.useEffect(() => {
    setFeedRateUi(snapshot.mode === 'closed_equilibrium' ? 0 : 0.42);
    setExhaustRateUi(snapshot.mode === 'closed_equilibrium' ? 0 : 0.36);
  }, [snapshot.mode]);

  const chartW = 356;
  const chartH = 84;
  const padL = 6;
  const padR = 6;
  const padT = 8;
  const padB = 8;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  let maxConc = 1.2;
  let maxSigma = 0.05;
  for (const pt of history) {
    for (const c of pt.meanConcentrations) {
      if (c > maxConc) maxConc = c;
    }
    if (pt.totalEntropyProdRate > maxSigma) {
      maxSigma = pt.totalEntropyProdRate;
    }
  }

  const speciesPolylines = hypergraph.species.map((_, sIdx) => {
    if (history.length < 2) return '';
    return history
      .map((pt, i) => {
        const x = padL + (i / (history.length - 1)) * plotW;
        const val = pt.meanConcentrations[sIdx] ?? 0;
        const y = padT + (1 - Math.min(1, val / maxConc)) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  const sigmaPolyline =
    history.length >= 2
      ? history
          .map((pt, i) => {
            const x = padL + (i / (history.length - 1)) * plotW;
            const y = padT + (1 - Math.min(1, pt.totalEntropyProdRate / maxSigma)) * plotH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '';

  const bifW = 356;
  const bifH = 82;
  const bifPoints = bifurcationReport?.points ?? [];
  let maxBifVal = 1.0;
  for (const bp of bifPoints) {
    maxBifVal = Math.max(maxBifVal, bp.steadySubstrateS, bp.steadyAutocatalystX);
  }
  const bifXLine =
    bifPoints.length >= 2
      ? bifPoints
          .map((bp, i) => {
            const x = padL + (i / (bifPoints.length - 1)) * (bifW - padL - padR);
            const y = padT + (1 - Math.min(1, bp.steadyAutocatalystX / maxBifVal)) * (bifH - padT - padB);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '';
  const bifSLine =
    bifPoints.length >= 2
      ? bifPoints
          .map((bp, i) => {
            const x = padL + (i / (bifPoints.length - 1)) * (bifW - padL - padR);
            const y = padT + (1 - Math.min(1, bp.steadySubstrateS / maxBifVal)) * (bifH - padT - padB);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '';

  return (
    <aside
      data-testid="metabolism-panel"
      className="fixed top-12 right-3 z-20 w-[420px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-110px)] flex flex-col rounded-xs border border-slate-800 bg-[#090d18]/95 text-slate-200 shadow-2xl overflow-hidden pointer-events-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-[#0d1322] shrink-0">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <div className="text-xs font-semibold text-white tracking-wide">
              《Metabolism》多尺度耗散仿真台
            </div>
            <div className="text-[10px] text-slate-400 font-mono-tabular">
              {snapshot.computeBackend === 'webgpu' ? 'WebGPU Compute Ping-Pong' : 'CPU FVM 等价回退'} · {snapshot.resolutionCells}³ ({snapshot.totalGridVoxels.toLocaleString()} Vox)
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="metabolism-close-btn"
          onClick={onClose}
          className="p-1 rounded-xs border border-slate-800 bg-[#090d18] text-slate-400 hover:text-white cursor-pointer"
          title="关闭耗散仿真面板 (J)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="p-2.5 space-y-2 overflow-y-auto text-[11px]">
        {/* Pillar 1: WebGPU Compute Resolution & Backend Selector */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1 text-slate-200 font-medium">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>求解算力与网格体素密度</span>
            </span>
            <span className="font-mono-tabular text-cyan-300">
              {snapshot.gpuZeroReadbackActive ? 'GPU直采着色 · 零回读' : snapshot.webGpuSupported ? 'CPU 基准模式' : 'WebGL2 回退锁定 CPU'}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {RESOLUTION_TIERS.map((cells) => {
              const spec = FVM_RESOLUTION_PRESETS[cells];
              const locked = cells > 24 && !snapshot.webGpuSupported;
              const isSelected = snapshot.resolutionCells === cells;
              const targetBackend: FvmComputeBackendKind =
                cells === 24 && snapshot.computeBackend === 'cpu'
                  ? 'cpu'
                  : snapshot.webGpuSupported && cells >= 64
                    ? 'webgpu'
                    : 'cpu';
              return (
                <button
                  key={cells}
                  type="button"
                  disabled={locked}
                  data-testid={`metabolism-res-${cells}`}
                  onClick={() => onSetBackend(cells, targetBackend)}
                  title={locked ? '当前浏览器仅支持 WebGL2，请使用支持 WebGPU 的环境启用百万体素 GPU 求解' : spec.label}
                  className={`h-7 px-1 rounded-xs border text-[10px] font-mono-tabular transition-colors ${
                    locked
                      ? 'border-slate-800/60 bg-[#070a12] text-slate-600 cursor-not-allowed'
                      : isSelected
                        ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200 cursor-pointer'
                        : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white cursor-pointer'
                  }`}
                >
                  <div>{cells}³</div>
                  <div className="text-[8px] opacity-80">{cells === 24 ? '1.4万·CPU' : cells === 64 ? '26万·GPU' : cells === 96 ? '88万·GPU' : '209万·GPU'}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Regime Selector & Fixed Operator Stepper */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="metabolism-mode-closed"
              onClick={() => onSetMode('closed_equilibrium')}
              className={`h-7 px-2 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                snapshot.mode === 'closed_equilibrium'
                  ? 'border-sky-400 bg-sky-950/60 text-sky-200'
                  : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
              }`}
            >
              封闭平衡 (A⇌B⇌C)
            </button>
            <button
              type="button"
              data-testid="metabolism-mode-open"
              onClick={() => onSetMode('open_autocatalytic')}
              className={`h-7 px-2 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                snapshot.mode === 'open_autocatalytic'
                  ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
                  : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
              }`}
            >
              开放自催化耗散
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="metabolism-run-toggle"
              onClick={() => onSetRunning(!snapshot.running)}
              className={`h-7 px-2.5 rounded-xs border text-[11px] flex items-center gap-1 cursor-pointer ${
                snapshot.running
                  ? 'border-amber-500/70 bg-amber-950/50 text-amber-200'
                  : 'border-emerald-500/70 bg-emerald-950/50 text-emerald-200'
              }`}
            >
              {snapshot.running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{snapshot.running ? '暂停求解' : '运行求解'}</span>
            </button>

            <button
              type="button"
              data-testid="metabolism-step-btn"
              onClick={onStepOnce}
              className="h-7 px-2 rounded-xs border border-slate-700 bg-[#090d18] text-slate-200 hover:border-slate-500 flex items-center gap-1 cursor-pointer"
              title="执行单步固定算子分裂：先通量算子，后反应算子"
            >
              <StepForward className="w-3 h-3" />
              <span>单步</span>
            </button>

            <button
              type="button"
              data-testid="metabolism-reset-btn"
              onClick={() => onSetMode(snapshot.mode)}
              className="h-7 px-2 rounded-xs border border-slate-700 bg-[#090d18] text-slate-200 hover:border-slate-500 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>重置</span>
            </button>

            <button
              type="button"
              data-testid="metabolism-inject-btn"
              onClick={onInjectPerturbation}
              className="h-7 px-2 rounded-xs border border-cyan-600/70 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50 flex items-center gap-1 cursor-pointer ml-auto"
              title="向行星热泉耦合区注入活性晶种扰动"
            >
              <Sparkles className="w-3 h-3" />
              <span>+注入晶种</span>
            </button>
          </div>
        </div>

        {/* Strict Step Audit & Thermodynamic Readout */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5 font-mono-tabular">
          <div className="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800 pb-1">
            <span>算子序: 通量 → 本体内反应</span>
            <span>
              Step #{telemetry.stepIndex} · t={telemetry.simTimeSec.toFixed(2)}s
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-[10px]">
            <div className="rounded-xs border border-slate-800 bg-[#090d18] px-2 py-1">
              <div className="text-slate-400">质量守恒校验</div>
              <div className={cons.conserved ? 'text-emerald-300 font-semibold' : 'text-rose-400 font-semibold'}>
                {cons.conserved ? '守恒' : '偏差'} ({cons.relativeError.toExponential(1)})
              </div>
            </div>
            <div className="rounded-xs border border-slate-800 bg-[#090d18] px-2 py-1">
              <div className="text-slate-400">熵产率 σ</div>
              <div className="text-amber-300 font-semibold">
                {telemetry.totalEntropyProdRate.toFixed(3)}
              </div>
            </div>
            <div className="rounded-xs border border-slate-800 bg-[#090d18] px-2 py-1">
              <div className="text-slate-400">活跃 Vox / T</div>
              <div className="text-sky-300 font-semibold">
                {telemetry.activeCellCount.toLocaleString()} · {telemetry.meanTempK.toFixed(0)}K
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-400">
            <div>
              步前总质量: <span className="text-slate-200">{cons.totalMassPreKg.toFixed(2)} kg</span>
            </div>
            <div>
              反应后质量: <span className="text-slate-200">{cons.totalMassPostReactKg.toFixed(2)} kg</span>
            </div>
          </div>
        </div>

        {/* Open System Feed / Exhaust & Temperature Controls */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>系统边界与热力学驱动 ({snapshot.boundaryMode === 'open' ? '开放耗散' : '封闭绝热'})</span>
            <span className="font-mono-tabular text-slate-300">
              |J|={telemetry.meanFluxMagnitude.toFixed(4)}
            </span>
          </div>

          {snapshot.boundaryMode === 'open' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5">
                <div className="flex justify-between text-[10px] text-slate-400 font-mono-tabular">
                  <span>进料率 F</span>
                  <span className="text-emerald-300">{feedRateUi.toFixed(2)} /s</span>
                </div>
                <input
                  type="range"
                  min={0.02}
                  max={1.2}
                  step={0.02}
                  value={feedRateUi}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setFeedRateUi(v);
                    onSetParams({ feedRatePerSec: v });
                  }}
                  className="w-full accent-emerald-400 h-1.5 cursor-pointer"
                />
              </label>

              <label className="space-y-0.5">
                <div className="flex justify-between text-[10px] text-slate-400 font-mono-tabular">
                  <span>排废率 D</span>
                  <span className="text-amber-300">{exhaustRateUi.toFixed(2)} /s</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={1.0}
                  step={0.02}
                  value={exhaustRateUi}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setExhaustRateUi(v);
                    onSetParams({ exhaustRatePerSec: v });
                  }}
                  className="w-full accent-amber-400 h-1.5 cursor-pointer"
                />
              </label>
            </div>
          )}

          <label className="block space-y-0.5">
            <div className="flex justify-between text-[10px] text-slate-400 font-mono-tabular">
              <span>基准反应温度 T</span>
              <span className="text-sky-300">{telemetry.meanTempK.toFixed(0)} K</span>
            </div>
            <input
              type="range"
              min={180}
              max={760}
              step={5}
              value={Math.round(telemetry.meanTempK)}
              onChange={(e) => onSetParams({ ambientTempK: Number(e.target.value) })}
              className="w-full accent-sky-400 h-1.5 cursor-pointer"
            />
          </label>
        </div>

        {/* Pillar 2: PIC Local Micro-Calibrator (AABB) */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-medium text-slate-200">
              <Box className="w-3.5 h-3.5 text-cyan-400" />
              <span>PIC 耦合区局部微观校准器 (AABB)</span>
            </span>
            <button
              type="button"
              data-testid="metabolism-pic-test-btn"
              onClick={() => onRunMicroCalibration(zones[0]?.id)}
              className="h-6 px-2 rounded-xs border border-cyan-500/70 bg-cyan-950/50 text-cyan-200 hover:bg-cyan-900/60 text-[10px] cursor-pointer"
            >
              执行微观校准
            </button>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                data-testid="metabolism-autocal-toggle"
                checked={snapshot.autoCalibrateEnabled}
                onChange={(e) => onSetAutoCalibrate(e.target.checked)}
                className="accent-cyan-400"
              />
              <span>自动定期微观校准</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                data-testid="metabolism-zone-toggle"
                checked={Boolean(config.showCouplingZones)}
                onChange={(e) => onUpdateConfig({ showCouplingZones: e.target.checked })}
                className="accent-cyan-400"
              />
              <span>显示 AABB 线框</span>
            </label>
          </div>

          {lastCalibrationRecord && (
            <div
              data-testid="metabolism-pic-boundary-readout"
              className="rounded-xs border border-cyan-800/60 bg-cyan-950/20 px-2 py-1.5 text-[10px] font-mono-tabular text-cyan-100 space-y-1"
            >
              <div className="flex justify-between">
                <span>
                  样本: {lastCalibrationRecord.particleCount}粒 × {lastCalibrationRecord.microSteps}步 ({lastCalibrationRecord.durationMs.toFixed(1)}ms)
                </span>
                <span className="text-cyan-300">
                  孔隙φ={lastCalibrationRecord.meanPorosity.toFixed(2)} · MSD比={lastCalibrationRecord.msdHinderedOverFree.toFixed(2)}
                </span>
              </div>
              <div className="text-[9px] text-slate-300">
                扩散校准倍率: [{lastCalibrationRecord.diffusivityMultipliers.map((v) => `${v.toFixed(2)}x`).join(', ')}] · 碰撞:{lastCalibrationRecord.collisionEvents} · 反应:{lastCalibrationRecord.reactionEvents}
              </div>
              {lastCalibrationRecord.reactionDeltas.slice(0, 2).map((rd) => (
                <div key={rd.reactionIndex} className="text-[9px] text-slate-300 flex justify-between">
                  <span>
                    R{rd.reactionIndex} ({rd.reactionLabel})
                  </span>
                  <span>
                    A: {rd.baseA.toFixed(2)}→<span className="text-cyan-300">{rd.calibratedA.toFixed(2)}</span> · Ea: {Math.round(rd.baseEaJ)}→<span className="text-emerald-300">{Math.round(rd.calibratedEaJ)}J</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {!lastCalibrationRecord && lastZoneBoundary && (
            <div
              data-testid="metabolism-pic-boundary-readout"
              className="rounded-xs border border-cyan-800/60 bg-cyan-950/20 px-2 py-1 text-[10px] font-mono-tabular text-cyan-100"
            >
              采样 {lastZoneBoundary.sampledVoxCount} Vox · T={lastZoneBoundary.meanTempK.toFixed(1)}K · P={lastZoneBoundary.meanPressureAtm.toFixed(2)}atm
            </div>
          )}
        </div>

        {/* Pillar 3: Bidirectional Planetary Thermal & Mineralization Feedback */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-medium text-slate-200">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>行星双向热力 / 矿化反馈闭环</span>
            </span>
            <span className="font-mono-tabular text-[10px] text-slate-400">
              热源:{feedbackStats.activeThermalHotspots} · 矿化:{feedbackStats.totalMineralizedVoxels} / 蚀:{feedbackStats.totalCorrodedVoxels}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <label className="flex items-center gap-1.5 cursor-pointer text-amber-200">
              <input
                type="checkbox"
                data-testid="metabolism-thermal-feedback-toggle"
                checked={feedbackConfig.thermalFeedbackEnabled}
                onChange={(e) => onSetFeedbackConfig({ thermalFeedbackEnabled: e.target.checked })}
                className="accent-amber-400"
              />
              <Flame className="w-3 h-3 text-amber-400" />
              <span>反应放热注入热场</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-emerald-200">
              <input
                type="checkbox"
                data-testid="metabolism-mineral-feedback-toggle"
                checked={feedbackConfig.mineralizationEnabled}
                onChange={(e) => onSetFeedbackConfig({ mineralizationEnabled: e.target.checked })}
                className="accent-emerald-400"
              />
              <span>矿化析晶 / 酸蚀写回</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5">
              <div className="flex justify-between text-[10px] text-slate-400 font-mono-tabular">
                <span>放热增益</span>
                <span className="text-amber-300">{feedbackConfig.thermalGain.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={feedbackConfig.thermalGain}
                onChange={(e) => onSetFeedbackConfig({ thermalGain: Number(e.target.value) })}
                className="w-full accent-amber-400 h-1.5 cursor-pointer"
              />
            </label>
            <label className="space-y-0.5">
              <div className="flex justify-between text-[10px] text-slate-400 font-mono-tabular">
                <span>矿化速率</span>
                <span className="text-emerald-300">{feedbackConfig.mineralizationRate.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={feedbackConfig.mineralizationRate}
                onChange={(e) => onSetFeedbackConfig({ mineralizationRate: Number(e.target.value) })}
                className="w-full accent-emerald-400 h-1.5 cursor-pointer"
              />
            </label>
          </div>

          {feedbackStats.eventLogs.length > 0 && (
            <div className="rounded-xs border border-slate-800/80 bg-[#050810] px-2 py-1 text-[9px] font-mono-tabular text-slate-300 space-y-0.5">
              {feedbackStats.eventLogs.slice(0, 3).map((ev, i) => (
                <div key={`${ev.stepIndex}-${i}`} className="truncate">
                  <span className="text-slate-500">#{ev.stepIndex}</span> {ev.summary}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Read-only Decoupled Rendering Controls */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-200">
              只读场可视化映射 (渲染与仿真异步解耦)
            </span>
            <button
              type="button"
              data-testid="metabolism-terrain-overlay-toggle"
              onClick={() =>
                onUpdateConfig({
                  terrainOverlay: overlayOn ? 'material' : 'metabolism',
                })
              }
              className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer ${
                overlayOn
                  ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
                  : 'border-slate-700 bg-[#090d18] text-slate-300 hover:border-slate-500'
              }`}
            >
              {overlayOn ? '正在映射地形' : '启用地形场 [T]'}
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {CHANNEL_OPTIONS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                data-testid={`metabolism-channel-${ch.id}`}
                onClick={() =>
                  onUpdateConfig({
                    metabolismChannel: ch.id,
                    terrainOverlay: 'metabolism',
                  })
                }
                className={`h-6 rounded-xs border text-[10px] cursor-pointer ${
                  activeChannel === ch.id
                    ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
                    : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
                }`}
              >
                {ch.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time-Series Trajectory Chart */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-medium text-slate-200">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>组分平均浓度与熵产率曲线</span>
            </span>
            <div className="flex items-center gap-2 text-[10px] font-mono-tabular">
              {hypergraph.species.map((sp, i) => (
                <span
                  key={sp.key}
                  style={{
                    color: `rgb(${Math.round(sp.colorRgb[0] * 255)}, ${Math.round(sp.colorRgb[1] * 255)}, ${Math.round(sp.colorRgb[2] * 255)})`,
                  }}
                >
                  {sp.formulaTag}:{(telemetry.meanConcentrations[i] ?? 0).toFixed(2)}
                </span>
              ))}
            </div>
          </div>

          <svg
            viewBox={`0 0 ${chartW} ${chartH}`}
            className="w-full h-[84px] rounded-xs border border-slate-800/80 bg-[#050810]"
          >
            <line
              x1={padL}
              y1={padT + plotH * 0.5}
              x2={chartW - padR}
              y2={padT + plotH * 0.5}
              stroke="#1e293b"
              strokeDasharray="2 2"
            />
            {speciesPolylines.map((pts, idx) =>
              pts ? (
                <polyline
                  key={hypergraph.species[idx].key}
                  fill="none"
                  stroke={`rgb(${Math.round(hypergraph.species[idx].colorRgb[0] * 255)}, ${Math.round(hypergraph.species[idx].colorRgb[1] * 255)}, ${Math.round(hypergraph.species[idx].colorRgb[2] * 255)})`}
                  strokeWidth={1.7}
                  points={pts}
                />
              ) : null,
            )}
            {sigmaPolyline && (
              <polyline
                fill="none"
                stroke="#f59e0b"
                strokeWidth={1.2}
                strokeDasharray="3 2"
                points={sigmaPolyline}
              />
            )}
          </svg>
        </div>

        {/* Positive-Feedback Bifurcation Verification Sweep */}
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-medium text-slate-200">
              <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
              <span>自催化正反馈分岔验证 (Open System)</span>
            </span>
            <button
              type="button"
              data-testid="metabolism-bifurcation-btn"
              onClick={onRunBifurcationSweep}
              className="h-6 px-2 rounded-xs border border-emerald-500/70 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/60 text-[10px] cursor-pointer"
            >
              运行分岔扫参
            </button>
          </div>

          {bifurcationReport ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1 text-[10px] font-mono-tabular">
                <div className="rounded-xs border border-slate-800 bg-[#090d18] px-1.5 py-1">
                  <div className="text-slate-400">临界进料 F_crit</div>
                  <div className="text-emerald-300 font-semibold">
                    {bifurcationReport.criticalFeedRate !== null
                      ? `${bifurcationReport.criticalFeedRate.toFixed(2)} /s`
                      : '未跨越'}
                  </div>
                </div>
                <div className="rounded-xs border border-slate-800 bg-[#090d18] px-1.5 py-1">
                  <div className="text-slate-400">分岔跃迁 Δ[X]</div>
                  <div className="text-cyan-300 font-semibold">
                    +{bifurcationReport.jumpMagnitudeX.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xs border border-slate-800 bg-[#090d18] px-1.5 py-1">
                  <div className="text-slate-400">峰值熵产 σ_max</div>
                  <div className="text-amber-300 font-semibold">
                    {bifurcationReport.maxEntropyProdRate.toFixed(3)}
                  </div>
                </div>
              </div>

              <svg
                viewBox={`0 0 ${bifW} ${bifH}`}
                className="w-full h-[82px] rounded-xs border border-slate-800/80 bg-[#050810]"
              >
                {bifSLine && (
                  <polyline
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={1.3}
                    strokeDasharray="3 2"
                    points={bifSLine}
                  />
                )}
                {bifXLine && (
                  <polyline
                    fill="none"
                    stroke="#34d399"
                    strokeWidth={2}
                    points={bifXLine}
                  />
                )}
              </svg>
            </div>
          ) : (
            <div className="text-[10px] text-slate-400">
              扫描 F ∈ [0.04, 0.85]/s，验证低通量熄灭态向高通量自催化耗散分支的正反馈分岔跃迁。
            </div>
          )}

          {/* Phase Summary */}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 pt-0.5 text-[9px] text-slate-400 font-mono-tabular">
            {(Object.keys(telemetry.phaseCounts) as unknown as MatterPhase[]).map((ph) => {
              const count = telemetry.phaseCounts[ph] ?? 0;
              if (count === 0) return null;
              return (
                <span key={ph}>
                  {MATTER_PHASE_LABELS[ph]}: {count}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
};
