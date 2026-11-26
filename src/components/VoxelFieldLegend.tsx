import React from 'react';
import { Box, Calculator, ChevronDown, ChevronUp, Lock, Unlock } from 'lucide-react';
import { SandboxConfig } from '../engine/webgpuScene';
import {
  MATTER_PHASE_LABELS,
  MatterPhase,
  MetabolismSummarySnapshot,
  MetabolismVisualChannel,
  VOXEL_MATERIAL_COMPOSITIONS,
  VoxChemicalProfile,
} from '../engine/metabolism';
import { MaterialId } from '../engine/voxelPlanet';

interface VoxelFieldLegendProps {
  config: SandboxConfig;
  snapshot: MetabolismSummarySnapshot;
  hoveredVoxProfile?: VoxChemicalProfile | null;
  voxLocked: boolean;
  metabolismOpen: boolean;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onToggleVoxLock: () => void;
  onOpenFormulas?: () => void;
}

const CHANNEL_TABS: ReadonlyArray<{
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

const PHASE_SWATCHES: ReadonlyArray<{
  phase: MatterPhase;
  short: string;
  rule: string;
  color: string;
}> = [
  { phase: MatterPhase.Solid, short: '固态', rule: 'T<273K 或 φ<0.15', color: '#426eb3' },
  { phase: MatterPhase.Liquid, short: '液态', rule: '273K~T_boil', color: '#17a6cf' },
  { phase: MatterPhase.Gas, short: '气态', rule: 'T≥T_boil(P)', color: '#bfd1e5' },
  { phase: MatterPhase.Supercritical, short: '超临界', rule: 'T≥647K & P≥25atm', color: '#f5b82e' },
  { phase: MatterPhase.Plasma, short: '等离子', rule: 'T≥3200K', color: '#ed59c7' },
];

const MINERAL_SWATCH_IDS: ReadonlyArray<{ id: MaterialId; color: string }> = [
  { id: MaterialId.Soil, color: '#785a3c' },
  { id: MaterialId.Stone, color: '#848b99' },
  { id: MaterialId.Basalt, color: '#3b4252' },
  { id: MaterialId.Crystal, color: '#38bdf8' },
  { id: MaterialId.Ice, color: '#93c5fd' },
  { id: MaterialId.Sandstone, color: '#d4a373' },
];

export const VoxelFieldLegend: React.FC<VoxelFieldLegendProps> = ({
  config,
  snapshot,
  hoveredVoxProfile,
  voxLocked,
  metabolismOpen,
  onUpdateConfig,
  onToggleVoxLock,
  onOpenFormulas,
}) => {
  const [collapsed, setCollapsed] = React.useState(false);

  const visible = config.terrainOverlay !== 'material' || metabolismOpen;
  if (!visible) return null;

  const isBlocky = config.terrainRenderMode === 'blocky';
  const channel: MetabolismVisualChannel = config.metabolismChannel ?? snapshot.visualChannel ?? 'species';
  const overlayLabel =
    config.terrainOverlay === 'metabolism'
      ? 'FVM 场着色'
      : config.terrainOverlay === 'temperature'
        ? '地热温度场'
        : config.terrainOverlay === 'density'
          ? '径向深度壳层'
          : '真实材质 (预览场)';

  const { hypergraph, telemetry } = snapshot;

  return (
    <aside
      data-testid="voxel-field-legend"
      className="w-full shrink-0 border-t border-slate-800 bg-[#080c15] text-slate-200 overflow-hidden"
    >
      {/* Header Strip */}
      <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 border-b border-slate-800 bg-[#0b101d]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold text-white whitespace-nowrap truncate">
            体素图例 · {overlayLabel}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            data-testid="legend-blocky-toggle"
            onClick={() =>
              onUpdateConfig({
                terrainRenderMode: isBlocky ? 'smooth' : 'blocky',
              })
            }
            className={`h-5 px-1.5 rounded-xs border text-[9.5px] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              isBlocky
                ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
                : 'border-slate-700 bg-[#090d18] text-slate-300 hover:border-slate-500'
            }`}
            title="切换地形网格模式：方块化体素网格 / 平滑表面 (V)"
          >
            <Box className="w-2.5 h-2.5 shrink-0" />
            <span>{isBlocky ? '方块化' : '平滑'} [V]</span>
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="h-5 w-5 rounded-xs border border-slate-800 bg-[#090d18] text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
            title={collapsed ? '展开图例' : '折叠图例'}
          >
            {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-2 space-y-2 text-[10px]">
          {/* Overlay mode or 6-channel quick switcher */}
          {(config.terrainOverlay === 'metabolism' || config.terrainOverlay === 'material') && (
            <>
              <div className="grid grid-cols-6 gap-0.5">
                {CHANNEL_TABS.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    data-testid={`legend-channel-${ch.id}`}
                    onClick={() =>
                      onUpdateConfig({
                        metabolismChannel: ch.id,
                        terrainOverlay: 'metabolism',
                      })
                    }
                    className={`h-5 rounded-xs border text-[9.5px] whitespace-nowrap cursor-pointer ${
                      channel === ch.id && config.terrainOverlay === 'metabolism'
                        ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200 font-medium'
                        : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                    }`}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>

              {/* Channel-specific scientific legend */}
              {channel === 'species' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9.5px] text-slate-400">
                    <span>主导反应组分 (mol/m³)</span>
                    <span className="font-mono-tabular text-slate-300">
                      共 {hypergraph.numSpecies} 种
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {hypergraph.species.map((sp) => {
                      const rgbStr = `rgb(${Math.round(sp.colorRgb[0] * 255)}, ${Math.round(sp.colorRgb[1] * 255)}, ${Math.round(sp.colorRgb[2] * 255)})`;
                      const meanVal = telemetry.meanConcentrations[sp.index] ?? 0;
                      return (
                        <div
                          key={sp.key}
                          className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded-xs border border-slate-800/80 bg-[#060911]"
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-[1px] shrink-0 border border-white/20"
                              style={{ backgroundColor: rgbStr }}
                            />
                            <span className="text-[9.5px] text-slate-200 truncate">
                              {sp.formulaTag}
                            </span>
                          </div>
                          <span className="font-mono-tabular text-[9px] text-slate-400 shrink-0">
                            {meanVal.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {channel === 'energy' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9.5px] text-slate-400">
                    <span>体素内能温度 T = e / C_v</span>
                    <span className="font-mono-tabular text-amber-300">
                      均值 {telemetry.meanTempK.toFixed(0)} K
                    </span>
                  </div>
                  <div
                    className="h-2.5 w-full rounded-xs border border-slate-700"
                    style={{
                      background:
                        'linear-gradient(90deg, #1a38a8 0%, #24c2a8 35%, #f2bd24 68%, #f73b1a 100%)',
                    }}
                  />
                  <div className="flex justify-between text-[9px] font-mono-tabular text-slate-400">
                    <span>220K 寒</span>
                    <span>298K 温</span>
                    <span>650K 热</span>
                    <span>1400K+</span>
                  </div>
                </div>
              )}

              {channel === 'phase' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9.5px] text-slate-400">
                    <span>五相态分布 (T, P, φ)</span>
                    <span className="font-mono-tabular text-slate-300">
                      {telemetry.activeCellCount} 单元
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {PHASE_SWATCHES.map((item) => (
                      <div
                        key={item.phase}
                        className="flex items-center justify-between text-[9px] px-1 py-0.5 rounded-xs bg-[#060911]"
                      >
                        <span className="flex items-center gap-1.5 text-slate-200">
                          <span
                            className="w-2.5 h-2.5 rounded-[1px] shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span>{item.short}</span>
                          <span className="text-slate-500">{item.rule}</span>
                        </span>
                        <span className="font-mono-tabular text-slate-300">
                          {telemetry.phaseCounts[item.phase] ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {channel === 'flux' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9.5px] text-slate-400">
                    <span>欧拉质量通量模 |J| (mol/m²·s)</span>
                    <span className="font-mono-tabular text-cyan-300">
                      均值 {telemetry.meanFluxMagnitude.toFixed(3)}
                    </span>
                  </div>
                  <div
                    className="h-2.5 w-full rounded-xs border border-slate-700"
                    style={{
                      background:
                        'linear-gradient(90deg, #141c2e 0%, #0ea5e9 52%, #78ffff 100%)',
                    }}
                  />
                  <div className="flex justify-between text-[9px] font-mono-tabular text-slate-400">
                    <span>0 静平衡</span>
                    <span>0.6 迁移流</span>
                    <span>2.0+ 强平流</span>
                  </div>
                </div>
              )}

              {channel === 'mineral' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9.5px] text-slate-400">
                    <span>矿物骨架 × 有效孔隙度 φ</span>
                    <span className="font-mono-tabular text-emerald-300">
                      φ ∈ [0.15, 1.00]
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {MINERAL_SWATCH_IDS.map((m) => {
                      const meta = VOXEL_MATERIAL_COMPOSITIONS[m.id];
                      return (
                        <div
                          key={m.id}
                          className="flex items-center gap-1 px-1 py-0.5 rounded-xs border border-slate-800/80 bg-[#060911]"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-[1px] shrink-0"
                            style={{ backgroundColor: m.color }}
                          />
                          <span className="text-[9px] text-slate-200 truncate">
                            {meta.materialNameZh.slice(0, 4)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[9px] text-slate-400">
                    亮边缘表示孔隙 φ 升高(酸蚀溶孔)，暗实块表示低孔隙矿化固结
                  </div>
                </div>
              )}

              {channel === 'rate' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9.5px] text-slate-400">
                    <span>局部熵产速率 σ (J/m³·K·s)</span>
                    <span className="font-mono-tabular text-amber-300">
                      总计 {telemetry.totalEntropyProdRate.toFixed(2)}
                    </span>
                  </div>
                  <div
                    className="h-2.5 w-full rounded-xs border border-slate-700"
                    style={{
                      background:
                        'linear-gradient(90deg, #171733 0%, #3080db 42%, #ff9926 78%, #fffacc 100%)',
                    }}
                  />
                  <div className="flex justify-between text-[9px] font-mono-tabular text-slate-400">
                    <span>0 热力学平衡</span>
                    <span>0.5 稳态耗散</span>
                    <span>1.5+ 自催化暴增</span>
                  </div>
                </div>
              )}
            </>
          )}

          {config.terrainOverlay === 'temperature' && (
            <div className="space-y-1">
              <div className="flex justify-between text-[9.5px] text-slate-400">
                <span>地热 / 光照温度场 (°C)</span>
                <span className="text-slate-300">14°C 等温线</span>
              </div>
              <div
                className="h-2.5 w-full rounded-xs border border-slate-700"
                style={{
                  background:
                    'linear-gradient(90deg, #2840b8 0%, #22d3ee 22%, #34d399 45%, #fbbf24 68%, #ef4444 86%, #fef08a 100%)',
                }}
              />
              <div className="flex justify-between text-[9px] font-mono-tabular text-slate-400">
                <span>-70°C</span>
                <span>20°C</span>
                <span>220°C</span>
                <span>850°C+</span>
              </div>
            </div>
          )}

          {config.terrainOverlay === 'density' && (
            <div className="space-y-1">
              <div className="flex justify-between text-[9.5px] text-slate-400">
                <span>行星四圈层结构 (r / R₀)</span>
                <span className="text-slate-300">0.1 R₀ 等深环</span>
              </div>
              <div
                className="h-2.5 w-full rounded-xs border border-slate-700"
                style={{
                  background:
                    'linear-gradient(90deg, #fef08a 0%, #f97316 24%, #991b1b 55%, #38bdf8 86%)',
                }}
              />
              <div className="grid grid-cols-4 gap-0.5 text-[8.5px] font-mono-tabular text-center">
                <span className="text-amber-200">&lt;0.17 内核</span>
                <span className="text-orange-300">0.30 外核</span>
                <span className="text-rose-300">0.79 地幔</span>
                <span className="text-sky-300">≥0.79 地壳</span>
              </div>
            </div>
          )}

          {(snapshot.geologicalStats.geologicalAgeMyr > 0 ||
            snapshot.geologicalStats.activeVolcanoCount > 0 ||
            snapshot.geologicalStats.quakeCount > 0) && (
            <div className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded-xs border border-slate-800/80 bg-[#060911] font-mono-tabular text-[9px] text-slate-300">
              <span className="text-amber-300">
                纪元 {snapshot.geologicalStats.geologicalAgeMyr.toFixed(1)}Myr
              </span>
              <span className="text-orange-300">
                火山 {snapshot.geologicalStats.activeVolcanoCount}
              </span>
              <span className="text-rose-300">
                地震 {snapshot.geologicalStats.quakeCount}
              </span>
            </div>
          )}

          {/* Active / Locked Single Voxel Probe Strip */}
          <div className="pt-1.5 border-t border-slate-800 space-y-1">
            {hoveredVoxProfile ? (
              <>
                <div className="flex items-center justify-between gap-1 font-mono-tabular">
                  <span className={voxLocked ? 'text-cyan-300 font-semibold' : 'text-amber-200'}>
                    {voxLocked ? '已锁定' : '悬停'} Vox[{hoveredVoxProfile.cellCoords.join(',')}]
                  </span>
                  <span className="text-slate-300">
                    {hoveredVoxProfile.temperatureK.toFixed(0)}K · φ={hoveredVoxProfile.porosity.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[9.5px] text-slate-300">
                  <span className="truncate">
                    {hoveredVoxProfile.materialComposition.materialNameZh} ·{' '}
                    {MATTER_PHASE_LABELS[hoveredVoxProfile.phase].split(' ')[0]}
                  </span>
                  <span className="font-mono-tabular text-emerald-300 shrink-0">
                    {hoveredVoxProfile.speciesConcentrations[hoveredVoxProfile.dominantSpeciesIndex]?.formulaTag ?? ''}{' '}
                    {(
                      hoveredVoxProfile.speciesConcentrations[hoveredVoxProfile.dominantSpeciesIndex]
                        ?.molPerM3 ?? 0
                    ).toFixed(2)}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-[9.5px] text-slate-400">
                将光标指向行星表面任意体素方块，按 <span className="text-cyan-300">L</span> 锁定实时代入计算
              </div>
            )}

            <div className="flex items-center gap-1 pt-0.5">
              <button
                type="button"
                data-testid="legend-vox-lock-btn"
                onClick={onToggleVoxLock}
                className={`h-5 flex-1 px-1.5 rounded-xs border text-[9.5px] flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
                  voxLocked
                    ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
                    : 'border-slate-700 bg-[#0d1322] text-slate-300 hover:border-slate-500'
                }`}
              >
                {voxLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                <span>{voxLocked ? '解锁体素 [L]' : '锁定当前体素 [L]'}</span>
              </button>

              {onOpenFormulas && (
                <button
                  type="button"
                  data-testid="legend-open-formulas-btn"
                  onClick={onOpenFormulas}
                  className="h-5 px-2 rounded-xs border border-emerald-500/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 text-[9.5px] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Calculator className="w-2.5 h-2.5" />
                  <span>公式代入</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
