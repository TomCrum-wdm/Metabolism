import React from 'react';
import {
  Compass,
  Cpu,
  LayoutPanelLeft,
  Monitor,
  RotateCcw,
  SlidersHorizontal,
  UserCheck,
  X,
} from 'lucide-react';
import { COORD_SYSTEM_SPECS, CoordSystemId } from '../engine/coordinates';
import {
  computeCharacterScaleMetrics,
  DEFAULT_PLAYER_SCALE,
  formatPlayerScaleLabel,
  MAX_PLAYER_SCALE,
  MIN_PLAYER_SCALE,
} from '../engine/cameraMath';
import {
  buildRenderQualityConfig,
  DEFAULT_RENDER_QUALITY,
  RayTracingMode,
  RENDER_QUALITY_PRESETS,
  RenderQualityConfig,
  RenderQualityPreset,
  ShadowQualityLevel,
} from '../engine/renderQuality';
import { DEFAULT_PLANET_RADIUS } from '../engine/gravity';
import { TerrainOverlayMode, TerrainRenderMode } from '../engine/voxelPlanet';
import { LodMode, SandboxConfig, SandboxTelemetry } from '../engine/webgpuScene';
import { NumericCadInput } from './NumericCadInput';

interface SystemSettingsPanelProps {
  config: SandboxConfig;
  telemetry: SandboxTelemetry;
  autoSaveEnabled: boolean;
  touchEnabled: boolean;
  leftDockOpen: boolean;
  bottomDockOpen: boolean;
  workspaceDensity: 'compact' | 'standard';
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onToggleAutoSave: (enabled: boolean) => void;
  onToggleTouch: () => void;
  onToggleLeftDock: () => void;
  onToggleBottomDock: () => void;
  onChangeDensity: (density: 'compact' | 'standard') => void;
  onResetAllDefaults: () => void;
  onClose: () => void;
}

const SCALE_PRESETS: ReadonlyArray<{ label: string; value: number; title: string }> = [
  { label: '10⁻⁷×', value: 1e-7, title: '微米纳米尺度 (0.0000001×)' },
  { label: '10⁻⁴×', value: 1e-4, title: '细胞微生物尺度 (0.0001×)' },
  { label: '10⁻²×', value: 0.01, title: '毫米微缩尺度 (0.01×)' },
  { label: '0.35×', value: DEFAULT_PLAYER_SCALE, title: '默认探索尺度 (0.35×)' },
  { label: '1×', value: 1, title: '标准人形比例 (1×)' },
  { label: '10³×', value: 1000, title: '巨构巨人尺度 (1,000×)' },
  { label: '10⁶×', value: 1e6, title: '行星泰坦尺度 (1,000,000×)' },
];

const OVERLAY_OPTIONS: ReadonlyArray<{ id: TerrainOverlayMode; label: string }> = [
  { id: 'material', label: '岩性材质' },
  { id: 'temperature', label: '温度场' },
  { id: 'pressure', label: '压力应力场' },
  { id: 'density', label: '圈层密度' },
  { id: 'lod', label: 'LOD网格' },
  { id: 'metabolism', label: '代谢场' },
];

