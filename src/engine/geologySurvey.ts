import { AtmosphereConfig } from './atmosphere';
import {
  computeEnuBasis,
  computeSphericalSurveyMetrics,
  CoordDatum,
  SphericalSurveyMetrics,
  worldToAllCoords,
  worldToLonLatRadius,
  wrapAzimuthDeg,
} from './coordinates';
import { FluidSim } from './fluidSim';
import { computeGravityMagnitude, PlanetaryGravityParams } from './gravity';
import { sampleThermalField, ThermalConfig } from './thermal';
import { MATERIAL_PALETTE, MaterialId, VoxelPlanet } from './voxelPlanet';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export const MATERIAL_CN_NAMES: Record<MaterialId, string> = {
  [MaterialId.Air]: '空洞/大气 (Void)',
  [MaterialId.Soil]: '沃土/腐殖表土 (Soil)',
  [MaterialId.Stone]: '灰岩/硅酸盐壳 (Limestone)',
  [MaterialId.Basalt]: '深层玄武岩 (Basalt)',
  [MaterialId.Crystal]: '高能晶矿脉 (Crystal)',
  [MaterialId.Ice]: '极地冰盖 (Ice)',
  [MaterialId.Sandstone]: '风化砂岩层 (Sandstone)',
  [MaterialId.Magma]: '熔融硅酸盐岩浆 (Magma)',
};

export const MATERIAL_SHORT_NAMES: Record<MaterialId, string> = {
  [MaterialId.Air]: '空洞',
  [MaterialId.Soil]: '沃土',
  [MaterialId.Stone]: '灰岩',
  [MaterialId.Basalt]: '玄武岩',
  [MaterialId.Crystal]: '晶矿',
  [MaterialId.Ice]: '极冰',
  [MaterialId.Sandstone]: '砂岩',
  [MaterialId.Magma]: '熔岩',
};

export type SurveyToolKind =
  | 'surveyPin'
  | 'surveyTransect'
  | 'surveyBorehole'
  | 'surveyClinometer';

export interface GeologicalAttitude {
  worldPos: [number, number, number];
  normal: [number, number, number];
  elevationM: number;
  slopeDeg: number;
  slopePct: number;
  dipDirectionDeg: number;
  strikeDeg: number;
  strikeLabel: string;
  overturned: boolean;
  material: MaterialId;
  gravityMs2: number;
  tempC: number;
}

export interface SurveyBenchmark {
  id: string;
  code: string;
  name: string;
  createdAt: number;
  worldPos: [number, number, number];
  normal: [number, number, number];
  elevationM: number;
  material: MaterialId;
  slopeDeg: number;
  dipDirectionDeg: number;
  strikeDeg: number;
  gravityMs2: number;
  tempC: number;
  hasWater: boolean;
  note?: string;
}

export interface TransectSamplePoint {
  index: number;
  fraction: number;
  arcDistanceM: number;
  worldPos: [number, number, number];
  latDeg: number;
  lonDeg: number;
  surfaceRadiusM: number;
  elevationM: number;
  slopeDeg: number;
  material: MaterialId;
  subMat1: MaterialId;
  subMat2: MaterialId;
  hasWater: boolean;
  tempC: number;
}

export interface GeologicalTransectReport {
  id: string;
  pointA: [number, number, number];
  pointB: [number, number, number];
  spherical: SphericalSurveyMetrics;
  surfacePathLengthM: number;
  minElevM: number;
  maxElevM: number;
  meanElevM: number;
  totalAscentM: number;
  totalDescentM: number;
  maxSlopeDeg: number;
  meanSlopeDeg: number;
  reliefM: number;
  cutAreaM2: number;
  fillAreaM2: number;
  samples: TransectSamplePoint[];
}

export interface BoreholeStratum {
  index: number;
  topDepthM: number;
  bottomDepthM: number;
  thicknessM: number;
  material: MaterialId;
  isVoid: boolean;
  avgTempC: number;
  pctOfCore: number;
}

export interface BoreholeCoreSample {
  depthM: number;
  radiusM: number;
  material: MaterialId;
  density: number;
  tempC: number;
  isVoid: boolean;
}

