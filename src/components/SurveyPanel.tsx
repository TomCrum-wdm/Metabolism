import React, { useEffect, useMemo, useState } from 'react';
import {
  Compass,
  Crosshair,
  Download,
  Globe2,
  Layers,
  MapPin,
  Navigation,
  RefreshCw,
  Ruler,
  Trash2,
  X,
} from 'lucide-react';
import {
  COORD_SYSTEM_SPECS,
  CoordDatum,
  CoordSystemId,
  coordToWorld,
  worldToAllCoords,
  worldToCoord,
} from '../engine/coordinates';
import {
  BoreholeLogReport,
  exportBenchmarksToCsv,
  exportBoreholeToCsv,
  exportSurveyGeoJson,
  exportTransectToCsv,
  GeologicalAttitude,
  GeologicalTransectReport,
  getMaterialSwatchHex,
  MATERIAL_CN_NAMES,
  MATERIAL_SHORT_NAMES,
  PolygonSurveyReport,
  SurveyBenchmark,
} from '../engine/geologySurvey';
import { MaterialId } from '../engine/voxelPlanet';
import { SandboxConfig, SandboxTelemetry } from '../engine/webgpuScene';

export type SurveyPanelTab = 'pins' | 'transect' | 'borehole' | 'attitude' | 'crs';

interface SurveyPanelProps {
  activeTab: SurveyPanelTab;
  onChangeTab: (tab: SurveyPanelTab) => void;
  config: SandboxConfig;
  telemetry: SandboxTelemetry;
  datum: CoordDatum;
  benchmarks: ReadonlyArray<SurveyBenchmark>;
  polygonReport: PolygonSurveyReport | null;
  pendingTransectA: [number, number, number] | null;
  transect: GeologicalTransectReport | null;
  borehole: BoreholeLogReport | null;
  boreholeDepthRatio: number;
  lockedAttitude: GeologicalAttitude | null;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onSelectSurveyTool: (toolId: 'surveyPin' | 'surveyTransect' | 'surveyBorehole' | 'surveyClinometer') => void;
  onDropBenchmarkAtPlayer: () => void;
  onDeleteBenchmark: (id: string) => void;
  onClearBenchmarks: () => void;
  onResetTransect: () => void;
  onSampleTransectPlayerToHover: () => void;
  onDrillBoreholeAtPlayer: () => void;
  onChangeBoreholeDepthRatio: (ratio: number) => void;
  onSetEnuOrigin: (worldPos: [number, number, number]) => void;
  onTeleportToWorld: (worldPos: [number, number, number]) => void;
  onClose: () => void;
}

function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TAB_ITEMS: ReadonlyArray<{
  id: SurveyPanelTab;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'pins', label: '控制点', icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: 'transect', label: '剖面线', icon: <Ruler className="w-3.5 h-3.5" /> },
  { id: 'borehole', label: '钻孔芯', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'attitude', label: '产状', icon: <Compass className="w-3.5 h-3.5" /> },
  { id: 'crs', label: '坐标系', icon: <Globe2 className="w-3.5 h-3.5" /> },
];

