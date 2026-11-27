// GPU Multiphase Geological & Thermodynamic Fluid Solver (Water + Magma + Steam + Pressure)
// Architecture:
//   1. Hybrid Eulerian-Lagrangian MPM / PIC Solver in WGSL Compute (up to 65,536 particles + 40^3 Grid)
//   2. Phases:
//      - FluidPhase.Water (0): incompressible liquid (Tait EOS), cools magma, boils into Steam above T_boil(P)
//      - FluidPhase.Magma (1): silicate melt with Arrhenius viscosity η(T), radiative cooling, blackbody glow,
//        thermal quenching into Basalt crust below ~910 K
//      - FluidPhase.Steam (2): compressible vapor (Ideal Gas EOS), high upward buoyancy, condenses back to Water
//   3. Zero-Readback GPU Terrain Collision & Coupling:
//      - Reads GpuVoxelPipeline density StorageBuffer for exact collision + normal reflection
//      - Writes pore pressure, fluid enthalpy, and hydraulic shear straight back into GpuVoxelPipeline.fluidCouplingAttr
//   4. Zero-Readback InstancedMesh Renderer reading posPhase / velTemp / thermo GPU StorageBuffers directly

import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  atomicAdd,
  atomicMax,
  atomicStore,
  clamp as tslClamp,
  color,
  dot,
  exp,
  float,
  floor,
  instanceIndex,
  int,
  length,
  log,
  max,
  min,
  mix,
  positionLocal,
  select,
  sin,
  smoothstep,
  sqrt,
  storage,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import { VoxelPlanet } from './voxelPlanet';
import { GpuVoxelPipeline } from './gpuVoxelPipeline';

export enum FluidPhase {
  Water = 0,
  Magma = 1,
  Steam = 2,
}

export const MAX_GPU_FLUID_PARTICLES = 65536;
export const FLUID_GRID_AXIS = 40;
export const FLUID_GRID_TOTAL = FLUID_GRID_AXIS * FLUID_GRID_AXIS * FLUID_GRID_AXIS; // 64,000
export const FEEDBACK_BIN_AXIS = 8;
export const FEEDBACK_BIN_TOTAL = FEEDBACK_BIN_AXIS * FEEDBACK_BIN_AXIS * FEEDBACK_BIN_AXIS; // 512

export interface GpuMultiphaseFluidTelemetry {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly totalActiveParticles: number;
  readonly waterCount: number;
  readonly magmaCount: number;
  readonly steamCount: number;
  readonly peakPressureAtm: number;
  readonly peakTempK: number;
  readonly lastDispatchMs: number;
  readonly vramBytes: number;
}

export interface GeoFeedbackEvent {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: 'solidify_basalt' | 'hydraulic_erode';
  readonly intensity: number;
}

/**
 * Pure reference silicate magma viscosity (Pa*s normalized damping factor) following Arrhenius law:
 * η(T) increases sharply as melt cools from 1550 K toward solidus ~910 K.
 */
export function evaluateArrheniusMagmaViscosity(tempK: number): number {
  const safeT = Math.max(700, Math.min(2400, tempK));
  const etaRef = 0.35; // fluid basalt at 1450 K
  const activationNorm = 6200.0; // E_a / R equivalent for smooth sandbox timescale
  const exponent = Math.max(-2.5, Math.min(4.8, activationNorm * (1.0 / safeT - 1.0 / 1450.0)));
  return Math.max(0.12, Math.min(28.0, etaRef * Math.exp(exponent)));
}

/**
 * Clausius-Clapeyron boiling temperature (K) for H2O vs ambient/hydrostatic pressure (atm).
 */
export function computeBoilingPointK(pressureAtm: number): number {
  const safeP = Math.max(0.04, Math.min(350.0, pressureAtm));
  const denom = Math.max(0.42, 1.0 - 0.088 * Math.log(safeP));
  return Math.max(274.0, Math.min(647.0, 373.15 / denom));
}

/**
 * Unified multiphase Equation-of-State pressure in atm:
 * combines Tait liquid compression (Water/Magma) + Ideal-Gas steam expansion + ambient surface pressure.
 */
export function computeMultiphaseCellPressureAtm(
  massDensityNorm: number,
  waterFrac: number,
  magmaFrac: number,
  steamFrac: number,
  tempK: number,
  surfaceAtm: number,
): number {
  const safeSurf = Math.max(0.02, surfaceAtm);
  const liquidFrac = Math.max(0, waterFrac + magmaFrac);
  const taitStiffness = waterFrac * 42.0 + magmaFrac * 96.0;
  const overDens = Math.max(0, massDensityNorm - 1.0);
  const liquidP = liquidFrac * taitStiffness * overDens;
  const steamGasP = steamFrac * Math.max(0.2, massDensityNorm) * (Math.max(200, tempK) / 373.15) * 4.8;
  const thermalMagmaP = magmaFrac * Math.max(0, tempK - 950) * 0.085;
  return Math.max(safeSurf * 0.25, safeSurf + liquidP + steamGasP + thermalMagmaP);
}

/**
 * Maps magma/melt temperature (K) to blackbody radiation RGB.
 */
export function evaluateMagmaBlackbodyColor(tempK: number): [number, number, number] {
  if (tempK <= 780) return [0.18, 0.16, 0.18];
  const tNorm = Math.max(0, Math.min(1, (tempK - 780) / 980));
  if (tNorm < 0.35) {
    const u = tNorm / 0.35;
    return [0.28 + 0.62 * u, 0.09 + 0.08 * u, 0.04];
  }
  if (tNorm < 0.72) {
    const u = (tNorm - 0.35) / 0.37;
    return [0.9 + 0.1 * u, 0.17 + 0.44 * u, 0.04 + 0.07 * u];
  }
  const u = (tNorm - 0.72) / 0.28;
  return [1.0, 0.61 + 0.36 * u, 0.11 + 0.62 * u];
}

export class GpuMultiphaseFluidSolver {
  public readonly maxParticles: number;
  public readonly gridAxis = FLUID_GRID_AXIS;
  public readonly gridTotal = FLUID_GRID_TOTAL;
  public readonly worldHalf: number;
  public readonly gridStep: number;
  public readonly baseRadius: number;

  // Particle StorageBuffers (SoA vec4s)
  // state = 0 (inactive), 1 (Water), 2 (Magma), 3 (Steam)
  public readonly posPhaseAttr: THREE.StorageBufferAttribute;
  // vec4(vx, vy, vz, tempK)
  public readonly velTempAttr: THREE.StorageBufferAttribute;
  // vec4(pressAtm, viscosity, ageSec, erosionWork)
  public readonly thermoAttr: THREE.StorageBufferAttribute;

  // Read-only particle nodes for shader + compute passes
  public readonly posPhaseReadNode;
  public readonly velTempReadNode;
  public readonly thermoReadNode;

  // Eulerian Atomic Fixed-Point PIC Grid Buffers (i32)
  private readonly gridMassAttr: THREE.StorageBufferAttribute;
  private readonly gridWaterAttr: THREE.StorageBufferAttribute;
  private readonly gridMagmaAttr: THREE.StorageBufferAttribute;
  private readonly gridSteamAttr: THREE.StorageBufferAttribute;
  private readonly gridTempAttr: THREE.StorageBufferAttribute;
  private readonly gridMomXAttr: THREE.StorageBufferAttribute;
  private readonly gridMomYAttr: THREE.StorageBufferAttribute;
  private readonly gridMomZAttr: THREE.StorageBufferAttribute;

