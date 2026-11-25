import React from 'react';
import {
  COMPOUND_CATALOG,
  CompiledReactionHypergraph,
  computeMaterialElementalBreakdown,
  MATTER_PHASE_LABELS,
  PERIODIC_ELEMENTS,
  PeriodicElementDef,
  VOXEL_MATERIAL_COMPOSITIONS,
  VoxChemicalProfile,
} from '../engine/metabolism';
import { MaterialId } from '../engine/voxelPlanet';

interface PeriodicTableViewProps {
  hypergraph: CompiledReactionHypergraph;
  hoveredVoxProfile?: VoxChemicalProfile | null;
}

const ELEMENT_BY_SYMBOL = new Map<string, PeriodicElementDef>(
  PERIODIC_ELEMENTS.map((el) => [el.symbol, el]),
);

const CATEGORY_LABELS: Record<PeriodicElementDef['category'], string> = {
  nonmetal: '反应非金属',
  noble_gas: '惰性气体',
  alkali_metal: '碱金属',
  alkaline_earth: '碱土金属',
  metalloid: '类金属',
  halogen: '卤素',
  transition_metal: '过渡金属',
  post_transition: '贫金属',
  lanthanide: '镧系元素',
  actinide: '锕系元素',
};

const SOLID_MATERIALS: ReadonlyArray<MaterialId> = [
  MaterialId.Soil,
  MaterialId.Stone,
  MaterialId.Basalt,
  MaterialId.Crystal,
  MaterialId.Ice,
  MaterialId.Sandstone,
];

function getElementGridPosition(el: PeriodicElementDef): { row: number; col: number } {
  const z = el.atomicNumber;
  if (z >= 57 && z <= 71) {
    return { row: 9, col: 4 + (z - 57) };
  }
  if (z >= 89 && z <= 103) {
    return { row: 10, col: 4 + (z - 89) };
  }
  return { row: el.period, col: el.group };
}

