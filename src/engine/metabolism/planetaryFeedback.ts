// Bidirectional Planetary Feedback Coupling for 《Metabolism》
// Closes the loop between the dissipative Eulerian reaction-transport field and the 3D VoxelPlanet:
//   1. Exothermic / endothermic reaction heat -> persistent ThermalHotspots affecting 3D temperature field.
//   2. Autocatalytic / supersaturated precipitation & high-entropy corrosion -> throttled VoxelPlanet
//      MaterialId.Crystal / Basalt deposition & subtle micro-relief carving.
//   3. Terrain sculpting brush edits -> localized FVM porosity & active boundary mask refresh.

import { ThermalHotspot } from '../thermal';
import { MaterialId, VoxelPlanet } from '../voxelPlanet';
import { EulerianFvmGrid } from './eulerianFvm';
import { MacroFeedbackBin } from './fvmComputeBackend';

export interface PlanetaryFeedbackConfig {
  thermalFeedbackEnabled: boolean;
  mineralizationEnabled: boolean;
  thermalGain: number; // [0..3] multiplier on exothermic deltaC
  mineralizationRate: number; // [0..3] deposition sensitivity
  mineralThresholdConc: number; // Autocatalyst/product threshold in mol/m^3
}

export const DEFAULT_PLANETARY_FEEDBACK_CONFIG: PlanetaryFeedbackConfig = {
  thermalFeedbackEnabled: true,
  mineralizationEnabled: true,
  thermalGain: 1.0,
  mineralizationRate: 1.0,
  mineralThresholdConc: 0.85,
};

export interface PlanetaryFeedbackEventLog {
  readonly stepIndex: number;
  readonly kind: 'thermal' | 'mineral_crystal' | 'mineral_basalt' | 'acid_etch' | 'porosity_sync';
  readonly summary: string;
}

export interface PlanetaryFeedbackStats {
  readonly activeThermalHotspots: number;
  readonly peakExothermicDeltaC: number;
  readonly totalMineralizedVoxels: number;
  readonly totalCorrodedVoxels: number;
  readonly lastMineralBatchCount: number;
  readonly lastPorositySyncVoxels: number;
  readonly eventLogs: ReadonlyArray<PlanetaryFeedbackEventLog>;
}

