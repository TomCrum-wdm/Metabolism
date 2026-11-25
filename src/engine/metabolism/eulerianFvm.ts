// Eulerian Finite Volume Method (FVM) Control-Volume Grid for 《Metabolism》
// Reuses TerraSphere's Chunk (8x8x8) / Vox (cellsPerAxis^3) topology, upgrading
// graphical voxels into conservative Eulerian control volumes carrying:
//   - speciesConc (组分浓度, mol/m^3)
//   - internalEnergy (内能, J/m^3)
//   - fluxX, fluxY, fluxZ (通量, interfacial conservative transport vector)
//   - phase (相态字段: Solid / Liquid / Gas / Plasma / Supercritical)

export const FVM_CHUNK_CELLS = 8;
const CHUNK_CELLS = FVM_CHUNK_CELLS;

import {
  CellReactionStepResult,
  CompiledReactionHypergraph,
  integrateCellReactions,
} from './reactionHypergraph';

export enum MatterPhase {
  Solid = 0,
  Liquid = 1,
  Gas = 2,
  Plasma = 3,
  Supercritical = 4,
}

export const MATTER_PHASE_LABELS: Record<MatterPhase, string> = {
  [MatterPhase.Solid]: '固态 (Solid)',
  [MatterPhase.Liquid]: '液态 (Liquid)',
  [MatterPhase.Gas]: '气态 (Gas)',
  [MatterPhase.Plasma]: '等离子态 (Plasma)',
  [MatterPhase.Supercritical]: '超临界态 (Supercritical)',
};

export type SystemBoundaryMode = 'closed' | 'open';

export interface VoxControlVolume {
  readonly cellIndex: number;
  readonly ix: number;
  readonly iy: number;
  readonly iz: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly worldPos: [number, number, number];
  readonly active: boolean;
  readonly porosity: number;
  readonly speciesConc: Float32Array;
  readonly internalEnergy: number;
  readonly temperatureK: number;
  readonly pressureAtm: number;
  readonly flux: [number, number, number];
  readonly velocity: [number, number, number];
  readonly phase: MatterPhase;
  readonly entropyProdRate: number;
}

export interface MassConservationAudit {
  readonly stepIndex: number;
  readonly simTimeSec: number;
  readonly totalMassPreKg: number;
  readonly boundaryFeedMassKg: number;
  readonly boundaryExhaustMassKg: number;
  readonly boundaryNetMassKg: number;
  readonly totalMassPostFluxKg: number;
  readonly totalMassPostReactKg: number;
  readonly fluxMassResidualKg: number;
  readonly reactionMassResidualKg: number;
  readonly totalMassBalanceResidualKg: number;
  readonly relativeError: number;
  readonly conserved: boolean;
}

export interface FvmStepTelemetry {
  readonly stepIndex: number;
  readonly simTimeSec: number;
  readonly boundaryMode: SystemBoundaryMode;
  readonly activeCellCount: number;
  readonly totalSpeciesMoles: Float64Array;
  readonly meanConcentrations: Float64Array;
  readonly speciesSpatialStdDev: Float64Array;
  readonly totalInternalEnergyJ: number;
  readonly meanTempK: number;
  readonly totalEntropyProdRate: number;
  readonly phaseCounts: Record<MatterPhase, number>;
  readonly meanFluxMagnitude: number;
  readonly meanReactionRates: Float64Array;
  readonly conservation: MassConservationAudit;
}

export interface FvmRenderFieldView {
  readonly revision: number;
  readonly cellsPerAxis: number;
  readonly chunksPerAxis: number;
  readonly worldHalf: number;
  readonly voxelSize: number;
  readonly numSpecies: number;
  readonly speciesColors: ReadonlyArray<readonly [number, number, number]>;
  readonly speciesConc: Float32Array;
  readonly internalEnergy: Float32Array;
  readonly temperatureK: Float32Array;
  readonly fluxX: Float32Array;
  readonly fluxY: Float32Array;
  readonly fluxZ: Float32Array;
  readonly porosity: Float32Array;
  readonly entropyProdRate: Float32Array;
  readonly phase: Uint8Array;
  readonly activeMask: Uint8Array;
}

export interface FvmGridOptions {
  chunksPerAxis: number;
  worldHalf: number;
  baseRadius: number;
  hypergraph: CompiledReactionHypergraph;
  boundaryMode: SystemBoundaryMode;
  feedRatePerSec?: number;
  exhaustRatePerSec?: number;
  feedSpeciesIndex?: number;
  feedConcentrationMolM3?: number;
  ambientTempK?: number;
  ambientPressureAtm?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Classifies local thermodynamic MatterPhase from temperature, pressure, and solid fraction.
 */
export function classifyMatterPhase(
  tempK: number,
  pressureAtm: number,
  porosity: number,
): MatterPhase {
  if (tempK >= 3200) return MatterPhase.Plasma;
  if (tempK >= 647 && pressureAtm >= 25) return MatterPhase.Supercritical;
  if (porosity < 0.15 && tempK < 1150) return MatterPhase.Solid;
  if (tempK < 273.15 && pressureAtm < 120) return MatterPhase.Solid;
  const boilingK = 373.15 + Math.max(0, Math.log1p(Math.max(0, pressureAtm - 1)) * 68);
  if (tempK >= boilingK) return MatterPhase.Gas;
  return MatterPhase.Liquid;
}

export class EulerianFvmGrid {
  public readonly chunkCells = CHUNK_CELLS;
  public readonly chunksPerAxis: number;
  public readonly cellsPerAxis: number;
  public readonly totalCells: number;
  public readonly worldHalf: number;
  public readonly voxelSize: number;
  public readonly cellVolumeM3: number;
  public readonly faceAreaM2: number;
  public readonly baseRadius: number;

