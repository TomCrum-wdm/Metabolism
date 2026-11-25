// Stage 5: Deep Geological Evolution & "沧海桑田" FVM-Driven Morphogenesis for 《Metabolism》
// Bridges Eulerian Finite-Volume fields (T, P, J_flux, phi, reaction entropy, H2O/CO2 species)
// directly into physical VoxelPlanet geological transformations:
//   1. Mantle upwelling & supercritical thermal anomalies -> Active Volcanoes + Basalt cones + degassing
//   2. High lateral flux divergence |J| & thermal stress -> Tectonic Earthquakes (Mw) + tangential fault fractures
//   3. Convergent mineral crystallization / crust compression -> Highland Plateau Orogeny (uplift)
//   4. Liquid H2O + flux gradient -> Fluvial gorge/fjord carving, downstream delta sandstone, sea-level transgression/regression

import { ThermalHotspot } from '../thermal';
import { MaterialId, VoxelPlanet } from '../voxelPlanet';
import { EulerianFvmGrid, MatterPhase } from './eulerianFvm';
import { MacroFeedbackBin } from './fvmComputeBackend';
import { PlanetaryFeedbackConfig } from './planetaryFeedback';

export type GeologicalEventKind = 'volcano' | 'quake' | 'uplift' | 'erosion' | 'sea_level';

export interface GeologicalEvolutionConfig {
  tectonicEvolutionEnabled: boolean;
  epochAcceleration: number; // [1..50] Myr pace multiplier
  volcanismSensitivity: number; // [0..3]
  seismicitySensitivity: number; // [0..3]
  erosionSensitivity: number; // [0..3]
  hydrologyCouplingEnabled: boolean;
}

export const DEFAULT_GEOLOGICAL_EVOLUTION_CONFIG: GeologicalEvolutionConfig = {
  tectonicEvolutionEnabled: true,
  epochAcceleration: 10,
  volcanismSensitivity: 1.0,
  seismicitySensitivity: 1.0,
  erosionSensitivity: 1.0,
  hydrologyCouplingEnabled: true,
};

export interface GeologicalTerrainOp {
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
  readonly ex?: number;
  readonly ey?: number;
  readonly ez?: number;
  readonly shape?: 'sphere' | 'cylinder';
  readonly radius: number;
  readonly mode: 'paint' | 'build' | 'carve' | 'volcano' | 'quake';
  readonly strength: number;
  readonly material: MaterialId;
  readonly rimMaterial?: MaterialId;
  readonly jaggedNoise?: number;
  readonly reason:
    | 'volcano_eruption'
    | 'tectonic_quake'
    | 'plateau_uplift'
    | 'fluvial_erosion'
    | 'mineral_crystal'
    | 'mineral_basalt'
    | 'acid_etch';
}

export interface GeologicalFluidOp {
  readonly kind: 'spawn_rain' | 'evaporate';
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
  readonly count: number;
  readonly radius: number;
}

export interface ActiveVolcanoSite {
  readonly id: string;
  readonly worldPos: readonly [number, number, number];
  readonly intensity: number;
  readonly tempC: number;
  readonly ageSec: number;
}

export interface SeismicEventMarker {
  readonly id: string;
  readonly epicenter: readonly [number, number, number];
  readonly faultEnd: readonly [number, number, number];
  readonly magnitudeMw: number;
  readonly ageSec: number;
}

export interface GeologicalEventRecord {
  readonly id: string;
  readonly stepIndex: number;
  readonly ageMyr: number;
  readonly kind: GeologicalEventKind;
  readonly summary: string;
  readonly worldPos?: readonly [number, number, number];
  readonly magnitudeMw?: number;
}

export interface GeologicalEvolutionStats {
  readonly geologicalAgeMyr: number;
  readonly activeVolcanoCount: number;
  readonly activeVolcanoes: ReadonlyArray<ActiveVolcanoSite>;
  readonly quakeCount: number;
  readonly lastQuakeMagMw: number | null;
  readonly recentQuakes: ReadonlyArray<SeismicEventMarker>;
  readonly upliftedVoxels: number;
  readonly erodedVoxels: number;
  readonly volcanicConeVoxels: number;
  readonly faultFractureVoxels: number;
  readonly seaLevelOffsetM: number;
  readonly recentGeoEvents: ReadonlyArray<GeologicalEventRecord>;
}

export interface GeologicalEvalOutput {
  readonly hotspots: ThermalHotspot[];
  readonly terrainOps: GeologicalTerrainOp[];
  readonly fluidOps: GeologicalFluidOp[];
  readonly volcanoSites: ActiveVolcanoSite[];
  readonly quakes: SeismicEventMarker[];
  readonly seaLevelDeltaM: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalizeVec3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return [0, 1, 0];
  return [x / len, y / len, z / len];
}

