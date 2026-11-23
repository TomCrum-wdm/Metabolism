// 《Metabolism》 Multi-Scale Dissipative Universe Simulation Orchestrator (Stage 2)
// Integrates:
//   1. Unified CPU / WebGPU Compute FVM Solver (24^3 CPU baseline up to 128^3 / 2.09M voxels on WebGPU)
//   2. CompiledReactionHypergraph (numeric stoichiometric + Arrhenius + T/P window)
//   3. PIC AABB Local Micro-Calibrator (ephemeral Langevin + collision sampling -> macroscopic calibration)
//   4. Bidirectional Planetary Feedback (exothermic hotspots + Crystal/Basalt mineralization + brush porosity sync)

import type * as THREE from 'three/webgpu';
import { AtmosphereConfig, DEFAULT_ATMOS_CONFIG, sampleAtmosphereAtPoint } from '../atmosphere';
import { DEFAULT_THERMAL_CONFIG, sampleThermalField, temperatureToRgb, ThermalConfig, ThermalHotspot } from '../thermal';
import { MaterialId, VoxelPlanet } from '../voxelPlanet';
import {
  EulerianFvmGrid,
  FvmRenderFieldView,
  FvmStepTelemetry,
  MATTER_PHASE_LABELS,
  MatterPhase,
  SystemBoundaryMode,
} from './eulerianFvm';
import {
  FVM_RESOLUTION_PRESETS,
  FvmComputeBackendKind,
  FvmResolutionCells,
  WebGpuFvmComputeSolver,
} from './fvmComputeBackend';
import {
  LagrangianBoundaryState,
  LagrangianCouplingZone,
  PicCouplingRegistry,
} from './picCouplingHooks';
import {
  DEFAULT_MICRO_CALIBRATION_CONFIG,
  MicroCalibrationConfig,
  MicroCalibrationRecord,
  runLocalMicroCalibration,
} from './picMicroCalibrator';
import {
  DEFAULT_PLANETARY_FEEDBACK_CONFIG,
  PlanetaryFeedbackConfig,
  PlanetaryFeedbackEventLog,
  PlanetaryFeedbackStats,
  evaluateFeedbackCandidatesFromCpuGrid,
  evaluateFeedbackCandidatesFromGpuBins,
  syncLocalBrushToCpuFvmGrid,
} from './planetaryFeedback';
import {
  CompiledReactionHypergraph,
  createClosedEquilibriumHypergraph,
  createOpenAutocatalyticHypergraph,
} from './reactionHypergraph';

export type MetabolismDemoMode = 'closed_equilibrium' | 'open_autocatalytic';
export type MetabolismVisualChannel = 'species' | 'energy' | 'phase' | 'flux';

export interface MetabolismTimePoint {
  readonly stepIndex: number;
  readonly simTimeSec: number;
  readonly meanConcentrations: ReadonlyArray<number>;
  readonly spatialStdDev: ReadonlyArray<number>;
  readonly meanTempK: number;
  readonly totalEntropyProdRate: number;
  readonly relativeMassError: number;
}

export interface BifurcationSweepPoint {
  readonly feedRatePerSec: number;
  readonly steadySubstrateS: number;
  readonly steadyAutocatalystX: number;
  readonly steadyWasteW: number;
  readonly spatialStdDevX: number;
  readonly entropyProdRate: number;
  readonly regime: 'extinction' | 'dissipative_branch';
}

export interface BifurcationSweepReport {
  readonly criticalFeedRate: number | null;
  readonly jumpMagnitudeX: number;
  readonly maxEntropyProdRate: number;
  readonly points: ReadonlyArray<BifurcationSweepPoint>;
}

