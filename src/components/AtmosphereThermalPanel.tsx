import React from 'react';
import { Cloud, Flame, RotateCcw, Sparkles, Thermometer, Wind, X } from 'lucide-react';
import { AtmosphereConfig, DEFAULT_ATMOS_CONFIG } from '../engine/atmosphere';
import { DirectorVisualFilter, VISUAL_FILTER_META } from '../engine/director';
import { DEFAULT_THERMAL_CONFIG, ThermalConfig } from '../engine/thermal';
import { TerrainOverlayMode, TerrainRenderMode } from '../engine/voxelPlanet';
import { SandboxConfig, SandboxTelemetry } from '../engine/webgpuScene';
import { NumericCadInput } from './NumericCadInput';

interface AtmosphereThermalPanelProps {
  telemetry: SandboxTelemetry;
  config: SandboxConfig;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onClose: () => void;
}

export const AtmosphereThermalPanel: React.FC<AtmosphereThermalPanelProps> = ({
  telemetry,
  config,
  onUpdateConfig,
  onClose,
}) => {
  const patchAtmos = (partial: Partial<AtmosphereConfig>) => {
    onUpdateConfig({
      atmosphere: {
        ...config.atmosphere,
        ...partial,
      },
    });
  };

  const patchThermal = (partial: Partial<ThermalConfig>) => {
    onUpdateConfig({
      thermal: {
        ...config.thermal,
        ...partial,
      },
    });
  };

  const resetDefaults = () => {
    onUpdateConfig({
      atmosphere: { ...DEFAULT_ATMOS_CONFIG },
      thermal: { ...DEFAULT_THERMAL_CONFIG },
    });
  };

  return (
    <aside
      data-testid="atmos-thermal-panel"
      className="fixed left-2.5 top-11 z-20 w-[336px] max-w-[calc(100vw-20px)] max-h-[calc(100vh-140px)] flex flex-col rounded-sm border border-slate-700/90 bg-[#090d18]/96 text-slate-100 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5 bg-[#060912]">
        <div className="flex items-center gap-1.5">
          <Cloud className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-display text-xs font-semibold text-white">
            大气、云层与三维温度场
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="恢复默认物理参数"
            onClick={resetDefaults}
            className="w-6 h-6 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-sky-400 text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <button
            type="button"
            aria-label="关闭大气与温度面板"
            onClick={onClose}
            className="w-6 h-6 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-slate-500 text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable CAD Inspector Body */}
      <div className="p-2.5 overflow-y-auto flex flex-col gap-2.5 text-[11px]">
        {/* Live Local Weather & Thermal Telemetry */}
        <div className="rounded-xs border border-slate-800 bg-[#050810] p-2 font-mono-tabular grid grid-cols-2 gap-x-2 gap-y-1">
          <span className="text-slate-400">当前位置气温</span>
          <span className="text-right text-amber-300 font-medium">
            {telemetry.localTempC.toFixed(1)}°C ({telemetry.localTempK.toFixed(0)}K)
          </span>

          <span className="text-slate-400">气候带 / 分层</span>
          <span className="text-right text-slate-100">
            {telemetry.thermalRegime} · {telemetry.atmoLayer}
          </span>

          <span className="text-slate-400">大气压 / 湿度</span>
          <span className="text-right text-cyan-300">
            {telemetry.localPressureAtm.toFixed(3)} atm ·{' '}
            {Math.round(telemetry.localHumidity * 100)}%
          </span>

          <span className="text-slate-400">科里奥利风速</span>
          <span className="text-right text-emerald-300">
            {telemetry.windSpeedMs.toFixed(1)} m/s
          </span>
        </div>

        {/* Voxel Mesh Style & 3D Visualization Overlay */}
        <div className="rounded-xs border border-slate-800 bg-[#060912] p-2 flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold text-slate-300">
            体素几何形态与三维场可视化
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                { id: 'smooth', label: '平滑等值面' },
                { id: 'blocky', label: '方块化 (MC体素)' },
              ] as ReadonlyArray<{ id: TerrainRenderMode; label: string }>
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                data-testid={`panel-render-${m.id}`}
                onClick={() => onUpdateConfig({ terrainRenderMode: m.id })}
                className={`h-7 rounded-xs border text-[11px] cursor-pointer ${
                  config.terrainRenderMode === m.id
                    ? 'border-sky-400 bg-sky-950/70 text-white'
                    : 'border-slate-800 bg-[#0d1322] text-slate-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="flex items-center justify-between pt-0.5 cursor-pointer">
            <span className="text-slate-400">显示体素方块边线网格</span>
            <input
              type="checkbox"
              checked={config.voxelEdges}
              onChange={(e) => onUpdateConfig({ voxelEdges: e.target.checked })}
              className="accent-sky-400"
            />
          </label>

          <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-800/80">
            {(
              [
                { id: 'material', label: '岩性材质' },
                { id: 'temperature', label: '三维温度场' },
                { id: 'density', label: '深度层析' },
              ] as ReadonlyArray<{ id: TerrainOverlayMode; label: string }>
            ).map((ov) => (
              <button
                key={ov.id}
                type="button"
                data-testid={`panel-overlay-${ov.id}`}
                onClick={() => onUpdateConfig({ terrainOverlay: ov.id })}
                className={`h-6 rounded-xs border text-[10px] cursor-pointer ${
                  config.terrainOverlay === ov.id
                    ? 'border-amber-400 bg-amber-950/60 text-amber-200'
                    : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                }`}
              >
                {ov.label}
              </button>
            ))}
          </div>
        </div>

        {/* GPU TSL Visual Filters (Sandbox Live Stylization) */}
        <div className="rounded-xs border border-slate-800 bg-[#060912] p-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1">
            <span className="flex items-center gap-1 font-semibold text-purple-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>实时艺术与光学视觉滤镜</span>
            </span>
            <span className="text-[10px] font-mono-tabular text-slate-400">
              {VISUAL_FILTER_META.find((m) => m.id === (config.visualFilter ?? 'none'))?.shortLabel ?? '原始光学'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {VISUAL_FILTER_META.map((fm) => {
              const active = (config.visualFilter ?? 'none') === fm.id;
              return (
                <button
                  key={fm.id}
                  type="button"
                  data-testid={`sandbox-filter-${fm.id}`}
                  title={fm.desc}
                  onClick={() =>
                    onUpdateConfig({
                      visualFilter: fm.id as DirectorVisualFilter,
                    })
                  }
                  className={`h-6 px-1 rounded-xs border text-[10px] truncate cursor-pointer ${
                    active
                      ? 'border-purple-400 bg-purple-950/70 text-white font-medium'
                      : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                  }`}
                >
                  {fm.shortLabel}
                </button>
              );
            })}
          </div>
          {(config.visualFilter ?? 'none') !== 'none' && (
            <div className="grid grid-cols-2 gap-x-2 pt-1">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400">滤镜混合强度</span>
                <NumericCadInput
                  value={config.filterIntensity ?? 0.85}
                  minValid={0}
                  sliderMin={0}
                  sliderMax={1}
                  sliderStep={0.02}
                  onChangeValue={(v) =>
                    onUpdateConfig({ filterIntensity: Math.max(0, Math.min(1, v)) })
                  }
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400">晶格/结构尺度</span>
                <NumericCadInput
                  value={config.filterScale ?? 1.0}
                  minValid={0.25}
                  unit="x"
                  sliderMin={0.25}
                  sliderMax={3.0}
                  sliderStep={0.05}
                  onChangeValue={(v) =>
                    onUpdateConfig({ filterScale: Math.max(0.25, Math.min(3.0, v)) })
                  }
                />
              </label>
            </div>
          )}
        </div>

        {/* Atmosphere & Cloud Deck Controls */}
        <div className="rounded-xs border border-slate-800 bg-[#060912] p-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1">
            <span className="flex items-center gap-1 font-semibold text-sky-300">
              <Wind className="w-3.5 h-3.5" />
              <span>行星大气与积云系统</span>
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[10px]">
              <span className="text-slate-400">
                {config.atmosphere.enabled ? '已开启' : '真空'}
              </span>
              <input
                type="checkbox"
                data-testid="atmos-enabled-toggle"
                checked={config.atmosphere.enabled}
                onChange={(e) => patchAtmos({ enabled: e.target.checked })}
                className="accent-sky-400"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">地表气压</span>
              <NumericCadInput
                value={config.atmosphere.surfacePressureAtm}
                minValid={0}
                unit="atm"
                testId="atmos-pressure-input"
                sliderMin={0}
                sliderMax={8}
                sliderStep={0.05}
                onChangeValue={(v) => patchAtmos({ surfacePressureAtm: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">标高比例 (H/R₀)</span>
              <NumericCadInput
                value={config.atmosphere.scaleHeightRatio}
                minValid={0.01}
                sliderMin={0.02}
                sliderMax={0.6}
                sliderStep={0.01}
                onChangeValue={(v) => patchAtmos({ scaleHeightRatio: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">瑞利散射强度</span>
              <NumericCadInput
                value={config.atmosphere.rayleighStrength}
                minValid={0}
                sliderMin={0}
                sliderMax={3}
                sliderStep={0.05}
                onChangeValue={(v) => patchAtmos({ rayleighStrength: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">米氏暮光气溶胶</span>
              <NumericCadInput
                value={config.atmosphere.mieHaze}
                minValid={0}
                sliderMin={0}
                sliderMax={2.5}
                sliderStep={0.05}
                onChangeValue={(v) => patchAtmos({ mieHaze: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">全球云层覆盖率</span>
              <NumericCadInput
                value={config.atmosphere.cloudCover}
                minValid={0}
                testId="atmos-cloud-input"
                sliderMin={0}
                sliderMax={2.0}
                sliderStep={0.02}
                onChangeValue={(v) => patchAtmos({ cloudCover: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">云层高度 (H/R₀)</span>
              <NumericCadInput
                value={config.atmosphere.cloudAltitudeRatio}
                minValid={0.02}
                sliderMin={0.03}
                sliderMax={0.5}
                sliderStep={0.01}
                onChangeValue={(v) => patchAtmos({ cloudAltitudeRatio: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">环流风速倍率</span>
              <NumericCadInput
                value={config.atmosphere.windSpeed}
                unit="x"
                sliderMin={0}
                sliderMax={6}
                sliderStep={0.1}
                onChangeValue={(v) => patchAtmos({ windSpeed: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">温室保温系数</span>
              <NumericCadInput
                value={config.atmosphere.greenhouseFactor}
                minValid={0}
                sliderMin={0}
                sliderMax={4}
                sliderStep={0.05}
                onChangeValue={(v) => patchAtmos({ greenhouseFactor: v })}
              />
            </label>
          </div>
        </div>

        {/* 3D Thermal Field Controls */}
        <div className="rounded-xs border border-slate-800 bg-[#060912] p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1 font-semibold text-amber-300 border-b border-slate-800 pb-1">
            <Thermometer className="w-3.5 h-3.5" />
            <span>三维温度热力学参数</span>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">恒星太阳常数</span>
              <NumericCadInput
                value={config.thermal.solarIrradiance}
                minValid={0}
                unit="W/m²"
                testId="thermal-solar-input"
                sliderScale="log"
                sliderMin={100}
                sliderMax={10000}
                onChangeValue={(v) => patchThermal({ solarIrradiance: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <Flame className="w-3 h-3 text-orange-400" />
                <span>地核温度</span>
              </span>
              <NumericCadInput
                value={config.thermal.coreTempC}
                unit="°C"
                testId="thermal-core-input"
                sliderMin={0}
                sliderMax={6000}
                sliderStep={50}
                onChangeValue={(v) => patchThermal({ coreTempC: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">直减率 (每标高)</span>
              <NumericCadInput
                value={config.thermal.lapseRateCPerScale}
                unit="°C"
                sliderMin={0}
                sliderMax={80}
                sliderStep={1}
                onChangeValue={(v) => patchThermal({ lapseRateCPerScale: v })}
              />
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">辐射基线偏移</span>
              <NumericCadInput
                value={config.thermal.baseEquilibriumC}
                unit="°C"
                sliderMin={-100}
                sliderMax={100}
                sliderStep={1}
                onChangeValue={(v) => patchThermal({ baseEquilibriumC: v })}
              />
            </label>
          </div>
        </div>
      </div>
    </aside>
  );
};