function surfaceProjectPoint(
  planet: VoxelPlanet,
  dxRaw: number,
  dyRaw: number,
  dzRaw: number,
): [number, number, number, number, number, number] {
  const [nx, ny, nz] = normalizeVec3(dxRaw, dyRaw, dzRaw);
  const surfR = planet.findSurfaceRadiusAlongRay(nx, ny, nz);
  return [nx * surfR, ny * surfR, nz * surfR, nx, ny, nz];
}

function tangentFrameAtNormal(nx: number, ny: number, nz: number): {
  tx: number;
  ty: number;
  tz: number;
  ux: number;
  uy: number;
  uz: number;
} {
  const rx = Math.abs(ny) < 0.85 ? 0 : 1;
  const ry = Math.abs(ny) < 0.85 ? 1 : 0;
  const rz = 0;
  let tx = ry * nz - rz * ny;
  let ty = rz * nx - rx * nz;
  let tz = rx * ny - ry * nx;
  const tLen = Math.hypot(tx, ty, tz) || 1;
  tx /= tLen;
  ty /= tLen;
  tz /= tLen;
  const ux = ny * tz - nz * ty;
  const uy = nz * tx - nx * tz;
  const uz = nx * ty - ny * tx;
  return { tx, ty, tz, ux, uy, uz };
}

/**
 * Injects volcanic degassing (CO2, H2O vapor, CH4/reactive heat) back into local Eulerian FVM cells,
 * closing the geochemical core/mantle-atmosphere loop.
 */
export function injectVolcanicDegassingIntoFvmGrid(
  grid: EulerianFvmGrid,
  wx: number,
  wy: number,
  wz: number,
  radius: number,
  tempBoostK = 240,
): number {
  const n = grid.cellsPerAxis;
  const effRad = Math.max(radius, grid.voxelSize * 1.35);
  const radSq = effRad * effRad;
  const minX = Math.max(0, Math.floor((wx - effRad + grid.worldHalf) / grid.voxelSize));
  const maxX = Math.min(n - 1, Math.floor((wx + effRad + grid.worldHalf) / grid.voxelSize));
  const minY = Math.max(0, Math.floor((wy - effRad + grid.worldHalf) / grid.voxelSize));
  const maxY = Math.min(n - 1, Math.floor((wy + effRad + grid.worldHalf) / grid.voxelSize));
  const minZ = Math.max(0, Math.floor((wz - effRad + grid.worldHalf) / grid.voxelSize));
  const maxZ = Math.min(n - 1, Math.floor((wz + effRad + grid.worldHalf) / grid.voxelSize));

  const S = grid.hypergraph.numSpecies;
  const hId = grid.hypergraph.id;
  let touched = 0;

  for (let iz = minZ; iz <= maxZ; iz++) {
    const cz = -grid.worldHalf + (iz + 0.5) * grid.voxelSize;
    for (let iy = minY; iy <= maxY; iy++) {
      const cy = -grid.worldHalf + (iy + 0.5) * grid.voxelSize;
      for (let ix = minX; ix <= maxX; ix++) {
        const cx = -grid.worldHalf + (ix + 0.5) * grid.voxelSize;
        const dSq = (cx - wx) ** 2 + (cy - wy) ** 2 + (cz - wz) ** 2;
        if (dSq > radSq) continue;
        const idx = grid.cellIndex(ix, iy, iz);
        if (grid.activeMask[idx] === 0) {
          grid.activeMask[idx] = 1;
        }
        const falloff = 1.0 - Math.sqrt(dSq) / effRad;
        grid.temperatureK[idx] = clamp(grid.temperatureK[idx] + tempBoostK * falloff, 140, 2600);
        grid.pressureAtm[idx] = clamp(grid.pressureAtm[idx] + 3.2 * falloff, 0.05, 80);

        const base = idx * S;
        if (hId === 'planetary_carbon_water') {
          // Degas CO2 (0), H2O(g) (1), CH4 (5)
          grid.speciesConc[base + 0] += 0.55 * falloff;
          if (S > 1) grid.speciesConc[base + 1] += 0.42 * falloff;
          if (S > 5) grid.speciesConc[base + 5] += 0.25 * falloff;
        } else {
          grid.speciesConc[base + 0] += 0.48 * falloff;
          if (S > 2) grid.speciesConc[base + 2] += 0.22 * falloff;
        }
        touched++;
      }
    }
  }

  if (touched > 0) {
    grid.rebuildActiveCellList();
    grid.syncInternalEnergyFromTemp();
    grid.revision++;
    grid.publishRenderSnapshot();
  }
  return touched;
}

