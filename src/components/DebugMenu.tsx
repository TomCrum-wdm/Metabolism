import React, { useMemo, useState } from 'react';
import {
  MATERIAL_NAMES,
  MaterialId,
  VoxelFormatStats,
} from '../engine/voxelPlanet';
import {
  LodMode,
  SandboxConfig,
  SandboxTelemetry,
} from '../engine/webgpuScene';
import { NumericCadInput } from './NumericCadInput';

interface DebugMenuProps {
  telemetry: SandboxTelemetry;
  config: SandboxConfig;
  voxelStats: VoxelFormatStats;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onClose: () => void;
}

const MAT_ORDER: MaterialId[] = [
  MaterialId.Soil,
  MaterialId.Stone,
  MaterialId.Basalt,
  MaterialId.Sandstone,
  MaterialId.Crystal,
  MaterialId.Ice,
  MaterialId.Air,
];

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
      className="fixed right-2.5 top-11 z-20 w-[372px] max-w-[calc(100vw-1.25rem)] max-h-[calc(100vh-8.5rem)] flex flex-col rounded-sm border border-slate-700/90 text-slate-200 pointer-events-auto overflow-hidden"
      style={{ backgroundColor: 'rgba(9, 13, 24, 0.96)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
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
            {/* Performance Metrics */}
            <div className="grid grid-cols-3 gap-1.5 font-mono-tabular">
              <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2">
                <div className="text-[10px] text-slate-400">渲染帧率</div>
                <div className="text-sm font-semibold text-emerald-300 mt-0.5">
                  {telemetry.fps} FPS
                </div>
                <div className="text-[10px] text-slate-500">
                  {telemetry.frameTimeMs.toFixed(1)} ms
                </div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2">
                <div className="text-[10px] text-slate-400">地形三角面</div>
                <div className="text-sm font-semibold text-white mt-0.5">
                  {totalTriangles.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500">
                  {telemetry.activeChunks} 活跃分块
                </div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2">
                <div className="text-[10px] text-slate-400">SPH 物理步</div>
                <div className="text-sm font-semibold text-cyan-300 mt-0.5">
                  {telemetry.simStepMs.toFixed(1)} ms
                </div>
                <div className="text-[10px] text-slate-500">
                  {config.simPaused ? '已暂停' : telemetry.backend}
                </div>
              </div>
            </div>

            {/* LOD Chunk Distribution */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-200">
                  分块 LOD 分布 (共 {voxelStats.totalChunks} 块)
                </span>
                <span className="font-mono-tabular text-slate-400">
                  {config.lodMode === 'auto' ? '自适应' : `强制 LOD${config.lodMode}`}
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
                    onClick={() => onUpdateConfig({ lodMode: mode })}
                    className={`py-1 rounded-xs border text-[11px] font-medium cursor-pointer transition-colors ${
                      config.lodMode === mode
                        ? 'border-sky-400 bg-sky-900/50 text-white'
                        : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mode === 'auto' ? 'Auto' : `LOD ${mode}`}
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
                <div>采样点网格: {voxelStats.gridN}³ ({voxelStats.totalVoxels.toLocaleString()})</div>
                <div>体素单元: {voxelStats.cellsPerAxis}³ ({voxelStats.totalCells.toLocaleString()})</div>
                <div>分块结构: {voxelStats.chunksPerAxis}³ × {voxelStats.chunkCells}³</div>
                <div>体素步长: {formatMetric(voxelStats.voxelSize, 4)} m</div>
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

            {/* Material Byte Histogram */}
            <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 space-y-1">
              <div className="font-semibold text-[11px] text-slate-200 mb-1">
                体素材质枚举分布 (Uint8 ID)
              </div>
              {MAT_ORDER.map((mId) => {
                const count = voxelStats.materialCounts[mId] ?? 0;
                const pct = ((count / voxelStats.totalVoxels) * 100).toFixed(1);
                return (
                  <div key={mId} className="flex items-center gap-2 font-mono-tabular text-[11px]">
                    <span className="w-24 truncate text-slate-300">
                      {mId}: {MATERIAL_NAMES[mId].split(' ')[0]}
                    </span>
                    <div className="flex-1 h-1.5 rounded-xs bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-sky-400/80"
                        style={{ width: `${Math.min(100, Number(pct) * 2.2)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-slate-400">
                      {pct}%
                    </span>
                  </div>
                );
              })}
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
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 py-1.5">
                  将鼠标指针移至星球表面任意位置，即可实时解析该体素单元的 8 角标量值、cubeIndex 位掩码与 5×5 切片。
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