export const SystemSettingsPanel: React.FC<SystemSettingsPanelProps> = ({
  config,
  telemetry,
  autoSaveEnabled,
  touchEnabled,
  leftDockOpen,
  bottomDockOpen,
  workspaceDensity,
  onUpdateConfig,
  onToggleAutoSave,
  onToggleTouch,
  onToggleLeftDock,
  onToggleBottomDock,
  onChangeDensity,
  onResetAllDefaults,
  onClose,
}) => {
  const rq: RenderQualityConfig = config.renderQuality ?? DEFAULT_RENDER_QUALITY;
  const planetScale = telemetry.planetRadius / DEFAULT_PLANET_RADIUS;
  const charMetrics = computeCharacterScaleMetrics(
    planetScale,
    config.playerScale,
    config.gravityScale,
    telemetry.nativeVoxelSize,
  );

  const patchQuality = (partial: Partial<RenderQualityConfig>) => {
    onUpdateConfig({
      renderQuality: { ...rq, ...partial },
    });
  };

  const rtLabels: Record<RayTracingMode, string> = {
    off: '关闭',
    ssr: 'SSR反射',
    ssgi_ssr: 'SSGI全追',
  };

  const shadowLabels: Record<ShadowQualityLevel, string> = {
    standard: '1K',
    high: '2K',
    ultra: '4K',
  };

  const padClass = workspaceDensity === 'compact' ? 'p-2 space-y-2' : 'p-2.5 space-y-2.5';

  return (
    <section
      data-testid="system-settings-panel"
      className="flex-1 min-h-0 flex flex-col bg-[#080c15] text-slate-200 overflow-hidden"
    >
      {/* Panel Header */}
      <div className="px-3 py-2 border-b border-slate-800 bg-[#0b101d] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-xs font-semibold text-white truncate">
              全局系统设置与参数标定
            </h2>
            <p className="text-[10px] font-mono-tabular text-slate-400 truncate">
              实时同步引擎 · 自动写入本地持久化配置
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            tabIndex={-1}
            data-testid="system-reset-defaults-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              onResetAllDefaults();
            }}
            title="清空自定义偏好并恢复全局默认设置"
            className="h-6 px-2 rounded-xs border border-slate-700 bg-[#080c15] hover:border-amber-400/80 text-[10px] text-slate-300 hover:text-amber-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <RotateCcw className="w-3 h-3 shrink-0" />
            <span>恢复默认</span>
          </button>
          <button
            type="button"
            tabIndex={-1}
            data-testid="system-settings-close-btn"
            onClick={onClose}
            aria-label="关闭系统设置"
            className="w-6 h-6 rounded-xs border border-slate-800 bg-[#080c15] hover:border-slate-500 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Engineering Parameters */}
      <div className={`flex-1 min-h-0 overflow-y-auto text-[11px] ${padClass}`}>
        {/* Section 1: Character Scale (Unrestricted) & Locomotion Kinematics */}
        <div className="rounded-xs border border-slate-800 bg-[#0c111d] p-2.5 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-white">
              <UserCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>角色多尺度比例与操控</span>
            </span>
            <span
              data-testid="system-scale-readout"
              className="font-mono-tabular text-[10.5px] text-cyan-300 font-semibold"
            >
              {formatPlayerScaleLabel(config.playerScale)}×
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
              <span>极微 10⁻¹² 至 极巨 10¹² (无级对数滑块 + 自由数值输入)</span>
              <span className="font-mono-tabular text-slate-300 shrink-0">
                眼高 {charMetrics.eyeHeight < 1e-3 || charMetrics.eyeHeight >= 1e5
                  ? `${charMetrics.eyeHeight.toExponential(1)}m`
                  : `${charMetrics.eyeHeight.toFixed(3)}m`}
              </span>
            </div>

            <NumericCadInput
              value={config.playerScale}
              minValid={MIN_PLAYER_SCALE}
              maxValid={MAX_PLAYER_SCALE}
              unit="×"
              ariaLabel="全局角色大小倍率"
              testId="system-player-scale-input"
              sliderScale="log"
              sliderMin={1e-7}
              sliderMax={1e6}
              onChangeValue={(v) => onUpdateConfig({ playerScale: v })}
            />

            <div className="grid grid-cols-7 gap-1 pt-0.5">
              {SCALE_PRESETS.map((preset) => {
                const isNear =
                  Math.abs(Math.log10(Math.max(1e-12, config.playerScale)) - Math.log10(preset.value)) < 0.08;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    tabIndex={-1}
                    data-testid={`scale-preset-${preset.value}`}
                    title={preset.title}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onUpdateConfig({ playerScale: preset.value });
                    }}
                    className={`h-6 px-0.5 rounded-xs border text-[9.5px] font-mono-tabular cursor-pointer whitespace-nowrap transition-colors ${
                      isNear
                        ? 'border-cyan-400 bg-cyan-950/70 text-cyan-200 font-semibold'
                        : 'border-slate-800 bg-[#080c15] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">视角灵敏度</span>
              <NumericCadInput
                value={config.mouseSensitivity ?? 1.0}
                minValid={0.1}
                maxValid={5.0}
                unit="×"
                ariaLabel="鼠标灵敏度"
                testId="system-mouse-sens-input"
                sliderMin={0.2}
                sliderMax={3.0}
                sliderStep={0.05}
                onChangeValue={(v) => onUpdateConfig({ mouseSensitivity: v })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">摄像机阻尼平滑</span>
              <NumericCadInput
                value={config.cameraDamping ?? 1.0}
                minValid={0.2}
                maxValid={4.0}
                unit="×"
                ariaLabel="摄像机阻尼"
                testId="system-camera-damping-input"
                sliderMin={0.3}
                sliderMax={2.5}
                sliderStep={0.05}
                onChangeValue={(v) => onUpdateConfig({ cameraDamping: v })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">移动速度倍率</span>
              <NumericCadInput
                value={config.fpsSpeedMult ?? 1.0}
                minValid={0.05}
                maxValid={20.0}
                unit="×"
                ariaLabel="漫游速度倍率"
                testId="system-speed-mult-input"
                sliderScale="log"
                sliderMin={0.1}
                sliderMax={5.0}
                onChangeValue={(v) => onUpdateConfig({ fpsSpeedMult: v })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">主相机广角 FOV</span>
              <NumericCadInput
                value={config.perspectiveFov}
                minValid={18}
                maxValid={115}
                unit="°"
                ariaLabel="视角FOV"
                testId="system-fov-input"
                sliderMin={18}
                sliderMax={115}
                sliderStep={1}
                onChangeValue={(v) => onUpdateConfig({ perspectiveFov: v })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">全局重力倍率</span>
              <NumericCadInput
                value={config.gravityScale}
                minValid={0}
                maxValid={100}
                unit="g"
                ariaLabel="重力系数"
                testId="system-gravity-input"
                sliderMin={0}
                sliderMax={4}
                sliderStep={0.05}
                onChangeValue={(v) => onUpdateConfig({ gravityScale: v })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">恒星高度角</span>
              <NumericCadInput
                value={config.sunElevationDeg}
                minValid={-90}
                maxValid={90}
                unit="°"
                ariaLabel="太阳高度角"
                testId="system-sun-el-input"
                sliderMin={-90}
                sliderMax={90}
                sliderStep={1}
                onChangeValue={(v) => onUpdateConfig({ sunElevationDeg: v })}
              />
            </label>
          </div>
        </div>

        {/* Section 2: Graphics, Ray Tracing & Voxel Surface */}
        <div className="rounded-xs border border-slate-800 bg-[#0c111d] p-2.5 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-white">
              <Monitor className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>渲染管线与体素表面质量</span>
            </span>
            <span className="font-mono-tabular text-[10px] text-slate-400">
              {RENDER_QUALITY_PRESETS.find((p) => p.id === rq.preset)?.shortLabel ?? rq.preset}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {RENDER_QUALITY_PRESETS.filter(
              (p): p is typeof p & { id: Exclude<RenderQualityPreset, 'offline_raytraced'> } =>
                p.id !== 'offline_raytraced',
            ).map((preset) => {
              const active = rq.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  tabIndex={-1}
                  data-testid={`sys-quality-${preset.id}`}
                  onClick={() =>
                    onUpdateConfig({ renderQuality: buildRenderQualityConfig(preset.id) })
                  }
                  className={`h-6 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap transition-colors ${
                    active
                      ? 'border-sky-400 bg-sky-950/75 text-sky-200 font-semibold'
                      : 'border-slate-800 bg-[#080c15] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {preset.shortLabel}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 block">实时光追策略</span>
              <div className="grid grid-cols-3 gap-0.5">
                {(['off', 'ssr', 'ssgi_ssr'] as ReadonlyArray<RayTracingMode>).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    tabIndex={-1}
                    onClick={() => patchQuality({ rayTracingMode: mode })}
                    className={`h-6 rounded-xs border text-[9.5px] cursor-pointer whitespace-nowrap ${
                      rq.rayTracingMode === mode
                        ? 'border-cyan-400 bg-cyan-950/70 text-cyan-200 font-medium'
                        : 'border-slate-800 bg-[#080c15] text-slate-400 hover:text-white'
                    }`}
                  >
                    {rtLabels[mode]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 block">阴影分辨率</span>
              <div className="grid grid-cols-3 gap-0.5">
                {(['standard', 'high', 'ultra'] as ReadonlyArray<ShadowQualityLevel>).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    tabIndex={-1}
                    onClick={() => patchQuality({ shadowQuality: lvl })}
                    className={`h-6 rounded-xs border text-[9.5px] cursor-pointer whitespace-nowrap ${
                      rq.shadowQuality === lvl
                        ? 'border-amber-400 bg-amber-950/70 text-amber-200 font-medium'
                        : 'border-slate-800 bg-[#080c15] text-slate-400 hover:text-white'
                    }`}
                  >
                    {shadowLabels[lvl]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <span className="text-[10px] text-slate-400 block mb-1">体素网格风格</span>
              <div className="grid grid-cols-2 gap-1">
                {(['smooth', 'blocky'] as ReadonlyArray<TerrainRenderMode>).map((m) => (
                  <button
                    key={m}
                    type="button"
                    tabIndex={-1}
                    onClick={() => onUpdateConfig({ terrainRenderMode: m })}
                    className={`h-6 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap ${
                      config.terrainRenderMode === m
                        ? 'border-emerald-400 bg-emerald-950/70 text-emerald-200'
                        : 'border-slate-800 bg-[#080c15] text-slate-300'
                    }`}
                  >
                    {m === 'smooth' ? '平滑等值面' : '方块化体素'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 block mb-1">地表物理场叠加</span>
              <select
                value={config.terrainOverlay}
                onChange={(e) =>
                  onUpdateConfig({ terrainOverlay: e.target.value as TerrainOverlayMode })
                }
                className="w-full h-6 rounded-xs border border-slate-700 bg-[#080c15] px-1.5 text-[10px] text-slate-200 focus:outline-none focus:border-sky-400"
              >
                {OVERLAY_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 border-t border-slate-800/80 text-[10.5px]">
            {[
              { key: 'pbrEnhanced' as const, label: 'PBR 程序纹理增强', val: rq.pbrEnhanced },
              { key: 'aoEnabled' as const, label: '屏幕环境光遮蔽 AO', val: rq.aoEnabled },
              { key: 'bloomEnabled' as const, label: '高光辉光 Bloom', val: rq.bloomEnabled },
              { key: 'volumetricFog' as const, label: '体积大气透视散射', val: rq.volumetricFog },
            ].map((item) => (
              <label key={item.key} className="flex items-center justify-between cursor-pointer">
                <span className="text-slate-300 truncate">{item.label}</span>
                <input
                  type="checkbox"
                  checked={item.val}
                  onChange={(e) => patchQuality({ [item.key]: e.target.checked })}
                  className="accent-sky-400 cursor-pointer"
                />
              </label>
            ))}

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 truncate">方块体素边线轮廓</span>
              <input
                type="checkbox"
                checked={config.voxelEdges}
                onChange={(e) => onUpdateConfig({ voxelEdges: e.target.checked })}
                className="accent-emerald-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 truncate">线框调试轮廓</span>
              <input
                type="checkbox"
                checked={config.wireframe}
                onChange={(e) => onUpdateConfig({ wireframe: e.target.checked })}
                className="accent-amber-400 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Section 3: Distant Horizons LOD & Streaming Budget */}
        <div className="rounded-xs border border-slate-800 bg-[#0c111d] p-2.5 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-white">
              <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>遥远地平线 LOD 与分块流式预算</span>
            </span>
            <span className="font-mono-tabular text-[10px] text-emerald-300">
              活动块 {telemetry.activeChunks}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {(['auto', 0, 1, 2] as ReadonlyArray<LodMode>).map((mode) => (
              <button
                key={String(mode)}
                type="button"
                tabIndex={-1}
                onClick={() => onUpdateConfig({ lodMode: mode })}
                className={`h-6 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap ${
                  config.lodMode === mode
                    ? 'border-emerald-400 bg-emerald-950/70 text-emerald-200 font-semibold'
                    : 'border-slate-800 bg-[#080c15] text-slate-300'
                }`}
              >
                {mode === 'auto' ? '自动分级' : `强制 LOD${mode}`}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">LOD0 阈值</span>
              <NumericCadInput
                value={config.lod0Dist}
                minValid={0.1}
                unit="m"
                ariaLabel="LOD0 距离阈值"
                sliderMin={2}
                sliderMax={Math.max(40, Math.round(telemetry.planetRadius * 3))}
                onChangeValue={(v) => onUpdateConfig({ lod0Dist: v })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">LOD1 阈值</span>
              <NumericCadInput
                value={config.lod1Dist}
                minValid={0.2}
                unit="m"
                ariaLabel="LOD1 距离阈值"
                sliderMin={4}
                sliderMax={Math.max(80, Math.round(telemetry.planetRadius * 6))}
                onChangeValue={(v) => onUpdateConfig({ lod1Dist: v })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">地平线流预算</span>
              <NumericCadInput
                value={config.horizonStreamBudget ?? 1.0}
                minValid={0.25}
                maxValid={4.0}
                unit="×"
                ariaLabel="远景网格重建预算"
                testId="system-horizon-budget-input"
                sliderMin={0.25}
                sliderMax={3.0}
                sliderStep={0.05}
                onChangeValue={(v) => onUpdateConfig({ horizonStreamBudget: v })}
              />
            </label>
          </div>
        </div>

        {/* Section 3B: Full GPU Voxel Pipeline & Multiphase Thermodynamic Fluid Engine */}
        <div className="rounded-xs border border-slate-800 bg-[#0c111d] p-2.5 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-white">
              <Cpu className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span>全 GPU 体素管线与多相地质流体</span>
            </span>
            <span className="font-mono-tabular text-[10px] text-orange-300">
              {telemetry.gpuVoxel?.active || telemetry.gpuFluidActive ? `${telemetry.backend} Compute` : `${telemetry.backend} 兼容回退`}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5 text-[10.5px]">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">启用全 GPU 体素剔除/压力/温度管线</span>
              <input
                type="checkbox"
                data-testid="sys-gpu-voxel-toggle"
                checked={config.gpuVoxelPipelineEnabled ?? true}
                onChange={(e) => onUpdateConfig({ gpuVoxelPipelineEnabled: e.target.checked })}
                className="accent-orange-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">启用 GPU 多相 PIC 流体 (水 / 熔岩 / 蒸汽)</span>
              <input
                type="checkbox"
                data-testid="sys-gpu-fluid-toggle"
                checked={config.gpuMultiphaseFluidEnabled ?? true}
                onChange={(e) => onUpdateConfig({ gpuMultiphaseFluidEnabled: e.target.checked })}
                className="accent-cyan-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">流体-岩石耦合 (高压侵蚀 / 岩浆冷却固结玄武岩)</span>
              <input
                type="checkbox"
                data-testid="sys-fluid-coupling-toggle"
                checked={config.fluidGeoCouplingEnabled ?? true}
                onChange={(e) => onUpdateConfig({ fluidGeoCouplingEnabled: e.target.checked })}
                className="accent-amber-400 cursor-pointer"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-800/80">
            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">岩浆注入温度</span>
              <NumericCadInput
                value={config.magmaInjectionTempK ?? 1480}
                minValid={950}
                maxValid={2400}
                unit="K"
                ariaLabel="岩浆注入温度"
                testId="sys-magma-temp-input"
                sliderMin={950}
                sliderMax={2200}
                sliderStep={10}
                onChangeValue={(v) => onUpdateConfig({ magmaInjectionTempK: v })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-slate-400 block">流体静压耦合倍率</span>
              <NumericCadInput
                value={config.fluidPressureScale ?? 1.0}
                minValid={0.1}
                maxValid={5.0}
                unit="×"
                ariaLabel="流体静压耦合倍率"
                testId="sys-pressure-scale-input"
                sliderMin={0.25}
                sliderMax={4.0}
                sliderStep={0.05}
                onChangeValue={(v) => onUpdateConfig({ fluidPressureScale: v })}
              />
            </label>
          </div>

          <div className="rounded-xs border border-slate-800/90 bg-[#060911] px-2 py-1.5 grid grid-cols-2 gap-x-2 gap-y-1 font-mono-tabular text-[10px]">
            <span className="text-slate-400">可见 GPU 体素实例</span>
            <span className="text-right text-slate-200">
              {(telemetry.gpuVoxel?.visibleSurfaceInstances ?? 0).toLocaleString()}
            </span>

            <span className="text-slate-400">流体多相 (水/熔/汽)</span>
            <span className="text-right text-cyan-300">
              {Math.round(telemetry.waterParticles)} /{' '}
              <span className="text-orange-400">{Math.round(telemetry.magmaParticles)}</span> /{' '}
              <span className="text-slate-200">{Math.round(telemetry.steamParticles)}</span>
            </span>

            <span className="text-slate-400">峰值压力 / 峰值温度</span>
            <span className="text-right text-amber-300">
              {telemetry.peakFluidPressureAtm.toFixed(1)} atm · {telemetry.peakFluidTempK.toFixed(0)}K
            </span>

            <span className="text-slate-400">Compute 耗时 / 显存</span>
            <span className="text-right text-emerald-300">
              {((telemetry.gpuVoxel?.lastDispatchMs ?? 0) + (telemetry.gpuFluid?.lastDispatchMs ?? 0)).toFixed(2)}ms ·{' '}
              {(((telemetry.gpuVoxel?.vramBytes ?? 0) + (telemetry.gpuFluid?.vramBytes ?? 0)) / (1024 * 1024)).toFixed(1)}MB
            </span>
          </div>
        </div>

        {/* Section 4: Coordinate Datum, Workspace Layout & Persistence */}
        <div className="rounded-xs border border-slate-800 bg-[#0c111d] p-2.5 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-white">
              <Compass className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>坐标系基准与工程工作区布局</span>
            </span>
          </div>

          <label className="space-y-1 block">
            <span className="text-[10px] text-slate-400 block">默认实时空间坐标系</span>
            <select
              data-testid="system-crs-select"
              value={config.coordSystem}
              onChange={(e) => onUpdateConfig({ coordSystem: e.target.value as CoordSystemId })}
              className="w-full h-7 rounded-xs border border-slate-700 bg-[#080c15] px-2 text-[11px] font-mono-tabular text-cyan-200 focus:outline-none focus:border-cyan-400"
            >
              {COORD_SYSTEM_SPECS.map((spec) => (
                <option key={spec.id} value={spec.id}>
                  [{spec.code}] {spec.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="flex items-center gap-1 text-slate-300">
              <LayoutPanelLeft className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>面板排布密度</span>
            </span>
            <div className="grid grid-cols-2 gap-1 w-36">
              {(['standard', 'compact'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  tabIndex={-1}
                  onClick={() => onChangeDensity(d)}
                  className={`h-6 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap ${
                    workspaceDensity === d
                      ? 'border-sky-400 bg-sky-950/70 text-sky-200'
                      : 'border-slate-800 bg-[#080c15] text-slate-400 hover:text-white'
                  }`}
                >
                  {d === 'standard' ? '标准舒展' : '紧凑工程'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 border-t border-slate-800/80 text-[10.5px]">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">显示三维经纬网</span>
              <input
                type="checkbox"
                checked={config.showCoordGrid}
                onChange={(e) => onUpdateConfig({ showCoordGrid: e.target.checked })}
                className="accent-cyan-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">显示引力矢量场</span>
              <input
                type="checkbox"
                checked={config.showGravityVectors}
                onChange={(e) => onUpdateConfig({ showGravityVectors: e.target.checked })}
                className="accent-sky-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">显示左侧工具箱</span>
              <input
                type="checkbox"
                checked={leftDockOpen}
                onChange={onToggleLeftDock}
                className="accent-sky-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">显示底部参数台</span>
              <input
                type="checkbox"
                checked={bottomDockOpen}
                onChange={onToggleBottomDock}
                className="accent-sky-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">定时自动保存世界</span>
              <input
                type="checkbox"
                checked={autoSaveEnabled}
                onChange={(e) => onToggleAutoSave(e.target.checked)}
                className="accent-emerald-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">触屏虚拟摇杆</span>
              <input
                type="checkbox"
                checked={touchEnabled}
                onChange={onToggleTouch}
                className="accent-cyan-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">全局音效静音 [M]</span>
              <input
                type="checkbox"
                checked={config.muted}
                onChange={(e) => onUpdateConfig({ muted: e.target.checked })}
                className="accent-amber-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-300">显示分块边界线</span>
              <input
                type="checkbox"
                checked={config.showChunkBounds}
                onChange={(e) => onUpdateConfig({ showChunkBounds: e.target.checked })}
                className="accent-sky-400 cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
};
