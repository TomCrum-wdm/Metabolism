import React from 'react';
import { Lock, Unlock } from 'lucide-react';
import {
  evaluateArrheniusRateConstant,
  evaluateTpWindowGate,
  GAS_CONSTANT_R,
  MATTER_PHASE_LABELS,
  MetabolismSummarySnapshot,
  VoxChemicalProfile,
} from '../engine/metabolism';

interface FormulaVisualizerViewProps {
  snapshot: MetabolismSummarySnapshot;
  hoveredVoxProfile?: VoxChemicalProfile | null;
  voxLocked: boolean;
  onToggleVoxLock: () => void;
}

type FormulaCategory = 'flux' | 'kinetics' | 'thermo' | 'pic' | 'feedback';

const CATEGORY_TABS: ReadonlyArray<{ id: FormulaCategory; label: string }> = [
  { id: 'flux', label: '通量与守恒' },
  { id: 'kinetics', label: '反应动力学' },
  { id: 'thermo', label: '热力与相图' },
  { id: 'pic', label: 'PIC与细胞' },
  { id: 'feedback', label: '行星反馈' },
];

function computeBoilingK(pressureAtm: number): number {
  return 373.15 + 68 * Math.log(1 + Math.max(0, pressureAtm - 1));
}

export const FormulaVisualizerView: React.FC<FormulaVisualizerViewProps> = ({
  snapshot,
  hoveredVoxProfile,
  voxLocked,
  onToggleVoxLock,
}) => {
  const [category, setCategory] = React.useState<FormulaCategory>('kinetics');
  const [selectedRxnIdx, setSelectedRxnIdx] = React.useState(0);

  const { hypergraph, telemetry, cellularBio, lastCalibrationRecord, feedbackConfig, feedbackStats } =
    snapshot;
  const rxnCount = hypergraph.reactions.length;
  const safeRxnIdx = selectedRxnIdx < rxnCount ? selectedRxnIdx : 0;
  const rxn = hypergraph.reactions[safeRxnIdx];

  const isVoxSource = Boolean(hoveredVoxProfile);
  const T = hoveredVoxProfile ? hoveredVoxProfile.temperatureK : telemetry.meanTempK;
  const P = hoveredVoxProfile ? hoveredVoxProfile.pressureAtm : 1.0;
  const phi = hoveredVoxProfile ? hoveredVoxProfile.porosity : 0.48;
  const fluxMag = hoveredVoxProfile
    ? Math.hypot(
        hoveredVoxProfile.flux[0],
        hoveredVoxProfile.flux[1],
        hoveredVoxProfile.flux[2],
      )
    : telemetry.meanFluxMagnitude;
  const velMag = hoveredVoxProfile
    ? Math.hypot(
        hoveredVoxProfile.velocity[0],
        hoveredVoxProfile.velocity[1],
        hoveredVoxProfile.velocity[2],
      )
    : 0;
  const sigma = hoveredVoxProfile
    ? hoveredVoxProfile.entropyProdRate
    : telemetry.totalEntropyProdRate / Math.max(1, telemetry.activeCellCount);
  const cellVol = hoveredVoxProfile ? hoveredVoxProfile.cellVolumeM3 : 1;

  // Compute live reaction evaluation either from hoveredVoxProfile or domain mean fallback
  const voxRxnEval = hoveredVoxProfile?.reactionEvaluations[safeRxnIdx];
  const aEff = hypergraph.calibratedForwardA[safeRxnIdx] ?? rxn?.forwardA ?? 1;
  const eaEff = hypergraph.calibratedForwardEaJ[safeRxnIdx] ?? rxn?.forwardEaJ ?? 0;
  const beta = rxn?.tempExponentBeta ?? 0;
  const tpGate = voxRxnEval
    ? voxRxnEval.tpGate
    : rxn
      ? evaluateTpWindowGate(rxn, T, P)
      : 1;
  const kf = voxRxnEval
    ? voxRxnEval.kf
    : rxn
      ? evaluateArrheniusRateConstant(aEff, eaEff, beta, T) * tpGate
      : 0;
  const kr = voxRxnEval
    ? voxRxnEval.kr
    : rxn && rxn.isReversible
      ? evaluateArrheniusRateConstant(rxn.reverseA ?? aEff, rxn.reverseEaJ ?? eaEff, beta, T) * tpGate
      : 0;

  let liveRf = voxRxnEval?.forwardRate ?? 0;
  let liveRr = voxRxnEval?.reverseRate ?? 0;
  if (!voxRxnEval && rxn) {
    const S = hypergraph.numSpecies;
    let fProd = 1;
    let rProd = 1;
    for (let s = 0; s < S; s++) {
      const c = Math.max(0, telemetry.meanConcentrations[s] ?? 0);
      const ao = hypergraph.reactantOrderMatrix[safeRxnIdx * S + s];
      const bo = hypergraph.productOrderMatrix[safeRxnIdx * S + s];
      if (ao > 0) fProd *= Math.pow(c, ao);
      if (bo > 0) rProd *= Math.pow(c, bo);
    }
    liveRf = kf * fProd;
    liveRr = rxn.isReversible ? kr * rProd : 0;
  }
  const liveNetR = voxRxnEval ? voxRxnEval.netRate : liveRf - liveRr;
  const liveEnthalpyRate = voxRxnEval
    ? voxRxnEval.enthalpyRateWm3
    : rxn
      ? -rxn.enthalpyChangeJ * liveNetR
      : 0;

  // Thermodynamic numbers
  let cvLive = hoveredVoxProfile?.heatCapacityJm3K ?? 1800;
  if (!hoveredVoxProfile) {
    for (let s = 0; s < hypergraph.numSpecies; s++) {
      cvLive +=
        (telemetry.meanConcentrations[s] ?? 0) * hypergraph.species[s].specificHeatJPerMolK;
    }
  }
  const eLive = hoveredVoxProfile ? hoveredVoxProfile.internalEnergyJm3 : cvLive * T;
  const tBoil = computeBoilingK(P);

  // Conservation ledger
  const cons = telemetry.conservation;
  const expectedM = cons.totalMassPreKg + cons.boundaryNetMassKg;

  // Phase Diagram SVG coordinates: T in [180..3600] log scale, P in [0.1..60] log scale
  const pdW = 372;
  const pdH = 128;
  const pdPadL = 32;
  const pdPadR = 10;
  const pdPadT = 10;
  const pdPadB = 22;
  const pdPlotW = pdW - pdPadL - pdPadR;
  const pdPlotH = pdH - pdPadT - pdPadB;
  const mapTX = (tk: number) => {
    const clamped = Math.max(180, Math.min(3600, tk));
    const u = (Math.log10(clamped) - Math.log10(180)) / (Math.log10(3600) - Math.log10(180));
    return pdPadL + u * pdPlotW;
  };
  const mapPY = (pAtm: number) => {
    const clamped = Math.max(0.1, Math.min(60, pAtm));
    const v = (Math.log10(clamped) - Math.log10(0.1)) / (Math.log10(60) - Math.log10(0.1));
    return pdPadT + (1 - v) * pdPlotH;
  };

  const boilPts: string[] = [];
  for (let i = 0; i <= 18; i++) {
    const pSample = 0.1 * Math.pow(60 / 0.1, i / 18);
    const tb = computeBoilingK(pSample);
    boilPts.push(`${mapTX(tb).toFixed(1)},${mapPY(pSample).toFixed(1)}`);
  }

  return (
    <div data-testid="formula-visualizer-view" className="space-y-2 text-[10.5px]">
      {/* Active Substitution Data Source Banner */}
      <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold text-white flex items-center gap-1.5">
            <span className={isVoxSource ? 'text-cyan-300' : 'text-amber-300'}>
              {isVoxSource
                ? `实时体素代入 · Vox[${hoveredVoxProfile!.cellCoords.join(',')}]`
                : '实时全域均值代入 (悬停体素可切单方块)'}
            </span>
          </div>
          <div className="text-[9.5px] font-mono-tabular text-slate-400 truncate">
            T={T.toFixed(1)}K · P={P.toFixed(2)}atm · φ={phi.toFixed(2)}
            {hoveredVoxProfile
              ? ` · ${hoveredVoxProfile.materialComposition.materialNameZh} · V=${cellVol.toExponential(2)}m³`
              : ''}
          </div>
        </div>
        <button
          type="button"
          data-testid="formula-lock-vox-btn"
          onClick={onToggleVoxLock}
          className={`h-6 px-2 rounded-xs border text-[10px] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
            voxLocked
              ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
              : 'border-slate-700 bg-[#090d18] text-slate-300 hover:border-slate-500'
          }`}
          title="锁定当前或热泉区体素，防止移动鼠标时公式代入数值跳变 (L)"
        >
          {voxLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          <span>{voxLocked ? '已锁定 [L]' : '锁定体素 [L]'}</span>
        </button>
      </div>

      {/* 5 Category Tabs */}
      <div className="grid grid-cols-5 gap-1">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`formula-cat-${tab.id}`}
            onClick={() => setCategory(tab.id)}
            className={`h-6 px-1 rounded-xs border text-[9.5px] whitespace-nowrap cursor-pointer ${
              category === tab.id
                ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200 font-medium'
                : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 1. SPATIAL FVM FLUX & MASS CONSERVATION */}
      {category === 'flux' && (
        <div className="space-y-2">
          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
            <div className="text-[11px] font-semibold text-cyan-200">
              1. 欧拉有限体积界面通量算子 (FVM Flux Operator)
            </div>
            <div className="rounded-xs border border-slate-800 bg-[#050810] px-2 py-1.5 font-mono-tabular text-[10px] text-slate-200 space-y-0.5">
              <div>J_face = v_face · C_upwind − D_eff · φ_face · (C_R − C_L) / h</div>
              <div className="text-slate-400">
                正定性通量上限: ΔM_out ≤ 0.22 · C_L · h³ · D_eff = D₀ · γ_PIC
              </div>
            </div>

            {/* 2-Voxel Face Flux Diagram */}
            <svg
              viewBox="0 0 368 78"
              className="w-full h-[78px] rounded-xs border border-slate-800/80 bg-[#050810]"
            >
              <rect x="20" y="16" width="110" height="46" rx="2" fill="#0d172a" stroke="#38bdf8" strokeWidth="1.2" />
              <text x="75" y="34" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontFamily="monospace">
                控制体 L (C_L)
              </text>
              <text x="75" y="50" textAnchor="middle" fill="#7dd3fc" fontSize="9.5" fontFamily="monospace">
                φ={phi.toFixed(2)} |v|={velMag.toFixed(3)}
              </text>

              <rect x="238" y="16" width="110" height="46" rx="2" fill="#0d172a" stroke="#34d399" strokeWidth="1.2" />
              <text x="293" y="34" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontFamily="monospace">
                邻接体 R (C_R)
              </text>
              <text x="293" y="50" textAnchor="middle" fill="#6ee7b7" fontSize="9.5" fontFamily="monospace">
                间距 h={(hoveredVoxProfile?.voxelSize ?? (26 / Math.max(1, snapshot.resolutionCells))).toFixed(2)}m
              </text>

              <line x1="184" y1="10" x2="184" y2="68" stroke="#f59e0b" strokeDasharray="3 2" strokeWidth="1.2" />
              <line x1="136" y1="39" x2="226" y2="39" stroke="#22d3ee" strokeWidth="2.2" />
              <polygon points="232,39 222,34 222,44" fill="#22d3ee" />
              <text x="184" y="29" textAnchor="middle" fill="#fcd34d" fontSize="9.5" fontFamily="monospace">
                |J|={fluxMag.toFixed(4)}
              </text>
              <text x="184" y="60" textAnchor="middle" fill="#94a3b8" fontSize="8.5" fontFamily="monospace">
                mol/(m²·s)
              </text>
            </svg>

            <div className="grid grid-cols-3 gap-1 text-[9.5px] font-mono-tabular">
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">通量矢量 J (mol/m²s)</div>
                <div className="text-cyan-300">
                  {hoveredVoxProfile
                    ? `(${hoveredVoxProfile.flux.map((v) => v.toFixed(2)).join(', ')})`
                    : `|J|=${fluxMag.toFixed(4)}`}
                </div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">平流速度 v (m/s)</div>
                <div className="text-emerald-300">
                  {hoveredVoxProfile
                    ? `(${hoveredVoxProfile.velocity.map((v) => v.toFixed(2)).join(', ')})`
                    : `|v|=${velMag.toFixed(3)}`}
                </div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">体元体积 V_cell</div>
                <div className="text-slate-200">{cellVol.toFixed(3)} m³</div>
              </div>
            </div>
          </div>

          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-emerald-200">
                2. 每步严格质量守恒核算 (Mass Conservation Audit)
              </span>
              <span
                className={`font-mono-tabular text-[10px] ${
                  cons.conserved ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                ε_rel = {cons.relativeError.toExponential(2)}
              </span>
            </div>
            <div className="rounded-xs border border-slate-800 bg-[#050810] px-2 py-1 font-mono-tabular text-[9.5px] text-slate-300">
              M_total = Σ_i V_cell Σ_s (C_i,s · M_s) · 约束: |M_post − (M_pre + ΔM_bnd)| / M_pre &lt; 10⁻⁵
            </div>
            <div className="grid grid-cols-4 gap-1 text-[9.5px] font-mono-tabular">
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">步前 M_pre</div>
                <div className="text-slate-200">{cons.totalMassPreKg.toFixed(3)}kg</div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">进排净量 ΔM</div>
                <div className="text-cyan-300">{cons.boundaryNetMassKg >= 0 ? '+' : ''}{cons.boundaryNetMassKg.toFixed(4)}kg</div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">理论期望值</div>
                <div className="text-slate-200">{expectedM.toFixed(3)}kg</div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">步后 M_post</div>
                <div className="text-emerald-300">{cons.totalMassPostReactKg.toFixed(3)}kg</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. REACTION HYPERGRAPH & ARRHENIUS */}
      {category === 'kinetics' && rxn && (
        <div className="space-y-2">
          {/* Reaction Selector */}
          <div className="flex flex-wrap gap-1">
            {hypergraph.reactions.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                data-testid={`formula-rxn-${idx}`}
                onClick={() => setSelectedRxnIdx(idx)}
                className={`h-6 px-2 rounded-xs border text-[9.5px] font-mono-tabular whitespace-nowrap cursor-pointer ${
                  idx === safeRxnIdx
                    ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
                    : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                }`}
              >
                R{idx} · {item.uiName}
              </button>
            ))}
          </div>

          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-emerald-200 truncate">
                R{safeRxnIdx}: {rxn.uiName}
              </span>
              <span className="font-mono-tabular text-[9.5px] text-cyan-300 shrink-0">
                {rxn.uiEquationLabel}
              </span>
            </div>

            <div className="rounded-xs border border-slate-800 bg-[#050810] px-2 py-1.5 font-mono-tabular text-[9.5px] text-slate-200 space-y-0.5">
              <div>k_f(T,P) = A_eff · (T/298.15)^β · exp(−E_a / (R·T)) · G(T,P)</div>
              <div className="text-cyan-300">
                代入: {aEff.toExponential(2)} · ({T.toFixed(1)}/298.15)^{beta.toFixed(2)} · exp(−{eaEff.toFixed(0)}/({GAS_CONSTANT_R.toFixed(4)}·{T.toFixed(1)})) · {tpGate.toFixed(2)} = {kf.toExponential(3)}
              </div>
              <div className="text-slate-300">
                R_net = R_f − R_r = {liveRf.toExponential(2)} − {liveRr.toExponential(2)} ={' '}
                <span className="text-emerald-300 font-semibold">{liveNetR.toExponential(3)} mol/(m³·s)</span>
              </div>
            </div>

            {/* Live Kinetic Coefficients & Heat */}
            <div className="grid grid-cols-4 gap-1 text-[9.5px] font-mono-tabular">
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">活化能 E_a</div>
                <div className="text-slate-200">{(eaEff / 1000).toFixed(2)} kJ/mol</div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">T/P门控 G(T,P)</div>
                <div className={tpGate > 0.1 ? 'text-emerald-300' : 'text-rose-300'}>
                  {(tpGate * 100).toFixed(0)}%
                </div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">反应焓变 ΔH</div>
                <div className={rxn.enthalpyChangeJ < 0 ? 'text-amber-300' : 'text-sky-300'}>
                  {(rxn.enthalpyChangeJ / 1000).toFixed(1)} kJ/mol
                </div>
              </div>
              <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                <div className="text-slate-400">放/吸热速率 q̇</div>
                <div className={liveEnthalpyRate >= 0 ? 'text-amber-300' : 'text-sky-300'}>
                  {liveEnthalpyRate.toFixed(1)} W/m³
                </div>
              </div>
            </div>

            {/* T/P Reaction Validity Window Plot */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-[9.5px] text-slate-400 font-mono-tabular">
                <span>T/P 反应生效窗口可视化</span>
                <span>
                  [{rxn.minTempK.toFixed(0)}, {rxn.maxTempK.toFixed(0)}]K × [{rxn.minPressureAtm.toFixed(2)}, {rxn.maxPressureAtm.toFixed(1)}]atm
                </span>
              </div>
              <svg
                viewBox={`0 0 ${pdW} ${pdH}`}
                className="w-full h-[118px] rounded-xs border border-slate-800/80 bg-[#050810]"
              >
                {/* Axes */}
                <line x1={pdPadL} y1={pdPadT} x2={pdPadL} y2={pdH - pdPadB} stroke="#334155" />
                <line x1={pdPadL} y1={pdH - pdPadB} x2={pdW - pdPadR} y2={pdH - pdPadB} stroke="#334155" />

                {/* Reaction Window Box */}
                {(() => {
                  const x1 = mapTX(rxn.minTempK);
                  const x2 = mapTX(rxn.maxTempK);
                  const yTop = mapPY(rxn.maxPressureAtm);
                  const yBot = mapPY(rxn.minPressureAtm);
                  return (
                    <rect
                      x={Math.min(x1, x2)}
                      y={Math.min(yTop, yBot)}
                      width={Math.max(4, Math.abs(x2 - x1))}
                      height={Math.max(4, Math.abs(yBot - yTop))}
                      fill="#10b981"
                      fillOpacity="0.20"
                      stroke="#34d399"
                      strokeWidth="1.4"
                    />
                  );
                })()}

                {/* Live Voxel Crosshair */}
                <line x1={mapTX(T)} y1={pdPadT} x2={mapTX(T)} y2={pdH - pdPadB} stroke="#22d3ee" strokeDasharray="2 2" strokeWidth="0.9" />
                <line x1={pdPadL} y1={mapPY(P)} x2={pdW - pdPadR} y2={mapPY(P)} stroke="#22d3ee" strokeDasharray="2 2" strokeWidth="0.9" />
                <circle cx={mapTX(T)} cy={mapPY(P)} r="4" fill={tpGate > 0.1 ? '#22d3ee' : '#f43f5e'} stroke="#ffffff" strokeWidth="1" />
                <text x={Math.min(pdW - 88, mapTX(T) + 6)} y={Math.max(20, mapPY(P) - 5)} fill="#e2e8f0" fontSize="9" fontFamily="monospace">
                  ({T.toFixed(0)}K, {P.toFixed(1)}atm)
                </text>

                <text x={pdPadL} y={pdH - 6} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">180K</text>
                <text x={mapTX(298.15) - 10} y={pdH - 6} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">298K</text>
                <text x={mapTX(1000) - 12} y={pdH - 6} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">1000K</text>
                <text x={pdW - 36} y={pdH - 6} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">3600K</text>
                <text x="4" y={mapPY(1) + 3} fill="#94a3b8" fontSize="8" fontFamily="monospace">1atm</text>
                <text x="4" y={mapPY(25) + 3} fill="#94a3b8" fontSize="8" fontFamily="monospace">25</text>
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* 3. THERMODYNAMICS & 5-PHASE DIAGRAM */}
      {category === 'thermo' && (
        <div className="space-y-2">
          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-200">
                内能热容、相变判据与熵产率 (Thermo & 5-Phase)
              </span>
              <span className="font-mono-tabular text-[10px] text-cyan-300">
                {hoveredVoxProfile ? MATTER_PHASE_LABELS[hoveredVoxProfile.phase] : '全域统计'}
              </span>
            </div>

            <div className="rounded-xs border border-slate-800 bg-[#050810] px-2 py-1.5 font-mono-tabular text-[9.5px] text-slate-200 space-y-0.5">
              <div>C_v = 1800 + Σ_s (C_s · c_p,s) = {cvLive.toFixed(1)} J/(m³·K)</div>
              <div>T = e / C_v = {eLive.toExponential(2)} / {cvLive.toFixed(1)} = {T.toFixed(1)} K</div>
              <div>T_boil(P) = 373.15 + 68·ln(1 + max(0, P−1)) = {tBoil.toFixed(1)} K</div>
              <div className="text-amber-300">
                σ = R Σ_r (J_f − J_r)·ln(J_f / J_r) = {sigma.toFixed(4)} J/(m³·K·s) (≥ 0)
              </div>
            </div>

            {/* Live (T, P) 5-Phase Diagram */}
            <svg
              viewBox={`0 0 ${pdW} ${pdH}`}
              className="w-full h-[126px] rounded-xs border border-slate-800/80 bg-[#050810]"
            >
              {/* Solid T < 273.15K */}
              <rect
                x={pdPadL}
                y={pdPadT}
                width={mapTX(273.15) - pdPadL}
                height={pdPlotH}
                fill="#426eb3"
                fillOpacity="0.28"
              />
              {/* Plasma T >= 3200K */}
              <rect
                x={mapTX(3200)}
                y={pdPadT}
                width={pdW - pdPadR - mapTX(3200)}
                height={pdPlotH}
                fill="#ed59c7"
                fillOpacity="0.28"
              />
              {/* Supercritical T >= 647K & P >= 25atm */}
              <rect
                x={mapTX(647)}
                y={pdPadT}
                width={mapTX(3200) - mapTX(647)}
                height={mapPY(25) - pdPadT}
                fill="#f5b82e"
                fillOpacity="0.26"
              />
              {/* Boiling curve */}
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.6"
                points={boilPts.join(' ')}
              />
              <line x1={mapTX(273.15)} y1={pdPadT} x2={mapTX(273.15)} y2={pdH - pdPadB} stroke="#60a5fa" strokeDasharray="3 2" />
              <line x1={mapTX(3200)} y1={pdPadT} x2={mapTX(3200)} y2={pdH - pdPadB} stroke="#e879f9" strokeDasharray="3 2" />

              {/* Labels */}
              <text x={pdPadL + 4} y={pdPadT + 14} fill="#93c5fd" fontSize="8.5">固态</text>
              <text x={mapTX(310)} y={mapPY(12)} fill="#38bdf8" fontSize="8.5">液态</text>
              <text x={mapTX(950)} y={mapPY(0.35)} fill="#cbd5e1" fontSize="8.5">气态</text>
              <text x={mapTX(880)} y={pdPadT + 13} fill="#fcd34d" fontSize="8.5">超临界</text>

              {/* Current Point */}
              <circle cx={mapTX(T)} cy={mapPY(P)} r="4.2" fill="#22d3ee" stroke="#ffffff" strokeWidth="1.2" />
              <text x={Math.min(pdW - 86, mapTX(T) + 6)} y={Math.max(20, mapPY(P) - 4)} fill="#ffffff" fontSize="9" fontFamily="monospace">
                {T.toFixed(0)}K,{P.toFixed(1)}atm
              </text>

              <text x={pdPadL} y={pdH - 6} fill="#94a3b8" fontSize="8" fontFamily="monospace">180K</text>
              <text x={mapTX(273.15) - 10} y={pdH - 6} fill="#93c5fd" fontSize="8" fontFamily="monospace">273K</text>
              <text x={mapTX(647) - 10} y={pdH - 6} fill="#fcd34d" fontSize="8" fontFamily="monospace">647K</text>
              <text x={mapTX(3200) - 16} y={pdH - 6} fill="#f0abfc" fontSize="8" fontFamily="monospace">3200K</text>
            </svg>
          </div>
        </div>
      )}

      {/* 4. PIC MICRO CALIBRATION & CELLULAR BIOENERGETICS */}
      {category === 'pic' && (
        <div className="space-y-2">
          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
            <div className="text-[11px] font-semibold text-cyan-200">
              1. PIC 拉格朗日局部微尺度校准公式 (不运行全局原子 MD)
            </div>
            <div className="rounded-xs border border-slate-800 bg-[#050810] px-2 py-1.5 font-mono-tabular text-[9.5px] text-slate-200 space-y-0.5">
              <div>r_grain = (0.12 · (1 − φ))^(1/3) · 颗粒碰撞障碍半径</div>
              <div>γ_D = MSD_hindered / MSD_free · D_eff = D₀ · γ_D</div>
              <div>A_eff = A_raw · sterics · E_a,eff = E_a,raw + ΔE_a,steric</div>
            </div>
            {lastCalibrationRecord ? (
              <div className="grid grid-cols-3 gap-1 text-[9.5px] font-mono-tabular">
                <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                  <div className="text-slate-400">位阻扩散比 γ_D</div>
                  <div className="text-cyan-300">
                    {(lastCalibrationRecord.diffusivityMultipliers[0] ?? lastCalibrationRecord.msdHinderedOverFree).toFixed(3)}x
                  </div>
                </div>
                <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                  <div className="text-slate-400">拥挤/碰撞因子</div>
                  <div className="text-emerald-300">
                    {lastCalibrationRecord.stericCrowdingFactor.toFixed(3)}x
                  </div>
                </div>
                <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
                  <div className="text-slate-400">能垒漂移 ΔEa</div>
                  <div className="text-amber-300">
                    {lastCalibrationRecord.reactionDeltas[0]
                      ? `${((lastCalibrationRecord.reactionDeltas[0].calibratedEaJ - lastCalibrationRecord.reactionDeltas[0].baseEaJ) / 1000).toFixed(2)} kJ`
                      : '0.00 kJ'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[9.5px] text-slate-400">
                当前尚无手工微校准采样，可在「细胞与PIC」页签点击运行 120 步 Langevin 碰撞采样。
              </div>
            )}
          </div>

          <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
            <div className="text-[11px] font-semibold text-emerald-200">
              2. 原始细胞化学渗透生物能学 (Bioenergetics)
            </div>
            <div className="rounded-xs border border-slate-800 bg-[#050810] px-2 py-1.5 font-mono-tabular text-[9.5px] text-slate-200 space-y-0.5">
              <div>v_ATP = 30·R_TCA + 14·R_Cori + 2·R_Gly = {cellularBio.atpSynthesisRateMmolLs.toFixed(3)} mmol/L·s</div>
              <div>RQ = R_CO₂ / R_O₂ = {cellularBio.respiratoryQuotient.toFixed(3)}</div>
              <div>ΔΨ = −70 − 95·f_aero = {cellularBio.membranePotentialMv.toFixed(1)} mV</div>
            </div>
          </div>
        </div>
      )}

      {/* 5. BIDIRECTIONAL PLANETARY FEEDBACK */}
      {category === 'feedback' && (
        <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-amber-200">
            双向热力与矿物重塑写回方程 (Eulerian FVM ↔ VoxelPlanet)
          </div>
          <div className="rounded-xs border border-slate-800 bg-[#050810] px-2 py-1.5 font-mono-tabular text-[9.5px] text-slate-200 space-y-0.5">
            <div>ΔT_hotspot = clamp(gain · q̇_exo, −45, +185) °C (gain = {feedbackConfig.thermalGain.toFixed(1)}x)</div>
            <div>矿化析晶阈值: Σ_acc &gt; 0.45 ⇒ 沉积 Crystal/Basalt 且 φ ↓</div>
            <div>酸蚀溶孔阈值: Σ_acid &gt; 0.45 ⇒ 溶解矿壳 且 φ ↑</div>
          </div>
          <div className="grid grid-cols-3 gap-1 text-[9.5px] font-mono-tabular">
            <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
              <div className="text-slate-400">耦合热源点</div>
              <div className="text-amber-300">{feedbackStats.activeThermalHotspots} 个</div>
            </div>
            <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
              <div className="text-slate-400">矿化新生体素</div>
              <div className="text-emerald-300">{feedbackStats.totalMineralizedVoxels} Vox</div>
            </div>
            <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5">
              <div className="text-slate-400">酸蚀溶孔体素</div>
              <div className="text-cyan-300">{feedbackStats.totalCorrodedVoxels} Vox</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
