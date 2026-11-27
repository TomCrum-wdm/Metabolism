// Full GPU-Driven Voxel Pipeline for Three.js WebGPU
// Architecture:
//   1. GPU StorageBuffer Voxel Field (density, materialId, thermo-pressure-stress vec4)
//   2. WGSL Compute Thermo-Geodynamic Pass: radial lithostatic overburden pressure, core-to-crust
//      thermal conduction, magma chamber heat halos, thermal expansion stress & fluid pore pressure
//   3. WGSL Compute Sculpting Pass: direct GPU spherical/cylindrical brush mutations without full re-upload
//   4. WGSL Compute Surface Extraction & Compaction Pass: 6-neighbor occlusion culling + vertex AO +
//      atomic surface-voxel compaction into zero-readback GPU InstancedMesh buffers
//   5. Zero-readback TSL PBR NodeMaterial sampling GPU thermo-pressure & optional FVM fields directly

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
  fract,
  instanceIndex,
  length,
  log,
  max,
  min,
  mix,
  normalLocal,
  positionLocal,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  storage,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import { MaterialId, MATERIAL_PALETTE, TerrainOverlayMode, VoxelPlanet } from './voxelPlanet';

export const MAX_GPU_VOXEL_AXIS = 72;
export const MAX_GPU_SURFACE_INSTANCES = 131072;

export interface GpuVoxelTelemetry {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly gridAxis: number;
  readonly totalVoxels: number;
  readonly visibleSurfaceInstances: number;
  readonly magmaVoxelCount: number;
  readonly peakPressureAtm: number;
  readonly lastDispatchMs: number;
  readonly vramBytes: number;
}

const MATERIAL_BULK_DENSITY_KG_M3: Record<number, number> = {
  0: 1.225, // Air
  1: 1580,  // Soil
  2: 2680,  // Stone
  3: 2980,  // Basalt
  4: 2740,  // Crystal
  5: 925,   // Ice
  6: 2380,  // Sandstone
  7: 2780,  // Magma
};

/**
 * Pure reference physical calculation (matches WGSL ComputeThermoStress pass 1:1):
 * Lithostatic overburden pressure + thermal expansion stress + pore pressure in atm.
 */
export function computeVoxelLithostaticPressureAtm(
  radiusM: number,
  planetRadiusM: number,
  surfaceAtm: number,
  gravityScale: number,
  materialId: number,
  tempK: number,
  poreFluidAtm = 0,
): number {
  const safeR0 = Math.max(0.1, planetRadiusM);
  const depthM = Math.max(0, safeR0 - radiusM);
  const depthRatio = Math.min(1.0, depthM / safeR0);
  const bulkDensity = MATERIAL_BULK_DENSITY_KG_M3[materialId] ?? 2680;
  // Planetary gravity scaling (13m sandbox scale ~ 1000m effective lithostatic column equivalence)
  const effectiveColumnM = depthM * (420.0 / Math.max(1.0, safeR0 / 13.0));
  const gEff = 9.81 * Math.max(0.05, gravityScale) * (1.0 - 0.35 * depthRatio);
  const lithoPa = bulkDensity * gEff * effectiveColumnM;
  const lithoAtm = lithoPa / 101325.0;
  // Thermal overpressure in confined rock/magma (>600K)
  const thermalBoostAtm =
    materialId === MaterialId.Magma || tempK > 600
      ? Math.max(0, tempK - 550) * 0.65 * (0.25 + depthRatio)
      : 0;
  return Math.max(0.02, surfaceAtm + lithoAtm + thermalBoostAtm + poreFluidAtm);
}

/**
 * Maps temperature (K) to physical blackbody radiation RGB for glowing magma & hot basalt.
 */
export function evaluateBlackbodyMagmaRgb(tempK: number): [number, number, number] {
  if (tempK <= 720) return [0.16, 0.14, 0.15];
  const tNorm = Math.max(0, Math.min(1, (tempK - 720) / 1100));
  if (tNorm < 0.35) {
    const u = tNorm / 0.35;
    return [0.22 + 0.68 * u, 0.08 + 0.08 * u, 0.05];
  }
  if (tNorm < 0.72) {
    const u = (tNorm - 0.35) / 0.37;
    return [0.9 + 0.1 * u, 0.16 + 0.42 * u, 0.05 + 0.06 * u];
  }
  const u = (tNorm - 0.72) / 0.28;
  return [1.0, 0.58 + 0.38 * u, 0.11 + 0.56 * u];
}

/**
 * Pure reference pressure colormap (atm -> RGB) for CPU/WebGL2 fallback parity.
 */
export function pressureAtmToRgb(
  pressureAtm: number,
  outRgb: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  // Log scale from 0.2 atm to ~18,000 atm
  const logP = Math.max(0, Math.min(1, Math.log10(Math.max(0.2, pressureAtm) * 5.0) / 5.0));
  let r = 0.08;
  let g = 0.24;
  let b = 0.78;
  if (logP < 0.25) {
    const u = logP / 0.25;
    r = 0.08 + u * 0.04;
    g = 0.24 + u * 0.56;
    b = 0.78 + u * 0.18;
  } else if (logP < 0.5) {
    const u = (logP - 0.25) / 0.25;
    r = 0.12 + u * 0.16;
    g = 0.8 + u * 0.06;
    b = 0.96 - u * 0.58;
  } else if (logP < 0.75) {
    const u = (logP - 0.5) / 0.25;
    r = 0.28 + u * 0.7;
    g = 0.86 - u * 0.24;
    b = 0.38 - u * 0.28;
  } else {
    const u = (logP - 0.75) / 0.25;
    r = 0.98;
    g = 0.62 - u * 0.44;
    b = 0.1 + u * 0.62;
  }
  outRgb[0] = r;
  outRgb[1] = g;
  outRgb[2] = b;
  return outRgb;
}

export class GpuVoxelPipeline {
  public readonly axisSize: number;
  public readonly totalVoxels: number;
  public readonly worldHalf: number;
  public readonly voxelSize: number;
  public readonly baseRadius: number;
  public readonly maxInstances: number;