export interface BoreholeLogReport {
  id: string;
  collarPos: [number, number, number];
  collarLatDeg: number;
  collarLonDeg: number;
  collarElevM: number;
  drilledDepthM: number;
  stepSizeM: number;
  coreRecoveryPct: number;
  voidCount: number;
  surfaceTempC: number;
  bottomTempC: number;
  thermalGradientCPerM: number;
  strata: BoreholeStratum[];
  rawSamples: BoreholeCoreSample[];
}

export interface PolygonSurveyReport {
  vertexCount: number;
  sphericalAreaM2: number;
  perimeter3DM: number;
  meanElevM: number;
  minElevM: number;
  maxElevM: number;
  estimatedVolumeAboveDatumM3: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function formatBearingQuadrant(azDeg: number): string {
  const a = wrapAzimuthDeg(azDeg);
  if (a < 90) return `N${a.toFixed(0).padStart(2, '0')}°E`;
  if (a < 180) return `S${(180 - a).toFixed(0).padStart(2, '0')}°E`;
  if (a < 270) return `S${(a - 180).toFixed(0).padStart(2, '0')}°W`;
  return `N${(360 - a).toFixed(0).padStart(2, '0')}°W`;
}

/**
 * Measure terrain attitude (Slope°, Dip Direction, Right-Hand Rule Strike) at a 3D world point.
 */
export function measureGeologicalAttitude(
  planet: VoxelPlanet,
  fluid: FluidSim,
  gravParams: PlanetaryGravityParams,
  atmoCfg: AtmosphereConfig,
  thermalCfg: ThermalConfig,
  sunDir: [number, number, number],
  simTimeSec: number,
  wx: number,
  wy: number,
  wz: number,
): GeologicalAttitude {
  const normalOut: [number, number, number] = [0, 1, 0];
  planet.sampleDensityAndNormal(wx, wy, wz, normalOut);
  const [nx, ny, nz] = normalOut;
  const r = Math.hypot(wx, wy, wz) || planet.baseRadius;
  const { east, north, up } = computeEnuBasis([wx, wy, wz]);

  const nDotUp = nx * up[0] + ny * up[1] + nz * up[2];
  const overturned = nDotUp < -0.05;
  const slopeRad = Math.acos(clamp(Math.abs(nDotUp), 0, 1));
  const slopeDeg = slopeRad * RAD2DEG;
  const slopePct = slopeDeg >= 89.5 ? 9999 : Math.tan(slopeRad) * 100;

  // Component of outward surface normal in local tangent plane points DOWN-SLOPE (Dip direction)
  const compE = nx * east[0] + ny * east[1] + nz * east[2];
  const compN = nx * north[0] + ny * north[1] + nz * north[2];
  const horizMag = Math.hypot(compE, compN);
  const dipDirectionDeg =
    horizMag > 1e-5 ? wrapAzimuthDeg(Math.atan2(compE, compN) * RAD2DEG) : 0;
  // Right-Hand Rule (RHR): facing along Strike, the bed dips down to the right -> Strike = DipDir - 90°
  const strikeDeg = wrapAzimuthDeg(dipDirectionDeg - 90);
  const strikeLabel = `${String(Math.round(strikeDeg)).padStart(3, '0')}° / ${Math.round(slopeDeg)}° (${formatBearingQuadrant(strikeDeg)})`;

  const stepIn = Math.max(planet.nativeVoxelSize * 0.5, planet.voxelSize * 0.18);
  const mat = planet.sampleNearestMaterial(
    wx - nx * stepIn,
    wy - ny * stepIn,
    wz - nz * stepIn,
  );
  const nearWater = clamp((fluid.sampleWaterAt(wx, wy, wz) + 0.15) * 2.5, 0, 1);
  const thermal = sampleThermalField(
    wx,
    wy,
    wz,
    planet.baseRadius,
    sunDir,
    atmoCfg,
    thermalCfg,
    simTimeSec,
    mat,
    nearWater,
    0,
  );

  return {
    worldPos: [wx, wy, wz],
    normal: [nx, ny, nz],
    elevationM: r - planet.baseRadius,
    slopeDeg,
    slopePct,
    dipDirectionDeg,
    strikeDeg,
    strikeLabel,
    overturned,
    material: mat,
    gravityMs2: computeGravityMagnitude(r, gravParams),
    tempC: thermal.tempC,
  };
}

/**
 * Sample spherical great-circle topographic & stratigraphic transect between Point A and Point B.
 */
export function sampleGeologicalTransect(
  planet: VoxelPlanet,
  fluid: FluidSim,
  pointA: [number, number, number],
  pointB: [number, number, number],
  atmoCfg: AtmosphereConfig,
  thermalCfg: ThermalConfig,
  sunDir: [number, number, number],
  simTimeSec: number,
  numSamples = 80,
): GeologicalTransectReport {
  const n = Math.max(8, Math.min(256, Math.round(numSamples)));
  const ra = Math.hypot(pointA[0], pointA[1], pointA[2]) || planet.baseRadius;
  const rb = Math.hypot(pointB[0], pointB[1], pointB[2]) || planet.baseRadius;
  const ua: [number, number, number] = [pointA[0] / ra, pointA[1] / ra, pointA[2] / ra];
  const ub: [number, number, number] = [pointB[0] / rb, pointB[1] / rb, pointB[2] / rb];

  const dot = clamp(ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2], -1, 1);
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  // Fallback orthogonal vector for antipodal points
  let ortho: [number, number, number] = [
    ua[1] * 0 - ua[2] * 1,
    ua[2] * 0 - ua[0] * 0,
    ua[0] * 1 - ua[1] * 0,
  ];
  if (Math.hypot(ortho[0], ortho[1], ortho[2]) < 1e-4) {
    ortho = [0, -ua[2], ua[1]];
  }
  const oLen = Math.hypot(ortho[0], ortho[1], ortho[2]) || 1;
  ortho = [ortho[0] / oLen, ortho[1] / oLen, ortho[2] / oLen];