export interface MetabolismSummarySnapshot {
  readonly mode: MetabolismDemoMode;
  readonly boundaryMode: SystemBoundaryMode;
  readonly running: boolean;
  readonly timeScale: number;
  readonly fixedDtSec: number;
  readonly visualChannel: MetabolismVisualChannel;
  readonly simRevision: number;
  readonly renderRevision: number;
  readonly computeBackend: FvmComputeBackendKind;
  readonly webGpuSupported: boolean;
  readonly resolutionCells: FvmResolutionCells;
  readonly totalGridVoxels: number;
  readonly gpuZeroReadbackActive: boolean;
  readonly hypergraph: CompiledReactionHypergraph;
  readonly telemetry: FvmStepTelemetry;
  readonly history: ReadonlyArray<MetabolismTimePoint>;
  readonly zones: ReadonlyArray<LagrangianCouplingZone>;
  readonly lastZoneBoundary: LagrangianBoundaryState | null;
  readonly lastCalibrationRecord: MicroCalibrationRecord | null;
  readonly calibrationHistoryCount: number;
  readonly autoCalibrateEnabled: boolean;
  readonly feedbackConfig: PlanetaryFeedbackConfig;
  readonly feedbackStats: PlanetaryFeedbackStats;
  readonly bifurcationReport: BifurcationSweepReport | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class MetabolismSimRunner {
  public mode: MetabolismDemoMode = 'open_autocatalytic';
  public running = true;
  public timeScale = 1.0;
  public readonly fixedDtSec = 0.05;
  public visualChannel: MetabolismVisualChannel = 'species';

  public grid: EulerianFvmGrid;
  public readonly couplingRegistry = new PicCouplingRegistry();
  public history: MetabolismTimePoint[] = [];
  public lastZoneBoundary: LagrangianBoundaryState | null = null;
  public lastCalibrationRecord: MicroCalibrationRecord | null = null;
  public calibrationHistoryCount = 0;
  public autoCalibrateEnabled = false;
  public bifurcationReport: BifurcationSweepReport | null = null;

  // Stage 2: GPU Compute Backend & Resolution state
  public webGpuSupported = false;
  public computeBackend: FvmComputeBackendKind = 'cpu';
  public resolutionCells: FvmResolutionCells = 24;
  public gpuSolver: WebGpuFvmComputeSolver | null = null;
  private gpuRendererRef: THREE.WebGPURenderer | null = null;
  private gpuStepCounter = 0;
  private gpuSimTimeSec = 0;
  private gpuLastTelemetry: FvmStepTelemetry | null = null;
  private gpuShaderRevision = 0;

  // Stage 2: Bidirectional Planetary Feedback state
  public feedbackConfig: PlanetaryFeedbackConfig = { ...DEFAULT_PLANETARY_FEEDBACK_CONFIG };
  private mineralAccumulator: Float32Array | null = null;
  private feedbackAccumulatorSec = 0;
  private totalMineralizedVoxels = 0;
  private totalCorrodedVoxels = 0;
  private lastMineralBatchCount = 0;
  private lastPorositySyncVoxels = 0;
  private activeThermalHotspotsCount = 0;
  private peakExothermicDeltaC = 0;
  private feedbackEventLogs: PlanetaryFeedbackEventLog[] = [];
  private autoCalibrateTimerSec = 0;

  private simAccumulatorSec = 0;
  private readonly maxHistory = 140;
  private boundPlanet: VoxelPlanet | null = null;
  private boundSunDir: readonly [number, number, number] = [0.7, 0.5, 0.5];
  private boundAtmos: AtmosphereConfig = DEFAULT_ATMOS_CONFIG;
  private boundThermal: ThermalConfig = DEFAULT_THERMAL_CONFIG;

  constructor(
    initialMode: MetabolismDemoMode = 'open_autocatalytic',
    chunksPerAxis = 3,
    worldHalf = 20.0,
    baseRadius = 13.0,
  ) {
    this.mode = initialMode;
    this.grid = this.createGridForMode(initialMode, chunksPerAxis, worldHalf, baseRadius);
    this.mineralAccumulator = new Float32Array(this.grid.totalCells);
    this.seedInitialState(initialMode);
  }

  private createGridForMode(
    mode: MetabolismDemoMode,
    chunksPerAxis: number,
    worldHalf: number,
    baseRadius: number,
  ): EulerianFvmGrid {
    const hypergraph =
      mode === 'closed_equilibrium'
        ? createClosedEquilibriumHypergraph()
        : createOpenAutocatalyticHypergraph();

    return new EulerianFvmGrid({
      chunksPerAxis,
      worldHalf,
      baseRadius,
      hypergraph,
      boundaryMode: mode === 'closed_equilibrium' ? 'closed' : 'open',
      feedRatePerSec: mode === 'closed_equilibrium' ? 0 : 0.42,
      exhaustRatePerSec: mode === 'closed_equilibrium' ? 0 : 0.36,
      feedSpeciesIndex: 0,
      feedConcentrationMolM3: 2.6,
      ambientTempK: 315,
      ambientPressureAtm: 1.2,
    });
  }

  /**
   * Configures WebGPU Compute hardware availability and switches resolution / solver backend cleanly.
   * Falls back deterministically to CPU EulerianFvmGrid when WebGPU is unavailable (WebGL2 or Node).
   */
  public configureComputeBackend(
    webGpuSupported: boolean,
    requestedCells: FvmResolutionCells,
    requestedBackend: FvmComputeBackendKind,
    renderer: THREE.WebGPURenderer | null,
  ): { changedShaderBinding: boolean } {
    this.webGpuSupported = webGpuSupported;
    this.gpuRendererRef = webGpuSupported ? renderer : null;

    const spec = FVM_RESOLUTION_PRESETS[requestedCells] ?? FVM_RESOLUTION_PRESETS[24];
    const useWebGpu = webGpuSupported && renderer !== null && requestedBackend === 'webgpu';
    const nextCells: FvmResolutionCells = useWebGpu ? spec.cellsPerAxis : 24;
    const nextBackend: FvmComputeBackendKind = useWebGpu ? 'webgpu' : 'cpu';

    const wasGpu = this.gpuSolver !== null;
    const prevCells = this.resolutionCells;
    this.computeBackend = nextBackend;
    this.resolutionCells = nextCells;

    if (!useWebGpu) {
      this.gpuSolver = null;
      return { changedShaderBinding: wasGpu };
    }

    if (!this.gpuSolver || prevCells !== nextCells || !wasGpu) {
      const planet = this.boundPlanet;
      const worldHalf = planet ? planet.worldHalf : this.grid.worldHalf;
      const baseRadius = planet ? planet.baseRadius : this.grid.baseRadius;
      const coarseN = planet ? planet.cellsPerAxis : 32;

      this.gpuSolver = new WebGpuFvmComputeSolver(
        FVM_RESOLUTION_PRESETS[nextCells],
        worldHalf,
        baseRadius,
        this.grid.hypergraph,
        coarseN,
      );
      this.gpuStepCounter = 0;
      this.gpuSimTimeSec = 0;
      this.gpuLastTelemetry = this.grid.lastTelemetry;
      this.history = [];
      this.seedGpuSolverFromPlanet();
      return { changedShaderBinding: true };
    }

    return { changedShaderBinding: false };
  }

  private seedGpuSolverFromPlanet(): void {
    if (!this.gpuSolver || !this.gpuRendererRef) return;
    const planet = this.boundPlanet;
    const coarseDensity = planet ? planet.density : new Float32Array(32 * 32 * 32).fill(-1);
    const coarseMaterial = planet ? planet.material : new Uint8Array(32 * 32 * 32);
    const coarseN = planet ? planet.cellsPerAxis : 32;

    this.gpuSolver.updateHypergraphKinetics(this.grid.hypergraph);
    this.gpuSolver.seedFromCoarsePlanet(
      coarseDensity,
      coarseMaterial,
      coarseN,
      this.boundSunDir,
      this.grid.ambientTempK,
      this.grid.boundaryMode === 'open',
      this.gpuRendererRef,
    );
    // Run 1 immediate step + readback so UI telemetry populates smoothly
    this.gpuSolver.dispatchStep(this.gpuRendererRef, {
      dtSec: 0.02,
      boundaryMode: this.grid.boundaryMode,
      feedRatePerSec: this.grid.feedRatePerSec,
      exhaustRatePerSec: this.grid.exhaustRatePerSec,
      feedConcentrationMolM3: this.grid.feedConcentrationMolM3,
      ambientTempK: this.grid.ambientTempK,
    });
    this.gpuSolver.scheduleAsyncReadback(this.gpuRendererRef);
    this.gpuShaderRevision++;
  }

  /**
   * Binds the Eulerian FVM grid directly to an existing VoxelPlanet's Chunk/Vox geometry,
   * atmosphere, and 3D thermal field.
   */
  public bindToPlanet(
    planet: VoxelPlanet,
    sunDir: readonly [number, number, number] = [0.7, 0.5, 0.5],
    atmosCfg: AtmosphereConfig = DEFAULT_ATMOS_CONFIG,
    thermalCfg: ThermalConfig = DEFAULT_THERMAL_CONFIG,
  ): void {
    this.boundPlanet = planet;
    this.boundSunDir = sunDir;
    this.boundAtmos = atmosCfg;
    this.boundThermal = thermalCfg;

    const targetChunks = planet.chunksPerAxis <= 3 ? planet.chunksPerAxis : 3;
    this.grid = this.createGridForMode(
      this.mode,
      targetChunks,
      planet.worldHalf,
      planet.baseRadius,
    );
    this.mineralAccumulator = new Float32Array(this.grid.totalCells);
    this.totalMineralizedVoxels = 0;
    this.totalCorrodedVoxels = 0;
    this.feedbackEventLogs = [];
    this.lastCalibrationRecord = null;
    this.applyPlanetFieldsToFvm();
    this.seedInitialState(this.mode);
    this.registerDefaultCouplingZones(planet.baseRadius);

    if (this.computeBackend === 'webgpu' && this.gpuRendererRef) {
      this.configureComputeBackend(true, this.resolutionCells, 'webgpu', this.gpuRendererRef);
    }
  }

  private applyPlanetFieldsToFvm(): void {
    const planet = this.boundPlanet;
    if (!planet) return;

    const n = this.grid.cellsPerAxis;
    const r0 = planet.baseRadius;
    const minShellR = r0 * 0.62;
    const maxShellR = r0 * 1.22;

    for (let iz = 0; iz < n; iz++) {
      for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
          const [wx, wy, wz] = this.grid.cellCenterWorld(ix, iy, iz);
          const idx = this.grid.cellIndex(ix, iy, iz);
          const r = Math.hypot(wx, wy, wz);

          if (r < minShellR || r > maxShellR) {
            this.grid.activeMask[idx] = 0;
            this.grid.porosity[idx] = 0;
            this.grid.feedPortMask[idx] = 0;
            this.grid.exhaustPortMask[idx] = 0;
            continue;
          }

          const d = planet.sampleDensity(wx, wy, wz, true);
          const mat = planet.sampleNearestMaterial(wx, wy, wz);
          const atmo = sampleAtmosphereAtPoint(wx, wy, wz, r0, this.boundAtmos, 0);
          const therm = sampleThermalField(
            wx,
            wy,
            wz,
            r0,
            this.boundSunDir,
            this.boundAtmos,
            this.boundThermal,
            0,
            mat,
            0,
            0,
          );

          const nearSurface = Math.abs(d) < this.grid.voxelSize * 2.2;
          const openAir = d <= 0;
          const por = openAir
            ? 1.0
            : nearSurface
              ? 0.65
              : mat === MaterialId.Crystal || mat === MaterialId.Sandstone
                ? 0.45
                : 0.22;

          this.grid.activeMask[idx] = 1;
          this.grid.porosity[idx] = por;
          this.grid.temperatureK[idx] = clamp(therm.tempK, 140, 2200);
          this.grid.pressureAtm[idx] = Math.max(
            0.05,
            atmo.pressureAtm + (d > 0 ? Math.max(0, r0 - r) * 8.0 : 0),
          );

          const invR = r > 1e-4 ? 1 / r : 1;
          const rx = wx * invR;
          const ry = wy * invR;
          const rz = wz * invR;
          const sunDot = rx * this.boundSunDir[0] + ry * this.boundSunDir[1] + rz * this.boundSunDir[2];
          const zonal = 0.28 * (0.4 + 0.6 * Math.sqrt(Math.max(0, 1 - ry * ry)));
          const updraft = 0.08 * sunDot;
          this.grid.velX[idx] = -rz * zonal + rx * updraft;
          this.grid.velY[idx] = ry * updraft;
          this.grid.velZ[idx] = rx * zonal + rz * updraft;
        }
      }
    }

