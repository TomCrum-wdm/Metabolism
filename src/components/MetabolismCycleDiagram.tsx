import React from 'react';
import {
  CellularBioTelemetry,
  CompiledReactionHypergraph,
  FvmStepTelemetry,
  MetabolismDemoMode,
} from '../engine/metabolism';

interface MetabolismCycleDiagramProps {
  mode: MetabolismDemoMode;
  hypergraph: CompiledReactionHypergraph;
  telemetry: FvmStepTelemetry;
  cellularBio: CellularBioTelemetry;
  running: boolean;
}

interface CycleNodeLayout {
  speciesIndex: number;
  x: number;
  y: number;
  shortRole: string;
}

interface CycleEdgeLayout {
  fromSpecies: number;
  toSpecies: number;
  reactionIndex: number;
  label: string;
  curveY?: number;
  curveX?: number;
}

function rgbStr(rgb: readonly [number, number, number]): string {
  return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
}

function getLayoutForMode(mode: MetabolismDemoMode): {
  title: string;
  subtitle: string;
  nodes: CycleNodeLayout[];
  edges: CycleEdgeLayout[];
} {
  if (mode === 'planetary_carbon_water') {
    return {
      title: '行星碳水双循环 · 欧拉 FVM 耦合拓扑',
      subtitle: '光合固碳 · 有氧呼吸 · 海洋蒸发凝结 · 厌氧产甲烷',
      nodes: [
        { speciesIndex: 0, x: 112, y: 42, shortRole: '大气碳源' },
        { speciesIndex: 1, x: 268, y: 42, shortRole: '气相水汽' },
        { speciesIndex: 2, x: 298, y: 120, shortRole: '液态海洋' },
        { speciesIndex: 3, x: 190, y: 158, shortRole: '生物有机质' },
        { speciesIndex: 4, x: 64, y: 114, shortRole: '自由氧库' },
        { speciesIndex: 5, x: 190, y: 86, shortRole: '还原甲烷' },
      ],
      edges: [
        { fromSpecies: 0, toSpecies: 3, reactionIndex: 0, label: '光合固碳', curveX: -18 },
        { fromSpecies: 3, toSpecies: 0, reactionIndex: 1, label: '呼吸矿化', curveX: 18 },
        { fromSpecies: 2, toSpecies: 1, reactionIndex: 2, label: '蒸发/凝结', curveX: 16 },
        { fromSpecies: 3, toSpecies: 5, reactionIndex: 3, label: '厌氧产甲烷', curveY: -10 },
        { fromSpecies: 5, toSpecies: 0, reactionIndex: 4, label: '甲烷氧化', curveX: -18 },
      ],
    };
  }
  if (mode === 'cellular_metabolism') {
    return {
      title: '细胞级糖酵解与三羧酸呼吸网络',
      subtitle: '葡萄糖跨膜摄取 · 线粒体氧化磷酸化 (+30 ATP) · 乳酸发酵',
      nodes: [
        { speciesIndex: 0, x: 70, y: 42, shortRole: '糖底物' },
        { speciesIndex: 1, x: 292, y: 42, shortRole: '氧受体' },
        { speciesIndex: 2, x: 306, y: 140, shortRole: '代谢排废' },
        { speciesIndex: 3, x: 190, y: 156, shortRole: '细胞质水' },
        { speciesIndex: 4, x: 70, y: 144, shortRole: '无氧乳酸' },
        { speciesIndex: 5, x: 186, y: 88, shortRole: '细胞增殖' },
      ],
      edges: [
        { fromSpecies: 0, toSpecies: 2, reactionIndex: 0, label: '有氧呼吸 +ATP', curveY: -22 },
        { fromSpecies: 1, toSpecies: 3, reactionIndex: 0, label: '氧化磷酸化', curveX: 20 },
        { fromSpecies: 0, toSpecies: 4, reactionIndex: 1, label: '无氧酵解', curveX: -16 },
        { fromSpecies: 4, toSpecies: 2, reactionIndex: 2, label: '乳酸清零', curveY: 16 },
        { fromSpecies: 0, toSpecies: 5, reactionIndex: 3, label: '生物合成', curveY: -10 },
      ],
    };
  }
  if (mode === 'planetary_hydrology') {
    return {
      title: '行星水圈三相热力学相变环',
      subtitle: '极地冰盖 · 液态海洋 · 对流层水汽潜热交换',
      nodes: [
        { speciesIndex: 0, x: 190, y: 146, shortRole: '液态海' },
        { speciesIndex: 1, x: 190, y: 38, shortRole: '对流层水汽' },
        { speciesIndex: 2, x: 72, y: 102, shortRole: '极地冰盖' },
      ],
      edges: [
        { fromSpecies: 0, toSpecies: 1, reactionIndex: 0, label: '蒸发/凝结', curveX: 46 },
        { fromSpecies: 2, toSpecies: 0, reactionIndex: 1, label: '融冰/冻结', curveY: 16 },
        { fromSpecies: 2, toSpecies: 1, reactionIndex: 2, label: '升华/凝华', curveY: -16 },
      ],
    };
  }
  if (mode === 'closed_equilibrium') {
    return {
      title: '封闭绝热反应网络 (A ⇌ B ⇌ C)',
      subtitle: '零进排通量 · 化学势弛豫至全局平衡 · 熵产趋零',
      nodes: [
        { speciesIndex: 0, x: 76, y: 95, shortRole: '反应物 A' },
        { speciesIndex: 1, x: 190, y: 52, shortRole: '中间体 B' },
        { speciesIndex: 2, x: 304, y: 95, shortRole: '产物 C' },
      ],
      edges: [
        { fromSpecies: 0, toSpecies: 1, reactionIndex: 0, label: 'A ⇌ B', curveY: -14 },
        { fromSpecies: 1, toSpecies: 2, reactionIndex: 1, label: 'B ⇌ C', curveY: -14 },
      ],
    };
  }
  return {
    title: '开放耗散自催化超图 (Gray-Scott 变体)',
    subtitle: '跨膜持续进料 F + 排废 D · 正反馈分岔与耗散结构涌现',
    nodes: [
      { speciesIndex: 0, x: 72, y: 95, shortRole: '进料底物 S' },
      { speciesIndex: 1, x: 190, y: 50, shortRole: '自催化剂 X' },
      { speciesIndex: 2, x: 306, y: 95, shortRole: '排废 W' },
    ],
    edges: [
      { fromSpecies: 0, toSpecies: 1, reactionIndex: 0, label: 'S+2X→3X', curveY: -16 },
      { fromSpecies: 1, toSpecies: 2, reactionIndex: 1, label: 'X→W 衰变', curveY: -16 },
      { fromSpecies: 0, toSpecies: 2, reactionIndex: 2, label: '背景矿化', curveY: 24 },
    ],
  };
}

