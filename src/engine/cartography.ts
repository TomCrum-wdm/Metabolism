import { AtmosphereConfig, sampleAtmosphereAtPoint } from './atmosphere';
import { FluidSim } from './fluidSim';
import { sampleThermalField, temperatureToRgb, ThermalConfig } from './thermal';
import { MATERIAL_PALETTE, MaterialId, VoxelPlanet } from './voxelPlanet';

export type MapMode =
  | 'globe3d'
  | 'topographic'
  | 'geology'
  | 'slope'
  | 'contour'
  | 'thermal'
  | 'crossSection';

export type MapProjection =
  | 'equirectangular'
  | 'mollweide'
  | 'sinusoidal'
  | 'robinson'
  | 'lambertAzimuthal'
  | 'mercator'
  | 'polar'
  | 'orthographic';

export type CrossSectionPlane = 'xy' | 'xz' | 'yz';

export interface PlanetarySurfaceAtlas {
  lonSamples: number;
  latSamples: number;
  baseRadius: number;
  minElev: number;
  maxElev: number;
  surfaceRadius: Float32Array;
  elevation: Float32Array;
  material: Uint8Array;
  waterWeight: Float32Array;
  slopeDot: Float32Array;
}

export interface MapProbeResult {
  valid: boolean;
  latDeg: number;
  lonDeg: number;
  worldPos: [number, number, number];
  surfaceRadius: number;
  elevation: number;
  material: MaterialId;
  hasWater: boolean;
  tempC: number;
  tempK: number;
  pressureAtm: number;
  windSpeedMs: number;
  insolationWm2: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lonLatToDir(
  lonRad: number,
  latRad: number,
): [number, number, number] {
  const cosLat = Math.cos(latRad);
  return [
    cosLat * Math.cos(lonRad),
    Math.sin(latRad),
    cosLat * Math.sin(lonRad),
  ];
}

export function dirToLonLat(
  dx: number,
  dy: number,
  dz: number,
): { lonRad: number; latRad: number } {
  const len = Math.hypot(dx, dy, dz) || 1;
  const ny = clamp(dy / len, -1, 1);
  return {
    lonRad: Math.atan2(dz, dx),
    latRad: Math.asin(ny),
  };
}

/**
 * Inverse map projection: maps normalized canvas coordinates (u, v in [0, 1])
 * to spherical (lonRad, latRad), returning null when outside the projection silhouette.
 */
export function unprojectUVToLonLat(
  u: number,
  v: number,
  projection: MapProjection,
  centerLonRad = 0,
  centerLatRad = 0,
): { lonRad: number; latRad: number; hemi?: 'N' | 'S' } | null {
  if (projection === 'equirectangular') {
    const lonRad = (u - 0.5) * Math.PI * 2 + centerLonRad;
    const latRad = (0.5 - v) * Math.PI;
    return { lonRad: wrapLon(lonRad), latRad };
  }

  if (projection === 'mercator') {
    const maxLat = (82 * Math.PI) / 180;
    const maxY = Math.log(Math.tan(Math.PI / 4 + maxLat / 2));
    const y = (0.5 - v) * 2 * maxY;
    const latRad = 2 * Math.atan(Math.exp(y)) - Math.PI / 2;
    const lonRad = wrapLon((u - 0.5) * Math.PI * 2 + centerLonRad);
    return { lonRad, latRad };
  }

  if (projection === 'mollweide') {
    const nx = (u - 0.5) * 2;
    const ny = (0.5 - v) * 2;
    if (nx * nx + ny * ny > 1.0) return null;
    const theta = Math.asin(clamp(ny, -1, 1));
    const cosTheta = Math.cos(theta);
    if (cosTheta < 1e-4) {
      return { lonRad: centerLonRad, latRad: ny >= 0 ? Math.PI / 2 : -Math.PI / 2 };
    }
    const lonRad = wrapLon((nx * Math.PI) / cosTheta + centerLonRad);
    const latArg = clamp((2 * theta + Math.sin(2 * theta)) / Math.PI, -1, 1);
    return { lonRad, latRad: Math.asin(latArg) };
  }

  if (projection === 'polar') {
    // Dual circular discs side by side inside 2:1 map aspect:
    // Left disc = Northern Hemisphere, Right disc = Southern Hemisphere
    const isNorth = u < 0.5;
    const dx = isNorth ? (u - 0.25) / 0.22 : (u - 0.75) / 0.22;
    const dy = (0.5 - v) / 0.44;
    const rho = Math.hypot(dx, dy);
    if (rho > 1.0) return null;
    if (isNorth) {
      const latRad = (Math.PI / 2) * (1 - rho);
      const lonRad = wrapLon(Math.atan2(dx, -dy) + centerLonRad);
      return { lonRad, latRad, hemi: 'N' };
    } else {
      const latRad = -(Math.PI / 2) * (1 - rho);
      const lonRad = wrapLon(Math.atan2(dx, dy) + centerLonRad);
      return { lonRad, latRad, hemi: 'S' };
    }
  }

  if (projection === 'sinusoidal') {
    const latRad = (0.5 - v) * Math.PI;
    const cosLat = Math.cos(latRad);
    if (cosLat < 1e-4) return null;
    const nx = (u - 0.5) * 2;
    if (Math.abs(nx) > cosLat) return null;
    const lonRad = wrapLon((nx * Math.PI) / cosLat + centerLonRad);
    return { lonRad, latRad };
  }

  if (projection === 'robinson') {
    const ny = (0.5 - v) * 2; // [-1, 1]
    if (Math.abs(ny) > 1) return null;
    const latRad = robinsonInverseY(ny);
    const plen = robinsonXScale(latRad);
    const nx = (u - 0.5) * 2;
    if (Math.abs(nx) > plen) return null;
    const lonRad = wrapLon((nx * Math.PI) / Math.max(1e-4, plen) + centerLonRad);
    return { lonRad, latRad };
  }

  if (projection === 'lambertAzimuthal') {
    // Aspect 2:1 -> dual hemisphere or full sphere inside circle of radius 2 centered at u=0.5, v=0.5
    // Map full sphere into central disk (circle radius 0.25 in u -> 0.5 in v, representing rho in [0, 2])
    const dx = (u - 0.5) * 4.0; // [-2, 2], circle disk rho <= 1 => rhoAngle up to sqrt(2)*2? Wait:
    const dy = (0.5 - v) * 2.0; // [-1, 1]
    const rho = Math.hypot(dx, dy);
    if (rho > 1.0) return null;
    if (rho < 1e-6) {
      return { lonRad: centerLonRad, latRad: centerLatRad };
    }
    // Scale disk rho=1 to cover full globe (c = pi -> sin(c/2) = 1 -> scaled rho*2 / 2 => c = 2*asin(rho))
    const c = 2 * Math.asin(clamp(rho, 0, 1));
    const cosC = Math.cos(c);
    const sinC = Math.sin(c);
    const cosP = Math.cos(centerLatRad);
    const sinP = Math.sin(centerLatRad);

    const latRad = Math.asin(clamp(cosC * sinP + (dy * sinC * cosP) / rho, -1, 1));
    const lonRad = wrapLon(
      centerLonRad +
        Math.atan2(dx * sinC, rho * cosP * cosC - dy * sinP * sinC),
    );
    return { lonRad, latRad };
  }

  // Orthographic globe hemisphere centered at (centerLonRad, centerLatRad)
  const dx = (u - 0.5) * 4.0; // assuming 2:1 canvas aspect, circle radius = 0.25 in u -> 0.5 in v
  const dy = (0.5 - v) * 2.0;
  const r2 = dx * dx + dy * dy;
  if (r2 > 1.0) return null;
  const z = Math.sqrt(Math.max(0, 1 - r2));

  // Rotate local camera space (dx, dy, z) by centerLat & centerLon
  const cosP = Math.cos(centerLatRad);
  const sinP = Math.sin(centerLatRad);
  // Tilt around X (latitude)
  const ry = dy * cosP + z * sinP;
  const rz = -dy * sinP + z * cosP;
  const rx = dx;
  // Spin around Y (longitude)
  const cosL = Math.cos(centerLonRad);
  const sinL = Math.sin(centerLonRad);
  const wx = rz * cosL - rx * sinL;
  const wy = ry;
  const wz = rz * sinL + rx * cosL;

  return dirToLonLat(wx, wy, wz);
}

// Standard Robinson projection 5-degree lookup table (PLEN = x scale, PDFE = y scale)
const ROBINSON_PLEN = [
  1.0000, 0.9986, 0.9954, 0.9900, 0.9822, 0.9730, 0.9600, 0.9427, 0.9216,
  0.8962, 0.8679, 0.8350, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
];
const ROBINSON_PDFE = [
  0.0000, 0.0620, 0.1240, 0.1860, 0.2480, 0.3100, 0.3720, 0.4340, 0.4958,
  0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0000,
];

function robinsonXScale(latRad: number): number {
  const absDeg = clamp((Math.abs(latRad) * 180) / Math.PI, 0, 90);
  const f = absDeg / 5;
  const i = Math.min(17, Math.floor(f));
  const t = f - i;
  return ROBINSON_PLEN[i] + (ROBINSON_PLEN[i + 1] - ROBINSON_PLEN[i]) * t;
}

function robinsonYNorm(latRad: number): number {
  const sign = latRad < 0 ? -1 : 1;
  const absDeg = clamp((Math.abs(latRad) * 180) / Math.PI, 0, 90);
  const f = absDeg / 5;
  const i = Math.min(17, Math.floor(f));
  const t = f - i;
  return sign * (ROBINSON_PDFE[i] + (ROBINSON_PDFE[i + 1] - ROBINSON_PDFE[i]) * t);
}

function robinsonInverseY(ny: number): number {
  const sign = ny < 0 ? -1 : 1;
  const absY = clamp(Math.abs(ny), 0, 1);
  for (let i = 0; i < 18; i++) {
    if (absY <= ROBINSON_PDFE[i + 1] || i === 17) {
      const span = Math.max(1e-6, ROBINSON_PDFE[i + 1] - ROBINSON_PDFE[i]);
      const t = clamp((absY - ROBINSON_PDFE[i]) / span, 0, 1);
      const deg = (i + t) * 5;
      return sign * ((deg * Math.PI) / 180);
    }
  }
  return sign * (Math.PI / 2);
}

/**
 * Forward projection from (lonRad, latRad) to normalized canvas (u, v in [0, 1])
 * for graticule lines, player markers, and terminator curves.
 */
export function projectLonLatToUV(
  lonRad: number,
  latRad: number,
  projection: MapProjection,
  centerLonRad = 0,
  centerLatRad = 0,
): { u: number; v: number } | null {
  const relLon = wrapLon(lonRad - centerLonRad);

  if (projection === 'equirectangular') {
    return {
      u: relLon / (Math.PI * 2) + 0.5,
      v: 0.5 - latRad / Math.PI,
    };
  }

  if (projection === 'mercator') {
    const maxLat = (82 * Math.PI) / 180;
    if (Math.abs(latRad) > maxLat) return null;
    const maxY = Math.log(Math.tan(Math.PI / 4 + maxLat / 2));
    const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return {
      u: relLon / (Math.PI * 2) + 0.5,
      v: 0.5 - y / (2 * maxY),
    };
  }

  if (projection === 'mollweide') {
    const target = Math.PI * Math.sin(latRad);
    let theta = latRad;
    for (let i = 0; i < 6; i++) {
      const denom = 2 + 2 * Math.cos(2 * theta);
      if (Math.abs(denom) < 1e-5) break;
      theta -= (2 * theta + Math.sin(2 * theta) - target) / denom;
    }
    const nx = (relLon / Math.PI) * Math.cos(theta);
    const ny = Math.sin(theta);
    return {
      u: 0.5 + nx * 0.5,
      v: 0.5 - ny * 0.5,
    };
  }

  if (projection === 'sinusoidal') {
    const nx = (relLon / Math.PI) * Math.cos(latRad);
    return {
      u: 0.5 + nx * 0.5,
      v: 0.5 - latRad / Math.PI,
    };
  }

  if (projection === 'robinson') {
    const plen = robinsonXScale(latRad);
    const ny = robinsonYNorm(latRad);
    const nx = (relLon / Math.PI) * plen;
    return {
      u: 0.5 + nx * 0.5,
      v: 0.5 - ny * 0.5,
    };
  }

  if (projection === 'lambertAzimuthal') {
    const cosP = Math.cos(centerLatRad);
    const sinP = Math.sin(centerLatRad);
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    const cosDLon = Math.cos(relLon);
    const denom = 1 + sinP * sinLat + cosP * cosLat * cosDLon;
    if (denom <= 1e-6) return null;
    const kPrime = Math.sqrt(2 / denom);
    // Normalize radius 2 -> disk radius 1 (to match 2:1 aspect disk)
    const dx = (kPrime * cosLat * Math.sin(relLon)) * 0.5;
    const dy = (kPrime * (cosP * sinLat - sinP * cosLat * cosDLon)) * 0.5;
    return {
      u: 0.5 + dx * 0.25,
      v: 0.5 - dy * 0.5,
    };
  }

  if (projection === 'polar') {
    const isNorth = latRad >= 0;
    const rho = isNorth
      ? 1 - latRad / (Math.PI / 2)
      : 1 + latRad / (Math.PI / 2);
    const dx = rho * Math.sin(relLon);
    const dy = isNorth ? -rho * Math.cos(relLon) : rho * Math.cos(relLon);
    return {
      u: (isNorth ? 0.25 : 0.75) + dx * 0.22,
      v: 0.5 - dy * 0.44,
    };
  }

  // Orthographic
  const [wx, wy, wz] = lonLatToDir(lonRad, latRad);
  const cosL = Math.cos(centerLonRad);
  const sinL = Math.sin(centerLonRad);
  const rx = -wx * sinL + wz * cosL;
  const ry = wy;
  const rz = wx * cosL + wz * sinL;

  const cosP = Math.cos(centerLatRad);
  const sinP = Math.sin(centerLatRad);
  const camY = ry * cosP - rz * sinP;
  const camZ = ry * sinP + rz * cosP;
  if (camZ < 0) return null; // Back side of sphere

  return {
    u: 0.5 + rx * 0.25,
    v: 0.5 - camY * 0.5,
  };
}

function wrapLon(lon: number): number {
  let l = lon;
  while (l > Math.PI) l -= Math.PI * 2;
  while (l < -Math.PI) l += Math.PI * 2;
  return l;
}

/**
 * Samples the entire planetary sphere into a bilinear-queryable surface atlas.
 */
export function buildPlanetarySurfaceAtlas(
  planet: VoxelPlanet,
  fluid: FluidSim,
  lonSamples = 144,
  latSamples = 72,
): PlanetarySurfaceAtlas {
  const count = lonSamples * latSamples;
  const surfaceRadius = new Float32Array(count);
  const elevation = new Float32Array(count);
  const material = new Uint8Array(count);
  const waterWeight = new Float32Array(count);
  const slopeDot = new Float32Array(count);

  const normalTmp: [number, number, number] = [0, 1, 0];
  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let iy = 0; iy < latSamples; iy++) {
    const lat = ((iy + 0.5) / latSamples - 0.5) * -Math.PI; // Top = +90°N, Bottom = -90°S
    for (let ix = 0; ix < lonSamples; ix++) {
      const lon = ((ix + 0.5) / lonSamples - 0.5) * Math.PI * 2;
      const [dx, dy, dz] = lonLatToDir(lon, lat);
      const idx = iy * lonSamples + ix;

      const sr = planet.findSurfaceRadiusAlongRay(dx, dy, dz);
      const elev = sr - planet.baseRadius;
      surfaceRadius[idx] = sr;
      elevation[idx] = elev;
      if (elev < minElev) minElev = elev;
      if (elev > maxElev) maxElev = elev;

      // Sample solid rock slightly inward from isosurface so Air never masks lithology
      const sampleR = Math.max(planet.baseRadius * 0.1, sr - planet.voxelSize * 0.45);
      let mat = planet.sampleNearestMaterial(
        dx * sampleR,
        dy * sampleR,
        dz * sampleR,
      );
      if (mat === MaterialId.Air) {
        mat = planet.sampleNearestMaterial(
          dx * Math.max(0.05, sr - planet.voxelSize * 1.1),
          dy * Math.max(0.05, sr - planet.voxelSize * 1.1),
          dz * Math.max(0.05, sr - planet.voxelSize * 1.1),
        );
      }
      material[idx] = mat;

      planet.sampleDensityAndNormal(dx * sr, dy * sr, dz * sr, normalTmp);
      slopeDot[idx] = clamp(
        normalTmp[0] * dx + normalTmp[1] * dy + normalTmp[2] * dz,
        0,
        1,
      );

      // Probe fluid field right above surface
      const wr = sr + planet.voxelSize * 0.65;
      const wf = fluid.sampleWaterAt(dx * wr, dy * wr, dz * wr);
      const wfSurface = fluid.sampleWaterAt(dx * sr, dy * sr, dz * sr);
      const maxWf = Math.max(wf, wfSurface);
      waterWeight[idx] = clamp((maxWf + 0.12) * 2.5, 0, 1);
    }
  }

