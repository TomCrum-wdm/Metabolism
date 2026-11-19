import {
  computeGravityVector,
  PlanetaryGravityParams,
  Vec3Like,
} from './gravity';
import {
  CORNER_OFFSETS,
  EDGE_TABLE,
  EDGE_VERTEX_PAIRS,
  TRI_TABLE,
} from './marchingCubesTables';
import { VoxelPlanet } from './voxelPlanet';
import {
  computeRayPointDistanceSq,
  computeTractorSpringForce,
  evaluateStretchedAnchorPoint,
  TractorForceParams,
  TractorForceResult,
  TractorRayPickResult,
} from './tractorBeam';

export const MAX_FLUID_PARTICLES = 2200;

const WATER_CELLS = 48;
const WATER_N = WATER_CELLS + 1; // 49
const BASE_WATER_HALF = 18.0;

// Normalized SPH smoothing length (world h = 1.15 * (R0 / 13.0))
const HASH_TABLE_SIZE = 8192; // power of 2

export interface WaterMeshData {
  positions: Float32Array;
  normals: Float32Array;
  vertexCount: number;
}

export interface FluidSnapshot {
  activeCount: number;
  positions: Float32Array;
  velocities: Float32Array;
}

export interface ActiveFluidTractorField {
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  dragVelX: number;
  dragVelY: number;
  dragVelZ: number;
  radius: number;
  beamPower: number;
  stretchStrength?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class FluidSim {
  public readonly maxParticles = MAX_FLUID_PARTICLES;
  public activeCount = 0;

  // Structure-of-Arrays (SoA) for cache-friendly, zero-GC physics
  public readonly px = new Float32Array(MAX_FLUID_PARTICLES);
  public readonly py = new Float32Array(MAX_FLUID_PARTICLES);
  public readonly pz = new Float32Array(MAX_FLUID_PARTICLES);

  public readonly vx = new Float32Array(MAX_FLUID_PARTICLES);
  public readonly vy = new Float32Array(MAX_FLUID_PARTICLES);
  public readonly vz = new Float32Array(MAX_FLUID_PARTICLES);

  public readonly fx = new Float32Array(MAX_FLUID_PARTICLES);
  public readonly fy = new Float32Array(MAX_FLUID_PARTICLES);
  public readonly fz = new Float32Array(MAX_FLUID_PARTICLES);

  public readonly rho = new Float32Array(MAX_FLUID_PARTICLES);
  public readonly press = new Float32Array(MAX_FLUID_PARTICLES);

  // Spatial hash linked list arrays (zero allocation per step)
  private readonly head = new Int32Array(HASH_TABLE_SIZE);
  private readonly next = new Int32Array(MAX_FLUID_PARTICLES);

  // SPH kernel constants (h = 1.15m)
  private readonly h = 1.15;
  private readonly h2 = 1.15 * 1.15;
  private readonly poly6Coeff: number;
  private readonly spikyGradCoeff: number;
  private readonly viscLapCoeff: number;
  private readonly restDensity = 1.35;
  private readonly stiffness = 14.0;
  private readonly viscosity = 0.22;
  private readonly mass = 1.0;

  // Water Marching Cubes scalar field
  private readonly waterField = new Float32Array(WATER_N * WATER_N * WATER_N);
  private readonly cornerDensity = new Float32Array(8);
  private readonly cornerPos = new Float32Array(24);
  private readonly edgeVerts = new Float32Array(36);
  private readonly scratchPos = new Float32Array(220000 * 3);
  private readonly scratchNorm = new Float32Array(220000 * 3);

  // Splash droplet buffer (subset of fast/free particles)
  public readonly splashPositions = new Float32Array(MAX_FLUID_PARTICLES * 3);
  public readonly splashVelocities = new Float32Array(MAX_FLUID_PARTICLES * 3);
  public splashCount = 0;

  // Dynamic water Marching Cubes bounds scaled to planet radius
  private currentWaterHalf = BASE_WATER_HALF;
  private currentWaterVoxel = (BASE_WATER_HALF * 2) / WATER_CELLS;

  // Tractor beam per-particle capture state (zero allocation)
  public readonly tractorFactor = new Float32Array(MAX_FLUID_PARTICLES);
  public readonly tractorStretchU = new Float32Array(MAX_FLUID_PARTICLES);
  public tractorCapturedCount = 0;
  public tractorTotalBeamForceN = 0;
  public tractorTotalGravityWeightN = 0;
  public tractorAvgLoadRatio = 0;
  public tractorPeakSpeedMs = 0;

  private readonly tempGrav: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly tempNormal: [number, number, number] = [0, 0, 0];
  private readonly tempStretchTarget: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly tempRayPick: TractorRayPickResult = { hit: false, t: 0, distSq: 0 };
  private readonly tempTractorParams: TractorForceParams = {
    planetRadius: 13.0,
    beamPower: 1.5,
    gravityCompFactor: 0.45,
    maxAccelG: 5.5,
    massKg: 1.0,
  };
  private readonly tempTractorResult: TractorForceResult = {
    fx: 0,
    fy: 0,
    fz: 0,
    beamForceN: 0,
    gravityWeightN: 0,
    localGravityMs2: 0,
    loadRatio: 0,
    saturated: false,
  };

  constructor() {
    const h = this.h;
    this.poly6Coeff = 315.0 / (64.0 * Math.PI * Math.pow(h, 9));
    this.spikyGradCoeff = -45.0 / (Math.PI * Math.pow(h, 6));
    this.viscLapCoeff = 45.0 / (Math.PI * Math.pow(h, 6));
  }

  public clear(): void {
    this.activeCount = 0;
    this.splashCount = 0;
    this.releaseTractorCapture();
  }

  public drainWithinRadius(cx: number, cy: number, cz: number, radius: number): number {
    const rSq = radius * radius;
    let removed = 0;
    let write = 0;
    for (let i = 0; i < this.activeCount; i++) {
      const dx = this.px[i] - cx;
      const dy = this.py[i] - cy;
      const dz = this.pz[i] - cz;
      if (dx * dx + dy * dy + dz * dz <= rSq) {
        removed++;
        continue;
      }
      if (write !== i) {
        this.px[write] = this.px[i];
        this.py[write] = this.py[i];
        this.pz[write] = this.pz[i];
        this.vx[write] = this.vx[i];
        this.vy[write] = this.vy[i];
        this.vz[write] = this.vz[i];
        this.rho[write] = this.rho[i];
        this.press[write] = this.press[i];
        this.tractorFactor[write] = this.tractorFactor[i];
        this.tractorStretchU[write] = this.tractorStretchU[i];
      }
      write++;
    }
    this.activeCount = write;
    return removed;
  }

  public releaseTractorCapture(): void {
    this.tractorFactor.fill(0);
    this.tractorStretchU.fill(0);
    this.tractorCapturedCount = 0;
    this.tractorTotalBeamForceN = 0;
    this.tractorTotalGravityWeightN = 0;
    this.tractorAvgLoadRatio = 0;
    this.tractorPeakSpeedMs = 0;
  }

  public findClosestParticleToRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxRadius: number,
  ): { index: number; x: number; y: number; z: number; distSq: number; rayT: number } | null {
    const maxSq = maxRadius * maxRadius;
    let bestIdx = -1;
    let bestScore = Infinity;
    let bestDistSq = Infinity;
    let bestT = Infinity;
    for (let i = 0; i < this.activeCount; i++) {
      computeRayPointDistanceSq(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        this.px[i],
        this.py[i],
        this.pz[i],
        this.tempRayPick,
      );
      if (this.tempRayPick.distSq <= maxSq) {
        // Favor close lateral match and front-facing nearest surface
        const score = this.tempRayPick.distSq + this.tempRayPick.t * 0.015;
        if (score < bestScore) {
          bestScore = score;
          bestDistSq = this.tempRayPick.distSq;
          bestT = this.tempRayPick.t;
          bestIdx = i;
        }
      }
    }
    if (bestIdx === -1) return null;
    return {
      index: bestIdx,
      x: this.px[bestIdx],
      y: this.py[bestIdx],
      z: this.pz[bestIdx],
      distSq: bestDistSq,
      rayT: bestT,
    };
  }

