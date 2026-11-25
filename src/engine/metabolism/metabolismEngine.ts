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
  CellularBioTelemetry,
  computeCellularBioTelemetry,
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
  computeMaterialElementalBreakdown,
  ElementMassFractionItem,
  VOXEL_MATERIAL_COMPOSITIONS,
  VoxelMaterialComposition,
} from './periodicTable';
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
  ActiveVolcanoSite,
  buildManualGeologicalEventOps,
  DEFAULT_GEOLOGICAL_EVOLUTION_CONFIG,
  evaluateTectonicAndFluvialCandidatesFromCpuGrid,
  evaluateTectonicCandidatesFromGpuBins,
  fractureFaultPorosityInFvmGrid,
  GeologicalEvalOutput,
  GeologicalEventKind,
  GeologicalEventRecord,
  GeologicalEvolutionConfig,
  GeologicalEvolutionStats,
  GeologicalFluidOp,
  GeologicalTerrainOp,
  injectVolcanicDegassingIntoFvmGrid,
  SeismicEventMarker,
} from './geologicalEvolution';
import {
  CompiledReactionHypergraph,
  createCellularMetabolismHypergraph,
  createClosedEquilibriumHypergraph,
  createOpenAutocatalyticHypergraph,
  createPlanetaryCarbonWaterHypergraph,
  createPlanetaryHydrologyHypergraph,
  evaluateArrheniusRateConstant,
  evaluateTpWindowGate,
} from './reactionHypergraph';

export type MetabolismDemoMode =
  | 'closed_equilibrium'
  | 'open_autocatalytic'
  | 'planetary_carbon_water'
  | 'cellular_metabolism'
  | 'planetary_hydrology';
export type MetabolismVisualChannel = 'species' | 'energy' | 'phase' | 'flux' | 'mineral' | 'rate';

export interface VoxReactionEvaluation {
  readonly reactionIndex: number;
  readonly uiName: string;
  readonly uiEquationLabel: string;
  readonly tpGate: number;
  readonly kf: number;
  readonly kr: number;
  readonly forwardRate: number;
  readonly reverseRate: number;
  readonly netRate: number;
  readonly enthalpyRateWm3: number;
}