  return {
    lonSamples,
    latSamples,
    baseRadius: planet.baseRadius,
    minElev: Number.isFinite(minElev) ? minElev : -2,
    maxElev: Number.isFinite(maxElev) ? maxElev : 2,
    surfaceRadius,
    elevation,
    material,
    waterWeight,
    slopeDot,
  };
}

function sampleAtlasBilinear(
  atlas: PlanetarySurfaceAtlas,
  lonRad: number,
  latRad: number,
): {
  elev: number;
  surfaceRadius: number;
  water: number;
  slope: number;
  material: MaterialId;
} {
  const u = wrapLon(lonRad) / (Math.PI * 2) + 0.5;
  const v = 0.5 - latRad / Math.PI;
  const fxFull = u * atlas.lonSamples - 0.5;
  const fyFull = clamp(v * atlas.latSamples - 0.5, 0, atlas.latSamples - 1.001);

  const ix0 = ((Math.floor(fxFull) % atlas.lonSamples) + atlas.lonSamples) % atlas.lonSamples;
  const ix1 = (ix0 + 1) % atlas.lonSamples;
  const iy0 = clamp(Math.floor(fyFull), 0, atlas.latSamples - 1);
  const iy1 = clamp(iy0 + 1, 0, atlas.latSamples - 1);

  const tx = fxFull - Math.floor(fxFull);
  const ty = fyFull - Math.floor(fyFull);

  const i00 = iy0 * atlas.lonSamples + ix0;
  const i10 = iy0 * atlas.lonSamples + ix1;
  const i01 = iy1 * atlas.lonSamples + ix0;
  const i11 = iy1 * atlas.lonSamples + ix1;

  const lerp4 = (arr: Float32Array) => {
    const top = arr[i00] + (arr[i10] - arr[i00]) * tx;
    const bot = arr[i01] + (arr[i11] - arr[i01]) * tx;
    return top + (bot - top) * ty;
  };

  const nearX = tx < 0.5 ? ix0 : ix1;
  const nearY = ty < 0.5 ? iy0 : iy1;
  const mat = atlas.material[nearY * atlas.lonSamples + nearX] as MaterialId;

  return {
    elev: lerp4(atlas.elevation),
    surfaceRadius: lerp4(atlas.surfaceRadius),
    water: lerp4(atlas.waterWeight),
    slope: lerp4(atlas.slopeDot),
    material: mat,
  };
}