  public hypergraph: CompiledReactionHypergraph;
  public boundaryMode: SystemBoundaryMode;
  public feedRatePerSec: number;
  public exhaustRatePerSec: number;
  public feedSpeciesIndex: number;
  public feedConcentrationMolM3: number;
  public ambientTempK: number;
  public ambientPressureAtm: number;

  // Core upgraded Vox Eulerian Finite Volume Control-Volume Fields (SoA)
  public readonly speciesConc: Float32Array; // [totalCells * numSpecies] (组分浓度 mol/m^3)
  public readonly internalEnergy: Float32Array; // [totalCells] (内能 J/m^3)
  public readonly fluxX: Float32Array; // [totalCells] (通量 X, kg/(m^2*s))
  public readonly fluxY: Float32Array; // [totalCells] (通量 Y, kg/(m^2*s))
  public readonly fluxZ: Float32Array; // [totalCells] (通量 Z, kg/(m^2*s))
  public readonly phase: Uint8Array; // [totalCells] (相态 MatterPhase)

  // Coupled transport & thermodynamic state fields per Vox
  public readonly temperatureK: Float32Array;
  public readonly pressureAtm: Float32Array;
  public readonly porosity: Float32Array; // [0..1] permeable fluid/reaction volume fraction
  public readonly velX: Float32Array;
  public readonly velY: Float32Array;
  public readonly velZ: Float32Array;
  public readonly entropyProdRate: Float32Array;

  // Active control-volume masks (1 = active Eulerian fluid/reactive Vox, 0 = excluded/impermeable)
  public readonly activeMask: Uint8Array;
  public readonly feedPortMask: Uint8Array;
  public readonly exhaustPortMask: Uint8Array;
  private activeCellList: Int32Array;
  private activeCellCount = 0;

  // Scratch buffers for strict conservative operator splitting (zero per-step allocations)
  private readonly nextSpeciesConc: Float32Array;
  private readonly nextInternalEnergy: Float32Array;
  private readonly rxnStepOut: CellReactionStepResult = {
    deltaInternalEnergyJm3: 0,
    entropyProductionRate: 0,
    activeReactionCount: 0,
    totalTurnoverRate: 0,
  };
  private readonly _cellRxnRates: Float64Array;
  private readonly _meanRxnRatesAccum: Float64Array;

  public stepIndex = 0;
  public simTimeSec = 0;
  public revision = 0;
  public lastTelemetry: FvmStepTelemetry;

  // Double-buffered read-only snapshot for decoupled renderer
  private readonly renderConcCopy: Float32Array;
  private readonly renderEnergyCopy: Float32Array;
  private readonly renderTempCopy: Float32Array;
  private readonly renderFluxXCopy: Float32Array;
  private readonly renderFluxYCopy: Float32Array;
  private readonly renderFluxZCopy: Float32Array;
  private readonly renderPorosityCopy: Float32Array;
  private readonly renderEntropyCopy: Float32Array;
  private readonly renderPhaseCopy: Uint8Array;
  private readonly renderActiveCopy: Uint8Array;
  private renderRevision = 0;

