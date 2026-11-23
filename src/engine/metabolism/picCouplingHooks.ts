// Particle-in-Cell (PIC) Multi-Scale Coupling Domain Hooks for 《Metabolism》
// Architecture constraint:
// - Global primary simulation framework is ALWAYS the Eulerian Finite Volume Flux Field + Reaction Hypergraph.
// - Rejects bottom-up all-atom reductionism as main loop.
// - Reserves AABB coupling zone markers and coarse-graining / fine-graining interface signatures ONLY.
// - Does NOT implement Molecular Dynamics (MD), protein folding, or cellular agent logic at this stage.

import { EulerianFvmGrid } from './eulerianFvm';
import { CompiledReactionHypergraph } from './reactionHypergraph';

export type LagrangianScalePluginKind =
  | 'molecular_md_calibration'
  | 'cellular_agent_stub'
  | 'sph_fluid_interface';

export interface LagrangianCouplingZone {
  readonly id: string;
  readonly label: string;
  readonly scaleKind: LagrangianScalePluginKind;
  readonly aabbMin: readonly [number, number, number];
  readonly aabbMax: readonly [number, number, number];
  readonly active: boolean;
  readonly description: string;
  lastSampledSimStep: number;
  lastCalibrationSimStep: number;
}

/**
 * Fine-graining output (细粒化输出: Eulerian Macro FVM -> Lagrangian AABB Boundary Conditions).
 * Provides boundary temperature, pressure, advection velocity, concentrations, and spatial gradients
 * to a future micro-scale Lagrangian plugin (without running any MD solver here).
 */
export interface LagrangianBoundaryState {
  readonly zoneId: string;
  readonly simStep: number;
  readonly simTimeSec: number;
  readonly sampledVoxCount: number;
  readonly meanTempK: number;
  readonly meanPressureAtm: number;
  readonly meanVelocityMs: readonly [number, number, number];
  readonly meanFluxKgM2s: readonly [number, number, number];
  readonly speciesConcentrationsMolM3: Float64Array;
  readonly speciesGradientsMolM4: ReadonlyArray<readonly [number, number, number]>;
}

/**
 * Micro-scale observables produced by a future Lagrangian close-up plugin
 * (e.g. local MD run inside the marked AABB used solely for kinetic parameter calibration).
 */
export interface CoarseGrainedObservables {
  readonly zoneId: string;
  readonly microSampleSteps: number;
  /** Measured effective diffusivity multipliers per species index */
  readonly effectiveDiffusivityScale?: Float64Array;
  /** Calibrated macroscopic Arrhenius parameters per reaction index */
  readonly calibratedArrhenius?: ReadonlyArray<{
    readonly reactionIndex: number;
    readonly effectiveForwardA: number;
    readonly effectiveForwardEaJ: number;
  }>;
  readonly measuredStressPa?: readonly [number, number, number];
}

/**
 * Coarse-graining output (粗粒化输出: Micro Observables -> Macro Eulerian FVM Kinetic Calibration).
 */
export interface KineticCalibrationPatch {
  readonly zoneId: string;
  readonly appliedAtSimStep: number;
  readonly diffusivityScaleApplied: Float64Array;
  readonly reactionCalibrationsApplied: ReadonlyArray<{
    readonly reactionIndex: number;
    readonly effectiveForwardA: number;
    readonly effectiveForwardEaJ: number;
  }>;
}

/** Fine-graining interface signature: Macro Eulerian Field -> Micro AABB Boundary State */
export interface IFineGrainingHook {
  fineGrainToLagrangian(
    zone: LagrangianCouplingZone,
    fvmGrid: EulerianFvmGrid,
    hypergraph: CompiledReactionHypergraph,
  ): LagrangianBoundaryState;
}

/** Coarse-graining interface signature: Micro Observables -> Macro Hypergraph Calibration */
export interface ICoarseGrainingHook {
  coarseGrainToEulerian(
    zone: LagrangianCouplingZone,
    observables: CoarseGrainedObservables,
    hypergraph: CompiledReactionHypergraph,
  ): KineticCalibrationPatch;
}

export interface IPicCouplingBridge extends IFineGrainingHook, ICoarseGrainingHook {
  registerZone(zone: Omit<LagrangianCouplingZone, 'lastSampledSimStep' | 'lastCalibrationSimStep'>): LagrangianCouplingZone;
  unregisterZone(zoneId: string): boolean;
  listZones(): ReadonlyArray<LagrangianCouplingZone>;
  isPointInCouplingZone(wx: number, wy: number, wz: number): LagrangianCouplingZone | null;
}