function hypsometricColor(
  normElev: number,
  hasWater: boolean,
): [number, number, number] {
  if (hasWater && normElev < 0.48) {
    // Bathymetric ocean blue
    const d = clamp(normElev / 0.48, 0, 1);
    return [
      0.04 + d * 0.08,
      0.24 + d * 0.40,
      0.56 + d * 0.32,
    ];
  }
  const stops: ReadonlyArray<[number, [number, number, number]]> = [
    [0.0, [0.14, 0.34, 0.46]],
    [0.35, [0.22, 0.56, 0.34]],
    [0.58, [0.54, 0.68, 0.32]],
    [0.78, [0.76, 0.56, 0.34]],
    [0.92, [0.68, 0.64, 0.64]],
    [1.0, [0.94, 0.96, 0.99]],
  ];
  const t = clamp(normElev, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return [0.5, 0.5, 0.5];
}

export interface PlanarMapRenderParams {
  mode: Exclude<MapMode, 'crossSection'>;
  projection: MapProjection;
  atlas: PlanetarySurfaceAtlas;
  sunDir: readonly [number, number, number];
  atmosCfg: AtmosphereConfig;
  thermalCfg: ThermalConfig;
  simTimeSec: number;
  centerLonDeg: number;
  centerLatDeg: number;
  contourLevels?: number;
  gridStepDeg?: 15 | 30 | 45;
}

/**
 * Renders any projected 2D map layer (Topographic, Geology, Slope, Contour, Thermal, or Orthographic Globe)
 * into a crisp RGBA buffer ready for Canvas2D ImageData.
 */
export function renderPlanarMapImageData(
  width: number,
  height: number,
  params: PlanarMapRenderParams,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const {
    mode,
    projection,
    atlas,
    sunDir,
    atmosCfg,
    thermalCfg,
    simTimeSec,
    centerLonDeg,
    centerLatDeg,
  } = params;
  const centerLonRad = (centerLonDeg * Math.PI) / 180;
  const centerLatRad = (centerLatDeg * Math.PI) / 180;
  const effProj: MapProjection = mode === 'globe3d' ? 'orthographic' : projection;
  const elevSpan = Math.max(atlas.maxElev - atlas.minElev, 0.1);
  const contourSteps = params.contourLevels ?? 12;
  const gridStepDeg = params.gridStepDeg ?? 30;

  // Store elevations/temps for isoline boundary detection on contour/thermal maps
  const scalarField = new Float32Array(width * height);
  scalarField.fill(NaN);

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const pIdx = (y * width + x) * 4;
      const coord = unprojectUVToLonLat(u, v, effProj, centerLonRad, centerLatRad);
      if (!coord) {
        // Space background outside map projection silhouette
        out[pIdx] = 7;
        out[pIdx + 1] = 11;
        out[pIdx + 2] = 20;
        out[pIdx + 3] = 255;
        continue;
      }

      const sample = sampleAtlasBilinear(atlas, coord.lonRad, coord.latRad);
      const [dx, dy, dz] = lonLatToDir(coord.lonRad, coord.latRad);
      const wx = dx * sample.surfaceRadius;
      const wy = dy * sample.surfaceRadius;
      const wz = dz * sample.surfaceRadius;

      const normElev = clamp((sample.elev - atlas.minElev) / elevSpan, 0, 1);
      const hasWater = sample.water > 0.35;

      // Directional hillshade using sunDir
      const sunDot = dx * sunDir[0] + dy * sunDir[1] + dz * sunDir[2];
      const shade = 0.58 + 0.42 * clamp(sunDot * 0.5 + 0.5, 0, 1);

      let r = 0.2;
      let g = 0.2;
      let b = 0.2;

      if (mode === 'geology') {
        const pal =
          MATERIAL_PALETTE[sample.material] ?? MATERIAL_PALETTE[MaterialId.Stone];
        r = pal.rgb[0];
        g = pal.rgb[1];
        b = pal.rgb[2];
        if (hasWater) {
          r = r * 0.38 + 0.08 * 0.62;
          g = g * 0.38 + 0.52 * 0.62;
          b = b * 0.38 + 0.85 * 0.62;
        }
        // Highlight steep cliff strata & crater rims
        const rimBoost = sample.slope < 0.78 ? 0.78 : 1.04;
        r *= shade * rimBoost;
        g *= shade * rimBoost;
        b *= shade * rimBoost;
      } else if (mode === 'slope') {
        // Geological Slope Angle Heat-Map (0° Flat -> 15° Gentle -> 35° Steep -> 60°+ Cliff)
        const slopeDeg = (Math.acos(clamp(sample.slope, 0, 1)) * 180) / Math.PI;
        const sNorm = clamp(slopeDeg / 60, 0, 1);
        if (hasWater && slopeDeg < 8) {
          r = 0.08;
          g = 0.34;
          b = 0.62;
        } else if (sNorm < 0.35) {
          const t = sNorm / 0.35;
          r = 0.12 + t * 0.35;
          g = 0.56 + t * 0.24;
          b = 0.34 - t * 0.18;
        } else if (sNorm < 0.7) {
          const t = (sNorm - 0.35) / 0.35;
          r = 0.47 + t * 0.48;
          g = 0.80 - t * 0.34;
          b = 0.16 - t * 0.04;
        } else {
          const t = (sNorm - 0.7) / 0.3;
          r = 0.95 - t * 0.05;
          g = 0.46 - t * 0.34;
          b = 0.12 + t * 0.16;
        }
        r *= 0.72 + 0.28 * shade;
        g *= 0.72 + 0.28 * shade;
        b *= 0.72 + 0.28 * shade;
      } else if (mode === 'thermal') {
        const th = sampleThermalField(
          wx,
          wy,
          wz,
          atlas.baseRadius,
          sunDir,
          atmosCfg,
          thermalCfg,
          simTimeSec,
          sample.material,
          sample.water,
        );
        scalarField[y * width + x] = th.tempC;
        const [tr, tg, tb] = temperatureToRgb(th.tempC);
        r = tr;
        g = tg;
        b = tb;
      } else {
        // 'topographic' | 'contour' | 'globe3d'
        scalarField[y * width + x] = normElev * contourSteps;
        const [hr, hg, hb] = hypsometricColor(normElev, hasWater);
        r = hr * shade;
        g = hg * shade;
        b = hb * shade;

        if (mode === 'globe3d' && atmosCfg.enabled) {
          const atmo = sampleAtmosphereAtPoint(
            wx,
            wy,
            wz,
            atlas.baseRadius,
            atmosCfg,
            simTimeSec,
            sample.water,
          );
          const cloudAlpha = clamp(atmo.cloudDensity * 0.72, 0, 0.75);
          r = r * (1 - cloudAlpha) + 0.95 * cloudAlpha;
          g = g * (1 - cloudAlpha) + 0.97 * cloudAlpha;
          b = b * (1 - cloudAlpha) + 1.0 * cloudAlpha;

          // Subtle limb Rayleigh halo for globe3d
          const limbDist = Math.hypot((u - 0.5) * 4.0, (0.5 - v) * 2.0);
          if (limbDist > 0.84) {
            const fres = clamp((limbDist - 0.84) / 0.16, 0, 1);
            r = r * (1 - fres * 0.45) + 0.22 * fres * 0.45;
            g = g * (1 - fres * 0.45) + 0.74 * fres * 0.45;
            b = b * (1 - fres * 0.45) + 0.98 * fres * 0.45;
          }
        }
      }

      // Draw crisp latitude/longitude graticule every gridStepDeg
      const lonDeg = (coord.lonRad * 180) / Math.PI;
      const latDeg = (coord.latRad * 180) / Math.PI;
      const halfStep = gridStepDeg * 0.5;
      const onLonGrid = Math.abs(((lonDeg + 180) % gridStepDeg) - halfStep) > halfStep - 0.65;
      const onLatGrid = Math.abs(((latDeg + 90) % gridStepDeg) - halfStep) > halfStep - 0.65;
      if (onLonGrid || onLatGrid) {
        r = r * 0.8 + 0.24 * 0.2;
        g = g * 0.8 + 0.36 * 0.2;
        b = b * 0.8 + 0.52 * 0.2;
      }

      out[pIdx] = clamp(Math.round(r * 255), 0, 255);
      out[pIdx + 1] = clamp(Math.round(g * 255), 0, 255);
      out[pIdx + 2] = clamp(Math.round(b * 255), 0, 255);
      out[pIdx + 3] = 255;
    }
  }

  // Isoline contour / isotherm pass (detect integer level crossings cleanly)
  if (mode === 'contour' || mode === 'thermal') {
    const step = mode === 'thermal' ? 10 : 1; // 10°C isotherms or 1 contour band
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const val = scalarField[idx];
        const right = scalarField[idx + 1];
        const down = scalarField[idx + width];
        if (!Number.isFinite(val) || !Number.isFinite(right) || !Number.isFinite(down)) {
          continue;
        }
        const b0 = Math.floor(val / step);
        const br = Math.floor(right / step);
        const bd = Math.floor(down / step);
        if (b0 !== br || b0 !== bd) {
          const isMajor = b0 % 4 === 0 || br % 4 === 0 || bd % 4 === 0;
          const pIdx = idx * 4;
          if (mode === 'contour') {
            out[pIdx] = isMajor ? 250 : 210;
            out[pIdx + 1] = isMajor ? 245 : 225;
            out[pIdx + 2] = isMajor ? 185 : 215;
          } else {
            out[pIdx] = 240;
            out[pIdx + 1] = 248;
            out[pIdx + 2] = 255;
          }
        }
      }
    }
  }

  return out;
}

