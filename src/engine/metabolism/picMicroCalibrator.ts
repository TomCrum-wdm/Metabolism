// PIC AABB Local Micro-Scale Calibrator for 《Metabolism》
// Architecture strictly enforced:
// - Global primary loop remains the Eulerian Finite Volume Flux Field + Reaction Hypergraph.
// - Runs short-timescale coarse-grained Langevin Brownian + bimolecular collision sampling
//   STRICTLY inside a registered LagrangianCouplingZone AABB (zero global MD, zero persistent particles).
// - Outputs measured effective diffusivity multipliers & calibrated Arrhenius (A_eff, Ea_eff)
//   pushed back through PicCouplingRegistry.coarseGrainToEulerian().

import { EulerianFvmGrid } from './eulerianFvm';
import {
  CoarseGrainedObservables,
  KineticCalibrationPatch,
  LagrangianBoundaryState,
  LagrangianCouplingZone,
  PicCouplingRegistry,
} from './picCouplingHooks';
import { CompiledReactionHypergraph, GAS_CONSTANT_R } from './reactionHypergraph';

export interface MicroCalibrationConfig {
  readonly particleCount: number;
  readonly microSteps: number;
  readonly microDtSec: number;
  readonly seed?: number;
}

export const DEFAULT_MICRO_CALIBRATION_CONFIG: MicroCalibrationConfig = {
  particleCount: 768,
  microSteps: 48,
  microDtSec: 0.0025,
};

export interface MicroCalibrationReactionDelta {
  readonly reactionIndex: number;
  readonly reactionLabel: string;
  readonly baseA: number;
  readonly calibratedA: number;
  readonly baseEaJ: number;
  readonly calibratedEaJ: number;
}

