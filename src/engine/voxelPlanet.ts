import { fbm3D, ridged3D, seedNoise } from './noise';
import {
  CORNER_OFFSETS,
  EDGE_TABLE,
  EDGE_VERTEX_PAIRS,
  TRI_TABLE,
} from './marchingCubesTables';
import { DEFAULT_PLANET_RADIUS } from './gravity';

export enum MaterialId {
  Air = 0,
  Soil = 1,
  Stone = 2,
  Basalt = 3,
  Crystal = 4,
  Ice = 5,
  Sandstone = 6,
}

export type BrushMode = 'carve' | 'build' | 'smooth' | 'flatten' | 'water';
export type ChunkLodLevel = 0 | 1 | 2;
export type TerrainRenderMode = 'smooth' | 'blocky';
export type TerrainOverlayMode = 'material' | 'temperature' | 'density' | 'lod';

export interface PlanetSeedConfig {
  seed: number;
  radius: number; // Base planet radius R0 in meters (unrestricted > 0.05)
  continentAmp: number; // Continent elevation amplitude (unrestricted)
  ridgeAmp: number; // Mountain ridge amplitude (unrestricted)
  ridgeFreq: number; // Mountain ridge frequency (unrestricted)
  craterCount: number; // Number of major crater basins (unrestricted >= 0)
  craterDepth: number; // Crater depth in meters (unrestricted)
  caveDensity: number; // Subterranean cave carving multiplier (unrestricted >= 0)
  crystalRichness: number; // Subsurface crystal vein threshold bias (unrestricted)
  waterFill: number; // Initial fluid volume multiplier (unrestricted >= 0)
  hasArch: boolean; // Scenic natural rock arch landmark
}

export const DEFAULT_SEED_CONFIG: PlanetSeedConfig = {
  seed: 202611,
  radius: DEFAULT_PLANET_RADIUS,
  continentAmp: 2.15,
  ridgeAmp: 2.25,
  ridgeFreq: 2.6,
  craterCount: 3,
  craterDepth: 3.9,
  caveDensity: 1.0,
  crystalRichness: 0.35,
  waterFill: 1.0,
  hasArch: true,
};

export const PLANET_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  desc: string;
  config: PlanetSeedConfig;
}> = [
  {
    id: 'terran',
    label: '类地翠星',
    desc: '均衡地貌、深邃湖盆与天然岩拱',
    config: { ...DEFAULT_SEED_CONFIG },
  },
  {
    id: 'titan',
    label: '重岩巨星',
    desc: '15.2m 大半径、陡峭山脊与深海盆地',
    config: {
      seed: 482910,
      radius: 15.2,
      continentAmp: 2.4,
      ridgeAmp: 3.1,
      ridgeFreq: 3.2,
      craterCount: 4,
      craterDepth: 4.4,
      caveDensity: 0.85,
      crystalRichness: 0.45,
      waterFill: 1.35,
      hasArch: true,
    },
  },
  {
    id: 'asteroid',
    label: '空洞小行星',
    desc: '9.2m 紧凑半径、密集陨坑与蜂窝晶洞',
    config: {
      seed: 77419,
      radius: 9.2,
      continentAmp: 1.2,
      ridgeAmp: 1.5,
      ridgeFreq: 2.1,
      craterCount: 6,
      craterDepth: 3.1,
      caveDensity: 1.45,
      crystalRichness: 0.8,
      waterFill: 0.45,
      hasArch: false,
    },
  },
  {
    id: 'cryo',
    label: '极冰晶核',
    desc: '高丰度晶矿脉、冰封山峰与低地液湖',
    config: {
      seed: 903152,
      radius: 12.6,
      continentAmp: 1.7,
      ridgeAmp: 2.8,
      ridgeFreq: 3.6,
      craterCount: 3,
      craterDepth: 4.5,
      caveDensity: 1.2,
      crystalRichness: 0.92,
      waterFill: 1.15,
      hasArch: true,
    },
  },
];

export function hashSeedString(input: string): number {
  const trimmed = input.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return (n >>> 0) || 1;
  }
  let h = 2166136261;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function sanitizeSeedConfig(raw: Partial<PlanetSeedConfig>): PlanetSeedConfig {
  const merged = { ...DEFAULT_SEED_CONFIG, ...raw };
  return {
    seed: Number.isFinite(merged.seed) ? Math.max(1, Math.floor(Math.abs(merged.seed))) : DEFAULT_SEED_CONFIG.seed,
    radius: Number.isFinite(merged.radius) && merged.radius > 0.05 ? merged.radius : DEFAULT_SEED_CONFIG.radius,
    continentAmp: Number.isFinite(merged.continentAmp) ? merged.continentAmp : DEFAULT_SEED_CONFIG.continentAmp,
    ridgeAmp: Number.isFinite(merged.ridgeAmp) ? merged.ridgeAmp : DEFAULT_SEED_CONFIG.ridgeAmp,
    ridgeFreq: Number.isFinite(merged.ridgeFreq) ? merged.ridgeFreq : DEFAULT_SEED_CONFIG.ridgeFreq,
    craterCount: Number.isFinite(merged.craterCount) ? Math.max(0, Math.round(merged.craterCount)) : DEFAULT_SEED_CONFIG.craterCount,
    craterDepth: Number.isFinite(merged.craterDepth) ? merged.craterDepth : DEFAULT_SEED_CONFIG.craterDepth,
    caveDensity: Number.isFinite(merged.caveDensity) ? Math.max(0, merged.caveDensity) : DEFAULT_SEED_CONFIG.caveDensity,
    crystalRichness: Number.isFinite(merged.crystalRichness) ? merged.crystalRichness : DEFAULT_SEED_CONFIG.crystalRichness,
    waterFill: Number.isFinite(merged.waterFill) ? Math.max(0, merged.waterFill) : DEFAULT_SEED_CONFIG.waterFill,
    hasArch: Boolean(merged.hasArch),
  };
}

export function encodeSeedCode(cfg: PlanetSeedConfig): string {
  const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(6)).toString() : '0');
  return [
    'TS2',
    Math.max(1, Math.floor(Math.abs(cfg.seed))) >>> 0,
    fmt(cfg.radius),
    fmt(cfg.continentAmp),
    fmt(cfg.ridgeAmp),
    fmt(cfg.ridgeFreq),
    Math.max(0, Math.round(cfg.craterCount)),
    fmt(cfg.craterDepth),
    fmt(cfg.caveDensity),
    fmt(cfg.crystalRichness),
    fmt(cfg.waterFill),
    cfg.hasArch ? 1 : 0,
  ].join('|');
}

export function decodeSeedCode(code: string): PlanetSeedConfig | null {
  const trimmed = code.trim();
  let parts: string[];
  if (trimmed.startsWith('TS2|')) {
    parts = trimmed.split('|');
  } else if (trimmed.startsWith('TS1-')) {
    parts = trimmed.split('-');
  } else {
    return null;
  }
  if (parts.length !== 12) return null;
  const nums = parts.slice(1).map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return sanitizeSeedConfig({
    seed: Math.max(1, Math.floor(Math.abs(nums[0]))),
    radius: nums[1],
    continentAmp: nums[2],
    ridgeAmp: nums[3],
    ridgeFreq: nums[4],
    craterCount: Math.max(0, Math.round(nums[5])),
    craterDepth: nums[6],
    caveDensity: Math.max(0, nums[7]),
    crystalRichness: nums[8],
    waterFill: Math.max(0, nums[9]),
    hasArch: nums[10] >= 0.5,
  });
}