  const spherical = computeSphericalSurveyMetrics(pointA, pointB, planet.baseRadius);
  const samples: TransectSamplePoint[] = [];
  const subStep1 = Math.max(planet.voxelSize * 0.45, planet.baseRadius * 0.04);
  const subStep2 = Math.max(planet.voxelSize * 1.1, planet.baseRadius * 0.11);
  const matStep = Math.max(planet.nativeVoxelSize * 0.65, planet.voxelSize * 0.18);

  let minElevM = Infinity;
  let maxElevM = -Infinity;
  let sumElevM = 0;

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    let dx: number;
    let dy: number;
    let dz: number;

    if (omega < 1e-5) {
      dx = ua[0];
      dy = ua[1];
      dz = ua[2];
    } else if (sinOmega < 1e-4) {
      const ang = t * Math.PI;
      dx = Math.cos(ang) * ua[0] + Math.sin(ang) * ortho[0];
      dy = Math.cos(ang) * ua[1] + Math.sin(ang) * ortho[1];
      dz = Math.cos(ang) * ua[2] + Math.sin(ang) * ortho[2];
    } else {
      const wa = Math.sin((1 - t) * omega) / sinOmega;
      const wb = Math.sin(t * omega) / sinOmega;
      dx = wa * ua[0] + wb * ub[0];
      dy = wa * ua[1] + wb * ub[1];
      dz = wa * ua[2] + wb * ub[2];
    }
    const dLen = Math.hypot(dx, dy, dz) || 1;
    dx /= dLen;
    dy /= dLen;
    dz /= dLen;

    const surfR = planet.findSurfaceRadiusAlongRay(dx, dy, dz);
    const elev = surfR - planet.baseRadius;
    const wx = dx * surfR;
    const wy = dy * surfR;
    const wz = dz * surfR;

    const ll = worldToLonLatRadius(wx, wy, wz);
    const matR = Math.max(planet.baseRadius * 0.1, surfR - matStep);
    const material = planet.sampleNearestMaterial(dx * matR, dy * matR, dz * matR);
    const subMat1 = planet.sampleNearestMaterial(
      dx * Math.max(0.1, surfR - subStep1),
      dy * Math.max(0.1, surfR - subStep1),
      dz * Math.max(0.1, surfR - subStep1),
    );
    const subMat2 = planet.sampleNearestMaterial(
      dx * Math.max(0.1, surfR - subStep2),
      dy * Math.max(0.1, surfR - subStep2),
      dz * Math.max(0.1, surfR - subStep2),
    );

