import React, { useMemo, useState } from 'react';
import { VoxelFormatStats } from '../engine/voxelPlanet';
import {
  LodMode,
  SandboxConfig,
  SandboxTelemetry,
} from '../engine/webgpuScene';
import { NumericCadInput } from './NumericCadInput';
import { MaterialDonutChart } from './MaterialDonutChart';
import { PerformanceMonitorSection } from './PerformanceMonitorSection';
import {
  buildRenderQualityConfig,
  DEFAULT_RENDER_QUALITY,
  RayTracingMode,
  RENDER_QUALITY_PRESETS,
  RenderQualityConfig,
  RenderQualityPreset,
  ShadowQualityLevel,
} from '../engine/renderQuality';
import { MATTER_PHASE_LABELS } from '../engine/metabolism';

interface DebugMenuProps {
  telemetry: SandboxTelemetry;
  config: SandboxConfig;
  voxelStats: VoxelFormatStats;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onClose: () => void;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatMetric(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs > 0 && abs < 0.001) return v.toExponential(2);
  if (abs >= 1000) return v.toFixed(1);
  return Number(v.toFixed(digits)).toString();
}

export const DebugMenu: React.FC<DebugMenuProps> = ({
  telemetry,
  config,
  voxelStats,
  onUpdateConfig,
  onClose,
}) => {
  const [tab, setTab] = useState<'lod' | 'voxel'>('lod');

  const probe = telemetry.hoveredProbe;
  const totalTriangles = Math.round(telemetry.terrainVertices / 3);

  const solidPct = useMemo(() => {
    if (voxelStats.totalVoxels === 0) return '0.0';
    return ((voxelStats.solidVoxels / voxelStats.totalVoxels) * 100).toFixed(1);
  }, [voxelStats]);

  return (
    <aside
      data-testid="debug-menu"
      className="flex-1 min-h-0 flex flex-col bg-[#080c15] text-slate-200 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-[#0b101d] shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-display font-semibold text-xs text-white tracking-wide">
            调试与体素检查器
          </span>
          <span className="text-[10px] font-mono-tabular text-sky-300">
            [F3]
          </span>
        </div>
        <button
          type="button"
          tabIndex={-1}
          onClick={onClose}
          className="px-2 py-0.5 rounded-xs border border-slate-700 hover:border-slate-500 text-[11px] text-slate-300 hover:text-white cursor-pointer"
        >
          关闭
        </button>
      </div>

      {/* Tab Switcher */}
      <div className="grid grid-cols-2 border-b border-slate-800 text-[11px] font-medium">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setTab('lod')}
          className={`py-1.5 cursor-pointer transition-colors ${
            tab === 'lod'
              ? 'bg-slate-800/90 text-sky-300 border-b-2 border-sky-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          性能 &amp; LOD 调度
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setTab('voxel')}
          className={`py-1.5 cursor-pointer transition-colors ${
            tab === 'voxel'
              ? 'bg-slate-800/90 text-emerald-300 border-b-2 border-emerald-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          体素格式 &amp; 实时探针
        </button>
      </div>

      <div className="overflow-y-auto p-3 space-y-2.5 text-xs">
        {tab === 'lod' ? (
          <>
            {/* Comprehensive Backend & Hardware GPU/CPU Performance Monitor */}
            <PerformanceMonitorSection
              perf={telemetry.perf}
              backendInfo={telemetry.backendInfo}
              simPaused={config.simPaused}
            />

            {/* Render Quality, PBR, Ray Tracing, Volumetrics & Shadow Strategy */}
            {(() => {
              const rq: RenderQualityConfig = config.renderQuality ?? DEFAULT_RENDER_QUALITY;
              const patchQuality = (partial: Partial<RenderQualityConfig>) =>
                onUpdateConfig({
                  renderQuality: { ...rq, ...partial },
                });
              const rtLabel: Record<RayTracingMode, string> = {
                off: '关',
                ssr: 'SSR 反射',
                ssgi_ssr: 'SSGI+SSR 全追',
              };
              const shadowLabel: Record<ShadowQualityLevel, string> = {
                standard: '标准 1K',
                high: '高精 2K',
                ultra: '极限 4K+接触',
              };
              return (
                <div
                  data-testid="render-quality-panel"
                  className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 space-y-2"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-white">
                      画面质量与光线追踪策略
                    </span>
                    <span className="font-mono-tabular text-[10px] text-sky-300">
                      {RENDER_QUALITY_PRESETS.find((p) => p.id === rq.preset)?.shortLabel ?? rq.preset}
                    </span>
                  </div>

                  {/* Quality Presets */}
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
                          title={preset.desc}
                          data-testid={`quality-preset-${preset.id}`}
                          onClick={() =>
                            onUpdateConfig({
                              renderQuality: buildRenderQualityConfig(
                                preset.id,
                                telemetry.backendInfo.isSoftwareRenderer,
                              ),
                            })
                          }
                          className={`py-1 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                            active
                              ? 'border-sky-400 bg-sky-900/50 text-white'
                              : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {preset.shortLabel}
                        </button>
                      );
                    })}
                  </div>

                  {/* Ray Tracing Mode */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>屏幕空间光线追踪</span>
                      <span className="font-mono-tabular text-cyan-300">
                        {rtLabel[rq.rayTracingMode]}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['off', 'ssr', 'ssgi_ssr'] as RayTracingMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          tabIndex={-1}
                          onClick={() =>
                            patchQuality({
                              rayTracingMode: mode,
                              aoEnabled: mode === 'ssgi_ssr' ? true : rq.aoEnabled,
                            })
                          }
                          className={`py-1 rounded-xs border text-[10px] font-medium cursor-pointer transition-colors ${
                            rq.rayTracingMode === mode
                              ? 'border-cyan-400 bg-cyan-950/60 text-white'
                              : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {rtLabel[mode]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Shadow Precision */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>阴影质量与动态聚焦视锥</span>
                      <span className="font-mono-tabular text-amber-300">
                        {shadowLabel[rq.shadowQuality]}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['standard', 'high', 'ultra'] as ShadowQualityLevel[]).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          tabIndex={-1}
                          onClick={() =>
                            patchQuality({
                              shadowQuality: lvl,
                              contactShadows: lvl === 'ultra',
                            })
                          }
                          className={`py-1 rounded-xs border text-[10px] font-medium cursor-pointer transition-colors ${
                            rq.shadowQuality === lvl
                              ? 'border-amber-400 bg-amber-950/60 text-white'
                              : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {shadowLabel[lvl]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Feature Toggles */}
                  <div className="grid grid-cols-2 gap-1 pt-0.5 text-[10px]">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() =>
                        patchQuality({
                          pbrEnhanced: !rq.pbrEnhanced,
                          pbrReliefDepth: !rq.pbrEnhanced && (rq.pbrReliefDepth ?? 0) < 0.2 ? 1.15 : rq.pbrReliefDepth,
                        })
                      }
                      className={`py-1 px-2 rounded-xs border text-left cursor-pointer transition-colors ${
                        rq.pbrEnhanced
                          ? 'border-emerald-500/70 bg-emerald-950/40 text-emerald-200'
                          : 'border-slate-800 bg-[#090d18] text-slate-400'
                      }`}
                    >
                      PBR 子体素凹凸: {rq.pbrEnhanced ? '开' : '关'}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() =>
                        patchQuality({
                          volumetricFog: !(rq.volumetricFog && rq.atmoScattering),
                          atmoScattering: !(rq.volumetricFog && rq.atmoScattering),
                        })
                      }
                      className={`py-1 px-2 rounded-xs border text-left cursor-pointer transition-colors ${
                        rq.volumetricFog || rq.atmoScattering
                          ? 'border-sky-500/70 bg-sky-950/40 text-sky-200'
                          : 'border-slate-800 bg-[#090d18] text-slate-400'
                      }`}
                    >
                      体积雾 &amp; 散射: {rq.volumetricFog || rq.atmoScattering ? '开' : '关'}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => patchQuality({ aoEnabled: !rq.aoEnabled })}
                      className={`py-1 px-2 rounded-xs border text-left cursor-pointer transition-colors ${
                        rq.aoEnabled
                          ? 'border-indigo-500/70 bg-indigo-950/40 text-indigo-200'
                          : 'border-slate-800 bg-[#090d18] text-slate-400'
                      }`}
                    >
                      GTAO 遮蔽: {rq.aoEnabled ? '开' : '关'}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => patchQuality({ bloomEnabled: !rq.bloomEnabled })}
                      className={`py-1 px-2 rounded-xs border text-left cursor-pointer transition-colors ${
                        rq.bloomEnabled
                          ? 'border-amber-500/70 bg-amber-950/40 text-amber-200'
                          : 'border-slate-800 bg-[#090d18] text-slate-400'
                      }`}
                    >
                      HDR 泛光: {rq.bloomEnabled ? '开' : '关'}
                    </button>
                  </div>

                  {/* Sub-Voxel Protrusion Relief Strength */}
                  {rq.pbrEnhanced && (
                    <label className="block space-y-0.5 pt-1 border-t border-slate-800/80 text-[10px]">
                      <div className="flex justify-between text-slate-300">
                        <span>子体素 3D 突起深度 (POM + 自阴影)</span>
                        <span className="font-mono-tabular text-emerald-300">
                          {(rq.pbrReliefDepth ?? 1.15).toFixed(2)}×
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.2}
                        max={2.0}
                        step={0.05}
                        value={rq.pbrReliefDepth ?? 1.15}
                        onChange={(e) =>
                          patchQuality({ pbrReliefDepth: Number(e.target.value) })
                        }
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </label>
                  )}
                </div>
              );
            })()}

            {/* LOD Chunk Distribution */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-200">
                  分块 LOD (活跃 {telemetry.activeChunks} / {voxelStats.totalChunks} · {totalTriangles.toLocaleString()} 面)
                </span>
                <span className="font-mono-tabular text-slate-400">
                  {config.lodMode === 'auto'
                    ? '自适应'
                    : config.lodMode === 0
                      ? '强制 LOD0 · 全最小体素'
                      : `强制 LOD${config.lodMode}`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 font-mono-tabular text-center">
                <div className="rounded-xs bg-emerald-950/50 border border-emerald-700/40 py-1">
                  <div className="text-[10px] text-emerald-300">LOD 0 (8³)</div>
                  <div className="text-xs font-semibold text-white">{telemetry.lodCounts[0]}</div>
                </div>
                <div className="rounded-xs bg-sky-950/50 border border-sky-700/40 py-1">
                  <div className="text-[10px] text-sky-300">LOD 1 (4³)</div>
                  <div className="text-xs font-semibold text-white">{telemetry.lodCounts[1]}</div>
                </div>
                <div className="rounded-xs bg-amber-950/50 border border-amber-700/40 py-1">
                  <div className="text-[10px] text-amber-300">LOD 2 (2³)</div>
                  <div className="text-xs font-semibold text-white">{telemetry.lodCounts[2]}</div>
                </div>
                <div className="rounded-xs bg-slate-900 border border-slate-800 py-1">
                  <div className="text-[10px] text-slate-400">空/剔除</div>
                  <div className="text-xs font-semibold text-slate-300">{telemetry.lodCounts[3]}</div>
                </div>
              </div>

              {/* LOD Mode Selector */}
              <div className="grid grid-cols-4 gap-1 pt-0.5">
                {(['auto', 0, 1, 2] as LodMode[]).map((mode) => (
                  <button
                    key={String(mode)}
                    type="button"
                    tabIndex={-1}
                    title={
                      mode === 0
                        ? '关闭距离降级：当前视野/全星均匀显示最小体素'
                        : mode === 'auto'
                          ? '根据视角与距离自适应细节'
                          : `强制限制在 LOD ${mode}`
                    }
                    onClick={() => onUpdateConfig({ lodMode: mode })}
                    className={`py-1 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                      config.lodMode === mode
                        ? 'border-sky-400 bg-sky-900/50 text-white'
                        : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mode === 'auto' ? 'Auto' : mode === 0 ? 'LOD 0 全精' : `LOD ${mode}`}
                  </button>
                ))}
              </div>

              {/* Unrestricted LOD Distance Thresholds */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400">LOD0 → LOD1 距离</span>
                  <NumericCadInput
                    value={config.lod0Dist}
                    minValid={0.1}
                    unit="m"
                    ariaLabel="LOD0 切换距离"
                    testId="debug-lod0-dist-input"
                    sliderMin={1}
                    sliderMax={Math.max(100, Math.round(telemetry.planetRadius * 5))}
                    sliderStep={0.5}
                    onChangeValue={(v) => onUpdateConfig({ lod0Dist: v })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400">LOD1 → LOD2 距离</span>
                  <NumericCadInput
                    value={config.lod1Dist}
                    minValid={0.1}
                    unit="m"
                    ariaLabel="LOD1 切换距离"
                    testId="debug-lod1-dist-input"
                    sliderMin={2}
                    sliderMax={Math.max(150, Math.round(telemetry.planetRadius * 8))}
                    sliderStep={0.5}
                    onChangeValue={(v) => onUpdateConfig({ lod1Dist: v })}
                  />
                </label>
              </div>
            </div>

            {/* Visual Debug Toggles */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onUpdateConfig({ wireframe: !config.wireframe })}
                className={`py-1.5 px-2.5 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                  config.wireframe
                    ? 'border-sky-400 bg-sky-900/40 text-sky-200'
                    : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                }`}
              >
                网格线框: {config.wireframe ? '开' : '关'}
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() =>
                  onUpdateConfig({ showChunkBounds: !config.showChunkBounds })
                }
                className={`py-1.5 px-2.5 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                  config.showChunkBounds
                    ? 'border-emerald-400 bg-emerald-900/40 text-emerald-200'
                    : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                }`}
              >
                LOD 分块框: {config.showChunkBounds ? '开' : '关'}
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onUpdateConfig({ simPaused: !config.simPaused })}
                className={`py-1.5 px-2.5 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                  config.simPaused
                    ? 'border-amber-400 bg-amber-900/40 text-amber-200'
                    : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                }`}
              >
                模拟状态: {config.simPaused ? '已冻结' : '运行中'}
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() =>
                  onUpdateConfig({
                    showGravityVectors: !config.showGravityVectors,
                  })
                }
                className={`py-1.5 px-2.5 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                  config.showGravityVectors
                    ? 'border-sky-400 bg-sky-900/40 text-sky-200'
                    : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                }`}
              >
                引力矢量: {config.showGravityVectors ? '开' : '关'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Voxel Data Format Specification */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 space-y-2">
              <div className="font-semibold text-[11px] text-emerald-300">
                数据结构与二进制内存布局
              </div>
              <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 font-mono-tabular text-[11px] text-slate-300">
                <div>全量 360° 网格: {voxelStats.fullCellsPerAxis.toLocaleString()}³</div>
                <div>总虚拟体素: {voxelStats.fullTotalVoxelsLabel}</div>
                <div>八叉树深度: L{voxelStats.octreeDepth} ({voxelStats.fullChunksPerAxis.toLocaleString()}³块)</div>
                <div>驻留宏观缓存: {voxelStats.cellsPerAxis}³ ({voxelStats.chunksPerAxis}³×{voxelStats.chunkCells}³)</div>
                <div>方块半径: {voxelStats.voxelRadius.toLocaleString()} 块</div>
                <div>原生块尺寸: {formatMetric(voxelStats.nativeVoxelSize, 4)} m</div>
                <div>宏步长: {formatMetric(voxelStats.voxelSize, 4)} m</div>
                <div>
                  稀疏流式块:{' '}
                  {voxelStats.isSparseStreaming
                    ? `${voxelStats.sparseActiveChunks} 活跃`
                    : `全量 ${voxelStats.cellsPerAxis}³`}
                </div>
                <div>空间范围: ±{formatMetric(voxelStats.worldHalf, 2)} m</div>
                <div>实心占空比: {solidPct}%</div>
              </div>
              <div className="pt-1.5 border-t border-slate-800/80 space-y-1 font-mono-tabular text-[11px]">
                <div className="flex justify-between">
                  <span className="text-sky-300">density: Float32Array</span>
                  <span>{formatKb(voxelStats.densityBytes)} (d&gt;0 实心)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-300">material: Uint8Array</span>
                  <span>{formatKb(voxelStats.materialBytes)} (0..6 材质)</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>total voxel memory</span>
                  <span>{formatKb(voxelStats.totalBytes)}</span>
                </div>
              </div>
            </div>

            {/* Live Marching Cubes Cell Probe */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[11px] text-sky-300">
                  实时 Marching Cubes 单元探针
                </span>
                <span className="text-[10px] text-slate-400">
                  悬停星球表面查看
                </span>
              </div>

              {probe ? (
                <div className="space-y-1.5 font-mono-tabular text-[11px]">
                  <div className="grid grid-cols-2 gap-1 text-slate-300">
                    <div>
                      坐标: ({probe.worldPos[0].toFixed(2)}, {probe.worldPos[1].toFixed(2)}, {probe.worldPos[2].toFixed(2)})
                    </div>
                    <div>
                      单元/块: [{probe.cell.join(',')}] / C[{probe.chunk.join(',')}]
                    </div>
                    <div>
                      cubeIndex: <span className="text-amber-300">0x{probe.cubeIndex.toString(16).padStart(2, '0').toUpperCase()}</span> ({probe.cubeIndex.toString(2).padStart(8, '0')})
                    </div>
                    <div>
                      edgeMask: <span className="text-sky-300">0x{probe.edgeMask.toString(16).padStart(3, '0').toUpperCase()}</span> ({probe.triangleCount} 面)
                    </div>
                  </div>

                  {/* 8 Corner Samples */}
                  <div className="grid grid-cols-4 gap-1 pt-0.5">
                    {probe.corners.map((c) => (
                      <div
                        key={c.corner}
                        className={`rounded-xs px-1.5 py-0.5 border text-[10px] ${
                          c.solid
                            ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                            : 'border-slate-800 bg-[#050810] text-slate-400'
                        }`}
                      >
                        <div>C{c.corner} ({c.solid ? '1' : '0'})</div>
                        <div>d={c.density.toFixed(2)}</div>
                        <div>m={c.material}</div>
                      </div>
                    ))}
                  </div>

                  {/* 5x5 Local XZ Density Slice */}
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">
                      邻域 5×5 XZ 密度切片 (iy={probe.cell[1]})
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
                      {probe.slice5x5.map((cell, idx) => (
                        <div
                          key={idx}
                          className={`rounded-xs py-0.5 border ${
                            cell.dx === 0 && cell.dz === 0
                              ? 'border-sky-400 bg-sky-900/50 text-white'
                              : cell.density > 0
                                ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300'
                                : 'border-slate-800 bg-[#050810] text-slate-500'
                          }`}
                        >
                          {cell.density.toFixed(1)}
                        </div>
                      ))}
                    </div>
                  </div>

                  {probe.fvmControlVolume && (
                    <div className="pt-1.5 border-t border-slate-800 space-y-1 text-[10px]">
                      <div className="text-emerald-300 font-semibold">
                        欧拉 FVM 控制单元 · C[{probe.fvmControlVolume.cx},{probe.fvmControlVolume.cy},{probe.fvmControlVolume.cz}] / V[{probe.fvmControlVolume.ix},{probe.fvmControlVolume.iy},{probe.fvmControlVolume.iz}]
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-slate-300">
                        <div>
                          相态: <span className="text-cyan-300">{MATTER_PHASE_LABELS[probe.fvmControlVolume.phase]}</span>
                        </div>
                        <div>
                          内能: <span className="text-amber-300">{probe.fvmControlVolume.internalEnergy.toFixed(1)} J/m³</span>
                        </div>
                        <div>
                          温度/孔隙度: {probe.fvmControlVolume.temperatureK.toFixed(1)}K / {probe.fvmControlVolume.porosity.toFixed(2)}
                        </div>
                        <div>
                          通量 J: [{probe.fvmControlVolume.flux.map((v) => v.toFixed(3)).join(', ')}]
                        </div>
                      </div>
                      <div className="text-slate-300">
                        组分浓度 (mol/m³): [{Array.from(probe.fvmControlVolume.speciesConc).map((v) => v.toFixed(3)).join(', ')}]
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 py-1.5">
                  将鼠标指针移至星球表面任意位置，即可实时解析该体素单元的 8 角标量值、cubeIndex 位掩码与 5×5 切片。
                </div>
              )}
            </div>
          </>
        )}

        {/* D3 Donut Chart: Real-time active voxel grid material composition */}
        <MaterialDonutChart voxelStats={voxelStats} />
      </div>
    </aside>
  );
};