  // Core GPU Voxel Storage Buffers
  public readonly densityAttr: THREE.StorageBufferAttribute;
  public readonly materialAttr: THREE.StorageBufferAttribute;
  // vec4(tempK, totalPressureAtm, fluidErosionStress, magmaHeatFraction)
  public readonly thermoStressAttr: THREE.StorageBufferAttribute;
  // vec4(fluidPorePressAtm, fluidHeatK, fluidShearRate, unused) - written by GpuMultiphaseFluid or CPU sync
  public readonly fluidCouplingAttr: THREE.StorageBufferAttribute;

  // Compacted GPU Surface Instance Output Buffers
  public readonly instPosScaleAttr: THREE.StorageBufferAttribute;
  public readonly instMetaAttr: THREE.StorageBufferAttribute;
  // [0]=visibleSurfaceCount, [1]=magmaVoxelCount, [2]=peakPressureAtm*100, [3]=solidVoxelCount
  public readonly countersAtomicAttr: THREE.StorageBufferAttribute;

  // Read-only Storage Nodes for TSL materials & Compute passes
  public readonly densityReadNode;
  public readonly materialReadNode;
  public readonly thermoStressReadNode;
  public readonly fluidCouplingReadNode;
  public readonly instPosScaleReadNode;
  public readonly instMetaReadNode;

  // Uniforms
  private readonly uDt = uniform(0.016);
  private readonly uPlanetRadius = uniform(13.0);
  private readonly uSurfaceAtm = uniform(1.0);
  private readonly uGravityScale = uniform(1.0);
  private readonly uCoreTempC = uniform(950.0);
  private readonly uSunDir = uniform(new THREE.Vector3(0.7, 0.5, 0.5));
  private readonly uCutawayActive = uniform(0.0);
  private readonly uLiveInstanceCount = uniform(0.0);
  private readonly uGpuOverlayMode = uniform(0.0); // 0=material, 1=temp, 2=density, 3=metab, 4=pressure
  private readonly uVoxelEdges = uniform(1.0);
  private readonly uBloomBoost = uniform(0.0);

  // Brush uniforms for direct GPU sculpting
  private readonly uBrushCenter = uniform(new THREE.Vector3(0, 0, 0));
  private readonly uBrushRadius = uniform(2.0);
  private readonly uBrushStrength = uniform(1.0);
  private readonly uBrushMode = uniform(0.0); // 0=carve, 1=build, 2=paint, 3=magma
  private readonly uBrushMatId = uniform(2.0);

  // Compute Passes
  private readonly resetCountersNode: ComputeNode;
  private readonly thermoPressurePassNode: ComputeNode;
  private readonly gpuBrushNode: ComputeNode;
  private readonly extractSurfaceNode: ComputeNode;

  // Zero-Readback GPU Instanced Voxel Surface Mesh
  public readonly instancedMesh: THREE.InstancedMesh;
  public readonly instancedMaterial: THREE.MeshPhysicalNodeMaterial;

  private readbackInFlight = false;
  public gpuHealthy = true;
  public liveVisibleInstances = 0;
  public liveMagmaVoxels = 0;
  public livePeakPressureAtm = 1.0;
  public lastDispatchMs = 0;
  public needsSurfaceExtract = true;