  constructor(opts: FvmGridOptions) {
    this.chunksPerAxis = Math.max(1, Math.round(opts.chunksPerAxis));
    this.cellsPerAxis = this.chunksPerAxis * CHUNK_CELLS;
    this.totalCells = this.cellsPerAxis * this.cellsPerAxis * this.cellsPerAxis;
    this.worldHalf = opts.worldHalf;
    this.voxelSize = (this.worldHalf * 2) / this.cellsPerAxis;
    this.faceAreaM2 = this.voxelSize * this.voxelSize;
    this.cellVolumeM3 = this.faceAreaM2 * this.voxelSize;
    this.baseRadius = opts.baseRadius;

    this.hypergraph = opts.hypergraph;
    this.boundaryMode = opts.boundaryMode;
    this.feedRatePerSec = opts.feedRatePerSec ?? 0.35;
    this.exhaustRatePerSec = opts.exhaustRatePerSec ?? 0.35;
    this.feedSpeciesIndex = opts.feedSpeciesIndex ?? 0;
    this.feedConcentrationMolM3 = opts.feedConcentrationMolM3 ?? 2.4;
    this.ambientTempK = opts.ambientTempK ?? 310.0;
    this.ambientPressureAtm = opts.ambientPressureAtm ?? 1.0;

    const S = this.hypergraph.numSpecies;
    this.speciesConc = new Float32Array(this.totalCells * S);
    this.nextSpeciesConc = new Float32Array(this.totalCells * S);
    this.internalEnergy = new Float32Array(this.totalCells);
    this.nextInternalEnergy = new Float32Array(this.totalCells);
    this.fluxX = new Float32Array(this.totalCells);
    this.fluxY = new Float32Array(this.totalCells);
    this.fluxZ = new Float32Array(this.totalCells);
    this.phase = new Uint8Array(this.totalCells);

    this.temperatureK = new Float32Array(this.totalCells).fill(this.ambientTempK);
    this.pressureAtm = new Float32Array(this.totalCells).fill(this.ambientPressureAtm);
    this.porosity = new Float32Array(this.totalCells).fill(1.0);
    this.velX = new Float32Array(this.totalCells);
    this.velY = new Float32Array(this.totalCells);
    this.velZ = new Float32Array(this.totalCells);
    this.entropyProdRate = new Float32Array(this.totalCells);

    this.activeMask = new Uint8Array(this.totalCells).fill(1);
    this.feedPortMask = new Uint8Array(this.totalCells);
    this.exhaustPortMask = new Uint8Array(this.totalCells);
    this.activeCellList = new Int32Array(this.totalCells);
    this.rebuildActiveCellList();

    this.renderConcCopy = new Float32Array(this.totalCells * S);
    this.renderEnergyCopy = new Float32Array(this.totalCells);
    this.renderTempCopy = new Float32Array(this.totalCells);
    this.renderFluxXCopy = new Float32Array(this.totalCells);
    this.renderFluxYCopy = new Float32Array(this.totalCells);
    this.renderFluxZCopy = new Float32Array(this.totalCells);
    this.renderPorosityCopy = new Float32Array(this.totalCells);
    this.renderEntropyCopy = new Float32Array(this.totalCells);
    this.renderPhaseCopy = new Uint8Array(this.totalCells);
    this.renderActiveCopy = new Uint8Array(this.totalCells);

    const R = Math.max(1, this.hypergraph.numReactions);
    this._cellRxnRates = new Float64Array(R);
    this._meanRxnRatesAccum = new Float64Array(R);

    this.lastTelemetry = this.buildTelemetry({
      stepIndex: 0,
      simTimeSec: 0,
      totalMassPreKg: 0,
      boundaryFeedMassKg: 0,
      boundaryExhaustMassKg: 0,
      boundaryNetMassKg: 0,
      totalMassPostFluxKg: 0,
      totalMassPostReactKg: 0,
      fluxMassResidualKg: 0,
      reactionMassResidualKg: 0,
      totalMassBalanceResidualKg: 0,
      relativeError: 0,
      conserved: true,
    });
    this.publishRenderSnapshot();
  }

  public cellIndex(ix: number, iy: number, iz: number): number {
    return ix + iy * this.cellsPerAxis + iz * this.cellsPerAxis * this.cellsPerAxis;
  }

  public cellCenterWorld(ix: number, iy: number, iz: number): [number, number, number] {
    const half = this.worldHalf;
    const h = this.voxelSize;
    return [
      -half + (ix + 0.5) * h,
      -half + (iy + 0.5) * h,
      -half + (iz + 0.5) * h,
    ];
  }

  public worldToCell(wx: number, wy: number, wz: number): [number, number, number] {
    const n = this.cellsPerAxis;
    const ix = clamp(Math.floor((wx + this.worldHalf) / this.voxelSize), 0, n - 1);
    const iy = clamp(Math.floor((wy + this.worldHalf) / this.voxelSize), 0, n - 1);
    const iz = clamp(Math.floor((wz + this.worldHalf) / this.voxelSize), 0, n - 1);
    return [ix, iy, iz];
  }

  public rebuildActiveCellList(): void {
    let count = 0;
    for (let i = 0; i < this.totalCells; i++) {
      if (this.activeMask[i] !== 0) {
        this.activeCellList[count++] = i;
      }
    }
    this.activeCellCount = count;
  }

  public getActiveCellCount(): number {
    return this.activeCellCount;
  }

  /**
   * Computes total fluid/reactive mass in kg across all active control volumes:
   * M = sum_i V_cell * sum_s (C_{i,s} * M_s)
   */
  public computeTotalMassKg(): number {
    const S = this.hypergraph.numSpecies;
    const masses = this.hypergraph.molarMasses;
    let total = 0;
    for (let a = 0; a < this.activeCellCount; a++) {
      const idx = this.activeCellList[a];
      const base = idx * S;
      let cellMassDens = 0;
      for (let s = 0; s < S; s++) {
        cellMassDens += this.speciesConc[base + s] * masses[s];
      }
      total += cellMassDens * this.cellVolumeM3;
    }
    return total;
  }

  /**
   * Synchronizes internal energy from current temperatureK and species heat capacities.
   */
  public syncInternalEnergyFromTemp(): void {
    const S = this.hypergraph.numSpecies;
    const specs = this.hypergraph.species;
    for (let a = 0; a < this.activeCellCount; a++) {
      const idx = this.activeCellList[a];
      const temp = Math.max(20, this.temperatureK[idx]);
      let cpVol = 1800.0; // baseline porous rock / solvent volumetric heat capacity J/(m^3*K)
      const base = idx * S;
      for (let s = 0; s < S; s++) {
        cpVol += this.speciesConc[base + s] * specs[s].specificHeatJPerMolK;
      }
      this.internalEnergy[idx] = cpVol * temp;
      this.phase[idx] = classifyMatterPhase(
        temp,
        this.pressureAtm[idx],
        this.porosity[idx],
      );
    }
  }

