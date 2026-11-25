import React from 'react';
import {
  Activity,
  Atom,
  Box,
  Calculator,
  Cpu,
  Crosshair,
  Flame,
  FlaskConical,
  GitBranch,
  Layers,
  Lock,
  Microscope,
  Mountain,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  StepForward,
  Unlock,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { SandboxConfig } from '../engine/webgpuScene';
import {
  FVM_RESOLUTION_PRESETS,
  FvmComputeBackendKind,
  FvmResolutionCells,
  GeologicalEvolutionConfig,
  MATTER_PHASE_LABELS,
  MatterPhase,
  MetabolismDemoMode,
  MetabolismSummarySnapshot,
  MetabolismVisualChannel,
  PlanetaryFeedbackConfig,
  VoxChemicalProfile,
} from '../engine/metabolism';
import { MetabolismCycleDiagram } from './MetabolismCycleDiagram';
import { PeriodicTableView } from './PeriodicTableView';
import { FormulaVisualizerView } from './FormulaVisualizerView';

export type MetabolismPanelTab = 'cycle' | 'geology' | 'formulas' | 'cell' | 'periodic' | 'compute';

interface MetabolismPanelProps {
  snapshot: MetabolismSummarySnapshot;
  config: SandboxConfig;
  hoveredVoxProfile?: VoxChemicalProfile | null;
  voxLocked?: boolean;
  activeTabOverride?: { tab: MetabolismPanelTab; nonce: number } | null;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onToggleVoxLock?: () => void;
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
  onInjectNutrientBurst?: () => void;
  onFocusProtocell?: () => void;
  onRunBifurcationSweep: () => void;
  onRunMicroCalibration: (zoneId?: string) => void;
  onSetAutoCalibrate: (enabled: boolean) => void;
  onSetFeedbackConfig: (partial: Partial<PlanetaryFeedbackConfig>) => void;
  interiorCutawayEnabled?: boolean;
  onToggleInteriorCutaway?: () => void;
  onSetGeologicalConfig?: (partial: Partial<GeologicalEvolutionConfig>) => void;
  onTriggerGeoEvent?: (kind: 'volcano' | 'quake' | 'uplift' | 'erosion') => void;
  onRunDeepTimeEpoch?: (deltaMyr?: number) => void;
  onClose: () => void;
}

const CHANNEL_OPTIONS: ReadonlyArray<{
  id: MetabolismVisualChannel;
  label: string;
}> = [
  { id: 'species', label: '组分' },
  { id: 'energy', label: '内能T' },
  { id: 'phase', label: '相态' },
  { id: 'flux', label: '通量' },
  { id: 'mineral', label: '矿物' },
  { id: 'rate', label: '反应率' },
];

const MODE_OPTIONS: ReadonlyArray<{
  id: MetabolismDemoMode;
  label: string;
  testId: string;
  activeCls: string;
}> = [
  {
    id: 'planetary_carbon_water',
    label: '星球碳水双循环',
    testId: 'metabolism-mode-carbon-water',
    activeCls: 'border-cyan-400 bg-cyan-950/60 text-cyan-200',
  },
  {
    id: 'cellular_metabolism',
    label: '细胞ATP代谢流',
    testId: 'metabolism-mode-cellular',
    activeCls: 'border-emerald-400 bg-emerald-950/60 text-emerald-200',
  },
  {
    id: 'planetary_hydrology',
    label: '水圈三相相变',
    testId: 'metabolism-mode-hydrology',
    activeCls: 'border-sky-400 bg-sky-950/60 text-sky-200',
  },
  {
    id: 'open_autocatalytic',
    label: '开放自催化耗散',
    testId: 'metabolism-mode-open',
    activeCls: 'border-teal-400 bg-teal-950/60 text-teal-200',
  },
  {
    id: 'closed_equilibrium',
    label: '封闭平衡 (A⇌B⇌C)',
    testId: 'metabolism-mode-closed',
    activeCls: 'border-indigo-400 bg-indigo-950/60 text-indigo-200',
  },
];

const RESOLUTION_TIERS: ReadonlyArray<FvmResolutionCells> = [24, 64, 96, 128];

export const MetabolismPanel: React.FC<MetabolismPanelProps> = ({
  snapshot,
  config,
  hoveredVoxProfile,
  voxLocked = false,
  activeTabOverride,
  onUpdateConfig,
  onToggleVoxLock,
  onSetMode,
  onSetBackend,
  onSetRunning,
  onStepOnce,
  onSetParams,
  onInjectPerturbation,
  onInjectNutrientBurst,
  onFocusProtocell,
  onRunBifurcationSweep,
  onRunMicroCalibration,
  onSetAutoCalibrate,
  onSetFeedbackConfig,
  interiorCutawayEnabled = false,
  onToggleInteriorCutaway,
  onSetGeologicalConfig,
  onTriggerGeoEvent,
  onRunDeepTimeEpoch,
  onClose,
}) => {
  const {
    hypergraph,
    telemetry,
    cellularBio,
    history,
    zones,
    lastZoneBoundary,
    lastCalibrationRecord,
    feedbackConfig,
    feedbackStats,
    geologicalConfig,
    geologicalStats,
    bifurcationReport,
  } = snapshot;

  const [activeTab, setActiveTab] = React.useState<MetabolismPanelTab>('cycle');

  React.useEffect(() => {
    if (activeTabOverride) {
      setActiveTab(activeTabOverride.tab);
    }
  }, [activeTabOverride]);

  const cons = telemetry.conservation;
  const activeChannel = config.metabolismChannel ?? snapshot.visualChannel ?? 'species';
  const overlayOn = config.terrainOverlay === 'metabolism';
  const [feedRateUi, setFeedRateUi] = React.useState(0.36);
  const [exhaustRateUi, setExhaustRateUi] = React.useState(0.26);

  React.useEffect(() => {
    if (snapshot.mode === 'closed_equilibrium') {
      setFeedRateUi(0);
      setExhaustRateUi(0);
    } else if (snapshot.mode === 'cellular_metabolism') {
      setFeedRateUi(0.24);
      setExhaustRateUi(0.16);
    } else {
      setFeedRateUi(0.36);
      setExhaustRateUi(0.26);
    }
  }, [snapshot.mode]);

  const chartW = 356;
  const chartH = 80;
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
  const bifH = 78;
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
      className="fixed top-12 right-3 z-20 w-[436px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-110px)] flex flex-col rounded-xs border border-slate-800 bg-[#090d18]/95 text-slate-200 shadow-2xl overflow-hidden pointer-events-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-[#0d1322] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskConical className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white tracking-wide truncate">
              《Metabolism》行星与细胞多尺度耗散控制台
            </div>
            <div className="text-[10px] text-slate-400 font-mono-tabular truncate">
              {snapshot.computeBackend === 'webgpu' ? 'WebGPU Compute' : 'CPU FVM'} · {snapshot.resolutionCells}³ ({snapshot.totalGridVoxels.toLocaleString()} Vox) · {telemetry.meanTempK.toFixed(0)}K
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="metabolism-close-btn"
          onClick={onClose}
          className="p-1 rounded-xs border border-slate-800 bg-[#090d18] text-slate-400 hover:text-white cursor-pointer shrink-0"
          title="关闭耗散仿真面板 (J)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Top Scenario Switcher & Transport Strip */}
      <div className="px-2.5 py-2 border-b border-slate-800 bg-[#0b101d] space-y-1.5 shrink-0">
        <div className="grid grid-cols-3 gap-1">
          {MODE_OPTIONS.slice(0, 3).map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={m.testId}
              onClick={() => onSetMode(m.id)}
              className={`h-6 px-1.5 rounded-xs border text-[10px] font-medium whitespace-nowrap truncate cursor-pointer transition-colors ${
                snapshot.mode === m.id
                  ? m.activeCls
                  : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {MODE_OPTIONS.slice(3).map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={m.testId}
              onClick={() => onSetMode(m.id)}
              className={`h-6 px-1.5 rounded-xs border text-[10px] font-medium whitespace-nowrap truncate cursor-pointer transition-colors ${
                snapshot.mode === m.id
                  ? m.activeCls
                  : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Transport & Quick Action Controls */}
        <div className="flex items-center gap-1 pt-0.5">
          <button
            type="button"
            data-testid="metabolism-run-toggle"
            onClick={() => onSetRunning(!snapshot.running)}
            className={`h-6 px-2 rounded-xs border text-[10px] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
              snapshot.running
                ? 'border-amber-500/70 bg-amber-950/50 text-amber-200'
                : 'border-emerald-500/70 bg-emerald-950/50 text-emerald-200'
            }`}
          >
            {snapshot.running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{snapshot.running ? '暂停' : '运行'}</span>
          </button>

          <button
            type="button"
            data-testid="metabolism-step-btn"
            onClick={onStepOnce}
            className="h-6 px-2 rounded-xs border border-slate-700 bg-[#090d18] text-slate-200 hover:border-slate-500 flex items-center gap-1 text-[10px] whitespace-nowrap shrink-0 cursor-pointer"
            title="执行单步固定算子分裂：先通量算子，后反应算子"
          >
            <StepForward className="w-3 h-3" />
            <span>单步</span>
          </button>

          <button
            type="button"
            data-testid="metabolism-reset-btn"
            onClick={() => onSetMode(snapshot.mode)}
            className="h-6 px-2 rounded-xs border border-slate-700 bg-[#090d18] text-slate-200 hover:border-slate-500 flex items-center gap-1 text-[10px] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>重置</span>
          </button>

          {onFocusProtocell && (
            <button
              type="button"
              data-testid="metabolism-focus-cell-btn"
              onClick={onFocusProtocell}
              className="h-6 px-2 rounded-xs border border-emerald-500/70 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 flex items-center gap-1 text-[10px] whitespace-nowrap shrink-0 cursor-pointer ml-auto"
              title="飞掠至赤道热泉 PIC 耦合区特写视角观察 3D 原核细胞与布朗粒子"
            >
              <Crosshair className="w-3 h-3" />
              <span>聚焦细胞</span>
            </button>
          )}

          <button
            type="button"
            data-testid="metabolism-inject-btn"
            onClick={onInjectPerturbation}
            className="h-6 px-2 rounded-xs border border-cyan-600/70 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50 flex items-center gap-1 text-[10px] whitespace-nowrap shrink-0 cursor-pointer"
            title="向热泉耦合区注入活性组分扰动"
          >
            <Sparkles className="w-3 h-3" />
            <span>+脉冲</span>
          </button>
        </div>
      </div>

      {/* 6 Scientific Console Tabs */}
      <div className="grid grid-cols-6 border-b border-slate-800 bg-[#090d18] shrink-0">
        {(
          [
            { id: 'cycle', label: '循环图', icon: Activity },
            { id: 'geology', label: '地质', icon: Mountain },
            { id: 'formulas', label: '公式', icon: Calculator },
            { id: 'cell', label: '细胞', icon: Microscope },
            { id: 'periodic', label: '周期表', icon: Atom },
            { id: 'compute', label: '算力', icon: Cpu },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`metabolism-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`h-8 px-1 flex items-center justify-center gap-0.5 text-[10px] font-medium whitespace-nowrap border-b-2 cursor-pointer transition-colors ${
                active
                  ? 'border-cyan-400 bg-[#0d1322] text-cyan-200'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3 h-3 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Body */}
      <div className="p-2.5 space-y-2 overflow-y-auto text-[11px]">
        {/* TAB 1: CYCLE DIAGRAM & 3D FIELD VISUALIZATION */}
        {activeTab === 'cycle' && (
          <>
            <MetabolismCycleDiagram
              mode={snapshot.mode}
              hypergraph={hypergraph}
              telemetry={telemetry}
              cellularBio={cellularBio}
              running={snapshot.running}
            />

            {/* 3D Decoupled Visualization Controls */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-medium text-slate-200 whitespace-nowrap truncate">
                  3D 体素场视觉 (6通道)
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    data-testid="metabolism-blocky-toggle"
                    onClick={() =>
                      onUpdateConfig({
                        terrainRenderMode: config.terrainRenderMode === 'blocky' ? 'smooth' : 'blocky',
                      })
                    }
                    className={`h-6 px-1.5 rounded-xs border text-[10px] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                      config.terrainRenderMode === 'blocky'
                        ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
                        : 'border-slate-700 bg-[#090d18] text-slate-300 hover:border-slate-500'
                    }`}
                    title="切换方块化体素网格，清晰显示每个体素的场边界 [V]"
                  >
                    <Box className="w-3 h-3" />
                    <span>方块化 [V]</span>
                  </button>
                  <button
                    type="button"
                    data-testid="metabolism-terrain-overlay-toggle"
                    onClick={() =>
                      onUpdateConfig({
                        terrainOverlay: overlayOn ? 'material' : 'metabolism',
                      })
                    }
                    className={`h-6 px-2 rounded-xs border text-[10px] whitespace-nowrap shrink-0 cursor-pointer ${
                      overlayOn
                        ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
                        : 'border-slate-700 bg-[#090d18] text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {overlayOn ? '正在映射地形' : '启用地形场 [T]'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-6 gap-1">
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
                    className={`h-6 rounded-xs border text-[10px] whitespace-nowrap cursor-pointer ${
                      activeChannel === ch.id
                        ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
                        : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
                    }`}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-0.5 text-[10px] text-slate-300">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(config.showFvmVoxelBlocks ?? true)}
                    onChange={(e) => onUpdateConfig({ showFvmVoxelBlocks: e.target.checked })}
                    className="accent-cyan-400"
                  />
                  <span>3D离散FVM体块</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(config.showFvmFluxVectors ?? true)}
                    onChange={(e) => onUpdateConfig({ showFvmFluxVectors: e.target.checked })}
                    className="accent-sky-400"
                  />
                  <span>3D通量矢量箭头</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(config.showProtocell3d ?? true)}
                    onChange={(e) => onUpdateConfig({ showProtocell3d: e.target.checked })}
                    className="accent-emerald-400"
                  />
                  <span>3D原始细胞</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(config.showHoveredFvmVox ?? true)}
                    onChange={(e) => onUpdateConfig({ showHoveredFvmVox: e.target.checked })}
                    className="accent-amber-400"
                  />
                  <span>单Vox悬停框</span>
                </label>
              </div>
            </div>

            {/* Live Hovered / Locked FVM Voxel Telemetry Card */}
            {hoveredVoxProfile && (
              <div
                data-testid="metabolism-hovered-vox-card"
                className={`rounded-xs border p-2 space-y-1 text-[10px] font-mono-tabular ${
                  voxLocked
                    ? 'border-cyan-400/60 bg-cyan-950/20'
                    : 'border-amber-500/40 bg-[#0d1322]'
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-amber-200">
                  <span className={voxLocked ? 'text-cyan-200 font-semibold' : 'text-amber-200'}>
                    {voxLocked ? '已锁定' : '光标体素'} Vox[{hoveredVoxProfile.cellCoords.join(',')}] · {hoveredVoxProfile.materialComposition.materialNameZh}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {onToggleVoxLock && (
                      <button
                        type="button"
                        onClick={onToggleVoxLock}
                        className="h-5 px-1.5 rounded-xs border border-slate-700 bg-[#090d18] text-slate-200 hover:border-cyan-400 flex items-center gap-1 cursor-pointer"
                        title="锁定/解锁体素 [L]"
                      >
                        {voxLocked ? <Lock className="w-2.5 h-2.5 text-cyan-300" /> : <Unlock className="w-2.5 h-2.5" />}
                        <span>[L]</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveTab('formulas')}
                      className="h-5 px-1.5 rounded-xs border border-emerald-500/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 cursor-pointer"
                    >
                      公式代入
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[9.5px] text-slate-300">
                  <span>
                    {hoveredVoxProfile.temperatureK.toFixed(0)}K · {hoveredVoxProfile.pressureAtm.toFixed(2)}atm · φ={hoveredVoxProfile.porosity.toFixed(2)} · σ={hoveredVoxProfile.entropyProdRate.toFixed(3)}
                  </span>
                </div>
                <div className="text-[9px] text-slate-400">
                  主要元素质量比:{' '}
                  {hoveredVoxProfile.elementalBreakdown
                    .slice(0, 4)
                    .map((el) => `${el.symbol} ${el.weightPercent.toFixed(0)}%`)
                    .join(' · ')}
                </div>
              </div>
            )}

            {/* Time-Series Trajectory Chart */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-medium text-slate-200">
                  均值演化与熵产率曲线 (mol/m³ · σ)
                </span>
                <span className="text-[9.5px] font-mono-tabular text-amber-300">
                  步前 {cons.totalMassPreKg.toFixed(1)}kg → 步后 {cons.totalMassPostReactKg.toFixed(1)}kg
                </span>
              </div>

              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-[80px] rounded-xs border border-slate-800/80 bg-[#050810]"
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
          </>
        )}

        {/* TAB 2: GEOLOGICAL EVOLUTION & CORE-MANTLE-CRUST MORPHOGENESIS */}
        {activeTab === 'geology' && (
          <div className="space-y-2">
            {/* Deep-Time Planetary KPIs */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-100">
                  <Mountain className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>地质演化 · 沧海桑田实时总览</span>
                </span>
                <span className="font-mono-tabular text-[10px] text-amber-300">
                  纪元 {geologicalStats.geologicalAgeMyr.toFixed(2)} Myr
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 font-mono-tabular">
                <div className="rounded-xs border border-slate-800 bg-[#090d18] px-2 py-1">
                  <div className="text-[9px] text-slate-400">活火山 / 喷发锥</div>
                  <div className="text-xs font-semibold text-orange-300">
                    {geologicalStats.activeVolcanoCount} 座 · {geologicalStats.volcanicConeVoxels} 处
                  </div>
                </div>
                <div className="rounded-xs border border-slate-800 bg-[#090d18] px-2 py-1">
                  <div className="text-[9px] text-slate-400">构造地震</div>
                  <div className="text-xs font-semibold text-rose-300">
                    {geologicalStats.quakeCount} 次
                    {geologicalStats.lastQuakeMagMw !== null
                      ? ` (Mw ${geologicalStats.lastQuakeMagMw.toFixed(1)})`
                      : ''}
                  </div>
                </div>
                <div className="rounded-xs border border-slate-800 bg-[#090d18] px-2 py-1">
                  <div className="text-[9px] text-slate-400">造山 / 河蚀 / 海面</div>
                  <div className="text-xs font-semibold text-cyan-300">
                    +{geologicalStats.upliftedVoxels} / -{geologicalStats.erodedVoxels}
                  </div>
                </div>
              </div>
            </div>

            {/* Planetary Interior Cutaway & Radial Stratification */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10.5px] font-medium text-slate-200">
                <span>地核 · 地幔 · 地壳内部构造解剖</span>
                <span className="font-mono-tabular text-[9.5px] text-slate-400">
                  海平面偏移 {geologicalStats.seaLevelOffsetM >= 0 ? '+' : ''}
                  {geologicalStats.seaLevelOffsetM.toFixed(2)}m
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  data-testid="geology-cutaway-btn"
                  onClick={() => onToggleInteriorCutaway?.()}
                  className={`h-7 px-2 rounded-xs border text-[10px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    interiorCutawayEnabled
                      ? 'border-orange-400 bg-orange-950/60 text-orange-200'
                      : 'border-slate-700 bg-[#090d18] text-slate-200 hover:border-orange-400/70'
                  }`}
                >
                  {interiorCutawayEnabled ? '还原完整星球外壳' : '剖开地核·地幔·地壳'}
                </button>
                <button
                  type="button"
                  data-testid="geology-strata-overlay-btn"
                  onClick={() =>
                    onUpdateConfig({
                      terrainOverlay: config.terrainOverlay === 'density' ? 'material' : 'density',
                    })
                  }
                  className={`h-7 px-2 rounded-xs border text-[10px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    config.terrainOverlay === 'density'
                      ? 'border-sky-400 bg-sky-950/60 text-sky-200'
                      : 'border-slate-700 bg-[#090d18] text-slate-300 hover:border-sky-400/70'
                  }`}
                >
                  {config.terrainOverlay === 'density' ? '退出圈层视图' : '圈层着色图例'}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[9px] font-mono-tabular text-center">
                <div className="rounded-xs border border-amber-500/40 bg-[#090d18] py-0.5 text-amber-200">
                  内地核 &lt;0.17R₀
                </div>
                <div className="rounded-xs border border-orange-500/40 bg-[#090d18] py-0.5 text-orange-300">
                  外地核 0.17~0.30
                </div>
                <div className="rounded-xs border border-red-700/50 bg-[#090d18] py-0.5 text-rose-300">
                  地幔 0.30~0.79
                </div>
                <div className="rounded-xs border border-sky-500/40 bg-[#090d18] py-0.5 text-sky-300">
                  地壳 ≥0.79R₀
                </div>
              </div>
            </div>

            {/* Deep-Time Epoch Acceleration & One-Click Morphogenesis Triggers */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10.5px] font-medium text-slate-200">
                <span>深时地质演进速率 &amp; 灾害/造山诱导</span>
                <span className="font-mono-tabular text-[9.5px] text-cyan-300">
                  当前 {geologicalConfig.epochAcceleration}×
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {[1, 10, 25, 50].map((mult) => (
                  <button
                    key={mult}
                    type="button"
                    data-testid={`geology-speed-${mult}`}
                    onClick={() => onSetGeologicalConfig?.({ epochAcceleration: mult })}
                    className={`h-6 rounded-xs border text-[10px] font-mono-tabular cursor-pointer ${
                      geologicalConfig.epochAcceleration === mult
                        ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
                        : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
                    }`}
                  >
                    {mult}× 纪元
                  </button>
                ))}
              </div>

              <button
                type="button"
                data-testid="geology-deep-epoch-btn"
                onClick={() => onRunDeepTimeEpoch?.(10)}
                className="w-full h-7 rounded-xs border border-emerald-400/70 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-200 text-[10.5px] font-medium cursor-pointer transition-colors"
              >
                深时演化 +10 Myr（推进 FVM 通量并触发造山·喷发·断层·河蚀）
              </button>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  data-testid="geology-trigger-volcano"
                  onClick={() => onTriggerGeoEvent?.('volcano')}
                  className="h-6 px-2 rounded-xs border border-orange-500/60 bg-orange-950/35 hover:bg-orange-900/50 text-orange-200 text-[10px] flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <Flame className="w-3 h-3 shrink-0" />
                  <span>诱发活火山喷发</span>
                </button>
                <button
                  type="button"
                  data-testid="geology-trigger-quake"
                  onClick={() => onTriggerGeoEvent?.('quake')}
                  className="h-6 px-2 rounded-xs border border-rose-500/60 bg-rose-950/35 hover:bg-rose-900/50 text-rose-200 text-[10px] flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <Zap className="w-3 h-3 shrink-0" />
                  <span>触发构造地震</span>
                </button>
                <button
                  type="button"
                  data-testid="geology-trigger-uplift"
                  onClick={() => onTriggerGeoEvent?.('uplift')}
                  className="h-6 px-2 rounded-xs border border-amber-500/60 bg-amber-950/35 hover:bg-amber-900/50 text-amber-200 text-[10px] flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <Mountain className="w-3 h-3 shrink-0" />
                  <span>高原造山抬升</span>
                </button>
                <button
                  type="button"
                  data-testid="geology-trigger-erosion"
                  onClick={() => onTriggerGeoEvent?.('erosion')}
                  className="h-6 px-2 rounded-xs border border-sky-500/60 bg-sky-950/35 hover:bg-sky-900/50 text-sky-200 text-[10px] flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <Waves className="w-3 h-3 shrink-0" />
                  <span>大河雨季冲刷</span>
                </button>
              </div>

              <div className="flex items-center justify-between pt-0.5 text-[10px] text-slate-300">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={geologicalConfig.tectonicEvolutionEnabled}
                    onChange={(e) =>
                      onSetGeologicalConfig?.({ tectonicEvolutionEnabled: e.target.checked })
                    }
                    className="accent-orange-400"
                  />
                  <span>FVM 自动驱动构造/地貌</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={geologicalConfig.hydrologyCouplingEnabled}
                    onChange={(e) =>
                      onSetGeologicalConfig?.({ hydrologyCouplingEnabled: e.target.checked })
                    }
                    className="accent-sky-400"
                  />
                  <span>降水凝结 · 海洋消涨耦合</span>
                </label>
              </div>
            </div>

            {/* Geological Chronicle Log */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1">
              <div className="text-[10px] font-medium text-slate-300">星球地质编年日志</div>
              {geologicalStats.recentGeoEvents.length === 0 ? (
                <div className="text-[9.5px] text-slate-500">
                  等待 FVM 反应热通量积累，或点击上方按钮即时诱发地貌变迁。
                </div>
              ) : (
                <div className="space-y-0.5 max-h-[130px] overflow-y-auto font-mono-tabular text-[9px]">
                  {geologicalStats.recentGeoEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-2 px-1.5 py-0.5 rounded-xs border border-slate-800/80 bg-[#050810] text-slate-300"
                    >
                      <span className="truncate">{ev.summary}</span>
                      <span className="text-slate-500 shrink-0">{ev.ageMyr.toFixed(1)}Myr</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: FORMULA VISUALIZER & EQUATION EXPLORER */}
        {activeTab === 'formulas' && (
          <FormulaVisualizerView
            snapshot={snapshot}
            hoveredVoxProfile={hoveredVoxProfile}
            voxLocked={voxLocked}
            onToggleVoxLock={() => onToggleVoxLock?.()}
          />
        )}

        {/* TAB 3: CELLULAR BIOENERGETICS & PIC AABB CALIBRATOR */}
        {activeTab === 'cell' && (
          <>
            {/* Cellular Energetics KPIs */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-200">
                  原始细胞能量代谢与呼吸流
                </span>
                <div className="flex items-center gap-1">
                  {onInjectNutrientBurst && (
                    <button
                      type="button"
                      data-testid="metabolism-nutrient-burst-btn"
                      onClick={onInjectNutrientBurst}
                      className="h-6 px-2 rounded-xs border border-emerald-500/70 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/60 text-[10px] whitespace-nowrap cursor-pointer"
                    >
                      +糖/氧脉冲
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 font-mono-tabular">
                <div className="rounded-xs border border-slate-800 bg-[#090d18] p-2">
                  <div className="text-[9.5px] text-slate-400">ATP 合成通量</div>
                  <div className="text-base font-semibold text-emerald-300">
                    {cellularBio.atpSynthesisRateMmolLs.toFixed(2)}
                    <span className="text-[10px] text-slate-400 ml-1">mmol/L·s</span>
                  </div>
                </div>
                <div className="rounded-xs border border-slate-800 bg-[#090d18] p-2">
                  <div className="text-[9.5px] text-slate-400">呼吸商 RQ (CO₂/O₂)</div>
                  <div className="text-base font-semibold text-cyan-300">
                    {cellularBio.respiratoryQuotient.toFixed(2)}
                    <span className="text-[10px] text-slate-400 ml-1">ΔΨ {cellularBio.membranePotentialMv.toFixed(0)}mV</span>
                  </div>
                </div>
              </div>

              {/* Aerobic vs Anaerobic Metabolic Split Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono-tabular text-slate-300">
                  <span className="text-cyan-300">有氧呼吸 {cellularBio.aerobicSharePct.toFixed(1)}%</span>
                  <span className="text-amber-300">无氧酵解 {cellularBio.anaerobicSharePct.toFixed(1)}%</span>
                </div>
                <div className="w-full h-2 rounded-xs bg-[#050810] border border-slate-800 overflow-hidden flex">
                  <div
                    className="h-full bg-cyan-500"
                    style={{ width: `${Math.min(100, Math.max(0, cellularBio.aerobicSharePct))}%` }}
                  />
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${Math.min(100, Math.max(0, cellularBio.anaerobicSharePct))}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-[9.5px] font-mono-tabular text-slate-400">
                <div>生物量: <span className="text-slate-200">{cellularBio.protocellBiomassMolM3.toFixed(2)} M</span></div>
                <div>固碳率: <span className="text-emerald-300">{cellularBio.carbonFixationRate.toFixed(3)}</span></div>
                <div>净蒸发: <span className="text-sky-300">{cellularBio.netEvaporationRate.toFixed(3)}</span></div>
              </div>
            </div>

            {/* Thermodynamic Boundary Sliders */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>系统边界与热力学驱动 ({snapshot.boundaryMode === 'open' ? '开放耗散' : '封闭绝热'})</span>
                <span className="font-mono-tabular text-slate-300">T={telemetry.meanTempK.toFixed(0)} K</span>
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
                  <span>反应温度 T (阿伦尼乌斯与水圈相态驱动)</span>
                  <span className="text-sky-300">{telemetry.meanTempK.toFixed(0)} K ({(telemetry.meanTempK - 273.15).toFixed(0)}°C)</span>
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

            {/* PIC Local Micro-Calibrator (AABB) */}
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
                  className="h-6 px-2 rounded-xs border border-cyan-500/70 bg-cyan-950/50 text-cyan-200 hover:bg-cyan-900/60 text-[10px] whitespace-nowrap cursor-pointer"
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
                    扩散校准倍率: [{lastCalibrationRecord.diffusivityMultipliers.map((v) => `${v.toFixed(2)}x`).join(', ')}] · 碰撞:{lastCalibrationRecord.collisionEvents}
                  </div>
                  {lastCalibrationRecord.reactionDeltas.slice(0, 2).map((rd) => (
                    <div key={rd.reactionIndex} className="text-[9px] text-slate-300 flex justify-between">
                      <span className="truncate mr-2">R{rd.reactionIndex} ({rd.reactionLabel})</span>
                      <span className="whitespace-nowrap">
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
          </>
        )}

        {/* TAB 3: FULL 118 PERIODIC TABLE + COMPOUNDS + VOXEL MINERALS */}
        {activeTab === 'periodic' && (
          <PeriodicTableView
            hypergraph={hypergraph}
            hoveredVoxProfile={hoveredVoxProfile}
          />
        )}

        {/* TAB 4: WEBGPU COMPUTE + BIDIRECTIONAL FEEDBACK + BIFURCATION */}
        {activeTab === 'compute' && (
          <>
            {/* WebGPU Compute Resolution & Backend Selector */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="flex items-center gap-1 text-slate-200 font-medium">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  <span>求解算力与网格体素密度</span>
                </span>
                <span className="font-mono-tabular text-cyan-300">
                  {snapshot.gpuZeroReadbackActive ? 'GPU直采 · 零回读' : snapshot.webGpuSupported ? 'CPU 基准模式' : 'WebGL2 回退 CPU'}
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
                      className={`h-8 px-1 rounded-xs border text-[10px] font-mono-tabular transition-colors ${
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

            {/* Bidirectional Planetary Thermal & Mineralization Feedback */}
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
                  className="h-6 px-2 rounded-xs border border-emerald-500/70 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/60 text-[10px] whitespace-nowrap cursor-pointer"
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
                    className="w-full h-[78px] rounded-xs border border-slate-800/80 bg-[#050810]"
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
          </>
        )}
      </div>
    </aside>
  );
};