/**
 * Fractures rock porosity along a tectonic fault line segment [a -> b] inside the FVM grid,
 * opening fluid & chemical hydrothermal pathways.
 */
export function fractureFaultPorosityInFvmGrid(
  grid: EulerianFvmGrid,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
): number {
  const n = grid.cellsPerAxis;
  const effRad = Math.max(radius, grid.voxelSize * 1.25);
  const radSq = effRad * effRad;
  const minX = Math.max(0, Math.floor((Math.min(ax, bx) - effRad + grid.worldHalf) / grid.voxelSize));
  const maxX = Math.min(n - 1, Math.floor((Math.max(ax, bx) + effRad + grid.worldHalf) / grid.voxelSize));
  const minY = Math.max(0, Math.floor((Math.min(ay, by) - effRad + grid.worldHalf) / grid.voxelSize));
  const maxY = Math.min(n - 1, Math.floor((Math.max(ay, by) + effRad + grid.worldHalf) / grid.voxelSize));
  const minZ = Math.max(0, Math.floor((Math.min(az, bz) - effRad + grid.worldHalf) / grid.voxelSize));
  const maxZ = Math.min(n - 1, Math.floor((Math.max(az, bz) + effRad + grid.worldHalf) / grid.voxelSize));

  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const abLenSq = Math.max(1e-6, abx * abx + aby * aby + abz * abz);
  let fractured = 0;

  for (let iz = minZ; iz <= maxZ; iz++) {
    const cz = -grid.worldHalf + (iz + 0.5) * grid.voxelSize;
    for (let iy = minY; iy <= maxY; iy++) {
      const cy = -grid.worldHalf + (iy + 0.5) * grid.voxelSize;
      for (let ix = minX; ix <= maxX; ix++) {
        const cx = -grid.worldHalf + (ix + 0.5) * grid.voxelSize;
        const apx = cx - ax;
        const apy = cy - ay;
        const apz = cz - az;
        const t = clamp((apx * abx + apy * aby + apz * abz) / abLenSq, 0, 1);
        const px = ax + abx * t;
        const py = ay + aby * t;
        const pz = az + abz * t;
        const dSq = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2;
        if (dSq > radSq) continue;

        const idx = grid.cellIndex(ix, iy, iz);
        grid.activeMask[idx] = 1;
        grid.porosity[idx] = Math.max(grid.porosity[idx], 0.74);
        grid.temperatureK[idx] = clamp(grid.temperatureK[idx] + 38, 140, 2600);
        fractured++;
      }
    }
  }

  if (fractured > 0) {
    grid.rebuildActiveCellList();
    grid.syncInternalEnergyFromTemp();
    grid.revision++;
    grid.publishRenderSnapshot();
  }
  return fractured;
}

/**
 * Evaluates autonomous FVM-driven volcanism, tectonic quakes, plateau orogeny, fluvial canyon carving,
 * and hydrologic rain/evaporation from CPU EulerianFvmGrid.
 */