export interface FeedbackEvaluationResult {
  readonly hotspots: ThermalHotspot[];
  readonly mineralOps: ReadonlyArray<{
    readonly wx: number;
    readonly wy: number;
    readonly wz: number;
    readonly radius: number;
    readonly mode: 'paint' | 'build' | 'carve';
    readonly strength: number;
    readonly material: MaterialId;
    readonly reason: 'mineral_crystal' | 'mineral_basalt' | 'acid_etch';
  }>;
  readonly peakDeltaC: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Evaluates thermal hotspots and mineralization/corrosion candidate operations from the CPU EulerianFvmGrid.
 */
export function evaluateFeedbackCandidatesFromCpuGrid(
  grid: EulerianFvmGrid,
  planet: VoxelPlanet,
  cfg: PlanetaryFeedbackConfig,
  accumulator?: Float32Array,
  dtAccumSec = 0.5,
): FeedbackEvaluationResult {
  const n = grid.cellsPerAxis;
  const S = grid.hypergraph.numSpecies;
  const r0 = planet.baseRadius;
  const hotspots: ThermalHotspot[] = [];
  const mineralOps: Array<{
    wx: number;
    wy: number;
    wz: number;
    radius: number;
    mode: 'paint' | 'build' | 'carve';
    strength: number;
    material: MaterialId;
    reason: 'mineral_crystal' | 'mineral_basalt' | 'acid_etch';
  }> = [];

  const thermalCandidates: Array<{ wx: number; wy: number; wz: number; deltaC: number }> = [];
  const mineralCandidates: Array<{
    idx: number;
    wx: number;
    wy: number;
    wz: number;
    score: number;
    reason: 'mineral_crystal' | 'mineral_basalt' | 'acid_etch';
  }> = [];

  let peakDeltaC = 0;

  // Stride at > 24^3 if evaluated on CPU so feedback scan remains sub-millisecond
  const stride = n > 24 ? Math.max(2, Math.floor(n / 16)) : 1;

  for (let iz = 0; iz < n; iz += stride) {
    for (let iy = 0; iy < n; iy += stride) {
      for (let ix = 0; ix < n; ix += stride) {
        const idx = grid.cellIndex(ix, iy, iz);
        if (grid.activeMask[idx] === 0) continue;

        const [wx, wy, wz] = grid.cellCenterWorld(ix, iy, iz);
        const r = Math.hypot(wx, wy, wz);
        // Restrict terrain write-backs strictly to the crustal/surface interaction shell
        if (r < r0 * 0.78 || r > r0 * 1.14) continue;

        const base = idx * S;
        const cX = grid.speciesConc[base + 1] ?? 0;
        const cW = grid.speciesConc[base + 2] ?? 0;
        const tempDiffK = grid.temperatureK[idx] - grid.ambientTempK;
        const sigma = grid.entropyProdRate[idx];

        if (cfg.thermalFeedbackEnabled && Math.abs(tempDiffK) > 4.0) {
          const dC = clamp(tempDiffK * 0.85 * cfg.thermalGain, -45, 360);
          if (Math.abs(dC) > 4.0) {
            thermalCandidates.push({ wx, wy, wz, deltaC: dC });
            if (dC > peakDeltaC) peakDeltaC = dC;
          }
        }

        if (cfg.mineralizationEnabled) {
          // Verify point lies near an actual rock surface before mineralizing or etching
          const dens = planet.sampleDensity(wx, wy, wz, true);
          if (Math.abs(dens) <= grid.voxelSize * 1.65) {
            const xExcess = cX - cfg.mineralThresholdConc;
            const prevAcc = accumulator ? accumulator[idx] : 0;
            const rate = Math.max(0, cfg.mineralizationRate);

            if (xExcess > 0.02) {
              const inc = xExcess * rate * dtAccumSec;
              const nextAcc = prevAcc + inc;
              if (accumulator) accumulator[idx] = nextAcc;
              if (nextAcc >= 0.45) {
                if (accumulator) accumulator[idx] = nextAcc - 0.45;
                mineralCandidates.push({
                  idx,
                  wx,
                  wy,
                  wz,
                  score: nextAcc,
                  reason: tempDiffK > 45 ? 'mineral_basalt' : 'mineral_crystal',
                });
              }
            } else if (cW > cfg.mineralThresholdConc * 1.35 && sigma > 0.25 && dens > 0.02) {
              const inc = (cW - cfg.mineralThresholdConc) * 0.45 * rate * dtAccumSec;
              const nextAcc = prevAcc + inc;
              if (accumulator) accumulator[idx] = nextAcc;
              if (nextAcc >= 0.65) {
                if (accumulator) accumulator[idx] = nextAcc - 0.65;
                mineralCandidates.push({
                  idx,
                  wx,
                  wy,
                  wz,
                  score: nextAcc,
                  reason: 'acid_etch',
                });
              }
            }
          }
        }
      }
    }
  }

  // Keep top 6 thermal hotspots spaced out cleanly
  thermalCandidates.sort((a, b) => Math.abs(b.deltaC) - Math.abs(a.deltaC));
  const minHotspotDist = Math.max(grid.voxelSize * 2.0, r0 * 0.24);
  for (let i = 0; i < thermalCandidates.length && hotspots.length < 6; i++) {
    const c = thermalCandidates[i];
    let tooClose = false;
    for (const h of hotspots) {
      if (Math.hypot(c.wx - h.x, c.wy - h.y, c.wz - h.z) < minHotspotDist) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      hotspots.push({
        x: c.wx,
        y: c.wy,
        z: c.wz,
        radius: Math.max(grid.voxelSize * 2.2, r0 * 0.22),
        deltaC: c.deltaC,
        decayPerSec: 0, // Persistent while metabolic reaction sustains it; replaced each flush
        source: 'metabolism',
      });
    }
  }

  // Keep top 4 mineralization / etching actions per throttled flush to hold 60fps smooth
  mineralCandidates.sort((a, b) => b.score - a.score);
  const brushRad = clamp(grid.voxelSize * 0.72, planet.voxelSize * 1.25, r0 * 0.14);
  for (let i = 0; i < mineralCandidates.length && mineralOps.length < 4; i++) {
    const m = mineralCandidates[i];
    if (m.reason === 'acid_etch') {
      mineralOps.push({
        wx: m.wx,
        wy: m.wy,
        wz: m.wz,
        radius: brushRad,
        mode: 'carve',
        strength: 0.28,
        material: MaterialId.Sandstone,
        reason: 'acid_etch',
      });
    } else if (m.reason === 'mineral_basalt') {
      mineralOps.push({
        wx: m.wx,
        wy: m.wy,
        wz: m.wz,
        radius: brushRad,
        mode: 'paint',
        strength: 0.75,
        material: MaterialId.Basalt,
        reason: 'mineral_basalt',
      });
    } else {
      mineralOps.push({
        wx: m.wx,
        wy: m.wy,
        wz: m.wz,
        radius: brushRad,
        mode: 'build',
        strength: 0.22,
        material: MaterialId.Crystal,
        reason: 'mineral_crystal',
      });
    }
  }

  return { hotspots, mineralOps, peakDeltaC };
}

/**
 * Evaluates thermal hotspots and mineralization candidates from the GPU 512-bin macro feedback buffer.
 * Works at 64^3..128^3 (up to 2,097,152 voxels) with zero full-grid readback!
 */
export function evaluateFeedbackCandidatesFromGpuBins(
  bins: ReadonlyArray<MacroFeedbackBin>,
  planet: VoxelPlanet,
  ambientTempK: number,
  voxelSize: number,
  cfg: PlanetaryFeedbackConfig,
): FeedbackEvaluationResult {
  const r0 = planet.baseRadius;
  const hotspots: ThermalHotspot[] = [];
  const mineralOps: Array<{
    wx: number;
    wy: number;
    wz: number;
    radius: number;
    mode: 'paint' | 'build' | 'carve';
    strength: number;
    material: MaterialId;
    reason: 'mineral_crystal' | 'mineral_basalt' | 'acid_etch';
  }> = [];

  let peakDeltaC = 0;
  const thermalCands: Array<{ wx: number; wy: number; wz: number; deltaC: number }> = [];
  const minCands: Array<{
    wx: number;
    wy: number;
    wz: number;
    score: number;
    reason: 'mineral_crystal' | 'mineral_basalt';
  }> = [];

  for (const b of bins) {
    const [wx, wy, wz] = b.worldPos;
    const r = Math.hypot(wx, wy, wz);
    if (r < r0 * 0.72 || r > r0 * 1.18) continue;

    const tempDiff = b.meanTempK - ambientTempK;
    if (cfg.thermalFeedbackEnabled && Math.abs(tempDiff) > 4.0) {
      const dC = clamp(tempDiff * 0.85 * cfg.thermalGain, -45, 360);
      if (dC > peakDeltaC) peakDeltaC = dC;
      if (Math.abs(dC) > 4.0) {
        thermalCands.push({ wx, wy, wz, deltaC: dC });
      }
    }

    if (
      cfg.mineralizationEnabled &&
      b.meanAutocatalystX > cfg.mineralThresholdConc &&
      b.mineralAccum > 0.35
    ) {
      const dens = planet.sampleDensity(wx, wy, wz, true);
      if (Math.abs(dens) <= Math.max(voxelSize * 3.0, planet.voxelSize * 1.8)) {
        minCands.push({
          wx,
          wy,
          wz,
          score: b.mineralAccum * cfg.mineralizationRate,
          reason: tempDiff > 45 ? 'mineral_basalt' : 'mineral_crystal',
        });
      }
    }
  }

  thermalCands.sort((a, b) => Math.abs(b.deltaC) - Math.abs(a.deltaC));
  for (let i = 0; i < thermalCands.length && hotspots.length < 6; i++) {
    const c = thermalCands[i];
    hotspots.push({
      x: c.wx,
      y: c.wy,
      z: c.wz,
      radius: Math.max(planet.voxelSize * 2.5, r0 * 0.24),
      deltaC: c.deltaC,
      decayPerSec: 0,
      source: 'metabolism',
    });
  }

  minCands.sort((a, b) => b.score - a.score);
  const brushRad = clamp(planet.voxelSize * 1.4, 0.45, r0 * 0.14);
  for (let i = 0; i < minCands.length && mineralOps.length < 4; i++) {
    const m = minCands[i];
    mineralOps.push({
      wx: m.wx,
      wy: m.wy,
      wz: m.wz,
      radius: brushRad,
      mode: m.reason === 'mineral_basalt' ? 'paint' : 'build',
      strength: m.reason === 'mineral_basalt' ? 0.72 : 0.22,
      material: m.reason === 'mineral_basalt' ? MaterialId.Basalt : MaterialId.Crystal,
      reason: m.reason,
    });
  }

  return { hotspots, mineralOps, peakDeltaC };
}

/**
 * Refreshes local FVM porosity & active control-volume masks around a sculpted brush region.
 */
export function syncLocalBrushToCpuFvmGrid(
  grid: EulerianFvmGrid,
  planet: VoxelPlanet,
  wx: number,
  wy: number,
  wz: number,
  radius: number,
): number {
  const n = grid.cellsPerAxis;
  const effRad = Math.max(radius + grid.voxelSize, grid.voxelSize * 1.5);
  const radSq = effRad * effRad;
  const minShellR = planet.baseRadius * 0.62;
  const maxShellR = planet.baseRadius * 1.22;

  const minX = Math.max(0, Math.floor((wx - effRad + grid.worldHalf) / grid.voxelSize));
  const maxX = Math.min(n - 1, Math.floor((wx + effRad + grid.worldHalf) / grid.voxelSize));
  const minY = Math.max(0, Math.floor((wy - effRad + grid.worldHalf) / grid.voxelSize));
  const maxY = Math.min(n - 1, Math.floor((wy + effRad + grid.worldHalf) / grid.voxelSize));
  const minZ = Math.max(0, Math.floor((wz - effRad + grid.worldHalf) / grid.voxelSize));
  const maxZ = Math.min(n - 1, Math.floor((wz + effRad + grid.worldHalf) / grid.voxelSize));

  let updated = 0;
  for (let iz = minZ; iz <= maxZ; iz++) {
    const cz = -grid.worldHalf + (iz + 0.5) * grid.voxelSize;
    for (let iy = minY; iy <= maxY; iy++) {
      const cy = -grid.worldHalf + (iy + 0.5) * grid.voxelSize;
      for (let ix = minX; ix <= maxX; ix++) {
        const cx = -grid.worldHalf + (ix + 0.5) * grid.voxelSize;
        const dSq = (cx - wx) ** 2 + (cy - wy) ** 2 + (cz - wz) ** 2;
        if (dSq > radSq) continue;

        const r = Math.hypot(cx, cy, cz);
        const idx = grid.cellIndex(ix, iy, iz);
        if (r < minShellR || r > maxShellR) continue;

        const dens = planet.sampleDensity(cx, cy, cz, true);
        const mat = planet.sampleNearestMaterial(cx, cy, cz);
        const openAir = dens <= 0;
        const nearSurface = Math.abs(dens) < grid.voxelSize * 2.2;
        const nextPor = openAir
          ? 1.0
          : nearSurface
            ? 0.65
            : mat === MaterialId.Crystal || mat === MaterialId.Sandstone
              ? 0.45
              : 0.22;

        grid.activeMask[idx] = 1;
        grid.porosity[idx] = nextPor;
        updated++;
      }
    }
  }
  if (updated > 0) {
    grid.rebuildActiveCellList();
    grid.revision++;
  }
  return updated;
}
