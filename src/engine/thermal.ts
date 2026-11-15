import { AtmosphereConfig, computeGreenhouseBoostC, sampleAtmosphereAtPoint } from './atmosphere';
import { MaterialId } from './voxelPlanet';

// 3D Planetary Temperature System:
// T(x, y, z) couples solar insolation, latitudinal curvature, adiabatic lapse rate,
// barometric greenhouse retention, deep geothermal core conduction, liquid water buffering,
// and local terrain albedo/crystal emission.

export interface ThermalConfig {
  solarIrradiance: number; // W/m² (1361 = 1 AU Solar Constant)
  coreTempC: number; // Deep planetary core temperature at r = 0 (°C)
  baseEquilibriumC: number; // Airless sub-zero radiative baseline offset (°C)
  lapseRateCPerScale: number; // Cooling across one atmospheric scale height (°C)
}

export const DEFAULT_THERMAL_CONFIG: ThermalConfig = {
  solarIrradiance: 1361,
  coreTempC: 1150,
  baseEquilibriumC: -18,
  lapseRateCPerScale: 24,
};

export interface ThermalSample {
  tempC: number;
  tempK: number;
  insolationWm2: number;
  geothermalC: number;
  regime: '极寒冰原' | '寒带' | '温带' | '热带' | '地热熔岩带';
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates the continuous 3D spatial temperature field T(wx, wy, wz) in Celsius & Kelvin.
 */
export function sampleThermalField(
  wx: number,
  wy: number,
  wz: number,
  planetRadius: number,
  sunDir: readonly [number, number, number],
  atmosCfg: AtmosphereConfig,
  thermalCfg: ThermalConfig,
  simTimeSec = 0,
  material: MaterialId = MaterialId.Soil,
  nearWaterWeight = 0,
): ThermalSample {
  const r = Math.hypot(wx, wy, wz);
  const safeR0 = Math.max(planetRadius, 0.05);
  const invR = r > 1e-6 ? 1 / r : 1;
  const nx = wx * invR;
  const ny = wy * invR;
  const nz = wz * invR;

  const rNorm = r / safeR0;
  const altRatio = rNorm - 1.0;

  // Solar cosine incidence
  const sunDot = nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2];
  const dayFactor = Math.max(0, sunDot);

  // Latitude insolation weighting (equator warmer than poles)
  const cosLat = Math.sqrt(Math.max(0, 1 - ny * ny));
  const solarRatio = Math.max(0, thermalCfg.solarIrradiance) / 1361.0;

  // Atmospheric buffering: thick air smooths day/night extremes and clouds reflect incoming light
  const atmoSample = sampleAtmosphereAtPoint(
    wx,
    wy,
    wz,
    safeR0,
    atmosCfg,
    simTimeSec,
    nearWaterWeight,
  );
  const cloudAlbedoBlock = atmosCfg.enabled
    ? 1.0 - clamp(atmosCfg.cloudCover, 0, 1.3) * 0.28
    : 1.0;
  const insolationWm2 =
    thermalCfg.solarIrradiance * dayFactor * cloudAlbedoBlock;

  const albedoAdj =
    material === MaterialId.Ice
      ? -11.0
      : material === MaterialId.Basalt
        ? 5.5
        : material === MaterialId.Sandstone
          ? 4.0
          : 0.0;

  const greenhouseC = computeGreenhouseBoostC(atmosCfg);
  const thermalInertia = atmosCfg.enabled
    ? clamp(atmosCfg.surfacePressureAtm * 0.55, 0.05, 0.85)
    : 0.0;

  // Diurnal swing decreases when atmospheric thermal inertia is high
  const diurnalRangeC = (1.0 - thermalInertia * 0.72) * 34.0 * Math.sqrt(solarRatio);
  const solarHeatingC =
    (22.0 * cosLat + 10.0) * Math.pow(solarRatio, 0.25) -
    18.0 +
    (sunDot * 0.5 + 0.15) * diurnalRangeC;

  // Tropospheric adiabatic lapse rate cooling above surface
  const scaleH = Math.max(atmosCfg.scaleHeightRatio, 0.02);
  const altitudeCoolingC =
    altRatio > 0
      ? Math.min(95, (altRatio / scaleH) * thermalCfg.lapseRateCPerScale) *
        (atmosCfg.enabled ? 1.0 : 0.35)
      : 0;

  // Subsurface geothermal conduction below r = R0 (rNorm < 1)
  let geothermalC = 0;
  if (rNorm < 0.98) {
    const depthFrac = clamp((0.98 - rNorm) / 0.98, 0, 1);
    geothermalC = Math.pow(depthFrac, 1.65) * thermalCfg.coreTempC;
  }

  // Crystal veins emit modest localized radiogenic heat
  const crystalWarmth = material === MaterialId.Crystal ? 8.5 : 0;

  // Surface + altitude base temperature
  let tempC =
    thermalCfg.baseEquilibriumC +
    solarHeatingC +
    greenhouseC +
    albedoAdj * dayFactor -
    altitudeCoolingC +
    crystalWarmth;

  // Blend in deep geothermal heat as depth increases below crust
  if (geothermalC > 1) {
    const coreBlend = smoothstep(0.98, 0.2, rNorm);
    tempC = tempC * (1 - coreBlend * 0.85) + (tempC + geothermalC);
  }

  // Water high heat capacity buffers extremes toward ~14°C unless boiling near core
  if (nearWaterWeight > 0 && geothermalC < 120) {
    const waterBuffer = clamp(nearWaterWeight, 0, 1) * 0.58;
    tempC = tempC * (1 - waterBuffer) + 14.0 * waterBuffer;
  }

  // Exosphere cools smoothly at high orbit
  if (altRatio > scaleH * 3.5) {
    const spaceFade = smoothstep(scaleH * 3.5, scaleH * 7.0, altRatio);
    tempC = tempC * (1 - spaceFade) + (-145 + 35 * dayFactor) * spaceFade;
  }

  let regime: ThermalSample['regime'] = '温带';
  if (tempC >= 120) regime = '地热熔岩带';
  else if (tempC >= 24) regime = '热带';
  else if (tempC >= 3) regime = '温带';
  else if (tempC >= -22) regime = '寒带';
  else regime = '极寒冰原';

  return {
    tempC,
    tempK: tempC + 273.15,
    insolationWm2,
    geothermalC,
    regime,
  };
}

/**
 * Maps temperature (°C) to calibrated scientific RGB [0..1] across cryogenic,
 * temperate, tropical, and geothermal regimes.
 */
export function temperatureToRgb(tempC: number): [number, number, number] {
  // Control stops in °C: [-80, -25, 0, 18, 42, 180, 900]
  const stops: ReadonlyArray<[number, [number, number, number]]> = [
    [-80, [0.16, 0.24, 0.72]], // Deep cryogenic indigo
    [-25, [0.14, 0.56, 0.94]], // Polar frost blue
    [0, [0.18, 0.84, 0.88]], // Freezing cyan
    [18, [0.22, 0.80, 0.44]], // Temperate emerald
    [42, [0.97, 0.74, 0.16]], // Arid amber
    [180, [0.94, 0.24, 0.14]], // Magma crimson
    [900, [1.0, 0.92, 0.62]], // Incandescent core yellow-white
  ];

  if (tempC <= stops[0][0]) return [...stops[0][1]];
  const last = stops[stops.length - 1];
  if (tempC >= last[0]) return [...last[1]];

  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (tempC >= t0 && tempC <= t1) {
      const f = (tempC - t0) / (t1 - t0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return [0.22, 0.8, 0.44];
}