    const hasWater = fluid.sampleWaterAt(wx, wy, wz) > 0.02;
    const thermal = sampleThermalField(
      wx,
      wy,
      wz,
      planet.baseRadius,
      sunDir,
      atmoCfg,
      thermalCfg,
      simTimeSec,
      material,
      hasWater ? 1 : 0,
      0,
    );

    if (elev < minElevM) minElevM = elev;
    if (elev > maxElevM) maxElevM = elev;
    sumElevM += elev;

    samples.push({
      index: i,
      fraction: t,
      arcDistanceM: t * spherical.geodesicArcM,
      worldPos: [wx, wy, wz],
      latDeg: ll.latDeg,
      lonDeg: ll.lonDeg,
      surfaceRadiusM: surfR,
      elevationM: elev,
      slopeDeg: 0,
      material,
      subMat1,
      subMat2,
      hasWater,
      tempC: thermal.tempC,
    });
  }

  let surfacePathLengthM = 0;
  let totalAscentM = 0;
  let totalDescentM = 0;
  let maxSlopeDeg = 0;
  let sumSlopeDeg = 0;
  const meanElevM = sumElevM / samples.length;
  let cutAreaM2 = 0;
  let fillAreaM2 = 0;

  for (let i = 0; i < samples.length; i++) {
    if (i > 0) {
      const prev = samples[i - 1];
      const cur = samples[i];
      const dArc = Math.max(1e-6, cur.arcDistanceM - prev.arcDistanceM);
      const dElev = cur.elevationM - prev.elevationM;
      surfacePathLengthM += Math.hypot(
        cur.worldPos[0] - prev.worldPos[0],
        cur.worldPos[1] - prev.worldPos[1],
        cur.worldPos[2] - prev.worldPos[2],
      );
      if (dElev > 0) totalAscentM += dElev;
      else totalDescentM += -dElev;

      const sDeg = Math.atan(Math.abs(dElev) / dArc) * RAD2DEG;
      cur.slopeDeg = sDeg;
      if (i === 1) prev.slopeDeg = sDeg;
      if (sDeg > maxSlopeDeg) maxSlopeDeg = sDeg;
      sumSlopeDeg += sDeg;

      const midElevOffset = 0.5 * (prev.elevationM + cur.elevationM) - meanElevM;
      if (midElevOffset >= 0) cutAreaM2 += midElevOffset * dArc;
      else fillAreaM2 += -midElevOffset * dArc;
    }
  }

  return {
    id: `TR-${Date.now().toString(36).slice(-4).toUpperCase()}`,
    pointA,
    pointB,
    spherical,
    surfacePathLengthM,
    minElevM,
    maxElevM,
    meanElevM,
    totalAscentM,
    totalDescentM,
    maxSlopeDeg,
    meanSlopeDeg: samples.length > 1 ? sumSlopeDeg / (samples.length - 1) : 0,
    reliefM: maxElevM - minElevM,
    cutAreaM2,
    fillAreaM2,
    samples,
  };
}

/**
 * Sample a vertical (radial inward) geological borehole & stratigraphic rock column.
 */