  private updateTempAndPhaseFromEnergy(idx: number): void {
    const S = this.hypergraph.numSpecies;
    const specs = this.hypergraph.species;
    let cpVol = 1800.0;
    const base = idx * S;
    for (let s = 0; s < S; s++) {
      cpVol += this.speciesConc[base + s] * specs[s].specificHeatJPerMolK;
    }
    // Gentle radiative relaxation toward local ambient temperature to prevent runaway drift
    const rawT = clamp(this.internalEnergy[idx] / Math.max(200, cpVol), 40, 4500);
    this.temperatureK[idx] = rawT;
    this.phase[idx] = classifyMatterPhase(
      rawT,
      this.pressureAtm[idx],
      this.porosity[idx],
    );
  }

  /**
   * Returns an upgraded Eulerian Control Volume inspection view for any Vox (ix, iy, iz).
   */
  public getVoxControlVolume(ix: number, iy: number, iz: number): VoxControlVolume {
    const n = this.cellsPerAxis;
    const cxIdx = clamp(Math.floor(ix), 0, n - 1);
    const cyIdx = clamp(Math.floor(iy), 0, n - 1);
    const czIdx = clamp(Math.floor(iz), 0, n - 1);
    const idx = this.cellIndex(cxIdx, cyIdx, czIdx);
    const S = this.hypergraph.numSpecies;
    const conc = new Float32Array(S);
    const base = idx * S;
    for (let s = 0; s < S; s++) {
      conc[s] = this.speciesConc[base + s];
    }
    return {
      cellIndex: idx,
      ix: cxIdx,
      iy: cyIdx,
      iz: czIdx,
      cx: Math.floor(cxIdx / CHUNK_CELLS),
      cy: Math.floor(cyIdx / CHUNK_CELLS),
      cz: Math.floor(czIdx / CHUNK_CELLS),
      worldPos: this.cellCenterWorld(cxIdx, cyIdx, czIdx),
      active: this.activeMask[idx] !== 0,
      porosity: this.porosity[idx],
      speciesConc: conc,
      internalEnergy: this.internalEnergy[idx],
      temperatureK: this.temperatureK[idx],
      pressureAtm: this.pressureAtm[idx],
      flux: [this.fluxX[idx], this.fluxY[idx], this.fluxZ[idx]],
      velocity: [this.velX[idx], this.velY[idx], this.velZ[idx]],
      phase: this.phase[idx] as MatterPhase,
      entropyProdRate: this.entropyProdRate[idx],
    };
  }

  /**
   * Fixed Simulation Sequence Step:
   *   0. Boundary exchange (ONLY if boundaryMode === 'open'; zero in 'closed')
   *   1. Flux Operator (diffusion + advection across control-volume faces)
   *   2. Local Reaction Operator (in-cell hypergraph conversion)
   *   3. Mass Conservation Audit (every single step)
   */
  public step(dtSec: number): FvmStepTelemetry {
    const dt = clamp(dtSec, 1e-4, 0.25);
    const massPre = this.computeTotalMassKg();

    // 0. Open-system boundary feed / exhaust (strictly 0 when closed)
    let feedMassKg = 0;
    let exhaustMassKg = 0;
    if (this.boundaryMode === 'open') {
      const bRes = this.applyOpenBoundaryPorts(dt);
      feedMassKg = bRes.feedMassKg;
      exhaustMassKg = bRes.exhaustMassKg;
    }

    // 1. Flux Operator (spatial transport: Fickian diffusion + upwind advection + heat conduction)
    this.applyFluxOperator(dt);
    const massPostFlux = this.computeTotalMassKg();

    // 2. Local Reaction Operator (purely in-cell species & enthalpy transformation)
    this.applyReactionOperator(dt);
    const massPostReact = this.computeTotalMassKg();

    this.stepIndex++;
    this.simTimeSec += dt;
    this.revision++;

    // 3. Per-step strict mass conservation check
    const boundaryNetMassKg = feedMassKg - exhaustMassKg;
    const fluxMassResidualKg = massPostFlux - (massPre + boundaryNetMassKg);
    const reactionMassResidualKg = massPostReact - massPostFlux;
    const totalMassBalanceResidualKg = massPostReact - (massPre + boundaryNetMassKg);
    const scaleRef = Math.max(1e-9, massPre, massPostReact, Math.abs(boundaryNetMassKg));
    const relativeError = Math.abs(totalMassBalanceResidualKg) / scaleRef;

    const audit: MassConservationAudit = {
      stepIndex: this.stepIndex,
      simTimeSec: this.simTimeSec,
      totalMassPreKg: massPre,
      boundaryFeedMassKg: feedMassKg,
      boundaryExhaustMassKg: exhaustMassKg,
      boundaryNetMassKg,
      totalMassPostFluxKg: massPostFlux,
      totalMassPostReactKg: massPostReact,
      fluxMassResidualKg,
      reactionMassResidualKg,
      totalMassBalanceResidualKg,
      relativeError,
      conserved: relativeError < 1e-5,
    };

    this.lastTelemetry = this.buildTelemetry(audit);
    this.publishRenderSnapshot();
    return this.lastTelemetry;
  }