export const SurveyPanel: React.FC<SurveyPanelProps> = ({
  activeTab,
  onChangeTab,
  config,
  telemetry,
  datum,
  benchmarks,
  polygonReport,
  pendingTransectA,
  transect,
  borehole,
  boreholeDepthRatio,
  lockedAttitude,
  onUpdateConfig,
  onSelectSurveyTool,
  onDropBenchmarkAtPlayer,
  onDeleteBenchmark,
  onClearBenchmarks,
  onResetTransect,
  onSampleTransectPlayerToHover,
  onDrillBoreholeAtPlayer,
  onChangeBoreholeDepthRatio,
  onSetEnuOrigin,
  onTeleportToWorld,
  onClose,
}) => {
  const [hoverTransectIdx, setHoverTransectIdx] = useState<number | null>(null);
  const [converterCrs, setConverterCrs] = useState<CoordSystemId>(config.coordSystem);
  const [inputC1, setInputC1] = useState('0');
  const [inputC2, setInputC2] = useState('0');
  const [inputC3, setInputC3] = useState('0');
  const [utmZoneInput, setUtmZoneInput] = useState('31');
  const [utmHemiInput, setUtmHemiInput] = useState<'N' | 'S'>('N');
  const [converterWorldPos, setConverterWorldPos] = useState<[number, number, number]>(
    () => [datum.planetRadius, 0, 0],
  );

  // Keep converter pre-filled from active player/hover when switching CRS tab or picking
  const liveRefWorld: [number, number, number] = useMemo(() => {
    if (telemetry.hoveredWorldPos) return telemetry.hoveredWorldPos;
    const latRad = (telemetry.playerLatDeg * Math.PI) / 180;
    const lonRad = (telemetry.playerLonDeg * Math.PI) / 180;
    const r = datum.planetRadius + telemetry.altitude;
    const cosL = Math.cos(latRad);
    return [r * cosL * Math.cos(lonRad), r * Math.sin(latRad), r * cosL * Math.sin(lonRad)];
  }, [
    datum.planetRadius,
    telemetry.altitude,
    telemetry.hoveredWorldPos,
    telemetry.playerLatDeg,
    telemetry.playerLonDeg,
  ]);

  const syncConverterInputsFromWorld = (pos: [number, number, number], targetCrs: CoordSystemId) => {
    const r = worldToCoord(pos, targetCrs, datum);
    if (targetCrs === 'utm_tm') {
      setUtmZoneInput(String(r.components[0].numericValue));
      setUtmHemiInput(r.utmZone?.endsWith('S') ? 'S' : 'N');
      setInputC1(String(r.components[0].numericValue));
      setInputC2(r.components[1].numericValue.toFixed(3));
      setInputC3(r.components[2].numericValue.toFixed(3));
    } else {
      setInputC1(r.components[0].numericValue.toFixed(targetCrs === 'voxel_ijk' ? 0 : 4));
      setInputC2(r.components[1].numericValue.toFixed(targetCrs === 'voxel_ijk' ? 0 : 4));
      setInputC3(r.components[2].numericValue.toFixed(targetCrs === 'voxel_ijk' ? 0 : 4));
    }
    setConverterWorldPos(pos);
  };

  useEffect(() => {
    if (activeTab === 'crs') {
      syncConverterInputsFromWorld(liveRefWorld, converterCrs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const activeConverterCoords = useMemo(
    () => worldToAllCoords(converterWorldPos, datum),
    [converterWorldPos, datum],
  );

  const liveAttitude = telemetry.hoveredAttitude ?? lockedAttitude;
  const activeCrsSpec =
    COORD_SYSTEM_SPECS.find((s) => s.id === config.coordSystem) ?? COORD_SYSTEM_SPECS[0];
  const convCrsSpec =
    COORD_SYSTEM_SPECS.find((s) => s.id === converterCrs) ?? COORD_SYSTEM_SPECS[0];

  const handleApplyConverterInputs = (teleport: boolean) => {
    const c1 = Number(inputC1);
    const c2 = Number(inputC2);
    const c3 = Number(inputC3);
    if (!Number.isFinite(c1) || !Number.isFinite(c2) || !Number.isFinite(c3)) return;
    const worldPos = coordToWorld(converterCrs, c1, c2, c3, datum, {
      utmZone: Number(utmZoneInput) || 31,
      utmHemi: utmHemiInput,
    });
    setConverterWorldPos(worldPos);
    if (teleport) {
      onTeleportToWorld(worldPos);
    }
  };

  const hoveredSample =
    transect && hoverTransectIdx !== null ? transect.samples[hoverTransectIdx] ?? null : null;

  return (
    <aside
      data-testid="survey-workstation-panel"
      className="pointer-events-auto fixed right-2.5 top-11 bottom-16 z-20 w-[410px] max-w-[94vw] rounded-sm border border-slate-700/90 bg-[#080c16]/95 shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800 bg-[#0b1120] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Compass className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-white truncate">
              地质测绘与多坐标系工作站
            </h2>
            <p className="text-[10px] text-slate-400 font-mono-tabular truncate">
              活动基准: {activeCrsSpec.code} · R₀={datum.planetRadius.toFixed(2)}m
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            tabIndex={-1}
            data-testid="survey-grid-toggle-btn"
            onClick={() => onUpdateConfig({ showCoordGrid: !config.showCoordGrid })}
            className={`px-2 py-1 rounded-xs border text-[10px] font-medium cursor-pointer transition-colors ${
              config.showCoordGrid
                ? 'border-cyan-400 bg-cyan-950/70 text-cyan-200'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
            }`}
          >
            经纬网 {config.showCoordGrid ? '开' : '关'}
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={onClose}
            aria-label="关闭测绘工作站"
            className="p-1 rounded-xs border border-slate-800 bg-slate-900/90 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Active Coordinate System Quick Selector */}
      <div className="px-3 py-1.5 border-b border-slate-800/80 bg-[#090e1b] flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-400 shrink-0">当前坐标系</span>
        <select
          data-testid="survey-crs-select"
          value={config.coordSystem}
          onChange={(e) =>
            onUpdateConfig({ coordSystem: e.target.value as CoordSystemId })
          }
          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xs px-2 py-1 text-[11px] font-mono-tabular text-cyan-200 focus:outline-none focus:border-cyan-400"
        >
          {COORD_SYSTEM_SPECS.map((s) => (
            <option key={s.id} value={s.id}>
              [{s.code}] {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-5 border-b border-slate-800 bg-[#070b14]">
        {TAB_ITEMS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              tabIndex={-1}
              data-testid={`survey-tab-${t.id}`}
              onClick={() => onChangeTab(t.id)}
              className={`py-2 px-1 text-[11px] font-medium flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'border-cyan-400 bg-cyan-950/35 text-cyan-200'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-[11px]">
        {/* TAB 1: SURVEY BENCHMARKS & SPHERICAL POLYGON AREA */}
        {activeTab === 'pins' && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                data-testid="activate-survey-pin-tool-btn"
                onClick={() => onSelectSurveyTool('surveyPin')}
                className={`px-2.5 py-1 rounded-xs border text-[11px] font-medium cursor-pointer flex items-center gap-1 ${
                  config.tool === 'surveyPin'
                    ? 'border-sky-400 bg-sky-950/70 text-sky-200'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-sky-500/60'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>{config.tool === 'surveyPin' ? '点击星球表面打点中' : '启用控制点打点工具'}</span>
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="drop-pin-at-player-btn"
                  onClick={onDropBenchmarkAtPlayer}
                  className="px-2 py-1 rounded-xs border border-slate-700 bg-slate-900 hover:border-cyan-400 text-slate-200 cursor-pointer flex items-center gap-1"
                >
                  <Crosshair className="w-3 h-3 text-cyan-400" />
                  <span>原地落标</span>
                </button>
                {benchmarks.length > 0 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={onClearBenchmarks}
                    className="p-1 rounded-xs border border-slate-800 bg-slate-950 hover:border-rose-500/70 text-slate-400 hover:text-rose-300 cursor-pointer"
                    title="清空全部控制点"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {polygonReport && (
              <div
                data-testid="polygon-survey-card"
                className="rounded-xs border border-cyan-500/40 bg-cyan-950/25 p-2 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[10px] text-cyan-300 font-semibold">
                  <span>闭合多边形测区 ({polygonReport.vertexCount} 点球面余角法)</span>
                  <span className="font-mono-tabular">Girard S²</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono-tabular text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">球面面积</span>
                    <span className="text-white font-semibold">
                      {polygonReport.sphericalAreaM2.toFixed(2)} m²
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">测区周长</span>
                    <span className="text-slate-200">
                      {polygonReport.perimeter3DM.toFixed(2)} m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">高程区间</span>
                    <span className="text-amber-300">
                      {polygonReport.minElevM.toFixed(2)}~{polygonReport.maxElevM.toFixed(2)}m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">净方量(基准R₀)</span>
                    <span className="text-emerald-300">
                      {polygonReport.estimatedVolumeAboveDatumM3 >= 0 ? '+' : ''}
                      {polygonReport.estimatedVolumeAboveDatumM3.toFixed(2)} m³
                    </span>
                  </div>
                </div>
              </div>
            )}

            {benchmarks.length === 0 ? (
              <div className="rounded-xs border border-dashed border-slate-800 bg-slate-950/50 p-4 text-center text-slate-400">
                暂无测量控制点。使用左侧“测量控制点”工具点击星球地表，或点击上方“原地落标”建立测站网络；标记 ≥3 个点将自动闭合计算球面面积与方量。
              </div>
            ) : (
              <div className="space-y-1.5">
                {benchmarks.map((b) => {
                  const crd = worldToCoord(b.worldPos, config.coordSystem, datum);
                  return (
                    <div
                      key={b.id}
                      data-testid={`benchmark-item-${b.code}`}
                      className="rounded-xs border border-slate-800 bg-[#0b101d] p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="px-1.5 py-0.5 rounded-xs bg-sky-950/80 border border-sky-500/50 text-sky-300 font-mono-tabular text-[10px] font-semibold">
                            {b.code}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-xs border border-slate-600 shrink-0"
                            style={{ backgroundColor: getMaterialSwatchHex(b.material) }}
                          />
                          <span className="text-slate-200 font-medium truncate">
                            {MATERIAL_SHORT_NAMES[b.material]} · {b.slopeDeg.toFixed(1)}°
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            tabIndex={-1}
                            title="设为 ENU 局部站心原点"
                            onClick={() => onSetEnuOrigin(b.worldPos)}
                            className="px-1.5 py-0.5 rounded-xs border border-slate-700 bg-slate-900 hover:border-emerald-400 text-[10px] text-emerald-300 cursor-pointer"
                          >
                            设原点
                          </button>
                          <button
                            type="button"
                            tabIndex={-1}
                            title="跳转相机/角色至此点"
                            onClick={() => onTeleportToWorld(b.worldPos)}
                            className="p-1 rounded-xs border border-slate-700 bg-slate-900 hover:border-sky-400 text-sky-300 cursor-pointer"
                          >
                            <Navigation className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            tabIndex={-1}
                            title="删除控制点"
                            onClick={() => onDeleteBenchmark(b.id)}
                            className="p-1 rounded-xs border border-slate-800 bg-slate-950 hover:border-rose-500 text-slate-400 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="font-mono-tabular text-[10.5px] text-cyan-200">
                        {crd.compact}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono-tabular">
                        <span>走向 {Math.round(b.strikeDeg)}° / 倾向 {Math.round(b.dipDirectionDeg)}°</span>
                        <span>T={b.tempC.toFixed(1)}°C · g={b.gravityMs2.toFixed(2)}m/s²</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Scientific Data Exports */}
            <div className="pt-1 border-t border-slate-800/80 flex items-center gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                disabled={benchmarks.length === 0}
                data-testid="export-benchmarks-csv-btn"
                onClick={() =>
                  downloadTextFile(
                    `terrasphere_survey_points_seed${telemetry.seed}.csv`,
                    exportBenchmarksToCsv(benchmarks, datum),
                    'text/csv;charset=utf-8',
                  )
                }
                className="flex-1 py-1.5 px-2 rounded-xs border border-slate-700 bg-slate-900 hover:border-cyan-400 disabled:opacity-40 text-slate-200 font-medium flex items-center justify-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>导出控制点 CSV</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                disabled={benchmarks.length === 0 && !transect}
                data-testid="export-survey-geojson-btn"
                onClick={() =>
                  downloadTextFile(
                    `terrasphere_survey_seed${telemetry.seed}.geojson`,
                    exportSurveyGeoJson(benchmarks, transect, datum),
                    'application/geo+json;charset=utf-8',
                  )
                }
                className="flex-1 py-1.5 px-2 rounded-xs border border-slate-700 bg-slate-900 hover:border-emerald-400 disabled:opacity-40 text-slate-200 font-medium flex items-center justify-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>导出 GeoJSON</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: GEODESIC & LITHOLOGIC TRANSECT PROFILER */}
        {activeTab === 'transect' && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                data-testid="activate-survey-transect-tool-btn"
                onClick={() => onSelectSurveyTool('surveyTransect')}
                className={`px-2.5 py-1 rounded-xs border text-[11px] font-medium cursor-pointer flex items-center gap-1 ${
                  config.tool === 'surveyTransect'
                    ? 'border-teal-400 bg-teal-950/70 text-teal-200'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-teal-500/60'
                }`}
              >
                <Ruler className="w-3.5 h-3.5" />
                <span>
                  {pendingTransectA
                    ? '已定 A 点 · 请点击 B 点'
                    : config.tool === 'surveyTransect'
                      ? '请依次点击星球 A/B 两点'
                      : '启用测地剖面线工具'}
                </span>
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="quick-transect-btn"
                  onClick={onSampleTransectPlayerToHover}
                  className="px-2 py-1 rounded-xs border border-slate-700 bg-slate-900 hover:border-teal-400 text-slate-200 cursor-pointer"
                  title="以当前位置为起点向东经延伸生成示范大圆剖面"
                >
                  跨区剖面
                </button>
                {(pendingTransectA || transect) && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={onResetTransect}
                    className="p-1 rounded-xs border border-slate-800 bg-slate-950 hover:border-rose-500 text-slate-400 hover:text-rose-300 cursor-pointer"
                    title="清除剖面线"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {!transect ? (
              <div className="rounded-xs border border-dashed border-slate-800 bg-slate-950/50 p-4 text-center text-slate-400">
                {pendingTransectA
                  ? '起点 A 已标定，请在星球表面点击终点 B，系统将沿球面大圆测地线计算弧长、起伏、岩性与温度剖面。'
                  : '启用“测地剖面线”工具依次点击两点，或点击上方“跨区剖面”立即生成高精度大圆地形地质剖面图。'}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5 font-mono-tabular">
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">大圆弧长</div>
                    <div className="text-xs font-semibold text-teal-300">
                      {transect.spherical.geodesicArcM.toFixed(2)} m
                    </div>
                  </div>
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">地形路径长</div>
                    <div className="text-xs font-semibold text-white">
                      {transect.surfacePathLengthM.toFixed(2)} m
                    </div>
                  </div>
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">最大高差</div>
                    <div className="text-xs font-semibold text-amber-300">
                      {transect.reliefM.toFixed(2)} m
                    </div>
                  </div>
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">总爬升 / 下降</div>
                    <div className="text-[11px] text-emerald-300">
                      +{transect.totalAscentM.toFixed(1)} / -{transect.totalDescentM.toFixed(1)}m
                    </div>
                  </div>
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">最大 / 均坡</div>
                    <div className="text-[11px] text-orange-300">
                      {transect.maxSlopeDeg.toFixed(1)}° / {transect.meanSlopeDeg.toFixed(1)}°
                    </div>
                  </div>
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">正反方位角</div>
                    <div className="text-[11px] text-sky-300">
                      {transect.spherical.forwardAzimuthDeg.toFixed(0)}° / {transect.spherical.backAzimuthDeg.toFixed(0)}°
                    </div>
                  </div>
                </div>

                {/* SVG Geological & Elevation Profile Chart */}
                <div className="rounded-xs border border-slate-800 bg-[#060911] p-2 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>地形高程-地层岩性-温度剖面</span>
                    <span className="font-mono-tabular text-teal-300">
                      {hoveredSample
                        ? `${hoveredSample.arcDistanceM.toFixed(2)}m · ${hoveredSample.elevationM >= 0 ? '+' : ''}${hoveredSample.elevationM.toFixed(2)}m · ${MATERIAL_SHORT_NAMES[hoveredSample.material]} · ${hoveredSample.tempC.toFixed(1)}°C`
                        : '悬停剖面读取任意桩号'}
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 360 150"
                    className="w-full h-40 cursor-crosshair select-none"
                    onMouseLeave={() => setHoverTransectIdx(null)}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      const idx = Math.round(u * (transect.samples.length - 1));
                      setHoverTransectIdx(idx);
                    }}
                  >
                    {(() => {
                      const W = 360;
                      const H = 150;
                      const padL = 8;
                      const padR = 8;
                      const padT = 10;
                      const padB = 18;
                      const plotW = W - padL - padR;
                      const plotH = H - padT - padB;
                      const minE = transect.minElevM - Math.max(0.4, transect.reliefM * 0.25);
                      const maxE = transect.maxElevM + Math.max(0.4, transect.reliefM * 0.15);
                      const spanE = Math.max(0.5, maxE - minE);
                      const toX = (i: number) =>
                        padL + (i / Math.max(1, transect.samples.length - 1)) * plotW;
                      const toY = (el: number) => padT + (1 - (el - minE) / spanE) * plotH;

                      const yDatum = toY(0);
                      const minT = Math.min(...transect.samples.map((s) => s.tempC));
                      const maxT = Math.max(...transect.samples.map((s) => s.tempC));
                      const spanT = Math.max(1, maxT - minT);

                      const colW = plotW / Math.max(1, transect.samples.length - 1) + 0.6;
                      const elevPts = transect.samples
                        .map((s, i) => `${toX(i).toFixed(1)},${toY(s.elevationM).toFixed(1)}`)
                        .join(' ');
                      const tempPts = transect.samples
                        .map((s, i) => {
                          const ty = padT + (1 - (s.tempC - minT) / spanT) * plotH * 0.8 + 4;
                          return `${toX(i).toFixed(1)},${ty.toFixed(1)}`;
                        })
                        .join(' ');

                      return (
                        <>
                          {/* Subsurface lithology vertical strips */}
                          {transect.samples.map((s, i) => {
                            const x = toX(i) - colW * 0.5;
                            const ySurf = toY(s.elevationM);
                            const colH = Math.max(2, H - padB - ySurf);
                            const yMid = ySurf + colH * 0.35;
                            const yDeep = ySurf + colH * 0.68;
                            return (
                              <g key={s.index}>
                                <rect
                                  x={x}
                                  y={ySurf}
                                  width={colW}
                                  height={Math.max(1, yMid - ySurf)}
                                  fill={getMaterialSwatchHex(s.material)}
                                  fillOpacity={0.62}
                                />
                                <rect
                                  x={x}
                                  y={yMid}
                                  width={colW}
                                  height={Math.max(1, yDeep - yMid)}
                                  fill={getMaterialSwatchHex(s.subMat1)}
                                  fillOpacity={0.55}
                                />
                                <rect
                                  x={x}
                                  y={yDeep}
                                  width={colW}
                                  height={Math.max(1, H - padB - yDeep)}
                                  fill={getMaterialSwatchHex(s.subMat2)}
                                  fillOpacity={0.48}
                                />
                              </g>
                            );
                          })}

                          {/* Datum R0 line */}
                          {yDatum >= padT && yDatum <= H - padB && (
                            <line
                              x1={padL}
                              x2={W - padR}
                              y1={yDatum}
                              y2={yDatum}
                              stroke="#475569"
                              strokeDasharray="3 3"
                              strokeWidth="0.9"
                            />
                          )}

                          {/* Elevation curve */}
                          <polyline
                            fill="none"
                            stroke="#2dd4bf"
                            strokeWidth="1.8"
                            points={elevPts}
                          />

                          {/* Temperature overlay curve */}
                          <polyline
                            fill="none"
                            stroke="#fbbf24"
                            strokeWidth="1.1"
                            strokeOpacity="0.85"
                            strokeDasharray="2.5 2"
                            points={tempPts}
                          />

                          {/* Hover crosshair */}
                          {hoveredSample && (
                            <g>
                              <line
                                x1={toX(hoveredSample.index)}
                                x2={toX(hoveredSample.index)}
                                y1={padT}
                                y2={H - padB}
                                stroke="#f8fafc"
                                strokeWidth="1"
                                strokeDasharray="2 2"
                              />
                              <circle
                                cx={toX(hoveredSample.index)}
                                cy={toY(hoveredSample.elevationM)}
                                r="3"
                                fill="#2dd4bf"
                                stroke="#0f172a"
                                strokeWidth="1"
                              />
                            </g>
                          )}

                          {/* X Axis ticks */}
                          <text x={padL} y={H - 4} fill="#94a3b8" fontSize="9" fontFamily="monospace">
                            0.0m
                          </text>
                          <text
                            x={W * 0.5}
                            y={H - 4}
                            textAnchor="middle"
                            fill="#94a3b8"
                            fontSize="9"
                            fontFamily="monospace"
                          >
                            {(transect.spherical.geodesicArcM * 0.5).toFixed(1)}m
                          </text>
                          <text
                            x={W - padR}
                            y={H - 4}
                            textAnchor="end"
                            fill="#94a3b8"
                            fontSize="9"
                            fontFamily="monospace"
                          >
                            {transect.spherical.geodesicArcM.toFixed(1)}m
                          </text>
                        </>
                      );
                    })()}
                  </svg>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono-tabular">
                    <span>实线: 地形高程 ({transect.minElevM.toFixed(1)}~{transect.maxElevM.toFixed(1)}m)</span>
                    <span className="text-amber-300">虚线: 地表温度 (°C)</span>
                  </div>
                </div>

                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="export-transect-csv-btn"
                  onClick={() =>
                    downloadTextFile(
                      `terrasphere_transect_${transect.id}.csv`,
                      exportTransectToCsv(transect),
                      'text/csv;charset=utf-8',
                    )
                  }
                  className="w-full py-1.5 px-2 rounded-xs border border-slate-700 bg-slate-900 hover:border-teal-400 text-slate-200 font-medium flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-teal-400" />
                  <span>导出剖面桩号 CSV ({transect.samples.length} 点)</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* TAB 3: VIRTUAL BOREHOLE CORE LOG */}
        {activeTab === 'borehole' && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                data-testid="activate-survey-borehole-tool-btn"
                onClick={() => onSelectSurveyTool('surveyBorehole')}
                className={`px-2.5 py-1 rounded-xs border text-[11px] font-medium cursor-pointer flex items-center gap-1 ${
                  config.tool === 'surveyBorehole'
                    ? 'border-violet-400 bg-violet-950/70 text-violet-200'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-violet-500/60'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{config.tool === 'surveyBorehole' ? '点击地表垂直下钻采样' : '启用钻孔取芯工具'}</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="drill-at-player-btn"
                onClick={onDrillBoreholeAtPlayer}
                className="px-2 py-1 rounded-xs border border-slate-700 bg-slate-900 hover:border-violet-400 text-slate-200 cursor-pointer"
              >
                原地钻孔
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 text-[10.5px]">
              <span className="text-slate-400">钻探目标深度</span>
              <input
                type="range"
                min={0.15}
                max={0.85}
                step={0.05}
                value={boreholeDepthRatio}
                onChange={(e) => onChangeBoreholeDepthRatio(Number(e.target.value))}
                className="flex-1 accent-violet-400"
              />
              <span className="font-mono-tabular text-violet-300 w-16 text-right">
                {(boreholeDepthRatio * datum.planetRadius).toFixed(1)}m
              </span>
            </div>

            {!borehole ? (
              <div className="rounded-xs border border-dashed border-slate-800 bg-slate-950/50 p-4 text-center text-slate-400">
                暂无钻孔岩芯记录。点击“钻孔取芯工具”点击星球任意区域，或点击上方“原地钻孔”查看垂直地层柱状剖面与地温梯度。
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5 font-mono-tabular">
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">孔口位置 / 高程</div>
                    <div className="text-white">
                      {borehole.collarLatDeg.toFixed(1)}°, {borehole.collarLonDeg.toFixed(1)}° ({borehole.collarElevM >= 0 ? '+' : ''}
                      {borehole.collarElevM.toFixed(2)}m)
                    </div>
                  </div>
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">岩芯采取率 / 溶洞段</div>
                    <div className="text-violet-300 font-semibold">
                      {borehole.coreRecoveryPct.toFixed(1)}% · {borehole.voidCount} 空腔
                    </div>
                  </div>
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">孔底深度 / 地层层数</div>
                    <div className="text-slate-200">
                      {borehole.drilledDepthM.toFixed(2)}m · {borehole.strata.length} 层
                    </div>
                  </div>
                  <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-1.5">
                    <div className="text-[10px] text-slate-400">地温梯度 (表→底)</div>
                    <div className="text-amber-300">
                      {borehole.surfaceTempC.toFixed(0)}→{borehole.bottomTempC.toFixed(0)}°C (+
                      {borehole.thermalGradientCPerM.toFixed(1)}°C/m)
                    </div>
                  </div>
                </div>

                {/* Stratigraphic Column Visualization */}
                <div className="rounded-xs border border-slate-800 bg-[#060911] p-2 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>地层岩性综合柱状图</span>
                    <span className="font-mono-tabular text-violet-300">{borehole.id}</span>
                  </div>
                  <div className="space-y-1">
                    {borehole.strata.map((st) => {
                      const heightPx = Math.max(18, Math.round((st.thicknessM / borehole.drilledDepthM) * 165));
                      return (
                        <div
                          key={st.index}
                          className="flex items-stretch gap-2 text-[10.5px] font-mono-tabular"
                          style={{ minHeight: `${heightPx}px` }}
                        >
                          <div className="w-16 shrink-0 text-slate-400 flex flex-col justify-between py-0.5 text-[10px]">
                            <span>{st.topDepthM.toFixed(1)}m</span>
                          </div>
                          <div
                            className={`w-10 shrink-0 rounded-xs border ${
                              st.isVoid
                                ? 'border-dashed border-slate-600 bg-slate-950/90'
                                : 'border-slate-700'
                            }`}
                            style={
                              st.isVoid
                                ? undefined
                                : { backgroundColor: getMaterialSwatchHex(st.material) }
                            }
                            title={MATERIAL_CN_NAMES[st.material]}
                          />
                          <div className="flex-1 min-w-0 rounded-xs border border-slate-800/80 bg-[#0b101c] px-2 py-1 flex items-center justify-between gap-2">
                            <span className="text-slate-100 font-medium truncate">
                              {MATERIAL_SHORT_NAMES[st.material]}
                            </span>
                            <span className="text-slate-400 shrink-0">
                              Δ{st.thicknessM.toFixed(2)}m · {st.avgTempC.toFixed(0)}°C
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="export-borehole-csv-btn"
                  onClick={() =>
                    downloadTextFile(
                      `terrasphere_borehole_${borehole.id}.csv`,
                      exportBoreholeToCsv(borehole),
                      'text/csv;charset=utf-8',
                    )
                  }
                  className="w-full py-1.5 px-2 rounded-xs border border-slate-700 bg-slate-900 hover:border-violet-400 text-slate-200 font-medium flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-violet-400" />
                  <span>导出岩芯柱状表 CSV</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* TAB 4: GEOLOGICAL COMPASS / CLINOMETER (STRIKE & DIP) */}
        {activeTab === 'attitude' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                tabIndex={-1}
                data-testid="activate-survey-clinometer-tool-btn"
                onClick={() => onSelectSurveyTool('surveyClinometer')}
                className={`px-2.5 py-1 rounded-xs border text-[11px] font-medium cursor-pointer flex items-center gap-1 ${
                  config.tool === 'surveyClinometer'
                    ? 'border-amber-400 bg-amber-950/70 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-amber-500/60'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>
                  {config.tool === 'surveyClinometer'
                    ? '悬停实时测产状 · 点击锁定'
                    : '启用地质产状罗盘'}
                </span>
              </button>
              <span className="text-[10px] text-slate-400 font-mono-tabular">右手定则 RHR</span>
            </div>

            {!liveAttitude ? (
              <div className="rounded-xs border border-dashed border-slate-800 bg-slate-950/50 p-4 text-center text-slate-400">
                启用“地质产状罗盘”并将鼠标移动或点击至山坡/陨坑岩壁，即可测定岩层走向(Strike)、倾向(Dip Dir)与倾角(Dip°)。
              </div>
            ) : (
              <div className="space-y-2.5">
                {/* Interactive Brunton Compass Rose SVG */}
                <div className="rounded-xs border border-slate-800 bg-[#060911] p-3 flex items-center justify-between gap-3">
                  <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0">
                    <circle cx="60" cy="60" r="52" fill="#0b1120" stroke="#334155" strokeWidth="1.5" />
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#1e293b" strokeDasharray="2 2" strokeWidth="1" />
                    <text x="60" y="16" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">N</text>
                    <text x="60" y="111" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">S</text>
                    <text x="108" y="63" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">E</text>
                    <text x="12" y="63" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">W</text>
                    {/* Strike bidirectional axial line */}
                    <g transform={`rotate(${liveAttitude.strikeDeg} 60 60)`}>
                      <line x1="60" y1="16" x2="60" y2="104" stroke="#38bdf8" strokeWidth="2.2" />
                      {/* Right-hand Dip Direction perpendicular tick */}
                      <line x1="60" y1="60" x2="86" y2="60" stroke="#fbbf24" strokeWidth="2.4" />
                      <polygon points="88,60 81,56 81,64" fill="#fbbf24" />
                    </g>
                    <circle cx="60" cy="60" r="3.5" fill="#f8fafc" />
                  </svg>

                  <div className="flex-1 space-y-1.5 font-mono-tabular">
                    <div>
                      <div className="text-[10px] text-slate-400">产状符号 (Strike / Dip RHR)</div>
                      <div className="text-sm font-semibold text-amber-300">
                        {liveAttitude.strikeLabel}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      <div>
                        <span className="text-slate-400">倾向: </span>
                        <span className="text-white">{liveAttitude.dipDirectionDeg.toFixed(1)}°</span>
                      </div>
                      <div>
                        <span className="text-slate-400">坡度: </span>
                        <span className="text-white">{liveAttitude.slopePct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-xs border border-slate-600"
                        style={{ backgroundColor: getMaterialSwatchHex(liveAttitude.material) }}
                      />
                      <span className="text-slate-200">
                        {MATERIAL_SHORT_NAMES[liveAttitude.material]} · {liveAttitude.elevationM >= 0 ? '+' : ''}
                        {liveAttitude.elevationM.toFixed(2)}m
                      </span>
                    </div>
                    {liveAttitude.overturned && (
                      <div className="text-[10px] text-rose-300">注意：悬崖倒转面/洞顶底板</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: MULTI-CRS CONVERTER & COORDINATE TELEPORT */}
        {activeTab === 'crs' && (
          <div className="space-y-2.5">
            <div className="rounded-xs border border-slate-800 bg-[#0b101d] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">坐标反算与精确定位跳转</span>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => syncConverterInputsFromWorld(liveRefWorld, converterCrs)}
                  className="px-2 py-0.5 rounded-xs border border-slate-700 bg-slate-900 hover:border-cyan-400 text-[10px] text-cyan-300 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>读取当前位置</span>
                </button>
              </div>

              <select
                data-testid="crs-converter-select"
                value={converterCrs}
                onChange={(e) => {
                  const next = e.target.value as CoordSystemId;
                  setConverterCrs(next);
                  syncConverterInputsFromWorld(converterWorldPos, next);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xs px-2 py-1 text-[11px] font-mono-tabular text-slate-200"
              >
                {COORD_SYSTEM_SPECS.map((s) => (
                  <option key={s.id} value={s.id}>
                    输入源坐标系: [{s.code}] {s.shortName}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-3 gap-1.5 font-mono-tabular">
                {converterCrs === 'utm_tm' ? (
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">Zone / 半球</span>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={utmZoneInput}
                        onChange={(e) => setUtmZoneInput(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xs px-1.5 py-1 text-[11px] text-white"
                      />
                      <select
                        value={utmHemiInput}
                        onChange={(e) => setUtmHemiInput(e.target.value as 'N' | 'S')}
                        className="bg-slate-950 border border-slate-700 rounded-xs px-1 py-1 text-[11px] text-white"
                      >
                        <option value="N">N</option>
                        <option value="S">S</option>
                      </select>
                    </div>
                  </label>
                ) : (
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">
                      {convCrsSpec.axisLabels[0]} ({convCrsSpec.axisUnits[0]})
                    </span>
                    <input
                      type="number"
                      step="any"
                      value={inputC1}
                      onChange={(e) => setInputC1(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xs px-1.5 py-1 text-[11px] text-white"
                    />
                  </label>
                )}

                <label className="space-y-0.5">
                  <span className="text-[10px] text-slate-400">
                    {convCrsSpec.axisLabels[1]} ({convCrsSpec.axisUnits[1]})
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={inputC2}
                    onChange={(e) => setInputC2(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xs px-1.5 py-1 text-[11px] text-white"
                  />
                </label>

                <label className="space-y-0.5">
                  <span className="text-[10px] text-slate-400">
                    {convCrsSpec.axisLabels[2]} ({convCrsSpec.axisUnits[2]})
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={inputC3}
                    onChange={(e) => setInputC3(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xs px-1.5 py-1 text-[11px] text-white"
                  />
                </label>
              </div>

              <div className="flex gap-1.5">
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="crs-convert-btn"
                  onClick={() => handleApplyConverterInputs(false)}
                  className="flex-1 py-1 px-2 rounded-xs border border-slate-700 bg-slate-900 hover:border-cyan-400 text-slate-200 cursor-pointer"
                >
                  跨系同步换算
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="crs-teleport-btn"
                  onClick={() => handleApplyConverterInputs(true)}
                  className="flex-1 py-1 px-2 rounded-xs border border-sky-500/70 bg-sky-950/70 hover:bg-sky-900 text-sky-100 font-medium cursor-pointer flex items-center justify-center gap-1"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>飞抵该坐标</span>
                </button>
              </div>
            </div>

            {/* Live Multi-CRS Readout Table */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>全坐标系实时对照矩阵</span>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => onSetEnuOrigin(converterWorldPos)}
                  className="text-emerald-300 hover:underline cursor-pointer"
                >
                  以此点为 ENU 站心原点
                </button>
              </div>
              {COORD_SYSTEM_SPECS.map((spec) => {
                const readout = activeConverterCoords[spec.id];
                const isSelected = spec.id === config.coordSystem;
                return (
                  <button
                    key={spec.id}
                    type="button"
                    tabIndex={-1}
                    onClick={() => onUpdateConfig({ coordSystem: spec.id })}
                    className={`w-full text-left rounded-xs border px-2 py-1.5 transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-cyan-400/70 bg-cyan-950/30'
                        : 'border-slate-800/80 bg-[#0b101d] hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-slate-300">{spec.name}</span>
                      <span className="font-mono-tabular text-cyan-400">{spec.code}</span>
                    </div>
                    <div className="font-mono-tabular text-[11px] text-white mt-0.5">
                      {readout.compact}
                    </div>
                    {readout.extraLabel && (
                      <div className="font-mono-tabular text-[9.5px] text-slate-400">
                        {readout.extraLabel}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