    this.grid.rebuildActiveCellList();
    this.grid.syncInternalEnergyFromTemp();
  }

  public registerDefaultCouplingZones(baseRadius = this.grid.baseRadius): void {
    this.couplingRegistry.clear();
    const boxHalf = Math.max(0.8, baseRadius * 0.18);
    const cy = baseRadius * 0.96;
    this.couplingRegistry.registerZone({
      id: 'pic_zone_hydrothermal',
      label: '赤道热泉 · 微观随机校准耦合区',
      scaleKind: 'molecular_md_calibration',
      aabbMin: [-boxHalf, cy - boxHalf * 0.6, -boxHalf],
      aabbMax: [boxHalf, cy + boxHalf * 0.9, boxHalf],
      active: true,
      description: 'PIC拉格朗日耦合AABB：推演短时标局部朗之万碰撞，回传有效扩散率与(A_eff, Ea_eff)',
    });
  }

  public resetDemo(mode: MetabolismDemoMode): void {
    this.mode = mode;
    if (this.boundPlanet) {
      this.grid = this.createGridForMode(
        mode,
        this.grid.chunksPerAxis,
        this.boundPlanet.worldHalf,
        this.boundPlanet.baseRadius,
      );
      this.applyPlanetFieldsToFvm();
      this.registerDefaultCouplingZones(this.boundPlanet.baseRadius);
    } else {
      this.grid = this.createGridForMode(
        mode,
        this.grid.chunksPerAxis,
        this.grid.worldHalf,
        this.grid.baseRadius,
      );
      this.registerDefaultCouplingZones(this.grid.baseRadius);
    }
    this.mineralAccumulator = new Float32Array(this.grid.totalCells);
    this.lastCalibrationRecord = null;
    this.seedInitialState(mode);
    this.simAccumulatorSec = 0;
    if (this.computeBackend === 'webgpu' && this.gpuSolver && this.gpuRendererRef) {
      this.gpuStepCounter = 0;
      this.gpuSimTimeSec = 0;
      this.seedGpuSolverFromPlanet();
    }
  }

  public seedInitialState(mode: MetabolismDemoMode): void {
    const n = this.grid.cellsPerAxis;
    const S = this.grid.hypergraph.numSpecies;
    this.grid.speciesConc.fill(0);
    this.grid.fluxX.fill(0);
    this.grid.fluxY.fill(0);
    this.grid.fluxZ.fill(0);
    this.grid.entropyProdRate.fill(0);
    this.grid.feedPortMask.fill(0);
    this.grid.exhaustPortMask.fill(0);
    this.grid.stepIndex = 0;
    this.grid.simTimeSec = 0;
    this.history = [];

    const r0 = this.grid.baseRadius;

    for (let iz = 0; iz < n; iz++) {
      for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
          const idx = this.grid.cellIndex(ix, iy, iz);
          if (this.grid.activeMask[idx] === 0) continue;

          const [wx, wy, wz] = this.grid.cellCenterWorld(ix, iy, iz);
          const base = idx * S;

          if (mode === 'closed_equilibrium') {
            const hemiBias = wx >= 0 ? 1.85 : 0.35;
            this.grid.speciesConc[base + 0] = hemiBias;
            this.grid.speciesConc[base + 1] = 0.05;
            this.grid.speciesConc[base + 2] = 0.0;
            if (!this.boundPlanet) {
              this.grid.temperatureK[idx] = 320 + (wx / Math.max(1, this.grid.worldHalf)) * 25;
              this.grid.pressureAtm[idx] = 1.0;
              this.grid.velX[idx] = -wz * 0.04;
              this.grid.velZ[idx] = wx * 0.04;
            }
          } else {
            const r = Math.hypot(wx, wy, wz);
            const isFeedBand = !this.boundPlanet
              ? ix <= 2 || Math.abs(wx) < this.grid.voxelSize * 2.2
              : r <= r0 * 1.04;
            const isExhaustBand = !this.boundPlanet
              ? ix >= n - 3 || Math.abs(wx) > this.grid.voxelSize * 2.0
              : r >= r0 * 0.88;

            this.grid.feedPortMask[idx] = isFeedBand ? 1 : 0;
            this.grid.exhaustPortMask[idx] = isExhaustBand ? 1 : 0;

            this.grid.speciesConc[base + 0] = 1.65;
            const dSeed1 = Math.hypot(wx, wy - r0 * 0.96, wz);
            const dSeed2 = Math.hypot(wx - r0 * 0.72, wy + r0 * 0.3, wz - r0 * 0.4);
            const seedRad = Math.max(this.grid.voxelSize * 2.6, r0 * 0.28);
            const hasSeed = dSeed1 < seedRad || dSeed2 < seedRad;
            this.grid.speciesConc[base + 1] = hasSeed ? 1.15 : 0.02;
            this.grid.speciesConc[base + 2] = 0.05;

            if (!this.boundPlanet) {
              this.grid.temperatureK[idx] = 325;
              this.grid.pressureAtm[idx] = 1.4;
              this.grid.velX[idx] = -wz * 0.05;
              this.grid.velZ[idx] = wx * 0.05;
            } else {
              if (this.grid.temperatureK[idx] < 275) {
                this.grid.temperatureK[idx] = 295;
              }
            }
          }
        }
      }
    }

    this.grid.syncInternalEnergyFromTemp();
    this.grid.revision++;
    this.grid.publishRenderSnapshot();
    const initTel = this.grid.lastTelemetry;
    const m0 = this.grid.computeTotalMassKg();
    this.grid.lastTelemetry = {
      ...initTel,
      stepIndex: 0,
      simTimeSec: 0,
      boundaryMode: this.grid.boundaryMode,
      activeCellCount: this.grid.getActiveCellCount(),
      conservation: {
        ...initTel.conservation,
        totalMassPreKg: m0,
        totalMassPostFluxKg: m0,
        totalMassPostReactKg: m0,
        relativeError: 0,
        conserved: true,
      },
    };
    this.stepCpuOnce(0.02);
  }

  public injectPerturbation(
    wx: number,
    wy: number,
    wz: number,
    speciesIndex: number,
    amountMolM3: number,
    radiusM?: number,
  ): number {
    const rad = radiusM ?? Math.max(this.grid.voxelSize * 2.4, this.grid.baseRadius * 0.22);
    if (this.computeBackend === 'webgpu' && this.gpuSolver) {
      const touched = this.gpuSolver.injectGpuPerturbation(wx, wy, wz, speciesIndex, amountMolM3, rad);
      if (touched > 0) this.gpuShaderRevision++;
      return touched;
    }

    const n = this.grid.cellsPerAxis;
    const S = this.grid.hypergraph.numSpecies;
    const sIdx = clamp(Math.floor(speciesIndex), 0, S - 1);
    const radSq = rad * rad;
    let touched = 0;

    for (let iz = 0; iz < n; iz++) {
      for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
          const idx = this.grid.cellIndex(ix, iy, iz);
          if (this.grid.activeMask[idx] === 0) continue;
          const [cx, cy, cz] = this.grid.cellCenterWorld(ix, iy, iz);
          const dSq = (cx - wx) ** 2 + (cy - wy) ** 2 + (cz - wz) ** 2;
          if (dSq <= radSq) {
            const w = 1 - Math.sqrt(dSq) / rad;
            this.grid.speciesConc[idx * S + sIdx] += amountMolM3 * w;
            touched++;
          }
        }
      }
    }
    if (touched > 0) {
      this.grid.revision++;
      this.grid.publishRenderSnapshot();
    }
    return touched;
  }

  public advanceAsync(renderDtSec: number, maxStepsPerTick = 3): boolean {
    if (!this.running) return false;
    this.simAccumulatorSec += clamp(renderDtSec, 0, 0.1) * clamp(this.timeScale, 0.1, 8.0);
    let stepped = false;
    let steps = 0;
    while (this.simAccumulatorSec >= this.fixedDtSec && steps < maxStepsPerTick) {
      this.stepOnce(this.fixedDtSec);
      this.simAccumulatorSec -= this.fixedDtSec;
      steps++;
      stepped = true;
    }
    if (this.simAccumulatorSec > this.fixedDtSec * 4) {
      this.simAccumulatorSec = this.fixedDtSec;
    }

    if (this.autoCalibrateEnabled) {
      this.autoCalibrateTimerSec += renderDtSec;
      if (this.autoCalibrateTimerSec >= 2.2) {
        this.autoCalibrateTimerSec = 0;
        this.runMicroCalibration();
      }
    }
    return stepped;
  }

  private stepCpuOnce(dtSec: number): FvmStepTelemetry {
    const tel = this.grid.step(dtSec);
    this.recordHistory(tel);
    return tel;
  }

  public stepOnce(dtSec = this.fixedDtSec): FvmStepTelemetry {
    if (this.computeBackend === 'webgpu' && this.gpuSolver && this.gpuRendererRef) {
      this.gpuSolver.dispatchStep(this.gpuRendererRef, {
        dtSec,
        boundaryMode: this.grid.boundaryMode,
        feedRatePerSec: this.grid.feedRatePerSec,
        exhaustRatePerSec: this.grid.exhaustRatePerSec,
        feedConcentrationMolM3: this.grid.feedConcentrationMolM3,
        ambientTempK: this.grid.ambientTempK,
      });
      this.gpuStepCounter++;
      this.gpuSimTimeSec += dtSec;
      this.gpuShaderRevision++;

      if (this.gpuStepCounter % 6 === 0) {
        this.gpuSolver.scheduleAsyncReadback(this.gpuRendererRef);
      }

      const prevTel = this.gpuLastTelemetry ?? this.grid.lastTelemetry;
      const tel = this.gpuSolver.readGpuTelemetry(
        this.gpuStepCounter,
        this.gpuSimTimeSec,
        this.grid.boundaryMode,
        prevTel,
      );
      this.gpuLastTelemetry = tel;
      if (this.gpuStepCounter % 6 === 0) {
        this.recordHistory(tel);
      }
      return tel;
    }

    return this.stepCpuOnce(dtSec);
  }

  private recordHistory(tel: FvmStepTelemetry): void {
    const point: MetabolismTimePoint = {
      stepIndex: tel.stepIndex,
      simTimeSec: tel.simTimeSec,
      meanConcentrations: Array.from(tel.meanConcentrations),
      spatialStdDev: Array.from(tel.speciesSpatialStdDev),
      meanTempK: tel.meanTempK,
      totalEntropyProdRate: tel.totalEntropyProdRate,
      relativeMassError: tel.conservation.relativeError,
    };
    this.history.push(point);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * Executes Stage 2 Pillar 2: PIC AABB Local Micro-Scale Calibration.
   * Samples fine-grained Eulerian boundary conditions inside the marked AABB,
   * runs short-timescale Langevin + collisional particle sampling locally,
   * and commits calibrated effective diffusivity + Arrhenius (A_eff, Ea_eff) back to both CPU & GPU hypergraphs.
   */
  public runMicroCalibration(
    zoneId?: string,
    config: MicroCalibrationConfig = DEFAULT_MICRO_CALIBRATION_CONFIG,
  ): MicroCalibrationRecord | null {
    const zones = this.couplingRegistry.listZones();
    const target = zoneId ? zones.find((z) => z.id === zoneId) : zones[0];
    if (!target) return null;

    const { boundary, record } = runLocalMicroCalibration(
      target,
      this.couplingRegistry,
      this.grid,
      this.grid.hypergraph,
      config,
    );
    this.lastZoneBoundary = boundary;
    this.lastCalibrationRecord = record;
    this.calibrationHistoryCount++;

    if (this.gpuSolver) {
      this.gpuSolver.updateHypergraphKinetics(this.grid.hypergraph);
    }

    this.pushFeedbackLog(
      this.getCurrentStepIndex(),
      'porosity_sync',
      `AABB 微观校准完成: D_X=${(record.diffusivityMultipliers[1] ?? 1).toFixed(2)}x, ΔEa=${Math.round((record.reactionDeltas[0]?.calibratedEaJ ?? 0) - (record.reactionDeltas[0]?.baseEaJ ?? 0))}J`,
    );
    return record;
  }

  /**
   * Preserved Stage 1 compatibility entrypoint; now delegates to full local micro-calibration pipeline.
   */
  public testPicCouplingInterface(zoneId?: string): LagrangianBoundaryState | null {
    this.runMicroCalibration(zoneId);
    return this.lastZoneBoundary;
  }

  /**
   * Evaluates & applies Stage 2 Pillar 3 Bidirectional Planetary Feedback (throttled every ~0.65s).
   * Pushes exothermic hotspots + mineralized Crystal/Basalt voxel writes back onto VoxelPlanet.
   */
  public tickPlanetaryFeedback(
    renderDtSec: number,
    planet: VoxelPlanet,
    onApplyHotspots: (hotspots: ThermalHotspot[]) => void,
    onApplyMineralOp: (op: {
      wx: number;
      wy: number;
      wz: number;
      radius: number;
      mode: 'paint' | 'build' | 'carve';
      strength: number;
      material: MaterialId;
    }) => void,
  ): boolean {
    if (!this.running) return false;
    if (!this.feedbackConfig.thermalFeedbackEnabled && !this.feedbackConfig.mineralizationEnabled) {
      if (this.activeThermalHotspotsCount > 0) {
        onApplyHotspots([]);
        this.activeThermalHotspotsCount = 0;
        this.peakExothermicDeltaC = 0;
      }
      return false;
    }

    this.feedbackAccumulatorSec += clamp(renderDtSec, 0, 0.1);
    if (this.feedbackAccumulatorSec < 0.65) return false;
    const elapsed = this.feedbackAccumulatorSec;
    this.feedbackAccumulatorSec = 0;

    const evalRes =
      this.computeBackend === 'webgpu' && this.gpuSolver && this.gpuSolver.lastMacroBins.length > 0
        ? evaluateFeedbackCandidatesFromGpuBins(
            this.gpuSolver.lastMacroBins,
            planet,
            this.grid.ambientTempK,
            this.gpuSolver.voxelSize,
            this.feedbackConfig,
          )
        : evaluateFeedbackCandidatesFromCpuGrid(
            this.grid,
            planet,
            this.feedbackConfig,
            this.mineralAccumulator ?? undefined,
            elapsed,
          );

    this.activeThermalHotspotsCount = evalRes.hotspots.length;
    this.peakExothermicDeltaC = evalRes.peakDeltaC;
    onApplyHotspots(evalRes.hotspots);

    let appliedOps = 0;
    for (const op of evalRes.mineralOps) {
      onApplyMineralOp(op);
      appliedOps++;
      if (op.reason === 'acid_etch') {
        this.totalCorrodedVoxels++;
      } else {
        this.totalMineralizedVoxels++;
      }
    }
    this.lastMineralBatchCount = appliedOps;

    if (appliedOps > 0) {
      const top = evalRes.mineralOps[0];
      const tag =
        top.reason === 'acid_etch'
          ? '酸蚀孔隙侵蚀'
          : top.reason === 'mineral_basalt'
            ? '高温玄武质壳沉积'
            : '生物自催化晶体析出';
      this.pushFeedbackLog(
        this.getCurrentStepIndex(),
        top.reason,
        `${tag} ×${appliedOps} (峰值放热 +${evalRes.peakDeltaC.toFixed(1)}°C)`,
      );
    }

    return appliedOps > 0 || evalRes.hotspots.length > 0;
  }

  /**
   * Synchronizes local terrain brush sculpting back into FVM porosity & active control-volume boundaries.
   */
  public syncLocalTerrainPorosity(
    wx: number,
    wy: number,
    wz: number,
    radius: number,
    planet: VoxelPlanet,
  ): number {
    const synced = syncLocalBrushToCpuFvmGrid(this.grid, planet, wx, wy, wz, radius);
    this.lastPorositySyncVoxels = synced;

    if (this.computeBackend === 'webgpu' && this.gpuSolver && synced > 0) {
      const half = this.gpuSolver.worldHalf;
      const vSize = this.gpuSolver.voxelSize;
      const n = this.gpuSolver.cellsPerAxis;
      const centerCell: [number, number, number] = [
        clamp(Math.floor((wx + half) / vSize), 0, n - 1),
        clamp(Math.floor((wy + half) / vSize), 0, n - 1),
        clamp(Math.floor((wz + half) / vSize), 0, n - 1),
      ];
      const radCells = Math.max(1, Math.ceil((radius + vSize) / vSize));
      const minShellR = planet.baseRadius * 0.62;
      const maxShellR = planet.baseRadius * 1.22;

      this.gpuSolver.syncLocalPorositySlice(centerCell, radCells, (ix, iy, iz) => {
        const cx = -half + (ix + 0.5) * vSize;
        const cy = -half + (iy + 0.5) * vSize;
        const cz = -half + (iz + 0.5) * vSize;
        const r = Math.hypot(cx, cy, cz);
        if (r < minShellR || r > maxShellR) {
          return { active: false, porosity: 0 };
        }
        const d = planet.sampleDensity(cx, cy, cz, true);
        const m = planet.sampleNearestMaterial(cx, cy, cz);
        const por =
          d <= 0
            ? 1.0
            : Math.abs(d) < vSize * 2.2
              ? 0.65
              : m === MaterialId.Crystal || m === MaterialId.Sandstone
                ? 0.45
                : 0.22;
        return { active: true, porosity: por };
      });
      this.gpuShaderRevision++;
    }

    return synced;
  }

  private pushFeedbackLog(
    stepIndex: number,
    kind: PlanetaryFeedbackEventLog['kind'],
    summary: string,
  ): void {
    this.feedbackEventLogs.unshift({ stepIndex, kind, summary });
    if (this.feedbackEventLogs.length > 6) {
      this.feedbackEventLogs.length = 6;
    }
  }

  private getCurrentStepIndex(): number {
    return this.computeBackend === 'webgpu' && this.gpuSolver
      ? this.gpuStepCounter
      : this.grid.stepIndex;
  }

  public runAutocatalyticBifurcationSweep(): BifurcationSweepReport {
    const feedRates = [
      0.04, 0.08, 0.12, 0.16, 0.20, 0.25, 0.30, 0.36, 0.42, 0.50, 0.60, 0.72, 0.85,
    ];
    const points: BifurcationSweepPoint[] = [];
    let criticalFeedRate: number | null = null;
    let prevX = 0;
    let maxJump = 0;
    let maxSigma = 0;

    for (const feedF of feedRates) {
      const hyper = createOpenAutocatalyticHypergraph();
      const testGrid = new EulerianFvmGrid({
        chunksPerAxis: 1,
        worldHalf: 4.0,
        baseRadius: 3.0,
        hypergraph: hyper,
        boundaryMode: 'open',
        feedRatePerSec: feedF,
        exhaustRatePerSec: 0.36,
        feedSpeciesIndex: 0,
        feedConcentrationMolM3: 2.6,
        ambientTempK: 325,
        ambientPressureAtm: 1.4,
      });

      const n = testGrid.cellsPerAxis;
      const S = hyper.numSpecies;
      for (let iz = 0; iz < n; iz++) {
        for (let iy = 0; iy < n; iy++) {
          for (let ix = 0; ix < n; ix++) {
            const idx = testGrid.cellIndex(ix, iy, iz);
            testGrid.feedPortMask[idx] = 1;
            testGrid.exhaustPortMask[idx] = 1;
            testGrid.temperatureK[idx] = 325;
            testGrid.pressureAtm[idx] = 1.4;
            const base = idx * S;
            testGrid.speciesConc[base + 0] = 1.4;
            const inSeed = ix < 3 && iy < 3 && iz < 3;
            testGrid.speciesConc[base + 1] = inSeed ? 0.95 : 0.04;
            testGrid.speciesConc[base + 2] = 0.02;
          }
        }
      }
      testGrid.syncInternalEnergyFromTemp();

      let tel = testGrid.lastTelemetry;
      for (let s = 0; s < 140; s++) {
        tel = testGrid.step(0.08);
      }

      const xMean = tel.meanConcentrations[1] ?? 0;
      const sMean = tel.meanConcentrations[0] ?? 0;
      const wMean = tel.meanConcentrations[2] ?? 0;
      const xStd = tel.speciesSpatialStdDev[1] ?? 0;
      const sigma = tel.totalEntropyProdRate;
      const activeBranch = xMean > 0.25;

      if (criticalFeedRate === null && activeBranch) {
        criticalFeedRate = feedF;
      }
      const jump = xMean - prevX;
      if (jump > maxJump) maxJump = jump;
      if (sigma > maxSigma) maxSigma = sigma;
      prevX = xMean;

      points.push({
        feedRatePerSec: feedF,
        steadySubstrateS: sMean,
        steadyAutocatalystX: xMean,
        steadyWasteW: wMean,
        spatialStdDevX: xStd,
        entropyProdRate: sigma,
        regime: activeBranch ? 'dissipative_branch' : 'extinction',
      });
    }

    const report: BifurcationSweepReport = {
      criticalFeedRate,
      jumpMagnitudeX: maxJump,
      maxEntropyProdRate: maxSigma,
      points,
    };
    this.bifurcationReport = report;
    return report;
  }

  public getReadOnlyRenderView(): FvmRenderFieldView {
    return this.grid.getReadOnlyRenderView();
  }

  public getSummarySnapshot(): MetabolismSummarySnapshot {
    const gpuActive = this.computeBackend === 'webgpu' && this.gpuSolver !== null;
    const telemetry = gpuActive
      ? (this.gpuLastTelemetry ?? this.grid.lastTelemetry)
      : this.grid.lastTelemetry;
    return {
      mode: this.mode,
      boundaryMode: this.grid.boundaryMode,
      running: this.running,
      timeScale: this.timeScale,
      fixedDtSec: this.fixedDtSec,
      visualChannel: this.visualChannel,
      simRevision: gpuActive ? this.gpuStepCounter : this.grid.revision,
      renderRevision: gpuActive ? this.gpuShaderRevision : this.grid.getReadOnlyRenderView().revision,
      computeBackend: this.computeBackend,
      webGpuSupported: this.webGpuSupported,
      resolutionCells: this.resolutionCells,
      totalGridVoxels: this.resolutionCells ** 3,
      gpuZeroReadbackActive: gpuActive,
      hypergraph: this.grid.hypergraph,
      telemetry,
      history: this.history.slice(),
      zones: this.couplingRegistry.listZones(),
      lastZoneBoundary: this.lastZoneBoundary,
      lastCalibrationRecord: this.lastCalibrationRecord,
      calibrationHistoryCount: this.calibrationHistoryCount,
      autoCalibrateEnabled: this.autoCalibrateEnabled,
      feedbackConfig: { ...this.feedbackConfig },
      feedbackStats: {
        activeThermalHotspots: this.activeThermalHotspotsCount,
        peakExothermicDeltaC: this.peakExothermicDeltaC,
        totalMineralizedVoxels: this.totalMineralizedVoxels,
        totalCorrodedVoxels: this.totalCorrodedVoxels,
        lastMineralBatchCount: this.lastMineralBatchCount,
        lastPorositySyncVoxels: this.lastPorositySyncVoxels,
        eventLogs: this.feedbackEventLogs.slice(),
      },
      bifurcationReport: this.bifurcationReport,
    };
  }
}