export interface CrossSectionRenderParams {
  plane: CrossSectionPlane;
  azimuthDeg: number;
  offsetRatio: number; // -0.8 .. +0.8 of R0
  showThermalOverlay: boolean;
  planet: VoxelPlanet;
  fluid: FluidSim;
  sunDir: readonly [number, number, number];
  atmosCfg: AtmosphereConfig;
  thermalCfg: ThermalConfig;
  simTimeSec: number;
}

/**
 * Renders a true volumetric 3D cross-section slice straight through the planet interior,
 * revealing core strata, caves, sculpted tunnels, SPH water pockets, atmospheric envelope,
 * and optional 3D temperature isotherms.
 */
export function renderCrossSectionImageData(
  width: number,
  height: number,
  params: CrossSectionRenderParams,
): {
  pixels: Uint8ClampedArray;
  radialElevProfile: Float32Array;
  radialTempProfile: Float32Array;
} {
  const {
    plane,
    azimuthDeg,
    offsetRatio,
    showThermalOverlay,
    planet,
    fluid,
    sunDir,
    atmosCfg,
    thermalCfg,
    simTimeSec,
  } = params;

  const pixels = new Uint8ClampedArray(width * height * 4);
  const viewHalf = planet.worldHalf * 1.15;
  const az = (azimuthDeg * Math.PI) / 180;
  const cosA = Math.cos(az);
  const sinA = Math.sin(az);
  const sliceOffset = offsetRatio * planet.baseRadius;

  // Orthonormal plane basis (U, V, N) in world space
  let ux = 1, uy = 0, uz = 0;
  let vx = 0, vy = 1, vz = 0;
  let nx = 0, ny = 0, nz = 1;

  if (plane === 'xy') {
    // Rotatable meridian vertical plane around Y
    ux = cosA; uy = 0; uz = sinA;
    vx = 0; vy = 1; vz = 0;
    nx = -sinA; ny = 0; nz = cosA;
  } else if (plane === 'xz') {
    // Equatorial / horizontal plane rotated around Y
    ux = cosA; uy = 0; uz = sinA;
    vx = -sinA; vy = 0; vz = cosA;
    nx = 0; ny = 1; nz = 0;
  } else {
    // YZ meridional cross-section
    ux = 0; uy = 0; uz = 1;
    vx = 0; vy = 1; vz = 0;
    nx = 1; ny = 0; nz = 0;
  }

  const tempScalar = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const py = (0.5 - (y + 0.5) / height) * 2 * viewHalf;
    for (let x = 0; x < width; x++) {
      const px = ((x + 0.5) / width - 0.5) * 2 * viewHalf;
      const wx = ux * px + vx * py + nx * sliceOffset;
      const wy = uy * px + vy * py + ny * sliceOffset;
      const wz = uz * px + vz * py + nz * sliceOffset;

      const d = planet.sampleDensity(wx, wy, wz);
      const wf = fluid.sampleWaterAt(wx, wy, wz);
      const mat = planet.sampleNearestMaterial(wx, wy, wz);
      const r = Math.hypot(wx, wy, wz);
      const pIdx = (y * width + x) * 4;

      const atmo = sampleAtmosphereAtPoint(
        wx,
        wy,
        wz,
        planet.baseRadius,
        atmosCfg,
        simTimeSec,
        wf > 0 ? 1 : 0,
      );
      const th = sampleThermalField(
        wx,
        wy,
        wz,
        planet.baseRadius,
        sunDir,
        atmosCfg,
        thermalCfg,
        simTimeSec,
        mat,
        wf > 0 ? 1 : 0,
      );
      tempScalar[y * width + x] = th.tempC;

      let cr = 0.03;
      let cg = 0.05;
      let cb = 0.09;

      if (d > 0) {
        // Solid planet crust / core interior
        const pal =
          MATERIAL_PALETTE[mat] ?? MATERIAL_PALETTE[MaterialId.Stone];
        const depthNorm = clamp(r / planet.baseRadius, 0, 1.2);
        // Subtle radial core glow below 0.35 R0
        const coreGlow = clamp((0.38 - depthNorm) / 0.38, 0, 1);
        cr = pal.rgb[0] * (0.65 + 0.35 * depthNorm) + coreGlow * 0.55;
        cg = pal.rgb[1] * (0.65 + 0.35 * depthNorm) + coreGlow * 0.18;
        cb = pal.rgb[2] * (0.65 + 0.35 * depthNorm) + coreGlow * 0.04;

        // Edge highlight right along the sculpted surface isosurface (d ≈ 0)
        if (d < planet.voxelSize * 0.45) {
          cr = Math.min(1, cr * 1.28);
          cg = Math.min(1, cg * 1.28);
          cb = Math.min(1, cb * 1.28);
        }
      } else if (wf > 0) {
        // Liquid water body inside basin / cave
        cr = 0.08;
        cg = 0.62;
        cb = 0.92;
      } else {
        // Atmospheric envelope glow outside crust
        if (atmosCfg.enabled && atmo.pressureAtm > 0.01) {
          const pGlow = clamp(atmo.pressureAtm / Math.max(atmosCfg.surfacePressureAtm, 0.2), 0, 1);
          const sunLight = clamp(
            ((wx * sunDir[0] + wy * sunDir[1] + wz * sunDir[2]) / (r || 1)) * 0.5 + 0.5,
            0.25,
            1,
          );
          cr += 0.14 * pGlow * sunLight;
          cg += 0.46 * pGlow * sunLight;
          cb += 0.78 * pGlow * sunLight;
          if (atmo.cloudDensity > 0.18) {
            const c = clamp(atmo.cloudDensity * 0.65, 0, 0.7);
            cr = cr * (1 - c) + 0.92 * c;
            cg = cg * (1 - c) + 0.95 * c;
            cb = cb * (1 - c) + 1.0 * c;
          }
        }

        // Open subterranean cave marker when inside baseRadius
        if (r < planet.baseRadius * 0.92) {
          cr += 0.06;
          cg += 0.04;
          cb += 0.08;
        }
      }

      if (showThermalOverlay) {
        const [tr, tg, tb] = temperatureToRgb(th.tempC);
        const mixT = d > 0 ? 0.62 : 0.45;
        cr = cr * (1 - mixT) + tr * mixT;
        cg = cg * (1 - mixT) + tg * mixT;
        cb = cb * (1 - mixT) + tb * mixT;
      }

      // Draw R0 reference dashed circle
      const ringErr = Math.abs(r - planet.baseRadius);
      if (ringErr < viewHalf * 0.008 && ((x + y) % 8 < 4)) {
        cr = 0.56;
        cg = 0.72;
        cb = 0.92;
      }

      pixels[pIdx] = clamp(Math.round(cr * 255), 0, 255);
      pixels[pIdx + 1] = clamp(Math.round(cg * 255), 0, 255);
      pixels[pIdx + 2] = clamp(Math.round(cb * 255), 0, 255);
      pixels[pIdx + 3] = 255;
    }
  }

  // Isotherm lines on cross-section when thermal overlay enabled
  if (showThermalOverlay) {
    const step = 100;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const b0 = Math.floor(tempScalar[idx] / step);
        const br = Math.floor(tempScalar[idx + 1] / step);
        const bd = Math.floor(tempScalar[idx + width] / step);
        if (b0 !== br || b0 !== bd) {
          const pIdx = idx * 4;
          pixels[pIdx] = 245;
          pixels[pIdx + 1] = 250;
          pixels[pIdx + 2] = 255;
        }
      }
    }
  }

  // Compute 180-sample 360° angular radial & thermal profile along the cross-section ring
  const profN = 180;
  const radialElevProfile = new Float32Array(profN);
  const radialTempProfile = new Float32Array(profN);
  for (let i = 0; i < profN; i++) {
    const ang = (i / profN) * Math.PI * 2;
    const dx = ux * Math.cos(ang) + vx * Math.sin(ang);
    const dy = uy * Math.cos(ang) + vy * Math.sin(ang);
    const dz = uz * Math.cos(ang) + vz * Math.sin(ang);
    const sr = planet.findSurfaceRadiusAlongRay(dx, dy, dz);
    radialElevProfile[i] = sr - planet.baseRadius;
    const th = sampleThermalField(
      dx * sr,
      dy * sr,
      dz * sr,
      planet.baseRadius,
      sunDir,
      atmosCfg,
      thermalCfg,
      simTimeSec,
    );
    radialTempProfile[i] = th.tempC;
  }

  return { pixels, radialElevProfile, radialTempProfile };
}

