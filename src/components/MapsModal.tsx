import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Compass,
  Crosshair,
  Download,
  Globe2,
  Layers,
  Map as MapIcon,
  Mountain,
  RefreshCw,
  Scissors,
  Thermometer,
  X,
} from 'lucide-react';
import {
  buildPlanetarySurfaceAtlas,
  CrossSectionPlane,
  dirToLonLat,
  MapMode,
  MapProbeResult,
  MapProjection,
  PlanetarySurfaceAtlas,
  probeAtlasAtLonLat,
  projectLonLatToUV,
  renderCrossSectionImageData,
  renderPlanarMapImageData,
  unprojectUVToLonLat,
} from '../engine/cartography';
import {
  CoordDatum,
  worldToCoord,
} from '../engine/coordinates';
import {
  GeologicalTransectReport,
  SurveyBenchmark,
} from '../engine/geologySurvey';
import { FluidSim } from '../engine/fluidSim';
import { MATERIAL_PALETTE, MaterialId, VoxelPlanet } from '../engine/voxelPlanet';
import { SandboxConfig, SandboxTelemetry } from '../engine/webgpuScene';
import { NumericCadInput } from './NumericCadInput';

interface MapsModalProps {
  planet: VoxelPlanet;
  fluid: FluidSim;
  telemetry: SandboxTelemetry;
  config: SandboxConfig;
  datum?: CoordDatum;
  benchmarks?: ReadonlyArray<SurveyBenchmark>;
  transect?: GeologicalTransectReport | null;
  onTeleport: (latDeg: number, lonDeg: number) => void;
  onClose: () => void;
}

const MAP_MODE_TABS: ReadonlyArray<{
  id: MapMode;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'globe3d', label: '三维星球', icon: <Globe2 className="w-3.5 h-3.5" /> },
  { id: 'topographic', label: '地形高程', icon: <Mountain className="w-3.5 h-3.5" /> },
  { id: 'geology', label: '地质岩性', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'slope', label: '地形坡度', icon: <Activity className="w-3.5 h-3.5" /> },
  { id: 'contour', label: '等高线图', icon: <MapIcon className="w-3.5 h-3.5" /> },
  { id: 'thermal', label: '三维温度', icon: <Thermometer className="w-3.5 h-3.5" /> },
  { id: 'crossSection', label: '星球剖面', icon: <Scissors className="w-3.5 h-3.5" /> },
];

const PROJECTIONS: ReadonlyArray<{ id: MapProjection; label: string }> = [
  { id: 'equirectangular', label: '等距圆柱' },
  { id: 'mollweide', label: '摩尔魏德' },
  { id: 'sinusoidal', label: '正弦等面积' },
  { id: 'robinson', label: '罗宾逊' },
  { id: 'lambertAzimuthal', label: '兰伯特等面积' },
  { id: 'mercator', label: '墨卡托' },
  { id: 'polar', label: '极地双半球' },
  { id: 'orthographic', label: '正射半球' },
];

const MATERIAL_NAMES: Record<MaterialId, string> = {
  [MaterialId.Air]: '大气/真空',
  [MaterialId.Soil]: '沃土层',
  [MaterialId.Stone]: '灰岩地壳',
  [MaterialId.Basalt]: '深层玄武岩',
  [MaterialId.Crystal]: '晶矿脉',
  [MaterialId.Ice]: '极地冰盖',
  [MaterialId.Sandstone]: '砂岩沉积',
};

const PLANAR_W = 500;
const PLANAR_H = 250;
const SECTION_SIZE = 320;