export function evaluateTectonicAndFluvialCandidatesFromCpuGrid(
  grid: EulerianFvmGrid,
  planet: VoxelPlanet,
  feedbackCfg: PlanetaryFeedbackConfig,
  geoCfg: GeologicalEvolutionConfig,
  tectonicAccum: Float32Array | undefined,
  dtAccumSec: number,
  stepIndex: number,
): GeologicalEvalOutput {
  const hotspots: ThermalHotspot[] = [];
  const terrainOps: GeologicalTerrainOp[] = [];
  const fluidOps: GeologicalFluidOp[] = [];
  const volcanoSites: ActiveVolcanoSite[] = [];
  const quakes: SeismicEventMarker[] = [];

  if (!geoCfg.tectonicEvolutionEnabled) {
    return { hotspots, terrainOps, fluidOps, volcanoSites, quakes, seaLevelDeltaM: 0 };
  }

  const n = grid.cellsPerAxis;
  const S = grid.hypergraph.numSpecies;
  const r0 = planet.baseRadius;
  const stride = n > 24 ? Math.max(2, Math.floor(n / 16)) : 1;
  const paceScale = clamp(geoCfg.epochAcceleration / 10, 0.2, 5.0);

  let bestVolcano: { idx: number; wx: number; wy: number; wz: number; score: number; tempC: number } | null = null;
  let bestQuake: { idx: number; wx: number; wy: number; wz: number; score: number; fluxMag: number } | null = null;
  let bestUplift: { idx: number; wx: number; wy: number; wz: number; score: number } | null = null;
  let bestErosion: { idx: number; wx: number; wy: number; wz: number; score: number; jx: number; jy: number; jz: number } | null = null;

  let h2oLiquidMean = 0;
  let h2oVaporMean = 0;
  let activeCount = 0;

  for (let iz = 0; iz < n; iz += stride) {
    for (let iy = 0; iy < n; iy += stride) {
      for (let ix = 0; ix < n; ix += stride) {
        const idx = grid.cellIndex(ix, iy, iz);
        if (grid.activeMask[idx] === 0) continue;

        const [wx, wy, wz] = grid.cellCenterWorld(ix, iy, iz);
        const r = Math.hypot(wx, wy, wz);
        if (r < r0 * 0.72 || r > r0 * 1.18) continue;
        activeCount++;

        const base = idx * S;
        const tempK = grid.temperatureK[idx];
        const tempDiffK = tempK - grid.ambientTempK;
        const press = grid.pressureAtm[idx];
        const sigma = grid.entropyProdRate[idx];
        const fluxMag = Math.hypot(grid.fluxX[idx], grid.fluxY[idx], grid.fluxZ[idx]);
        const ph = grid.phase[idx] as MatterPhase;

        const cGas = grid.hypergraph.id === 'planetary_carbon_water' ? (grid.speciesConc[base + 1] ?? 0) : 0;
        const cWater =
          grid.hypergraph.id === 'planetary_carbon_water' || grid.hypergraph.id === 'planetary_hydrology'
            ? (grid.speciesConc[base + 2] ?? 0)
            : (grid.speciesConc[base + 0] ?? 0);
        h2oVaporMean += cGas;
        h2oLiquidMean += cWater;

        const accPrev = tectonicAccum ? tectonicAccum[idx] : 0;

        // 1. Volcanism candidate: supercritical / high temperature + high pressure magma plume
        const thermalDrive = Math.max(0, tempDiffK - 55) * 0.014 + Math.max(0, press - 1.35) * 0.45 + (ph === MatterPhase.Supercritical ? 0.85 : 0);
        if (thermalDrive > 0.35 && geoCfg.volcanismSensitivity > 0) {
          const vScore = thermalDrive * geoCfg.volcanismSensitivity * paceScale;
          const nextAcc = accPrev + vScore * dtAccumSec * 0.65;
          if (tectonicAccum) tectonicAccum[idx] = nextAcc;
          if (nextAcc >= 1.35 && (!bestVolcano || vScore > bestVolcano.score)) {
            bestVolcano = { idx, wx, wy, wz, score: vScore, tempC: tempK - 273.15 + 480 };
          }
        }

        // 2. Tectonic quake candidate: sharp lateral flux divergence + entropy gradient
        const seismicDrive = fluxMag * 28.0 + sigma * 0.8 + Math.abs(tempDiffK) * 0.008;
        if (seismicDrive > 0.65 && geoCfg.seismicitySensitivity > 0) {
          const qScore = seismicDrive * geoCfg.seismicitySensitivity * paceScale;
          if (!bestQuake || qScore > bestQuake.score) {
            bestQuake = { idx, wx, wy, wz, score: qScore, fluxMag };
          }
        }

        // 3. Highland orogeny candidate: mineral supersaturation + moderate crustal warmth
        const cX =
          grid.hypergraph.id === 'planetary_carbon_water'
            ? (grid.speciesConc[base + 3] ?? 0)
            : (grid.speciesConc[base + 1] ?? 0);
        if (cX > feedbackCfg.mineralThresholdConc * 1.05 && tempDiffK > 8 && tempDiffK < 110) {
          const uScore = (cX - feedbackCfg.mineralThresholdConc) * paceScale;
          if (!bestUplift || uScore > bestUplift.score) {
            bestUplift = { idx, wx, wy, wz, score: uScore };
          }
        }

        // 4. Fluvial canyon & fjord erosion: abundant H2O(l) + spatial flux shear
        if (cWater > 0.42 && fluxMag > 0.008 && geoCfg.erosionSensitivity > 0) {
          const eScore = cWater * (0.4 + fluxMag * 22.0) * geoCfg.erosionSensitivity * paceScale;
          if (!bestErosion || eScore > bestErosion.score) {
            bestErosion = {
              idx,
              wx,
              wy,
              wz,
              score: eScore,
              jx: grid.fluxX[idx],
              jy: grid.fluxY[idx],
              jz: grid.fluxZ[idx],
            };
          }
        }
      }
    }
  }

  const rScale = r0 / 13.0;

  if (bestVolcano) {
    if (tectonicAccum) tectonicAccum[bestVolcano.idx] = 0;
    const [sx, sy, sz, nx, ny, nz] = surfaceProjectPoint(planet, bestVolcano.wx, bestVolcano.wy, bestVolcano.wz);
    const vRad = clamp(1.85 * rScale, planet.voxelSize * 1.5, r0 * 0.24);
    terrainOps.push({
      wx: sx,
      wy: sy,
      wz: sz,
      radius: vRad,
      mode: 'volcano',
      strength: 1.65,
      material: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      reason: 'volcano_eruption',
    });
    hotspots.push({
      x: sx,
      y: sy,
      z: sz,
      radius: vRad * 2.1,
      deltaC: clamp(bestVolcano.tempC, 420, 920),
      decayPerSec: 0,
      source: 'metabolism',
    });
    volcanoSites.push({
      id: `volc_${stepIndex}_${bestVolcano.idx}`,
      worldPos: [sx + nx * 0.35 * rScale, sy + ny * 0.35 * rScale, sz + nz * 0.35 * rScale],
      intensity: clamp(bestVolcano.score * 0.45, 0.5, 2.0),
      tempC: clamp(bestVolcano.tempC, 540, 1180),
      ageSec: 0,
    });
  }

  if (bestQuake && bestQuake.score > 1.75) {
    const [sx, sy, sz, nx, ny, nz] = surfaceProjectPoint(planet, bestQuake.wx, bestQuake.wy, bestQuake.wz);
    const frame = tangentFrameAtNormal(nx, ny, nz);
    const angle = (stepIndex * 1.618) % (Math.PI * 2);
    const fx = frame.tx * Math.cos(angle) + frame.ux * Math.sin(angle);
    const fy = frame.ty * Math.cos(angle) + frame.uy * Math.sin(angle);
    const fz = frame.tz * Math.cos(angle) + frame.uz * Math.sin(angle);
    const halfLen = clamp(2.1 * rScale, planet.voxelSize * 2.0, r0 * 0.28);

    const ax = sx - fx * halfLen;
    const ay = sy - fy * halfLen;
    const az = sz - fz * halfLen;
    const bx = sx + fx * halfLen;
    const by = sy + fy * halfLen;
    const bz = sz + fz * halfLen;
    const magMw = clamp(4.8 + Math.log1p(bestQuake.score) * 1.65, 4.9, 8.6);

    terrainOps.push({
      wx: ax,
      wy: ay,
      wz: az,
      ex: bx,
      ey: by,
      ez: bz,
      shape: 'cylinder',
      radius: clamp(1.15 * rScale, planet.voxelSize * 1.1, r0 * 0.16),
      mode: 'quake',
      strength: clamp(0.85 + (magMw - 5.0) * 0.25, 0.7, 1.85),
      material: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      jaggedNoise: 1.25,
      reason: 'tectonic_quake',
    });
    quakes.push({
      id: `quake_${stepIndex}_${bestQuake.idx}`,
      epicenter: [sx, sy, sz],
      faultEnd: [bx, by, bz],
      magnitudeMw: Number(magMw.toFixed(1)),
      ageSec: 0,
    });
  }

  if (bestUplift && terrainOps.length < 3) {
    const [sx, sy, sz] = surfaceProjectPoint(planet, bestUplift.wx, bestUplift.wy, bestUplift.wz);
    terrainOps.push({
      wx: sx,
      wy: sy,
      wz: sz,
      radius: clamp(1.55 * rScale, planet.voxelSize * 1.4, r0 * 0.2),
      mode: 'build',
      strength: 0.34,
      material: MaterialId.Stone,
      rimMaterial: MaterialId.Sandstone,
      reason: 'plateau_uplift',
    });
  }

  if (bestErosion && terrainOps.length < 4) {
    const [sx, sy, sz, nx, ny, nz] = surfaceProjectPoint(planet, bestErosion.wx, bestErosion.wy, bestErosion.wz);
    const carveRad = clamp(1.25 * rScale, planet.voxelSize * 1.2, r0 * 0.16);
    terrainOps.push({
      wx: sx,
      wy: sy,
      wz: sz,
      radius: carveRad,
      mode: 'carve',
      strength: 0.32,
      material: MaterialId.Sandstone,
      reason: 'fluvial_erosion',
    });

    // Downstream delta sedimentation offset tangentially along flux direction
    const dotN = bestErosion.jx * nx + bestErosion.jy * ny + bestErosion.jz * nz;
    const [tx, ty, tz] = normalizeVec3(
      bestErosion.jx - nx * dotN,
      bestErosion.jy - ny * dotN,
      bestErosion.jz - nz * dotN,
    );
    const [dx, dy, dz] = surfaceProjectPoint(
      planet,
      sx + tx * carveRad * 1.4,
      sy + ty * carveRad * 1.4,
      sz + tz * carveRad * 1.4,
    );
    terrainOps.push({
      wx: dx,
      wy: dy,
      wz: dz,
      radius: carveRad * 0.9,
      mode: 'paint',
      strength: 0.8,
      material: MaterialId.Sandstone,
      reason: 'fluvial_erosion',
    });

    if (geoCfg.hydrologyCouplingEnabled) {
      fluidOps.push({
        kind: 'spawn_rain',
        wx: sx + nx * 1.15 * rScale,
        wy: sy + ny * 1.15 * rScale,
        wz: sz + nz * 1.15 * rScale,
        count: 6,
        radius: carveRad * 1.2,
      });
    }
  }

  // Sea-level transgression / regression estimate from H2O balance
  const meanLiq = activeCount > 0 ? h2oLiquidMean / activeCount : 0;
  const meanVap = activeCount > 0 ? h2oVaporMean / activeCount : 0;
  const seaLevelDeltaM = clamp((meanLiq - meanVap * 0.85 - 0.35) * 0.12 * rScale, -0.4, 0.4);

  if (geoCfg.hydrologyCouplingEnabled && grid.ambientTempK > 348 && planet.lakeBasinCenters.length > 0) {
    const basin = planet.lakeBasinCenters[stepIndex % planet.lakeBasinCenters.length];
    fluidOps.push({
      kind: 'evaporate',
      wx: basin[0],
      wy: basin[1],
      wz: basin[2],
      count: 4,
      radius: 2.2 * rScale,
    });
  }

  return {
    hotspots,
    terrainOps,
    fluidOps,
    volcanoSites,
    quakes,
    seaLevelDeltaM,
  };
}