  constructor(
    planet: VoxelPlanet,
    maxInstances = MAX_GPU_SURFACE_INSTANCES,
    fvmColorSamplerFn?: (worldPos: Node<'vec3'>, channel: Node<'float'>) => Node<'vec3'>,
    fvmActiveNode?: THREE.UniformNode<'float'>,
    fvmChannelNode?: THREE.UniformNode<'float'>,
  ) {
    this.axisSize = Math.min(MAX_GPU_VOXEL_AXIS, Math.max(16, planet.gridN));
    this.totalVoxels = this.axisSize * this.axisSize * this.axisSize;
    this.worldHalf = planet.worldHalf;
    this.voxelSize = (planet.worldHalf * 2) / Math.max(1, this.axisSize - 1);
    this.baseRadius = planet.baseRadius;
    this.maxInstances = maxInstances;
    this.uPlanetRadius.value = planet.baseRadius;

    this.densityAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalVoxels), 1);
    this.materialAttr = new THREE.StorageBufferAttribute(new Uint32Array(this.totalVoxels), 1);
    this.thermoStressAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalVoxels * 4), 4);
    this.fluidCouplingAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalVoxels * 4), 4);

    this.instPosScaleAttr = new THREE.StorageBufferAttribute(new Float32Array(maxInstances * 4), 4);
    this.instMetaAttr = new THREE.StorageBufferAttribute(new Float32Array(maxInstances * 4), 4);
    this.countersAtomicAttr = new THREE.StorageBufferAttribute(new Uint32Array(4), 1);

    const N = this.totalVoxels;
    this.densityReadNode = storage(this.densityAttr, 'float', N).toReadOnly();
    const densityWrite = storage(this.densityAttr, 'float', N);
    this.materialReadNode = storage(this.materialAttr, 'uint', N).toReadOnly();
    const materialWrite = storage(this.materialAttr, 'uint', N);
    this.thermoStressReadNode = storage(this.thermoStressAttr, 'vec4', N).toReadOnly();
    const thermoStressWrite = storage(this.thermoStressAttr, 'vec4', N);
    this.fluidCouplingReadNode = storage(this.fluidCouplingAttr, 'vec4', N).toReadOnly();

    this.instPosScaleReadNode = storage(this.instPosScaleAttr, 'vec4', maxInstances).toReadOnly();
    const instPosScaleWrite = storage(this.instPosScaleAttr, 'vec4', maxInstances);
    this.instMetaReadNode = storage(this.instMetaAttr, 'vec4', maxInstances).toReadOnly();
    const instMetaWrite = storage(this.instMetaAttr, 'vec4', maxInstances);
    const countersAtomic = storage(this.countersAtomicAttr, 'uint', 4).toAtomic();

    const axisU = uint(this.axisSize);
    const axisSqU = uint(this.axisSize * this.axisSize);
    const axisMaxU = uint(this.axisSize - 1);
    const hVal = float(this.voxelSize);
    const halfF = float(this.worldHalf);
    const maxInstU = uint(maxInstances);

    // Pass 0: Reset atomic counters
    this.resetCountersNode = Fn(() => {
      If(instanceIndex.lessThan(uint(4)), () => {
        atomicStore(countersAtomic.element(instanceIndex), uint(0));
      });
    })().compute(4, [4]).setName('GpuVoxelResetCounters');

    // Pass 1: Thermo-Geodynamic Field Solver (Lithostatic Pressure, Core Heat, Magma Conductance, Pore Pressure)
    this.thermoPressurePassNode = Fn(() => {
      const idx = instanceIndex;
      const iz = idx.div(axisSqU);
      const rem = idx.sub(iz.mul(axisSqU));
      const iy = rem.div(axisU);
      const ix = rem.sub(iy.mul(axisU));

      const wx = float(ix).mul(hVal).sub(halfF);
      const wy = float(iy).mul(hVal).sub(halfF);
      const wz = float(iz).mul(hVal).sub(halfF);

      const dens = this.densityReadNode.element(idx);
      const matU = this.materialReadNode.element(idx);
      const fluidC = this.fluidCouplingReadNode.element(idx);
      // Read previous thermo-stress from the single writable storage view to avoid WebGPU read+write buffer aliasing
      const prevTS = thermoStressWrite.element(idx);

      const r = length(vec3(wx, wy, wz));
      const safeR0 = max(this.uPlanetRadius, float(0.1));
      const dir = vec3(wx, wy, wz).div(max(r, float(0.001)));
      const sunDot = dot(dir, this.uSunDir);
      const depthM = max(float(0.0), safeR0.sub(r));
      const depthRatio = tslClamp(depthM.div(safeR0), 0.0, 1.0);

      // Material bulk density lookup (kg/m^3)
      const matF = float(matU);
      const bulkRho = select(
        matU.equal(uint(0)),
        float(1.225),
        select(
          matU.equal(uint(1)),
          float(1580.0),
          select(
            matU.equal(uint(3)),
            float(2980.0),
            select(
              matU.equal(uint(5)),
              float(925.0),
              select(
                matU.equal(uint(6)),
                float(2380.0),
                select(matU.equal(uint(7)), float(2780.0), float(2680.0)),
              ),
            ),
          ),
        ),
      );

      // Base surface + geothermal radial temperature profile (K)
      const surfT = float(285.0).add(sunDot.mul(22.0));
      const coreBoost = pow(depthRatio, float(1.45)).mul(this.uCoreTempC.add(273.15));
      const baseGeoT = surfT.add(coreBoost);

      // Magma material maintains high melt enthalpy & gradually relaxes with ambient conduction
      const isMagma = matU.equal(uint(7));
      const targetT = select(
        isMagma,
        max(baseGeoT, float(1380.0)),
        max(baseGeoT, fluidC.y),
      );
      const tempK = mix(max(prevTS.x, float(200.0)), targetT, tslClamp(this.uDt.mul(1.8), 0.08, 0.85)).toVar();
      If(prevTS.x.lessThan(10.0), () => {
        tempK.assign(targetT);
      });

      // Lithostatic overburden pressure + thermal expansion + hydrothermal pore pressure
      const colScale = float(420.0).div(max(float(1.0), safeR0.div(13.0)));
      const effectiveColM = depthM.mul(colScale);
      const gEff = float(9.81).mul(max(this.uGravityScale, float(0.05))).mul(float(1.0).sub(depthRatio.mul(0.35)));
      const lithoAtm = bulkRho.mul(gEff).mul(effectiveColM).div(101325.0);
      const thermalOverP = select(
        isMagma.or(tempK.greaterThan(600.0)),
        max(float(0.0), tempK.sub(550.0)).mul(0.65).mul(float(0.25).add(depthRatio)),
        float(0.0),
      );
      const totalPressAtm = select(
        dens.greaterThan(0.0),
        max(float(0.02), this.uSurfaceAtm.add(lithoAtm).add(thermalOverP).add(fluidC.x)),
        max(float(0.01), this.uSurfaceAtm.mul(exp(max(float(0.0), r.sub(safeR0)).negate().div(max(safeR0.mul(0.22), 0.2)))).add(fluidC.x)),
      );

      // Fluid hydraulic erosion accum decays smoothly unless actively scoured
      const erosionStress = tslClamp(prevTS.z.mul(0.96).add(fluidC.z.mul(this.uDt)), 0.0, 10.0);
      const magmaFrac = select(isMagma, float(1.0), tslClamp(tempK.sub(750.0).div(650.0), 0.0, 1.0));

      thermoStressWrite.element(idx).assign(vec4(tempK, totalPressAtm, erosionStress, magmaFrac));

      If(dens.greaterThan(0.0), () => {
        atomicAdd(countersAtomic.element(uint(3)), uint(1));
        If(isMagma, () => {
          atomicAdd(countersAtomic.element(uint(1)), uint(1));
        });
        atomicMax(countersAtomic.element(uint(2)), uint(tslClamp(totalPressAtm.mul(10.0), 0.0, 400000000.0)));
      });
    })().compute(N, [64]).setName('GpuVoxelThermoPressurePass');

    // Pass 2: Direct GPU Sculpting Kernel (syncs spherical/magma brush straight to GPU StorageBuffers)
    this.gpuBrushNode = Fn(() => {
      const idx = instanceIndex;
      const iz = idx.div(axisSqU);
      const rem = idx.sub(iz.mul(axisSqU));
      const iy = rem.div(axisU);
      const ix = rem.sub(iy.mul(axisU));

      const wx = float(ix).mul(hVal).sub(halfF);
      const wy = float(iy).mul(hVal).sub(halfF);
      const wz = float(iz).mul(hVal).sub(halfF);

      const d = length(vec3(wx, wy, wz).sub(this.uBrushCenter));
      const rad = max(this.uBrushRadius, float(0.001));
      If(d.lessThanEqual(rad), () => {
        const w = float(1.0).sub(d.div(rad));
        const smoothW = w.mul(w).mul(float(3.0).sub(w.mul(2.0)));
        const curDens = densityWrite.element(idx);
        const curTS = thermoStressWrite.element(idx);

        // 0=carve, 1=build, 2=paint, 3=magma
        If(this.uBrushMode.lessThan(0.5), () => {
          const nextD = curDens.sub(this.uBrushStrength.mul(smoothW));
          densityWrite.element(idx).assign(nextD);
          If(nextD.lessThanEqual(0.0), () => {
            materialWrite.element(idx).assign(uint(0));
          });
        }).ElseIf(this.uBrushMode.lessThan(1.5), () => {
          const nextD = curDens.add(this.uBrushStrength.mul(smoothW));
          densityWrite.element(idx).assign(nextD);
          If(nextD.greaterThan(0.0), () => {
            materialWrite.element(idx).assign(uint(this.uBrushMatId));
          });
        }).ElseIf(this.uBrushMode.lessThan(2.5), () => {
          If(curDens.greaterThan(0.0), () => {
            materialWrite.element(idx).assign(uint(this.uBrushMatId));
          });
        }).Else(() => {
          // Magma injection: melt core & rim into incandescent MaterialId.Magma (7)
          If(d.lessThan(rad.mul(0.58)), () => {
            const nextD = max(curDens, float(0.45).mul(smoothW));
            densityWrite.element(idx).assign(nextD);
            materialWrite.element(idx).assign(uint(7));
            thermoStressWrite.element(idx).assign(vec4(float(1480.0), curTS.y.add(120.0), curTS.z, float(1.0)));
          }).ElseIf(curDens.greaterThan(0.0), () => {
            materialWrite.element(idx).assign(uint(3));
            thermoStressWrite.element(idx).assign(vec4(max(curTS.x, float(880.0)), curTS.y, curTS.z, float(0.45)));
          });
        });
      });
    })().compute(N, [64]).setName('GpuVoxelBrushKernel');

    // Pass 3: Full GPU Surface Culling + 6-Neighbor AO + Atomic Compaction
    this.extractSurfaceNode = Fn(() => {
      const idx = instanceIndex;
      const iz = idx.div(axisSqU);
      const rem = idx.sub(iz.mul(axisSqU));
      const iy = rem.div(axisU);
      const ix = rem.sub(iy.mul(axisU));

      const dens = this.densityReadNode.element(idx);
      const wx = float(ix).mul(hVal).sub(halfF);
      const wy = float(iy).mul(hVal).sub(halfF);
      const wz = float(iz).mul(hVal).sub(halfF);

      const inCutaway = this.uCutawayActive.greaterThan(0.5)
        .and(wx.greaterThan(0.0))
        .and(wy.greaterThan(0.0))
        .and(wz.greaterThan(0.0));

      If(dens.greaterThan(0.0).and(inCutaway.not()), () => {
        const sampleSolid = (nx: Node<'uint'>, ny: Node<'uint'>, nz: Node<'uint'>) => {
          const nIdx = nx.add(ny.mul(axisU)).add(nz.mul(axisSqU));
          const nwx = float(nx).mul(hVal).sub(halfF);
          const nwy = float(ny).mul(hVal).sub(halfF);
          const nwz = float(nz).mul(hVal).sub(halfF);
          const nCut = this.uCutawayActive.greaterThan(0.5)
            .and(nwx.greaterThan(0.0))
            .and(nwy.greaterThan(0.0))
            .and(nwz.greaterThan(0.0));
          return select(
            nCut,
            float(0.0),
            select(this.densityReadNode.element(nIdx).greaterThan(0.0), float(1.0), float(0.0)),
          );
        };

        const pxS = select(ix.lessThan(axisMaxU), sampleSolid(ix.add(uint(1)), iy, iz), float(0.0));
        const nxS = select(ix.greaterThan(uint(0)), sampleSolid(ix.sub(uint(1)), iy, iz), float(0.0));
        const pyS = select(iy.lessThan(axisMaxU), sampleSolid(ix, iy.add(uint(1)), iz), float(0.0));
        const nyS = select(iy.greaterThan(uint(0)), sampleSolid(ix, iy.sub(uint(1)), iz), float(0.0));
        const pzS = select(iz.lessThan(axisMaxU), sampleSolid(ix, iy, iz.add(uint(1))), float(0.0));
        const nzS = select(iz.greaterThan(uint(0)), sampleSolid(ix, iy, iz.sub(uint(1))), float(0.0));

        const neighborSum = pxS.add(nxS).add(pyS).add(nyS).add(pzS).add(nzS);
        // Surface voxel if at least one of 6 neighbors is air/cutaway
        If(neighborSum.lessThan(5.99), () => {
          const slot = atomicAdd(countersAtomic.element(uint(0)), uint(1));
          If(slot.lessThan(maxInstU), () => {
            const matU = this.materialReadNode.element(idx);
            const ts = this.thermoStressReadNode.element(idx);
            // Compute fast GPU cavity AO from 6-neighbor solid count
            const ao = tslClamp(float(1.0).sub(neighborSum.div(6.0).mul(0.32)), 0.58, 1.0);
            instPosScaleWrite.element(slot).assign(vec4(wx, wy, wz, hVal));
            instMetaWrite.element(slot).assign(vec4(float(matU), ts.x, ts.y, ao.add(ts.z.mul(0.1))));
          });
        });
      });
    })().compute(N, [64]).setName('GpuVoxelSurfaceCullPass');

    // Zero-Readback GPU Instanced Voxel Mesh & TSL NodeMaterial
    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshPhysicalNodeMaterial();

    mat.positionNode = Fn(() => {
      const alive = float(instanceIndex).lessThan(this.uLiveInstanceCount);
      const posScale = this.instPosScaleReadNode.element(instanceIndex);
      const sc = select(alive, posScale.w, float(0.0));
      return positionLocal.mul(sc).add(posScale.xyz);
    })();

    const evaluateVoxelColor = (includeBevelAndFvm: boolean): Node<'vec3'> => {
      const instPos = this.instPosScaleReadNode.element(instanceIndex).xyz;
      const meta = this.instMetaReadNode.element(instanceIndex);
      const matF = meta.x;
      const tempK = meta.y;
      const pressAtm = meta.z;
      const aoRaw = tslClamp(meta.w, 0.58, 1.0);

      // Physical material base colors
      const cSoil = color(0x307336);
      const cStone = color(0x757d8a);
      const cBasalt = color(0x363b47);
      const cCrystal = color(0x29d1e0);
      const cIce = color(0xe8f2fc);
      const cSand = color(0xbf8f63);
      const cMagmaHot = color(0xff5500);

      let baseCol = mix(cStone, cSoil, smoothstep(0.5, 1.0, matF).mul(float(1.0).sub(smoothstep(1.5, 2.0, matF))));
      baseCol = mix(baseCol, cBasalt, smoothstep(2.5, 3.0, matF).mul(float(1.0).sub(smoothstep(3.5, 4.0, matF))));
      baseCol = mix(baseCol, cCrystal, smoothstep(3.5, 4.0, matF).mul(float(1.0).sub(smoothstep(4.5, 5.0, matF))));
      baseCol = mix(baseCol, cIce, smoothstep(4.5, 5.0, matF).mul(float(1.0).sub(smoothstep(5.5, 6.0, matF))));
      baseCol = mix(baseCol, cSand, smoothstep(5.5, 6.0, matF).mul(float(1.0).sub(smoothstep(6.5, 7.0, matF))));

      // Blackbody magma incandescence (> 750K)
      const isMagmaMat = smoothstep(6.5, 7.0, matF);
      const tNorm = tslClamp(tempK.sub(720.0).div(1100.0), 0.0, 1.0);
      const bbDarkRed = color(0x991b1b);
      const bbOrange = color(0xf97316);
      const bbYellow = color(0xfef08a);
      let bbCol = mix(bbDarkRed, bbOrange, smoothstep(0.15, 0.65, tNorm));
      bbCol = mix(bbCol, bbYellow, smoothstep(0.65, 1.0, tNorm));
      baseCol = mix(baseCol, max(cMagmaHot, bbCol), max(isMagmaMat, smoothstep(820.0, 1300.0, tempK).mul(0.85)));

      // Thermal overlay (1)
      const tempC = tempK.sub(273.15);
      let thermCol = mix(color(0x2840b8), color(0x22d3ee), smoothstep(-70.0, -5.0, tempC));
      thermCol = mix(thermCol, color(0x34d399), smoothstep(-5.0, 20.0, tempC));
      thermCol = mix(thermCol, color(0xfbbf24), smoothstep(20.0, 48.0, tempC));
      thermCol = mix(thermCol, color(0xef4444), smoothstep(48.0, 240.0, tempC));
      thermCol = mix(thermCol, color(0xfef08a), smoothstep(240.0, 950.0, tempC));

      // Pressure & Stress overlay (4)
      const logP = tslClamp(log(max(pressAtm, float(0.2)).mul(5.0)).div(log(float(10.0)).mul(5.0)), 0.0, 1.0);
      let pressCol = mix(color(0x143d9e), color(0x1fcce8), smoothstep(0.0, 0.25, logP));
      pressCol = mix(pressCol, color(0x22c55e), smoothstep(0.25, 0.5, logP));
      pressCol = mix(pressCol, color(0xf59e0b), smoothstep(0.5, 0.75, logP));
      pressCol = mix(pressCol, color(0xe11d48), smoothstep(0.75, 1.0, logP));
      const isoBar = float(1.0).sub(smoothstep(0.0, 0.08, fract(logP.mul(12.0)))).mul(0.22);
      pressCol = pressCol.add(vec3(isoBar)).saturate();

      // Density / 4-Sphere Stratification overlay (2)
      const rRatio = length(instPos).div(max(this.uPlanetRadius, float(0.1)));
      let densCol = mix(color(0xfef08a), color(0xf97316), smoothstep(0.155, 0.185, rRatio));
      densCol = mix(densCol, color(0x991b1b), smoothstep(0.285, 0.315, rRatio));
      densCol = mix(densCol, color(0x38bdf8), smoothstep(0.77, 0.81, rRatio));

      const ov = this.uGpuOverlayMode;
      const isT = smoothstep(0.5, 1.0, ov).mul(float(1.0).sub(smoothstep(1.5, 2.0, ov)));
      const isD = smoothstep(1.5, 2.0, ov).mul(float(1.0).sub(smoothstep(2.5, 3.0, ov)));
      const isM = smoothstep(2.5, 3.0, ov).mul(float(1.0).sub(smoothstep(3.5, 4.0, ov)));
      const isP = smoothstep(3.5, 4.0, ov);

      let outRgb = baseCol.mul(aoRaw);
      outRgb = mix(outRgb, thermCol, isT);
      outRgb = mix(outRgb, densCol, isD);
      if (includeBevelAndFvm && fvmColorSamplerFn && fvmActiveNode && fvmChannelNode) {
        const fvmSample = fvmColorSamplerFn(instPos, fvmChannelNode);
        outRgb = mix(outRgb, mix(baseCol, fvmSample, fvmActiveNode), isM);
      }
      outRgb = mix(outRgb, pressCol, isP);

      if (!includeBevelAndFvm) {
        return outRgb.saturate();
      }

      // Block face crisp bevel border via uv()
      const blockUv = uv();
      const edgeDist = min(min(blockUv.x, float(1.0).sub(blockUv.x)), min(blockUv.y, float(1.0).sub(blockUv.y)));
      const borderMask = smoothstep(0.0, 0.068, edgeDist);
      const borderShade = mix(float(1.0), mix(float(0.54), float(1.0), borderMask), this.uVoxelEdges);
      return outRgb.mul(borderShade).saturate();
    };

    mat.colorNode = Fn(() => evaluateVoxelColor(true))();
    mat.roughnessNode = Fn(() => {
      const meta = this.instMetaReadNode.element(instanceIndex);
      const matF = meta.x;
      const isGlass = smoothstep(3.5, 4.0, matF).mul(float(1.0).sub(smoothstep(5.5, 6.0, matF)));
      const isMagma = smoothstep(6.5, 7.0, matF);
      return tslClamp(float(0.84).sub(isGlass.mul(0.62)).sub(isMagma.mul(0.55)), 0.16, 0.94);
    })();
    mat.metalnessNode = Fn(() => {
      const matF = this.instMetaReadNode.element(instanceIndex).x;
      const isCrystal = smoothstep(3.5, 4.0, matF).mul(float(1.0).sub(smoothstep(4.5, 5.0, matF)));
      return float(0.05).add(isCrystal.mul(0.2));
    })();
    mat.emissiveNode = Fn(() => {
      const meta = this.instMetaReadNode.element(instanceIndex);
      const matF = meta.x;
      const tempK = meta.y;
      const pressAtm = meta.z;
      const emCol = evaluateVoxelColor(false);
      const isCrystal = smoothstep(3.5, 4.0, matF).mul(float(1.0).sub(smoothstep(4.5, 5.0, matF)));
      const magmaGlow = max(smoothstep(6.5, 7.0, matF), smoothstep(820.0, 1450.0, tempK));
      const baseGlow = emCol
        .mul(isCrystal.mul(0.55).add(magmaGlow.mul(1.45)))
        .mul(float(1.0).add(this.uBloomBoost.mul(0.65)));

      const ov = this.uGpuOverlayMode;
      const isP = smoothstep(3.5, 4.0, ov);
      const pressGlow = emCol.mul(tslClamp(pressAtm.div(2500.0), 0.08, 0.45)).mul(isP);
      return baseGlow.add(pressGlow);
    })();

    this.instancedMaterial = mat;
    this.instancedMesh = new THREE.InstancedMesh(cubeGeo, mat, maxInstances);
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = true;
    this.instancedMesh.count = 0;
    this.instancedMesh.visible = false;
  }

  /**
   * Syncs full planet density & material grids into GPU StorageBuffers.
   * Handles both 1:1 macro resolution and resampled super-res grids cleanly.
   */
  public uploadFromPlanet(planet: VoxelPlanet): void {
    const gN = planet.gridN;
    const gpuN = this.axisSize;
    const densArr = this.densityAttr.array as Float32Array;
    const matArr = this.materialAttr.array as Uint32Array;
    const tsArr = this.thermoStressAttr.array as Float32Array;

    this.uPlanetRadius.value = planet.baseRadius;
    const r0 = Math.max(0.1, planet.baseRadius);
    const half = planet.worldHalf;
    const step = (half * 2) / Math.max(1, gpuN - 1);

    if (gN === gpuN && planet.density.length === this.totalVoxels) {
      densArr.set(planet.density);
      for (let i = 0; i < this.totalVoxels; i++) {
        const m = planet.material[i] ?? 0;
        matArr[i] = m;
      }
    } else {
      for (let iz = 0; iz < gpuN; iz++) {
        const wz = -half + iz * step;
        for (let iy = 0; iy < gpuN; iy++) {
          const wy = -half + iy * step;
          for (let ix = 0; ix < gpuN; ix++) {
            const wx = -half + ix * step;
            const i = ix + iy * gpuN + iz * gpuN * gpuN;
            densArr[i] = planet.sampleDensity(wx, wy, wz);
            matArr[i] = planet.sampleNearestMaterial(wx, wy, wz);
          }
        }
      }
    }

    // Seed initial thermo-pressure baseline synchronously so first frame has valid pressure
    for (let iz = 0; iz < gpuN; iz++) {
      const wz = -half + iz * step;
      for (let iy = 0; iy < gpuN; iy++) {
        const wy = -half + iy * step;
        for (let ix = 0; ix < gpuN; ix++) {
          const wx = -half + ix * step;
          const i = ix + iy * gpuN + iz * gpuN * gpuN;
          const r = Math.hypot(wx, wy, wz);
          const depthRatio = Math.max(0, Math.min(1, (r0 - r) / r0));
          const m = matArr[i];
          const initT = m === MaterialId.Magma ? 1420 : 288 + Math.pow(depthRatio, 1.45) * 1200;
          const initP = computeVoxelLithostaticPressureAtm(
            r,
            r0,
            Number(this.uSurfaceAtm.value) || 1.0,
            Number(this.uGravityScale.value) || 1.0,
            m,
            initT,
          );
          tsArr[i * 4 + 0] = initT;
          tsArr[i * 4 + 1] = initP;
          tsArr[i * 4 + 2] = 0;
          tsArr[i * 4 + 3] = m === MaterialId.Magma ? 1.0 : 0.0;
        }
      }
    }

    this.densityAttr.needsUpdate = true;
    this.materialAttr.needsUpdate = true;
    this.thermoStressAttr.needsUpdate = true;
    this.rebuildSurfaceCpu(Number(this.uCutawayActive.value) > 0.5);
    this.needsSurfaceExtract = true;
  }

  /**
   * Synchronously extracts 6-neighbor occluded surface cubes on CPU so the InstancedMesh renders
   * on frame 0 without waiting for async GPU counter readback, and serves as an instant baseline.
   */
  public rebuildSurfaceCpu(cutawayActive = Number(this.uCutawayActive.value) > 0.5): number {
    const gpuN = this.axisSize;
    const sq = gpuN * gpuN;
    const half = this.worldHalf;
    const step = this.voxelSize;
    const densArr = this.densityAttr.array as Float32Array;
    const matArr = this.materialAttr.array as Uint32Array;
    const tsArr = this.thermoStressAttr.array as Float32Array;
    const posScaleOut = this.instPosScaleAttr.array as Float32Array;
    const metaOut = this.instMetaAttr.array as Float32Array;
    const cntOut = this.countersAtomicAttr.array as Uint32Array;

    const isSolid = (ix: number, iy: number, iz: number): number => {
      if (ix < 0 || iy < 0 || iz < 0 || ix >= gpuN || iy >= gpuN || iz >= gpuN) return 0;
      const wx = -half + ix * step;
      const wy = -half + iy * step;
      const wz = -half + iz * step;
      if (cutawayActive && wx > 0 && wy > 0 && wz > 0) return 0;
      return densArr[ix + iy * gpuN + iz * sq] > 0 ? 1 : 0;
    };

    let slot = 0;
    let magmaCount = 0;
    let peakPressAtm = 1.0;
    for (let iz = 0; iz < gpuN; iz++) {
      const wz = -half + iz * step;
      for (let iy = 0; iy < gpuN; iy++) {
        const wy = -half + iy * step;
        for (let ix = 0; ix < gpuN; ix++) {
          const wx = -half + ix * step;
          if (cutawayActive && wx > 0 && wy > 0 && wz > 0) continue;
          const idx = ix + iy * gpuN + iz * sq;
          if (densArr[idx] <= 0) continue;

          const matId = matArr[idx];
          if (matId === MaterialId.Magma) magmaCount++;
          const ts4 = idx * 4;
          const pressAtm = tsArr[ts4 + 1] || 1.0;
          if (pressAtm > peakPressAtm) peakPressAtm = pressAtm;

          const neighborSum =
            isSolid(ix + 1, iy, iz) +
            isSolid(ix - 1, iy, iz) +
            isSolid(ix, iy + 1, iz) +
            isSolid(ix, iy - 1, iz) +
            isSolid(ix, iy, iz + 1) +
            isSolid(ix, iy, iz - 1);

          if (neighborSum < 6 && slot < this.maxInstances) {
            const o4 = slot * 4;
            posScaleOut[o4 + 0] = wx;
            posScaleOut[o4 + 1] = wy;
            posScaleOut[o4 + 2] = wz;
            posScaleOut[o4 + 3] = step;

            const ao = Math.max(0.58, Math.min(1.0, 1.0 - (neighborSum / 6.0) * 0.32));
            metaOut[o4 + 0] = matId;
            metaOut[o4 + 1] = tsArr[ts4 + 0] || 288.0;
            metaOut[o4 + 2] = pressAtm;
            metaOut[o4 + 3] = ao;
            slot++;
          }
        }
      }
    }

    cntOut[0] = slot;
    cntOut[1] = magmaCount;
    cntOut[2] = Math.round(peakPressAtm * 10);
    this.instPosScaleAttr.needsUpdate = true;
    this.instMetaAttr.needsUpdate = true;
    this.countersAtomicAttr.needsUpdate = true;
    this.liveVisibleInstances = slot;
    this.liveMagmaVoxels = magmaCount;
    this.livePeakPressureAtm = peakPressAtm;
    this.uLiveInstanceCount.value = slot;
    this.instancedMesh.count = slot;
    return slot;
  }

  /**
   * Syncs a local dirty bounding box after terrain edits/solidification/erosion.
   */
  public syncLocalRegionFromPlanet(
    planet: VoxelPlanet,
    wx: number,
    wy: number,
    wz: number,
    radiusM: number,
  ): void {
    const gpuN = this.axisSize;
    const half = planet.worldHalf;
    const step = (half * 2) / Math.max(1, gpuN - 1);
    const padR = radiusM + step * 1.5;

    const minX = Math.max(0, Math.floor((wx - padR + half) / step));
    const maxX = Math.min(gpuN - 1, Math.ceil((wx + padR + half) / step));
    const minY = Math.max(0, Math.floor((wy - padR + half) / step));
    const maxY = Math.min(gpuN - 1, Math.ceil((wy + padR + half) / step));
    const minZ = Math.max(0, Math.floor((wz - padR + half) / step));
    const maxZ = Math.min(gpuN - 1, Math.ceil((wz + padR + half) / step));

    const densArr = this.densityAttr.array as Float32Array;
    const matArr = this.materialAttr.array as Uint32Array;
    const gN = planet.gridN;

    if (gN === gpuN) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        for (let iy = minY; iy <= maxY; iy++) {
          for (let ix = minX; ix <= maxX; ix++) {
            const idx = ix + iy * gpuN + iz * gpuN * gpuN;
            densArr[idx] = planet.density[idx];
            matArr[idx] = planet.material[idx];
          }
        }
      }
    } else {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const pz = -half + iz * step;
        for (let iy = minY; iy <= maxY; iy++) {
          const py = -half + iy * step;
          for (let ix = minX; ix <= maxX; ix++) {
            const px = -half + ix * step;
            const idx = ix + iy * gpuN + iz * gpuN * gpuN;
            densArr[idx] = planet.sampleDensity(px, py, pz);
            matArr[idx] = planet.sampleNearestMaterial(px, py, pz);
          }
        }
      }
    }

    this.densityAttr.needsUpdate = true;
    this.materialAttr.needsUpdate = true;
    this.needsSurfaceExtract = true;
  }

  public dispatchBrush(
    renderer: THREE.WebGPURenderer,
    wx: number,
    wy: number,
    wz: number,
    radiusM: number,
    strength: number,
    mode: 'carve' | 'build' | 'paint' | 'magma',
    materialId: MaterialId,
  ): void {
    this.uBrushCenter.value.set(wx, wy, wz);
    this.uBrushRadius.value = radiusM;
    this.uBrushStrength.value = strength;
    this.uBrushMode.value = mode === 'carve' ? 0 : mode === 'build' ? 1 : mode === 'paint' ? 2 : 3;
    this.uBrushMatId.value = materialId;
    renderer.compute(this.gpuBrushNode);
    this.needsSurfaceExtract = true;
  }

  public syncUniforms(params: {
    planetRadius: number;
    surfaceAtm: number;
    gravityScale: number;
    coreTempC: number;
    sunDir: readonly [number, number, number];
    cutawayActive: boolean;
    overlayMode: TerrainOverlayMode;
    voxelEdges: boolean;
    bloomEnabled: boolean;
  }): void {
    this.uPlanetRadius.value = params.planetRadius;
    this.uSurfaceAtm.value = Math.max(0.01, params.surfaceAtm);
    this.uGravityScale.value = Math.max(0.05, params.gravityScale);
    this.uCoreTempC.value = params.coreTempC;
    this.uSunDir.value.set(params.sunDir[0], params.sunDir[1], params.sunDir[2]);
    const prevCut = Number(this.uCutawayActive.value) > 0.5;
    if (prevCut !== params.cutawayActive) {
      this.uCutawayActive.value = params.cutawayActive ? 1.0 : 0.0;
      this.needsSurfaceExtract = true;
    }
    this.uGpuOverlayMode.value =
      params.overlayMode === 'temperature'
        ? 1.0
        : params.overlayMode === 'density'
          ? 2.0
          : params.overlayMode === 'metabolism'
            ? 3.0
            : params.overlayMode === 'pressure'
              ? 4.0
              : 0.0;
    this.uVoxelEdges.value = params.voxelEdges ? 1.0 : 0.0;
    this.uBloomBoost.value = params.bloomEnabled ? 1.0 : 0.0;
  }

  public dispatchStep(
    renderer: THREE.WebGPURenderer,
    dtSec: number,
    extractSurfaceNow: boolean,
  ): void {
    const t0 = performance.now();
    this.uDt.value = Math.max(0.001, Math.min(0.1, dtSec));

    try {
      if (extractSurfaceNow || this.needsSurfaceExtract) {
        renderer.compute([
          this.resetCountersNode,
          this.thermoPressurePassNode,
          this.extractSurfaceNode,
        ]);
        this.needsSurfaceExtract = false;
      } else {
        renderer.compute([this.resetCountersNode, this.thermoPressurePassNode]);
      }
      this.gpuHealthy = true;
      this.lastDispatchMs = performance.now() - t0;
      this.scheduleCountersReadback(renderer);
    } catch {
      this.gpuHealthy = false;
    }
  }

  private scheduleCountersReadback(renderer: THREE.WebGPURenderer): void {
    if (this.readbackInFlight) return;
    this.readbackInFlight = true;
    void renderer
      .getArrayBufferAsync(this.countersAtomicAttr)
      .then((buf) => {
        const u = new Uint32Array(buf);
        const vis = Math.min(this.maxInstances, u[0] ?? 0);
        if (vis > 0) {
          this.liveVisibleInstances = vis;
          this.uLiveInstanceCount.value = vis;
          this.instancedMesh.count = vis;
        }
        this.liveMagmaVoxels = u[1] ?? 0;
        this.livePeakPressureAtm = Math.max(1.0, (u[2] ?? 10) / 10.0);
      })
      .catch(() => {
        // Ignore gracefully on device reset/dispose
      })
      .finally(() => {
        this.readbackInFlight = false;
      });
  }

  /**
   * Builds a zero-readback TSL color node sampling GPU Voxel Thermo-Pressure & Magma StorageBuffers
   * for smooth Marching Cubes & SVO high-res terrain materials.
   */
  public buildThermoPressureSampleFn(
    worldPosNode: Node<'vec3'>,
  ): Node<'vec4'> {
    const nU = uint(this.axisSize);
    const nSqU = uint(this.axisSize * this.axisSize);
    const cMaxF = float(this.axisSize - 1);
    const halfF = float(this.worldHalf);
    const invStep = float(1.0 / this.voxelSize);

    const gx = uint(tslClamp(floor(worldPosNode.x.add(halfF).mul(invStep).add(0.5)), 0.0, cMaxF));
    const gy = uint(tslClamp(floor(worldPosNode.y.add(halfF).mul(invStep).add(0.5)), 0.0, cMaxF));
    const gz = uint(tslClamp(floor(worldPosNode.z.add(halfF).mul(invStep).add(0.5)), 0.0, cMaxF));
    const idx = gx.add(gy.mul(nU)).add(gz.mul(nSqU));

    // Returns vec4(pressColorR, pressColorG, pressColorB, normalizedMagmaOrOverpressure)
    const ts = this.thermoStressReadNode.element(idx);
    const pressAtm = ts.y;
    const logP = tslClamp(log(max(pressAtm, float(0.2)).mul(5.0)).div(log(float(10.0)).mul(5.0)), 0.0, 1.0);
    let pressCol = mix(color(0x143d9e), color(0x1fcce8), smoothstep(0.0, 0.25, logP));
    pressCol = mix(pressCol, color(0x22c55e), smoothstep(0.25, 0.5, logP));
    pressCol = mix(pressCol, color(0xf59e0b), smoothstep(0.5, 0.75, logP));
    pressCol = mix(pressCol, color(0xe11d48), smoothstep(0.75, 1.0, logP));
    const isoBar = float(1.0).sub(smoothstep(0.0, 0.08, fract(logP.mul(12.0)))).mul(0.22);
    const outRgb = pressCol.add(vec3(isoBar)).saturate();
    return vec4(outRgb, ts.w);
  }

  public getTelemetry(enabled: boolean, gpuInstancingShown: boolean): GpuVoxelTelemetry {
    const vramBytes =
      this.densityAttr.array.byteLength +
      this.materialAttr.array.byteLength +
      this.thermoStressAttr.array.byteLength +
      this.fluidCouplingAttr.array.byteLength +
      this.instPosScaleAttr.array.byteLength +
      this.instMetaAttr.array.byteLength +
      this.countersAtomicAttr.array.byteLength;
    return {
      enabled,
      active: enabled && gpuInstancingShown,
      gridAxis: this.axisSize,
      totalVoxels: this.totalVoxels,
      visibleSurfaceInstances: this.liveVisibleInstances,
      magmaVoxelCount: this.liveMagmaVoxels,
      peakPressureAtm: this.livePeakPressureAtm,
      lastDispatchMs: this.lastDispatchMs,
      vramBytes,
    };
  }

  public dispose(): void {
    this.instancedMesh.geometry.dispose();
    this.instancedMaterial.dispose();
  }
}