  // Resolved Grid Float vec4 Buffers
  // vec4(avgVx, avgVy, avgVz, avgTempK)
  public readonly gridVelTempAttr: THREE.StorageBufferAttribute;
  // vec4(pressAtm, densityNorm, magmaFrac, steamFrac)
  public readonly gridPressPhaseAttr: THREE.StorageBufferAttribute;

  // Atomic Telemetry Counters [0..7] & 8^3 Geo-Feedback Atomic Bins
  private readonly countersAtomicAttr: THREE.StorageBufferAttribute;
  private readonly feedbackSolidifyAttr: THREE.StorageBufferAttribute;
  private readonly feedbackErosionAttr: THREE.StorageBufferAttribute;

  // Optional fallback density buffer if voxelPipeline is absent
  private readonly fallbackDensityAttr: THREE.StorageBufferAttribute | null = null;
  private readonly voxelPipeline: GpuVoxelPipeline | null;

  // Uniforms
  private readonly uDt = uniform(0.016);
  private readonly uPlanetRadius = uniform(13.0);
  private readonly uSurfaceAtm = uniform(1.0);
  private readonly uGravityScale = uniform(1.0);
  private readonly uPressureScale = uniform(1.0);
  private readonly uAmbientTempK = uniform(292.0);
  private readonly uParticleSize = uniform(0.24);
  private readonly uFluidGeoCoupling = uniform(1.0);
  private readonly uCutawayActive = uniform(0.0);

  // Compute Nodes
  private readonly clearGridNode: ComputeNode;
  private readonly p2gNode: ComputeNode;
  private readonly gridThermoPassNode: ComputeNode;
  private readonly g2pAdvectNode: ComputeNode;
  private readonly fluidToVoxelNode: ComputeNode | null = null;

  // Zero-Readback Instanced Particle Mesh
  public readonly particleMesh: THREE.InstancedMesh;
  public readonly particleMaterial: THREE.MeshPhysicalNodeMaterial;

  // Ring-buffer CPU write cursor for injecting bursts into GPU buffer cleanly
  private writeCursor = 0;
  private particleCountHint = 0;
  private pendingUploadMin = MAX_GPU_FLUID_PARTICLES;
  private pendingUploadMax = -1;

  // Telemetry & Async Geo Feedback Readback State
  private readbackInFlight = false;
  public liveTotalParticles = 0;
  public liveWaterCount = 0;
  public liveMagmaCount = 0;
  public liveSteamCount = 0;
  public livePeakPressureAtm = 1.0;
  public livePeakTempK = 295.0;
  public lastDispatchMs = 0;

  private readonly pendingGeoEvents: GeoFeedbackEvent[] = [];