/**
 * Evaluates FVM-driven tectonic candidates directly from WebGPU 512-bin telemetry without full grid readback.
 */
export function evaluateTectonicCandidatesFromGpuBins(
  bins: ReadonlyArray<MacroFeedbackBin>,
  planet: VoxelPlanet,
  ambientTempK: number,
  geoCfg: GeologicalEvolutionConfig,
  stepIndex: number,
): GeologicalEvalOutput {
  const hotspots: ThermalHotspot[] = [];
  const terrainOps: GeologicalTerrainOp[] = [];
  const fluidOps: GeologicalFluidOp[] = [];
  const volcanoSites: ActiveVolcanoSite[] = [];
  const quakes: SeismicEventMarker[] = [];

  if (!geoCfg.tectonicEvolutionEnabled || bins.length === 0) {
    return { hotspots, terrainOps, fluidOps, volcanoSites, quakes, seaLevelDeltaM: 0 };
  }

  const r0 = planet.baseRadius;
  const rScale = r0 / 13.0;
  let hottestBin: MacroFeedbackBin | null = null;
  let highStressBin: MacroFeedbackBin | null = null;
  let highStressScore = 0;

  for (const b of bins) {
    const r = Math.hypot(b.worldPos[0], b.worldPos[1], b.worldPos[2]);
    if (r < r0 * 0.72 || r > r0 * 1.18) continue;
    if (!hottestBin || b.meanTempK > hottestBin.meanTempK) hottestBin = b;
    const stress = b.entropyProdRate * 0.8 + Math.abs(b.meanTempK - ambientTempK) * 0.015;
    if (stress > highStressScore) {
      highStressScore = stress;
      highStressBin = b;
    }
  }

  if (hottestBin && hottestBin.meanTempK - ambientTempK > 75 && geoCfg.volcanismSensitivity > 0) {
    const [sx, sy, sz, nx, ny, nz] = surfaceProjectPoint(
      planet,
      hottestBin.worldPos[0],
      hottestBin.worldPos[1],
      hottestBin.worldPos[2],
    );
    const vRad = clamp(1.7 * rScale, planet.voxelSize * 1.4, r0 * 0.22);
    const tempC = clamp(hottestBin.meanTempK - 273.15 + 480, 450, 960);
    terrainOps.push({
      wx: sx,
      wy: sy,
      wz: sz,
      radius: vRad,
      mode: 'volcano',
      strength: 1.5,
      material: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      reason: 'volcano_eruption',
    });
    hotspots.push({
      x: sx,
      y: sy,
      z: sz,
      radius: vRad * 2.0,
      deltaC: tempC,
      decayPerSec: 0,
      source: 'metabolism',
    });
    volcanoSites.push({
      id: `gpu_volc_${stepIndex}`,
      worldPos: [sx + nx * 0.35 * rScale, sy + ny * 0.35 * rScale, sz + nz * 0.35 * rScale],
      intensity: 1.15,
      tempC,
      ageSec: 0,
    });
  }

  if (highStressBin && highStressScore > 1.45 && geoCfg.seismicitySensitivity > 0) {
    const [sx, sy, sz, nx, ny, nz] = surfaceProjectPoint(
      planet,
      highStressBin.worldPos[0],
      highStressBin.worldPos[1],
      highStressBin.worldPos[2],
    );
    const frame = tangentFrameAtNormal(nx, ny, nz);
    const halfLen = clamp(2.0 * rScale, planet.voxelSize * 2.0, r0 * 0.25);
    const ax = sx - frame.tx * halfLen;
    const ay = sy - frame.ty * halfLen;
    const az = sz - frame.tz * halfLen;
    const bx = sx + frame.tx * halfLen;
    const by = sy + frame.ty * halfLen;
    const bz = sz + frame.tz * halfLen;
    const magMw = clamp(5.2 + Math.log1p(highStressScore) * 1.45, 5.2, 8.4);

    terrainOps.push({
      wx: ax,
      wy: ay,
      wz: az,
      ex: bx,
      ey: by,
      ez: bz,
      shape: 'cylinder',
      radius: clamp(1.1 * rScale, planet.voxelSize * 1.1, r0 * 0.15),
      mode: 'quake',
      strength: 1.1,
      material: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      jaggedNoise: 1.25,
      reason: 'tectonic_quake',
    });
    quakes.push({
      id: `gpu_quake_${stepIndex}`,
      epicenter: [sx, sy, sz],
      faultEnd: [bx, by, bz],
      magnitudeMw: Number(magMw.toFixed(1)),
      ageSec: 0,
    });
  }

  return { hotspots, terrainOps, fluidOps, volcanoSites, quakes, seaLevelDeltaM: 0 };
}