export const MapsModal: React.FC<MapsModalProps> = ({
  planet,
  fluid,
  telemetry,
  config,
  datum,
  benchmarks = [],
  transect = null,
  onTeleport,
  onClose,
}) => {
  const [mapMode, setMapMode] = useState<MapMode>('globe3d');
  const [projection, setProjection] = useState<MapProjection>('robinson');
  const [centerLonDeg, setCenterLonDeg] = useState<number>(() =>
    Math.round(telemetry.playerLonDeg),
  );
  const [centerLatDeg, setCenterLatDeg] = useState<number>(() =>
    Math.round(telemetry.playerLatDeg),
  );
  const [contourLevels, setContourLevels] = useState<number>(12);
  const [gridStepDeg, setGridStepDeg] = useState<15 | 30 | 45>(30);

  // Cross-section parameters
  const [sectionPlane, setSectionPlane] = useState<CrossSectionPlane>('xy');
  const [azimuthDeg, setAzimuthDeg] = useState<number>(0);
  const [offsetRatio, setOffsetRatio] = useState<number>(0);
  const [showThermalOverlay, setShowThermalOverlay] = useState<boolean>(false);

  const [sampleRevision, setSampleRevision] = useState<number>(0);
  const [hoverProbe, setHoverProbe] = useState<MapProbeResult | null>(null);
  const [sectionProfile, setSectionProfile] = useState<{
    elev: Float32Array;
    temp: Float32Array;
  } | null>(null);

  const effDatum: CoordDatum = useMemo(
    () =>
      datum ?? {
        planetRadius: planet.baseRadius,
        nativeVoxelSize: planet.nativeVoxelSize,
        enuOrigin: config.enuOrigin,
      },
    [config.enuOrigin, datum, planet.baseRadius, planet.nativeVoxelSize],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startLon: number;
    startLat: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startLon: 0,
    startLat: 0,
  });

  // Rebuild planetary spherical atlas on open or manual refresh
  const atlas: PlanetarySurfaceAtlas = useMemo(() => {
    void sampleRevision;
    return buildPlanetarySurfaceAtlas(planet, fluid, 144, 72);
  }, [planet, fluid, sampleRevision]);

  const drawOverlayMarkers = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      effProj: MapProjection,
    ) => {
      const centerLonRad = (centerLonDeg * Math.PI) / 180;
      const centerLatRad = (centerLatDeg * Math.PI) / 180;

      // Sub-solar point marker
      const sunLon = Math.atan2(telemetry.sunDir[2], telemetry.sunDir[0]);
      const sunLat = Math.asin(
        Math.max(-1, Math.min(1, telemetry.sunDir[1])),
      );
      const sunUv = projectLonLatToUV(
        sunLon,
        sunLat,
        effProj,
        centerLonRad,
        centerLatRad,
      );
      if (sunUv) {
        const sx = sunUv.u * width;
        const sy = sunUv.v * height;
        ctx.save();
        ctx.strokeStyle = '#fbbf24';
        ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = '10px monospace';
        ctx.fillStyle = '#fde68a';
        ctx.fillText('SUN', sx + 7, sy + 3);
        ctx.restore();
      }

      // Active Geodesic Transect polyline overlay
      if (transect && transect.samples.length >= 2) {
        ctx.save();
        ctx.strokeStyle = '#2dd4bf';
        ctx.lineWidth = 1.8;
        let prevPx: number | null = null;
        let prevPy: number | null = null;
        for (const s of transect.samples) {
          const uv = projectLonLatToUV(
            (s.lonDeg * Math.PI) / 180,
            (s.latDeg * Math.PI) / 180,
            effProj,
            centerLonRad,
            centerLatRad,
          );
          if (!uv) {
            prevPx = null;
            prevPy = null;
            continue;
          }
          const px = uv.u * width;
          const py = uv.v * height;
          if (
            prevPx !== null &&
            prevPy !== null &&
            Math.hypot(px - prevPx, py - prevPy) < width * 0.35
          ) {
            ctx.beginPath();
            ctx.moveTo(prevPx, prevPy);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
          prevPx = px;
          prevPy = py;
        }
        ctx.restore();
      }

      // Recorded Survey Benchmark Pins overlay
      for (const bm of benchmarks) {
        const sph = dirToLonLat(bm.worldPos[0], bm.worldPos[1], bm.worldPos[2]);
        const bUv = projectLonLatToUV(
          sph.lonRad,
          sph.latRad,
          effProj,
          centerLonRad,
          centerLatRad,
        );
        if (!bUv) continue;
        const bx = bUv.u * width;
        const by = bUv.v * height;
        ctx.save();
        ctx.fillStyle = '#38bdf8';
        ctx.strokeStyle = '#090d18';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx, by - 4.5);
        ctx.lineTo(bx + 4, by);
        ctx.lineTo(bx, by + 4.5);
        ctx.lineTo(bx - 4, by);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 9px monospace';
        ctx.fillStyle = '#e0f2fe';
        ctx.fillText(bm.code, bx + 5, by + 3);
        ctx.restore();
      }

      // Player current position reticle
      const pLon = (telemetry.playerLonDeg * Math.PI) / 180;
      const pLat = (telemetry.playerLatDeg * Math.PI) / 180;
      const pUv = projectLonLatToUV(
        pLon,
        pLat,
        effProj,
        centerLonRad,
        centerLatRad,
      );
      if (pUv) {
        const px = pUv.u * width;
        const py = pUv.v * height;
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.fillStyle = '#e0f2fe';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px - 7, py);
        ctx.lineTo(px + 7, py);
        ctx.moveTo(px, py - 7);
        ctx.lineTo(px, py + 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '10px monospace';
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText('POS', px + 7, py - 5);
        ctx.restore();
      }
    },
    [
      benchmarks,
      centerLatDeg,
      centerLonDeg,
      telemetry.playerLatDeg,
      telemetry.playerLonDeg,
      telemetry.sunDir,
      transect,
    ],
  );

  // Render map onto canvas whenever projection/mode/params change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (mapMode === 'crossSection') {
      if (canvas.width !== SECTION_SIZE || canvas.height !== SECTION_SIZE) {
        canvas.width = SECTION_SIZE;
        canvas.height = SECTION_SIZE;
      }
      const res = renderCrossSectionImageData(SECTION_SIZE, SECTION_SIZE, {
        plane: sectionPlane,
        azimuthDeg,
        offsetRatio,
        showThermalOverlay,
        planet,
        fluid,
        sunDir: telemetry.sunDir,
        atmosCfg: config.atmosphere,
        thermalCfg: config.thermal,
        simTimeSec: telemetry.simTimeSec,
      });
      const img = ctx.createImageData(SECTION_SIZE, SECTION_SIZE);
      img.data.set(res.pixels);
      ctx.putImageData(img, 0, 0);

      // Draw engineering axis crosshairs + R0 label
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(SECTION_SIZE / 2, 8);
      ctx.lineTo(SECTION_SIZE / 2, SECTION_SIZE - 8);
      ctx.moveTo(8, SECTION_SIZE / 2);
      ctx.lineTo(SECTION_SIZE - 8, SECTION_SIZE / 2);
      ctx.stroke();
      ctx.font = '10px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(
        `PLANE:${sectionPlane.toUpperCase()} AZ:${azimuthDeg.toFixed(0)}° OFF:${offsetRatio.toFixed(2)}R₀`,
        8,
        14,
      );
      ctx.restore();

      setSectionProfile({
        elev: res.radialElevProfile,
        temp: res.radialTempProfile,
      });
      return;
    }

    if (canvas.width !== PLANAR_W || canvas.height !== PLANAR_H) {
      canvas.width = PLANAR_W;
      canvas.height = PLANAR_H;
    }

    const pixels = renderPlanarMapImageData(PLANAR_W, PLANAR_H, {
      mode: mapMode,
      projection,
      atlas,
      sunDir: telemetry.sunDir,
      atmosCfg: config.atmosphere,
      thermalCfg: config.thermal,
      simTimeSec: telemetry.simTimeSec,
      centerLonDeg,
      centerLatDeg,
      contourLevels,
      gridStepDeg,
    });
    const img = ctx.createImageData(PLANAR_W, PLANAR_H);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);

    const effProj: MapProjection =
      mapMode === 'globe3d' ? 'orthographic' : projection;
    drawOverlayMarkers(ctx, PLANAR_W, PLANAR_H, effProj);
  }, [
    atlas,
    azimuthDeg,
    centerLatDeg,
    centerLonDeg,
    config.atmosphere,
    config.thermal,
    contourLevels,
    drawOverlayMarkers,
    fluid,
    gridStepDeg,
    mapMode,
    offsetRatio,
    planet,
    projection,
    sectionPlane,
    showThermalOverlay,
    telemetry.simTimeSec,
    telemetry.sunDir,
  ]);

  const computeProbeAtPointer = useCallback(
    (clientX: number, clientY: number): MapProbeResult | null => {
      if (mapMode === 'crossSection') return null;
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const u = (clientX - rect.left) / rect.width;
      const v = (clientY - rect.top) / rect.height;
      const effProj: MapProjection =
        mapMode === 'globe3d' ? 'orthographic' : projection;
      const coord = unprojectUVToLonLat(
        u,
        v,
        effProj,
        (centerLonDeg * Math.PI) / 180,
        (centerLatDeg * Math.PI) / 180,
      );
      if (!coord) return null;
      return probeAtlasAtLonLat(
        coord.lonRad,
        coord.latRad,
        atlas,
        telemetry.sunDir,
        config.atmosphere,
        config.thermal,
        telemetry.simTimeSec,
      );
    },
    [
      atlas,
      centerLatDeg,
      centerLonDeg,
      config.atmosphere,
      config.thermal,
      mapMode,
      projection,
      telemetry.simTimeSec,
      telemetry.sunDir,
    ],
  );

  // Build SVG path strings for the 360° radial elevation & temperature chart
  const profilePaths = useMemo(() => {
    if (!sectionProfile) return null;
    const { elev, temp } = sectionProfile;
    const n = elev.length;
    const w = 320;
    const h = 68;

    let minE = Infinity;
    let maxE = -Infinity;
    let minT = Infinity;
    let maxT = -Infinity;
    for (let i = 0; i < n; i++) {
      if (elev[i] < minE) minE = elev[i];
      if (elev[i] > maxE) maxE = elev[i];
      if (temp[i] < minT) minT = temp[i];
      if (temp[i] > maxT) maxT = temp[i];
    }
    const spanE = Math.max(maxE - minE, 0.1);
    const spanT = Math.max(maxT - minT, 1.0);

    const elevPts: string[] = [];
    const tempPts: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const ye = h - 6 - ((elev[i] - minE) / spanE) * (h - 14);
      const yt = h - 6 - ((temp[i] - minT) / spanT) * (h - 14);
      elevPts.push(`${x.toFixed(1)},${ye.toFixed(1)}`);
      tempPts.push(`${x.toFixed(1)},${yt.toFixed(1)}`);
    }

    return {
      elevPath: `M ${elevPts.join(' L ')}`,
      tempPath: `M ${tempPts.join(' L ')}`,
      minE,
      maxE,
      minT,
      maxT,
    };
  }, [sectionProfile]);

  const activeProbe = hoverProbe;

  return (
    <div
      data-testid="maps-modal"
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#04070e]/85 p-2.5"
    >
      <div className="w-full max-w-5xl max-h-[94vh] flex flex-col rounded-sm border border-slate-700/90 bg-[#090d18] text-slate-100 overflow-hidden">
        {/* CAD Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 bg-[#060912]">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-sky-400" />
            <h2 className="font-display text-sm font-semibold tracking-tight text-white">
              行星测绘、地质与剖面工作站
            </h2>
            <span className="text-[11px] font-mono-tabular text-slate-400">
              SEED #{telemetry.seed} · R₀={telemetry.planetRadius.toFixed(2)}m
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="maps-export-png-btn"
              onClick={() => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = `terrasphere_map_${mapMode}_${projection}_seed${telemetry.seed}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
              className="h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] hover:border-emerald-400 text-[11px] text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>导出地图 PNG</span>
            </button>
            <button
              type="button"
              data-testid="maps-refresh-btn"
              onClick={() => setSampleRevision((v) => v + 1)}
              className="h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] hover:border-sky-400 text-[11px] text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
              <span>重采样体素</span>
            </button>
            <button
              type="button"
              aria-label="关闭地图面板"
              data-testid="maps-close-btn"
              onClick={onClose}
              className="w-7 h-7 rounded-xs border border-slate-700 bg-[#0d1322] hover:border-slate-500 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Map Type Tabs + Projection Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5 bg-[#0b101d]">
          <div className="flex flex-wrap items-center gap-1">
            {MAP_MODE_TABS.map((tab) => {
              const active = mapMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`map-tab-${tab.id}`}
                  onClick={() => {
                    setMapMode(tab.id);
                    setHoverProbe(null);
                  }}
                  className={`h-7 px-2.5 rounded-xs border text-[11px] font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                    active
                      ? 'border-sky-400 bg-sky-950/75 text-white'
                      : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {mapMode !== 'globe3d' && mapMode !== 'crossSection' && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-slate-400 mr-1">地图投影</span>
              {PROJECTIONS.map((proj) => {
                const active = projection === proj.id;
                return (
                  <button
                    key={proj.id}
                    type="button"
                    data-testid={`map-proj-${proj.id}`}
                    onClick={() => setProjection(proj.id)}
                    className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap transition-colors ${
                      active
                        ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
                        : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                    }`}
                  >
                    {proj.label}
                  </button>
                );
              })}
              <span className="text-[10px] text-slate-500 ml-1">经纬网</span>
              {([15, 30, 45] as const).map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() => setGridStepDeg(deg)}
                  className={`h-6 px-1.5 rounded-xs border text-[10px] font-mono-tabular cursor-pointer ${
                    gridStepDeg === deg
                      ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
                      : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                  }`}
                >
                  {deg}°
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Workspace Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-3">
          {/* Left: Canvas Viewport & Legends */}
          <div className="flex flex-col gap-2 min-w-0">
            <div className="rounded-xs border border-slate-800 bg-[#050810] p-2 flex flex-col items-center justify-center relative">
              <canvas
                ref={canvasRef}
                data-testid="maps-canvas"
                onPointerDown={(e) => {
                  if (mapMode === 'crossSection') return;
                  dragStateRef.current = {
                    active: true,
                    moved: false,
                    startX: e.clientX,
                    startY: e.clientY,
                    startLon: centerLonDeg,
                    startLat: centerLatDeg,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (dragStateRef.current.active && mapMode !== 'crossSection') {
                    const dx = e.clientX - dragStateRef.current.startX;
                    const dy = e.clientY - dragStateRef.current.startY;
                    if (Math.hypot(dx, dy) > 4) {
                      dragStateRef.current.moved = true;
                    }
                    const nextLon =
                      ((dragStateRef.current.startLon - dx * 0.45 + 540) % 360) - 180;
                    const nextLat = Math.max(
                      -85,
                      Math.min(85, dragStateRef.current.startLat + dy * 0.35),
                    );
                    setCenterLonDeg(Math.round(nextLon));
                    setCenterLatDeg(Math.round(nextLat));
                    return;
                  }
                  setHoverProbe(computeProbeAtPointer(e.clientX, e.clientY));
                }}
                onPointerUp={(e) => {
                  const wasMoved = dragStateRef.current.moved;
                  dragStateRef.current.active = false;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  if (!wasMoved && mapMode !== 'crossSection') {
                    const probe = computeProbeAtPointer(e.clientX, e.clientY);
                    if (probe) {
                      onTeleport(probe.latDeg, probe.lonDeg);
                    }
                  }
                }}
                onPointerLeave={() => setHoverProbe(null)}
                className={`block border border-slate-800/80 rounded-xs ${
                  mapMode === 'crossSection'
                    ? 'w-[320px] h-[320px] max-w-full aspect-square'
                    : 'w-full max-w-[680px] aspect-[2/1] cursor-crosshair'
                }`}
              />

              <div className="w-full mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-tabular text-slate-400">
                {mapMode === 'crossSection' ? (
                  <span>
                    实时体素与流场三维切面 · 虚线圆为基准半径 R₀={planet.baseRadius.toFixed(2)}m
                  </span>
                ) : (
                  <span>
                    拖拽旋转视角 / 中心经度 ({centerLonDeg}°, {centerLatDeg}°) · 单击任意地表传送角色
                  </span>
                )}
                {mapMode !== 'crossSection' && (
                  <button
                    type="button"
                    onClick={() => {
                      setCenterLonDeg(Math.round(telemetry.playerLonDeg));
                      setCenterLatDeg(Math.round(telemetry.playerLatDeg));
                    }}
                    className="px-2 py-0.5 rounded-xs border border-slate-700 bg-[#0d1322] text-sky-300 hover:border-sky-400 cursor-pointer flex items-center gap-1"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>对准角色位置</span>
                  </button>
                )}
              </div>
            </div>

            {/* Cross-Section Radial Elevation & Thermal Strip */}
            {mapMode === 'crossSection' && profilePaths && (
              <div className="rounded-xs border border-slate-800 bg-[#060912] p-2">
                <div className="flex items-center justify-between text-[10px] font-mono-tabular text-slate-400 mb-1">
                  <span>环切面 360° 径向高程与表面温度剖线</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sky-300">
                      高程 {profilePaths.minE.toFixed(2)}..{profilePaths.maxE.toFixed(2)}m
                    </span>
                    <span className="text-amber-300">
                      温度 {profilePaths.minT.toFixed(1)}..{profilePaths.maxT.toFixed(1)}°C
                    </span>
                  </div>
                </div>
                <svg
                  viewBox="0 0 320 68"
                  className="w-full h-16 bg-[#04070e] border border-slate-800/80 rounded-xs"
                  preserveAspectRatio="none"
                >
                  <path
                    d={profilePaths.elevPath}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                  />
                  <path
                    d={profilePaths.tempPath}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="1.2"
                    strokeDasharray="3 2"
                  />
                </svg>
              </div>
            )}

            {/* Dynamic Scientific Legend */}
            <div className="rounded-xs border border-slate-800 bg-[#060912] px-2.5 py-2 text-[10px] font-mono-tabular">
              {mapMode === 'geology' || mapMode === 'crossSection' ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-slate-400">图例:</span>
                  {[
                    MaterialId.Soil,
                    MaterialId.Stone,
                    MaterialId.Basalt,
                    MaterialId.Sandstone,
                    MaterialId.Crystal,
                    MaterialId.Ice,
                  ].map((id) => {
                    const [r, g, b] = MATERIAL_PALETTE[id].rgb;
                    const swatch = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 text-slate-300">
                        <span
                          className="w-2.5 h-2.5 rounded-xs border border-white/15 inline-block"
                          style={{ backgroundColor: swatch }}
                        />
                        <span>{MATERIAL_NAMES[id]}</span>
                      </span>
                    );
                  })}
                  <span className="inline-flex items-center gap-1 text-cyan-300">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#149ee8] inline-block" />
                    <span>SPH 液态水</span>
                  </span>
                </div>
              ) : mapMode === 'thermal' ? (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-slate-400">
                    <span>-80°C 极寒</span>
                    <span>0°C 冰点</span>
                    <span>+18°C 温带</span>
                    <span>+42°C 干旱</span>
                    <span>+180°C 地热</span>
                    <span>+900°C 地核</span>
                  </div>
                  <div
                    className="h-2 w-full rounded-xs border border-slate-800"
                    style={{
                      background:
                        'linear-gradient(90deg, #293db8 0%, #248ff0 18%, #2ed6e0 34%, #38cc70 50%, #f7bd29 66%, #f03d24 84%, #ffeb9e 100%)',
                    }}
                  />
                </div>
              ) : mapMode === 'slope' ? (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-slate-400">
                    <span>0° 平原</span>
                    <span>15° 缓坡</span>
                    <span>30° 中陡坡</span>
                    <span>45° 陡崖</span>
                    <span>60°+ 绝壁</span>
                  </div>
                  <div
                    className="h-2 w-full rounded-xs border border-slate-800"
                    style={{
                      background:
                        'linear-gradient(90deg, #1a6e59 0%, #5cb85c 25%, #e6c229 50%, #e06324 75%, #b8293d 100%)',
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-slate-400">
                    <span>深海盆地 ({atlas.minElev.toFixed(2)}m)</span>
                    <span>海平面 (0.0m)</span>
                    <span>山地高原</span>
                    <span>极高山巅 (+{atlas.maxElev.toFixed(2)}m)</span>
                  </div>
                  <div
                    className="h-2 w-full rounded-xs border border-slate-800"
                    style={{
                      background:
                        'linear-gradient(90deg, #0a3d8f 0%, #1d8ee0 30%, #388f57 48%, #8aad52 68%, #c28f57 84%, #f0f5fc 100%)',
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right: Probe Telemetry & Controls Inspector */}
          <div className="flex flex-col gap-2.5">
            {mapMode === 'crossSection' ? (
              <div className="rounded-xs border border-slate-800 bg-[#060912] p-2.5 flex flex-col gap-2 text-[11px]">
                <div className="text-[11px] font-semibold text-sky-300 border-b border-slate-800 pb-1">
                  星球剖面切片参数
                </div>

                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 'xy', label: 'XY 经向' },
                      { id: 'xz', label: 'XZ 赤道' },
                      { id: 'yz', label: 'YZ 子午' },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      data-testid={`section-plane-${p.id}`}
                      onClick={() => setSectionPlane(p.id)}
                      className={`h-7 rounded-xs border text-[10px] cursor-pointer ${
                        sectionPlane === p.id
                          ? 'border-sky-400 bg-sky-950/70 text-white'
                          : 'border-slate-800 bg-[#0d1322] text-slate-300'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">切面方位角</span>
                  <NumericCadInput
                    value={azimuthDeg}
                    unit="°"
                    sliderMin={0}
                    sliderMax={360}
                    sliderStep={1}
                    className="w-24"
                    onChangeValue={setAzimuthDeg}
                  />
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">法向偏置 (R₀)</span>
                  <NumericCadInput
                    value={offsetRatio}
                    unit="R₀"
                    sliderMin={-1}
                    sliderMax={1}
                    sliderStep={0.05}
                    className="w-24"
                    onChangeValue={(v) => setOffsetRatio(Math.max(-1.2, Math.min(1.2, v)))}
                  />
                </label>

                <label className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800 cursor-pointer">
                  <span className="text-slate-300">叠加三维温度等温线</span>
                  <input
                    type="checkbox"
                    checked={showThermalOverlay}
                    onChange={(e) => setShowThermalOverlay(e.target.checked)}
                    className="accent-amber-400"
                  />
                </label>
              </div>
            ) : (
              <div className="rounded-xs border border-slate-800 bg-[#060912] p-2.5 flex flex-col gap-1.5 text-[11px] font-mono-tabular">
                <div className="text-[11px] font-sans font-semibold text-sky-300 border-b border-slate-800 pb-1 flex items-center justify-between">
                  <span>{activeProbe ? '光标地理探针' : '角色实时坐标数据'}</span>
                  <span className="text-[10px] text-slate-400">
                    {activeProbe ? '单击地表传送' : '移动鼠标探查'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[11px]">
                  <span className="text-slate-400">纬度 / 经度</span>
                  <span className="text-right text-white">
                    {activeProbe
                      ? `${activeProbe.latDeg.toFixed(1)}°, ${activeProbe.lonDeg.toFixed(1)}°`
                      : `${telemetry.playerLatDeg.toFixed(1)}°, ${telemetry.playerLonDeg.toFixed(1)}°`}
                  </span>

                  <span className="text-slate-400">局部地表海拔</span>
                  <span className="text-right text-sky-300">
                    {activeProbe
                      ? `${activeProbe.elevation >= 0 ? '+' : ''}${activeProbe.elevation.toFixed(2)}m`
                      : `${telemetry.altitude >= 0 ? '+' : ''}${telemetry.altitude.toFixed(2)}m`}
                  </span>

                  <span className="text-slate-400">局部温度</span>
                  <span className="text-right text-amber-300">
                    {activeProbe
                      ? `${activeProbe.tempC.toFixed(1)}°C (${activeProbe.tempK.toFixed(0)}K)`
                      : `${telemetry.localTempC.toFixed(1)}°C (${telemetry.localTempK.toFixed(0)}K)`}
                  </span>

                  <span className="text-slate-400">局部气压</span>
                  <span className="text-right text-cyan-300">
                    {activeProbe
                      ? `${activeProbe.pressureAtm.toFixed(3)} atm`
                      : `${telemetry.localPressureAtm.toFixed(3)} atm`}
                  </span>

                  <span className="text-slate-400">环流风速</span>
                  <span className="text-right text-emerald-300">
                    {activeProbe
                      ? `${activeProbe.windSpeedMs.toFixed(1)} m/s`
                      : `${telemetry.windSpeedMs.toFixed(1)} m/s`}
                  </span>

                  {activeProbe ? (
                    <>
                      <span className="text-slate-400">表层岩性</span>
                      <span className="text-right text-slate-100">
                        {MATERIAL_NAMES[activeProbe.material]}
                        {activeProbe.hasWater ? ' · 含水' : ''}
                      </span>

                      <span className="text-slate-400">行星 UTM 网格</span>
                      <span className="text-right text-cyan-200">
                        {worldToCoord(activeProbe.worldPos, 'utm_tm', effDatum).compact}
                      </span>

                      <span className="text-slate-400">星心 ECEF XYZ</span>
                      <span className="text-right text-slate-300 text-[10px]">
                        {worldToCoord(activeProbe.worldPos, 'ecef_xyz', effDatum).compact}
                      </span>

                      <span className="text-slate-400">太阳辐照度</span>
                      <span className="text-right text-yellow-300">
                        {activeProbe.insolationWm2.toFixed(0)} W/m²
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-400">活动坐标系</span>
                      <span className="text-right text-cyan-200 text-[10px]">
                        {telemetry.playerCoord.compact}
                      </span>

                      <span className="text-slate-400">所在气候带</span>
                      <span className="text-right text-slate-100">
                        {telemetry.thermalRegime}
                      </span>

                      <span className="text-slate-400">大气分层</span>
                      <span className="text-right text-slate-100">
                        {telemetry.atmoLayer}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {mapMode === 'contour' && (
              <div className="rounded-xs border border-slate-800 bg-[#060912] p-2.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-400">等高线级数</span>
                <NumericCadInput
                  value={contourLevels}
                  minValid={2}
                  integer
                  sliderMin={2}
                  sliderMax={32}
                  sliderStep={1}
                  className="w-24"
                  onChangeValue={setContourLevels}
                />
              </div>
            )}

            {/* Quick Rotation / Centering Inspector */}
            {mapMode !== 'crossSection' && (
              <div className="rounded-xs border border-slate-800 bg-[#060912] p-2.5 flex flex-col gap-1.5 text-[11px]">
                <div className="text-[10px] text-slate-400">视心经纬度坐标</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-500">中心经度</span>
                    <NumericCadInput
                      value={centerLonDeg}
                      unit="°"
                      integer
                      sliderMin={-180}
                      sliderMax={180}
                      sliderStep={1}
                      onChangeValue={setCenterLonDeg}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-500">中心纬度</span>
                    <NumericCadInput
                      value={centerLatDeg}
                      unit="°"
                      integer
                      sliderMin={-89}
                      sliderMax={89}
                      sliderStep={1}
                      onChangeValue={(v) =>
                        setCenterLatDeg(Math.max(-89, Math.min(89, v)))
                      }
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
