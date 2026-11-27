import React, { useMemo, useState } from 'react';
import { arc as d3Arc, pie as d3Pie, PieArcDatum } from 'd3';
import {
  MATERIAL_NAMES,
  MaterialId,
  VoxelFormatStats,
} from '../engine/voxelPlanet';

interface MaterialDonutChartProps {
  voxelStats: VoxelFormatStats;
}

interface MaterialDatum {
  id: MaterialId;
  name: string;
  shortName: string;
  count: number;
  pct: number;
  fill: string;
  stroke: string;
}

const CHART_MAT_ORDER: MaterialId[] = [
  MaterialId.Soil,
  MaterialId.Stone,
  MaterialId.Basalt,
  MaterialId.Sandstone,
  MaterialId.Crystal,
  MaterialId.Ice,
  MaterialId.Magma,
  MaterialId.Air,
];

const MATERIAL_CHART_STYLE: Record<
  MaterialId,
  { shortName: string; fill: string; stroke: string }
> = {
  [MaterialId.Soil]: {
    shortName: '沃土 Soil',
    fill: '#4d9952',
    stroke: '#6ee777',
  },
  [MaterialId.Stone]: {
    shortName: '灰岩 Stone',
    fill: '#8b95a5',
    stroke: '#cbd5e1',
  },
  [MaterialId.Basalt]: {
    shortName: '玄武岩 Basalt',
    fill: '#475569',
    stroke: '#94a3b8',
  },
  [MaterialId.Sandstone]: {
    shortName: '砂岩 Sand',
    fill: '#c77d55',
    stroke: '#fdba74',
  },
  [MaterialId.Crystal]: {
    shortName: '晶矿 Crystal',
    fill: '#22d3ee',
    stroke: '#a5f3fc',
  },
  [MaterialId.Ice]: {
    shortName: '极冰 Ice',
    fill: '#dbeafe',
    stroke: '#ffffff',
  },
  [MaterialId.Magma]: {
    shortName: '熔岩 Magma',
    fill: '#ff571a',
    stroke: '#fdba74',
  },
  [MaterialId.Air]: {
    shortName: '空气 Air',
    fill: '#172033',
    stroke: '#475569',
  },
};

function formatCompactCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 10_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