export function sampleBoreholeColumn(
  planet: VoxelPlanet,
  wx: number,
  wy: number,
  wz: number,
  atmoCfg: AtmosphereConfig,
  thermalCfg: ThermalConfig,
  sunDir: [number, number, number],
  simTimeSec: number,
  maxDepthM?: number,
): BoreholeLogReport {
  const len = Math.hypot(wx, wy, wz) || planet.baseRadius;
  const dx = wx / len;
  const dy = wy / len;
  const dz = wz / len;
  const surfR = planet.findSurfaceRadiusAlongRay(dx, dy, dz);
  const collarPos: [number, number, number] = [dx * surfR, dy * surfR, dz * surfR];
  const ll = worldToLonLatRadius(collarPos[0], collarPos[1], collarPos[2]);

  const targetDepth = clamp(
    maxDepthM ?? planet.baseRadius * 0.55,
    planet.voxelSize * 2,
    surfR * 0.88,
  );
  const sampleCount = 60;
  const stepSizeM = targetDepth / sampleCount;
  const startInset = Math.max(planet.nativeVoxelSize * 0.35, stepSizeM * 0.25);

  const rawSamples: BoreholeCoreSample[] = [];
  let solidCount = 0;

  for (let i = 0; i < sampleCount; i++) {
    const depthM = startInset + i * stepSizeM;
    const r = Math.max(0.05, surfR - depthM);
    const sx = dx * r;
    const sy = dy * r;
    const sz = dz * r;
    const density = planet.sampleDensity(sx, sy, sz);
    const isVoid = density < 0;
    const mat = isVoid ? MaterialId.Air : planet.sampleNearestMaterial(sx, sy, sz);
    if (!isVoid && mat !== MaterialId.Air) solidCount++;

    const thermal = sampleThermalField(
      sx,
      sy,
      sz,
      planet.baseRadius,
      sunDir,
      atmoCfg,
      thermalCfg,
      simTimeSec,
      mat,
      0,
      0,
    );

    rawSamples.push({
      depthM,
      radiusM: r,
      material: mat,
      density,
      tempC: thermal.tempC,
      isVoid,
    });
  }

  // Merge consecutive samples with identical lithology into stratigraphic beds
  const strata: BoreholeStratum[] = [];
  let voidCount = 0;
  for (let i = 0; i < rawSamples.length; i++) {
    const cur = rawSamples[i];
    const last = strata[strata.length - 1];
    const topD = i * stepSizeM;
    const botD = (i + 1) * stepSizeM;
    if (last && last.material === cur.material && last.isVoid === cur.isVoid) {
      const prevSamples = Math.round(last.thicknessM / stepSizeM);
      last.bottomDepthM = botD;
      last.thicknessM = botD - last.topDepthM;
      last.avgTempC = (last.avgTempC * prevSamples + cur.tempC) / (prevSamples + 1);
      last.pctOfCore = (last.thicknessM / targetDepth) * 100;
    } else {
      if (cur.isVoid) voidCount++;
      strata.push({
        index: strata.length + 1,
        topDepthM: topD,
        bottomDepthM: botD,
        thicknessM: stepSizeM,
        material: cur.material,
        isVoid: cur.isVoid,
        avgTempC: cur.tempC,
        pctOfCore: (stepSizeM / targetDepth) * 100,
      });
    }
  }

  const surfaceTempC = rawSamples[0]?.tempC ?? 15;
  const bottomTempC = rawSamples[rawSamples.length - 1]?.tempC ?? surfaceTempC;
  const thermalGradientCPerM = targetDepth > 1e-4 ? (bottomTempC - surfaceTempC) / targetDepth : 0;

  return {
    id: `BH-${Date.now().toString(36).slice(-4).toUpperCase()}`,
    collarPos,
    collarLatDeg: ll.latDeg,
    collarLonDeg: ll.lonDeg,
    collarElevM: surfR - planet.baseRadius,
    drilledDepthM: targetDepth,
    stepSizeM,
    coreRecoveryPct: (solidCount / sampleCount) * 100,
    voidCount,
    surfaceTempC,
    bottomTempC,
    thermalGradientCPerM,
    strata,
    rawSamples,
  };
}

/**
 * Compute Girard spherical excess area on baseRadius R₀ and estimated cut/fill volume from N>=3 vertices.
 */