  /**
   * Captures SPH particles within radius around (cx, cy, cz) and assigns coherent
   * tidal stretch fractions tractorStretchU in [0, 1] along stretchAxis so dragging
   * elongates water into continuous plumes instead of collapsing to a single dot.
   */
  public captureParticlesForTractor(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    stretchAxisX = 0,
    stretchAxisY = 1,
    stretchAxisZ = 0,
    maxCapture = 320,
  ): number {
    this.releaseTractorCapture();
    if (this.activeCount === 0 || radius <= 1e-6) return 0;

    const rSq = radius * radius;
    let count = 0;
    let minProj = Infinity;
    let maxProj = -Infinity;

    for (let i = 0; i < this.activeCount; i++) {
      const dx = this.px[i] - cx;
      const dy = this.py[i] - cy;
      const dz = this.pz[i] - cz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rSq) continue;
      if (count >= maxCapture) break;
      const dist = Math.sqrt(dSq);
      const w = 0.55 + 0.45 * (1 - dist / radius);
      this.tractorFactor[i] = w;
      const proj = dx * stretchAxisX + dy * stretchAxisY + dz * stretchAxisZ;
      this.tractorStretchU[i] = proj;
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
      count++;
    }

    const span = maxProj - minProj;
    for (let i = 0; i < this.activeCount; i++) {
      if (this.tractorFactor[i] > 0) {
        if (span > 1e-4) {
          this.tractorStretchU[i] = clamp((this.tractorStretchU[i] - minProj) / span, 0, 1);
        } else {
          this.tractorStretchU[i] = 0.7;
        }
      }
    }