export const MaterialDonutChart: React.FC<MaterialDonutChartProps> = ({
  voxelStats,
}) => {
  const [includeAir, setIncludeAir] = useState(true);
  const [hoveredId, setHoveredId] = useState<MaterialId | null>(null);
  const [pinnedId, setPinnedId] = useState<MaterialId | null>(null);

  const activeId = hoveredId ?? pinnedId;

  const { slices, legendRows, totalInScope, solidPct } = useMemo(() => {
    const visibleOrder = includeAir
      ? CHART_MAT_ORDER
      : CHART_MAT_ORDER.filter((m) => m !== MaterialId.Air);

    const denominator = visibleOrder.reduce(
      (sum, mId) => sum + (voxelStats.materialCounts[mId] ?? 0),
      0,
    );
    const safeDenom = Math.max(1, denominator);

    const rows: MaterialDatum[] = CHART_MAT_ORDER.map((mId) => {
      const count = voxelStats.materialCounts[mId] ?? 0;
      const inScope = includeAir || mId !== MaterialId.Air;
      const pct = inScope && denominator > 0 ? (count / safeDenom) * 100 : 0;
      const meta = MATERIAL_CHART_STYLE[mId];
      return {
        id: mId,
        name: MATERIAL_NAMES[mId],
        shortName: meta.shortName,
        count,
        pct,
        fill: meta.fill,
        stroke: meta.stroke,
      };
    });

    const nonZeroForPie = rows.filter(
      (r) => r.count > 0 && (includeAir || r.id !== MaterialId.Air),
    );

    const pieGen = d3Pie<MaterialDatum>()
      .value((d) => d.count)
      .sort(null)
      .padAngle(nonZeroForPie.length > 1 ? 0.025 : 0);

    const computedArcs = pieGen(nonZeroForPie);

    const baseSolidPct =
      voxelStats.totalVoxels > 0
        ? (voxelStats.solidVoxels / voxelStats.totalVoxels) * 100
        : 0;

    return {
      slices: computedArcs,
      legendRows: rows,
      totalInScope: denominator,
      solidPct: baseSolidPct,
    };
  }, [includeAir, voxelStats]);

  const { normalArcGen, hoverArcGen } = useMemo(() => {
    const baseArc = d3Arc<PieArcDatum<MaterialDatum>>()
      .innerRadius(36)
      .outerRadius(56)
      .cornerRadius(1.5);

    const activeArc = d3Arc<PieArcDatum<MaterialDatum>>()
      .innerRadius(35)
      .outerRadius(60)
      .cornerRadius(2);

    return { normalArcGen: baseArc, hoverArcGen: activeArc };
  }, []);

  const focusedDatum = useMemo(() => {
    if (activeId === null) return null;
    return legendRows.find((r) => r.id === activeId) ?? null;
  }, [activeId, legendRows]);

  const centerTitle = focusedDatum
    ? focusedDatum.shortName.split(' ')[0]
    : includeAir
      ? '实心占空'
      : '实心体素';
  const centerValue = focusedDatum
    ? `${focusedDatum.pct < 0.05 && focusedDatum.count > 0 ? '<0.1' : focusedDatum.pct.toFixed(1)}%`
    : includeAir
      ? `${solidPct.toFixed(1)}%`
      : formatCompactCount(voxelStats.solidVoxels);
  const centerSub = focusedDatum
    ? `${formatCompactCount(focusedDatum.count)} 格`
    : includeAir
      ? `${formatCompactCount(voxelStats.solidVoxels)} / ${formatCompactCount(voxelStats.totalVoxels)}`
      : '100% 地壳/核心';

  return (
    <div
      data-testid="material-donut-card"
      className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 space-y-2"
    >
      {/* Header + Scope Segmented Control */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[11px] text-slate-200 whitespace-nowrap">
          体素材质构成 (D3)
        </span>
        <div
          className="inline-flex rounded-xs border border-slate-800 bg-[#090d18] p-0.5 text-[10px]"
          role="group"
          aria-label="材质统计范围"
        >
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setIncludeAir(true)}
            className={`px-1.5 py-0.5 rounded-xs cursor-pointer transition-colors whitespace-nowrap ${
              includeAir
                ? 'bg-slate-800 text-sky-300 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            全网格
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setIncludeAir(false)}
            className={`px-1.5 py-0.5 rounded-xs cursor-pointer transition-colors whitespace-nowrap ${
              !includeAir
                ? 'bg-slate-800 text-emerald-300 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            仅实心
          </button>
        </div>
      </div>

      {/* Donut SVG + Tabular Breakdown */}
      <div className="flex items-center gap-2.5">
        {/* D3 Donut Chart */}
        <div className="relative shrink-0 w-[132px] h-[132px] flex items-center justify-center">
          <svg
            data-testid="material-donut-svg"
            viewBox="-66 -66 132 132"
            className="w-full h-full overflow-visible"
            role="img"
            aria-label="体素材质占比环形图"
          >
            {/* Outer calibration ring */}
            <circle
              r={62}
              fill="none"
              stroke="rgba(148, 163, 184, 0.16)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            {/* Empty baseline ring when all counts are 0 */}
            {totalInScope === 0 && (
              <circle
                r={46}
                fill="none"
                stroke="#1e293b"
                strokeWidth={18}
              />
            )}
            <g>
              {slices.map((arcDatum) => {
                const mat = arcDatum.data;
                const isSelected = activeId === mat.id;
                const isDimmed = activeId !== null && !isSelected;
                const pathD =
                  (isSelected
                    ? hoverArcGen(arcDatum)
                    : normalArcGen(arcDatum)) ?? '';
                return (
                  <path
                    key={mat.id}
                    d={pathD}
                    fill={mat.fill}
                    stroke={isSelected ? mat.stroke : mat.id === MaterialId.Air ? '#334155' : '#090d18'}
                    strokeWidth={isSelected ? 1.5 : 0.75}
                    opacity={isDimmed ? 0.38 : 1}
                    className="cursor-pointer transition-opacity duration-150"
                    onMouseEnter={() => setHoveredId(mat.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() =>
                      setPinnedId((prev) => (prev === mat.id ? null : mat.id))
                    }
                  >
                    <title>
                      {`${mat.name}: ${mat.pct.toFixed(2)}% (${mat.count.toLocaleString()})`}
                    </title>
                  </path>
                );
              })}
            </g>
          </svg>

          {/* Center Cutout Readout */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-2">
            <span className="text-[9px] text-slate-400 leading-tight truncate max-w-[66px]">
              {centerTitle}
            </span>
            <span className="text-[13px] font-semibold font-mono-tabular text-white leading-tight mt-0.5">
              {centerValue}
            </span>
            <span className="text-[9px] font-mono-tabular text-slate-400 leading-tight mt-0.5 truncate max-w-[68px]">
              {centerSub}
            </span>
          </div>
        </div>

        {/* Synchronized Legend List */}
        <div className="flex-1 min-w-0 space-y-1">
          {legendRows.map((row) => {
            const disabledInScope = !includeAir && row.id === MaterialId.Air;
            const isSelected = activeId === row.id;
            const pctText = disabledInScope
              ? '--'
              : row.count > 0 && row.pct < 0.05
                ? '<0.1%'
                : `${row.pct.toFixed(1)}%`;

            return (
              <button
                key={row.id}
                type="button"
                tabIndex={-1}
                disabled={disabledInScope}
                onMouseEnter={() => !disabledInScope && setHoveredId(row.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() =>
                  !disabledInScope &&
                  setPinnedId((prev) => (prev === row.id ? null : row.id))
                }
                className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded-xs text-left font-mono-tabular text-[10px] transition-colors ${
                  disabledInScope
                    ? 'opacity-35 cursor-default'
                    : isSelected
                      ? 'bg-slate-800/90 text-white cursor-pointer'
                      : 'text-slate-300 hover:bg-slate-800/50 cursor-pointer'
                }`}
              >
                <span
                  className="w-2 h-2 shrink-0 rounded-[1px] border border-white/15"
                  style={{ backgroundColor: row.fill }}
                />
                <span className="w-[62px] truncate shrink-0">
                  {row.id}:{row.shortName.split(' ')[0]}
                </span>
                <div className="flex-1 h-1 rounded-xs bg-slate-800/90 overflow-hidden">
                  <div
                    className="h-full transition-all duration-150"
                    style={{
                      width: `${disabledInScope ? 0 : Math.min(100, row.pct)}%`,
                      backgroundColor:
                        row.id === MaterialId.Air ? '#475569' : row.fill,
                    }}
                  />
                </div>
                <span className="w-[36px] text-right text-slate-400 shrink-0">
                  {pctText}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