export const MetabolismCycleDiagram: React.FC<MetabolismCycleDiagramProps> = ({
  mode,
  hypergraph,
  telemetry,
  cellularBio,
  running,
}) => {
  const layout = getLayoutForMode(mode);
  const svgW = 380;
  const svgH = 190;
  const rates = telemetry.meanReactionRates;
  const concs = telemetry.meanConcentrations;

  let maxConc = 0.6;
  for (const c of concs) {
    if (c > maxConc) maxConc = c;
  }

  return (
    <div className="space-y-1.5" data-testid="metabolism-cycle-diagram">
      {/* 1. Eulerian FVM Fixed Operator Pipeline Strip */}
      <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span className="font-medium text-slate-200">欧拉 FVM 固定算子管线</span>
          <span className="font-mono-tabular text-emerald-300">
            Step #{telemetry.stepIndex} · 质量{telemetry.conservation.conserved ? '守恒 ✓' : '校验中'}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1 text-[9px] font-mono-tabular">
          <div className="rounded-xs border border-slate-800 bg-[#090d18] px-1.5 py-1">
            <div className="text-slate-400">1. 边界进排</div>
            <div className="text-sky-300 truncate">
              {telemetry.boundaryMode === 'open' ? '开放 F/D' : '封闭零通量'}
            </div>
          </div>
          <div className="rounded-xs border border-slate-800 bg-[#090d18] px-1.5 py-1">
            <div className="text-slate-400">2. 通量迁移</div>
            <div className="text-cyan-300">|J| {telemetry.meanFluxMagnitude.toFixed(3)}</div>
          </div>
          <div className="rounded-xs border border-slate-800 bg-[#090d18] px-1.5 py-1">
            <div className="text-slate-400">3. 本体内反应</div>
            <div className="text-amber-300">σ {telemetry.totalEntropyProdRate.toFixed(3)}</div>
          </div>
          <div className="rounded-xs border border-slate-800 bg-[#090d18] px-1.5 py-1">
            <div className="text-slate-400">4. 守恒校验</div>
            <div className="text-emerald-300">
              {telemetry.conservation.relativeError.toExponential(1)}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Live Interactive Metabolic & Biogeochemical Cycle Topology */}
      <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium text-slate-100 truncate">{layout.title}</div>
          <div className="text-[9px] text-slate-400 whitespace-nowrap shrink-0">
            {mode === 'cellular_metabolism'
              ? `ATP ${cellularBio.atpSynthesisRateMmolLs.toFixed(1)} mM/s`
              : `|J|=${telemetry.meanFluxMagnitude.toFixed(3)}`}
          </div>
        </div>
        <div className="text-[9px] text-slate-400 truncate">{layout.subtitle}</div>

        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-[182px] rounded-xs border border-slate-800/80 bg-[#050810]"
        >
          <defs>
            <marker
              id="cycle-arrow-fwd"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
            </marker>
            <marker
              id="cycle-arrow-rev"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
            </marker>
          </defs>

          {/* Subtle scientific coordinate grid */}
          <g stroke="#111827" strokeWidth="1">
            <line x1="0" y1="64" x2={svgW} y2="64" />
            <line x1="0" y1="128" x2={svgW} y2="128" />
            <line x1="126" y1="0" x2="126" y2={svgH} />
            <line x1="254" y1="0" x2="254" y2={svgH} />
          </g>

          {/* Reaction Flux Edges */}
          {layout.edges.map((edge, idx) => {
            const fromNode = layout.nodes.find((n) => n.speciesIndex === edge.fromSpecies);
            const toNode = layout.nodes.find((n) => n.speciesIndex === edge.toSpecies);
            if (!fromNode || !toNode) return null;

            const rate = rates[edge.reactionIndex] ?? 0;
            const absRate = Math.abs(rate);
            const reverse = rate < -1e-4;
            const startX = reverse ? toNode.x : fromNode.x;
            const startY = reverse ? toNode.y : fromNode.y;
            const endX = reverse ? fromNode.x : toNode.x;
            const endY = reverse ? fromNode.y : toNode.y;

            const midX = 0.5 * (startX + endX) + (edge.curveX ?? 0);
            const midY = 0.5 * (startY + endY) + (edge.curveY ?? 0);
            const pathD = `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;

            const strokeW = Math.min(3.4, 1.1 + Math.sqrt(absRate) * 2.2);
            const strokeCol = reverse ? '#f59e0b' : absRate > 0.004 ? '#38bdf8' : '#475569';

            return (
              <g key={`${edge.reactionIndex}-${idx}`}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeCol}
                  strokeWidth={strokeW}
                  strokeOpacity={absRate > 1e-4 ? 0.85 : 0.4}
                  strokeDasharray={running && absRate > 1e-4 ? '5 3' : undefined}
                  markerEnd={reverse ? 'url(#cycle-arrow-rev)' : 'url(#cycle-arrow-fwd)'}
                />
                <text
                  x={midX}
                  y={midY - 3}
                  textAnchor="middle"
                  fontSize="8"
                  fill="#94a3b8"
                  fontFamily="monospace"
                >
                  {edge.label} {absRate > 0.0005 ? `(${absRate.toFixed(2)})` : ''}
                </text>
              </g>
            );
          })}

          {/* Species Nodes */}
          {layout.nodes.map((node) => {
            const sp = hypergraph.species[node.speciesIndex];
            if (!sp) return null;
            const conc = concs[node.speciesIndex] ?? 0;
            const frac = Math.min(1, conc / maxConc);
            const col = rgbStr(sp.colorRgb);
            const boxW = 68;
            const boxH = 34;

            return (
              <g key={sp.key} transform={`translate(${node.x - boxW / 2}, ${node.y - boxH / 2})`}>
                <rect
                  width={boxW}
                  height={boxH}
                  rx="2"
                  fill="#0b1120"
                  stroke={col}
                  strokeWidth="1.2"
                  strokeOpacity="0.9"
                />
                {/* Concentration progress fill inside bottom of node */}
                <rect
                  x="2"
                  y={boxH - 5}
                  width={Math.max(2, (boxW - 4) * frac)}
                  height="3"
                  fill={col}
                  opacity="0.85"
                />
                <text
                  x="5"
                  y="12"
                  fontSize="9.5"
                  fontWeight="600"
                  fill="#f8fafc"
                  fontFamily="monospace"
                >
                  {sp.formulaTag}
                </text>
                <text
                  x={boxW - 4}
                  y="12"
                  textAnchor="end"
                  fontSize="8.5"
                  fill={col}
                  fontFamily="monospace"
                >
                  {conc.toFixed(2)}
                </text>
                <text
                  x="5"
                  y="23"
                  fontSize="7.5"
                  fill="#94a3b8"
                >
                  {node.shortRole}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Per-Species Tabular Concentrations Strip */}
        <div className="grid grid-cols-3 gap-1 pt-0.5 text-[9px] font-mono-tabular">
          {hypergraph.species.map((sp, i) => (
            <div
              key={sp.key}
              className="flex items-center justify-between rounded-xs border border-slate-800/80 bg-[#090d18] px-1.5 py-0.5"
            >
              <span className="truncate font-semibold" style={{ color: rgbStr(sp.colorRgb) }}>
                {sp.formulaTag}
              </span>
              <span className="text-slate-300">{(concs[i] ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