/**
 * Generates deterministic surface-projected terrain, hotspot, fluid & marker ops for
 * manual geological triggers or Deep-Time Epoch cycles.
 */
export function buildManualGeologicalEventOps(
  kind: 'volcano' | 'quake' | 'uplift' | 'erosion',
  planet: VoxelPlanet,
  grid: EulerianFvmGrid,
  seedCounter: number,
  worldPos?: readonly [number, number, number],
): GeologicalEvalOutput {
  const r0 = planet.baseRadius;
  const rScale = r0 / 13.0;

  let dirX: number;
  let dirY: number;
  let dirZ: number;

  if (worldPos) {
    [dirX, dirY, dirZ] = normalizeVec3(worldPos[0], worldPos[1], worldPos[2]);
  } else {
    // Golden-angle deterministic spread across hemispheres so sequential triggers carve diverse continents
    const golden = 2.39996323;
    const t = seedCounter + 1;
    const y = clamp(Math.cos(t * 0.92) * 0.72, -0.78, 0.78);
    const radXZ = Math.sqrt(Math.max(0.01, 1 - y * y));
    const phi = t * golden + 0.45;
    dirX = Math.cos(phi) * radXZ;
    dirY = y;
    dirZ = Math.sin(phi) * radXZ;
  }

  const [sx, sy, sz, nx, ny, nz] = surfaceProjectPoint(planet, dirX, dirY, dirZ);
  const frame = tangentFrameAtNormal(nx, ny, nz);

  const hotspots: ThermalHotspot[] = [];
  const terrainOps: GeologicalTerrainOp[] = [];
  const fluidOps: GeologicalFluidOp[] = [];
  const volcanoSites: ActiveVolcanoSite[] = [];
  const quakes: SeismicEventMarker[] = [];

  if (kind === 'volcano') {
    const vRad = clamp(2.15 * rScale, planet.voxelSize * 1.6, r0 * 0.25);
    terrainOps.push({
      wx: sx,
      wy: sy,
      wz: sz,
      radius: vRad,
      mode: 'volcano',
      strength: 2.3,
      material: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      reason: 'volcano_eruption',
    });
    hotspots.push({
      x: sx,
      y: sy,
      z: sz,
      radius: vRad * 2.3,
      deltaC: 860,
      decayPerSec: 0,
      source: 'metabolism',
    });
    volcanoSites.push({
      id: `manual_volc_${seedCounter}`,
      worldPos: [sx + nx * 0.45 * rScale, sy + ny * 0.45 * rScale, sz + nz * 0.45 * rScale],
      intensity: 1.45,
      tempC: 1080,
      ageSec: 0,
    });
    injectVolcanicDegassingIntoFvmGrid(grid, sx, sy, sz, vRad * 1.3, 280);
  } else if (kind === 'quake') {
    const faultHalf = clamp(2.85 * rScale, planet.voxelSize * 2.4, r0 * 0.34);
    const ang = (seedCounter * 1.17) % (Math.PI * 2);
    const fx = frame.tx * Math.cos(ang) + frame.ux * Math.sin(ang);
    const fy = frame.ty * Math.cos(ang) + frame.uy * Math.sin(ang);
    const fz = frame.tz * Math.cos(ang) + frame.uz * Math.sin(ang);
    const ax = sx - fx * faultHalf;
    const ay = sy - fy * faultHalf;
    const az = sz - fz * faultHalf;
    const bx = sx + fx * faultHalf;
    const by = sy + fy * faultHalf;
    const bz = sz + fz * faultHalf;
    const qRad = clamp(1.35 * rScale, planet.voxelSize * 1.2, r0 * 0.16);
    const magMw = Number(clamp(6.4 + (seedCounter % 4) * 0.45, 6.2, 8.5).toFixed(1));

    terrainOps.push({
      wx: ax,
      wy: ay,
      wz: az,
      ex: bx,
      ey: by,
      ez: bz,
      shape: 'cylinder',
      radius: qRad,
      mode: 'quake',
      strength: 1.55,
      material: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      jaggedNoise: 1.35,
      reason: 'tectonic_quake',
    });
    quakes.push({
      id: `manual_quake_${seedCounter}`,
      epicenter: [sx, sy, sz],
      faultEnd: [bx, by, bz],
      magnitudeMw: magMw,
      ageSec: 0,
    });
    fractureFaultPorosityInFvmGrid(grid, ax, ay, az, bx, by, bz, qRad * 1.4);
  } else if (kind === 'uplift') {
    // Stepped highland plateau uplift with crystalline / sandstone core veins
    const uRad = clamp(2.45 * rScale, planet.voxelSize * 1.8, r0 * 0.28);
    terrainOps.push({
      wx: sx,
      wy: sy,
      wz: sz,
      radius: uRad,
      mode: 'build',
      strength: 1.45,
      material: MaterialId.Stone,
      rimMaterial: MaterialId.Sandstone,
      reason: 'plateau_uplift',
    });
    const [sx2, sy2, sz2] = surfaceProjectPoint(
      planet,
      sx + frame.tx * uRad * 0.72,
      sy + frame.ty * uRad * 0.72,
      sz + frame.tz * uRad * 0.72,
    );
    terrainOps.push({
      wx: sx2,
      wy: sy2,
      wz: sz2,
      radius: uRad * 0.78,
      mode: 'build',
      strength: 1.15,
      material: MaterialId.Sandstone,
      rimMaterial: MaterialId.Soil,
      reason: 'plateau_uplift',
    });
  } else {
    // Fluvial gorge & fjord carving along curved downstream segment + monsoon headwater rain
    const eRad = clamp(1.55 * rScale, planet.voxelSize * 1.3, r0 * 0.2);
    const channelLen = clamp(3.4 * rScale, planet.voxelSize * 3.0, r0 * 0.36);
    const ax = sx;
    const ay = sy;
    const az = sz;
    const [bx, by, bz] = surfaceProjectPoint(
      planet,
      sx + frame.tx * channelLen,
      sy + frame.ty * channelLen,
      sz + frame.tz * channelLen,
    );
    terrainOps.push({
      wx: ax,
      wy: ay,
      wz: az,
      ex: bx,
      ey: by,
      ez: bz,
      shape: 'cylinder',
      radius: eRad,
      mode: 'carve',
      strength: 1.45,
      material: MaterialId.Air,
      reason: 'fluvial_erosion',
    });
    terrainOps.push({
      wx: bx,
      wy: by,
      wz: bz,
      radius: eRad * 1.15,
      mode: 'paint',
      strength: 1.0,
      material: MaterialId.Sandstone,
      reason: 'fluvial_erosion',
    });
    fluidOps.push({
      kind: 'spawn_rain',
      wx: sx + nx * 1.35 * rScale,
      wy: sy + ny * 1.35 * rScale,
      wz: sz + nz * 1.35 * rScale,
      count: 26,
      radius: eRad * 1.35,
    });
  }

  return {
    hotspots,
    terrainOps,
    fluidOps,
    volcanoSites,
    quakes,
    seaLevelDeltaM: kind === 'erosion' ? 0.18 * rScale : kind === 'volcano' ? -0.1 * rScale : 0,
  };
}