    this.tractorCapturedCount = count;
    return count;
  }

  /**
   * Entrains nearby uncaptured fluid particles along an active tractor drag path so
   * sweeping across a lake lifts a continuous tidal stream.
   */
  public entrainParticlesNearTractor(
    tx: number,
    ty: number,
    tz: number,
    anchorX: number,
    anchorY: number,
    anchorZ: number,
    radius: number,
    maxCapture = 360,
  ): number {
    if (this.activeCount === 0 || this.tractorCapturedCount >= maxCapture) {
      return this.tractorCapturedCount;
    }
    const rSq = radius * radius;
    const sx = tx - anchorX;
    const sy = ty - anchorY;
    const sz = tz - anchorZ;
    const sLenSq = sx * sx + sy * sy + sz * sz;

    for (let i = 0; i < this.activeCount; i++) {
      if (this.tractorFactor[i] > 0) continue;
      const dx = this.px[i] - tx;
      const dy = this.py[i] - ty;
      const dz = this.pz[i] - tz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rSq) continue;
      const dist = Math.sqrt(dSq);
      this.tractorFactor[i] = 0.5 + 0.5 * (1 - dist / radius);
      if (sLenSq > 1e-4) {
        const u = ((this.px[i] - anchorX) * sx + (this.py[i] - anchorY) * sy + (this.pz[i] - anchorZ) * sz) / sLenSq;
        this.tractorStretchU[i] = clamp(u, 0.15, 1.0);
      } else {
        this.tractorStretchU[i] = 0.85;
      }
      this.tractorCapturedCount++;
      if (this.tractorCapturedCount >= maxCapture) break;
    }
    return this.tractorCapturedCount;
  }

  public applyRadialImpulse(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    impulseVel: number,
    upwardLift = 0,
  ): number {
    const rSq = radius * radius;
    let affected = 0;
    for (let i = 0; i < this.activeCount; i++) {
      const dx = this.px[i] - cx;
      const dy = this.py[i] - cy;
      const dz = this.pz[i] - cz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rSq) continue;
      const dist = Math.sqrt(dSq);
      const falloff = 1 - dist / Math.max(radius, 1e-4);
      const invD = dist > 1e-4 ? 1 / dist : 0;
      this.vx[i] += dx * invD * impulseVel * falloff;
      this.vy[i] += dy * invD * impulseVel * falloff;
      this.vz[i] += dz * invD * impulseVel * falloff;
      if (upwardLift !== 0) {
        const pr = Math.hypot(this.px[i], this.py[i], this.pz[i]) || 1;
        this.vx[i] += (this.px[i] / pr) * upwardLift * falloff;
        this.vy[i] += (this.py[i] / pr) * upwardLift * falloff;
        this.vz[i] += (this.pz[i] / pr) * upwardLift * falloff;
      }
      affected++;
    }
    return affected;
  }

  public applySwirlVortex(
    cx: number,
    cy: number,
    cz: number,
    ax: number,
    ay: number,
    az: number,
    radius: number,
    swirlVel: number,
    liftVel: number,
  ): number {
    const rSq = radius * radius;
    let affected = 0;
    for (let i = 0; i < this.activeCount; i++) {
      const dx = this.px[i] - cx;
      const dy = this.py[i] - cy;
      const dz = this.pz[i] - cz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rSq) continue;
      const dist = Math.sqrt(dSq);
      const falloff = 1 - dist / Math.max(radius, 1e-4);
      // Tangent swirl = axis x offset
      const sx = ay * dz - az * dy;
      const sy = az * dx - ax * dz;
      const sz = ax * dy - ay * dx;
      const sLen = Math.hypot(sx, sy, sz) || 1;
      // Gently pull inward + spin + lift skyward
      const invD = dist > 1e-4 ? 1 / dist : 0;
      this.vx[i] += ((sx / sLen) * swirlVel + ax * liftVel - dx * invD * swirlVel * 0.25) * falloff;
      this.vy[i] += ((sy / sLen) * swirlVel + ay * liftVel - dy * invD * swirlVel * 0.25) * falloff;
      this.vz[i] += ((sz / sLen) * swirlVel + az * liftVel - dz * invD * swirlVel * 0.25) * falloff;
      affected++;
    }
    return affected;
  }

  public spawnParticle(
    x: number,
    y: number,
    z: number,
    vx = 0,
    vy = 0,
    vz = 0,
  ): boolean {
    if (this.activeCount >= MAX_FLUID_PARTICLES) return false;
    const i = this.activeCount++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.rho[i] = this.restDensity;
    this.press[i] = 0;
    this.tractorFactor[i] = 0;
    this.tractorStretchU[i] = 0;
    return true;
  }

  /**
   * Seeds natural crater lakes inside the planet's carved basins so fluid exists at spawn.
   */
  public seedInitialLakes(planet: VoxelPlanet): void {
    this.clear();
    const fill = planet.seedConfig.waterFill;
    if (fill <= 0.02) return;

    const basins = planet.lakeBasinCenters;
    if (basins.length === 0) return;

    const targets = [240, 170, 150];
    let seed = (planet.seedConfig.seed ^ 918273) >>> 0;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const radScale = planet.baseRadius / 13.0;

    for (let b = 0; b < basins.length; b++) {
      const [bx, by, bz] = basins[b];
      const bLen = Math.hypot(bx, by, bz) || 1;
      const nx = bx / bLen;
      const ny = by / bLen;
      const nz = bz / bLen;

      // Tangent vectors around basin normal
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

      const count = Math.round((targets[b] ?? 150) * fill);
      for (let k = 0; k < count; k++) {
        const ang = rand() * Math.PI * 2;
        const rad = Math.sqrt(rand()) * 2.1 * radScale;
        const dx = nx + (tx * Math.cos(ang) + ux * Math.sin(ang)) * (rad / planet.baseRadius);
        const dy = ny + (ty * Math.cos(ang) + uy * Math.sin(ang)) * (rad / planet.baseRadius);
        const dz = nz + (tz * Math.cos(ang) + uz * Math.sin(ang)) * (rad / planet.baseRadius);
        const dLen = Math.hypot(dx, dy, dz) || 1;
        const rSurf = planet.findSurfaceRadiusAlongRay(
          dx / dLen,
          dy / dLen,
          dz / dLen,
        );
        const spawnR = rSurf + (0.12 + rand() * 0.18) * radScale;
        this.spawnParticle(
          (dx / dLen) * spawnR,
          (dy / dLen) * spawnR,
          (dz / dLen) * spawnR,
          0,
          0,
          0,
        );
      }
    }

    // Pre-settle lakes into hydrostatic equilibrium inside crater basins
    const settleParams: PlanetaryGravityParams = {
      referenceRadius: planet.baseRadius,
      surfaceGravity: 9.81,
    };
    for (let s = 0; s < 48; s++) {
      this.step(1 / 60, planet, settleParams, 2);
    }
    // Damp residual settling velocity so lakes begin serene
    for (let i = 0; i < this.activeCount; i++) {
      this.vx[i] *= 0.05;
      this.vy[i] *= 0.05;
      this.vz[i] *= 0.05;
    }
  }

  /**
   * Non-blocking time-sliced version of seedInitialLakes for responsive progress bars.
   */
  public async seedInitialLakesAsync(
    planet: VoxelPlanet,
    onProgress?: (fraction: number, detail: string) => void,
    shouldAbort?: () => boolean,
  ): Promise<boolean> {
    this.clear();
    const fill = planet.seedConfig.waterFill;
    if (fill <= 0.02) {
      onProgress?.(1, '无水体生成');
      return true;
    }

    const basins = planet.lakeBasinCenters;
    if (basins.length === 0) {
      onProgress?.(1, '未检测到洼地');
      return true;
    }

    const targets = [240, 170, 150];
    let seed = (planet.seedConfig.seed ^ 918273) >>> 0;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const radScale = planet.baseRadius / 13.0;

    for (let b = 0; b < basins.length; b++) {
      const [bx, by, bz] = basins[b];
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

      const count = Math.round((targets[b] ?? 150) * fill);
      for (let k = 0; k < count; k++) {
        const ang = rand() * Math.PI * 2;
        const rad = Math.sqrt(rand()) * 2.1 * radScale;
        const dx = nx + (tx * Math.cos(ang) + ux * Math.sin(ang)) * (rad / planet.baseRadius);
        const dy = ny + (ty * Math.cos(ang) + uy * Math.sin(ang)) * (rad / planet.baseRadius);
        const dz = nz + (tz * Math.cos(ang) + uz * Math.sin(ang)) * (rad / planet.baseRadius);
        const dLen = Math.hypot(dx, dy, dz) || 1;
        const rSurf = planet.findSurfaceRadiusAlongRay(
          dx / dLen,
          dy / dLen,
          dz / dLen,
        );
        const spawnR = rSurf + (0.12 + rand() * 0.18) * radScale;
        this.spawnParticle(
          (dx / dLen) * spawnR,
          (dy / dLen) * spawnR,
          (dz / dLen) * spawnR,
          0,
          0,
          0,
        );
      }
    }

    const settleParams: PlanetaryGravityParams = {
      referenceRadius: planet.baseRadius,
      surfaceGravity: 9.81,
    };
    const totalSteps = 48;
    let sliceStart = performance.now();

    for (let s = 0; s < totalSteps; s++) {
      if (shouldAbort?.()) return false;
      this.step(1 / 60, planet, settleParams, 2);

      if (performance.now() - sliceStart >= 8 || s === totalSteps - 1) {
        onProgress?.(
          (s + 1) / totalSteps,
          `SPH 流体静水压平衡 ${s + 1}/${totalSteps}`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (shouldAbort?.()) return false;
        sliceStart = performance.now();
      }
    }

    for (let i = 0; i < this.activeCount; i++) {
      this.vx[i] *= 0.05;
      this.vy[i] *= 0.05;
      this.vz[i] *= 0.05;
    }
    return true;
  }

  public exportState(): FluidSnapshot {
    const n3 = this.activeCount * 3;
    const positions = new Float32Array(n3);
    const velocities = new Float32Array(n3);
    for (let i = 0; i < this.activeCount; i++) {
      const i3 = i * 3;
      positions[i3] = this.px[i];
      positions[i3 + 1] = this.py[i];
      positions[i3 + 2] = this.pz[i];
      velocities[i3] = this.vx[i];
      velocities[i3 + 1] = this.vy[i];
      velocities[i3 + 2] = this.vz[i];
    }
    return {
      activeCount: this.activeCount,
      positions,
      velocities,
    };
  }

  public importState(snap: FluidSnapshot): void {
    this.clear();
    const n = Math.min(snap.activeCount, MAX_FLUID_PARTICLES);
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      this.spawnParticle(
        snap.positions[i3] ?? 0,
        snap.positions[i3 + 1] ?? 0,
        snap.positions[i3 + 2] ?? 0,
        snap.velocities[i3] ?? 0,
        snap.velocities[i3 + 1] ?? 0,
        snap.velocities[i3 + 2] ?? 0,
      );
    }
  }

  /**
   * Emits a stream of water particles from a brush location (with slight radial jitter).
   */
  public emitStream(
    wx: number,
    wy: number,
    wz: number,
    nx: number,
    ny: number,
    nz: number,
    count: number,
    spreadRadius: number,
    scale = 1.0,
  ): number {
    const safeScale = Math.max(scale, 0.01);
    const velJitter = 1.0 * Math.sqrt(safeScale);
    const normalOffset = 0.8 * safeScale;
    let spawned = 0;
    for (let k = 0; k < count; k++) {
      if (this.activeCount >= MAX_FLUID_PARTICLES) {
        // Recycle oldest particle in ring-buffer style if cap is reached
        const idx = Math.floor(Math.random() * Math.min(200, MAX_FLUID_PARTICLES));
        const jx = (Math.random() - 0.5) * spreadRadius * 0.85;
        const jy = (Math.random() - 0.5) * spreadRadius * 0.85;
        const jz = (Math.random() - 0.5) * spreadRadius * 0.85;
        this.px[idx] = wx + nx * normalOffset + jx;
        this.py[idx] = wy + ny * normalOffset + jy;
        this.pz[idx] = wz + nz * normalOffset + jz;
        this.vx[idx] = (Math.random() - 0.5) * 1.2 * velJitter;
        this.vy[idx] = (Math.random() - 0.5) * 1.2 * velJitter;
        this.vz[idx] = (Math.random() - 0.5) * 1.2 * velJitter;
        spawned++;
        continue;
      }
      const jx = (Math.random() - 0.5) * spreadRadius * 0.85;
      const jy = (Math.random() - 0.5) * spreadRadius * 0.85;
      const jz = (Math.random() - 0.5) * spreadRadius * 0.85;
      if (
        this.spawnParticle(
          wx + nx * normalOffset + jx,
          wy + ny * normalOffset + jy,
          wz + nz * normalOffset + jz,
          (Math.random() - 0.5) * velJitter,
          (Math.random() - 0.5) * velJitter,
          (Math.random() - 0.5) * velJitter,
        )
      ) {
        spawned++;
      }
    }
    return spawned;
  }

  private hashCell(cx: number, cy: number, cz: number): number {
    const h =
      (Math.imul(cx, 73856093) ^
        Math.imul(cy, 19349663) ^
        Math.imul(cz, 83492791)) &
      (HASH_TABLE_SIZE - 1);
    return h;
  }

  /**
   * Advances physics-based SPH fluid simulation by dt seconds (substepped for stability).
   */
  public step(
    dt: number,
    planet: VoxelPlanet,
    gravityParams: PlanetaryGravityParams,
    substeps = 2,
    tractorField?: ActiveFluidTractorField | null,
  ): void {
    const n = this.activeCount;
    if (n === 0) {
      this.splashCount = 0;
      this.tractorTotalBeamForceN = 0;
      this.tractorTotalGravityWeightN = 0;
      this.tractorAvgLoadRatio = 0;
      this.tractorPeakSpeedMs = 0;
      return;
    }

    const clampedDt = Math.min(dt, 0.04);
    const hStep = clampedDt / substeps;
    const h = this.h;
    const h2 = this.h2;

    const scale = Math.max(planet.baseRadius / 13.0, 0.005);
    const invScale = 1 / scale;
    const sqrtScale = Math.sqrt(scale);
    const hashCell = h * scale;
    const invHash = 1 / hashCell;

    const hasTractor = Boolean(tractorField && this.tractorCapturedCount > 0);
    if (hasTractor && tractorField) {
      this.tempTractorParams.planetRadius = planet.baseRadius;
      this.tempTractorParams.beamPower = tractorField.beamPower;
      this.tempTractorParams.gravityCompFactor = 0.44;
      this.tempTractorParams.maxAccelG = 5.6;
      this.tempTractorParams.massKg = 1.0;
    }

    let sumForceN = 0;
    let sumWeightN = 0;
    let sumLoadRatio = 0;
    let capturedTelemetrySamples = 0;

    for (let sub = 0; sub < substeps; sub++) {
      // 1. Rebuild spatial hash grid
      this.head.fill(-1);
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(this.px[i] * invHash);
        const cy = Math.floor(this.py[i] * invHash);
        const cz = Math.floor(this.pz[i] * invHash);
        const bucket = this.hashCell(cx, cy, cz);
        this.next[i] = this.head[bucket];
        this.head[bucket] = i;
      }

      // 2. Compute SPH density & pressure in scale-normalized coordinates (Poly6 kernel)
      for (let i = 0; i < n; i++) {
        const xi = this.px[i];
        const yi = this.py[i];
        const zi = this.pz[i];
        const cx = Math.floor(xi * invHash);
        const cy = Math.floor(yi * invHash);
        const cz = Math.floor(zi * invHash);

        let density = this.mass * this.poly6Coeff * Math.pow(h2, 3);

        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const bucket = this.hashCell(cx + dx, cy + dy, cz + dz);
              let j = this.head[bucket];
              while (j !== -1) {
                if (j !== i) {
                  const rx = (xi - this.px[j]) * invScale;
                  const ry = (yi - this.py[j]) * invScale;
                  const rz = (zi - this.pz[j]) * invScale;
                  const r2 = rx * rx + ry * ry + rz * rz;
                  if (r2 < h2) {
                    const diff = h2 - r2;
                    density += this.mass * this.poly6Coeff * diff * diff * diff;
                  }
                }
                j = this.next[j];
              }
            }
          }
        }

        this.rho[i] = density;
        this.press[i] = Math.max(0, this.stiffness * (density - this.restDensity));
      }

      // 3. Compute pressure gradient, viscosity, cohesion & Newtonian radial gravity
      for (let i = 0; i < n; i++) {
        const xi = this.px[i];
        const yi = this.py[i];
        const zi = this.pz[i];
        const vxi = this.vx[i];
        const vyi = this.vy[i];
        const vzi = this.vz[i];
        const rhoi = Math.max(this.rho[i], 0.25);
        const pi = this.press[i];

        const cx = Math.floor(xi * invHash);
        const cy = Math.floor(yi * invHash);
        const cz = Math.floor(zi * invHash);

        let fpx = 0;
        let fpy = 0;
        let fpz = 0;

        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const bucket = this.hashCell(cx + dx, cy + dy, cz + dz);
              let j = this.head[bucket];
              while (j !== -1) {
                if (j !== i) {
                  const rx = (xi - this.px[j]) * invScale;
                  const ry = (yi - this.py[j]) * invScale;
                  const rz = (zi - this.pz[j]) * invScale;
                  const r2 = rx * rx + ry * ry + rz * rz;
                  if (r2 < h2 && r2 > 1e-8) {
                    const r = Math.sqrt(r2);
                    const hr = h - r;
                    const rhoj = Math.max(this.rho[j], 0.25);

                    // Spiky pressure gradient (symmetric)
                    const pScalar =
                      (-this.mass *
                        ((pi + this.press[j]) / (2.0 * rhoj)) *
                        this.spikyGradCoeff *
                        hr *
                        hr) /
                      r;
                    fpx += rx * pScalar;
                    fpy += ry * pScalar;
                    fpz += rz * pScalar;

                    // Viscosity Laplacian
                    const vScalar =
                      (this.viscosity * this.mass * this.viscLapCoeff * hr) /
                      rhoj;
                    fpx += (this.vx[j] - vxi) * invScale * vScalar;
                    fpy += (this.vy[j] - vyi) * invScale * vScalar;
                    fpz += (this.vz[j] - vzi) * invScale * vScalar;
                  }
                }
                j = this.next[j];
              }
            }
          }
        }

        // Radial Newtonian gravity at particle position
        computeGravityVector(xi, yi, zi, gravityParams, this.tempGrav);
        let accX = (fpx / rhoi) * scale + this.tempGrav.x;
        let accY = (fpy / rhoi) * scale + this.tempGrav.y;
        let accZ = (fpz / rhoi) * scale + this.tempGrav.z;

        if (hasTractor && tractorField && this.tractorFactor[i] > 0) {
          evaluateStretchedAnchorPoint(
            tractorField.anchorX,
            tractorField.anchorY,
            tractorField.anchorZ,
            tractorField.targetX,
            tractorField.targetY,
            tractorField.targetZ,
            this.tractorStretchU[i],
            tractorField.stretchStrength ?? 0.68,
            this.tempStretchTarget,
          );
          computeTractorSpringForce(
            xi,
            yi,
            zi,
            vxi,
            vyi,
            vzi,
            this.tempStretchTarget.x,
            this.tempStretchTarget.y,
            this.tempStretchTarget.z,
            tractorField.dragVelX,
            tractorField.dragVelY,
            tractorField.dragVelZ,
            gravityParams,
            this.tempTractorParams,
            this.tractorFactor[i],
            this.tempTractorResult,
          );
          accX += this.tempTractorResult.fx;
          accY += this.tempTractorResult.fy;
          accZ += this.tempTractorResult.fz;

          if (sub === substeps - 1) {
            sumForceN += this.tempTractorResult.beamForceN;
            sumWeightN += this.tempTractorResult.gravityWeightN;
            sumLoadRatio += this.tempTractorResult.loadRatio;
            capturedTelemetrySamples++;
          }
        }

        this.fx[i] = accX;
        this.fy[i] = accY;
        this.fz[i] = accZ;
      }

      // 4. Integrate velocity & position, then collide with live Marching Cubes terrain SDF
      const maxSpeed = (hasTractor ? 28.0 : 16.0) * sqrtScale;
      const boundaryR = (hasTractor ? 24.0 : 18.2) * scale;
      const particleMargin = 0.24 * scale;
      for (let i = 0; i < n; i++) {
        let nvx = this.vx[i] + this.fx[i] * hStep;
        let nvy = this.vy[i] + this.fy[i] * hStep;
        let nvz = this.vz[i] + this.fz[i] * hStep;

        // Clamp extreme velocity spikes
        const spd = Math.hypot(nvx, nvy, nvz);
        if (spd > maxSpeed) {
          const s = maxSpeed / spd;
          nvx *= s;
          nvy *= s;
          nvz *= s;
        }

        let npx = this.px[i] + nvx * hStep;
        let npy = this.py[i] + nvy * hStep;
        let npz = this.pz[i] + nvz * hStep;

        // Keep particles inside planetary atmosphere boundary
        const r = Math.hypot(npx, npy, npz);
        if (r > boundaryR) {
          const s = boundaryR / r;
          npx *= s;
          npy *= s;
          npz *= s;
          nvx *= 0.6;
          nvy *= 0.6;
          nvz *= 0.6;
        }

        // Exact voxel SDF terrain collision
        const d = planet.sampleDensityAndNormal(npx, npy, npz, this.tempNormal, true);
        if (d > -particleMargin) {
          const penetration = d + particleMargin;
          const nx = this.tempNormal[0];
          const ny = this.tempNormal[1];
          const nz = this.tempNormal[2];

          // Push out along outward terrain normal (toward air)
          npx += nx * penetration;
          npy += ny * penetration;
          npz += nz * penetration;

          // Reflect normal velocity component + apply boundary drag
          const vn = nvx * nx + nvy * ny + nvz * nz;
          if (vn < 0) {
            const restitution = 0.12;
            nvx -= (1 + restitution) * vn * nx;
            nvy -= (1 + restitution) * vn * ny;
            nvz -= (1 + restitution) * vn * nz;
            // Slight wet friction on rock surface
            nvx *= 0.965;
            nvy *= 0.965;
            nvz *= 0.965;
          }
        }

        this.px[i] = npx;
        this.py[i] = npy;
        this.pz[i] = npz;
        this.vx[i] = nvx * 0.996;
        this.vy[i] = nvy * 0.996;
        this.vz[i] = nvz * 0.996;
      }
    }

    // Reset/accumulate tractor telemetry on final substep
    if (hasTractor && capturedTelemetrySamples > 0) {
      this.tractorTotalBeamForceN = sumForceN;
      this.tractorTotalGravityWeightN = sumWeightN;
      this.tractorAvgLoadRatio = sumLoadRatio / capturedTelemetrySamples;
    } else {
      this.tractorTotalBeamForceN = 0;
      this.tractorTotalGravityWeightN = 0;
      this.tractorAvgLoadRatio = 0;
    }

    // Update splash droplet list (fast-moving or airborne spray particles)
    const splashThreshold = 1.35 * sqrtScale;
    let sc = 0;
    let peakSpd = 0;
    for (let i = 0; i < n; i++) {
      const spd = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
      if (this.tractorFactor[i] > 0 && spd > peakSpd) {
        peakSpd = spd;
      }
      if (spd > splashThreshold || this.rho[i] < this.restDensity * 1.15) {
        const s3 = sc * 3;
        this.splashPositions[s3] = this.px[i];
        this.splashPositions[s3 + 1] = this.py[i];
        this.splashPositions[s3 + 2] = this.pz[i];
        this.splashVelocities[s3] = this.vx[i];
        this.splashVelocities[s3 + 1] = this.vy[i];
        this.splashVelocities[s3 + 2] = this.vz[i];
        sc++;
      }
    }
    this.tractorPeakSpeedMs = peakSpd;
    this.splashCount = sc;
  }

  private waterFieldIndex(ix: number, iy: number, iz: number): number {
    return ix + iy * WATER_N + iz * WATER_N * WATER_N;
  }

  private sampleWaterField(wx: number, wy: number, wz: number): number {
    const waterHalf = this.currentWaterHalf;
    const waterVoxel = this.currentWaterVoxel;
    const gx = (wx + waterHalf) / waterVoxel;
    const gy = (wy + waterHalf) / waterVoxel;
    const gz = (wz + waterHalf) / waterVoxel;
    if (
      gx < 0 ||
      gy < 0 ||
      gz < 0 ||
      gx >= WATER_CELLS ||
      gy >= WATER_CELLS ||
      gz >= WATER_CELLS
    ) {
      return -1.0;
    }
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fy = gy - iy;
    const fz = gz - iz;
    const sY = WATER_N;
    const sZ = WATER_N * WATER_N;
    const base = ix + iy * sY + iz * sZ;
    const c000 = this.waterField[base];
    const c100 = this.waterField[base + 1];
    const c010 = this.waterField[base + sY];
    const c110 = this.waterField[base + sY + 1];
    const c001 = this.waterField[base + sZ];
    const c101 = this.waterField[base + sZ + 1];
    const c011 = this.waterField[base + sZ + sY];
    const c111 = this.waterField[base + sZ + sY + 1];

    const x00 = c000 + (c100 - c000) * fx;
    const x10 = c010 + (c110 - c010) * fx;
    const x01 = c001 + (c101 - c001) * fx;
    const x11 = c011 + (c111 - c011) * fx;
    const y0 = x00 + (x10 - x00) * fy;
    const y1 = x01 + (x11 - x01) * fy;
    return y0 + (y1 - y0) * fz;
  }

  public sampleWaterAt(wx: number, wy: number, wz: number): number {
    return this.sampleWaterField(wx, wy, wz);
  }

  /**
   * Splats SPH fluid particles onto a scale-invariant 3D water scalar field and extracts
   * either a smooth Marching Cubes liquid surface or crisp blocky water cubes.
   */
  public extractWaterSurface(planet: VoxelPlanet, blocky = false): WaterMeshData {
    const n = this.activeCount;
    if (n === 0) {
      return {
        positions: new Float32Array(0),
        normals: new Float32Array(0),
        vertexCount: 0,
      };
    }

    const scale = Math.max(planet.baseRadius / 13.0, 0.005);
    const waterHalf = BASE_WATER_HALF * scale;
    const waterVoxel = (waterHalf * 2) / WATER_CELLS;
    this.currentWaterHalf = waterHalf;
    this.currentWaterVoxel = waterVoxel;

    this.waterField.fill(-0.34);
    const splatR = 1.02 * scale;
    const splatR2 = splatR * splatR;
    const invVoxel = 1 / waterVoxel;
    const sY = WATER_N;
    const sZ = WATER_N * WATER_N;

    for (let i = 0; i < n; i++) {
      const wx = this.px[i];
      const wy = this.py[i];
      const wz = this.pz[i];

      const gx = (wx + waterHalf) * invVoxel;
      const gy = (wy + waterHalf) * invVoxel;
      const gz = (wz + waterHalf) * invVoxel;

      const minX = clamp(Math.floor(gx - 1.5), 1, WATER_CELLS - 1);
      const maxX = clamp(Math.ceil(gx + 1.5), 1, WATER_CELLS - 1);
      const minY = clamp(Math.floor(gy - 1.5), 1, WATER_CELLS - 1);
      const maxY = clamp(Math.ceil(gy + 1.5), 1, WATER_CELLS - 1);
      const minZ = clamp(Math.floor(gz - 1.5), 1, WATER_CELLS - 1);
      const maxZ = clamp(Math.ceil(gz + 1.5), 1, WATER_CELLS - 1);

      for (let iz = minZ; iz <= maxZ; iz++) {
        const dz = -waterHalf + iz * waterVoxel - wz;
        for (let iy = minY; iy <= maxY; iy++) {
          const dy = -waterHalf + iy * waterVoxel - wy;
          for (let ix = minX; ix <= maxX; ix++) {
            const dx = -waterHalf + ix * waterVoxel - wx;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < splatR2) {
              const t = 1 - d2 / splatR2;
              const idx = ix + iy * sY + iz * sZ;
              // Saturate field softly at +0.34 so lakes stay smooth without ballooning
              const nextVal = this.waterField[idx] + t * t * 0.32;
              this.waterField[idx] = nextVal < 0.34 ? nextVal : 0.34;
            }
          }
        }
      }
    }

    // Clip water interior deep inside solid terrain so dams & basins stay watertight
    const clipThresh = 0.08 * scale;
    const invScale = 1 / scale;
    for (let iz = 0; iz < WATER_N; iz++) {
      const wz = -waterHalf + iz * waterVoxel;
      for (let iy = 0; iy < WATER_N; iy++) {
        const wy = -waterHalf + iy * waterVoxel;
        for (let ix = 0; ix < WATER_N; ix++) {
          const idx = ix + iy * sY + iz * sZ;
          if (this.waterField[idx] > -0.22) {
            const wx = -waterHalf + ix * waterVoxel;
            const td = planet.sampleDensity(wx, wy, wz, true);
            if (td > clipThresh) {
              this.waterField[idx] -= (td - clipThresh) * invScale * 1.65;
            }
          }
        }
      }
    }

    let vCount = 0;
    const maxVerts = this.scratchPos.length / 3;

    if (blocky) {
      const isWaterCell = (ix: number, iy: number, iz: number): boolean => {
        if (
          ix < 0 ||
          iy < 0 ||
          iz < 0 ||
          ix >= WATER_CELLS ||
          iy >= WATER_CELLS ||
          iz >= WATER_CELLS
        ) {
          return false;
        }
        const base = ix + iy * sY + iz * sZ;
        const avg =
          this.waterField[base] +
          this.waterField[base + 1] +
          this.waterField[base + sY] +
          this.waterField[base + sY + 1] +
          this.waterField[base + sZ] +
          this.waterField[base + sZ + 1] +
          this.waterField[base + sZ + sY] +
          this.waterField[base + sZ + sY + 1];
        return avg > 0;
      };

      const FACES: ReadonlyArray<{
        n: [number, number, number];
        verts: readonly [
          [number, number, number],
          [number, number, number],
          [number, number, number],
          [number, number, number],
        ];
      }> = [
        { n: [1, 0, 0], verts: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
        { n: [-1, 0, 0], verts: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
        { n: [0, 1, 0], verts: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
        { n: [0, -1, 0], verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
        { n: [0, 0, 1], verts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
        { n: [0, 0, -1], verts: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
      ];
      const triOrder = [0, 1, 2, 0, 2, 3];

      for (let iz = 0; iz < WATER_CELLS; iz++) {
        const wz0 = -waterHalf + iz * waterVoxel;
        for (let iy = 0; iy < WATER_CELLS; iy++) {
          const wy0 = -waterHalf + iy * waterVoxel;
          for (let ix = 0; ix < WATER_CELLS; ix++) {
            if (!isWaterCell(ix, iy, iz)) continue;
            const wx0 = -waterHalf + ix * waterVoxel;
            for (let f = 0; f < 6; f++) {
              const face = FACES[f];
              const [nx, ny, nz] = face.n;
              if (isWaterCell(ix + nx, iy + ny, iz + nz)) continue;
              if (vCount + 6 >= maxVerts) break;
              for (let t = 0; t < 6; t++) {
                const [vx, vy, vz] = face.verts[triOrder[t]];
                const p3 = vCount * 3;
                this.scratchPos[p3] = wx0 + vx * waterVoxel;
                this.scratchPos[p3 + 1] = wy0 + vy * waterVoxel;
                this.scratchPos[p3 + 2] = wz0 + vz * waterVoxel;
                this.scratchNorm[p3] = nx;
                this.scratchNorm[p3 + 1] = ny;
                this.scratchNorm[p3 + 2] = nz;
                vCount++;
              }
            }
          }
        }
      }

      return {
        positions: this.scratchPos.slice(0, vCount * 3),
        normals: this.scratchNorm.slice(0, vCount * 3),
        vertexCount: vCount,
      };
    }

    for (let iz = 0; iz < WATER_CELLS; iz++) {
      const wz0 = -waterHalf + iz * waterVoxel;
      for (let iy = 0; iy < WATER_CELLS; iy++) {
        const wy0 = -waterHalf + iy * waterVoxel;
        for (let ix = 0; ix < WATER_CELLS; ix++) {
          const wx0 = -waterHalf + ix * waterVoxel;

          let cubeIndex = 0;
          for (let c = 0; c < 8; c++) {
            const off = CORNER_OFFSETS[c];
            const d = this.waterField[
              this.waterFieldIndex(ix + off[0], iy + off[1], iz + off[2])
            ];
            this.cornerDensity[c] = d;
            this.cornerPos[c * 3] = wx0 + off[0] * waterVoxel;
            this.cornerPos[c * 3 + 1] = wy0 + off[1] * waterVoxel;
            this.cornerPos[c * 3 + 2] = wz0 + off[2] * waterVoxel;
            if (d > 0) cubeIndex |= 1 << c;
          }

          const edgeMask = EDGE_TABLE[cubeIndex];
          if (edgeMask === 0) continue;

          for (let e = 0; e < 12; e++) {
            if ((edgeMask & (1 << e)) === 0) continue;
            const [cA, cB] = EDGE_VERTEX_PAIRS[e];
            const dA = this.cornerDensity[cA];
            const dB = this.cornerDensity[cB];
            const denom = dB - dA;
            const t = Math.abs(denom) > 1e-6 ? clamp(-dA / denom, 0, 1) : 0.5;
            this.edgeVerts[e * 3] =
              this.cornerPos[cA * 3] +
              (this.cornerPos[cB * 3] - this.cornerPos[cA * 3]) * t;
            this.edgeVerts[e * 3 + 1] =
              this.cornerPos[cA * 3 + 1] +
              (this.cornerPos[cB * 3 + 1] - this.cornerPos[cA * 3 + 1]) * t;
            this.edgeVerts[e * 3 + 2] =
              this.cornerPos[cA * 3 + 2] +
              (this.cornerPos[cB * 3 + 2] - this.cornerPos[cA * 3 + 2]) * t;
          }

          const tris = TRI_TABLE[cubeIndex];
          for (let t = 0; tris[t] !== -1; t += 3) {
            if (vCount + 3 >= maxVerts) break;
            const edges = [tris[t], tris[t + 2], tris[t + 1]];
            for (let k = 0; k < 3; k++) {
              const eIdx = edges[k];
              const vx = this.edgeVerts[eIdx * 3];
              const vy = this.edgeVerts[eIdx * 3 + 1];
              const vz = this.edgeVerts[eIdx * 3 + 2];

              const eps = waterVoxel * 0.7;
              let nx =
                this.sampleWaterField(vx - eps, vy, vz) -
                this.sampleWaterField(vx + eps, vy, vz);
              let ny =
                this.sampleWaterField(vx, vy - eps, vz) -
                this.sampleWaterField(vx, vy + eps, vz);
              let nz =
                this.sampleWaterField(vx, vy, vz - eps) -
                this.sampleWaterField(vx, vy, vz + eps);
              const nLen = Math.hypot(nx, ny, nz);
              if (nLen > 1e-5) {
                nx /= nLen;
                ny /= nLen;
                nz /= nLen;
              } else {
                const rLen = Math.hypot(vx, vy, vz) || 1;
                nx = vx / rLen;
                ny = vy / rLen;
                nz = vz / rLen;
              }

              const p3 = vCount * 3;
              this.scratchPos[p3] = vx;
              this.scratchPos[p3 + 1] = vy;
              this.scratchPos[p3 + 2] = vz;
              this.scratchNorm[p3] = nx;
              this.scratchNorm[p3 + 1] = ny;
              this.scratchNorm[p3 + 2] = nz;
              vCount++;
            }
          }
        }
      }
    }

    return {
      positions: this.scratchPos.slice(0, vCount * 3),
      normals: this.scratchNorm.slice(0, vCount * 3),
      vertexCount: vCount,
    };
  }
}