  constructor(
    planet: VoxelPlanet,
    voxelPipeline: GpuVoxelPipeline | null = null,
    maxParticles = MAX_GPU_FLUID_PARTICLES,
  ) {
    this.maxParticles = maxParticles;
    this.voxelPipeline = voxelPipeline;
    this.baseRadius = planet.baseRadius;
    this.worldHalf = planet.worldHalf * 1.12;
    this.gridStep = (this.worldHalf * 2) / Math.max(1, this.gridAxis - 1);
    this.uPlanetRadius.value = planet.baseRadius;
    this.uParticleSize.value = Math.max(0.01, 0.12 * (planet.baseRadius / 13.0));

    this.posPhaseAttr = new THREE.StorageBufferAttribute(new Float32Array(maxParticles * 4), 4);
    this.velTempAttr = new THREE.StorageBufferAttribute(new Float32Array(maxParticles * 4), 4);
    this.thermoAttr = new THREE.StorageBufferAttribute(new Float32Array(maxParticles * 4), 4);

    const N = this.gridTotal;
    this.gridMassAttr = new THREE.StorageBufferAttribute(new Int32Array(N), 1);
    this.gridWaterAttr = new THREE.StorageBufferAttribute(new Int32Array(N), 1);
    this.gridMagmaAttr = new THREE.StorageBufferAttribute(new Int32Array(N), 1);
    this.gridSteamAttr = new THREE.StorageBufferAttribute(new Int32Array(N), 1);
    this.gridTempAttr = new THREE.StorageBufferAttribute(new Int32Array(N), 1);
    this.gridMomXAttr = new THREE.StorageBufferAttribute(new Int32Array(N), 1);
    this.gridMomYAttr = new THREE.StorageBufferAttribute(new Int32Array(N), 1);
    this.gridMomZAttr = new THREE.StorageBufferAttribute(new Int32Array(N), 1);

    this.gridVelTempAttr = new THREE.StorageBufferAttribute(new Float32Array(N * 4), 4);
    this.gridPressPhaseAttr = new THREE.StorageBufferAttribute(new Float32Array(N * 4), 4);

    this.countersAtomicAttr = new THREE.StorageBufferAttribute(new Uint32Array(8), 1);
    this.feedbackSolidifyAttr = new THREE.StorageBufferAttribute(new Uint32Array(FEEDBACK_BIN_TOTAL), 1);
    this.feedbackErosionAttr = new THREE.StorageBufferAttribute(new Uint32Array(FEEDBACK_BIN_TOTAL), 1);

    // Storage nodes
    this.posPhaseReadNode = storage(this.posPhaseAttr, 'vec4', maxParticles).toReadOnly();
    const posPhaseWrite = storage(this.posPhaseAttr, 'vec4', maxParticles);
    this.velTempReadNode = storage(this.velTempAttr, 'vec4', maxParticles).toReadOnly();
    const velTempWrite = storage(this.velTempAttr, 'vec4', maxParticles);
    this.thermoReadNode = storage(this.thermoAttr, 'vec4', maxParticles).toReadOnly();
    const thermoWrite = storage(this.thermoAttr, 'vec4', maxParticles);

    const gridMassAtomic = storage(this.gridMassAttr, 'int', N).toAtomic();
    const gridWaterAtomic = storage(this.gridWaterAttr, 'int', N).toAtomic();
    const gridMagmaAtomic = storage(this.gridMagmaAttr, 'int', N).toAtomic();
    const gridSteamAtomic = storage(this.gridSteamAttr, 'int', N).toAtomic();
    const gridTempAtomic = storage(this.gridTempAttr, 'int', N).toAtomic();
    const gridMomXAtomic = storage(this.gridMomXAttr, 'int', N).toAtomic();
    const gridMomYAtomic = storage(this.gridMomYAttr, 'int', N).toAtomic();
    const gridMomZAtomic = storage(this.gridMomZAttr, 'int', N).toAtomic();

    const gridMassRead = storage(this.gridMassAttr, 'int', N).toReadOnly();
    const gridWaterRead = storage(this.gridWaterAttr, 'int', N).toReadOnly();
    const gridMagmaRead = storage(this.gridMagmaAttr, 'int', N).toReadOnly();
    const gridSteamRead = storage(this.gridSteamAttr, 'int', N).toReadOnly();
    const gridTempRead = storage(this.gridTempAttr, 'int', N).toReadOnly();
    const gridMomXRead = storage(this.gridMomXAttr, 'int', N).toReadOnly();
    const gridMomYRead = storage(this.gridMomYAttr, 'int', N).toReadOnly();
    const gridMomZRead = storage(this.gridMomZAttr, 'int', N).toReadOnly();

    const gridVelTempWrite = storage(this.gridVelTempAttr, 'vec4', N);
    const gridVelTempRead = storage(this.gridVelTempAttr, 'vec4', N).toReadOnly();
    const gridPressPhaseWrite = storage(this.gridPressPhaseAttr, 'vec4', N);
    const gridPressPhaseRead = storage(this.gridPressPhaseAttr, 'vec4', N).toReadOnly();

    const countersAtomic = storage(this.countersAtomicAttr, 'uint', 8).toAtomic();
    const fbSolidifyAtomic = storage(this.feedbackSolidifyAttr, 'uint', FEEDBACK_BIN_TOTAL).toAtomic();
    const fbErosionAtomic = storage(this.feedbackErosionAttr, 'uint', FEEDBACK_BIN_TOTAL).toAtomic();

    // Terrain SDF source (shared zero-readback GPU voxel pipeline or fallback)
    const terrainAxis = voxelPipeline ? voxelPipeline.axisSize : planet.gridN;
    const terrainHalf = voxelPipeline ? voxelPipeline.worldHalf : planet.worldHalf;
    const terrainVoxelSize = voxelPipeline ? voxelPipeline.voxelSize : planet.voxelSize;
    if (!voxelPipeline) {
      this.fallbackDensityAttr = new THREE.StorageBufferAttribute(new Float32Array(planet.density), 1);
    }
    const terrainDensityRead = voxelPipeline
      ? voxelPipeline.densityReadNode
      : storage(this.fallbackDensityAttr!, 'float', planet.density.length).toReadOnly();

    const gAxisU = uint(this.gridAxis);
    const gSqU = uint(this.gridAxis * this.gridAxis);
    const gMaxF = float(this.gridAxis - 1);
    const gHalfF = float(this.worldHalf);
    const gInvStepF = float(1.0 / this.gridStep);
    const gStepF = float(this.gridStep);

    const tAxisU = uint(terrainAxis);
    const tSqU = uint(terrainAxis * terrainAxis);
    const tMaxU = uint(terrainAxis - 1);
    const tMaxF = float(terrainAxis - 1);
    const tHalfF = float(terrainHalf);
    const tInvStepF = float(1.0 / terrainVoxelSize);

    const fbAxisU = uint(FEEDBACK_BIN_AXIS);
    const fbSqU = uint(FEEDBACK_BIN_AXIS * FEEDBACK_BIN_AXIS);
    const fbMaxF = float(FEEDBACK_BIN_AXIS - 1);

    // Compute Pass 0: Clear Eulerian Grid + Reset Counters
    this.clearGridNode = Fn(() => {
      const idx = instanceIndex;
      atomicStore(gridMassAtomic.element(idx), int(0));
      atomicStore(gridWaterAtomic.element(idx), int(0));
      atomicStore(gridMagmaAtomic.element(idx), int(0));
      atomicStore(gridSteamAtomic.element(idx), int(0));
      atomicStore(gridTempAtomic.element(idx), int(0));
      atomicStore(gridMomXAtomic.element(idx), int(0));
      atomicStore(gridMomYAtomic.element(idx), int(0));
      atomicStore(gridMomZAtomic.element(idx), int(0));
      gridVelTempWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 290.0));
      gridPressPhaseWrite.element(idx).assign(vec4(this.uSurfaceAtm, 0.0, 0.0, 0.0));
      If(idx.lessThan(uint(8)), () => {
        atomicStore(countersAtomic.element(idx), uint(0));
      });
      If(idx.lessThan(uint(FEEDBACK_BIN_TOTAL)), () => {
        atomicStore(fbSolidifyAtomic.element(idx), uint(0));
        atomicStore(fbErosionAtomic.element(idx), uint(0));
      });
    })().compute(N, [64]).setName('GpuFluidClearGrid');

    // Compute Pass 1: Particle-to-Grid (P2G) Atomic Fixed-Point Deposition
    this.p2gNode = Fn(() => {
      const idx = instanceIndex;
      const posSt = this.posPhaseReadNode.element(idx);
      const state = posSt.w;
      If(state.greaterThan(0.5), () => {
        const vt = this.velTempReadNode.element(idx);
        const px = posSt.x;
        const py = posSt.y;
        const pz = posSt.z;
        const gx = uint(tslClamp(floor(px.add(gHalfF).mul(gInvStepF).add(0.5)), 0.0, gMaxF));
        const gy = uint(tslClamp(floor(py.add(gHalfF).mul(gInvStepF).add(0.5)), 0.0, gMaxF));
        const gz = uint(tslClamp(floor(pz.add(gHalfF).mul(gInvStepF).add(0.5)), 0.0, gMaxF));
        const cell = gx.add(gy.mul(gAxisU)).add(gz.mul(gSqU));

        const isWater = state.lessThan(1.5);
        const isMagma = state.greaterThanEqual(1.5).and(state.lessThan(2.5));
        const isSteam = state.greaterThanEqual(2.5);

        // Relative particle mass by phase (Water=1.0, Magma=2.7, Steam=0.12)
        const massFp = select(isMagma, int(2700), select(isSteam, int(120), int(1000)));
        atomicAdd(gridMassAtomic.element(cell), massFp);
        If(isWater, () => {
          atomicAdd(gridWaterAtomic.element(cell), int(1000));
        }).ElseIf(isMagma, () => {
          atomicAdd(gridMagmaAtomic.element(cell), int(1000));
        }).Else(() => {
          atomicAdd(gridSteamAtomic.element(cell), int(1000));
        });

        const tempFp = int(tslClamp(vt.w.mul(4.0), 200.0, 20000.0));
        atomicAdd(gridTempAtomic.element(cell), tempFp);
        atomicAdd(gridMomXAtomic.element(cell), int(tslClamp(vt.x.mul(256.0), -80000.0, 80000.0)));
        atomicAdd(gridMomYAtomic.element(cell), int(tslClamp(vt.y.mul(256.0), -80000.0, 80000.0)));
        atomicAdd(gridMomZAtomic.element(cell), int(tslClamp(vt.z.mul(256.0), -80000.0, 80000.0)));
      });
    })().compute(maxParticles, [64]).setName('GpuFluidP2G');

    // Compute Pass 2: Grid Thermodynamic EOS & Multiphase Pressure Solve
    this.gridThermoPassNode = Fn(() => {
      const idx = instanceIndex;
      const mInt = gridMassRead.element(idx);
      If(mInt.greaterThan(int(0)), () => {
        const wInt = gridWaterRead.element(idx);
        const mgInt = gridMagmaRead.element(idx);
        const stInt = gridSteamRead.element(idx);
        const countUnits = max(float(wInt.add(mgInt).add(stInt)).div(1000.0), float(1.0));

        const waterFrac = float(wInt).div(1000.0).div(countUnits);
        const magmaFrac = float(mgInt).div(1000.0).div(countUnits);
        const steamFrac = float(stInt).div(1000.0).div(countUnits);

        const avgTempK = tslClamp(
          float(gridTempRead.element(idx)).div(countUnits.mul(4.0)),
          float(180.0),
          float(2600.0),
        );
        const avgVx = float(gridMomXRead.element(idx)).div(countUnits.mul(256.0));
        const avgVy = float(gridMomYRead.element(idx)).div(countUnits.mul(256.0));
        const avgVz = float(gridMomZRead.element(idx)).div(countUnits.mul(256.0));

        // Normalized density against nominal rest density (5 particles/cell baseline)
        const massNorm = float(mInt).div(5000.0);
        const liqFrac = max(float(0.0), waterFrac.add(magmaFrac));
        const taitStiff = waterFrac.mul(42.0).add(magmaFrac.mul(96.0));
        const overDens = max(float(0.0), massNorm.sub(1.0));
        const liquidP = liqFrac.mul(taitStiff).mul(overDens);
        const steamP = steamFrac.mul(max(massNorm, float(0.2))).mul(avgTempK.div(373.15)).mul(4.8);
        const magmaThermalP = magmaFrac.mul(max(float(0.0), avgTempK.sub(950.0))).mul(0.085);

        // Phreatic flash overpressure when Magma & Water share the same Eulerian cell!
        const quenchSpike = min(waterFrac, magmaFrac).mul(145.0);
        const totalP = max(
          this.uSurfaceAtm.mul(0.25),
          this.uSurfaceAtm.add(liquidP.add(steamP).add(magmaThermalP).add(quenchSpike).mul(this.uPressureScale)),
        );

        gridVelTempWrite.element(idx).assign(vec4(avgVx, avgVy, avgVz, avgTempK));
        gridPressPhaseWrite.element(idx).assign(vec4(totalP, massNorm, magmaFrac, steamFrac));
      });
    })().compute(N, [64]).setName('GpuFluidGridThermoPass');

    // Compute Pass 3: G2P Pressure Gradient Forces, Arrhenius Viscosity, Phase Transition & Terrain Collision
    const sampleGridIndex = (wx: unknown, wy: unknown, wz: unknown) => {
      const gx = uint(tslClamp(floor(float(wx as number).add(gHalfF).mul(gInvStepF).add(0.5)), 0.0, gMaxF));
      const gy = uint(tslClamp(floor(float(wy as number).add(gHalfF).mul(gInvStepF).add(0.5)), 0.0, gMaxF));
      const gz = uint(tslClamp(floor(float(wz as number).add(gHalfF).mul(gInvStepF).add(0.5)), 0.0, gMaxF));
      return gx.add(gy.mul(gAxisU)).add(gz.mul(gSqU));
    };

    const sampleTerrainDensityAtIdx = (tx: unknown, ty: unknown, tz: unknown) => {
      const clampedX = uint(tslClamp(float(tx as number), 0.0, tMaxF));
      const clampedY = uint(tslClamp(float(ty as number), 0.0, tMaxF));
      const clampedZ = uint(tslClamp(float(tz as number), 0.0, tMaxF));
      return terrainDensityRead.element(clampedX.add(clampedY.mul(tAxisU)).add(clampedZ.mul(tSqU)));
    };

    this.g2pAdvectNode = Fn(() => {
      const idx = instanceIndex;
      // Read from writable storage views to avoid WebGPU read+write buffer aliasing in the same pass
      const posSt = posPhaseWrite.element(idx);
      const state = posSt.w.toVar('pState');

      If(state.greaterThan(0.5), () => {
        const vt = velTempWrite.element(idx);
        const th = thermoWrite.element(idx);
        const px = posSt.x.toVar('px');
        const py = posSt.y.toVar('py');
        const pz = posSt.z.toVar('pz');
        const vx = vt.x.toVar('vx');
        const vy = vt.y.toVar('vy');
        const vz = vt.z.toVar('vz');
        const tempK = vt.w.toVar('tempK');
        const ageSec = th.z.add(this.uDt).toVar('ageSec');

        const isWater = state.lessThan(1.5);
        const isMagma = state.greaterThanEqual(1.5).and(state.lessThan(2.5));
        const isSteam = state.greaterThanEqual(2.5);

        // 1. Sample Eulerian cell & 6-neighbor Pressure Gradient Force (-∇P / ρ)
        const cIdx = sampleGridIndex(px, py, pz);
        const gridVT = gridVelTempRead.element(cIdx);
        const gridPP = gridPressPhaseRead.element(cIdx);
        const cellP = gridPP.x;
        const cellMagmaF = gridPP.z;
        const cellSteamF = gridPP.w;

        const pXp = gridPressPhaseRead.element(sampleGridIndex(px.add(gStepF), py, pz)).x;
        const pXn = gridPressPhaseRead.element(sampleGridIndex(px.sub(gStepF), py, pz)).x;
        const pYp = gridPressPhaseRead.element(sampleGridIndex(px, py.add(gStepF), pz)).x;
        const pYn = gridPressPhaseRead.element(sampleGridIndex(px, py.sub(gStepF), pz)).x;
        const pZp = gridPressPhaseRead.element(sampleGridIndex(px, py, pz.add(gStepF))).x;
        const pZn = gridPressPhaseRead.element(sampleGridIndex(px, py, pz.sub(gStepF))).x;

        const inv2H = float(0.5).div(max(gStepF, float(0.01)));
        const gradPx = pXp.sub(pXn).mul(inv2H);
        const gradPy = pYp.sub(pYn).mul(inv2H);
        const gradPz = pZp.sub(pZn).mul(inv2H);

        const rhoPhase = select(isMagma, float(2.75), select(isSteam, float(0.32), float(1.05)));
        const scale = max(this.uPlanetRadius.div(13.0), float(0.01));
        const pressAccelScale = float(0.42).mul(scale).div(rhoPhase);

        // 2. Spherical Newtonian Gravity + Steam Thermal Buoyancy
        const r = max(length(vec3(px, py, pz)), float(0.05));
        const rRatio = r.div(max(this.uPlanetRadius, float(0.1)));
        const invR = float(1.0).div(r);
        const radX = px.mul(invR);
        const radY = py.mul(invR);
        const radZ = pz.mul(invR);

        const gBase = float(9.81).mul(max(this.uGravityScale, float(0.05))).mul(
          select(rRatio.greaterThan(1.0), float(1.0).div(rRatio.mul(rRatio)), rRatio),
        );
        // Steam experiences upward thermal buoyancy relative to ambient atmosphere
        const buoyFactor = select(
          isSteam,
          float(-0.75).sub(tslClamp(tempK.sub(360.0).div(420.0), 0.0, 1.4)),
          float(1.0),
        );

        const ax = radX.mul(gBase.negate().mul(buoyFactor)).sub(gradPx.mul(pressAccelScale));
        const ay = radY.mul(gBase.negate().mul(buoyFactor)).sub(gradPy.mul(pressAccelScale));
        const az = radZ.mul(gBase.negate().mul(buoyFactor)).sub(gradPz.mul(pressAccelScale));

        vx.addAssign(ax.mul(this.uDt));
        vy.addAssign(ay.mul(this.uDt));
        vz.addAssign(az.mul(this.uDt));

        // 3. PIC Velocity Blend + Arrhenius Magma Viscosity Damping
        const picBlend = select(isMagma, float(0.22), select(isSteam, float(0.14), float(0.16)));
        vx.assign(mix(vx, gridVT.x, picBlend));
        vy.assign(mix(vy, gridVT.y, picBlend));
        vz.assign(mix(vz, gridVT.z, picBlend));

        // Arrhenius viscosity η(T) for magma
        const safeTM = tslClamp(tempK, float(700.0), float(2400.0));
        const arrhExp = tslClamp(float(6200.0).mul(float(1.0).div(safeTM).sub(float(1.0 / 1450.0))), float(-2.5), float(4.8));
        const etaMagma = tslClamp(float(0.35).mul(exp(arrhExp)), float(0.12), float(28.0));
        const dampRate = select(isMagma, etaMagma.mul(0.85), select(isSteam, float(0.72), float(0.18)));
        const dampMul = exp(dampRate.negate().mul(this.uDt));
        vx.mulAssign(dampMul);
        vy.mulAssign(dampMul);
        vz.mulAssign(dampMul);

        // Clamp speed
        const maxSpd = float(22.0).mul(sqrt(scale));
        const spd = length(vec3(vx, vy, vz));
        If(spd.greaterThan(maxSpd), () => {
          const k = maxSpd.div(spd);
          vx.mulAssign(k);
          vy.mulAssign(k);
          vz.mulAssign(k);
        });

        // 4. Advect & Collide with GPU Voxel Terrain Density Field
        px.addAssign(vx.mul(this.uDt));
        py.addAssign(vy.mul(this.uDt));
        pz.addAssign(vz.mul(this.uDt));

        // Atmospheric escape outer boundary
        const rNew = length(vec3(px, py, pz));
        const outerR = this.uPlanetRadius.mul(1.48);
        If(rNew.greaterThan(outerR), () => {
          If(isSteam, () => {
            // Vapor diffuses at upper atmosphere and cools into rain droplets
            tempK.assign(float(282.0));
            state.assign(float(1.0));
            const s = outerR.mul(0.95).div(rNew);
            px.mulAssign(s);
            py.mulAssign(s);
            pz.mulAssign(s);
            vx.mulAssign(0.25);
            vy.mulAssign(0.25);
            vz.mulAssign(0.25);
          }).Else(() => {
            const s = outerR.div(rNew);
            px.mulAssign(s);
            py.mulAssign(s);
            pz.mulAssign(s);
            vx.mulAssign(0.5);
            vy.mulAssign(0.5);
            vz.mulAssign(0.5);
          });
        });

        // Fast GPU terrain SDF + central-difference normal
        const txF = tslClamp(px.add(tHalfF).mul(tInvStepF).add(0.5), float(1.0), tMaxF.sub(1.0));
        const tyF = tslClamp(py.add(tHalfF).mul(tInvStepF).add(0.5), float(1.0), tMaxF.sub(1.0));
        const tzF = tslClamp(pz.add(tHalfF).mul(tInvStepF).add(0.5), float(1.0), tMaxF.sub(1.0));
        const txU = uint(floor(txF));
        const tyU = uint(floor(tyF));
        const tzU = uint(floor(tzF));

        const dHere = sampleTerrainDensityAtIdx(txU, tyU, tzU);
        const margin = float(0.22).mul(scale);
        const erosionWork = float(0.0).toVar('erosionW');

        If(dHere.greaterThan(margin.negate()), () => {
          const dXp = sampleTerrainDensityAtIdx(txU.add(uint(1)), tyU, tzU);
          const dXn = sampleTerrainDensityAtIdx(txU.sub(uint(1)), tyU, tzU);
          const dYp = sampleTerrainDensityAtIdx(txU, tyU.add(uint(1)), tzU);
          const dYn = sampleTerrainDensityAtIdx(txU, tyU.sub(uint(1)), tzU);
          const dZp = sampleTerrainDensityAtIdx(txU, tyU, tzU.add(uint(1)));
          const dZn = sampleTerrainDensityAtIdx(txU, tyU, tzU.sub(uint(1)));

          // Outward normal points from positive (rock) to negative (air)
          const gxN = dXn.sub(dXp);
          const gyN = dYn.sub(dYp);
          const gzN = dZn.sub(dZp);
          const nLen = length(vec3(gxN, gyN, gzN));
          const safeLen = max(nLen, float(1e-4));
          const nx = select(nLen.greaterThan(1e-4), gxN.div(safeLen), radX);
          const ny = select(nLen.greaterThan(1e-4), gyN.div(safeLen), radY);
          const nz = select(nLen.greaterThan(1e-4), gzN.div(safeLen), radZ);

          const pen = dHere.add(margin);
          px.addAssign(nx.mul(pen));
          py.addAssign(ny.mul(pen));
          pz.addAssign(nz.mul(pen));

          const vn = vx.mul(nx).add(vy.mul(ny)).add(vz.mul(nz));
          If(vn.lessThan(0.0), () => {
            const rest = select(isMagma, float(0.04), float(0.14));
            vx.subAssign(nx.mul(vn.mul(float(1.0).add(rest))));
            vy.subAssign(ny.mul(vn.mul(float(1.0).add(rest))));
            vz.subAssign(nz.mul(vn.mul(float(1.0).add(rest))));
            const slipDrag = select(isMagma, float(0.84), float(0.95));
            vx.mulAssign(slipDrag);
            vy.mulAssign(slipDrag);
            vz.mulAssign(slipDrag);
          });

          // High-speed pressurized water causes hydraulic shear erosion work
          If(isWater.and(spd.greaterThan(float(3.2).mul(sqrt(scale))).or(cellP.greaterThan(18.0))), () => {
            erosionWork.assign(tslClamp(spd.mul(0.25).add(cellP.mul(0.03)), 0.0, 4.0));
          });
        });

        // 5. Multiphase Heat Exchange & Thermodynamic Phase Transitions
        // Exchange enthalpy toward cell mix + radiative/atmospheric relaxation
        const gridTemp = gridVT.w;
        tempK.assign(mix(tempK, gridTemp, tslClamp(this.uDt.mul(2.4), 0.02, 0.45)));
        // Magma cools via blackbody radiation + water quenching if water shares cell
        const quenchCool = select(
          isMagma,
          float(26.0).add(float(1.0).sub(cellMagmaF).mul(95.0)),
          select(isSteam, float(18.0), float(2.5)),
        );
        tempK.assign(mix(tempK, this.uAmbientTempK, tslClamp(this.uDt.mul(quenchCool).div(900.0), 0.0, 0.25)));

        // Water + Steam Clausius-Clapeyron boiling & condensation
        const safeP = tslClamp(cellP, float(0.04), float(350.0));
        const tBoil = float(373.15).div(max(float(0.42), float(1.0).sub(float(0.088).mul(log(safeP)))));

        If(isWater.and(tempK.greaterThan(tBoil).or(cellMagmaF.greaterThan(0.22).and(ageSec.greaterThan(0.12)))), () => {
          // Phreatic flash to steam!
          state.assign(float(3.0));
          tempK.assign(max(tempK, tBoil.add(25.0)));
          vx.addAssign(radX.mul(float(3.2).mul(sqrt(scale))));
          vy.addAssign(radY.mul(float(3.2).mul(sqrt(scale))));
          vz.addAssign(radZ.mul(float(3.2).mul(sqrt(scale))));
        }).ElseIf(isSteam.and(tempK.lessThan(tBoil.sub(12.0)).or(ageSec.greaterThan(11.0).and(cellSteamF.greaterThan(0.6)))), () => {
          // Condense back to liquid raindrop
          state.assign(float(1.0));
          ageSec.assign(0.0);
        });

        // Feedback bin index (8x8x8)
        const bx = uint(tslClamp(floor(px.add(gHalfF).div(gHalfF.mul(2.0)).mul(fbMaxF).add(0.5)), 0.0, fbMaxF));
        const by = uint(tslClamp(floor(py.add(gHalfF).div(gHalfF.mul(2.0)).mul(fbMaxF).add(0.5)), 0.0, fbMaxF));
        const bz = uint(tslClamp(floor(pz.add(gHalfF).div(gHalfF.mul(2.0)).mul(fbMaxF).add(0.5)), 0.0, fbMaxF));
        const binIdx = bx.add(by.mul(fbAxisU)).add(bz.mul(fbSqU));

        // Magma solidifies into Basalt crust below ~910 K once slowed down!
        If(isMagma.and(tempK.lessThan(910.0)).and(ageSec.greaterThan(1.4)).and(dHere.greaterThan(margin.mul(-2.8))), () => {
          atomicAdd(fbSolidifyAtomic.element(binIdx), uint(1));
          atomicAdd(countersAtomic.element(uint(6)), uint(1));
          state.assign(float(0.0)); // Consumed into solid basalt rock!
        });

        If(erosionWork.greaterThan(0.85), () => {
          atomicAdd(fbErosionAtomic.element(binIdx), uint(1));
          atomicAdd(countersAtomic.element(uint(7)), uint(1));
        });

        // Write updated particle state
        posPhaseWrite.element(idx).assign(vec4(px, py, pz, state));
        velTempWrite.element(idx).assign(vec4(vx, vy, vz, tempK));
        const visOut = select(isMagma, etaMagma, select(isSteam, float(0.02), float(0.18)));
        thermoWrite.element(idx).assign(vec4(cellP, visOut, ageSec, erosionWork));

        // Reduction telemetry counters (zero-CPU-sort exact counts)
        If(state.greaterThan(0.5), () => {
          atomicAdd(countersAtomic.element(uint(5)), uint(1));
          If(state.lessThan(1.5), () => {
            atomicAdd(countersAtomic.element(uint(0)), uint(1));
          }).ElseIf(state.lessThan(2.5), () => {
            atomicAdd(countersAtomic.element(uint(1)), uint(1));
          }).Else(() => {
            atomicAdd(countersAtomic.element(uint(2)), uint(1));
          });
          atomicMax(countersAtomic.element(uint(3)), uint(tslClamp(cellP.mul(100.0), 0.0, 400000000.0)));
          atomicMax(countersAtomic.element(uint(4)), uint(tslClamp(tempK.mul(10.0), 0.0, 1000000.0)));
        });
      });
    })().compute(maxParticles, [64]).setName('GpuFluidG2PAdvect');

    // Compute Pass 4 (Optional Direct GPU-to-GPU Voxel Coupling):
    // Transfers Eulerian fluid pore pressure, enthalpy, & shear straight into GpuVoxelPipeline.fluidCouplingAttr
    if (voxelPipeline) {
      const vN = voxelPipeline.totalVoxels;
      const vAxisU = uint(voxelPipeline.axisSize);
      const vSqU = uint(voxelPipeline.axisSize * voxelPipeline.axisSize);
      const vStepF = float(voxelPipeline.voxelSize);
      const vHalfF = float(voxelPipeline.worldHalf);
      const fluidCouplingWrite = storage(voxelPipeline.fluidCouplingAttr, 'vec4', vN);

      this.fluidToVoxelNode = Fn(() => {
        const idx = instanceIndex;
        If(this.uFluidGeoCoupling.greaterThan(0.5), () => {
          const iz = idx.div(vSqU);
          const rem = idx.sub(iz.mul(vSqU));
          const iy = rem.div(vAxisU);
          const ix = rem.sub(iy.mul(vAxisU));

          const wx = float(ix).mul(vStepF).sub(vHalfF);
          const wy = float(iy).mul(vStepF).sub(vHalfF);
          const wz = float(iz).mul(vStepF).sub(vHalfF);

          const cIdx = sampleGridIndex(wx, wy, wz);
          const gPP = gridPressPhaseRead.element(cIdx);
          const gVT = gridVelTempRead.element(cIdx);

          const hasFluid = gPP.y.greaterThan(0.05);
          const poreP = select(hasFluid, max(float(0.0), gPP.x.sub(this.uSurfaceAtm)), float(0.0));
          const heatK = select(hasFluid, gVT.w, float(0.0));
          const shear = select(hasFluid, length(gVT.xyz).mul(gPP.y).mul(0.25), float(0.0));
          const phaseMarker = gPP.z.mul(2.0).add(gPP.w);
          fluidCouplingWrite.element(idx).assign(vec4(poreP, heatK, shear, phaseMarker));
        }).Else(() => {
          fluidCouplingWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 0.0));
        });
      })().compute(vN, [64]).setName('GpuFluidToVoxelCoupling');
    }

    // Zero-Readback GPU Instanced Multiphase Fluid Renderer
    const sphereGeo = new THREE.IcosahedronGeometry(1.0, 1);
    const mat = new THREE.MeshPhysicalNodeMaterial();
    mat.transparent = true;

    mat.positionNode = Fn(() => {
      const posSt = this.posPhaseReadNode.element(instanceIndex);
      const state = posSt.w;
      const inCutaway = this.uCutawayActive.greaterThan(0.5)
        .and(posSt.x.greaterThan(0.0))
        .and(posSt.y.greaterThan(0.0))
        .and(posSt.z.greaterThan(0.0));
      const active = state.greaterThan(0.5).and(inCutaway.not());

      const isMagma = state.greaterThanEqual(1.5).and(state.lessThan(2.5));
      const isSteam = state.greaterThanEqual(2.5);
      const phaseScale = select(isMagma, float(1.18), select(isSteam, float(1.38), float(0.92)));
      const rad = select(active, this.uParticleSize.mul(phaseScale), float(0.0));
      return positionLocal.mul(rad).add(posSt.xyz);
    })();

    mat.colorNode = Fn(() => {
      const posSt = this.posPhaseReadNode.element(instanceIndex);
      const vt = this.velTempReadNode.element(instanceIndex);
      const th = this.thermoReadNode.element(instanceIndex);
      const state = posSt.w;
      const tempK = vt.w;
      const pressAtm = th.x;

      const isMagma = state.greaterThanEqual(1.5).and(state.lessThan(2.5));
      const isSteam = state.greaterThanEqual(2.5);

      // Water: deep cobalt-cyan + white pressure foam
      const foam = tslClamp(pressAtm.sub(3.0).div(28.0), 0.0, 0.65);
      const waterCol = mix(color(0x0ea5e9), color(0xe0f2fe), foam);

      // Magma: physical blackbody incandescence (basalt crust -> crimson -> orange -> incandescent yellow)
      const tNorm = tslClamp(tempK.sub(780.0).div(980.0), 0.0, 1.0);
      let magmaCol = mix(color(0x2a1f24), color(0xb91c1c), smoothstep(0.0, 0.35, tNorm));
      magmaCol = mix(magmaCol, color(0xf97316), smoothstep(0.35, 0.72, tNorm));
      magmaCol = mix(magmaCol, color(0xfef08a), smoothstep(0.72, 1.0, tNorm));

      // Steam: warm silvery-white pressurized vapor plume
      const steamCol = mix(color(0xcbd5e1), color(0xf8fafc), tslClamp(tempK.sub(370.0).div(300.0), 0.0, 1.0));

      return select(isMagma, magmaCol, select(isSteam, steamCol, waterCol));
    })();

    mat.emissiveNode = Fn(() => {
      const posSt = this.posPhaseReadNode.element(instanceIndex);
      const vt = this.velTempReadNode.element(instanceIndex);
      const state = posSt.w;
      const tempK = vt.w;
      const isMagma = state.greaterThanEqual(1.5).and(state.lessThan(2.5));
      const isSteam = state.greaterThanEqual(2.5);

      const tNorm = tslClamp(tempK.sub(780.0).div(980.0), 0.0, 1.0);
      const glowRgb = mix(color(0x991b1b), color(0xfef08a), tNorm).mul(float(0.6).add(tNorm.mul(2.1)));
      const waterGlow = color(0x0369a1).mul(0.18);
      const steamGlow = color(0x94a3b8).mul(0.22);
      return select(isMagma, glowRgb, select(isSteam, steamGlow, waterGlow));
    })();

    mat.roughnessNode = Fn(() => {
      const state = this.posPhaseReadNode.element(instanceIndex).w;
      const isMagma = state.greaterThanEqual(1.5).and(state.lessThan(2.5));
      const isSteam = state.greaterThanEqual(2.5);
      return select(isMagma, float(0.45), select(isSteam, float(0.92), float(0.08)));
    })();

    mat.opacityNode = Fn(() => {
      const state = this.posPhaseReadNode.element(instanceIndex).w;
      const isMagma = state.greaterThanEqual(1.5).and(state.lessThan(2.5));
      const isSteam = state.greaterThanEqual(2.5);
      return select(state.lessThan(0.5), float(0.0), select(isMagma, float(0.98), select(isSteam, float(0.38), float(0.84))));
    })();

    this.particleMaterial = mat;
    this.particleMesh = new THREE.InstancedMesh(sphereGeo, mat, maxParticles);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.castShadow = false;
    this.particleMesh.receiveShadow = true;
    this.particleMesh.count = 0;
    this.particleMesh.visible = false;
  }

  public syncTerrainFallbackIfNeeded(planet: VoxelPlanet): void {
    if (!this.fallbackDensityAttr) return;
    const arr = this.fallbackDensityAttr.array as Float32Array;
    if (arr.length === planet.density.length) {
      arr.set(planet.density);
      this.fallbackDensityAttr.needsUpdate = true;
    }
  }

  public clear(): void {
    (this.posPhaseAttr.array as Float32Array).fill(0);
    (this.velTempAttr.array as Float32Array).fill(0);
    (this.thermoAttr.array as Float32Array).fill(0);
    this.posPhaseAttr.needsUpdate = true;
    this.velTempAttr.needsUpdate = true;
    this.thermoAttr.needsUpdate = true;
    this.writeCursor = 0;
    this.particleCountHint = 0;
    this.particleMesh.count = 0;
    this.liveTotalParticles = 0;
    this.liveWaterCount = 0;
    this.liveMagmaCount = 0;
    this.liveSteamCount = 0;
    this.pendingGeoEvents.length = 0;
  }

  /**
   * Emits a burst of Water, Magma, or Steam particles directly into GPU StorageBuffers.
   */
  public emitBurst(
    wx: number,
    wy: number,
    wz: number,
    nx: number,
    ny: number,
    nz: number,
    phase: FluidPhase,
    count: number,
    spreadRadius: number,
    speed: number,
    tempK: number,
  ): number {
    const posArr = this.posPhaseAttr.array as Float32Array;
    const vtArr = this.velTempAttr.array as Float32Array;
    const thArr = this.thermoAttr.array as Float32Array;

    const stateCode = phase === FluidPhase.Water ? 1.0 : phase === FluidPhase.Magma ? 2.0 : 3.0;
    const visc = phase === FluidPhase.Magma ? evaluateArrheniusMagmaViscosity(tempK) : phase === FluidPhase.Steam ? 0.02 : 0.18;
    const scale = Math.max(0.01, this.baseRadius / 13.0);

    let spawned = 0;
    for (let k = 0; k < count; k++) {
      const slot = this.writeCursor;
      this.writeCursor = (this.writeCursor + 1) % this.maxParticles;
      this.particleCountHint = Math.min(this.maxParticles, this.particleCountHint + 1);

      const jx = (Math.random() - 0.5) * spreadRadius * 1.1;
      const jy = (Math.random() - 0.5) * spreadRadius * 1.1;
      const jz = (Math.random() - 0.5) * spreadRadius * 1.1;

      const s4 = slot * 4;
      posArr[s4 + 0] = wx + nx * 0.25 * scale + jx;
      posArr[s4 + 1] = wy + ny * 0.25 * scale + jy;
      posArr[s4 + 2] = wz + nz * 0.25 * scale + jz;
      posArr[s4 + 3] = stateCode;

      const spraySpd = speed * (0.45 + Math.random() * 0.8);
      vtArr[s4 + 0] = nx * spraySpd + (Math.random() - 0.5) * spraySpd * 0.65;
      vtArr[s4 + 1] = ny * spraySpd + (Math.random() - 0.5) * spraySpd * 0.65;
      vtArr[s4 + 2] = nz * spraySpd + (Math.random() - 0.5) * spraySpd * 0.65;
      vtArr[s4 + 3] = tempK + (Math.random() - 0.5) * 30;

      thArr[s4 + 0] = Number(this.uSurfaceAtm.value) || 1.0;
      thArr[s4 + 1] = visc;
      thArr[s4 + 2] = 0.0;
      thArr[s4 + 3] = 0.0;

      this.pendingUploadMin = Math.min(this.pendingUploadMin, slot);
      this.pendingUploadMax = Math.max(this.pendingUploadMax, slot);
      spawned++;
    }

    this.particleMesh.count = this.particleCountHint;
    this.posPhaseAttr.needsUpdate = true;
    this.velTempAttr.needsUpdate = true;
    this.thermoAttr.needsUpdate = true;
    return spawned;
  }

  /**
   * Seeds liquid crater lakes directly into GPU multiphase StorageBuffers at planet spawn.
   */
  public seedLakesFromPlanet(planet: VoxelPlanet): void {
    this.clear();
    const fill = planet.seedConfig.waterFill;
    if (fill <= 0.02 || planet.lakeBasinCenters.length === 0) return;

    const radScale = Math.max(0.01, planet.baseRadius / 13.0);
    let seed = (planet.seedConfig.seed ^ 331997) >>> 0;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const perBasin = Math.min(640, Math.round(360 * fill));
    const posArr = this.posPhaseAttr.array as Float32Array;
    const vtArr = this.velTempAttr.array as Float32Array;
    const thArr = this.thermoAttr.array as Float32Array;

    for (const [bx, by, bz] of planet.lakeBasinCenters) {
      const bLen = Math.hypot(bx, by, bz) || 1;
      const nx = bx / bLen;
      const ny = by / bLen;
      const nz = bz / bLen;
      const ax = Math.abs(ny) < 0.9 ? 0 : 1;
      const ay = Math.abs(ny) < 0.9 ? 1 : 0;
      let tx = ay * nz;
      let ty = -ax * nz;
      let tz = ax * ny - ay * nx;
      const tLen = Math.hypot(tx, ty, tz) || 1;
      tx /= tLen; ty /= tLen; tz /= tLen;
      const ux = ny * tz - nz * ty;
      const uy = nz * tx - nx * tz;
      const uz = nx * ty - ny * tx;

      for (let k = 0; k < perBasin; k++) {
        const slot = this.writeCursor;
        this.writeCursor = (this.writeCursor + 1) % this.maxParticles;
        this.particleCountHint = Math.min(this.maxParticles, this.particleCountHint + 1);

        const ang = rand() * Math.PI * 2;
        const rad = Math.sqrt(rand()) * 2.4 * radScale;
        const dx = nx + (tx * Math.cos(ang) + ux * Math.sin(ang)) * (rad / Math.max(0.1, planet.baseRadius));
        const dy = ny + (ty * Math.cos(ang) + uy * Math.sin(ang)) * (rad / Math.max(0.1, planet.baseRadius));
        const dz = nz + (tz * Math.cos(ang) + uz * Math.sin(ang)) * (rad / Math.max(0.1, planet.baseRadius));
        const dLen = Math.hypot(dx, dy, dz) || 1;
        const rSurf = planet.findSurfaceRadiusAlongRay(dx / dLen, dy / dLen, dz / dLen);
        const spawnR = rSurf + (0.14 + rand() * 0.24) * radScale;

        const s4 = slot * 4;
        posArr[s4 + 0] = (dx / dLen) * spawnR;
        posArr[s4 + 1] = (dy / dLen) * spawnR;
        posArr[s4 + 2] = (dz / dLen) * spawnR;
        posArr[s4 + 3] = 1.0; // Water

        vtArr[s4 + 0] = 0;
        vtArr[s4 + 1] = 0;
        vtArr[s4 + 2] = 0;
        vtArr[s4 + 3] = 289.0;

        thArr[s4 + 0] = 1.0;
        thArr[s4 + 1] = 0.18;
        thArr[s4 + 2] = 0;
        thArr[s4 + 3] = 0;
      }
    }

    this.particleMesh.count = this.particleCountHint;
    this.posPhaseAttr.needsUpdate = true;
    this.velTempAttr.needsUpdate = true;
    this.thermoAttr.needsUpdate = true;
  }

  public syncUniforms(params: {
    planetRadius: number;
    surfaceAtm: number;
    gravityScale: number;
    pressureScale: number;
    ambientTempK: number;
    fluidGeoCoupling: boolean;
    cutawayActive: boolean;
  }): void {
    this.uPlanetRadius.value = params.planetRadius;
    this.uSurfaceAtm.value = Math.max(0.02, params.surfaceAtm);
    this.uGravityScale.value = Math.max(0.05, params.gravityScale);
    this.uPressureScale.value = Math.max(0.1, params.pressureScale);
    this.uAmbientTempK.value = Math.max(150, params.ambientTempK);
    this.uFluidGeoCoupling.value = params.fluidGeoCoupling ? 1.0 : 0.0;
    this.uCutawayActive.value = params.cutawayActive ? 1.0 : 0.0;
    this.uParticleSize.value = Math.max(0.01, 0.12 * (params.planetRadius / 13.0));
  }

  public dispatchStep(renderer: THREE.WebGPURenderer, dtSec: number): void {
    if (this.particleCountHint === 0) return;
    const t0 = performance.now();
    this.uDt.value = Math.max(0.002, Math.min(0.04, dtSec));

    const passes: ComputeNode[] = [
      this.clearGridNode,
      this.p2gNode,
      this.gridThermoPassNode,
      this.g2pAdvectNode,
    ];
    if (this.fluidToVoxelNode) {
      passes.push(this.fluidToVoxelNode);
    }
    try {
      renderer.compute(passes);
      this.lastDispatchMs = performance.now() - t0;
      this.scheduleReadback(renderer);
    } catch {
      // Preserve simulation stability on transient device loss
    }
  }

  private scheduleReadback(renderer: THREE.WebGPURenderer): void {
    if (this.readbackInFlight) return;
    this.readbackInFlight = true;

    void Promise.all([
      renderer.getArrayBufferAsync(this.countersAtomicAttr),
      renderer.getArrayBufferAsync(this.feedbackSolidifyAttr),
      renderer.getArrayBufferAsync(this.feedbackErosionAttr),
    ])
      .then(([cntBuf, solBuf, eroBuf]) => {
        const c = new Uint32Array(cntBuf);
        this.liveWaterCount = c[0] ?? 0;
        this.liveMagmaCount = c[1] ?? 0;
        this.liveSteamCount = c[2] ?? 0;
        this.livePeakPressureAtm = Math.max(0.2, (c[3] ?? 100) / 100.0);
        this.livePeakTempK = Math.max(200.0, (c[4] ?? 2900) / 10.0);
        this.liveTotalParticles = c[5] ?? 0;
        const hasSol = (c[6] ?? 0) > 0;
        const hasEro = (c[7] ?? 0) > 0;

        if (hasSol || hasEro) {
          const solArr = new Uint32Array(solBuf);
          const eroArr = new Uint32Array(eroBuf);
          const stepBin = (this.worldHalf * 2) / Math.max(1, FEEDBACK_BIN_AXIS - 1);
          const sq = FEEDBACK_BIN_AXIS * FEEDBACK_BIN_AXIS;
          for (let bz = 0; bz < FEEDBACK_BIN_AXIS; bz++) {
            for (let by = 0; by < FEEDBACK_BIN_AXIS; by++) {
              for (let bx = 0; bx < FEEDBACK_BIN_AXIS; bx++) {
                if (this.pendingGeoEvents.length >= 24) break;
                const bIdx = bx + by * FEEDBACK_BIN_AXIS + bz * sq;
                const wx = -this.worldHalf + bx * stepBin;
                const wy = -this.worldHalf + by * stepBin;
                const wz = -this.worldHalf + bz * stepBin;
                const sCount = solArr[bIdx] ?? 0;
                if (sCount >= 2) {
                  this.pendingGeoEvents.push({
                    x: wx,
                    y: wy,
                    z: wz,
                    kind: 'solidify_basalt',
                    intensity: Math.min(2.5, sCount * 0.28),
                  });
                }
                const eCount = eroArr[bIdx] ?? 0;
                if (eCount >= 4) {
                  this.pendingGeoEvents.push({
                    x: wx,
                    y: wy,
                    z: wz,
                    kind: 'hydraulic_erode',
                    intensity: Math.min(1.6, eCount * 0.12),
                  });
                }
              }
            }
          }
        }
      })
      .catch(() => {
        // Ignore gracefully during resize/dispose
      })
      .finally(() => {
        this.readbackInFlight = false;
      });
  }

  public drainGeoFeedbackEvents(): GeoFeedbackEvent[] {
    if (this.pendingGeoEvents.length === 0) return [];
    const copy = this.pendingGeoEvents.slice();
    this.pendingGeoEvents.length = 0;
    return copy;
  }

  public getTelemetry(enabled: boolean): GpuMultiphaseFluidTelemetry {
    const vramBytes =
      this.posPhaseAttr.array.byteLength +
      this.velTempAttr.array.byteLength +
      this.thermoAttr.array.byteLength +
      this.gridMassAttr.array.byteLength * 8 +
      this.gridVelTempAttr.array.byteLength +
      this.gridPressPhaseAttr.array.byteLength +
      this.countersAtomicAttr.array.byteLength +
      this.feedbackSolidifyAttr.array.byteLength * 2;
    return {
      enabled,
      active: enabled && this.particleMesh.visible,
      totalActiveParticles: this.liveTotalParticles,
      waterCount: this.liveWaterCount,
      magmaCount: this.liveMagmaCount,
      steamCount: this.liveSteamCount,
      peakPressureAtm: this.livePeakPressureAtm,
      peakTempK: this.livePeakTempK,
      lastDispatchMs: this.lastDispatchMs,
      vramBytes,
    };
  }

  public dispose(): void {
    this.particleMesh.geometry.dispose();
    this.particleMaterial.dispose();
  }
}