  private applyOpenBoundaryPorts(dt: number): {
    feedMassKg: number;
    exhaustMassKg: number;
  } {
    const S = this.hypergraph.numSpecies;
    const masses = this.hypergraph.molarMasses;
    const feedIdx = clamp(this.feedSpeciesIndex, 0, S - 1);
    const feedRate = Math.max(0, this.feedRatePerSec);
    const exhaustRate = Math.max(0, this.exhaustRatePerSec);
    const vol = this.cellVolumeM3;

    let feedMassKg = 0;
    let exhaustMassKg = 0;

    for (let a = 0; a < this.activeCellCount; a++) {
      const idx = this.activeCellList[a];
      const base = idx * S;

      // Continuous substrate feed stream into feed ports
      if (this.feedPortMask[idx] !== 0 && feedRate > 0) {
        const deltaMolM3 = feedRate * this.feedConcentrationMolM3 * dt;
        this.speciesConc[base + feedIdx] += deltaMolM3;
        feedMassKg += deltaMolM3 * masses[feedIdx] * vol;
      }

      // Continuous convective exhaust / washout from exhaust ports (or global CSTR dilution if marked)
      if (this.exhaustPortMask[idx] !== 0 && exhaustRate > 0) {
        const drainFrac = clamp(exhaustRate * dt, 0, 0.85);
        for (let s = 0; s < S; s++) {
          const c = this.speciesConc[base + s];
          if (c > 0) {
            const removed = c * drainFrac;
            this.speciesConc[base + s] = c - removed;
            exhaustMassKg += removed * masses[s] * vol;
          }
        }
      }
    }

    return { feedMassKg, exhaustMassKg };
  }