export interface ChunkMeshData {
  cx: number;
  cy: number;
  cz: number;
  lod: ChunkLodLevel;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  matProps: Float32Array; // [roughness, metalness, emissive]
  uvs: Float32Array; // [u, v] local voxel face UV (used for blocky Minecraft grid/bevel)
  vertexCount: number;
}

export interface RaycastHit {
  hit: boolean;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  distance: number;
}

export interface BrushResult {
  modifiedChunks: number[];
  center: [number, number, number];
  deltaVolume: number;
}

export interface VoxelFormatStats {
  gridN: number;
  cellsPerAxis: number;
  chunkCells: number;
  chunksPerAxis: number;
  totalVoxels: number;
  totalCells: number;
  totalChunks: number;
  voxelSize: number;
  worldHalf: number;
  densityBytes: number;
  materialBytes: number;
  totalBytes: number;
  solidVoxels: number;
  materialCounts: Record<MaterialId, number>;
}

export interface VoxelCellCornerSample {
  corner: number;
  ix: number;
  iy: number;
  iz: number;
  density: number;
  material: MaterialId;
  solid: boolean;
}

export interface VoxelCellProbe {
  worldPos: [number, number, number];
  gridPos: [number, number, number];
  cell: [number, number, number];
  chunk: [number, number, number];
  chunkIndex: number;
  cubeIndex: number;
  edgeMask: number;
  triangleCount: number;
  centerDensity: number;
  centerMaterial: MaterialId;
  corners: VoxelCellCornerSample[];
  slice5x5: Array<{ dx: number; dz: number; density: number; material: MaterialId }>;
}

export interface VoxelPlanetSnapshot {
  seedConfig: PlanetSeedConfig;
  density: Float32Array;
  material: Uint8Array;
  spawnPosition: [number, number, number];
  lakeBasinCenters: Array<[number, number, number]>;
}

export const CELLS_PER_AXIS = 56;
export const GRID_N = CELLS_PER_AXIS + 1; // 57
export const CHUNK_CELLS = 8;
export const CHUNKS_PER_AXIS = CELLS_PER_AXIS / CHUNK_CELLS; // 7
export const WORLD_HALF = 20.0;
export const VOXEL_SIZE = (WORLD_HALF * 2) / CELLS_PER_AXIS; // ~0.7142857m

export const MATERIAL_PALETTE: Record<
  MaterialId,
  { rgb: [number, number, number]; rough: number; metal: number; glow: number }
> = {
  [MaterialId.Air]: { rgb: [0, 0, 0], rough: 1, metal: 0, glow: 0 },
  [MaterialId.Soil]: { rgb: [0.29, 0.56, 0.31], rough: 0.88, metal: 0.02, glow: 0 },
  [MaterialId.Stone]: { rgb: [0.48, 0.51, 0.56], rough: 0.84, metal: 0.05, glow: 0 },
  [MaterialId.Basalt]: { rgb: [0.2, 0.22, 0.27], rough: 0.78, metal: 0.12, glow: 0 },
  [MaterialId.Crystal]: { rgb: [0.16, 0.82, 0.88], rough: 0.18, metal: 0.25, glow: 0.65 },
  [MaterialId.Ice]: { rgb: [0.84, 0.93, 0.99], rough: 0.22, metal: 0.05, glow: 0.05 },
  [MaterialId.Sandstone]: { rgb: [0.76, 0.49, 0.34], rough: 0.86, metal: 0.02, glow: 0 },
};