/**
 * Default Eulerian-side PIC Coupling Hook Registry.
 * Strictly samples Eulerian Vox control volumes inside marked AABBs and applies
 * coarse-grained kinetic calibration patches—zero MD particle execution.
 */
export class PicCouplingRegistry implements IPicCouplingBridge {
  private readonly zones = new Map<string, LagrangianCouplingZone>();

  public registerZone(
    zone: Omit<LagrangianCouplingZone, 'lastSampledSimStep' | 'lastCalibrationSimStep'>,
  ): LagrangianCouplingZone {
    const entry: LagrangianCouplingZone = {
      ...zone,
      aabbMin: [
        Math.min(zone.aabbMin[0], zone.aabbMax[0]),
        Math.min(zone.aabbMin[1], zone.aabbMax[1]),
        Math.min(zone.aabbMin[2], zone.aabbMax[2]),
      ],
      aabbMax: [
        Math.max(zone.aabbMin[0], zone.aabbMax[0]),
        Math.max(zone.aabbMin[1], zone.aabbMax[1]),
        Math.max(zone.aabbMin[2], zone.aabbMax[2]),
      ],
      lastSampledSimStep: -1,
      lastCalibrationSimStep: -1,
    };
    this.zones.set(entry.id, entry);
    return entry;
  }

  public unregisterZone(zoneId: string): boolean {
    return this.zones.delete(zoneId);
  }

  public clear(): void {
    this.zones.clear();
  }

  public listZones(): ReadonlyArray<LagrangianCouplingZone> {
    return Array.from(this.zones.values());
  }

  public isPointInCouplingZone(wx: number, wy: number, wz: number): LagrangianCouplingZone | null {
    for (const z of this.zones.values()) {
      if (!z.active) continue;
      if (
        wx >= z.aabbMin[0] &&
        wx <= z.aabbMax[0] &&
        wy >= z.aabbMin[1] &&
        wy <= z.aabbMax[1] &&
        wz >= z.aabbMin[2] &&
        wz <= z.aabbMax[2]
      ) {
        return z;
      }
    }
    return null;
  }