  /**
   * Step 1 (Fixed Sequence): Conservative Finite-Volume Flux Operator.
   * Evaluates symmetric interfacial fluxes across +X, +Y, +Z cell faces:
   *   J_{s, face} = v_face * C_{s, upwind} - D_s * (C_{s, R} - C_{s, L}) / h
   * Because flux leaving cell L equals flux entering cell R identically,
   * discrete spatial mass conservation holds to machine precision.
   */
  private applyFluxOperator(dt: number): void {
    const n = this.cellsPerAxis;
    const nSq = n * n;
    const S = this.hypergraph.numSpecies;
    const h = this.voxelSize;
    const invH = 1.0 / h;
    const dtOverH = dt * invH;
    const masses = this.hypergraph.molarMasses;
    const diffs = this.hypergraph.diffusivities;
    const diffScale = this.hypergraph.calibratedDiffusivityScale;

    // Copy current state into working destination buffers
    this.nextSpeciesConc.set(this.speciesConc);
    this.nextInternalEnergy.set(this.internalEnergy);
    this.fluxX.fill(0);
    this.fluxY.fill(0);
    this.fluxZ.fill(0);

    // CFL-safe diffusion + advection stability cap per substep
    let maxD = 0;
    for (let s = 0; s < S; s++) {
      const dEff = diffs[s] * diffScale[s];
      if (dEff > maxD) maxD = dEff;
    }
    const maxDiffNumber = (maxD * dt) / (h * h);
    const substeps = clamp(Math.ceil(maxDiffNumber / 0.14), 1, 8);
    const subDt = dt / substeps;
    const subDtOverH = subDt * invH;
    const thermalCond = 0.08; // normalized thermal conductivity J/(m*K*s) scaled to cell

    for (let step = 0; step < substeps; step++) {
      if (step > 0) {
        this.speciesConc.set(this.nextSpeciesConc);
        this.internalEnergy.set(this.nextInternalEnergy);
      }

      for (let a = 0; a < this.activeCellCount; a++) {
        const idx = this.activeCellList[a];
        const iz = Math.floor(idx / nSq);
        const rem = idx - iz * nSq;
        const iy = Math.floor(rem / n);
        const ix = rem - iy * n;

        const baseL = idx * S;
        const porL = this.porosity[idx];
        const tL = this.temperatureK[idx];

        // Face +X: (ix, iy, iz) <-> (ix + 1, iy, iz)
        if (ix + 1 < n) {
          const rIdx = idx + 1;
          if (this.activeMask[rIdx] !== 0) {
            const baseR = rIdx * S;
            const facePor = Math.min(porL, this.porosity[rIdx]);
            const vFace = 0.5 * (this.velX[idx] + this.velX[rIdx]) * facePor;
            let massFluxFace = 0;

            for (let s = 0; s < S; s++) {
              const cL = this.speciesConc[baseL + s];
              const cR = this.speciesConc[baseR + s];
              const dEff = diffs[s] * diffScale[s] * facePor;
              const advFlux = vFace >= 0 ? vFace * cL : vFace * cR;
              const diffFlux = -dEff * (cR - cL) * invH;
              // Positivity limiter: limit outward transfer to <= 22% of donor cell per substep
              let flux = advFlux + diffFlux;
              if (flux > 0) {
                const maxFlux = (cL * 0.22) / subDtOverH;
                if (flux > maxFlux) flux = maxFlux;
              } else if (flux < 0) {
                const maxNegFlux = (-cR * 0.22) / subDtOverH;
                if (flux < maxNegFlux) flux = maxNegFlux;
              }
              const delta = flux * subDtOverH;
              this.nextSpeciesConc[baseL + s] -= delta;
              this.nextSpeciesConc[baseR + s] += delta;
              massFluxFace += flux * masses[s];
            }

            // Conservative energy flux across +X face
            const eL = this.internalEnergy[idx];
            const eR = this.internalEnergy[rIdx];
            const eAdv = vFace >= 0 ? vFace * eL : vFace * eR;
            const eCond = -thermalCond * facePor * (this.temperatureK[rIdx] - tL) * invH * 2200;
            const eDelta = (eAdv + eCond) * subDtOverH;
            this.nextInternalEnergy[idx] -= eDelta;
            this.nextInternalEnergy[rIdx] += eDelta;

            if (step === substeps - 1) {
              this.fluxX[idx] += massFluxFace * 0.5;
              this.fluxX[rIdx] += massFluxFace * 0.5;
            }
          }
        }

        // Face +Y: (ix, iy, iz) <-> (ix, iy + 1, iz)
        if (iy + 1 < n) {
          const rIdx = idx + n;
          if (this.activeMask[rIdx] !== 0) {
            const baseR = rIdx * S;
            const facePor = Math.min(porL, this.porosity[rIdx]);
            const vFace = 0.5 * (this.velY[idx] + this.velY[rIdx]) * facePor;
            let massFluxFace = 0;

            for (let s = 0; s < S; s++) {
              const cL = this.speciesConc[baseL + s];
              const cR = this.speciesConc[baseR + s];
              const dEff = diffs[s] * diffScale[s] * facePor;
              const advFlux = vFace >= 0 ? vFace * cL : vFace * cR;
              const diffFlux = -dEff * (cR - cL) * invH;
              let flux = advFlux + diffFlux;
              if (flux > 0) {
                const maxFlux = (cL * 0.22) / subDtOverH;
                if (flux > maxFlux) flux = maxFlux;
              } else if (flux < 0) {
                const maxNegFlux = (-cR * 0.22) / subDtOverH;
                if (flux < maxNegFlux) flux = maxNegFlux;
              }
              const delta = flux * subDtOverH;
              this.nextSpeciesConc[baseL + s] -= delta;
              this.nextSpeciesConc[baseR + s] += delta;
              massFluxFace += flux * masses[s];
            }

            const eL = this.internalEnergy[idx];
            const eR = this.internalEnergy[rIdx];
            const eAdv = vFace >= 0 ? vFace * eL : vFace * eR;
            const eCond = -thermalCond * facePor * (this.temperatureK[rIdx] - tL) * invH * 2200;
            const eDelta = (eAdv + eCond) * subDtOverH;
            this.nextInternalEnergy[idx] -= eDelta;
            this.nextInternalEnergy[rIdx] += eDelta;

            if (step === substeps - 1) {
              this.fluxY[idx] += massFluxFace * 0.5;
              this.fluxY[rIdx] += massFluxFace * 0.5;
            }
          }
        }

        // Face +Z: (ix, iy, iz) <-> (ix, iy, iz + 1)
        if (iz + 1 < n) {
          const rIdx = idx + nSq;
          if (this.activeMask[rIdx] !== 0) {
            const baseR = rIdx * S;
            const facePor = Math.min(porL, this.porosity[rIdx]);
            const vFace = 0.5 * (this.velZ[idx] + this.velZ[rIdx]) * facePor;
            let massFluxFace = 0;

            for (let s = 0; s < S; s++) {
              const cL = this.speciesConc[baseL + s];
              const cR = this.speciesConc[baseR + s];
              const dEff = diffs[s] * diffScale[s] * facePor;
              const advFlux = vFace >= 0 ? vFace * cL : vFace * cR;
              const diffFlux = -dEff * (cR - cL) * invH;
              let flux = advFlux + diffFlux;
              if (flux > 0) {
                const maxFlux = (cL * 0.22) / subDtOverH;
                if (flux > maxFlux) flux = maxFlux;
              } else if (flux < 0) {
                const maxNegFlux = (-cR * 0.22) / subDtOverH;
                if (flux < maxNegFlux) flux = maxNegFlux;
              }
              const delta = flux * subDtOverH;
              this.nextSpeciesConc[baseL + s] -= delta;
              this.nextSpeciesConc[baseR + s] += delta;
              massFluxFace += flux * masses[s];
            }

            const eL = this.internalEnergy[idx];
            const eR = this.internalEnergy[rIdx];
            const eAdv = vFace >= 0 ? vFace * eL : vFace * eR;
            const eCond = -thermalCond * facePor * (this.temperatureK[rIdx] - tL) * invH * 2200;
            const eDelta = (eAdv + eCond) * subDtOverH;
            this.nextInternalEnergy[idx] -= eDelta;
            this.nextInternalEnergy[rIdx] += eDelta;

            if (step === substeps - 1) {
              this.fluxZ[idx] += massFluxFace * 0.5;
              this.fluxZ[rIdx] += massFluxFace * 0.5;
            }
          }
        }
      }
    }

    // Commit conservative flux update
    void dtOverH;
    this.speciesConc.set(this.nextSpeciesConc);
    this.internalEnergy.set(this.nextInternalEnergy);
    for (let a = 0; a < this.activeCellCount; a++) {
      this.updateTempAndPhaseFromEnergy(this.activeCellList[a]);
    }
  }