export function measureSurveyPolygonArea(
  planetRadius: number,
  verticesWorld: ReadonlyArray<[number, number, number]>,
): PolygonSurveyReport | null {
  if (verticesWorld.length < 3) return null;
  const R = Math.max(0.1, planetRadius);
  const dirs: Array<[number, number, number]> = [];
  let minElevM = Infinity;
  let maxElevM = -Infinity;
  let sumElevM = 0;
  let perimeter3DM = 0;

  for (let i = 0; i < verticesWorld.length; i++) {
    const p = verticesWorld[i];
    const r = Math.hypot(p[0], p[1], p[2]) || R;
    dirs.push([p[0] / r, p[1] / r, p[2] / r]);
    const elev = r - R;
    if (elev < minElevM) minElevM = elev;
    if (elev > maxElevM) maxElevM = elev;
    sumElevM += elev;

    const q = verticesWorld[(i + 1) % verticesWorld.length];
    perimeter3DM += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  }

  // Triangulate spherical polygon fan from vertex 0 using Van Oosterom / Eriksson solid angle formula
  let totalSolidAngle = 0;
  const a = dirs[0];
  for (let i = 1; i < dirs.length - 1; i++) {
    const b = dirs[i];
    const c = dirs[i + 1];
    // Signed scalar triple product a . (b x c)
    const det =
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    const ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const bc = b[0] * c[0] + b[1] * c[1] + b[2] * c[2];
    const ca = c[0] * a[0] + c[1] * a[1] + c[2] * a[2];
    const denom = 1 + ab + bc + ca;
    const solid = 2 * Math.atan2(det, Math.max(1e-9, denom));
    totalSolidAngle += solid;
  }

  const sphericalAreaM2 = Math.abs(totalSolidAngle) * R * R;
  const meanElevM = sumElevM / verticesWorld.length;
  return {
    vertexCount: verticesWorld.length,
    sphericalAreaM2,
    perimeter3DM,
    meanElevM,
    minElevM,
    maxElevM,
    estimatedVolumeAboveDatumM3: sphericalAreaM2 * meanElevM,
  };
}