/**
 * Evaluates full planetary probe telemetry at a given spherical coordinate on the surface.
 */
export function probeAtlasAtLonLat(
  lonRad: number,
  latRad: number,
  atlas: PlanetarySurfaceAtlas,
  sunDir: readonly [number, number, number],
  atmosCfg: AtmosphereConfig,
  thermalCfg: ThermalConfig,
  simTimeSec: number,
): MapProbeResult {
  const sample = sampleAtlasBilinear(atlas, lonRad, latRad);
  const [dx, dy, dz] = lonLatToDir(lonRad, latRad);
  const wx = dx * sample.surfaceRadius;
  const wy = dy * sample.surfaceRadius;
  const wz = dz * sample.surfaceRadius;

  const atmo = sampleAtmosphereAtPoint(
    wx,
    wy,
    wz,
    atlas.baseRadius,
    atmosCfg,
    simTimeSec,
    sample.water,
  );
  const th = sampleThermalField(
    wx,
    wy,
    wz,
    atlas.baseRadius,
    sunDir,
    atmosCfg,
    thermalCfg,
    simTimeSec,
    sample.material,
    sample.water,
  );

  return {
    valid: true,
    latDeg: (latRad * 180) / Math.PI,
    lonDeg: (lonRad * 180) / Math.PI,
    worldPos: [wx, wy, wz],
    surfaceRadius: sample.surfaceRadius,
    elevation: sample.elev,
    material: sample.material,
    hasWater: sample.water > 0.35,
    tempC: th.tempC,
    tempK: th.tempK,
    pressureAtm: atmo.pressureAtm,
    windSpeedMs: atmo.windSpeedMs,
    insolationWm2: th.insolationWm2,
  };
}