  /**
   * Step 2 (Fixed Sequence): Local In-Cell Reaction Operator.
   * Integrates the reaction hypergraph independently inside each Vox control volume.
   */
  private applyReactionOperator(dt: number): void {
    const S = this.hypergraph.numSpecies;
    const R = this.hypergraph.numReactions;
    this._meanRxnRatesAccum.fill(0);

    for (let a = 0; a < this.activeCellCount; a++) {
      const idx = this.activeCellList[a];
      const base = idx * S;
      const tempK = this.temperatureK[idx];
      const pressAtm = this.pressureAtm[idx];

      integrateCellReactions(
        this.hypergraph,
        this.speciesConc,
        base,
        tempK,
        pressAtm,
        dt,
        this.rxnStepOut,
        1.0,
        this._cellRxnRates,
      );

      for (let r = 0; r < R; r++) {
        this._meanRxnRatesAccum[r] += this._cellRxnRates[r];
      }

      this.internalEnergy[idx] = Math.max(
        5000,
        this.internalEnergy[idx] + this.rxnStepOut.deltaInternalEnergyJm3,
      );
      this.entropyProdRate[idx] = this.rxnStepOut.entropyProductionRate;
      this.updateTempAndPhaseFromEnergy(idx);
    }

    const denom = Math.max(1, this.activeCellCount);
    for (let r = 0; r < R; r++) {
      this._meanRxnRatesAccum[r] /= denom;
    }
  }

  private buildTelemetry(conservation: MassConservationAudit): FvmStepTelemetry {
    const S = this.hypergraph.numSpecies;
    const totalSpeciesMoles = new Float64Array(S);
    const meanConcentrations = new Float64Array(S);
    const sumSq = new Float64Array(S);
    const speciesSpatialStdDev = new Float64Array(S);
    const phaseCounts: Record<MatterPhase, number> = {
      [MatterPhase.Solid]: 0,
      [MatterPhase.Liquid]: 0,
      [MatterPhase.Gas]: 0,
      [MatterPhase.Plasma]: 0,
      [MatterPhase.Supercritical]: 0,
    };

    let totalEnergy = 0;
    let sumTemp = 0;
    let totalEntropy = 0;
    let fluxMagSum = 0;
    const count = Math.max(1, this.activeCellCount);

    for (let a = 0; a < this.activeCellCount; a++) {
      const idx = this.activeCellList[a];
      const base = idx * S;
      for (let s = 0; s < S; s++) {
        const c = this.speciesConc[base + s];
        totalSpeciesMoles[s] += c * this.cellVolumeM3;
        meanConcentrations[s] += c;
      }
      totalEnergy += this.internalEnergy[idx] * this.cellVolumeM3;
      sumTemp += this.temperatureK[idx];
      totalEntropy += this.entropyProdRate[idx] * this.cellVolumeM3;
      const ph = this.phase[idx] as MatterPhase;
      phaseCounts[ph] = (phaseCounts[ph] ?? 0) + 1;
      fluxMagSum += Math.hypot(this.fluxX[idx], this.fluxY[idx], this.fluxZ[idx]);
    }

    for (let s = 0; s < S; s++) {
      meanConcentrations[s] /= count;
    }

    for (let a = 0; a < this.activeCellCount; a++) {
      const idx = this.activeCellList[a];
      const base = idx * S;
      for (let s = 0; s < S; s++) {
        const diff = this.speciesConc[base + s] - meanConcentrations[s];
        sumSq[s] += diff * diff;
      }
    }

    for (let s = 0; s < S; s++) {
      speciesSpatialStdDev[s] = Math.sqrt(sumSq[s] / count);
    }

    return {
      stepIndex: this.stepIndex,
      simTimeSec: this.simTimeSec,
      boundaryMode: this.boundaryMode,
      activeCellCount: this.activeCellCount,
      totalSpeciesMoles,
      meanConcentrations,
      speciesSpatialStdDev,
      totalInternalEnergyJ: totalEnergy,
      meanTempK: sumTemp / count,
      totalEntropyProdRate: totalEntropy,
      phaseCounts,
      meanFluxMagnitude: fluxMagSum / count,
      meanReactionRates: new Float64Array(this._meanRxnRatesAccum ?? []),
      conservation,
    };
  }

  public publishRenderSnapshot(): void {
    this.renderConcCopy.set(this.speciesConc);
    this.renderEnergyCopy.set(this.internalEnergy);
    this.renderTempCopy.set(this.temperatureK);
    this.renderFluxXCopy.set(this.fluxX);
    this.renderFluxYCopy.set(this.fluxY);
    this.renderFluxZCopy.set(this.fluxZ);
    this.renderPorosityCopy.set(this.porosity);
    this.renderEntropyCopy.set(this.entropyProdRate);
    this.renderPhaseCopy.set(this.phase);
    this.renderActiveCopy.set(this.activeMask);
    this.renderRevision = this.revision;
  }