export interface VoxChemicalProfile {
  readonly cellCoords: [number, number, number];
  readonly cellCenterWorld: [number, number, number];
  readonly voxelSize: number;
  readonly cellVolumeM3: number;
  readonly materialId: MaterialId;
  readonly materialComposition: VoxelMaterialComposition;
  readonly elementalBreakdown: ReadonlyArray<ElementMassFractionItem>;
  readonly porosity: number;
  readonly temperatureK: number;
  readonly pressureAtm: number;
  readonly internalEnergyJm3: number;
  readonly heatCapacityJm3K: number;
  readonly entropyProdRate: number;
  readonly voxelMassKg: number;
  readonly phase: MatterPhase;
  readonly flux: [number, number, number];
  readonly velocity: [number, number, number];
  readonly dominantSpeciesIndex: number;
  readonly reactionEvaluations: ReadonlyArray<VoxReactionEvaluation>;
  readonly speciesConcentrations: ReadonlyArray<{
    readonly index: number;
    readonly uiLabel: string;
    readonly formulaTag: string;
    readonly molPerM3: number;
    readonly kgPerM3: number;
    readonly colorRgb: readonly [number, number, number];
  }>;
}

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
  readonly cellularBio: CellularBioTelemetry;
  readonly history: ReadonlyArray<MetabolismTimePoint>;
  readonly zones: ReadonlyArray<LagrangianCouplingZone>;
  readonly lastZoneBoundary: LagrangianBoundaryState | null;
  readonly lastCalibrationRecord: MicroCalibrationRecord | null;
  readonly calibrationHistoryCount: number;
  readonly autoCalibrateEnabled: boolean;
  readonly feedbackConfig: PlanetaryFeedbackConfig;
  readonly feedbackStats: PlanetaryFeedbackStats;
  readonly geologicalConfig: GeologicalEvolutionConfig;
  readonly geologicalStats: GeologicalEvolutionStats;
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

  // Stage 5: Deep Geological Evolution ("沧海桑田") state
  public geologicalConfig: GeologicalEvolutionConfig = { ...DEFAULT_GEOLOGICAL_EVOLUTION_CONFIG };
  private tectonicAccumulator: Float32Array | null = null;
  private geologicalAgeMyr = 0;
  private activeVolcanoes: ActiveVolcanoSite[] = [];
  private recentQuakes: SeismicEventMarker[] = [];
  private recentGeoEvents: GeologicalEventRecord[] = [];
  private totalVolcanoCount = 0;
  private totalQuakeCount = 0;
  private lastQuakeMagMw: number | null = null;
  private upliftedVoxels = 0;
  private erodedVoxels = 0;
  private volcanicConeVoxels = 0;
  private faultFractureVoxels = 0;
  private seaLevelOffsetM = 0;
  private manualGeoEventSeq = 0;

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
    this.tectonicAccumulator = new Float32Array(this.grid.totalCells);
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
        : mode === 'planetary_carbon_water'
          ? createPlanetaryCarbonWaterHypergraph()
          : mode === 'cellular_metabolism'
            ? createCellularMetabolismHypergraph()
            : mode === 'planetary_hydrology'
              ? createPlanetaryHydrologyHypergraph()
              : createOpenAutocatalyticHypergraph();

    const isClosed = mode === 'closed_equilibrium';
    const ambientTempK =
      mode === 'cellular_metabolism'
        ? 310
        : mode === 'planetary_carbon_water' || mode === 'planetary_hydrology'
          ? 294
          : 315;

    return new EulerianFvmGrid({
      chunksPerAxis,
      worldHalf,
      baseRadius,
      hypergraph,
      boundaryMode: isClosed ? 'closed' : 'open',
      feedRatePerSec: isClosed ? 0 : mode === 'cellular_metabolism' ? 0.24 : 0.36,
      exhaustRatePerSec: isClosed ? 0 : mode === 'cellular_metabolism' ? 0.16 : 0.26,
      feedSpeciesIndex: 0,
      feedConcentrationMolM3: mode === 'cellular_metabolism' ? 1.8 : 2.4,
      ambientTempK,
      ambientPressureAtm: 1.15,
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
      this.mode,
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
    this.tectonicAccumulator = new Float32Array(this.grid.totalCells);
    this.totalMineralizedVoxels = 0;
    this.totalCorrodedVoxels = 0;
    this.feedbackEventLogs = [];
    this.resetGeologicalStats();
    this.lastCalibrationRecord = null;
    this.applyPlanetFieldsToFvm();
    this.seedInitialState(this.mode);
    this.registerDefaultCouplingZones(planet.baseRadius);

    if (this.computeBackend === 'webgpu' && this.gpuRendererRef) {
      this.configureComputeBackend(true, this.resolutionCells, 'webgpu', this.gpuRendererRef);
    }
  }

  private resetGeologicalStats(): void {
    this.geologicalAgeMyr = 0;
    this.activeVolcanoes = [];
    this.recentQuakes = [];
    this.recentGeoEvents = [];
    this.totalVolcanoCount = 0;
    this.totalQuakeCount = 0;
    this.lastQuakeMagMw = null;
    this.upliftedVoxels = 0;
    this.erodedVoxels = 0;
    this.volcanicConeVoxels = 0;
    this.faultFractureVoxels = 0;
    this.seaLevelOffsetM = 0;
    this.manualGeoEventSeq = 0;
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
    this.tectonicAccumulator = new Float32Array(this.grid.totalCells);
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
          } else if (mode === 'planetary_carbon_water') {
            // [CO2, H2O(g), H2O(l), CH2O, O2, CH4]
            const r = Math.hypot(wx, wy, wz);
            const invR = r > 1e-4 ? 1 / r : 1;
            const ry = wy * invR;
            const sunDot = (wx * this.boundSunDir[0] + wy * this.boundSunDir[1] + wz * this.boundSunDir[2]) * invR;
            const openAir = this.grid.porosity[idx] > 0.85;
            const nearSurf = this.grid.porosity[idx] > 0.52;
            const inProtocell = Math.hypot(wx, wy - r0 * 0.96, wz) < r0 * 0.25;

            this.grid.feedPortMask[idx] = r <= r0 * 1.03 ? 1 : 0;
            this.grid.exhaustPortMask[idx] = r >= r0 * 0.88 ? 1 : 0;

            this.grid.speciesConc[base + 0] = openAir ? 1.45 : 0.65; // CO2
            this.grid.speciesConc[base + 1] = openAir ? Math.max(0.18, (sunDot + 0.45) * 0.65) : 0.08; // H2O(g)
            this.grid.speciesConc[base + 2] = Math.abs(ry) < 0.55 ? 2.1 : nearSurf ? 1.2 : 0.45; // H2O(l)
            this.grid.speciesConc[base + 3] = inProtocell ? 1.35 : nearSurf && Math.abs(ry) < 0.72 ? 0.82 : 0.08; // CH2O
            this.grid.speciesConc[base + 4] = openAir ? 0.95 : 0.22; // O2
            this.grid.speciesConc[base + 5] = inProtocell ? 0.42 : 0.08; // CH4

            if (!this.boundPlanet) {
              this.grid.temperatureK[idx] = clamp(292 + sunDot * 28 - Math.abs(ry) * 34, 240, 390);
              this.grid.pressureAtm[idx] = 1.05;
              this.grid.velX[idx] = -wz * 0.08;
              this.grid.velZ[idx] = wx * 0.08;
            } else {
              this.grid.temperatureK[idx] = clamp(290 + sunDot * 26 - Math.abs(ry) * 32, 245, 395);
            }
          } else if (mode === 'cellular_metabolism') {
            // [C6H12O6, O2, CO2, H2O, C3H6O3, CH2O]
            const r = Math.hypot(wx, wy, wz);
            const invR = r > 1e-4 ? 1 / r : 1;
            const sunDot = (wx * this.boundSunDir[0] + wy * this.boundSunDir[1] + wz * this.boundSunDir[2]) * invR;
            const openAir = this.grid.porosity[idx] > 0.85;
            const nearSurf = this.grid.porosity[idx] > 0.52;
            const inProtocell = Math.hypot(wx, wy - r0 * 0.96, wz) < r0 * 0.26;
            const dReef = Math.hypot(wx - r0 * 0.72, wy + r0 * 0.3, wz - r0 * 0.4);
            const seedRad = Math.max(this.grid.voxelSize * 2.6, r0 * 0.28);

            this.grid.feedPortMask[idx] = r <= r0 * 1.04 ? 1 : 0;
            this.grid.exhaustPortMask[idx] = r >= r0 * 0.88 ? 1 : 0;

            this.grid.speciesConc[base + 0] = inProtocell ? 1.95 : nearSurf ? 0.78 : 0.2; // Glucose
            this.grid.speciesConc[base + 1] = openAir ? 1.35 : 0.34; // O2
            this.grid.speciesConc[base + 2] = 0.45; // CO2
            this.grid.speciesConc[base + 3] = 1.65; // H2O
            this.grid.speciesConc[base + 4] = inProtocell ? 0.16 : 0.06; // Lactate
            this.grid.speciesConc[base + 5] = inProtocell ? 1.45 : dReef < seedRad ? 0.65 : 0.08; // Biomass

            if (!this.boundPlanet) {
              this.grid.temperatureK[idx] = 310 + sunDot * 8;
              this.grid.pressureAtm[idx] = 1.1;
              this.grid.velX[idx] = -wz * 0.05;
              this.grid.velZ[idx] = wx * 0.05;
            } else {
              this.grid.temperatureK[idx] = clamp(309.5 + sunDot * 8, 275, 345);
            }
          } else if (mode === 'planetary_hydrology') {
            // [H2O(l), H2O(g), H2O(s)]
            const r = Math.hypot(wx, wy, wz);
            const invR = r > 1e-4 ? 1 / r : 1;
            const ry = wy * invR;
            const sunDot = (wx * this.boundSunDir[0] + wy * this.boundSunDir[1] + wz * this.boundSunDir[2]) * invR;
            const polar = Math.abs(ry) > 0.66;

            this.grid.feedPortMask[idx] = r <= r0 * 1.04 ? 1 : 0;
            this.grid.exhaustPortMask[idx] = r >= r0 * 0.9 ? 1 : 0;

            this.grid.speciesConc[base + 0] = polar ? 0.35 : 1.95; // H2O(l)
            this.grid.speciesConc[base + 1] = Math.max(0.12, (sunDot + 0.35) * 0.85); // H2O(g)
            this.grid.speciesConc[base + 2] = polar ? 1.85 : 0.04; // H2O(s)

            if (!this.boundPlanet) {
              this.grid.temperatureK[idx] = clamp(296 + sunDot * 24 - Math.abs(ry) * 48, 230, 385);
              this.grid.pressureAtm[idx] = 1.0;
              this.grid.velX[idx] = -wz * 0.09;
              this.grid.velZ[idx] = wx * 0.09;
            } else {
              this.grid.temperatureK[idx] = clamp(296 + sunDot * 24 - Math.abs(ry) * 48, 230, 385);
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

  public getPrimaryProtocellZoneCenter(): [number, number, number] {
    const zones = this.couplingRegistry.listZones();
    if (zones.length > 0) {
      const z = zones[0];
      return [
        0.5 * (z.aabbMin[0] + z.aabbMax[0]),
        0.5 * (z.aabbMin[1] + z.aabbMax[1]),
        0.5 * (z.aabbMin[2] + z.aabbMax[2]),
      ];
    }
    return [0, this.grid.baseRadius * 0.96, 0];
  }

  /**
   * Injects a nutrient/oxygen or metabolic catalyst burst directly into the Protocell PIC AABB zone.
   */
  public injectCellularNutrientBurst(): number {
    const [zx, zy, zz] = this.getPrimaryProtocellZoneCenter();
    let touched = 0;
    if (this.mode === 'cellular_metabolism') {
      touched += this.injectPerturbation(zx, zy, zz, 0, 2.2); // Glucose C6H12O6
      touched += this.injectPerturbation(zx, zy, zz, 1, 1.4); // O2
    } else if (this.mode === 'planetary_carbon_water') {
      touched += this.injectPerturbation(zx, zy, zz, 2, 1.8); // H2O(l)
      touched += this.injectPerturbation(zx, zy, zz, 3, 1.2); // CH2O biomass
    } else if (this.mode === 'planetary_hydrology') {
      touched += this.injectPerturbation(zx, zy, zz, 0, 2.0); // H2O(l)
    } else {
      touched += this.injectPerturbation(zx, zy, zz, 1, 1.8);
    }
    this.pushFeedbackLog(
      this.getCurrentStepIndex(),
      'thermal',
      `向热泉耦合区注入代谢养分脉冲 (${touched} Vox)`,
    );
    return touched;
  }

  /**
   * Inspects BOTH the Eulerian FVM control volume and solid planet material mineralogy at any world point.
   */
  public getVoxChemicalProfile(wx: number, wy: number, wz: number): VoxChemicalProfile {
    const [ix, iy, iz] = this.grid.worldToCell(wx, wy, wz);
    const vox = this.grid.getVoxControlVolume(ix, iy, iz);
    const matId = this.boundPlanet
      ? this.boundPlanet.sampleNearestMaterial(wx, wy, wz)
      : MaterialId.Stone;
    const matComp = VOXEL_MATERIAL_COMPOSITIONS[matId] ?? VOXEL_MATERIAL_COMPOSITIONS[MaterialId.Stone];
    const elementalBreakdown = computeMaterialElementalBreakdown(matId);
    const hg = this.grid.hypergraph;
    const S = hg.numSpecies;

    let heatCapacityJm3K = 1800.0;
    let cellMassDensKgM3 = 0;
    let dominantSpeciesIndex = 0;
    let maxConc = -1;

    const speciesConcentrations = hg.species.map((sp, i) => {
      const molPerM3 = vox.speciesConc[i] ?? 0;
      const kgPerM3 = molPerM3 * sp.molarMassKgPerMol;
      heatCapacityJm3K += molPerM3 * sp.specificHeatJPerMolK;
      cellMassDensKgM3 += kgPerM3;
      if (molPerM3 > maxConc) {
        maxConc = molPerM3;
        dominantSpeciesIndex = i;
      }
      return {
        index: sp.index,
        uiLabel: sp.uiLabel,
        formulaTag: sp.formulaTag,
        molPerM3,
        kgPerM3,
        colorRgb: sp.colorRgb,
      };
    });

    const reactionEvaluations: VoxReactionEvaluation[] = hg.reactions.map((rxn, rIdx) => {
      const tpGate = evaluateTpWindowGate(rxn, vox.temperatureK, vox.pressureAtm);
      const rowOff = rIdx * S;
      const kf =
        evaluateArrheniusRateConstant(
          hg.calibratedForwardA[rIdx],
          hg.calibratedForwardEaJ[rIdx],
          rxn.tempExponentBeta ?? 0,
          vox.temperatureK,
        ) * tpGate;

      let fwdProd = 1.0;
      for (let s = 0; s < S; s++) {
        const ord = hg.reactantOrderMatrix[rowOff + s];
        if (ord > 0) {
          const c = Math.max(0, vox.speciesConc[s] ?? 0);
          fwdProd *= ord === 1 ? c : ord === 2 ? c * c : Math.pow(c, ord);
        }
      }
      const forwardRate = kf * fwdProd;

      let kr = 0;
      let reverseRate = 0;
      if (rxn.isReversible && (rxn.reverseA ?? 0) > 0) {
        kr =
          evaluateArrheniusRateConstant(
            rxn.reverseA ?? 0,
            rxn.reverseEaJ ?? rxn.forwardEaJ,
            rxn.tempExponentBeta ?? 0,
            vox.temperatureK,
          ) * tpGate;
        let revProd = 1.0;
        for (let s = 0; s < S; s++) {
          const ord = hg.productOrderMatrix[rowOff + s];
          if (ord > 0) {
            const c = Math.max(0, vox.speciesConc[s] ?? 0);
            revProd *= ord === 1 ? c : ord === 2 ? c * c : Math.pow(c, ord);
          }
        }
        reverseRate = kr * revProd;
      }

      const netRate = forwardRate - reverseRate;
      return {
        reactionIndex: rIdx,
        uiName: rxn.uiName,
        uiEquationLabel: rxn.uiEquationLabel,
        tpGate,
        kf,
        kr,
        forwardRate,
        reverseRate,
        netRate,
        enthalpyRateWm3: -netRate * rxn.enthalpyChangeJ,
      };
    });

    return {
      cellCoords: [ix, iy, iz],
      cellCenterWorld: vox.worldPos,
      voxelSize: this.grid.voxelSize,
      cellVolumeM3: this.grid.cellVolumeM3,
      materialId: matId,
      materialComposition: matComp,
      elementalBreakdown,
      porosity: vox.porosity,
      temperatureK: vox.temperatureK,
      pressureAtm: vox.pressureAtm,
      internalEnergyJm3: vox.internalEnergy,
      heatCapacityJm3K,
      entropyProdRate: vox.entropyProdRate,
      voxelMassKg: cellMassDensKgM3 * this.grid.cellVolumeM3,
      phase: vox.phase,
      flux: vox.flux,
      velocity: vox.velocity,
      dominantSpeciesIndex,
      reactionEvaluations,
      speciesConcentrations,
    };
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

  public setGeologicalEvolutionConfig(partial: Partial<GeologicalEvolutionConfig>): void {
    this.geologicalConfig = {
      ...this.geologicalConfig,
      ...partial,
      epochAcceleration: clamp(
        partial.epochAcceleration ?? this.geologicalConfig.epochAcceleration,
        1,
        50,
      ),
    };
  }

  private pushGeoEvent(
    kind: GeologicalEventKind,
    summary: string,
    worldPos?: readonly [number, number, number],
    magnitudeMw?: number,
  ): void {
    this.recentGeoEvents.unshift({
      id: `geoev_${this.getCurrentStepIndex()}_${this.manualGeoEventSeq++}`,
      stepIndex: this.getCurrentStepIndex(),
      ageMyr: Number(this.geologicalAgeMyr.toFixed(2)),
      kind,
      summary,
      worldPos,
      magnitudeMw,
    });
    if (this.recentGeoEvents.length > 10) {
      this.recentGeoEvents.length = 10;
    }
  }

  private commitGeoOutput(
    geoRes: GeologicalEvalOutput,
    planet: VoxelPlanet,
    onApplyHotspots: (hotspots: ThermalHotspot[]) => void,
    onApplyTerrainOp: (op: GeologicalTerrainOp) => void,
    onApplyFluidOp?: (op: GeologicalFluidOp) => void,
    preserveExistingHotspots = true,
  ): number {
    if (geoRes.hotspots.length > 0 && !preserveExistingHotspots) {
      onApplyHotspots(geoRes.hotspots);
    }

    for (const v of geoRes.volcanoSites) {
      this.totalVolcanoCount++;
      this.activeVolcanoes.unshift(v);
      if (this.activeVolcanoes.length > 6) {
        this.activeVolcanoes.length = 6;
      }
      injectVolcanicDegassingIntoFvmGrid(
        this.grid,
        v.worldPos[0],
        v.worldPos[1],
        v.worldPos[2],
        Math.max(1.5, this.grid.voxelSize * 1.4),
        220,
      );
      this.pushGeoEvent(
        'volcano',
        `活火山喷发 · 玄武岩锥隆起 (+${v.tempC.toFixed(0)}°C, 释放 CO₂/H₂O)`,
        v.worldPos,
      );
    }

    for (const q of geoRes.quakes) {
      this.totalQuakeCount++;
      this.lastQuakeMagMw = q.magnitudeMw;
      this.recentQuakes.unshift(q);
      if (this.recentQuakes.length > 6) {
        this.recentQuakes.length = 6;
      }
      this.pushGeoEvent(
        'quake',
        `构造地震 Mw ${q.magnitudeMw.toFixed(1)} · 断层裂解与孔隙重构`,
        q.epicenter,
        q.magnitudeMw,
      );
    }

    if (Math.abs(geoRes.seaLevelDeltaM) > 1e-4) {
      this.seaLevelOffsetM = clamp(this.seaLevelOffsetM + geoRes.seaLevelDeltaM, -3.5, 3.5);
    }

    let appliedOps = 0;
    for (const op of geoRes.terrainOps) {
      onApplyTerrainOp(op);
      appliedOps++;
      if (op.reason === 'volcano_eruption') {
        this.volcanicConeVoxels++;
      } else if (op.reason === 'tectonic_quake') {
        this.faultFractureVoxels++;
        if (op.ex !== undefined && op.ey !== undefined && op.ez !== undefined) {
          fractureFaultPorosityInFvmGrid(
            this.grid,
            op.wx,
            op.wy,
            op.wz,
            op.ex,
            op.ey,
            op.ez,
            op.radius * 1.25,
          );
        }
      } else if (op.reason === 'plateau_uplift') {
        this.upliftedVoxels++;
        this.pushGeoEvent('uplift', '陆壳造山抬升 · 高原台地形成', [op.wx, op.wy, op.wz]);
      } else if (op.reason === 'fluvial_erosion') {
        this.erodedVoxels++;
        if (op.mode === 'carve') {
          this.pushGeoEvent('erosion', '水力下切侵蚀 · 大河峡谷与三角洲沉积', [op.wx, op.wy, op.wz]);
        }
      } else if (op.reason === 'acid_etch') {
        this.totalCorrodedVoxels++;
      } else {
        this.totalMineralizedVoxels++;
      }
    }

    if (onApplyFluidOp) {
      for (const fop of geoRes.fluidOps) {
        onApplyFluidOp(fop);
      }
    }

    if (appliedOps > 0 && planet.voxelRevision >= 0) {
      this.syncLocalTerrainPorosity(
        geoRes.terrainOps[0].wx,
        geoRes.terrainOps[0].wy,
        geoRes.terrainOps[0].wz,
        geoRes.terrainOps[0].radius,
        planet,
      );
    }
    return appliedOps;
  }

  /**
   * Triggers an immediate FVM-coupled geological morphogenesis event (volcano, quake, plateau uplift, or fluvial erosion).
   */
  public triggerGeologicalEvent(
    kind: 'volcano' | 'quake' | 'uplift' | 'erosion',
    planet: VoxelPlanet,
    worldPos?: readonly [number, number, number],
    onApplyTerrainOp?: (op: GeologicalTerrainOp) => void,
    onApplyFluidOp?: (op: GeologicalFluidOp) => void,
    onApplyHotspots?: (hotspots: ThermalHotspot[]) => void,
  ): GeologicalEvalOutput {
    this.manualGeoEventSeq++;
    const geoRes = buildManualGeologicalEventOps(
      kind,
      planet,
      this.grid,
      this.manualGeoEventSeq + this.getCurrentStepIndex(),
      worldPos,
    );

    const applyTerrain =
      onApplyTerrainOp ??
      ((op: GeologicalTerrainOp) => {
        planet.applyBrush(op.wx, op.wy, op.wz, op.mode, op.radius, op.strength, op.material, {
          ex: op.ex,
          ey: op.ey,
          ez: op.ez,
          shape: op.shape,
          rimMaterial: op.rimMaterial ?? op.material,
          jaggedNoise: op.jaggedNoise,
        });
      });

    this.geologicalAgeMyr += 0.25;
    this.commitGeoOutput(
      geoRes,
      planet,
      onApplyHotspots ?? (() => {}),
      applyTerrain,
      onApplyFluidOp,
      false,
    );
    return geoRes;
  }

  /**
   * Executes a multi-million-year "沧海桑田" Deep-Time Epoch step:
   * advances coupled Eulerian FVM reaction-transport steps and drives uplift, volcanism, quakes, and canyon erosion.
   */
  public runDeepTimeEpoch(
    deltaMyr: number,
    planet: VoxelPlanet,
    onApplyTerrainOp?: (op: GeologicalTerrainOp) => void,
    onApplyFluidOp?: (op: GeologicalFluidOp) => void,
    onApplyHotspots?: (hotspots: ThermalHotspot[]) => void,
  ): { stepsExecuted: number; terrainOpsApplied: number; ageMyr: number } {
    const safeDelta = clamp(deltaMyr, 0.5, 100);
    const fvmSteps = clamp(Math.round(safeDelta * 0.6), 3, 12);
    for (let s = 0; s < fvmSteps; s++) {
      this.stepOnce(this.fixedDtSec);
    }

    const cycle: ReadonlyArray<'uplift' | 'volcano' | 'quake' | 'erosion'> = [
      'uplift',
      'erosion',
      'volcano',
      'quake',
    ];
    let opsApplied = 0;
    const allHotspots: ThermalHotspot[] = [];
    const baseSeq = this.manualGeoEventSeq;
    for (let i = 0; i < cycle.length; i++) {
      const k = cycle[(i + baseSeq) % cycle.length];
      const out = this.triggerGeologicalEvent(
        k,
        planet,
        undefined,
        onApplyTerrainOp,
        onApplyFluidOp,
        (hs) => allHotspots.push(...hs),
      );
      opsApplied += out.terrainOps.length;
    }
    this.geologicalAgeMyr += Math.max(0, safeDelta - 1.0);
    if (onApplyHotspots && allHotspots.length > 0) {
      onApplyHotspots(allHotspots);
    }
    this.pushGeoEvent(
      'sea_level',
      `沧海桑田深度演化 +${safeDelta.toFixed(1)} Myr · 累积 ${this.geologicalAgeMyr.toFixed(1)} Myr`,
    );
    return {
      stepsExecuted: fvmSteps,
      terrainOpsApplied: opsApplied,
      ageMyr: this.geologicalAgeMyr,
    };
  }

  /**
   * Evaluates & applies Stage 2/5 Bidirectional Planetary & Geological Feedback (throttled every ~0.65s).
   * Pushes exothermic hotspots, mineralization, active volcanoes, tectonic quakes, uplift & fluvial erosion back onto VoxelPlanet & FluidSim.
   */
  public tickPlanetaryFeedback(
    renderDtSec: number,
    planet: VoxelPlanet,
    onApplyHotspots: (hotspots: ThermalHotspot[]) => void,
    onApplyMineralOp: (op: GeologicalTerrainOp) => void,
    onApplyFluidOp?: (op: GeologicalFluidOp) => void,
  ): boolean {
    if (!this.running) return false;

    const dtClamped = clamp(renderDtSec, 0, 0.1);
    // Advance marker ages smoothly
    for (let i = this.activeVolcanoes.length - 1; i >= 0; i--) {
      const nextAge = this.activeVolcanoes[i].ageSec + dtClamped;
      if (nextAge > 22) {
        this.activeVolcanoes.splice(i, 1);
      } else {
        this.activeVolcanoes[i] = { ...this.activeVolcanoes[i], ageSec: nextAge };
      }
    }
    for (let i = this.recentQuakes.length - 1; i >= 0; i--) {
      const nextAge = this.recentQuakes[i].ageSec + dtClamped;
      if (nextAge > 10) {
        this.recentQuakes.splice(i, 1);
      } else {
        this.recentQuakes[i] = { ...this.recentQuakes[i], ageSec: nextAge };
      }
    }

    if (
      !this.feedbackConfig.thermalFeedbackEnabled &&
      !this.feedbackConfig.mineralizationEnabled &&
      !this.geologicalConfig.tectonicEvolutionEnabled
    ) {
      if (this.activeThermalHotspotsCount > 0) {
        onApplyHotspots([]);
        this.activeThermalHotspotsCount = 0;
        this.peakExothermicDeltaC = 0;
      }
      return false;
    }

    this.feedbackAccumulatorSec += dtClamped;
    if (this.feedbackAccumulatorSec < 0.65) return false;
    const elapsed = this.feedbackAccumulatorSec;
    this.feedbackAccumulatorSec = 0;

    if (this.geologicalConfig.tectonicEvolutionEnabled) {
      this.geologicalAgeMyr += elapsed * (this.geologicalConfig.epochAcceleration * 0.045);
    }

    const gpuMode =
      this.computeBackend === 'webgpu' &&
      this.gpuSolver &&
      this.gpuSolver.lastMacroBins.length > 0;

    const evalRes = gpuMode
      ? evaluateFeedbackCandidatesFromGpuBins(
          this.gpuSolver!.lastMacroBins,
          planet,
          this.grid.ambientTempK,
          this.gpuSolver!.voxelSize,
          this.feedbackConfig,
        )
      : evaluateFeedbackCandidatesFromCpuGrid(
          this.grid,
          planet,
          this.feedbackConfig,
          this.mineralAccumulator ?? undefined,
          elapsed,
        );

    const geoRes = gpuMode
      ? evaluateTectonicCandidatesFromGpuBins(
          this.gpuSolver!.lastMacroBins,
          planet,
          this.grid.ambientTempK,
          this.geologicalConfig,
          this.getCurrentStepIndex(),
        )
      : evaluateTectonicAndFluvialCandidatesFromCpuGrid(
          this.grid,
          planet,
          this.feedbackConfig,
          this.geologicalConfig,
          this.tectonicAccumulator ?? undefined,
          elapsed,
          this.getCurrentStepIndex(),
        );

    const combinedHotspots = [...evalRes.hotspots, ...geoRes.hotspots].slice(0, 6);
    this.activeThermalHotspotsCount = combinedHotspots.length;
    let peak = evalRes.peakDeltaC;
    for (const h of geoRes.hotspots) {
      if (h.deltaC > peak) peak = h.deltaC;
    }
    this.peakExothermicDeltaC = peak;
    onApplyHotspots(combinedHotspots);

    let appliedOps = 0;
    for (const op of evalRes.mineralOps) {
      onApplyMineralOp({
        ...op,
        rimMaterial: op.material,
      });
      appliedOps++;
      if (op.reason === 'acid_etch') {
        this.totalCorrodedVoxels++;
      } else {
        this.totalMineralizedVoxels++;
      }
    }

    appliedOps += this.commitGeoOutput(
      geoRes,
      planet,
      onApplyHotspots,
      onApplyMineralOp,
      onApplyFluidOp,
      true,
    );

    this.lastMineralBatchCount = appliedOps;

    if (evalRes.mineralOps.length > 0) {
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
        `${tag} ×${evalRes.mineralOps.length} (峰值放热 +${this.peakExothermicDeltaC.toFixed(1)}°C)`,
      );
    }

    return appliedOps > 0 || combinedHotspots.length > 0;
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
    const cellularBio = computeCellularBioTelemetry(this.grid.hypergraph, telemetry);
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
      cellularBio,
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
      geologicalConfig: { ...this.geologicalConfig },
      geologicalStats: {
        geologicalAgeMyr: Number(this.geologicalAgeMyr.toFixed(2)),
        activeVolcanoCount: this.activeVolcanoes.length || this.totalVolcanoCount,
        activeVolcanoes: this.activeVolcanoes.slice(),
        quakeCount: this.totalQuakeCount,
        lastQuakeMagMw: this.lastQuakeMagMw,
        recentQuakes: this.recentQuakes.slice(),
        upliftedVoxels: this.upliftedVoxels,
        erodedVoxels: this.erodedVoxels,
        volcanicConeVoxels: this.volcanicConeVoxels,
        faultFractureVoxels: this.faultFractureVoxels,
        seaLevelOffsetM: Number(this.seaLevelOffsetM.toFixed(2)),
        recentGeoEvents: this.recentGeoEvents.slice(),
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
  materialId?: MaterialId,
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

  if (channel === 'mineral') {
    if (materialId !== undefined) {
      const porTint = clamp(0.75 + (view.porosity[idx] ?? 0.4) * 0.45, 0.65, 1.12);
      if (materialId === MaterialId.Soil) {
        outRgb[0] = clamp(0.42 * porTint, 0, 1);
        outRgb[1] = clamp(0.62 * porTint, 0, 1);
        outRgb[2] = clamp(0.28 * porTint, 0, 1);
      } else if (materialId === MaterialId.Stone) {
        outRgb[0] = clamp(0.48 * porTint, 0, 1);
        outRgb[1] = clamp(0.51 * porTint, 0, 1);
        outRgb[2] = clamp(0.56 * porTint, 0, 1);
      } else if (materialId === MaterialId.Basalt) {
        outRgb[0] = clamp(0.22 * porTint, 0, 1);
        outRgb[1] = clamp(0.24 * porTint, 0, 1);
        outRgb[2] = clamp(0.30 * porTint, 0, 1);
      } else if (materialId === MaterialId.Crystal) {
        outRgb[0] = clamp(0.18 * porTint, 0, 1);
        outRgb[1] = clamp(0.86 * porTint, 0, 1);
        outRgb[2] = clamp(0.76 * porTint, 0, 1);
      } else if (materialId === MaterialId.Ice) {
        outRgb[0] = clamp(0.72 * porTint, 0, 1);
        outRgb[1] = clamp(0.90 * porTint, 0, 1);
        outRgb[2] = clamp(0.98 * porTint, 0, 1);
      } else if (materialId === MaterialId.Sandstone) {
        outRgb[0] = clamp(0.84 * porTint, 0, 1);
        outRgb[1] = clamp(0.66 * porTint, 0, 1);
        outRgb[2] = clamp(0.36 * porTint, 0, 1);
      } else {
        outRgb[0] = 0.22;
        outRgb[1] = 0.68;
        outRgb[2] = 0.92;
      }
      return true;
    }
    const por = clamp(view.porosity[idx] ?? 0.5, 0, 1);
    outRgb[0] = clamp(0.25 + (1 - por) * 0.45, 0, 1);
    outRgb[1] = clamp(0.32 + por * 0.55, 0, 1);
    outRgb[2] = clamp(0.35 + por * 0.58, 0, 1);
    return true;
  }

  if (channel === 'rate') {
    const sigma = Math.max(0, view.entropyProdRate[idx] ?? 0);
    const norm = clamp(Math.log1p(sigma * 5.5) / 2.4, 0, 1);
    if (norm < 0.35) {
      const t = norm / 0.35;
      outRgb[0] = 0.08 + t * 0.04;
      outRgb[1] = 0.12 + t * 0.58;
      outRgb[2] = 0.20 + t * 0.65;
    } else if (norm < 0.72) {
      const t = (norm - 0.35) / 0.37;
      outRgb[0] = 0.12 + t * 0.14;
      outRgb[1] = 0.70 + t * 0.22;
      outRgb[2] = 0.85 - t * 0.35;
    } else {
      const t = (norm - 0.72) / 0.28;
      outRgb[0] = 0.26 + t * 0.72;
      outRgb[1] = 0.92 - t * 0.18;
      outRgb[2] = 0.50 - t * 0.32;
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