export interface MicroCalibrationRecord {
  readonly zoneId: string;
  readonly zoneLabel: string;
  readonly executedAtSimStep: number;
  readonly particleCount: number;
  readonly microSteps: number;
  readonly durationMs: number;
  readonly meanTempK: number;
  readonly meanPressureAtm: number;
  readonly meanPorosity: number;
  readonly msdHinderedOverFree: number;
  readonly stericCrowdingFactor: number;
  readonly collisionEvents: number;
  readonly reactionEvents: number;
  readonly diffusivityMultipliers: ReadonlyArray<number>;
  readonly reactionDeltas: ReadonlyArray<MicroCalibrationReactionDelta>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sampleMeanPorosityInZone(zone: LagrangianCouplingZone, grid: EulerianFvmGrid): number {
  const n = grid.cellsPerAxis;
  let sumPor = 0;
  let count = 0;
  for (let iz = 0; iz < n; iz++) {
    const wz = -grid.worldHalf + (iz + 0.5) * grid.voxelSize;
    if (wz < zone.aabbMin[2] || wz > zone.aabbMax[2]) continue;
    for (let iy = 0; iy < n; iy++) {
      const wy = -grid.worldHalf + (iy + 0.5) * grid.voxelSize;
      if (wy < zone.aabbMin[1] || wy > zone.aabbMax[1]) continue;
      for (let ix = 0; ix < n; ix++) {
        const wx = -grid.worldHalf + (ix + 0.5) * grid.voxelSize;
        if (wx < zone.aabbMin[0] || wx > zone.aabbMax[0]) continue;
        const idx = grid.cellIndex(ix, iy, iz);
        if (grid.activeMask[idx] === 0) continue;
        sumPor += grid.porosity[idx];
        count++;
      }
    }
  }
  return count > 0 ? clamp(sumPor / count, 0.1, 1.0) : 0.65;
}

/**
 * Executes a self-contained ephemeral micro-scale Langevin + collisional calibration run
 * strictly bounded inside the given AABB zone. Discards micro particles immediately after
 * extracting coarse-grained kinetic parameters for the Eulerian Reaction Hypergraph.
 */
export function runLocalMicroCalibration(
  zone: LagrangianCouplingZone,
  registry: PicCouplingRegistry,
  fvmGrid: EulerianFvmGrid,
  hypergraph: CompiledReactionHypergraph,
  config: MicroCalibrationConfig = DEFAULT_MICRO_CALIBRATION_CONFIG,
): {
  boundary: LagrangianBoundaryState;
  observables: CoarseGrainedObservables;
  patch: KineticCalibrationPatch;
  record: MicroCalibrationRecord;
} {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // 1. Fine-graining: extract Eulerian boundary T, P, v, C, gradC inside AABB
  const boundary = registry.fineGrainToLagrangian(zone, fvmGrid, hypergraph);
  const meanPorosity = sampleMeanPorosityInZone(zone, fvmGrid);

  const particleCount = clamp(Math.round(config.particleCount), 64, 4096);
  const microSteps = clamp(Math.round(config.microSteps), 12, 200);
  const microDt = clamp(config.microDtSec, 1e-4, 0.02);

  const seedBase =
    config.seed ?? ((fvmGrid.stepIndex + 17) * 73856093) ^ Math.round(boundary.meanTempK * 19349663);
  const rng = mulberry32(seedBase);

  // Ephemeral particle buffers (discarded immediately on return; zero persistent particle state)
  const px = new Float32Array(particleCount);
  const py = new Float32Array(particleCount);
  const pz = new Float32Array(particleCount);
  const x0 = new Float32Array(particleCount);
  const y0 = new Float32Array(particleCount);
  const z0 = new Float32Array(particleCount);
  const speciesTag = new Uint8Array(particleCount);

  const S = hypergraph.numSpecies;
  let concSum = 0;
  for (let s = 0; s < S; s++) concSum += Math.max(0, boundary.speciesConcentrationsMolM3[s] ?? 0);
  const cdf: number[] = [];
  let acc = 0;
  for (let s = 0; s < S; s++) {
    acc += concSum > 1e-6 ? Math.max(0, boundary.speciesConcentrationsMolM3[s]) / concSum : 1 / S;
    cdf.push(acc);
  }

  for (let i = 0; i < particleCount; i++) {
    const ux = rng();
    const uy = rng();
    const uz = rng();
    px[i] = ux;
    py[i] = uy;
    pz[i] = uz;
    x0[i] = ux;
    y0[i] = uy;
    z0[i] = uz;
    const u = rng();
    let tag = S - 1;
    for (let s = 0; s < S; s++) {
      if (u <= cdf[s]) {
        tag = s;
        break;
      }
    }
    speciesTag[i] = tag;
  }

  // Generate 6 porous spherical solid matrix grains matching (1 - porosity) obstacle volume
  const grainRadius = clamp(Math.cbrt((1 - meanPorosity) * 0.12), 0.06, 0.28);
  const grains: Array<[number, number, number]> = [
    [0.24, 0.28, 0.26],
    [0.74, 0.24, 0.72],
    [0.28, 0.76, 0.71],
    [0.72, 0.72, 0.25],
    [0.5, 0.48, 0.52],
    [0.48, 0.18, 0.82],
  ];
  const grainRadSq = grainRadius * grainRadius;

  // Thermal diffusivity scaling sqrt(T / 300) and advection bias inside unit micro-domain
  const tempScale = Math.sqrt(Math.max(0.4, boundary.meanTempK / 300.0));
  const noiseAmp = Math.sqrt(2 * 0.085 * tempScale * microDt);
  const driftX = clamp(boundary.meanVelocityMs[0] * 0.15, -0.4, 0.4) * microDt;
  const driftY = clamp(boundary.meanVelocityMs[1] * 0.15, -0.4, 0.4) * microDt;
  const driftZ = clamp(boundary.meanVelocityMs[2] * 0.15, -0.4, 0.4) * microDt;

  let msdFreeSum = 0;
  let msdHinderedSum = 0;
  let obstacleCollisions = 0;
  let reactiveEncounters = 0;

  // Track gradient-driven collision probability enhancement
  let gradNormSum = 0;
  for (let s = 0; s < S; s++) {
    const g = boundary.speciesGradientsMolM4[s] ?? [0, 0, 0];
    gradNormSum += Math.hypot(g[0], g[1], g[2]);
  }
  const crowdingCoeff = clamp(concSum / 3.5, 0.05, 1.4);
  const captureDistSq = Math.pow(0.055 * (1 + clamp(boundary.meanPressureAtm * 0.08, 0, 0.35)), 2);

  for (let step = 0; step < microSteps; step++) {
    for (let i = 0; i < particleCount; i++) {
      // Box-Muller approximate fast normal step via sum-of-3 uniform
      const nx = (rng() + rng() + rng() - 1.5) * 2.0 * noiseAmp + driftX;
      const ny = (rng() + rng() + rng() - 1.5) * 2.0 * noiseAmp + driftY;
      const nz = (rng() + rng() + rng() - 1.5) * 2.0 * noiseAmp + driftZ;

      msdFreeSum += nx * nx + ny * ny + nz * nz;

      let candX = px[i] + nx;
      let candY = py[i] + ny;
      let candZ = pz[i] + nz;

      // Reflective micro-cell boundaries
      if (candX < 0) candX = -candX;
      else if (candX > 1) candX = 2 - candX;
      if (candY < 0) candY = -candY;
      else if (candY > 1) candY = 2 - candY;
      if (candZ < 0) candZ = -candZ;
      else if (candZ > 1) candZ = 2 - candZ;

      // Tortuous obstacle reflection from solid matrix grains
      let blocked = false;
      for (let g = 0; g < grains.length; g++) {
        const gr = grains[g];
        const dx = candX - gr[0];
        const dy = candY - gr[1];
        const dz = candZ - gr[2];
        if (dx * dx + dy * dy + dz * dz < grainRadSq) {
          blocked = true;
          obstacleCollisions++;
          break;
        }
      }

      if (!blocked) {
        const sx = candX - px[i];
        const sy = candY - py[i];
        const sz = candZ - pz[i];
        msdHinderedSum += sx * sx + sy * sy + sz * sz;
        px[i] = candX;
        py[i] = cyClamp(candY);
        pz[i] = cyClamp(candZ);
      }
    }

    // Strided local pair encounter counting (O(N * 12) tiny fixed neighbor check)
    for (let i = 0; i < particleCount; i += 4) {
      for (let j = 1; j <= 10; j++) {
        const partner = (i + j) % particleCount;
        if (speciesTag[i] === speciesTag[partner]) continue;
        const dx = px[i] - px[partner];
        const dy = py[i] - py[partner];
        const dz = pz[i] - pz[partner];
        if (dx * dx + dy * dy + dz * dz < captureDistSq) {
          // Local Arrhenius Boltzmann encounter acceptance
          const pAttempt = Math.exp(-1200 / (GAS_CONSTANT_R * Math.max(120, boundary.meanTempK)));
          if (rng() < pAttempt) {
            reactiveEncounters++;
          }
        }
      }
    }
  }

  // Extract coarse-grained effective diffusivity multipliers & Arrhenius parameter shifts
  const msdRatio = clamp(msdHinderedSum / Math.max(1e-9, msdFreeSum), 0.18, 1.45);
  const stericHindrance = clamp(
    1.0 - crowdingCoeff * 0.18 + Math.min(0.28, gradNormSum * 0.09),
    0.55,
    1.55,
  );

  const effectiveDiffusivityScale = new Float64Array(S);
  for (let s = 0; s < S; s++) {
    // Heavier/autocatalytic species experience stronger tortuosity & crowding renormalization
    const roleFactor = hypergraph.species[s].role === 'autocatalyst' ? 1.06 : 0.96;
    effectiveDiffusivityScale[s] = clamp(msdRatio * roleFactor * (0.9 + 0.25 * meanPorosity), 0.2, 2.2);
  }

  const reactionDeltas: MicroCalibrationReactionDelta[] = [];
  const calibratedArrhenius = hypergraph.reactions.map((rxn, rIdx) => {
    const encounterBias = clamp(1.0 + (reactiveEncounters / Math.max(1, particleCount)) * 0.45, 0.85, 1.45);
    const calibratedA = clamp(
      rxn.forwardA * stericHindrance * encounterBias,
      rxn.forwardA * 0.45,
      rxn.forwardA * 2.1,
    );
    // Pressure + local porous confinement modestly lower/shift activation barrier (catalytic wall effect)
    const confinementShift = clamp(
      (1 - meanPorosity) * -260 + crowdingCoeff * 140 - Math.min(180, boundary.meanPressureAtm * 18),
      -420,
      380,
    );
    const calibratedEaJ = Math.max(400, Math.round(rxn.forwardEaJ + confinementShift));
    reactionDeltas.push({
      reactionIndex: rIdx,
      reactionLabel: rxn.uiEquationLabel,
      baseA: rxn.forwardA,
      calibratedA,
      baseEaJ: rxn.forwardEaJ,
      calibratedEaJ,
    });
    return {
      reactionIndex: rIdx,
      effectiveForwardA: calibratedA,
      effectiveForwardEaJ: calibratedEaJ,
    };
  });

  const observables: CoarseGrainedObservables = {
    zoneId: zone.id,
    microSampleSteps: microSteps,
    effectiveDiffusivityScale,
    calibratedArrhenius,
  };

  // Commit calibrated macroscopic parameters via PIC coarse-graining hook
  const patch = registry.coarseGrainToEulerian(zone, observables, hypergraph);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const record: MicroCalibrationRecord = {
    zoneId: zone.id,
    zoneLabel: zone.label,
    executedAtSimStep: fvmGrid.stepIndex,
    particleCount,
    microSteps,
    durationMs: Math.max(0.05, t1 - t0),
    meanTempK: boundary.meanTempK,
    meanPressureAtm: boundary.meanPressureAtm,
    meanPorosity,
    msdHinderedOverFree: msdRatio,
    stericCrowdingFactor: stericHindrance,
    collisionEvents: obstacleCollisions,
    reactionEvents: reactiveEncounters,
    diffusivityMultipliers: Array.from(patch.diffusivityScaleApplied),
    reactionDeltas,
  };

  return { boundary, observables, patch, record };
}

function cyClamp(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