  public fineGrainToLagrangian(
    zone: LagrangianCouplingZone,
    fvmGrid: EulerianFvmGrid,
    hypergraph: CompiledReactionHypergraph,
  ): LagrangianBoundaryState {
    const n = fvmGrid.cellsPerAxis;
    const S = hypergraph.numSpecies;
    const meanConc = new Float64Array(S);
    const gradSums: Array<[number, number, number]> = Array.from({ length: S }, () => [0, 0, 0]);

    let count = 0;
    let sumT = 0;
    let sumP = 0;
    let sumVx = 0;
    let sumVy = 0;
    let sumVz = 0;
    let sumFx = 0;
    let sumFy = 0;
    let sumFz = 0;

    const inv2h = 0.5 / Math.max(1e-6, fvmGrid.voxelSize);

    for (let iz = 0; iz < n; iz++) {
      const wz = -fvmGrid.worldHalf + (iz + 0.5) * fvmGrid.voxelSize;
      if (wz < zone.aabbMin[2] || wz > zone.aabbMax[2]) continue;
      for (let iy = 0; iy < n; iy++) {
        const wy = -fvmGrid.worldHalf + (iy + 0.5) * fvmGrid.voxelSize;
        if (wy < zone.aabbMin[1] || wy > zone.aabbMax[1]) continue;
        for (let ix = 0; ix < n; ix++) {
          const wx = -fvmGrid.worldHalf + (ix + 0.5) * fvmGrid.voxelSize;
          if (wx < zone.aabbMin[0] || wx > zone.aabbMax[0]) continue;
          const idx = fvmGrid.cellIndex(ix, iy, iz);
          if (fvmGrid.activeMask[idx] === 0) continue;

          count++;
          sumT += fvmGrid.temperatureK[idx];
          sumP += fvmGrid.pressureAtm[idx];
          sumVx += fvmGrid.velX[idx];
          sumVy += fvmGrid.velY[idx];
          sumVz += fvmGrid.velZ[idx];
          sumFx += fvmGrid.fluxX[idx];
          sumFy += fvmGrid.fluxY[idx];
          sumFz += fvmGrid.fluxZ[idx];

          const base = idx * S;
          const ixL = Math.max(0, ix - 1);
          const ixR = Math.min(n - 1, ix + 1);
          const iyL = Math.max(0, iy - 1);
          const iyR = Math.min(n - 1, iy + 1);
          const izL = Math.max(0, iz - 1);
          const izR = Math.min(n - 1, iz + 1);

          for (let s = 0; s < S; s++) {
            meanConc[s] += fvmGrid.speciesConc[base + s];
            const gx =
              (fvmGrid.speciesConc[fvmGrid.cellIndex(ixR, iy, iz) * S + s] -
                fvmGrid.speciesConc[fvmGrid.cellIndex(ixL, iy, iz) * S + s]) *
              inv2h;
            const gy =
              (fvmGrid.speciesConc[fvmGrid.cellIndex(ix, iyR, iz) * S + s] -
                fvmGrid.speciesConc[fvmGrid.cellIndex(ix, iyL, iz) * S + s]) *
              inv2h;
            const gz =
              (fvmGrid.speciesConc[fvmGrid.cellIndex(ix, iy, izR) * S + s] -
                fvmGrid.speciesConc[fvmGrid.cellIndex(ix, iy, izL) * S + s]) *
              inv2h;
            gradSums[s][0] += gx;
            gradSums[s][1] += gy;
            gradSums[s][2] += gz;
          }
        }
      }
    }

    const denom = Math.max(1, count);
    for (let s = 0; s < S; s++) {
      meanConc[s] /= denom;
      gradSums[s][0] /= denom;
      gradSums[s][1] /= denom;
      gradSums[s][2] /= denom;
    }

    zone.lastSampledSimStep = fvmGrid.stepIndex;

    return {
      zoneId: zone.id,
      simStep: fvmGrid.stepIndex,
      simTimeSec: fvmGrid.simTimeSec,
      sampledVoxCount: count,
      meanTempK: count > 0 ? sumT / count : fvmGrid.ambientTempK,
      meanPressureAtm: count > 0 ? sumP / count : fvmGrid.ambientPressureAtm,
      meanVelocityMs: [sumVx / denom, sumVy / denom, sumVz / denom],
      meanFluxKgM2s: [sumFx / denom, sumFy / denom, sumFz / denom],
      speciesConcentrationsMolM3: meanConc,
      speciesGradientsMolM4: gradSums,
    };
  }

  public coarseGrainToEulerian(
    zone: LagrangianCouplingZone,
    observables: CoarseGrainedObservables,
    hypergraph: CompiledReactionHypergraph,
  ): KineticCalibrationPatch {
    const S = hypergraph.numSpecies;
    const diffusivityScaleApplied = new Float64Array(S).fill(1.0);

    if (observables.effectiveDiffusivityScale) {
      for (let s = 0; s < Math.min(S, observables.effectiveDiffusivityScale.length); s++) {
        const scale = Math.max(0.05, Math.min(20.0, observables.effectiveDiffusivityScale[s]));
        hypergraph.calibratedDiffusivityScale[s] = scale;
        diffusivityScaleApplied[s] = scale;
      }
    }

    const appliedRxns: Array<{
      reactionIndex: number;
      effectiveForwardA: number;
      effectiveForwardEaJ: number;
    }> = [];

    if (observables.calibratedArrhenius) {
      for (const item of observables.calibratedArrhenius) {
        const r = item.reactionIndex;
        if (r >= 0 && r < hypergraph.numReactions) {
          const effA = Math.max(0, item.effectiveForwardA);
          const effEa = Math.max(0, item.effectiveForwardEaJ);
          hypergraph.calibratedForwardA[r] = effA;
          hypergraph.calibratedForwardEaJ[r] = effEa;
          appliedRxns.push({
            reactionIndex: r,
            effectiveForwardA: effA,
            effectiveForwardEaJ: effEa,
          });
        }
      }
    }

    zone.lastCalibrationSimStep = Math.max(zone.lastCalibrationSimStep, zone.lastSampledSimStep);

    return {
      zoneId: zone.id,
      appliedAtSimStep: zone.lastSampledSimStep,
      diffusivityScaleApplied,
      reactionCalibrationsApplied: appliedRxns,
    };
  }
}