export function sampleFvmRenderColor(
  view: FvmRenderFieldView,
  wx: number,
  wy: number,
  wz: number,
  channel: MetabolismVisualChannel,
  outRgb: [number, number, number],
): boolean {
  const n = view.cellsPerAxis;
  const gx = (wx + view.worldHalf) / view.voxelSize;
  const gy = (wy + view.worldHalf) / view.voxelSize;
  const gz = (wz + view.worldHalf) / view.voxelSize;

  if (gx < 0 || gy < 0 || gz < 0 || gx >= n || gy >= n || gz >= n) {
    return false;
  }

  const ix = clamp(Math.floor(gx), 0, n - 1);
  const iy = clamp(Math.floor(gy), 0, n - 1);
  const iz = clamp(Math.floor(gz), 0, n - 1);
  const idx = ix + iy * n + iz * n * n;

  if (view.activeMask[idx] === 0) {
    return false;
  }

  if (channel === 'species') {
    const S = view.numSpecies;
    const base = idx * S;
    let totalC = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let s = 0; s < S; s++) {
      const c = Math.max(0, view.speciesConc[base + s]);
      const col = view.speciesColors[s] ?? [0.5, 0.5, 0.5];
      r += col[0] * c;
      g += col[1] * c;
      b += col[2] * c;
      totalC += c;
    }
    if (totalC > 1e-5) {
      const lumScale = clamp(totalC / 2.2, 0.32, 1.15);
      outRgb[0] = clamp((r / totalC) * lumScale, 0.04, 1.0);
      outRgb[1] = clamp((g / totalC) * lumScale, 0.04, 1.0);
      outRgb[2] = clamp((b / totalC) * lumScale, 0.04, 1.0);
    } else {
      outRgb[0] = 0.14;
      outRgb[1] = 0.18;
      outRgb[2] = 0.25;
    }
    return true;
  }

  if (channel === 'energy') {
    const tempC = view.temperatureK[idx] - 273.15;
    const rgb = temperatureToRgb(tempC);
    outRgb[0] = rgb[0];
    outRgb[1] = rgb[1];
    outRgb[2] = rgb[2];
    return true;
  }

  if (channel === 'phase') {
    const ph = view.phase[idx] as MatterPhase;
    if (ph === MatterPhase.Solid) {
      outRgb[0] = 0.36;
      outRgb[1] = 0.45;
      outRgb[2] = 0.58;
    } else if (ph === MatterPhase.Liquid) {
      outRgb[0] = 0.08;
      outRgb[1] = 0.68;
      outRgb[2] = 0.92;
    } else if (ph === MatterPhase.Gas) {
      outRgb[0] = 0.95;
      outRgb[1] = 0.68;
      outRgb[2] = 0.22;
    } else if (ph === MatterPhase.Supercritical) {
      outRgb[0] = 0.88;
      outRgb[1] = 0.26;
      outRgb[2] = 0.78;
    } else {
      outRgb[0] = 1.0;
      outRgb[1] = 0.92;
      outRgb[2] = 0.55;
    }
    return true;
  }

  const mag = Math.hypot(view.fluxX[idx], view.fluxY[idx], view.fluxZ[idx]);
  const norm = clamp(mag * 42.0, 0, 1);
  outRgb[0] = clamp(0.08 + norm * 0.9, 0, 1);
  outRgb[1] = clamp(0.18 + Math.sin(norm * Math.PI * 0.85) * 0.72, 0, 1);
  outRgb[2] = clamp(0.45 + (1 - norm) * 0.42 - norm * 0.25, 0, 1);
  return true;
}

export { MATTER_PHASE_LABELS };