export function getMaterialSwatchHex(mat: MaterialId): string {
  const rgb = (MATERIAL_PALETTE[mat] ?? MATERIAL_PALETTE[MaterialId.Stone]).rgb;
  const r = clamp(Math.round(rgb[0] * 255), 0, 255).toString(16).padStart(2, '0');
  const g = clamp(Math.round(rgb[1] * 255), 0, 255).toString(16).padStart(2, '0');
  const b = clamp(Math.round(rgb[2] * 255), 0, 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function csvEscape(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportBenchmarksToCsv(
  benchmarks: ReadonlyArray<SurveyBenchmark>,
  datum: CoordDatum,
): string {
  const header = [
    'Code',
    'Name',
    'Lat_Deg',
    'Lon_Deg',
    'Elev_m',
    'ECEF_X_m',
    'ECEF_Y_m',
    'ECEF_Z_m',
    'ENU_E_m',
    'ENU_N_m',
    'ENU_U_m',
    'UTM_Zone',
    'UTM_Easting_m',
    'UTM_Northing_m',
    'Voxel_I',
    'Voxel_J',
    'Voxel_K',
    'Lithology',
    'Slope_Deg',
    'DipDir_Deg',
    'Strike_Deg',
    'Temp_C',
    'Gravity_ms2',
  ].join(',');

  const rows = benchmarks.map((b) => {
    const all = worldToAllCoords(b.worldPos, datum);
    return [
      b.code,
      b.name,
      all.geo_dd.components[0].numericValue.toFixed(6),
      all.geo_dd.components[1].numericValue.toFixed(6),
      b.elevationM.toFixed(4),
      b.worldPos[0].toFixed(4),
      b.worldPos[1].toFixed(4),
      b.worldPos[2].toFixed(4),
      all.local_enu.components[0].numericValue.toFixed(4),
      all.local_enu.components[1].numericValue.toFixed(4),
      all.local_enu.components[2].numericValue.toFixed(4),
      all.utm_tm.utmZone ?? '',
      all.utm_tm.components[1].numericValue.toFixed(3),
      all.utm_tm.components[2].numericValue.toFixed(3),
      all.voxel_ijk.components[0].numericValue,
      all.voxel_ijk.components[1].numericValue,
      all.voxel_ijk.components[2].numericValue,
      MATERIAL_SHORT_NAMES[b.material] ?? 'Stone',
      b.slopeDeg.toFixed(2),
      b.dipDirectionDeg.toFixed(2),
      b.strikeDeg.toFixed(2),
      b.tempC.toFixed(2),
      b.gravityMs2.toFixed(3),
    ]
      .map(csvEscape)
      .join(',');
  });

  return `\uFEFF${header}\n${rows.join('\n')}`;
}

export function exportTransectToCsv(
  transect: GeologicalTransectReport,
): string {
  const header = [
    'Index',
    'ArcDistance_m',
    'Lat_Deg',
    'Lon_Deg',
    'SurfaceRadius_m',
    'Elevation_m',
    'Slope_Deg',
    'SurfaceLithology',
    'Substrata_1',
    'Substrata_2',
    'WaterPresent',
    'Temp_C',
  ].join(',');

  const rows = transect.samples.map((s) =>
    [
      s.index,
      s.arcDistanceM.toFixed(4),
      s.latDeg.toFixed(5),
      s.lonDeg.toFixed(5),
      s.surfaceRadiusM.toFixed(4),
      s.elevationM.toFixed(4),
      s.slopeDeg.toFixed(2),
      MATERIAL_SHORT_NAMES[s.material],
      MATERIAL_SHORT_NAMES[s.subMat1],
      MATERIAL_SHORT_NAMES[s.subMat2],
      s.hasWater ? 1 : 0,
      s.tempC.toFixed(2),
    ]
      .map(csvEscape)
      .join(','),
  );
  return `\uFEFF${header}\n${rows.join('\n')}`;
}

export function exportBoreholeToCsv(borehole: BoreholeLogReport): string {
  const header = [
    'Stratum_No',
    'TopDepth_m',
    'BottomDepth_m',
    'Thickness_m',
    'CorePct',
    'Lithology',
    'IsVoid',
    'AvgTemp_C',
  ].join(',');

  const rows = borehole.strata.map((st) =>
    [
      st.index,
      st.topDepthM.toFixed(3),
      st.bottomDepthM.toFixed(3),
      st.thicknessM.toFixed(3),
      st.pctOfCore.toFixed(1),
      MATERIAL_SHORT_NAMES[st.material],
      st.isVoid ? 1 : 0,
      st.avgTempC.toFixed(2),
    ]
      .map(csvEscape)
      .join(','),
  );
  return `\uFEFF${header}\n${rows.join('\n')}`;
}

export function exportSurveyGeoJson(
  benchmarks: ReadonlyArray<SurveyBenchmark>,
  transect: GeologicalTransectReport | null,
  datum: CoordDatum,
): string {
  const features: Array<Record<string, unknown>> = benchmarks.map((b) => {
    const ll = worldToLonLatRadius(b.worldPos[0], b.worldPos[1], b.worldPos[2]);
    const all = worldToAllCoords(b.worldPos, datum);
    return {
      type: 'Feature',
      id: b.id,
      geometry: {
        type: 'Point',
        coordinates: [
          Number(ll.lonDeg.toFixed(6)),
          Number(ll.latDeg.toFixed(6)),
          Number(b.elevationM.toFixed(4)),
        ],
      },
      properties: {
        code: b.code,
        name: b.name,
        lithology: MATERIAL_SHORT_NAMES[b.material],
        slopeDeg: Number(b.slopeDeg.toFixed(2)),
        dipDirectionDeg: Number(b.dipDirectionDeg.toFixed(2)),
        strikeDeg: Number(b.strikeDeg.toFixed(2)),
        tempC: Number(b.tempC.toFixed(2)),
        gravityMs2: Number(b.gravityMs2.toFixed(3)),
        utmZone: all.utm_tm.utmZone,
        ecef: b.worldPos.map((v) => Number(v.toFixed(4))),
      },
    };
  });

  if (transect && transect.samples.length >= 2) {
    features.push({
      type: 'Feature',
      id: transect.id,
      geometry: {
        type: 'LineString',
        coordinates: transect.samples.map((s) => [
          Number(s.lonDeg.toFixed(6)),
          Number(s.latDeg.toFixed(6)),
          Number(s.elevationM.toFixed(4)),
        ]),
      },
      properties: {
        featureType: 'GeologicalTransect',
        geodesicArcM: Number(transect.spherical.geodesicArcM.toFixed(4)),
        chordDistanceM: Number(transect.spherical.chordDistanceM.toFixed(4)),
        surfacePathLengthM: Number(transect.surfacePathLengthM.toFixed(4)),
        reliefM: Number(transect.reliefM.toFixed(4)),
        maxSlopeDeg: Number(transect.maxSlopeDeg.toFixed(2)),
      },
    });
  }

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      crs: {
        type: 'name',
        properties: {
          name: `TerraSphere:Planetocentric:R0=${datum.planetRadius.toFixed(3)}m`,
        },
      },
      features,
    },
    null,
    2,
  );
}