  /**
   * Read-only view exposed to the rendering pipeline (Marching Cubes / Volumetric rendering).
   * Renderer strictly reads this view and never mutates simulation state.
   */
  public getReadOnlyRenderView(): FvmRenderFieldView {
    return {
      revision: this.renderRevision,
      cellsPerAxis: this.cellsPerAxis,
      chunksPerAxis: this.chunksPerAxis,
      worldHalf: this.worldHalf,
      voxelSize: this.voxelSize,
      numSpecies: this.hypergraph.numSpecies,
      speciesColors: this.hypergraph.species.map((s) => s.colorRgb),
      speciesConc: this.renderConcCopy,
      internalEnergy: this.renderEnergyCopy,
      temperatureK: this.renderTempCopy,
      fluxX: this.renderFluxXCopy,
      fluxY: this.renderFluxYCopy,
      fluxZ: this.renderFluxZCopy,
      porosity: this.renderPorosityCopy,
      entropyProdRate: this.renderEntropyCopy,
      phase: this.renderPhaseCopy,
      activeMask: this.renderActiveCopy,
    };
  }
}

export interface CellularBioTelemetry {
  readonly atpSynthesisRateMmolLs: number;
  readonly respiratoryQuotient: number;
  readonly aerobicSharePct: number;
  readonly anaerobicSharePct: number;
  readonly membranePotentialMv: number;
  readonly protocellBiomassMolM3: number;
  readonly carbonFixationRate: number;
  readonly netEvaporationRate: number;
}

/**
 * Derives intuitive biological & planetary metabolic indicators from live FVM reaction rates & concentrations.
 */
export function computeCellularBioTelemetry(
  hypergraph: CompiledReactionHypergraph,
  telemetry: FvmStepTelemetry,
): CellularBioTelemetry {
  const rates = telemetry.meanReactionRates;
  const conc = telemetry.meanConcentrations;

  if (hypergraph.id === 'cellular_metabolism') {
    const rPhoto = Math.max(0, rates[0] ?? 0);
    const rTca = Math.max(0, rates[1] ?? 0);
    const rGly = Math.max(0, rates[2] ?? 0);
    const rCori = Math.max(0, rates[3] ?? 0);

    // 30 ATP per glucose oxidized via TCA, 14 ATP per lactate oxidized, 2 ATP per glycolysis
    const aerobicAtp = rTca * 30.0 + rCori * 14.0;
    const anaerobicAtp = rGly * 2.0;
    const atpTotal = aerobicAtp + anaerobicAtp;
    const totalPath = rTca + rCori + rGly;
    const aerobicSharePct = totalPath > 1e-6 ? ((rTca + rCori) / totalPath) * 100 : 50;
    const anaerobicSharePct = 100 - aerobicSharePct;

    const co2Prod = rTca * 6.0 + rCori * 3.0;
    const o2Cons = rTca * 6.0 + rCori * 3.0;
    const respiratoryQuotient =
      o2Cons > 1e-6 ? clamp(co2Prod / o2Cons + (rGly * 0.25) / Math.max(0.05, o2Cons), 0.65, 1.45) : 1.0;

    const biomass = conc[5] ?? 0;
    const membranePotentialMv = -62 - clamp(atpTotal * 2.2 + biomass * 4.5, 0, 32);

    return {
      atpSynthesisRateMmolLs: atpTotal,
      respiratoryQuotient,
      aerobicSharePct,
      anaerobicSharePct,
      membranePotentialMv,
      protocellBiomassMolM3: biomass,
      carbonFixationRate: rPhoto * 6.0,
      netEvaporationRate: 0,
    };
  }

  if (hypergraph.id === 'planetary_carbon_water') {
    const rEvap = rates[0] ?? 0;
    const rPhoto = Math.max(0, rates[1] ?? 0);
    const rResp = Math.max(0, rates[2] ?? 0);
    const rMeth = Math.max(0, rates[3] ?? 0);
    const rCh4Ox = Math.max(0, rates[4] ?? 0);

    const o2 = conc[4] ?? 0;
    const biomass = conc[3] ?? 0;
    const aerobicPath = rResp + rCh4Ox;
    const anaerobicPath = rMeth;
    const totalPath = aerobicPath + anaerobicPath;
    const aerobicSharePct = totalPath > 1e-6 ? (aerobicPath / totalPath) * 100 : o2 > 0.2 ? 82 : 25;
    const atpEquiv = rResp * 18.0 + rPhoto * 6.0 + rMeth * 2.0;
    const membranePotentialMv = -60 - clamp(atpEquiv * 1.6 + biomass * 4.0, 0, 30);

    return {
      atpSynthesisRateMmolLs: atpEquiv,
      respiratoryQuotient: aerobicPath > 1e-6 ? clamp((rResp + rCh4Ox) / Math.max(1e-6, rResp + 2 * rCh4Ox), 0.5, 1.2) : 0.85,
      aerobicSharePct,
      anaerobicSharePct: 100 - aerobicSharePct,
      membranePotentialMv,
      protocellBiomassMolM3: biomass,
      carbonFixationRate: rPhoto,
      netEvaporationRate: rEvap,
    };
  }

  if (hypergraph.id === 'planetary_hydrology') {
    const rEvap = rates[0] ?? 0;
    return {
      atpSynthesisRateMmolLs: 0,
      respiratoryQuotient: 1.0,
      aerobicSharePct: 100,
      anaerobicSharePct: 0,
      membranePotentialMv: -60,
      protocellBiomassMolM3: 0,
      carbonFixationRate: 0,
      netEvaporationRate: rEvap,
    };
  }

  const biomass = conc[1] ?? 0;
  const prod = Math.max(0, rates[0] ?? 0);
  return {
    atpSynthesisRateMmolLs: prod * 12.0,
    respiratoryQuotient: 1.0,
    aerobicSharePct: 75,
    anaerobicSharePct: 25,
    membranePotentialMv: -64 - clamp(prod * 6.0 + biomass * 6.0, 0, 26),
    protocellBiomassMolM3: biomass,
    carbonFixationRate: prod,
    netEvaporationRate: 0,
  };
}