export const PeriodicTableView: React.FC<PeriodicTableViewProps> = ({
  hypergraph,
  hoveredVoxProfile,
}) => {
  const [selectedZ, setSelectedZ] = React.useState<number>(6); // Default C (Carbon)
  const [compoundFilter, setCompoundFilter] = React.useState<'all' | 'gas' | 'bio' | 'mineral'>('all');
  const [fallbackMaterialId, setFallbackMaterialId] = React.useState<MaterialId>(MaterialId.Basalt);

  const selectedElement =
    PERIODIC_ELEMENTS.find((e) => e.atomicNumber === selectedZ) ?? PERIODIC_ELEMENTS[5];

  // Collect element symbols currently active in hypergraph species
  const activeHypergraphSymbols = React.useMemo(() => {
    const set = new Set<string>();
    for (const sp of hypergraph.species) {
      if (sp.elementComposition) {
        for (const sym of Object.keys(sp.elementComposition)) {
          set.add(sym);
        }
      }
      if (sp.compoundId) {
        const comp = COMPOUND_CATALOG.find((c) => c.id === sp.compoundId);
        if (comp) {
          for (const sym of Object.keys(comp.atoms)) {
            set.add(sym);
          }
        }
      }
    }
    return set;
  }, [hypergraph]);

  const activeMaterialId = hoveredVoxProfile?.materialId ?? fallbackMaterialId;
  const activeMatComp =
    hoveredVoxProfile?.materialComposition ??
    VOXEL_MATERIAL_COMPOSITIONS[activeMaterialId] ??
    VOXEL_MATERIAL_COMPOSITIONS[MaterialId.Stone];
  const activeElementBreakdown =
    hoveredVoxProfile?.elementalBreakdown ?? computeMaterialElementalBreakdown(activeMaterialId);

  const activeRockSymbols = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of activeElementBreakdown) {
      set.add(item.symbol);
    }
    return set;
  }, [activeElementBreakdown]);

  const filteredCompounds = React.useMemo(() => {
    if (compoundFilter === 'all') return COMPOUND_CATALOG;
    if (compoundFilter === 'gas') {
      return COMPOUND_CATALOG.filter((c) => c.domain === 'atmosphere' || c.domain === 'hydrosphere');
    }
    if (compoundFilter === 'bio') {
      return COMPOUND_CATALOG.filter((c) => c.domain === 'biochemistry');
    }
    return COMPOUND_CATALOG.filter((c) => c.domain === 'lithosphere');
  }, [compoundFilter]);

  return (
    <div className="space-y-2" data-testid="periodic-table-view">
      {/* 1. Compact 18-Column Periodic Table of Elements (1-118) */}
      <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-medium text-slate-200">宇宙元素周期表 (Z=1–118 IUPAC)</span>
          <div className="flex items-center gap-2 text-[9px] text-slate-400">
            <span className="text-cyan-300">青框: 当前反应网</span>
            <span>·</span>
            <span className="text-amber-300">黄底: 岩体矿物</span>
          </div>
        </div>

        <div
          className="grid gap-[1.5px]"
          style={{ gridTemplateColumns: 'repeat(18, minmax(0, 1fr))' }}
        >
          {PERIODIC_ELEMENTS.map((el) => {
            const { row, col } = getElementGridPosition(el);
            const inHyper = activeHypergraphSymbols.has(el.symbol);
            const inRock = activeRockSymbols.has(el.symbol);
            const isSel = selectedZ === el.atomicNumber;
            const [r, g, b] = el.cpkRgb;
            const cpkHex = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

            return (
              <button
                key={el.atomicNumber}
                type="button"
                onClick={() => setSelectedZ(el.atomicNumber)}
                title={`${el.atomicNumber} ${el.symbol} ${el.nameZh} (${el.atomicMassGPerMol.toFixed(2)} g/mol)`}
                style={{
                  gridRow: row,
                  gridColumn: col,
                  borderColor: isSel
                    ? '#f8fafc'
                    : inHyper
                      ? '#22d3ee'
                      : inRock
                        ? '#f59e0b'
                        : '#1e293b',
                  backgroundColor: isSel
                    ? 'rgba(14, 116, 144, 0.55)'
                    : inRock
                      ? 'rgba(120, 53, 15, 0.35)'
                      : '#070b14',
                }}
                className="h-[22px] rounded-[1px] border flex flex-col items-center justify-center leading-none cursor-pointer transition-colors hover:border-slate-400"
              >
                <span className="text-[7px] font-bold font-mono-tabular" style={{ color: cpkHex }}>
                  {el.symbol}
                </span>
                <span className="text-[5.5px] text-slate-500 font-mono-tabular">
                  {el.atomicNumber}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected Element Scientific Spec Sheet */}
        <div className="rounded-xs border border-slate-800 bg-[#090d18] p-2 space-y-1 text-[10px]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className="w-5 h-5 rounded-xs border border-slate-700 flex items-center justify-center font-bold font-mono-tabular text-[11px]"
                style={{
                  color: `rgb(${Math.round(selectedElement.cpkRgb[0] * 255)}, ${Math.round(selectedElement.cpkRgb[1] * 255)}, ${Math.round(selectedElement.cpkRgb[2] * 255)})`,
                  backgroundColor: '#050810',
                }}
              >
                {selectedElement.symbol}
              </span>
              <div>
                <div className="font-semibold text-slate-100">
                  {selectedElement.atomicNumber}. {selectedElement.nameZh} ({selectedElement.nameEn})
                </div>
                <div className="text-[9px] text-slate-400 font-mono-tabular">
                  {CATEGORY_LABELS[selectedElement.category]} · 第{selectedElement.period}周期 / 第{selectedElement.group}族
                </div>
              </div>
            </div>
            <div className="text-right font-mono-tabular">
              <div className="text-cyan-300 font-semibold">
                {selectedElement.atomicMassGPerMol.toFixed(3)} g/mol
              </div>
              <div className="text-[9px] text-slate-400">
                电负性 {selectedElement.electronegativity ?? '—'} · 化合价 {selectedElement.commonValence}
              </div>
            </div>
          </div>
          <div className="text-[9.5px] text-slate-300 border-t border-slate-800/80 pt-1">
            天体与代谢职能: {selectedElement.bioGeoRole}
          </div>
        </div>
      </div>

      {/* 2. Voxel Mineral & Elemental Inspector (Live Hovered Vox or Material Sample) */}
      <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-medium text-slate-200">
            {hoveredVoxProfile
              ? `实时体素矿物与组分探针 [${hoveredVoxProfile.cellCoords.join(',')}]`
              : '体素岩相与真实矿物元素丰度'}
          </span>
          {hoveredVoxProfile && (
            <span className="font-mono-tabular text-amber-300">
              {MATTER_PHASE_LABELS[hoveredVoxProfile.phase]} · {hoveredVoxProfile.temperatureK.toFixed(0)}K
            </span>
          )}
        </div>

        {!hoveredVoxProfile && (
          <div className="grid grid-cols-6 gap-1">
            {SOLID_MATERIALS.map((mat) => {
              const info = VOXEL_MATERIAL_COMPOSITIONS[mat];
              const active = fallbackMaterialId === mat;
              return (
                <button
                  key={mat}
                  type="button"
                  onClick={() => setFallbackMaterialId(mat)}
                  className={`h-6 px-1 rounded-xs border text-[9.5px] whitespace-nowrap cursor-pointer ${
                    active
                      ? 'border-amber-400 bg-amber-950/50 text-amber-200'
                      : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
                  }`}
                >
                  {info.materialNameZh.slice(0, 3)}
                </button>
              );
            })}
          </div>
        )}

        <div className="rounded-xs border border-slate-800 bg-[#090d18] p-1.5 space-y-1 text-[9.5px]">
          <div className="flex justify-between text-slate-300 font-mono-tabular">
            <span className="font-semibold text-amber-200">{activeMatComp.materialNameZh}</span>
            <span className="text-slate-400">
              {activeMatComp.bulkDensityKgM3} kg/m³ · φ={hoveredVoxProfile ? hoveredVoxProfile.porosity.toFixed(2) : activeMatComp.effectivePorosity.toFixed(2)}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-slate-400 font-mono-tabular">
            {activeMatComp.components.map((m) => {
              const comp = COMPOUND_CATALOG.find((c) => c.id === m.compoundId);
              return (
                <span key={m.compoundId}>
                  {comp?.formulaTag ?? m.compoundId} {(m.weightFraction * 100).toFixed(0)}%
                </span>
              );
            })}
          </div>

          <div className="space-y-1 pt-0.5">
            {activeElementBreakdown.slice(0, 5).map((item) => {
              const el = ELEMENT_BY_SYMBOL.get(item.symbol);
              const col = el
                ? `rgb(${Math.round(el.cpkRgb[0] * 255)}, ${Math.round(el.cpkRgb[1] * 255)}, ${Math.round(el.cpkRgb[2] * 255)})`
                : '#94a3b8';
              return (
                <div key={item.symbol} className="flex items-center gap-1.5 font-mono-tabular text-[9px]">
                  <button
                    type="button"
                    onClick={() => el && setSelectedZ(el.atomicNumber)}
                    className="w-6 text-left font-bold hover:underline cursor-pointer"
                    style={{ color: col }}
                  >
                    {item.symbol}
                  </button>
                  <div className="flex-1 h-1.5 bg-[#050810] rounded-xs overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.min(100, Math.max(2, item.weightPercent))}%`,
                        backgroundColor: col,
                      }}
                    />
                  </div>
                  <span className="w-11 text-right text-slate-300">{item.weightPercent.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>

          {hoveredVoxProfile && (
            <div className="border-t border-slate-800/80 pt-1 grid grid-cols-3 gap-1 font-mono-tabular text-[9px]">
              {hoveredVoxProfile.speciesConcentrations.map((sc) => (
                <div key={sc.index} className="flex justify-between text-slate-300">
                  <span style={{ color: `rgb(${Math.round(sc.colorRgb[0] * 255)}, ${Math.round(sc.colorRgb[1] * 255)}, ${Math.round(sc.colorRgb[2] * 255)})` }}>
                    {sc.formulaTag}
                  </span>
                  <span>{sc.molPerM3.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Real Compound & Mineral Catalog Browser */}
      <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-slate-200 whitespace-nowrap">
            真实化合物库 ({filteredCompounds.length})
          </span>
          <div className="flex items-center gap-1">
            {(
              [
                ['all', '全部'],
                ['gas', '气相/挥发'],
                ['bio', '生物代谢'],
                ['mineral', '岩石矿物'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCompoundFilter(k)}
                className={`h-5 px-1.5 rounded-xs border text-[9px] whitespace-nowrap cursor-pointer ${
                  compoundFilter === k
                    ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
                    : 'border-slate-800 bg-[#090d18] text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[126px] overflow-y-auto space-y-1 pr-0.5">
          {filteredCompounds.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-xs border border-slate-800/80 bg-[#090d18] px-2 py-1 text-[9.5px]"
            >
              <div className="min-w-0">
                <span className="font-mono-tabular font-semibold text-cyan-200 mr-1.5">
                  {c.formulaTag}
                </span>
                <span className="text-slate-300 truncate">{c.nameZh}</span>
              </div>
              <div className="text-right font-mono-tabular text-[9px] text-slate-400 whitespace-nowrap shrink-0">
                {(c.molarMassKgPerMol * 1000).toFixed(2)} g/mol
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