export const MATERIAL_NAMES: Record<MaterialId, string> = {
  [MaterialId.Air]: 'Air (空气)',
  [MaterialId.Soil]: 'Soil (沃土)',
  [MaterialId.Stone]: 'Stone (灰岩)',
  [MaterialId.Basalt]: 'Basalt (玄武岩)',
  [MaterialId.Crystal]: 'Crystal (晶矿)',
  [MaterialId.Ice]: 'Ice (极冰)',
  [MaterialId.Sandstone]: 'Sandstone (砂岩)',
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class VoxelPlanet {
  public readonly gridN = GRID_N;
  public readonly cellsPerAxis = CELLS_PER_AXIS;
  public readonly chunkCells = CHUNK_CELLS;
  public readonly chunksPerAxis = CHUNKS_PER_AXIS;
  public worldHalf = WORLD_HALF;
  public voxelSize = VOXEL_SIZE;

  public baseRadius = DEFAULT_PLANET_RADIUS;
  public seedConfig: PlanetSeedConfig = { ...DEFAULT_SEED_CONFIG };

  public readonly density: Float32Array;
  public readonly material: Uint8Array;
  public readonly dirtyChunks: Uint8Array;

  // Pre-allocated scratch buffers for chunk extraction (zero GC)
  private readonly cornerDensity = new Float32Array(8);
  private readonly cornerPos = new Float32Array(24);
  private readonly edgeVerts = new Float32Array(36);
  private readonly edgeNorms = new Float32Array(36);
  private readonly edgeCols = new Float32Array(36);
  private readonly edgeMats = new Float32Array(36);
  private readonly edgeComputed = new Uint8Array(12);
  private readonly scratchPos: Float32Array;
  private readonly scratchNorm: Float32Array;
  private readonly scratchCol: Float32Array;
  private readonly scratchMat: Float32Array;
  private readonly scratchUv: Float32Array;
  private readonly tempGrad: [number, number, number] = [0, 0, 0];

  public spawnPosition: [number, number, number] = [0, DEFAULT_PLANET_RADIUS + 2.2, 0];
  public lakeBasinCenters: Array<[number, number, number]> = [];

  constructor(seedOrConfig: number | Partial<PlanetSeedConfig> = 202611) {
    const total = GRID_N * GRID_N * GRID_N;
    this.density = new Float32Array(total);
    this.material = new Uint8Array(total);
    this.dirtyChunks = new Uint8Array(
      CHUNKS_PER_AXIS * CHUNKS_PER_AXIS * CHUNKS_PER_AXIS,
    );

    // Up to 24 verts per cell (supports worst-case blocky 6-face meshing & Marching Cubes)
    const maxVerts = CHUNK_CELLS * CHUNK_CELLS * CHUNK_CELLS * 24;
    this.scratchPos = new Float32Array(maxVerts * 3);
    this.scratchNorm = new Float32Array(maxVerts * 3);
    this.scratchCol = new Float32Array(maxVerts * 3);
    this.scratchMat = new Float32Array(maxVerts * 3);
    this.scratchUv = new Float32Array(maxVerts * 2);

    this.generatePlanet(seedOrConfig);
  }

  public gridIndex(ix: number, iy: number, iz: number): number {
    return ix + iy * GRID_N + iz * GRID_N * GRID_N;
  }

  public chunkIndex(cx: number, cy: number, cz: number): number {
    return cx + cy * CHUNKS_PER_AXIS + cz * CHUNKS_PER_AXIS * CHUNKS_PER_AXIS;
  }

  public chunkCenterWorld(cx: number, cy: number, cz: number): [number, number, number] {
    const halfChunk = (CHUNK_CELLS * this.voxelSize) * 0.5;
    return [
      this.gridToWorld(cx * CHUNK_CELLS) + halfChunk,
      this.gridToWorld(cy * CHUNK_CELLS) + halfChunk,
      this.gridToWorld(cz * CHUNK_CELLS) + halfChunk,
    ];
  }

  public gridToWorld(i: number): number {
    return -this.worldHalf + i * this.voxelSize;
  }

  public worldToGrid(w: number): number {
    return (w + this.worldHalf) / this.voxelSize;
  }

  private updateBoundsForRadius(radius: number): void {
    this.baseRadius = radius;
    this.worldHalf = Math.max(0.25, radius * 1.54);
    this.voxelSize = (this.worldHalf * 2) / CELLS_PER_AXIS;
  }

  public generatePlanet(seedOrConfig: number | Partial<PlanetSeedConfig> = 202611): void {
    const raw: Partial<PlanetSeedConfig> =
      typeof seedOrConfig === 'number'
        ? { ...DEFAULT_SEED_CONFIG, seed: seedOrConfig }
        : seedOrConfig;

    const cfg = sanitizeSeedConfig(raw);
    this.seedConfig = cfg;
    this.updateBoundsForRadius(cfg.radius);
    seedNoise(cfg.seed);

    // Deterministic seeded PRNG for crater placement
    let rng = (cfg.seed ^ 0x9e3779b9) >>> 0;
    const rand = () => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return rng / 4294967296;
    };

    // Scenic crater lake basins placed relative to current planet radius
    const baseDirs: Array<[number, number, number, number]> = [
      [0.4, 0.81, 0.42, 0.49],   // Front-upper scenic lake
      [-0.64, 0.61, 0.47, 0.43], // Left-upper crater
      [0.12, -0.91, -0.39, 0.46],// South pole basin
      [0.78, -0.25, -0.57, 0.42],
      [-0.55, -0.52, 0.65, 0.41],
      [-0.22, 0.25, -0.94, 0.44],
    ];

    const effectiveCraters = Math.min(cfg.craterCount, 48);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const craters: Array<{ x: number; y: number; z: number; rad: number; depth: number }> = [];
    for (let i = 0; i < effectiveCraters; i++) {
      let bx: number;
      let by: number;
      let bz: number;
      let brad: number;
      if (i < baseDirs.length) {
        const base = baseDirs[i];
        const jitter = i === 0 ? 0.05 : 0.22;
        bx = base[0] + (rand() - 0.5) * jitter;
        by = base[1] + (rand() - 0.5) * jitter;
        bz = base[2] + (rand() - 0.5) * jitter;
        brad = base[3];
      } else {
        const y = 1 - ((i - baseDirs.length + 0.5) / Math.max(1, effectiveCraters - baseDirs.length)) * 2;
        const rAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = goldenAngle * i + rand() * 0.4;
        bx = Math.cos(theta) * rAtY;
        by = y;
        bz = Math.sin(theta) * rAtY;
        brad = 0.28 + rand() * 0.16;
      }
      const len = Math.hypot(bx, by, bz) || 1;
      const rSurf = cfg.radius * 0.99;
      craters.push({
        x: (bx / len) * rSurf,
        y: (by / len) * rSurf,
        z: (bz / len) * rSurf,
        rad: cfg.radius * brad,
        depth: cfg.craterDepth * (i === 0 ? 1.05 : 0.88 + rand() * 0.22),
      });
    }
    this.lakeBasinCenters = craters.slice(0, 3).map((c) => [c.x, c.y, c.z]);

    // Spawn highland plateau overlooking crater 0 & natural arch
    const spawnDir = [0.0, 0.94, 0.34];
    const sLen = Math.hypot(spawnDir[0], spawnDir[1], spawnDir[2]);
    spawnDir[0] /= sLen;
    spawnDir[1] /= sLen;
    spawnDir[2] /= sLen;

    const rScale = cfg.radius / 13.0;
    const archCenter: [number, number, number] = [
      2.9 * rScale,
      11.6 * rScale,
      2.2 * rScale,
    ];

    const crystalThreshInner = 0.86 - cfg.crystalRichness * 0.32;
    const crystalThreshMid = 0.90 - cfg.crystalRichness * 0.30;

    for (let iz = 0; iz < GRID_N; iz++) {
      const wz = this.gridToWorld(iz);
      for (let iy = 0; iy < GRID_N; iy++) {
        const wy = this.gridToWorld(iy);
        for (let ix = 0; ix < GRID_N; ix++) {
          const wx = this.gridToWorld(ix);
          const idx = this.gridIndex(ix, iy, iz);

          const r = Math.hypot(wx, wy, wz);
          const nx = r > 1e-6 ? wx / r : 0;
          const ny = r > 1e-6 ? wy / r : 1;
          const nz = r > 1e-6 ? wz / r : 0;

          // Scale-normalized coordinates for coherent geological features at any planet radius
          const wxN = wx / rScale;
          const wyN = wy / rScale;
          const wzN = wz / rScale;

          // Continents + mountain ridges
          const continent = fbm3D(nx * 1.45, ny * 1.45, nz * 1.45, 4);
          const ridge = ridged3D(
            nx * cfg.ridgeFreq + 5.1,
            ny * cfg.ridgeFreq,
            nz * cfg.ridgeFreq - 3.2,
            3,
          );
          const micro = fbm3D(wxN * 0.22, wyN * 0.22, wzN * 0.22, 2) * 0.42 * rScale;

          let targetRadius =
            this.baseRadius +
            continent * cfg.continentAmp * rScale +
            (ridge - 0.38) * cfg.ridgeAmp * rScale +
            micro;

          // Carve crater lake basins smoothly
          let inCraterRim = false;
          for (let c = 0; c < craters.length; c++) {
            const cr = craters[c];
            const dist = Math.hypot(wx - cr.x, wy - cr.y, wz - cr.z);
            if (dist < cr.rad) {
              const t = 1 - smoothstep(cr.rad * 0.22, cr.rad, dist);
              targetRadius -= t * cr.depth * rScale;
              if (dist < cr.rad * 0.88) {
                inCraterRim = true;
              }
            }
          }

          // Smooth highland spawn plateau so explorer spawns on stable ground
          const dotSpawn =
            nx * spawnDir[0] + ny * spawnDir[1] + nz * spawnDir[2];
          if (dotSpawn > 0.91) {
            const flatBlend = smoothstep(0.91, 0.985, dotSpawn);
            const desiredSpawnR = this.baseRadius + 1.05 * rScale;
            targetRadius =
              targetRadius * (1 - flatBlend) + desiredSpawnR * flatBlend;
          }

          // Positive density = inside solid
          let d = targetRadius - r;

          // Carve subterranean crystal caves in mantle shell
          const caveMinR = cfg.radius * 0.28;
          const caveMaxR = cfg.radius * 0.72;
          if (cfg.caveDensity > 0.01 && r > caveMinR && r < caveMaxR) {
            const caveNoise = fbm3D(wxN * 0.19 + 11.3, wyN * 0.19, wzN * 0.19, 3);
            const shellWeight =
              smoothstep(caveMinR, caveMinR + 1.4 * rScale, r) *
              (1 - smoothstep(caveMaxR - 1.4 * rScale, caveMaxR, r));
            if (caveNoise > 0.18) {
              d -= (caveNoise - 0.18) * 13.5 * cfg.caveDensity * shellWeight * rScale;
            }
          }

          // Scenic natural rock arch bridging near the vista
          if (cfg.hasArch) {
            const adx = (wx - archCenter[0]) / rScale;
            const ady = (wy - archCenter[1]) / rScale;
            const adz = (wz - archCenter[2]) / rScale;
            const torusMajor = Math.hypot(adx, adz) - 2.3;
            const torusDist = Math.hypot(torusMajor, ady - 0.45);
            if (torusDist < 1.15 && ady > -0.3) {
              d = Math.max(d, (1.05 - torusDist) * rScale);
            }
          }

          // Keep outer boundary strictly air so planet never clips grid edges
          const edgeMargin =
            this.worldHalf * 0.94 - Math.max(Math.abs(wx), Math.abs(wy), Math.abs(wz));
          if (edgeMargin < 0) {
            d = Math.min(d, edgeMargin * 2.0 - 0.5 * rScale);
          }

          this.density[idx] = d;

          // Assign coherent geological material without noisy threshold flipping
          if (d <= 0) {
            this.material[idx] = MaterialId.Air;
          } else {
            const absLat = Math.abs(ny);
            const crystalVein = ridged3D(wxN * 0.28, wyN * 0.28, wzN * 0.28, 2);
            if (r < cfg.radius * 0.49) {
              this.material[idx] =
                crystalVein > crystalThreshInner ? MaterialId.Crystal : MaterialId.Basalt;
            } else if (r < cfg.radius * 0.81) {
              this.material[idx] =
                crystalVein > crystalThreshMid ? MaterialId.Crystal : MaterialId.Stone;
            } else if (absLat > 0.87 && r > this.baseRadius + 0.75 * rScale) {
              this.material[idx] = MaterialId.Ice;
            } else if (r > this.baseRadius + 1.85 * rScale) {
              this.material[idx] = MaterialId.Stone;
            } else if (inCraterRim || continent < -0.18) {
              this.material[idx] = MaterialId.Sandstone;
            } else {
              this.material[idx] = MaterialId.Soil;
            }
          }
        }
      }
    }

    // Re-enforce flat spawn surface height accurately
    const spawnR = this.findSurfaceRadiusAlongRay(
      spawnDir[0],
      spawnDir[1],
      spawnDir[2],
    );
    this.spawnPosition = [
      spawnDir[0] * (spawnR + 1.35 * rScale),
      spawnDir[1] * (spawnR + 1.35 * rScale),
      spawnDir[2] * (spawnR + 1.35 * rScale),
    ];

    this.dirtyChunks.fill(1);
  }

  public exportSnapshot(): VoxelPlanetSnapshot {
    return {
      seedConfig: { ...this.seedConfig },
      density: new Float32Array(this.density),
      material: new Uint8Array(this.material),
      spawnPosition: [...this.spawnPosition] as [number, number, number],
      lakeBasinCenters: this.lakeBasinCenters.map((c) => [...c] as [number, number, number]),
    };
  }

  public importSnapshot(snapshot: VoxelPlanetSnapshot): void {
    if (
      snapshot.density.length !== this.density.length ||
      snapshot.material.length !== this.material.length
    ) {
      throw new Error('Incompatible voxel grid dimensions in snapshot');
    }
    this.seedConfig = sanitizeSeedConfig(snapshot.seedConfig);
    this.updateBoundsForRadius(this.seedConfig.radius);
    this.density.set(snapshot.density);
    this.material.set(snapshot.material);
    this.spawnPosition = [...snapshot.spawnPosition] as [number, number, number];
    this.lakeBasinCenters = snapshot.lakeBasinCenters.map(
      (c) => [...c] as [number, number, number],
    );
    this.dirtyChunks.fill(1);
  }

  public getVoxelStats(): VoxelFormatStats {
    const counts: Record<MaterialId, number> = {
      [MaterialId.Air]: 0,
      [MaterialId.Soil]: 0,
      [MaterialId.Stone]: 0,
      [MaterialId.Basalt]: 0,
      [MaterialId.Crystal]: 0,
      [MaterialId.Ice]: 0,
      [MaterialId.Sandstone]: 0,
    };
    const n = this.material.length;
    let solid = 0;
    for (let i = 0; i < n; i++) {
      const m = this.material[i] as MaterialId;
      counts[m] = (counts[m] ?? 0) + 1;
      if (m !== MaterialId.Air) solid++;
    }
    const densityBytes = this.density.byteLength;
    const materialBytes = this.material.byteLength;
    return {
      gridN: GRID_N,
      cellsPerAxis: CELLS_PER_AXIS,
      chunkCells: CHUNK_CELLS,
      chunksPerAxis: CHUNKS_PER_AXIS,
      totalVoxels: n,
      totalCells: CELLS_PER_AXIS * CELLS_PER_AXIS * CELLS_PER_AXIS,
      totalChunks: CHUNKS_PER_AXIS * CHUNKS_PER_AXIS * CHUNKS_PER_AXIS,
      voxelSize: this.voxelSize,
      worldHalf: this.worldHalf,
      densityBytes,
      materialBytes,
      totalBytes: densityBytes + materialBytes + this.dirtyChunks.byteLength,
      solidVoxels: solid,
      materialCounts: counts,
    };
  }

  public probeVoxelCell(wx: number, wy: number, wz: number): VoxelCellProbe {
    const gx = clamp(this.worldToGrid(wx), 0, CELLS_PER_AXIS - 0.001);
    const gy = clamp(this.worldToGrid(wy), 0, CELLS_PER_AXIS - 0.001);
    const gz = clamp(this.worldToGrid(wz), 0, CELLS_PER_AXIS - 0.001);

    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.floor(gz);

    const cx = clamp(Math.floor(ix / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);
    const cy = clamp(Math.floor(iy / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);
    const cz = clamp(Math.floor(iz / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);

    let cubeIndex = 0;
    const corners: VoxelCellCornerSample[] = [];
    for (let c = 0; c < 8; c++) {
      const off = CORNER_OFFSETS[c];
      const vx = ix + off[0];
      const vy = iy + off[1];
      const vz = iz + off[2];
      const idx = this.gridIndex(vx, vy, vz);
      const d = this.density[idx];
      const m = this.material[idx] as MaterialId;
      const solid = d > 0;
      if (solid) cubeIndex |= 1 << c;
      corners.push({
        corner: c,
        ix: vx,
        iy: vy,
        iz: vz,
        density: d,
        material: m,
        solid,
      });
    }

    const edgeMask = EDGE_TABLE[cubeIndex];
    const tris = TRI_TABLE[cubeIndex];
    let triVerts = 0;
    while (tris[triVerts] !== -1) triVerts += 3;

    const slice5x5: Array<{ dx: number; dz: number; density: number; material: MaterialId }> = [];
    for (let dz = -2; dz <= 2; dz++) {
      const sz = clamp(iz + dz, 0, CELLS_PER_AXIS);
      for (let dx = -2; dx <= 2; dx++) {
        const sx = clamp(ix + dx, 0, CELLS_PER_AXIS);
        const sIdx = this.gridIndex(sx, iy, sz);
        slice5x5.push({
          dx,
          dz,
          density: this.density[sIdx],
          material: this.material[sIdx] as MaterialId,
        });
      }
    }

    return {
      worldPos: [wx, wy, wz],
      gridPos: [gx, gy, gz],
      cell: [ix, iy, iz],
      chunk: [cx, cy, cz],
      chunkIndex: this.chunkIndex(cx, cy, cz),
      cubeIndex,
      edgeMask,
      triangleCount: triVerts / 3,
      centerDensity: this.sampleDensity(wx, wy, wz),
      centerMaterial: this.sampleNearestMaterial(wx, wy, wz),
      corners,
      slice5x5,
    };
  }

  public findSurfaceRadiusAlongRay(dx: number, dy: number, dz: number): number {
    const startR = this.worldHalf - this.voxelSize * 2.0;
    const minR = this.baseRadius * 0.15;
    const stepR = Math.max(this.voxelSize * 0.22, 0.005);
    for (let r = startR; r >= minR; r -= stepR) {
      const val = this.sampleDensity(dx * r, dy * r, dz * r);
      if (val >= 0) return r;
    }
    return this.baseRadius;
  }

  /**
   * Fast trilinear interpolation of voxel scalar density at world position (x,y,z).
   */
  public sampleDensity(wx: number, wy: number, wz: number): number {
    const gx = this.worldToGrid(wx);
    const gy = this.worldToGrid(wy);
    const gz = this.worldToGrid(wz);

    if (
      gx < 0 ||
      gy < 0 ||
      gz < 0 ||
      gx >= CELLS_PER_AXIS ||
      gy >= CELLS_PER_AXIS ||
      gz >= CELLS_PER_AXIS
    ) {
      return -2.0;
    }

    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fy = gy - iy;
    const fz = gz - iz;

    const sY = GRID_N;
    const sZ = GRID_N * GRID_N;
    const base = ix + iy * sY + iz * sZ;

    const c000 = this.density[base];
    const c100 = this.density[base + 1];
    const c010 = this.density[base + sY];
    const c110 = this.density[base + sY + 1];
    const c001 = this.density[base + sZ];
    const c101 = this.density[base + sZ + 1];
    const c011 = this.density[base + sZ + sY];
    const c111 = this.density[base + sZ + sY + 1];

    const x00 = c000 + (c100 - c000) * fx;
    const x10 = c010 + (c110 - c010) * fx;
    const x01 = c001 + (c101 - c001) * fx;
    const x11 = c011 + (c111 - c011) * fx;

    const y0 = x00 + (x10 - x00) * fy;
    const y1 = x01 + (x11 - x01) * fy;

    return y0 + (y1 - y0) * fz;
  }

  /**
   * Samples scalar density and central-difference outward surface normal (-∇density) at (wx, wy, wz).
   */
  public sampleDensityAndNormal(
    wx: number,
    wy: number,
    wz: number,
    outNormal: [number, number, number],
  ): number {
    const val = this.sampleDensity(wx, wy, wz);
    const eps = this.voxelSize * 0.65;
    const dx =
      this.sampleDensity(wx - eps, wy, wz) -
      this.sampleDensity(wx + eps, wy, wz);
    const dy =
      this.sampleDensity(wx, wy - eps, wz) -
      this.sampleDensity(wx, wy + eps, wz);
    const dz =
      this.sampleDensity(wx, wy, wz - eps) -
      this.sampleDensity(wx, wy, wz + eps);

    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      outNormal[0] = dx / len;
      outNormal[1] = dy / len;
      outNormal[2] = dz / len;
    } else {
      const rLen = Math.hypot(wx, wy, wz) || 1;
      outNormal[0] = wx / rLen;
      outNormal[1] = wy / rLen;
      outNormal[2] = wz / rLen;
    }
    return val;
  }

  public sampleNearestMaterial(wx: number, wy: number, wz: number): MaterialId {
    const ix = clamp(Math.round(this.worldToGrid(wx)), 0, CELLS_PER_AXIS);
    const iy = clamp(Math.round(this.worldToGrid(wy)), 0, CELLS_PER_AXIS);
    const iz = clamp(Math.round(this.worldToGrid(wz)), 0, CELLS_PER_AXIS);
    return this.material[this.gridIndex(ix, iy, iz)] as MaterialId;
  }

  /**
   * Sphere-marched raycast against the live voxel density field with bisection refinement.
   */
  public raycastTerrain(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist = this.worldHalf * 4.5,
  ): RaycastHit {
    const step = this.voxelSize * 0.35;
    let prevT = 0;
    let prevD = this.sampleDensity(ox, oy, oz);

    for (let t = step; t <= maxDist; t += step) {
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      const d = this.sampleDensity(px, py, pz);

      if (d >= 0 && prevD < 0) {
        // Binary search exact isosurface crossing
        let lo = prevT;
        let hi = t;
        for (let iter = 0; iter < 6; iter++) {
          const mid = 0.5 * (lo + hi);
          const md = this.sampleDensity(ox + dx * mid, oy + dy * mid, oz + dz * mid);
          if (md >= 0) hi = mid;
          else lo = mid;
        }
        const hitT = 0.5 * (lo + hi);
        const hx = ox + dx * hitT;
        const hy = oy + dy * hitT;
        const hz = oz + dz * hitT;
        this.sampleDensityAndNormal(hx, hy, hz, this.tempGrad);
        return {
          hit: true,
          x: hx,
          y: hy,
          z: hz,
          nx: this.tempGrad[0],
          ny: this.tempGrad[1],
          nz: this.tempGrad[2],
          distance: hitT,
        };
      }

      prevT = t;
      prevD = d;
    }

    return { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, distance: maxDist };
  }

  /**
   * Sculpt, build, smooth, or spherically flatten the planetary voxel field.
   */
  public applyBrush(
    cx: number,
    cy: number,
    cz: number,
    mode: Exclude<BrushMode, 'water'>,
    radius: number,
    strength: number,
    materialId: MaterialId,
  ): BrushResult {
    const safeRad = Math.max(this.voxelSize * 0.5, radius);
    const rScale = this.baseRadius / 13.0;
    const pad = safeRad + this.voxelSize * 1.5;
    const minX = clamp(Math.floor(this.worldToGrid(cx - pad)), 1, CELLS_PER_AXIS - 1);
    const maxX = clamp(Math.ceil(this.worldToGrid(cx + pad)), 1, CELLS_PER_AXIS - 1);
    const minY = clamp(Math.floor(this.worldToGrid(cy - pad)), 1, CELLS_PER_AXIS - 1);
    const maxY = clamp(Math.ceil(this.worldToGrid(cy + pad)), 1, CELLS_PER_AXIS - 1);
    const minZ = clamp(Math.floor(this.worldToGrid(cz - pad)), 1, CELLS_PER_AXIS - 1);
    const maxZ = clamp(Math.ceil(this.worldToGrid(cz + pad)), 1, CELLS_PER_AXIS - 1);

    const targetShellRadius = Math.hypot(cx, cy, cz);
    let deltaVolume = 0;

    let copySnapshot: Float32Array | null = null;
    if (mode === 'smooth') {
      copySnapshot = new Float32Array(this.density);
    }

    for (let iz = minZ; iz <= maxZ; iz++) {
      const wz = this.gridToWorld(iz);
      for (let iy = minY; iy <= maxY; iy++) {
        const wy = this.gridToWorld(iy);
        for (let ix = minX; ix <= maxX; ix++) {
          const wx = this.gridToWorld(ix);
          const dist = Math.hypot(wx - cx, wy - cy, wz - cz);
          if (dist >= safeRad) continue;

          const falloff = 1 - smoothstep(0, safeRad, dist);
          const idx = this.gridIndex(ix, iy, iz);
          const prev = this.density[idx];
          let next = prev;

          if (mode === 'carve') {
            next = Math.max(-4.5 * rScale, prev - strength * rScale * falloff);
            if (next <= 0) {
              this.material[idx] = MaterialId.Air;
            }
          } else if (mode === 'build') {
            next = Math.min(4.5 * rScale, prev + strength * rScale * falloff);
            if (next > -0.25 * rScale && materialId !== MaterialId.Air) {
              this.material[idx] = materialId;
            }
          } else if (mode === 'flatten') {
            const vr = Math.hypot(wx, wy, wz);
            const desired = targetShellRadius - vr;
            const blend = clamp(falloff * strength * 0.65, 0, 1);
            next = prev + (desired - prev) * blend;
            if (next > 0 && this.material[idx] === MaterialId.Air) {
              this.material[idx] = materialId;
            } else if (next <= 0) {
              this.material[idx] = MaterialId.Air;
            }
          } else if (mode === 'smooth' && copySnapshot) {
            const sY = GRID_N;
            const sZ = GRID_N * GRID_N;
            const avg =
              (copySnapshot[idx] * 2 +
                copySnapshot[idx - 1] +
                copySnapshot[idx + 1] +
                copySnapshot[idx - sY] +
                copySnapshot[idx + sY] +
                copySnapshot[idx - sZ] +
                copySnapshot[idx + sZ]) /
              8;
            const blend = clamp(falloff * strength * 0.55, 0, 1);
            next = prev + (avg - prev) * blend;
            if (next > 0 && this.material[idx] === MaterialId.Air) {
              this.material[idx] = MaterialId.Stone;
            } else if (next <= 0) {
              this.material[idx] = MaterialId.Air;
            }
          }

          this.density[idx] = next;
          deltaVolume += next - prev;
        }
      }
    }

    // Mark touched chunks (plus 1-voxel neighbor border for seamless normal recomputation)
    const cMinX = clamp(Math.floor((minX - 1) / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);
    const cMaxX = clamp(Math.floor((maxX + 1) / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);
    const cMinY = clamp(Math.floor((minY - 1) / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);
    const cMaxY = clamp(Math.floor((maxY + 1) / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);
    const cMinZ = clamp(Math.floor((minZ - 1) / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);
    const cMaxZ = clamp(Math.floor((maxZ + 1) / CHUNK_CELLS), 0, CHUNKS_PER_AXIS - 1);

    const modifiedChunks: number[] = [];
    for (let cz = cMinZ; cz <= cMaxZ; cz++) {
      for (let cy = cMinY; cy <= cMaxY; cy++) {
        for (let cx = cMinX; cx <= cMaxX; cx++) {
          const ci = this.chunkIndex(cx, cy, cz);
          this.dirtyChunks[ci] = 1;
          modifiedChunks.push(ci);
        }
      }
    }

    return { modifiedChunks, center: [cx, cy, cz], deltaVolume };
  }

  /**
   * Extracts a smooth Marching Cubes mesh for a single 8x8x8 chunk with multi-resolution LOD support
   * (lod 0 = stride 1, lod 1 = stride 2, lod 2 = stride 4) and per-edge attribute caching.
   */
  public extractChunkMesh(
    cx: number,
    cy: number,
    cz: number,
    lod: ChunkLodLevel = 0,
  ): ChunkMeshData {
    const stride = 1 << lod; // 1, 2, or 4 (all divide CHUNK_CELLS=8 cleanly)
    const stepSize = this.voxelSize * stride;
    const rScale = this.baseRadius / 13.0;
    const startX = cx * CHUNK_CELLS;
    const startY = cy * CHUNK_CELLS;
    const startZ = cz * CHUNK_CELLS;
    const sY = GRID_N;
    const sZ = GRID_N * GRID_N;

    let vCount = 0;

    for (let lz = 0; lz < CHUNK_CELLS; lz += stride) {
      const iz = startZ + lz;
      const wz0 = this.gridToWorld(iz);
      for (let ly = 0; ly < CHUNK_CELLS; ly += stride) {
        const iy = startY + ly;
        const wy0 = this.gridToWorld(iy);
        for (let lx = 0; lx < CHUNK_CELLS; lx += stride) {
          const ix = startX + lx;
          const wx0 = this.gridToWorld(ix);

          let cubeIndex = 0;
          for (let c = 0; c < 8; c++) {
            const off = CORNER_OFFSETS[c];
            const gx = ix + off[0] * stride;
            const gy = iy + off[1] * stride;
            const gz = iz + off[2] * stride;
            const d = this.density[gx + gy * sY + gz * sZ];
            this.cornerDensity[c] = d;
            this.cornerPos[c * 3] = wx0 + off[0] * stepSize;
            this.cornerPos[c * 3 + 1] = wy0 + off[1] * stepSize;
            this.cornerPos[c * 3 + 2] = wz0 + off[2] * stepSize;
            if (d > 0) {
              cubeIndex |= 1 << c;
            }
          }

          const edgeMask = EDGE_TABLE[cubeIndex];
          if (edgeMask === 0) continue;

          this.edgeComputed.fill(0);
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
            // Reversed winding (t, t+2, t+1) produces outward normals for positive-inside density
            const edges = [tris[t], tris[t + 2], tris[t + 1]];
            for (let k = 0; k < 3; k++) {
              const eIdx = edges[k];
              const e3 = eIdx * 3;

              // Compute expensive gradient, material blend, and SDF AO once per active edge
              if (this.edgeComputed[eIdx] === 0) {
                this.edgeComputed[eIdx] = 1;
                const vx = this.edgeVerts[e3];
                const vy = this.edgeVerts[e3 + 1];
                const vz = this.edgeVerts[e3 + 2];

                this.sampleDensityAndNormal(vx, vy, vz, this.tempGrad);
                const nx = this.tempGrad[0];
                const ny = this.tempGrad[1];
                const nz = this.tempGrad[2];
                this.edgeNorms[e3] = nx;
                this.edgeNorms[e3 + 1] = ny;
                this.edgeNorms[e3 + 2] = nz;

                // Trilinear solid-weighted material interpolation at exact vertex position
                const gx = clamp(this.worldToGrid(vx), 0, CELLS_PER_AXIS - 0.001);
                const gy = clamp(this.worldToGrid(vy), 0, CELLS_PER_AXIS - 0.001);
                const gz = clamp(this.worldToGrid(vz), 0, CELLS_PER_AXIS - 0.001);
                const bix = Math.floor(gx);
                const biy = Math.floor(gy);
                const biz = Math.floor(gz);
                const fx = gx - bix;
                const fy = gy - biy;
                const fz = gz - biz;

                let wSum = 0;
                let cr = 0;
                let cg = 0;
                let cb = 0;
                let rough = 0;
                let metal = 0;
                let glow = 0;

                for (let dz = 0; dz <= 1; dz++) {
                  const wz = dz === 0 ? 1 - fz : fz;
                  for (let dy = 0; dy <= 1; dy++) {
                    const wy = dy === 0 ? 1 - fy : fy;
                    for (let dx = 0; dx <= 1; dx++) {
                      const wx = dx === 0 ? 1 - fx : fx;
                      const cIdx = bix + dx + (biy + dy) * sY + (biz + dz) * sZ;
                      const m = this.material[cIdx] as MaterialId;
                      if (m === MaterialId.Air) continue;
                      const w = wx * wy * wz;
                      if (w <= 1e-5) continue;
                      const info = MATERIAL_PALETTE[m];
                      cr += info.rgb[0] * w;
                      cg += info.rgb[1] * w;
                      cb += info.rgb[2] * w;
                      rough += info.rough * w;
                      metal += info.metal * w;
                      glow += info.glow * w;
                      wSum += w;
                    }
                  }
                }

                if (wSum > 1e-5) {
                  cr /= wSum;
                  cg /= wSum;
                  cb /= wSum;
                  rough /= wSum;
                  metal /= wSum;
                  glow /= wSum;
                } else {
                  const stoneInfo = MATERIAL_PALETTE[MaterialId.Stone];
                  cr = stoneInfo.rgb[0];
                  cg = stoneInfo.rgb[1];
                  cb = stoneInfo.rgb[2];
                  rough = stoneInfo.rough;
                  metal = stoneInfo.metal;
                  glow = stoneInfo.glow;
                }

                const r = Math.hypot(vx, vy, vz) || 1;
                const slopeDot = (vx * nx + vy * ny + vz * nz) / r;
                const aoSample =
                  lod === 2
                    ? -0.65 * rScale
                    : this.sampleDensity(
                        vx + nx * this.voxelSize * 1.15,
                        vy + ny * this.voxelSize * 1.15,
                        vz + nz * this.voxelSize * 1.15,
                      );
                const aoNorm = aoSample / Math.max(rScale, 1e-4);
                const ao = clamp(1.0 - Math.max(0, aoNorm + 0.65) * 0.42, 0.46, 1.0);

                const cliffBlend = (1 - smoothstep(0.58, 0.86, slopeDot)) * (1 - glow);
                const stoneCol = MATERIAL_PALETTE[MaterialId.Stone].rgb;
                cr = cr * (1 - cliffBlend * 0.72) + stoneCol[0] * cliffBlend * 0.72;
                cg = cg * (1 - cliffBlend * 0.72) + stoneCol[1] * cliffBlend * 0.72;
                cb = cb * (1 - cliffBlend * 0.72) + stoneCol[2] * cliffBlend * 0.72;

                const depthShade =
                  smoothstep(this.baseRadius * 0.35, this.baseRadius * 0.85, r) * 0.35 +
                  0.65;
                const shade = ao * depthShade;

                this.edgeCols[e3] = clamp(cr * shade, 0, 1);
                this.edgeCols[e3 + 1] = clamp(cg * shade, 0, 1);
                this.edgeCols[e3 + 2] = clamp(cb * shade, 0, 1);

                this.edgeMats[e3] = rough;
                this.edgeMats[e3 + 1] = metal;
                this.edgeMats[e3 + 2] = glow;
              }

              const p3 = vCount * 3;
              this.scratchPos[p3] = this.edgeVerts[e3];
              this.scratchPos[p3 + 1] = this.edgeVerts[e3 + 1];
              this.scratchPos[p3 + 2] = this.edgeVerts[e3 + 2];

              this.scratchNorm[p3] = this.edgeNorms[e3];
              this.scratchNorm[p3 + 1] = this.edgeNorms[e3 + 1];
              this.scratchNorm[p3 + 2] = this.edgeNorms[e3 + 2];

              this.scratchCol[p3] = this.edgeCols[e3];
              this.scratchCol[p3 + 1] = this.edgeCols[e3 + 1];
              this.scratchCol[p3 + 2] = this.edgeCols[e3 + 2];

              this.scratchMat[p3] = this.edgeMats[e3];
              this.scratchMat[p3 + 1] = this.edgeMats[e3 + 1];
              this.scratchMat[p3 + 2] = this.edgeMats[e3 + 2];

              const u2 = vCount * 2;
              this.scratchUv[u2] = 0.5;
              this.scratchUv[u2 + 1] = 0.5;

              vCount++;
            }
          }
        }
      }
    }

    return {
      cx,
      cy,
      cz,
      lod,
      positions: this.scratchPos.slice(0, vCount * 3),
      normals: this.scratchNorm.slice(0, vCount * 3),
      colors: this.scratchCol.slice(0, vCount * 3),
      matProps: this.scratchMat.slice(0, vCount * 3),
      uvs: this.scratchUv.slice(0, vCount * 2),
      vertexCount: vCount,
    };
  }

  /**
   * Extracts a Minecraft-style blocky voxel cube mesh for a chunk with neighbor face-culling,
   * voxel corner ambient occlusion, face UVs for crisp block borders, and full LOD stride support.
   */
  public extractBlockyChunkMesh(
    cx: number,
    cy: number,
    cz: number,
    lod: ChunkLodLevel = 0,
  ): ChunkMeshData {
    const stride = 1 << lod;
    const stepSize = this.voxelSize * stride;
    const startX = cx * CHUNK_CELLS;
    const startY = cy * CHUNK_CELLS;
    const startZ = cz * CHUNK_CELLS;
    const sY = GRID_N;
    const sZ = GRID_N * GRID_N;

    const isBlockSolid = (gx: number, gy: number, gz: number): boolean => {
      if (
        gx < 0 ||
        gy < 0 ||
        gz < 0 ||
        gx >= CELLS_PER_AXIS ||
        gy >= CELLS_PER_AXIS ||
        gz >= CELLS_PER_AXIS
      ) {
        return false;
      }
      if (stride === 1) {
        const base = gx + gy * sY + gz * sZ;
        const avg =
          this.density[base] +
          this.density[base + 1] +
          this.density[base + sY] +
          this.density[base + sY + 1] +
          this.density[base + sZ] +
          this.density[base + sZ + 1] +
          this.density[base + sZ + sY] +
          this.density[base + sZ + sY + 1];
        return avg > 0;
      }
      const hx = clamp(gx + (stride >> 1), 0, CELLS_PER_AXIS);
      const hy = clamp(gy + (stride >> 1), 0, CELLS_PER_AXIS);
      const hz = clamp(gz + (stride >> 1), 0, CELLS_PER_AXIS);
      return this.density[hx + hy * sY + hz * sZ] > 0;
    };

    const pickBlockMaterial = (gx: number, gy: number, gz: number): MaterialId => {
      const mx = clamp(gx + (stride >> 1), 0, CELLS_PER_AXIS);
      const my = clamp(gy + (stride >> 1), 0, CELLS_PER_AXIS);
      const mz = clamp(gz + (stride >> 1), 0, CELLS_PER_AXIS);
      const centerMat = this.material[mx + my * sY + mz * sZ] as MaterialId;
      if (centerMat !== MaterialId.Air) return centerMat;
      // Search cell corners for dominant non-Air material
      for (let dz = 0; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
          for (let dx = 0; dx <= 1; dx++) {
            const ix = clamp(gx + dx * stride, 0, CELLS_PER_AXIS);
            const iy = clamp(gy + dy * stride, 0, CELLS_PER_AXIS);
            const iz = clamp(gz + dz * stride, 0, CELLS_PER_AXIS);
            const m = this.material[ix + iy * sY + iz * sZ] as MaterialId;
            if (m !== MaterialId.Air) return m;
          }
        }
      }
      return MaterialId.Stone;
    };

    // 6 cube faces: normal, 4 CCW vertices (from outside), and local UV axes
    const FACES: ReadonlyArray<{
      n: [number, number, number];
      uDir: [number, number, number];
      vDir: [number, number, number];
      verts: readonly [
        [number, number, number, number, number],
        [number, number, number, number, number],
        [number, number, number, number, number],
        [number, number, number, number, number],
      ];
      shade: number;
    }> = [
      {
        n: [1, 0, 0],
        uDir: [0, 0, -1],
        vDir: [0, 1, 0],
        verts: [
          [1, 0, 1, 0, 0],
          [1, 0, 0, 1, 0],
          [1, 1, 0, 1, 1],
          [1, 1, 1, 0, 1],
        ],
        shade: 0.92,
      },
      {
        n: [-1, 0, 0],
        uDir: [0, 0, 1],
        vDir: [0, 1, 0],
        verts: [
          [0, 0, 0, 0, 0],
          [0, 0, 1, 1, 0],
          [0, 1, 1, 1, 1],
          [0, 1, 0, 0, 1],
        ],
        shade: 0.84,
      },
      {
        n: [0, 1, 0],
        uDir: [1, 0, 0],
        vDir: [0, 0, -1],
        verts: [
          [0, 1, 1, 0, 0],
          [1, 1, 1, 1, 0],
          [1, 1, 0, 1, 1],
          [0, 1, 0, 0, 1],
        ],
        shade: 1.0,
      },
      {
        n: [0, -1, 0],
        uDir: [1, 0, 0],
        vDir: [0, 0, 1],
        verts: [
          [0, 0, 0, 0, 0],
          [1, 0, 0, 1, 0],
          [1, 0, 1, 1, 1],
          [0, 0, 1, 0, 1],
        ],
        shade: 0.72,
      },
      {
        n: [0, 0, 1],
        uDir: [1, 0, 0],
        vDir: [0, 1, 0],
        verts: [
          [0, 0, 1, 0, 0],
          [1, 0, 1, 1, 0],
          [1, 1, 1, 1, 1],
          [0, 1, 1, 0, 1],
        ],
        shade: 0.96,
      },
      {
        n: [0, 0, -1],
        uDir: [-1, 0, 0],
        vDir: [0, 1, 0],
        verts: [
          [1, 0, 0, 0, 0],
          [0, 0, 0, 1, 0],
          [0, 1, 0, 1, 1],
          [1, 1, 0, 0, 1],
        ],
        shade: 0.86,
      },
    ];

    let vCount = 0;
    const maxVerts = this.scratchPos.length / 3;

    for (let lz = 0; lz < CHUNK_CELLS; lz += stride) {
      const iz = startZ + lz;
      const wz0 = this.gridToWorld(iz);
      for (let ly = 0; ly < CHUNK_CELLS; ly += stride) {
        const iy = startY + ly;
        const wy0 = this.gridToWorld(iy);
        for (let lx = 0; lx < CHUNK_CELLS; lx += stride) {
          const ix = startX + lx;
          if (!isBlockSolid(ix, iy, iz)) continue;

          const wx0 = this.gridToWorld(ix);
          const matId = pickBlockMaterial(ix, iy, iz);
          const pal = MATERIAL_PALETTE[matId] ?? MATERIAL_PALETTE[MaterialId.Stone];
          const r = Math.hypot(
            wx0 + stepSize * 0.5,
            wy0 + stepSize * 0.5,
            wz0 + stepSize * 0.5,
          );
          const depthShade =
            smoothstep(this.baseRadius * 0.35, this.baseRadius * 0.85, r) * 0.25 + 0.75;

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const [nx, ny, nz] = face.n;
            if (isBlockSolid(ix + nx * stride, iy + ny * stride, iz + nz * stride)) {
              continue; // Interior shared face culled
            }
            if (vCount + 6 > maxVerts) break;

            // Compute subtle 4-corner Minecraft voxel AO
            const aoVals = [1, 1, 1, 1];
            if (lod < 2) {
              for (let c = 0; c < 4; c++) {
                const [, , , u, v] = face.verts[c];
                const su = u === 0 ? -1 : 1;
                const sv = v === 0 ? -1 : 1;
                const s1 = isBlockSolid(
                  ix + (nx + face.uDir[0] * su) * stride,
                  iy + (ny + face.uDir[1] * su) * stride,
                  iz + (nz + face.uDir[2] * su) * stride,
                )
                  ? 1
                  : 0;
                const s2 = isBlockSolid(
                  ix + (nx + face.vDir[0] * sv) * stride,
                  iy + (ny + face.vDir[1] * sv) * stride,
                  iz + (nz + face.vDir[2] * sv) * stride,
                )
                  ? 1
                  : 0;
                const sc = isBlockSolid(
                  ix + (nx + face.uDir[0] * su + face.vDir[0] * sv) * stride,
                  iy + (ny + face.uDir[1] * su + face.vDir[1] * sv) * stride,
                  iz + (nz + face.uDir[2] * su + face.vDir[2] * sv) * stride,
                )
                  ? 1
                  : 0;
                const occ = s1 && s2 ? 3 : s1 + s2 + sc;
                aoVals[c] = 1.0 - occ * 0.13;
              }
            }

            const triOrder = [0, 1, 2, 0, 2, 3];
            for (let t = 0; t < 6; t++) {
              const vi = triOrder[t];
              const [vx, vy, vz, u, v] = face.verts[vi];
              const p3 = vCount * 3;
              const u2 = vCount * 2;
              const shade = face.shade * depthShade * aoVals[vi];

              this.scratchPos[p3] = wx0 + vx * stepSize;
              this.scratchPos[p3 + 1] = wy0 + vy * stepSize;
              this.scratchPos[p3 + 2] = wz0 + vz * stepSize;

              this.scratchNorm[p3] = nx;
              this.scratchNorm[p3 + 1] = ny;
              this.scratchNorm[p3 + 2] = nz;

              this.scratchCol[p3] = clamp(pal.rgb[0] * shade, 0, 1);
              this.scratchCol[p3 + 1] = clamp(pal.rgb[1] * shade, 0, 1);
              this.scratchCol[p3 + 2] = clamp(pal.rgb[2] * shade, 0, 1);

              this.scratchMat[p3] = pal.rough;
              this.scratchMat[p3 + 1] = pal.metal;
              this.scratchMat[p3 + 2] = pal.glow;

              this.scratchUv[u2] = u;
              this.scratchUv[u2 + 1] = v;

              vCount++;
            }
          }
        }
      }
    }

    return {
      cx,
      cy,
      cz,
      lod,
      positions: this.scratchPos.slice(0, vCount * 3),
      normals: this.scratchNorm.slice(0, vCount * 3),
      colors: this.scratchCol.slice(0, vCount * 3),
      matProps: this.scratchMat.slice(0, vCount * 3),
      uvs: this.scratchUv.slice(0, vCount * 2),
      vertexCount: vCount,
    };
  }
}
