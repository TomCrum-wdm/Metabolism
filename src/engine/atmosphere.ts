// Physically-based spherical planetary atmosphere, barometric pressure,
// Coriolis zonal wind circulation, and cloud deck thermodynamics.

export interface AtmosphereConfig {
  enabled: boolean;
  surfacePressureAtm: number; // P0 at r = R0 (1.0 = Earth sea level)
  scaleHeightRatio: number; // H / R0 (exponential pressure decay scale)
  rayleighStrength: number; // Rayleigh sky scattering multiplier
  mieHaze: number; // Mie aerosol forward scattering / sunset glow
  cloudCover: number; // 0.0 .. 1.0+ cloud fraction
  cloudAltitudeRatio: number; // Cloud deck altitude fraction above R0
  windSpeed: number; // Zonal circulation velocity multiplier
  greenhouseFactor: number; // Radiative greenhouse heat trapping factor
}

export const DEFAULT_ATMOS_CONFIG: AtmosphereConfig = {
  enabled: true,
  surfacePressureAtm: 1.0,
  scaleHeightRatio: 0.14,
  rayleighStrength: 1.0,
  mieHaze: 0.65,
  cloudCover: 0.48,
  cloudAltitudeRatio: 0.17,
  windSpeed: 1.0,
  greenhouseFactor: 1.0,
};

export interface AtmosphereSample {
  pressureAtm: number;
  airDensityKgM3: number;
  altitudeRatio: number;
  windVector: [number, number, number];
  windSpeedMs: number;
  cloudDensity: number;
  humidity: number;
  layerName: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes atmospheric greenhouse warming boost (°C) from barometric pressure & cloud trapping.
 */
export function computeGreenhouseBoostC(cfg: AtmosphereConfig): number {
  if (!cfg.enabled || cfg.surfacePressureAtm <= 0) return 0;
  const pressureTerm = Math.log1p(Math.max(0, cfg.surfacePressureAtm) * 1.85);
  const cloudTrap = clamp(cfg.cloudCover, 0, 1.5) * 6.5;
  return (16.5 * pressureTerm + cloudTrap) * Math.max(0, cfg.greenhouseFactor);
}

/**
 * Computes instantaneous 3D atmospheric pressure, density, wind vector (Coriolis trade/jet stream),
 * and local cloud fraction at world position (wx, wy, wz).
 */
export function sampleAtmosphereAtPoint(
  wx: number,
  wy: number,
  wz: number,
  planetRadius: number,
  cfg: AtmosphereConfig,
  simTimeSec: number,
  nearWaterWeight = 0,
): AtmosphereSample {
  const r = Math.hypot(wx, wy, wz);
  const safeR0 = Math.max(planetRadius, 0.05);
  if (!cfg.enabled || cfg.surfacePressureAtm <= 0) {
    return {
      pressureAtm: 0,
      airDensityKgM3: 0,
      altitudeRatio: (r - safeR0) / safeR0,
      windVector: [0, 0, 0],
      windSpeedMs: 0,
      cloudDensity: 0,
      humidity: clamp(nearWaterWeight * 0.3, 0, 1),
      layerName: '真空外层空间',
    };
  }

  const alt = r - safeR0;
  const altRatio = alt / safeR0;
  const scaleH = Math.max(cfg.scaleHeightRatio, 0.01);

  // Barometric law above surface; compressed hydrostatic air column inside open caves
  const pressureAtm =
    alt >= 0
      ? Math.max(0, cfg.surfacePressureAtm * Math.exp(-altRatio / scaleH))
      : Math.max(0, cfg.surfacePressureAtm * (1 + clamp(-altRatio, 0, 0.5) * 0.45));

  const airDensityKgM3 = pressureAtm * 1.225;

  // Latitudinal Coriolis circulation: easterlies in tropics, westerlies in mid-latitudes
  const invR = r > 1e-6 ? 1 / r : 1;
  const nx = wx * invR;
  const ny = wy * invR;
  const nz = wz * invR;
  const lat = Math.asin(clamp(ny, -1, 1));
  const cosLat = Math.cos(lat);

  // Zonal tangent vector (-nz, 0, nx)
  const tx = -nz;
  const tz = nx;
  const tLen = Math.hypot(tx, tz) || 1;
  const ux = tx / tLen;
  const uz = tz / tLen;

  // Three-cell planetary wind profile (Hadley / Ferrel / Polar)
  const zonalSign = Math.cos(lat * 3.0);
  const jetFactor = 0.55 + 0.85 * Math.abs(Math.sin(lat * 2.0));
  const altWindFactor = clamp(0.6 + altRatio * 3.2, 0.2, 2.2);
  const baseSpeed =
    Math.max(0, cfg.windSpeed) *
    (6.5 * jetFactor * altWindFactor * clamp(pressureAtm, 0.08, 2.5));

  const vx = ux * zonalSign * baseSpeed * cosLat;
  const vz = uz * zonalSign * baseSpeed * cosLat;
  const vy =
    Math.sin(Math.atan2(nz, nx) * 3.0 + simTimeSec * 0.35 * cfg.windSpeed) *
    0.18 *
    baseSpeed;

  // Procedural cloud belt density at (nx, ny, nz) advected by zonal wind
  const lon = Math.atan2(nz, nx) - simTimeSec * 0.09 * cfg.windSpeed * zonalSign;
  const waveA =
    Math.sin(lon * 3.0 + Math.cos(lat * 4.0) * 1.6) *
    Math.cos(lat * 3.5 + simTimeSec * 0.04);
  const waveB =
    Math.sin(lon * 7.0 - simTimeSec * 0.14 * cfg.windSpeed + lat * 5.0) * 0.5;
  const rawCloud = 0.5 + 0.35 * waveA + 0.18 * waveB;
  const coverBias = clamp(cfg.cloudCover, 0, 1.5);
  const cloudBand =
    smoothstep(1.0 - coverBias * 0.92, 1.12 - coverBias * 0.6, rawCloud) *
    clamp(coverBias, 0, 1);

  const cloudShellDist = Math.abs(altRatio - cfg.cloudAltitudeRatio);
  const verticalMask = Math.exp(-Math.pow(cloudShellDist / Math.max(scaleH * 0.45, 0.02), 2));
  const cloudDensity = cloudBand * verticalMask;

  const humidity = clamp(
    (0.22 + 0.58 * cloudBand + 0.45 * nearWaterWeight) *
      clamp(pressureAtm, 0.05, 1.2),
    0,
    1,
  );

  let layerName = '外逸层';
  if (alt < 0) layerName = '地下空腔气压层';
  else if (altRatio < cfg.cloudAltitudeRatio * 0.9) layerName = '对流层';
  else if (altRatio < scaleH * 2.2) layerName = '平流层';
  else if (altRatio < scaleH * 4.2) layerName = '热层';

  return {
    pressureAtm,
    airDensityKgM3,
    altitudeRatio: altRatio,
    windVector: [vx, vy, vz],
    windSpeedMs: Math.hypot(vx, vy, vz),
    cloudDensity,
    humidity,
    layerName,
  };
}
