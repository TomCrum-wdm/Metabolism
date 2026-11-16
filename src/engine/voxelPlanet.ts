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
  voxelRadius: number; // Voxel blocks across planetary radius R0 (e.g. 18 .. 50000+)
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
  voxelRadius: 18,
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
      voxelRadius: 18,
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
      voxelRadius: 18,
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
      voxelRadius: 18,
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
    voxelRadius:
      Number.isFinite(merged.voxelRadius) && merged.voxelRadius >= 4
        ? merged.voxelRadius
        : DEFAULT_SEED_CONFIG.voxelRadius,
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
  const fmt = (n: number) => {
    if (!Number.isFinite(n)) return '0';
    if (Number.isInteger(n) && Math.abs(n) <= 1e15) return String(n);
    return Number(n.toPrecision(6)).toString();
  };
  return [
    'TS3',
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
    fmt(cfg.voxelRadius),
  ].join('|');
}

export function decodeSeedCode(code: string): PlanetSeedConfig | null {
  const trimmed = code.trim();
  let parts: string[];
  if (trimmed.startsWith('TS3|') || trimmed.startsWith('TS2|')) {
    parts = trimmed.split('|');
  } else if (trimmed.startsWith('TS1-')) {
    parts = trimmed.split('-');
  } else {
    return null;
  }
  if (parts.length !== 12 && parts.length !== 13) return null;
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
    voxelRadius: nums.length >= 12 ? nums[11] : DEFAULT_SEED_CONFIG.voxelRadius,
  });
}

export interface ChunkMeshData {
  cx: number;
  cy: number;
  cz: number;
  lod: ChunkLodLevel;
  origin?: [number, number, number];
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
  voxelRadius: number;
  nativeVoxelSize: number;
  virtualCellsPerAxis: number;
  fullCellsPerAxis: number;
  fullChunksPerAxis: number;
  fullGridN: number;
  octreeDepth: number;
  fullTotalVoxelsLabel: string;
  sparseActiveChunks: number;
  isSparseStreaming: boolean;
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

export interface SparseChunkSnapshot {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  scaleMult: number;
  density: Float32Array;
  material: Uint8Array;
}

export interface VoxelPlanetSnapshot {
  seedConfig: PlanetSeedConfig;
  density: Float32Array;
  material: Uint8Array;
  spawnPosition: [number, number, number];
  lakeBasinCenters: Array<[number, number, number]>;
  editedChunks?: SparseChunkSnapshot[];
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

export interface SparseVoxelChunk {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  scaleMult: number;
  stepSize: number;
  originX: number;
  originY: number;
  originZ: number;
  density: Float32Array; // 11x11x11 (pad=1 around 8x8x8 cells)
  material: Uint8Array; // 11x11x11
  edited: boolean;
  dirty: boolean;
  lastUsedFrame: number;
}

interface AnalyticalContext {
  cfg: PlanetSeedConfig;
  rScale: number;
  seedOffX: number;
  seedOffY: number;
  seedOffZ: number;
  iceLatThresh: number;
  sandBias: number;
  craters: Array<{ x: number; y: number; z: number; rad: number; depth: number }>;
  spawnDir: [number, number, number];
  spawnBaseR: number;
  archCenter: [number, number, number];
  archDir: [number, number, number];
  archSpan: [number, number, number];
  archBinorm: [number, number, number];
  crystalThreshInner: number;
  crystalThreshMid: number;
  detailLogScale: number;
}

export interface HighResStreamBatch {
  active: boolean;
  hideMacro: boolean;
  globeBuiltComplete: boolean;
  hemiCenter: [number, number, number];
  hemiDiscardRadius: number;
  midOuterCenter: [number, number, number];
  midOuterDiscardRadius: number;
  midCenter: [number, number, number];
  midDiscardRadius: number;
  nativeCenter: [number, number, number];
  nativeDiscardRadius: number;
  pendingTotal: number;
  desiredKeys: Set<string>;
  rebuiltMeshes: Array<{
    key: string;
    tier: 'globe' | 'hemi' | 'midOuter' | 'mid' | 'native';
    mesh: ChunkMeshData;
  }>;
}

const SPARSE_PAD = 1;
const SPARSE_N = CHUNK_CELLS + 1 + SPARSE_PAD * 2; // 11
const SPARSE_NY = SPARSE_N;
const SPARSE_NZ = SPARSE_N * SPARSE_N;
const MAX_DENSE_CHUNKS_PER_AXIS = 40; // Up to 320³ flat dense RAM cache
const STREAMING_FALLBACK_CHUNKS_PER_AXIS = 24; // 192³ resident fallback cache for 360° sparse octree (>1,000,000,000³+)

function formatVoxelCountLabel(cellsPerAxis: number): string {
  if (cellsPerAxis <= 2000) {
    return (cellsPerAxis * cellsPerAxis * cellsPerAxis).toLocaleString();
  }
  const log10 = 3 * Math.log10(cellsPerAxis);
  const exp = Math.floor(log10);
  const mant = Math.pow(10, log10 - exp);
  return `${mant.toFixed(2)}×10^${exp}`;
}

export class VoxelPlanet {
  public gridN = GRID_N;
  public cellsPerAxis = CELLS_PER_AXIS;
  public readonly chunkCells = CHUNK_CELLS;
  public chunksPerAxis = CHUNKS_PER_AXIS;
  public totalChunks = CHUNKS_PER_AXIS * CHUNKS_PER_AXIS * CHUNKS_PER_AXIS;
  public worldHalf = WORLD_HALF;
  public voxelSize = VOXEL_SIZE;

  // Full 360° sparse hierarchical octree domain (scales unrestrictedly past 1,000,000,000³)
  public fullCellsPerAxis = CELLS_PER_AXIS;
  public fullChunksPerAxis = CHUNKS_PER_AXIS;
  public fullGridN = GRID_N;
  public octreeDepth = 3;

  public baseRadius = DEFAULT_PLANET_RADIUS;
  public voxelRadius = DEFAULT_SEED_CONFIG.voxelRadius;
  public nativeVoxelSize = DEFAULT_PLANET_RADIUS / DEFAULT_SEED_CONFIG.voxelRadius;
  public isHighResStreaming = false;
  public seedConfig: PlanetSeedConfig = { ...DEFAULT_SEED_CONFIG };

  public density: Float32Array;
  public material: Uint8Array;
  public dirtyChunks: Uint8Array;
  public nonUniformChunks: Uint8Array;

  public readonly sparseChunks = new Map<string, SparseVoxelChunk>();
  private streamFrame = 0;
  private genCtx!: AnalyticalContext;

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
  public hasGenerated = false;
  public voxelRevision = 0;

  constructor(
    seedOrConfig: number | Partial<PlanetSeedConfig> = 202611,
    options?: { skipGenerate?: boolean },
  ) {
    const total = GRID_N * GRID_N * GRID_N;
    this.density = new Float32Array(total);
    this.material = new Uint8Array(total);
    this.dirtyChunks = new Uint8Array(this.totalChunks);
    this.nonUniformChunks = new Uint8Array(this.totalChunks).fill(1);

    // Up to 24 verts per cell (supports worst-case blocky 6-face meshing & Marching Cubes)
    const maxVerts = CHUNK_CELLS * CHUNK_CELLS * CHUNK_CELLS * 24;
    this.scratchPos = new Float32Array(maxVerts * 3);
    this.scratchNorm = new Float32Array(maxVerts * 3);
    this.scratchCol = new Float32Array(maxVerts * 3);
    this.scratchMat = new Float32Array(maxVerts * 3);
    this.scratchUv = new Float32Array(maxVerts * 2);

    if (options?.skipGenerate) {
      const raw: Partial<PlanetSeedConfig> =
        typeof seedOrConfig === 'number'
          ? { ...DEFAULT_SEED_CONFIG, seed: seedOrConfig }
          : seedOrConfig;
      const cfg = sanitizeSeedConfig(raw);
      this.seedConfig = cfg;
      this.updateBoundsForRadius(cfg.radius, cfg.voxelRadius);
      this.genCtx = this.buildAnalyticalContext(cfg);
      this.hasGenerated = false;
    } else {
      this.generatePlanet(seedOrConfig);
    }
  }

  public gridIndex(ix: number, iy: number, iz: number): number {
    return ix + iy * this.gridN + iz * this.gridN * this.gridN;
  }

  public chunkIndex(cx: number, cy: number, cz: number): number {
    return cx + cy * this.chunksPerAxis + cz * this.chunksPerAxis * this.chunksPerAxis;
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

  private computeTargetChunksPerAxis(voxelRadius: number): number {
    if (voxelRadius <= 18.45) return CHUNKS_PER_AXIS;
    const desiredCells = Math.round(voxelRadius * 2 * 1.54);
    const neededChunks = Math.ceil(desiredCells / CHUNK_CELLS);
    if (neededChunks <= MAX_DENSE_CHUNKS_PER_AXIS) {
      return Math.max(CHUNKS_PER_AXIS, neededChunks);
    }
    return STREAMING_FALLBACK_CHUNKS_PER_AXIS;
  }

  private resizeGridForChunks(chunksPerAxis: number): void {
    const clamped = clamp(Math.round(chunksPerAxis), CHUNKS_PER_AXIS, MAX_DENSE_CHUNKS_PER_AXIS);
    if (clamped === this.chunksPerAxis && this.density.length === (clamped * CHUNK_CELLS + 1) ** 3) {
      return;
    }
    this.chunksPerAxis = clamped;
    this.cellsPerAxis = clamped * CHUNK_CELLS;
    this.gridN = this.cellsPerAxis + 1;
    this.totalChunks = clamped * clamped * clamped;
    const total = this.gridN * this.gridN * this.gridN;
    this.density = new Float32Array(total);
    this.material = new Uint8Array(total);
    this.dirtyChunks = new Uint8Array(this.totalChunks);
    this.nonUniformChunks = new Uint8Array(this.totalChunks).fill(1);
  }

  private updateBoundsForRadius(radius: number, voxelRadius: number): void {
    this.voxelRadius = Math.max(4, voxelRadius);
    const targetMacroChunks = this.computeTargetChunksPerAxis(this.voxelRadius);
    this.resizeGridForChunks(targetMacroChunks);
    this.baseRadius = radius;
    this.worldHalf = Math.max(0.25, radius * 1.54);
    this.voxelSize = (this.worldHalf * 2) / this.cellsPerAxis;
    this.nativeVoxelSize = this.baseRadius / this.voxelRadius;

    const maxMacroVoxelRadius = Math.floor(this.cellsPerAxis / (2 * 1.54)) + 2;
    this.isHighResStreaming =
      this.voxelRadius < 17.55 || this.voxelRadius > maxMacroVoxelRadius;

    if (this.isHighResStreaming) {
      const desiredFullChunks = Math.max(
        1,
        Math.ceil((this.voxelRadius * 2 * 1.54) / CHUNK_CELLS),
      );
      this.fullChunksPerAxis = desiredFullChunks;
      this.fullCellsPerAxis = desiredFullChunks * CHUNK_CELLS;
    } else {
      this.fullChunksPerAxis = this.chunksPerAxis;
      this.fullCellsPerAxis = this.cellsPerAxis;
    }
    this.fullGridN = this.fullCellsPerAxis + 1;
    this.octreeDepth = Math.max(
      1,
      Math.ceil(Math.log2(Math.max(2, this.fullChunksPerAxis))),
    );
  }

  private buildAnalyticalContext(cfg: PlanetSeedConfig): AnalyticalContext {
    seedNoise(cfg.seed);

    let rng = (cfg.seed ^ 0x9e3779b9) >>> 0;
    const rand = () => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return rng / 4294967296;
    };

    const seedOffX = (rand() - 0.5) * 90;
    const seedOffY = (rand() - 0.5) * 90;
    const seedOffZ = (rand() - 0.5) * 90;
    const iceLatThresh = 0.72 + rand() * 0.2;
    const sandBias = -0.26 + rand() * 0.28;

    const rScale = cfg.radius / 13.0;

    // Seed-driven spawn direction (temperate/varied biomes across different seeds)
    let spawnDir: [number, number, number];
    if (cfg.seed === 202611) {
      spawnDir = [0.0, 0.94, 0.34];
    } else {
      const sy = (rand() - 0.45) * 1.45; // bias away from extreme poles unless randomly hit
      const clampedY = clamp(sy, -0.88, 0.88);
      const rXZ = Math.sqrt(Math.max(0.01, 1 - clampedY * clampedY));
      const phi = rand() * Math.PI * 2;
      spawnDir = [Math.cos(phi) * rXZ, clampedY, Math.sin(phi) * rXZ];
    }
    const sLen = Math.hypot(spawnDir[0], spawnDir[1], spawnDir[2]) || 1;
    spawnDir[0] /= sLen;
    spawnDir[1] /= sLen;
    spawnDir[2] /= sLen;

    // Orthonormal tangent frame around spawnDir so crater #0 & arch sit in scenic view per seed
    const refAxis: [number, number, number] =
      Math.abs(spawnDir[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
    let t1x = refAxis[1] * spawnDir[2] - refAxis[2] * spawnDir[1];
    let t1y = refAxis[2] * spawnDir[0] - refAxis[0] * spawnDir[2];
    let t1z = refAxis[0] * spawnDir[1] - refAxis[1] * spawnDir[0];
    const t1Len = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= t1Len; t1y /= t1Len; t1z /= t1Len;
    const t2x = spawnDir[1] * t1z - spawnDir[2] * t1y;
    const t2y = spawnDir[2] * t1x - spawnDir[0] * t1z;
    const t2z = spawnDir[0] * t1y - spawnDir[1] * t1x;

    const effectiveCraters = Math.min(cfg.craterCount, 48);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const phaseOffset = rand() * Math.PI * 2;
    const craters: Array<{ x: number; y: number; z: number; rad: number; depth: number }> = [];
    for (let i = 0; i < effectiveCraters; i++) {
      let bx: number;
      let by: number;
      let bz: number;
      let brad: number;
      if (i === 0) {
        // Place primary scenic lake crater ~32-52 deg from spawn at a seed-varied azimuth
        const ang = phaseOffset;
        const tilt = 0.56 + rand() * 0.28;
        const cosT = Math.cos(tilt);
        const sinT = Math.sin(tilt);
        bx = spawnDir[0] * cosT + (t1x * Math.cos(ang) + t2x * Math.sin(ang)) * sinT;
        by = spawnDir[1] * cosT + (t1y * Math.cos(ang) + t2y * Math.sin(ang)) * sinT;
        bz = spawnDir[2] * cosT + (t1z * Math.cos(ang) + t2z * Math.sin(ang)) * sinT;
        brad = 0.42 + rand() * 0.12;
      } else {
        const y = 1 - ((i - 0.5) / Math.max(1, effectiveCraters)) * 2;
        const rAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = goldenAngle * i + phaseOffset + (rand() - 0.5) * 0.85;
        bx = Math.cos(theta) * rAtY;
        by = y;
        bz = Math.sin(theta) * rAtY;
        brad = 0.28 + rand() * 0.18;
      }
      const len = Math.hypot(bx, by, bz) || 1;
      const rSurf = cfg.radius * 0.99;
      craters.push({
        x: (bx / len) * rSurf,
        y: (by / len) * rSurf,
        z: (bz / len) * rSurf,
        rad: cfg.radius * brad,
        depth: cfg.craterDepth * (i === 0 ? 1.05 : 0.85 + rand() * 0.28),
      });
    }

    // Place natural rock arch ~25-36 deg away from spawn in a distinct azimuth
    const archAz = phaseOffset + 1.65 + (rand() - 0.5) * 0.9;
    const archTilt = 0.44 + rand() * 0.16;
    const archCos = Math.cos(archTilt);
    const archSin = Math.sin(archTilt);
    const adx = spawnDir[0] * archCos + (t1x * Math.cos(archAz) + t2x * Math.sin(archAz)) * archSin;
    const ady = spawnDir[1] * archCos + (t1y * Math.cos(archAz) + t2y * Math.sin(archAz)) * archSin;
    const adz = spawnDir[2] * archCos + (t1z * Math.cos(archAz) + t2z * Math.sin(archAz)) * archSin;
    const adLen = Math.hypot(adx, ady, adz) || 1;
    const archDir: [number, number, number] = [adx / adLen, ady / adLen, adz / adLen];

    const archRef: [number, number, number] =
      Math.abs(archDir[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
    let asx = archRef[1] * archDir[2] - archRef[2] * archDir[1];
    let asy = archRef[2] * archDir[0] - archRef[0] * archDir[2];
    let asz = archRef[0] * archDir[1] - archRef[1] * archDir[0];
    const asLen = Math.hypot(asx, asy, asz) || 1;
    asx /= asLen; asy /= asLen; asz /= asLen;
    const archSpan: [number, number, number] = [asx, asy, asz];
    const archBinorm: [number, number, number] = [
      archDir[1] * asz - archDir[2] * asy,
      archDir[2] * asx - archDir[0] * asz,
      archDir[0] * asy - archDir[1] * asx,
    ];

    const ctx: AnalyticalContext = {
      cfg,
      rScale,
      seedOffX,
      seedOffY,
      seedOffZ,
      iceLatThresh,
      sandBias,
      craters,
      spawnDir,
      spawnBaseR: this.baseRadius + 0.8 * rScale,
      archCenter: [
        archDir[0] * cfg.radius * 0.96,
        archDir[1] * cfg.radius * 0.96,
        archDir[2] * cfg.radius * 0.96,
      ],
      archDir,
      archSpan,
      archBinorm,
      crystalThreshInner: 0.86 - cfg.crystalRichness * 0.32,
      crystalThreshMid: 0.90 - cfg.crystalRichness * 0.30,
      detailLogScale: Math.max(0, Math.log2(Math.max(18, cfg.voxelRadius) / 18)),
    };

    // Sample actual unflattened terrain radius at spawnDir & archDir so spawn blends naturally
    this.genCtx = ctx;
    const spawnRawR = this.evalUnflattenedRadius(spawnDir[0], spawnDir[1], spawnDir[2]);
    ctx.spawnBaseR = Math.max(cfg.radius * 0.72, spawnRawR);

    const archSurfR = this.evalUnflattenedRadius(archDir[0], archDir[1], archDir[2]);
    ctx.archCenter = [
      archDir[0] * (archSurfR - 0.15 * rScale),
      archDir[1] * (archSurfR - 0.15 * rScale),
      archDir[2] * (archSurfR - 0.15 * rScale),
    ];

    return ctx;
  }

  private evalUnflattenedRadius(nx: number, ny: number, nz: number): number {
    const { cfg, rScale, seedOffX, seedOffY, seedOffZ, craters } = this.genCtx;
    const wx = nx * this.baseRadius;
    const wy = ny * this.baseRadius;
    const wz = nz * this.baseRadius;
    const wxN = wx / rScale;
    const wyN = wy / rScale;
    const wzN = wz / rScale;

    const continent = fbm3D(
      nx * 1.45 + seedOffX * 0.08,
      ny * 1.45 + seedOffY * 0.08,
      nz * 1.45 + seedOffZ * 0.08,
      4,
    );
    const ridge = ridged3D(
      nx * cfg.ridgeFreq + 5.1 + seedOffX * 0.11,
      ny * cfg.ridgeFreq + seedOffY * 0.11,
      nz * cfg.ridgeFreq - 3.2 + seedOffZ * 0.11,
      3,
    );
    const micro =
      fbm3D(wxN * 0.22 + seedOffX * 0.05, wyN * 0.22 + seedOffY * 0.05, wzN * 0.22 + seedOffZ * 0.05, 2) *
      0.42 *
      rScale;

    let targetRadius =
      this.baseRadius +
      continent * cfg.continentAmp * rScale +
      (ridge - 0.38) * cfg.ridgeAmp * rScale +
      micro;

    for (let c = 0; c < craters.length; c++) {
      const cr = craters[c];
      const dist = Math.hypot(wx - cr.x, wy - cr.y, wz - cr.z);
      if (dist < cr.rad) {
        const t = 1 - smoothstep(cr.rad * 0.22, cr.rad, dist);
        targetRadius -= t * cr.depth * rScale;
      }
    }
    return targetRadius;
  }

  /**
   * Pure analytical SDF + geological material evaluation at any continuous world position (wx, wy, wz).
   * Enables O(1) lazy chunk streaming for tens-of-thousands-of-blocks resolution worlds.
   */
  public evalAnalyticalAt(
    wx: number,
    wy: number,
    wz: number,
    includeMicroDetail = true,
  ): { density: number; material: MaterialId } {
    const {
      cfg,
      rScale,
      seedOffX,
      seedOffY,
      seedOffZ,
      iceLatThresh,
      sandBias,
      craters,
      spawnDir,
      spawnBaseR,
      archCenter,
      archDir,
      archSpan,
      archBinorm,
      crystalThreshInner,
      crystalThreshMid,
      detailLogScale,
    } = this.genCtx;

    const r = Math.hypot(wx, wy, wz);
    const nx = r > 1e-6 ? wx / r : 0;
    const ny = r > 1e-6 ? wy / r : 1;
    const nz = r > 1e-6 ? wz / r : 0;

    const wxN = wx / rScale;
    const wyN = wy / rScale;
    const wzN = wz / rScale;

    const continent = fbm3D(
      nx * 1.45 + seedOffX * 0.08,
      ny * 1.45 + seedOffY * 0.08,
      nz * 1.45 + seedOffZ * 0.08,
      4,
    );
    const ridge = ridged3D(
      nx * cfg.ridgeFreq + 5.1 + seedOffX * 0.11,
      ny * cfg.ridgeFreq + seedOffY * 0.11,
      nz * cfg.ridgeFreq - 3.2 + seedOffZ * 0.11,
      3,
    );
    const micro =
      fbm3D(
        wxN * 0.22 + seedOffX * 0.05,
        wyN * 0.22 + seedOffY * 0.05,
        wzN * 0.22 + seedOffZ * 0.05,
        2,
      ) *
      0.42 *
      rScale;

    let targetRadius =
      this.baseRadius +
      continent * cfg.continentAmp * rScale +
      (ridge - 0.38) * cfg.ridgeAmp * rScale +
      micro;

    // Multi-octave high-resolution terrain terraces & cliff relief when voxelRadius >> 18
    if (includeMicroDetail && detailLogScale > 0.3) {
      const fineAmp = Math.min(0.24, detailLogScale * 0.032) * rScale;
      const fineWave = fbm3D(wxN * 1.85 + seedOffX, wyN * 1.85 + seedOffY, wzN * 1.85 + seedOffZ, 2) * fineAmp;
      targetRadius += fineWave;
      if (detailLogScale > 2.2) {
        const blockWaveFreq = 1 / Math.max(this.nativeVoxelSize * 14, 1e-12);
        const bx = (((wx * blockWaveFreq) % 256) + 256) % 256;
        const by = (((wy * blockWaveFreq) % 256) + 256) % 256;
        const bz = (((wz * blockWaveFreq) % 256) + 256) % 256;
        const blockRelief =
          fbm3D(bx + seedOffX, by + seedOffY, bz + seedOffZ, 2, 2.0, 0.5) *
          this.nativeVoxelSize *
          2.6;
        targetRadius += blockRelief;
      }
    }

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

    // Small landing pad gently blended toward actual local terrain elevation at spawnDir
    const dotSpawn = nx * spawnDir[0] + ny * spawnDir[1] + nz * spawnDir[2];
    if (dotSpawn > 0.968) {
      const flatBlend = smoothstep(0.968, 0.994, dotSpawn);
      targetRadius = targetRadius * (1 - flatBlend) + spawnBaseR * flatBlend;
    }

    let d = targetRadius - r;

    const caveMinR = cfg.radius * 0.28;
    const caveMaxR = cfg.radius * 0.72;
    if (cfg.caveDensity > 0.01 && r > caveMinR && r < caveMaxR) {
      const caveNoise = fbm3D(
        wxN * 0.19 + 11.3 + seedOffX * 0.07,
        wyN * 0.19 + seedOffY * 0.07,
        wzN * 0.19 + seedOffZ * 0.07,
        3,
      );
      const shellWeight =
        smoothstep(caveMinR, caveMinR + 1.4 * rScale, r) *
        (1 - smoothstep(caveMaxR - 1.4 * rScale, caveMaxR, r));
      if (caveNoise > 0.18) {
        d -= (caveNoise - 0.18) * 13.5 * cfg.caveDensity * shellWeight * rScale;
      }
    }

    if (cfg.hasArch) {
      const adx = (wx - archCenter[0]) / rScale;
      const ady = (wy - archCenter[1]) / rScale;
      const adz = (wz - archCenter[2]) / rScale;
      if (adx * adx + ady * ady + adz * adz < 16.0) {
        const h = adx * archDir[0] + ady * archDir[1] + adz * archDir[2];
        const px = adx - h * archDir[0];
        const py = ady - h * archDir[1];
        const pz = adz - h * archDir[2];
        const spanCoord = px * archSpan[0] + py * archSpan[1] + pz * archSpan[2];
        const perpCoord = px * archBinorm[0] + py * archBinorm[1] + pz * archBinorm[2];
        const torusMajor = Math.hypot(spanCoord, h) - 2.2;
        const torusDist = Math.hypot(torusMajor, perpCoord);
        if (torusDist < 1.15 && h > -0.35) {
          d = Math.max(d, (1.05 - torusDist) * rScale);
        }
      }
    }

    const edgeMargin =
      this.worldHalf * 0.94 - Math.max(Math.abs(wx), Math.abs(wy), Math.abs(wz));
    if (edgeMargin < 0) {
      d = Math.min(d, edgeMargin * 2.0 - 0.5 * rScale);
    }

    if (d <= 0) {
      return { density: d, material: MaterialId.Air };
    }

    const absLat = Math.abs(ny);
    const crystalVein = ridged3D(
      wxN * 0.28 + seedOffX * 0.04,
      wyN * 0.28 + seedOffY * 0.04,
      wzN * 0.28 + seedOffZ * 0.04,
      2,
    );
    let mat: MaterialId;
    if (r < cfg.radius * 0.49) {
      mat = crystalVein > crystalThreshInner ? MaterialId.Crystal : MaterialId.Basalt;
    } else if (r < cfg.radius * 0.81) {
      mat = crystalVein > crystalThreshMid ? MaterialId.Crystal : MaterialId.Stone;
    } else if (absLat > iceLatThresh && r > this.baseRadius + 0.65 * rScale) {
      mat = MaterialId.Ice;
    } else if (r > this.baseRadius + 1.85 * rScale) {
      mat = MaterialId.Stone;
    } else if (inCraterRim || continent < sandBias) {
      mat = MaterialId.Sandstone;
    } else {
      mat = MaterialId.Soil;
    }

    return { density: d, material: mat };
  }

  private getRadialEvalBounds(): { minEvalR: number; maxSurfR: number; rScale: number } {
    const { cfg, rScale } = this.genCtx;
    const terrainSpread =
      Math.abs(cfg.continentAmp) +
      Math.abs(cfg.ridgeAmp) +
      Math.abs(cfg.craterDepth);
    const minSurfR = Math.max(0, Math.min(cfg.radius * 0.88, cfg.radius - (terrainSpread * 1.35 + 2.2) * rScale));
    const minEvalR =
      cfg.caveDensity > 0.01 ? Math.min(minSurfR, cfg.radius * 0.24) : minSurfR;
    const maxSurfR =
      cfg.radius +
      (Math.abs(cfg.continentAmp) * 1.25 +
        Math.abs(cfg.ridgeAmp) * 1.1 +
        (cfg.hasArch ? 3.8 : 1.8)) *
        rScale;
    return { minEvalR, maxSurfR, rScale };
  }

  private computeChunkEvalMask(): Uint8Array {
    const cpa = this.chunksPerAxis;
    const total = this.totalChunks;
    const needEval = new Uint8Array(total);
    const evalWithHalo = new Uint8Array(total);

    if (cpa <= 8) {
      evalWithHalo.fill(1);
      return evalWithHalo;
    }

    const { cfg, rScale, seedOffX, seedOffY, seedOffZ, archCenter } = this.genCtx;
    const { minEvalR, maxSurfR } = this.getRadialEvalBounds();
    const chunkSpan = CHUNK_CELLS * this.voxelSize;
    const halfDiag = chunkSpan * 0.8660254;
    const surfMargin =
      halfDiag * (1.85 + Math.min(1.5, Math.abs(cfg.ridgeAmp) * 0.1 + Math.abs(cfg.craterDepth) * 0.06));
    const caveMinR = cfg.radius * 0.28;
    const caveMaxR = cfg.radius * 0.72;
    const hasCaves = cfg.caveDensity > 0.01;
    const archRadSq = (4.4 * rScale + halfDiag) * (4.4 * rScale + halfDiag);

    for (let cz = 0; cz < cpa; cz++) {
      const cwz = this.gridToWorld(cz * CHUNK_CELLS) + chunkSpan * 0.5;
      for (let cy = 0; cy < cpa; cy++) {
        const cwy = this.gridToWorld(cy * CHUNK_CELLS) + chunkSpan * 0.5;
        for (let cx = 0; cx < cpa; cx++) {
          const cwx = this.gridToWorld(cx * CHUNK_CELLS) + chunkSpan * 0.5;
          const cr = Math.hypot(cwx, cwy, cwz);
          if (cr > maxSurfR + halfDiag * 1.2 || cr < minEvalR - halfDiag * 1.2) {
            continue;
          }

          const centerRes = this.evalAnalyticalAt(cwx, cwy, cwz, true);
          let active = Math.abs(centerRes.density) <= surfMargin;

          if (!active && cfg.hasArch) {
            const adx = cwx - archCenter[0];
            const ady = cwy - archCenter[1];
            const adz = cwz - archCenter[2];
            if (adx * adx + ady * ady + adz * adz <= archRadSq) {
              active = true;
            }
          }

          if (!active && hasCaves && cr >= caveMinR - halfDiag && cr <= caveMaxR + halfDiag) {
            if (centerRes.density <= halfDiag * 3.8) {
              active = true;
            } else {
              const caveNoise = fbm3D(
                (cwx / rScale) * 0.19 + 11.3 + seedOffX * 0.07,
                (cwy / rScale) * 0.19 + seedOffY * 0.07,
                (cwz / rScale) * 0.19 + seedOffZ * 0.07,
                3,
              );
              if (caveNoise > 0.14 - 0.35 * (halfDiag / Math.max(rScale, 1e-4))) {
                active = true;
              }
            }
          }

          if (active) {
            needEval[this.chunkIndex(cx, cy, cz)] = 1;
          }
        }
      }
    }

    // Dilate active surface chunks by 1-chunk halo so shared boundary vertices match seamlessly
    for (let cz = 0; cz < cpa; cz++) {
      for (let cy = 0; cy < cpa; cy++) {
        for (let cx = 0; cx < cpa; cx++) {
          if (needEval[this.chunkIndex(cx, cy, cz)] === 0) continue;
          const z0 = Math.max(0, cz - 1);
          const z1 = Math.min(cpa - 1, cz + 1);
          const y0 = Math.max(0, cy - 1);
          const y1 = Math.min(cpa - 1, cy + 1);
          const x0 = Math.max(0, cx - 1);
          const x1 = Math.min(cpa - 1, cx + 1);
          for (let nz = z0; nz <= z1; nz++) {
            for (let ny = y0; ny <= y1; ny++) {
              for (let nx = x0; nx <= x1; nx++) {
                evalWithHalo[this.chunkIndex(nx, ny, nz)] = 1;
              }
            }
          }
        }
      }
    }

    return evalWithHalo;
  }

  public generatePlanet(seedOrConfig: number | Partial<PlanetSeedConfig> = 202611): void {
    const raw: Partial<PlanetSeedConfig> =
      typeof seedOrConfig === 'number'
        ? { ...DEFAULT_SEED_CONFIG, seed: seedOrConfig }
        : seedOrConfig;

    const cfg = sanitizeSeedConfig(raw);
    this.seedConfig = cfg;
    this.updateBoundsForRadius(cfg.radius, cfg.voxelRadius);
    this.sparseChunks.clear();
    this.genCtx = this.buildAnalyticalContext(cfg);
    this.lakeBasinCenters = this.genCtx.craters
      .slice(0, 3)
      .map((c) => [c.x, c.y, c.z]);

    const gridN = this.gridN;
    const cpa = this.chunksPerAxis;
    const { minEvalR, maxSurfR, rScale } = this.getRadialEvalBounds();
    const edgeClip = this.worldHalf * 0.94;
    const includeMicro = !this.isHighResStreaming || this.gridN <= 64;
    const evalMask = this.computeChunkEvalMask();

    for (let iz = 0; iz < gridN; iz++) {
      const wz = this.gridToWorld(iz);
      const az = Math.abs(wz);
      const wz2 = wz * wz;
      const czBase = Math.min(cpa - 1, iz >> 3) * cpa * cpa;
      for (let iy = 0; iy < gridN; iy++) {
        const wy = this.gridToWorld(iy);
        const ayz = Math.max(az, Math.abs(wy));
        const wyz2 = wz2 + wy * wy;
        const cyzBase = czBase + Math.min(cpa - 1, iy >> 3) * cpa;
        for (let ix = 0; ix < gridN; ix++) {
          const wx = this.gridToWorld(ix);
          const idx = this.gridIndex(ix, iy, iz);
          const ci = cyzBase + Math.min(cpa - 1, ix >> 3);
          const r = Math.sqrt(wx * wx + wyz2);
          if (evalMask[ci] === 0 || r > maxSurfR || r < minEvalR) {
            let d = cfg.radius - r;
            if (d <= 0 || r > maxSurfR) {
              const em = edgeClip - Math.max(ayz, Math.abs(wx));
              if (em < 0) d = Math.min(d, em * 2.0 - 0.5 * rScale);
              this.density[idx] = d;
              this.material[idx] = d > 0 ? (r < cfg.radius * 0.49 ? MaterialId.Basalt : MaterialId.Stone) : MaterialId.Air;
            } else {
              this.density[idx] = d;
              this.material[idx] =
                r < cfg.radius * 0.49 ? MaterialId.Basalt : MaterialId.Stone;
            }
          } else {
            const evalRes = this.evalAnalyticalAt(wx, wy, wz, includeMicro);
            this.density[idx] = evalRes.density;
            this.material[idx] = evalRes.material;
          }
        }
      }
    }

    this.nonUniformChunks.set(evalMask);

    const spawnDir = this.genCtx.spawnDir;
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
    this.hasGenerated = true;
    this.voxelRevision++;
  }

  public async generatePlanetAsync(
    seedOrConfig: number | Partial<PlanetSeedConfig> = 202611,
    onProgress?: (fraction: number, detail: string) => void,
    shouldAbort?: () => boolean,
  ): Promise<boolean> {
    const raw: Partial<PlanetSeedConfig> =
      typeof seedOrConfig === 'number'
        ? { ...DEFAULT_SEED_CONFIG, seed: seedOrConfig }
        : seedOrConfig;

    const cfg = sanitizeSeedConfig(raw);
    this.seedConfig = cfg;
    this.updateBoundsForRadius(cfg.radius, cfg.voxelRadius);
    this.sparseChunks.clear();
    this.genCtx = this.buildAnalyticalContext(cfg);
    this.lakeBasinCenters = this.genCtx.craters
      .slice(0, 3)
      .map((c) => [c.x, c.y, c.z]);

    onProgress?.(0.02, '初始化星球参数与表面分块掩码');

    const gridN = this.gridN;
    const cpa = this.chunksPerAxis;
    const { minEvalR, maxSurfR, rScale } = this.getRadialEvalBounds();
    const edgeClip = this.worldHalf * 0.94;
    const includeMicro = !this.isHighResStreaming || this.gridN <= 64;
    const evalMask = this.computeChunkEvalMask();
    let sliceStart = performance.now();

    for (let iz = 0; iz < gridN; iz++) {
      if (shouldAbort?.()) return false;
      const wz = this.gridToWorld(iz);
      const az = Math.abs(wz);
      const wz2 = wz * wz;
      const czBase = Math.min(cpa - 1, iz >> 3) * cpa * cpa;
      for (let iy = 0; iy < gridN; iy++) {
        const wy = this.gridToWorld(iy);
        const ayz = Math.max(az, Math.abs(wy));
        const wyz2 = wz2 + wy * wy;
        const cyzBase = czBase + Math.min(cpa - 1, iy >> 3) * cpa;
        for (let ix = 0; ix < gridN; ix++) {
          const wx = this.gridToWorld(ix);
          const idx = this.gridIndex(ix, iy, iz);
          const ci = cyzBase + Math.min(cpa - 1, ix >> 3);
          const r = Math.sqrt(wx * wx + wyz2);
          if (evalMask[ci] === 0 || r > maxSurfR || r < minEvalR) {
            let d = cfg.radius - r;
            if (d <= 0 || r > maxSurfR) {
              const em = edgeClip - Math.max(ayz, Math.abs(wx));
              if (em < 0) d = Math.min(d, em * 2.0 - 0.5 * rScale);
              this.density[idx] = d;
              this.material[idx] = d > 0 ? (r < cfg.radius * 0.49 ? MaterialId.Basalt : MaterialId.Stone) : MaterialId.Air;
            } else {
              this.density[idx] = d;
              this.material[idx] =
                r < cfg.radius * 0.49 ? MaterialId.Basalt : MaterialId.Stone;
            }
          } else {
            const evalRes = this.evalAnalyticalAt(wx, wy, wz, includeMicro);
            this.density[idx] = evalRes.density;
            this.material[idx] = evalRes.material;
          }
        }
      }

      if (performance.now() - sliceStart >= 8 || iz === gridN - 1) {
        onProgress?.(
          0.04 + 0.92 * ((iz + 1) / gridN),
          `体素密度场采样 ${iz + 1}/${gridN} (${this.cellsPerAxis}³)`,
        );
        if (iz < gridN - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          sliceStart = performance.now();
        }
      }
    }

    this.nonUniformChunks.set(evalMask);

    if (shouldAbort?.()) return false;

    const spawnDir = this.genCtx.spawnDir;
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
    this.hasGenerated = true;
    this.voxelRevision++;
    onProgress?.(1.0, '体素场构建完成');
    return true;
  }

  public exportSnapshot(): VoxelPlanetSnapshot {
    const editedChunks: SparseChunkSnapshot[] = [];
    for (const chunk of this.sparseChunks.values()) {
      if (chunk.edited) {
        editedChunks.push({
          key: chunk.key,
          cx: chunk.cx,
          cy: chunk.cy,
          cz: chunk.cz,
          scaleMult: chunk.scaleMult,
          density: new Float32Array(chunk.density),
          material: new Uint8Array(chunk.material),
        });
      }
    }
    return {
      seedConfig: { ...this.seedConfig },
      density: new Float32Array(this.density),
      material: new Uint8Array(this.material),
      spawnPosition: [...this.spawnPosition] as [number, number, number],
      lakeBasinCenters: this.lakeBasinCenters.map((c) => [...c] as [number, number, number]),
      editedChunks: editedChunks.length > 0 ? editedChunks : undefined,
    };
  }

  public importSnapshot(snapshot: VoxelPlanetSnapshot): void {
    const snapGridN = Math.round(Math.cbrt(snapshot.density.length));
    if (
      snapGridN < 9 ||
      snapGridN * snapGridN * snapGridN !== snapshot.density.length ||
      snapshot.material.length !== snapshot.density.length ||
      (snapGridN - 1) % CHUNK_CELLS !== 0
    ) {
      throw new Error('Incompatible voxel grid dimensions in snapshot');
    }
    this.seedConfig = sanitizeSeedConfig(snapshot.seedConfig);
    this.updateBoundsForRadius(this.seedConfig.radius, this.seedConfig.voxelRadius);
    this.resizeGridForChunks((snapGridN - 1) / CHUNK_CELLS);
    this.voxelSize = (this.worldHalf * 2) / this.cellsPerAxis;
    this.genCtx = this.buildAnalyticalContext(this.seedConfig);
    this.sparseChunks.clear();
    if (snapshot.editedChunks) {
      for (const sc of snapshot.editedChunks) {
        const stepSize = this.nativeVoxelSize * sc.scaleMult;
        const chunkSpan = CHUNK_CELLS * stepSize;
        this.sparseChunks.set(sc.key, {
          key: sc.key,
          cx: sc.cx,
          cy: sc.cy,
          cz: sc.cz,
          scaleMult: sc.scaleMult,
          stepSize,
          originX: sc.cx * chunkSpan,
          originY: sc.cy * chunkSpan,
          originZ: sc.cz * chunkSpan,
          density: new Float32Array(sc.density),
          material: new Uint8Array(sc.material),
          edited: true,
          dirty: true,
          lastUsedFrame: this.streamFrame,
        });
      }
    }
    this.density.set(snapshot.density);
    this.material.set(snapshot.material);
    this.spawnPosition = [...snapshot.spawnPosition] as [number, number, number];
    this.lakeBasinCenters = snapshot.lakeBasinCenters.map(
      (c) => [...c] as [number, number, number],
    );
    const cpa = this.chunksPerAxis;
    const sY = this.gridN;
    const sZ = sY * sY;
    this.nonUniformChunks.fill(0);
    for (let cz = 0; cz < cpa; cz++) {
      const sz = cz * CHUNK_CELLS;
      for (let cy = 0; cy < cpa; cy++) {
        const sy = cy * CHUNK_CELLS;
        for (let cx = 0; cx < cpa; cx++) {
          const sx = cx * CHUNK_CELLS;
          let anyS = false;
          let anyA = false;
          for (let dz = 0; dz <= CHUNK_CELLS; dz++) {
            const bz = (sz + dz) * sZ;
            for (let dy = 0; dy <= CHUNK_CELLS; dy++) {
              const byz = bz + (sy + dy) * sY + sx;
              for (let dx = 0; dx <= CHUNK_CELLS; dx++) {
                if (this.density[byz + dx] > 0) anyS = true;
                else anyA = true;
                if (anyS && anyA) break;
              }
              if (anyS && anyA) break;
            }
            if (anyS && anyA) break;
          }
          if (anyS && anyA) {
            this.nonUniformChunks[this.chunkIndex(cx, cy, cz)] = 1;
          }
        }
      }
    }
    this.dirtyChunks.fill(1);
    this.hasGenerated = true;
    this.voxelRevision++;
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
    let sparseBytes = 0;
    for (const c of this.sparseChunks.values()) {
      sparseBytes += c.density.byteLength + c.material.byteLength;
    }
    const virtualCellsPerAxis = Math.max(
      this.cellsPerAxis,
      Math.round(this.voxelRadius * 2 * 1.54),
    );
    return {
      gridN: this.gridN,
      cellsPerAxis: this.cellsPerAxis,
      chunkCells: CHUNK_CELLS,
      chunksPerAxis: this.chunksPerAxis,
      totalVoxels: n,
      totalCells: this.cellsPerAxis * this.cellsPerAxis * this.cellsPerAxis,
      totalChunks: this.totalChunks,
      voxelSize: this.voxelSize,
      worldHalf: this.worldHalf,
      densityBytes,
      materialBytes,
      totalBytes: densityBytes + materialBytes + this.dirtyChunks.byteLength + sparseBytes,
      solidVoxels: solid,
      materialCounts: counts,
      voxelRadius: this.voxelRadius,
      nativeVoxelSize: this.nativeVoxelSize,
      virtualCellsPerAxis: this.fullCellsPerAxis,
      fullCellsPerAxis: this.fullCellsPerAxis,
      fullChunksPerAxis: this.fullChunksPerAxis,
      fullGridN: this.fullGridN,
      octreeDepth: this.octreeDepth,
      fullTotalVoxelsLabel: formatVoxelCountLabel(this.fullCellsPerAxis),
      sparseActiveChunks: this.sparseChunks.size,
      isSparseStreaming: this.isHighResStreaming,
    };
  }

  public probeVoxelCell(wx: number, wy: number, wz: number): VoxelCellProbe {
    const cellsPerAxis = this.cellsPerAxis;
    const chunksPerAxis = this.chunksPerAxis;
    const gx = clamp(this.worldToGrid(wx), 0, cellsPerAxis - 0.001);
    const gy = clamp(this.worldToGrid(wy), 0, cellsPerAxis - 0.001);
    const gz = clamp(this.worldToGrid(wz), 0, cellsPerAxis - 0.001);

    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.floor(gz);

    const cx = clamp(Math.floor(ix / CHUNK_CELLS), 0, chunksPerAxis - 1);
    const cy = clamp(Math.floor(iy / CHUNK_CELLS), 0, chunksPerAxis - 1);
    const cz = clamp(Math.floor(iz / CHUNK_CELLS), 0, chunksPerAxis - 1);

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
      const sz = clamp(iz + dz, 0, cellsPerAxis);
      for (let dx = -2; dx <= 2; dx++) {
        const sx = clamp(ix + dx, 0, cellsPerAxis);
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
    let prevR = startR;
    if (this.sampleDensity(dx * prevR, dy * prevR, dz * prevR) >= 0) {
      return prevR;
    }
    for (let r = startR - stepR; r >= minR; r -= stepR) {
      const val = this.sampleDensity(dx * r, dy * r, dz * r);
      if (val >= 0) {
        if (!this.isHighResStreaming) return r;
        let loAir = prevR;
        let hiSolid = r;
        for (let b = 0; b < 28; b++) {
          const mid = 0.5 * (loAir + hiSolid);
          if (this.sampleDensity(dx * mid, dy * mid, dz * mid) >= 0) {
            hiSolid = mid;
          } else {
            loAir = mid;
          }
        }
        return 0.5 * (loAir + hiSolid);
      }
      prevR = r;
    }
    return this.baseRadius;
  }

  public sampleSparseDensity(wx: number, wy: number, wz: number): number | null {
    if (!this.isHighResStreaming || this.sparseChunks.size === 0) return null;
    const chunkSpan = CHUNK_CELLS * this.nativeVoxelSize;
    const cx = Math.floor(wx / chunkSpan);
    const cy = Math.floor(wy / chunkSpan);
    const cz = Math.floor(wz / chunkSpan);
    const chunk = this.sparseChunks.get(`1:${cx},${cy},${cz}`);
    if (!chunk) return null;

    const step = chunk.stepSize;
    const gx = (wx - chunk.originX) / step + SPARSE_PAD;
    const gy = (wy - chunk.originY) / step + SPARSE_PAD;
    const gz = (wz - chunk.originZ) / step + SPARSE_PAD;
    if (
      gx < 0 ||
      gy < 0 ||
      gz < 0 ||
      gx >= SPARSE_N - 1 ||
      gy >= SPARSE_N - 1 ||
      gz >= SPARSE_N - 1
    ) {
      return null;
    }

    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fy = gy - iy;
    const fz = gz - iz;
    const base = ix + iy * SPARSE_NY + iz * SPARSE_NZ;
    const d = chunk.density;

    const c000 = d[base];
    const c100 = d[base + 1];
    const c010 = d[base + SPARSE_NY];
    const c110 = d[base + SPARSE_NY + 1];
    const c001 = d[base + SPARSE_NZ];
    const c101 = d[base + SPARSE_NZ + 1];
    const c011 = d[base + SPARSE_NZ + SPARSE_NY];
    const c111 = d[base + SPARSE_NZ + SPARSE_NY + 1];

    const x00 = c000 + (c100 - c000) * fx;
    const x10 = c010 + (c110 - c010) * fx;
    const x01 = c001 + (c101 - c001) * fx;
    const x11 = c011 + (c111 - c011) * fx;
    const y0 = x00 + (x10 - x00) * fy;
    const y1 = x01 + (x11 - x01) * fy;
    return y0 + (y1 - y0) * fz;
  }

  /**
   * Fast trilinear interpolation of voxel scalar density at world position (x,y,z).
   * In high-res SVO mode, refines near-surface queries analytically so raycasts, explorer
   * footing, and surface focus locks match 1:1 native blocks to sub-nanometer precision.
   */
  public sampleDensity(
    wx: number,
    wy: number,
    wz: number,
    fastMacro = false,
  ): number {
    if (this.isHighResStreaming && this.sparseChunks.size > 0) {
      const sparseD = this.sampleSparseDensity(wx, wy, wz);
      if (sparseD !== null) return sparseD;
    }

    const gx = this.worldToGrid(wx);
    const gy = this.worldToGrid(wy);
    const gz = this.worldToGrid(wz);

    const cellsPerAxis = this.cellsPerAxis;
    if (
      gx < 0 ||
      gy < 0 ||
      gz < 0 ||
      gx >= cellsPerAxis ||
      gy >= cellsPerAxis ||
      gz >= cellsPerAxis
    ) {
      return -2.0;
    }

    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fy = gy - iy;
    const fz = gz - iz;

    const sY = this.gridN;
    const sZ = sY * sY;
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
    const macroD = y0 + (y1 - y0) * fz;

    if (
      !fastMacro &&
      this.isHighResStreaming &&
      this.hasGenerated &&
      Math.abs(macroD) <= this.voxelSize * 2.5
    ) {
      return this.evalAnalyticalAt(wx, wy, wz, true).density;
    }

    return macroD;
  }

  /**
   * Samples scalar density and central-difference outward surface normal (-∇density) at (wx, wy, wz).
   */
  public sampleDensityAndNormal(
    wx: number,
    wy: number,
    wz: number,
    outNormal: [number, number, number],
    fastMacro = false,
  ): number {
    const val = this.sampleDensity(wx, wy, wz, fastMacro);
    const eps =
      !fastMacro && this.isHighResStreaming
        ? Math.max(this.nativeVoxelSize * 0.65, 1e-9)
        : this.voxelSize * 0.65;
    const dx =
      this.sampleDensity(wx - eps, wy, wz, fastMacro) -
      this.sampleDensity(wx + eps, wy, wz, fastMacro);
    const dy =
      this.sampleDensity(wx, wy - eps, wz, fastMacro) -
      this.sampleDensity(wx, wy + eps, wz, fastMacro);
    const dz =
      this.sampleDensity(wx, wy, wz - eps, fastMacro) -
      this.sampleDensity(wx, wy, wz + eps, fastMacro);

    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-12) {
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
    if (this.isHighResStreaming) {
      if (this.sparseChunks.size > 0) {
        const chunkSpan = CHUNK_CELLS * this.nativeVoxelSize;
        const cx = Math.floor(wx / chunkSpan);
        const cy = Math.floor(wy / chunkSpan);
        const cz = Math.floor(wz / chunkSpan);
        const chunk = this.sparseChunks.get(`1:${cx},${cy},${cz}`);
        if (chunk) {
          const ix = clamp(
            Math.round((wx - chunk.originX) / chunk.stepSize) + SPARSE_PAD,
            0,
            SPARSE_N - 1,
          );
          const iy = clamp(
            Math.round((wy - chunk.originY) / chunk.stepSize) + SPARSE_PAD,
            0,
            SPARSE_N - 1,
          );
          const iz = clamp(
            Math.round((wz - chunk.originZ) / chunk.stepSize) + SPARSE_PAD,
            0,
            SPARSE_N - 1,
          );
          return chunk.material[ix + iy * SPARSE_NY + iz * SPARSE_NZ] as MaterialId;
        }
      }
      if (this.hasGenerated) {
        return this.evalAnalyticalAt(wx, wy, wz, true).material;
      }
    }

    const cellsPerAxis = this.cellsPerAxis;
    const ix = clamp(Math.round(this.worldToGrid(wx)), 0, cellsPerAxis);
    const iy = clamp(Math.round(this.worldToGrid(wy)), 0, cellsPerAxis);
    const iz = clamp(Math.round(this.worldToGrid(wz)), 0, cellsPerAxis);
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
    const camR = Math.hypot(ox, oy, oz);
    const estSurfDist = Math.abs(camR - this.baseRadius);
    const nearSurface = estSurfDist < this.voxelSize * 3.0;
    const minStep =
      this.isHighResStreaming && nearSurface
        ? Math.max(
            this.nativeVoxelSize * 0.45,
            Math.min(this.voxelSize * 0.25, estSurfDist * 0.06 + this.nativeVoxelSize * 0.5),
          )
        : this.voxelSize * 0.35;
    const maxStep = this.voxelSize * 0.42;
    let prevT = 0;
    let prevD = this.sampleDensity(ox, oy, oz);
    let t = minStep;

    for (let iter = 0; iter < 2048 && t <= maxDist; iter++) {
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      const d = this.sampleDensity(px, py, pz);

      if (d >= 0 && prevD < 0) {
        // Binary search exact isosurface crossing down to sub-voxel precision
        let lo = prevT;
        let hi = t;
        const refineSteps = this.isHighResStreaming ? 28 : 10;
        for (let b = 0; b < refineSteps; b++) {
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
      const adaptiveStep =
        d < 0 ? clamp(-d * 0.32, minStep, maxStep) : minStep;
      t += adaptiveStep;
    }

    return { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, distance: maxDist };
  }

  /**
   * Sculpt, build, smooth, or spherically flatten the planetary voxel field (and active high-res sparse chunks).
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
    const minUnit = this.isHighResStreaming
      ? Math.min(this.voxelSize, this.nativeVoxelSize)
      : this.voxelSize;
    const safeRad = Math.max(minUnit * 0.5, radius);
    const rScale = this.baseRadius / 13.0;
    const pad = safeRad + this.voxelSize * 1.5;
    const cellsPerAxis = this.cellsPerAxis;
    const minX = clamp(Math.floor(this.worldToGrid(cx - pad)), 1, cellsPerAxis - 1);
    const maxX = clamp(Math.ceil(this.worldToGrid(cx + pad)), 1, cellsPerAxis - 1);
    const minY = clamp(Math.floor(this.worldToGrid(cy - pad)), 1, cellsPerAxis - 1);
    const maxY = clamp(Math.ceil(this.worldToGrid(cy + pad)), 1, cellsPerAxis - 1);
    const minZ = clamp(Math.floor(this.worldToGrid(cz - pad)), 1, cellsPerAxis - 1);
    const maxZ = clamp(Math.ceil(this.worldToGrid(cz + pad)), 1, cellsPerAxis - 1);

    const targetShellRadius = Math.hypot(cx, cy, cz);
    let deltaVolume = 0;

    // 1. Update macro grid (attenuate slightly when brush is much smaller than a macro voxel)
    const macroRad = Math.max(safeRad, this.voxelSize * 0.65);
    const macroWeight = clamp(safeRad / (this.voxelSize * 0.65), 0.12, 1.0);
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
          if (dist >= macroRad) continue;

          const falloff = (1 - smoothstep(0, macroRad, dist)) * macroWeight;
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
            const sY = this.gridN;
            const sZ = sY * sY;
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

    // 2. Update sparse high-res chunks when high-res streaming is active
    if (this.isHighResStreaming) {
      const nativeSpan = CHUNK_CELLS * this.nativeVoxelSize;
      const sparsePad = safeRad + this.nativeVoxelSize * 2.0;
      const scMinX = Math.floor((cx - sparsePad) / nativeSpan);
      const scMaxX = Math.floor((cx + sparsePad) / nativeSpan);
      const scMinY = Math.floor((cy - sparsePad) / nativeSpan);
      const scMaxY = Math.floor((cy + sparsePad) / nativeSpan);
      const scMinZ = Math.floor((cz - sparsePad) / nativeSpan);
      const scMaxZ = Math.floor((cz + sparsePad) / nativeSpan);

      const totalTouched =
        (scMaxX - scMinX + 1) * (scMaxY - scMinY + 1) * (scMaxZ - scMinZ + 1);

      const applyBrushToChunk = (chunk: SparseVoxelChunk) => {
        const step = chunk.stepSize;
        const cMinWX = chunk.originX - SPARSE_PAD * step;
        const cMaxWX = chunk.originX + (CHUNK_CELLS + SPARSE_PAD) * step;
        const cMinWY = chunk.originY - SPARSE_PAD * step;
        const cMaxWY = chunk.originY + (CHUNK_CELLS + SPARSE_PAD) * step;
        const cMinWZ = chunk.originZ - SPARSE_PAD * step;
        const cMaxWZ = chunk.originZ + (CHUNK_CELLS + SPARSE_PAD) * step;

        if (
          cx + safeRad < cMinWX ||
          cx - safeRad > cMaxWX ||
          cy + safeRad < cMinWY ||
          cy - safeRad > cMaxWY ||
          cz + safeRad < cMinWZ ||
          cz - safeRad > cMaxWZ
        ) {
          return;
        }

        const localCopy =
          mode === 'smooth' ? new Float32Array(chunk.density) : null;
        let touched = false;
        const strengthScale = Math.max(step * 2.2, Math.min(rScale, safeRad * 1.4));

        for (let lz = 0; lz < SPARSE_N; lz++) {
          const wz = chunk.originZ + (lz - SPARSE_PAD) * step;
          for (let ly = 0; ly < SPARSE_N; ly++) {
            const wy = chunk.originY + (ly - SPARSE_PAD) * step;
            for (let lx = 0; lx < SPARSE_N; lx++) {
              const wx = chunk.originX + (lx - SPARSE_PAD) * step;
              const dist = Math.hypot(wx - cx, wy - cy, wz - cz);
              if (dist >= safeRad) continue;

              const falloff = 1 - smoothstep(0, safeRad, dist);
              const idx = lx + ly * SPARSE_NY + lz * SPARSE_NZ;
              const prev = chunk.density[idx];
              let next = prev;

              if (mode === 'carve') {
                next = Math.max(
                  -4.5 * rScale,
                  prev - strength * strengthScale * falloff,
                );
                if (next <= 0) chunk.material[idx] = MaterialId.Air;
              } else if (mode === 'build') {
                next = Math.min(
                  4.5 * rScale,
                  prev + strength * strengthScale * falloff,
                );
                if (next > -0.25 * step && materialId !== MaterialId.Air) {
                  chunk.material[idx] = materialId;
                }
              } else if (mode === 'flatten') {
                const vr = Math.hypot(wx, wy, wz);
                const desired = targetShellRadius - vr;
                const blend = clamp(falloff * strength * 0.65, 0, 1);
                next = prev + (desired - prev) * blend;
                if (next > 0 && chunk.material[idx] === MaterialId.Air) {
                  chunk.material[idx] = materialId;
                } else if (next <= 0) {
                  chunk.material[idx] = MaterialId.Air;
                }
              } else if (mode === 'smooth' && localCopy) {
                if (
                  lx > 0 &&
                  lx < SPARSE_N - 1 &&
                  ly > 0 &&
                  ly < SPARSE_N - 1 &&
                  lz > 0 &&
                  lz < SPARSE_N - 1
                ) {
                  const avg =
                    (localCopy[idx] * 2 +
                      localCopy[idx - 1] +
                      localCopy[idx + 1] +
                      localCopy[idx - SPARSE_NY] +
                      localCopy[idx + SPARSE_NY] +
                      localCopy[idx - SPARSE_NZ] +
                      localCopy[idx + SPARSE_NZ]) /
                    8;
                  const blend = clamp(falloff * strength * 0.55, 0, 1);
                  next = prev + (avg - prev) * blend;
                  if (next > 0 && chunk.material[idx] === MaterialId.Air) {
                    chunk.material[idx] = MaterialId.Stone;
                  } else if (next <= 0) {
                    chunk.material[idx] = MaterialId.Air;
                  }
                }
              }

              if (next !== prev) {
                chunk.density[idx] = next;
                deltaVolume += next - prev;
                touched = true;
              }
            }
          }
        }

        if (touched) {
          chunk.edited = true;
          chunk.dirty = true;
        }
      };

      if (totalTouched <= 125) {
        for (let scz = scMinZ; scz <= scMaxZ; scz++) {
          for (let scy = scMinY; scy <= scMaxY; scy++) {
            for (let scx = scMinX; scx <= scMaxX; scx++) {
              const chunk = this.getOrCreateSparseChunk(scx, scy, scz, 1);
              applyBrushToChunk(chunk);
            }
          }
        }
      } else {
        for (const chunk of this.sparseChunks.values()) {
          applyBrushToChunk(chunk);
        }
      }
    }

    // Mark touched chunks (plus 1-voxel neighbor border for seamless normal recomputation)
    const chunksPerAxis = this.chunksPerAxis;
    const cMinX = clamp(Math.floor((minX - 1) / CHUNK_CELLS), 0, chunksPerAxis - 1);
    const cMaxX = clamp(Math.floor((maxX + 1) / CHUNK_CELLS), 0, chunksPerAxis - 1);
    const cMinY = clamp(Math.floor((minY - 1) / CHUNK_CELLS), 0, chunksPerAxis - 1);
    const cMaxY = clamp(Math.floor((maxY + 1) / CHUNK_CELLS), 0, chunksPerAxis - 1);
    const cMinZ = clamp(Math.floor((minZ - 1) / CHUNK_CELLS), 0, chunksPerAxis - 1);
    const cMaxZ = clamp(Math.floor((maxZ + 1) / CHUNK_CELLS), 0, chunksPerAxis - 1);

    const modifiedChunks: number[] = [];
    for (let cz = cMinZ; cz <= cMaxZ; cz++) {
      for (let cy = cMinY; cy <= cMaxY; cy++) {
        for (let cx = cMinX; cx <= cMaxX; cx++) {
          const ci = this.chunkIndex(cx, cy, cz);
          this.dirtyChunks[ci] = 1;
          this.nonUniformChunks[ci] = 1;
          modifiedChunks.push(ci);
        }
      }
    }

    this.voxelRevision++;
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
    const cellsPerAxis = this.cellsPerAxis;
    const sY = this.gridN;
    const sZ = sY * sY;

    // Fast uniform-sign chunk early-out (skips pure-air / pure-core chunks in microseconds)
    let anySolid = false;
    let anyAir = false;
    for (let dz = 0; dz <= CHUNK_CELLS; dz++) {
      const bz = (startZ + dz) * sZ;
      for (let dy = 0; dy <= CHUNK_CELLS; dy++) {
        const byz = bz + (startY + dy) * sY + startX;
        for (let dx = 0; dx <= CHUNK_CELLS; dx++) {
          if (this.density[byz + dx] > 0) anySolid = true;
          else anyAir = true;
          if (anySolid && anyAir) break;
        }
        if (anySolid && anyAir) break;
      }
      if (anySolid && anyAir) break;
    }
    if (!anySolid || !anyAir) {
      return {
        cx,
        cy,
        cz,
        lod,
        positions: new Float32Array(0),
        normals: new Float32Array(0),
        colors: new Float32Array(0),
        matProps: new Float32Array(0),
        uvs: new Float32Array(0),
        vertexCount: 0,
      };
    }

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
                const gx = clamp(this.worldToGrid(vx), 0, cellsPerAxis - 0.001);
                const gy = clamp(this.worldToGrid(vy), 0, cellsPerAxis - 0.001);
                const gz = clamp(this.worldToGrid(vz), 0, cellsPerAxis - 0.001);
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
    const cellsPerAxis = this.cellsPerAxis;
    const sY = this.gridN;
    const sZ = sY * sY;

    // Fast uniform-sign early-out including 1-voxel neighbor halo
    const zMin = Math.max(0, startZ - stride);
    const zMax = Math.min(cellsPerAxis, startZ + CHUNK_CELLS + stride);
    const yMin = Math.max(0, startY - stride);
    const yMax = Math.min(cellsPerAxis, startY + CHUNK_CELLS + stride);
    const xMin = Math.max(0, startX - stride);
    const xMax = Math.min(cellsPerAxis, startX + CHUNK_CELLS + stride);
    let anySolid = false;
    let anyAir = false;
    for (let gz = zMin; gz <= zMax; gz++) {
      const bz = gz * sZ;
      for (let gy = yMin; gy <= yMax; gy++) {
        const byz = bz + gy * sY;
        for (let gx = xMin; gx <= xMax; gx++) {
          if (this.density[byz + gx] > 0) anySolid = true;
          else anyAir = true;
          if (anySolid && anyAir) break;
        }
        if (anySolid && anyAir) break;
      }
      if (anySolid && anyAir) break;
    }
    if (!anySolid || !anyAir) {
      return {
        cx,
        cy,
        cz,
        lod,
        positions: new Float32Array(0),
        normals: new Float32Array(0),
        colors: new Float32Array(0),
        matProps: new Float32Array(0),
        uvs: new Float32Array(0),
        vertexCount: 0,
      };
    }

    const isBlockSolid = (gx: number, gy: number, gz: number): boolean => {
      if (
        gx < 0 ||
        gy < 0 ||
        gz < 0 ||
        gx >= cellsPerAxis ||
        gy >= cellsPerAxis ||
        gz >= cellsPerAxis
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
      const hx = clamp(gx + (stride >> 1), 0, cellsPerAxis);
      const hy = clamp(gy + (stride >> 1), 0, cellsPerAxis);
      const hz = clamp(gz + (stride >> 1), 0, cellsPerAxis);
      return this.density[hx + hy * sY + hz * sZ] > 0;
    };

    const pickBlockMaterial = (gx: number, gy: number, gz: number): MaterialId => {
      const mx = clamp(gx + (stride >> 1), 0, cellsPerAxis);
      const my = clamp(gy + (stride >> 1), 0, cellsPerAxis);
      const mz = clamp(gz + (stride >> 1), 0, cellsPerAxis);
      const centerMat = this.material[mx + my * sY + mz * sZ] as MaterialId;
      if (centerMat !== MaterialId.Air) return centerMat;
      // Search cell corners for dominant non-Air material
      for (let dz = 0; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
          for (let dx = 0; dx <= 1; dx++) {
            const ix = clamp(gx + dx * stride, 0, cellsPerAxis);
            const iy = clamp(gy + dy * stride, 0, cellsPerAxis);
            const iz = clamp(gz + dz * stride, 0, cellsPerAxis);
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

  public getOrCreateSparseChunk(
    cx: number,
    cy: number,
    cz: number,
    scaleMult: number,
  ): SparseVoxelChunk {
    const key = `${scaleMult}:${cx},${cy},${cz}`;
    const existing = this.sparseChunks.get(key);
    if (existing) {
      existing.lastUsedFrame = this.streamFrame;
      return existing;
    }

    const stepSize = this.nativeVoxelSize * scaleMult;
    const chunkSpan = CHUNK_CELLS * stepSize;
    const originX = cx * chunkSpan;
    const originY = cy * chunkSpan;
    const originZ = cz * chunkSpan;

    const total = SPARSE_N * SPARSE_N * SPARSE_N;
    const density = new Float32Array(total);
    const material = new Uint8Array(total);

    const { minEvalR, maxSurfR, rScale } = this.getRadialEvalBounds();
    const edgeClip = this.worldHalf * 0.94;
    const minExtent = Math.min(originX, originY, originZ) - SPARSE_PAD * stepSize;
    const maxExtent = Math.max(originX, originY, originZ) + (CHUNK_CELLS + SPARSE_PAD) * stepSize;
    const centerR = Math.hypot(
      originX + chunkSpan * 0.5,
      originY + chunkSpan * 0.5,
      originZ + chunkSpan * 0.5,
    );
    const halfDiag = chunkSpan * 0.8660254 + SPARSE_PAD * stepSize * 1.732;
    const fastFullAir = centerR - halfDiag > maxSurfR && maxExtent <= edgeClip;
    const fastFullSolid = centerR + halfDiag < minEvalR;

    if (fastFullAir) {
      for (let lz = 0; lz < SPARSE_N; lz++) {
        const wz = originZ + (lz - SPARSE_PAD) * stepSize;
        const wz2 = wz * wz;
        for (let ly = 0; ly < SPARSE_N; ly++) {
          const wy = originY + (ly - SPARSE_PAD) * stepSize;
          const wyz2 = wz2 + wy * wy;
          for (let lx = 0; lx < SPARSE_N; lx++) {
            const wx = originX + (lx - SPARSE_PAD) * stepSize;
            const idx = lx + ly * SPARSE_NY + lz * SPARSE_NZ;
            density[idx] = this.baseRadius - Math.sqrt(wx * wx + wyz2);
            material[idx] = MaterialId.Air;
          }
        }
      }
    } else if (fastFullSolid) {
      for (let lz = 0; lz < SPARSE_N; lz++) {
        const wz = originZ + (lz - SPARSE_PAD) * stepSize;
        const wz2 = wz * wz;
        for (let ly = 0; ly < SPARSE_N; ly++) {
          const wy = originY + (ly - SPARSE_PAD) * stepSize;
          const wyz2 = wz2 + wy * wy;
          for (let lx = 0; lx < SPARSE_N; lx++) {
            const wx = originX + (lx - SPARSE_PAD) * stepSize;
            const idx = lx + ly * SPARSE_NY + lz * SPARSE_NZ;
            const r = Math.sqrt(wx * wx + wyz2);
            density[idx] = this.baseRadius - r;
            material[idx] =
              r < this.baseRadius * 0.49 ? MaterialId.Basalt : MaterialId.Stone;
          }
        }
      }
    } else {
      for (let lz = 0; lz < SPARSE_N; lz++) {
        const wz = originZ + (lz - SPARSE_PAD) * stepSize;
        const wz2 = wz * wz;
        const az = Math.abs(wz);
        for (let ly = 0; ly < SPARSE_N; ly++) {
          const wy = originY + (ly - SPARSE_PAD) * stepSize;
          const wyz2 = wz2 + wy * wy;
          const ayz = Math.max(az, Math.abs(wy));
          for (let lx = 0; lx < SPARSE_N; lx++) {
            const wx = originX + (lx - SPARSE_PAD) * stepSize;
            const idx = lx + ly * SPARSE_NY + lz * SPARSE_NZ;
            const r = Math.sqrt(wx * wx + wyz2);
            if (r > maxSurfR) {
              let d = this.baseRadius - r;
              const em = edgeClip - Math.max(ayz, Math.abs(wx));
              if (em < 0) d = Math.min(d, em * 2.0 - 0.5 * rScale);
              density[idx] = d;
              material[idx] = MaterialId.Air;
            } else if (r < minEvalR) {
              density[idx] = this.baseRadius - r;
              material[idx] =
                r < this.baseRadius * 0.49 ? MaterialId.Basalt : MaterialId.Stone;
            } else {
              const res = this.evalAnalyticalAt(wx, wy, wz, true);
              density[idx] = res.density;
              material[idx] = res.material;
            }
          }
        }
      }
    }
    void minExtent;

    const chunk: SparseVoxelChunk = {
      key,
      cx,
      cy,
      cz,
      scaleMult,
      stepSize,
      originX,
      originY,
      originZ,
      density,
      material,
      edited: false,
      dirty: true,
      lastUsedFrame: this.streamFrame,
    };
    this.sparseChunks.set(key, chunk);
    return chunk;
  }

  private evictUnusedSparseChunks(
    maxUnedited = 4800,
    keepKeys?: Set<string>,
  ): void {
    let uneditedCount = 0;
    for (const c of this.sparseChunks.values()) {
      if (!c.edited) uneditedCount++;
    }
    if (uneditedCount <= maxUnedited) return;

    const evictable: SparseVoxelChunk[] = [];
    for (const c of this.sparseChunks.values()) {
      if (!c.edited && (!keepKeys || !keepKeys.has(c.key))) evictable.push(c);
    }
    evictable.sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);
    const toRemove = Math.min(evictable.length, uneditedCount - maxUnedited);
    for (let i = 0; i < toRemove; i++) {
      this.sparseChunks.delete(evictable[i].key);
    }
  }

  public extractSparseChunkMesh(
    chunk: SparseVoxelChunk,
    blocky: boolean,
  ): ChunkMeshData {
    const dArr = chunk.density;
    const mArr = chunk.material;
    const len = dArr.length;

    // Fast pure-air / pure-interior skip
    let hasSolid = false;
    let hasAir = false;
    for (let i = 0; i < len; i++) {
      if (dArr[i] > 0) hasSolid = true;
      else hasAir = true;
      if (hasSolid && hasAir) break;
    }
    if (!hasSolid || !hasAir) {
      return {
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
        lod: 0,
        positions: new Float32Array(0),
        normals: new Float32Array(0),
        colors: new Float32Array(0),
        matProps: new Float32Array(0),
        uvs: new Float32Array(0),
        vertexCount: 0,
      };
    }

    const stepSize = chunk.stepSize;
    const rScale = this.baseRadius / 13.0;
    let vCount = 0;
    const maxVerts = this.scratchPos.length / 3;

    if (blocky) {
      const isBlockSolid = (px: number, py: number, pz: number): boolean => {
        const base = px + py * SPARSE_NY + pz * SPARSE_NZ;
        const avg =
          dArr[base] +
          dArr[base + 1] +
          dArr[base + SPARSE_NY] +
          dArr[base + SPARSE_NY + 1] +
          dArr[base + SPARSE_NZ] +
          dArr[base + SPARSE_NZ + 1] +
          dArr[base + SPARSE_NZ + SPARSE_NY] +
          dArr[base + SPARSE_NZ + SPARSE_NY + 1];
        return avg > 0;
      };

      const pickBlockMaterial = (px: number, py: number, pz: number): MaterialId => {
        const base = px + py * SPARSE_NY + pz * SPARSE_NZ;
        const m0 = mArr[base] as MaterialId;
        if (m0 !== MaterialId.Air) return m0;
        for (let dz = 0; dz <= 1; dz++) {
          for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
              const m = mArr[base + dx + dy * SPARSE_NY + dz * SPARSE_NZ] as MaterialId;
              if (m !== MaterialId.Air) return m;
            }
          }
        }
        return MaterialId.Stone;
      };

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
          verts: [[1, 0, 1, 0, 0], [1, 0, 0, 1, 0], [1, 1, 0, 1, 1], [1, 1, 1, 0, 1]],
          shade: 0.92,
        },
        {
          n: [-1, 0, 0],
          uDir: [0, 0, 1],
          vDir: [0, 1, 0],
          verts: [[0, 0, 0, 0, 0], [0, 0, 1, 1, 0], [0, 1, 1, 1, 1], [0, 1, 0, 0, 1]],
          shade: 0.84,
        },
        {
          n: [0, 1, 0],
          uDir: [1, 0, 0],
          vDir: [0, 0, -1],
          verts: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [1, 1, 0, 1, 1], [0, 1, 0, 0, 1]],
          shade: 1.0,
        },
        {
          n: [0, -1, 0],
          uDir: [1, 0, 0],
          vDir: [0, 0, 1],
          verts: [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [1, 0, 1, 1, 1], [0, 0, 1, 0, 1]],
          shade: 0.72,
        },
        {
          n: [0, 0, 1],
          uDir: [1, 0, 0],
          vDir: [0, 1, 0],
          verts: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [1, 1, 1, 1, 1], [0, 1, 1, 0, 1]],
          shade: 0.96,
        },
        {
          n: [0, 0, -1],
          uDir: [-1, 0, 0],
          vDir: [0, 1, 0],
          verts: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [0, 1, 0, 1, 1], [1, 1, 0, 0, 1]],
          shade: 0.86,
        },
      ];

      for (let lz = 0; lz < CHUNK_CELLS; lz++) {
        const pz = lz + SPARSE_PAD;
        const wz0 = chunk.originZ + lz * stepSize;
        const lz0 = lz * stepSize;
        for (let ly = 0; ly < CHUNK_CELLS; ly++) {
          const py = ly + SPARSE_PAD;
          const wy0 = chunk.originY + ly * stepSize;
          const ly0 = ly * stepSize;
          for (let lx = 0; lx < CHUNK_CELLS; lx++) {
            const px = lx + SPARSE_PAD;
            if (!isBlockSolid(px, py, pz)) continue;

            const wx0 = chunk.originX + lx * stepSize;
            const lx0 = lx * stepSize;
            const matId = pickBlockMaterial(px, py, pz);
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
              if (isBlockSolid(px + nx, py + ny, pz + nz)) continue;
              if (vCount + 6 > maxVerts) break;

              const aoVals = [1, 1, 1, 1];
              for (let c = 0; c < 4; c++) {
                const [, , , u, v] = face.verts[c];
                const su = u === 0 ? -1 : 1;
                const sv = v === 0 ? -1 : 1;
                const s1 = isBlockSolid(
                  px + nx + face.uDir[0] * su,
                  py + ny + face.uDir[1] * su,
                  pz + nz + face.uDir[2] * su,
                )
                  ? 1
                  : 0;
                const s2 = isBlockSolid(
                  px + nx + face.vDir[0] * sv,
                  py + ny + face.vDir[1] * sv,
                  pz + nz + face.vDir[2] * sv,
                )
                  ? 1
                  : 0;
                const sc = isBlockSolid(
                  px + nx + face.uDir[0] * su + face.vDir[0] * sv,
                  py + ny + face.uDir[1] * su + face.vDir[1] * sv,
                  pz + nz + face.uDir[2] * su + face.vDir[2] * sv,
                )
                  ? 1
                  : 0;
                const occ = s1 && s2 ? 3 : s1 + s2 + sc;
                aoVals[c] = 1.0 - occ * 0.13;
              }

              const triOrder = [0, 1, 2, 0, 2, 3];
              for (let t = 0; t < 6; t++) {
                const vi = triOrder[t];
                const [vx, vy, vz, u, v] = face.verts[vi];
                const p3 = vCount * 3;
                const u2 = vCount * 2;
                const shade = face.shade * depthShade * aoVals[vi];

                this.scratchPos[p3] = lx0 + vx * stepSize;
                this.scratchPos[p3 + 1] = ly0 + vy * stepSize;
                this.scratchPos[p3 + 2] = lz0 + vz * stepSize;

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
    } else {
      const sampleLocalGrad = (
        gx: number,
        gy: number,
        gz: number,
        out: [number, number, number],
      ) => {
        const ix = clamp(Math.floor(gx), 1, SPARSE_N - 3);
        const iy = clamp(Math.floor(gy), 1, SPARSE_N - 3);
        const iz = clamp(Math.floor(gz), 1, SPARSE_N - 3);
        const base = ix + iy * SPARSE_NY + iz * SPARSE_NZ;
        const dx = dArr[base - 1] - dArr[base + 1];
        const dy = dArr[base - SPARSE_NY] - dArr[base + SPARSE_NY];
        const dz = dArr[base - SPARSE_NZ] - dArr[base + SPARSE_NZ];
        const len = Math.hypot(dx, dy, dz);
        if (len > 1e-6) {
          out[0] = dx / len;
          out[1] = dy / len;
          out[2] = dz / len;
        } else {
          out[0] = 0;
          out[1] = 1;
          out[2] = 0;
        }
      };

      for (let lz = 0; lz < CHUNK_CELLS; lz++) {
        const pz = lz + SPARSE_PAD;
        const lz0 = lz * stepSize;
        for (let ly = 0; ly < CHUNK_CELLS; ly++) {
          const py = ly + SPARSE_PAD;
          const ly0 = ly * stepSize;
          for (let lx = 0; lx < CHUNK_CELLS; lx++) {
            const px = lx + SPARSE_PAD;
            const lx0 = lx * stepSize;

            let cubeIndex = 0;
            for (let c = 0; c < 8; c++) {
              const off = CORNER_OFFSETS[c];
              const d =
                dArr[
                  px +
                    off[0] +
                    (py + off[1]) * SPARSE_NY +
                    (pz + off[2]) * SPARSE_NZ
                ];
              this.cornerDensity[c] = d;
              this.cornerPos[c * 3] = lx0 + off[0] * stepSize;
              this.cornerPos[c * 3 + 1] = ly0 + off[1] * stepSize;
              this.cornerPos[c * 3 + 2] = lz0 + off[2] * stepSize;
              if (d > 0) cubeIndex |= 1 << c;
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
              const edges = [tris[t], tris[t + 2], tris[t + 1]];
              for (let k = 0; k < 3; k++) {
                const eIdx = edges[k];
                const e3 = eIdx * 3;
                if (this.edgeComputed[eIdx] === 0) {
                  this.edgeComputed[eIdx] = 1;
                  const lvx = this.edgeVerts[e3];
                  const lvy = this.edgeVerts[e3 + 1];
                  const lvz = this.edgeVerts[e3 + 2];
                  const vx = chunk.originX + lvx;
                  const vy = chunk.originY + lvy;
                  const vz = chunk.originZ + lvz;

                  const gx = clamp(lvx / stepSize + SPARSE_PAD, 1, SPARSE_N - 2.001);
                  const gy = clamp(lvy / stepSize + SPARSE_PAD, 1, SPARSE_N - 2.001);
                  const gz = clamp(lvz / stepSize + SPARSE_PAD, 1, SPARSE_N - 2.001);
                  sampleLocalGrad(gx, gy, gz, this.tempGrad);
                  const nx = this.tempGrad[0];
                  const ny = this.tempGrad[1];
                  const nz = this.tempGrad[2];
                  this.edgeNorms[e3] = nx;
                  this.edgeNorms[e3 + 1] = ny;
                  this.edgeNorms[e3 + 2] = nz;

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
                        const cIdx =
                          bix + dx + (biy + dy) * SPARSE_NY + (biz + dz) * SPARSE_NZ;
                        const m = mArr[cIdx] as MaterialId;
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
                    const sInfo = MATERIAL_PALETTE[MaterialId.Stone];
                    cr = sInfo.rgb[0];
                    cg = sInfo.rgb[1];
                    cb = sInfo.rgb[2];
                    rough = sInfo.rough;
                    metal = sInfo.metal;
                    glow = sInfo.glow;
                  }

                  const r = Math.hypot(vx, vy, vz) || 1;
                  const slopeDot = (vx * nx + vy * ny + vz * nz) / r;
                  const cliffBlend = (1 - smoothstep(0.58, 0.86, slopeDot)) * (1 - glow);
                  const stoneCol = MATERIAL_PALETTE[MaterialId.Stone].rgb;
                  cr = cr * (1 - cliffBlend * 0.72) + stoneCol[0] * cliffBlend * 0.72;
                  cg = cg * (1 - cliffBlend * 0.72) + stoneCol[1] * cliffBlend * 0.72;
                  cb = cb * (1 - cliffBlend * 0.72) + stoneCol[2] * cliffBlend * 0.72;

                  const depthShade =
                    smoothstep(this.baseRadius * 0.35, this.baseRadius * 0.85, r) * 0.35 +
                    0.65;
                  this.edgeCols[e3] = clamp(cr * depthShade, 0, 1);
                  this.edgeCols[e3 + 1] = clamp(cg * depthShade, 0, 1);
                  this.edgeCols[e3 + 2] = clamp(cb * depthShade, 0, 1);
                  this.edgeMats[e3] = rough;
                  this.edgeMats[e3 + 1] = metal;
                  this.edgeMats[e3 + 2] = glow;
                }

                if (vCount >= maxVerts) break;
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
    }

    return {
      cx: chunk.cx,
      cy: chunk.cy,
      cz: chunk.cz,
      lod: 0,
      origin: [chunk.originX, chunk.originY, chunk.originZ],
      positions: this.scratchPos.slice(0, vCount * 3),
      normals: this.scratchNorm.slice(0, vCount * 3),
      colors: this.scratchCol.slice(0, vCount * 3),
      matProps: this.scratchMat.slice(0, vCount * 3),
      uvs: this.scratchUv.slice(0, vCount * 2),
      vertexCount: vCount,
    };
  }

  /**
   * Sparse Voxel Octree (SVO) spatial query at chunk scale `span`, pruning uniform deep-core,
   * outer-space, and out-of-cone octants in O(1) before emitting surface-intersecting leaf bricks.
   */
  private collectOctreeChunksAtScale(
    span: number,
    minEvalR: number,
    maxSurfR: number,
    focusDir: [number, number, number],
    dotMin: number,
    dotMax: number,
    out: Array<{ cx: number; cy: number; cz: number; cwx: number; cwy: number; cwz: number; dot: number }>,
  ): void {
    const bound = Math.ceil((maxSurfR + span * 1.15) / span);
    let treeSize = 2;
    while (treeSize < bound * 2) treeSize <<= 1;
    const halfTree = treeSize >> 1;
    const minRBound = Math.max(0, minEvalR - span * 1.05);
    const maxRBound = maxSurfR + span * 1.05;
    const fx = focusDir[0];
    const fy = focusDir[1];
    const fz = focusDir[2];

    const visit = (cx0: number, cy0: number, cz0: number, size: number) => {
      const minX = cx0 * span;
      const maxX = (cx0 + size) * span;
      const minY = cy0 * span;
      const maxY = (cy0 + size) * span;
      const minZ = cz0 * span;
      const maxZ = (cz0 + size) * span;

      const clX = minX > 0 ? minX : maxX < 0 ? maxX : 0;
      const clY = minY > 0 ? minY : maxY < 0 ? maxY : 0;
      const clZ = minZ > 0 ? minZ : maxZ < 0 ? maxZ : 0;
      if (clX * clX + clY * clY + clZ * clZ > maxRBound * maxRBound) return;

      const farX = Math.max(Math.abs(minX), Math.abs(maxX));
      const farY = Math.max(Math.abs(minY), Math.abs(maxY));
      const farZ = Math.max(Math.abs(minZ), Math.abs(maxZ));
      if (farX * farX + farY * farY + farZ * farZ < minRBound * minRBound) return;

      const halfWorld = size * span * 0.5;
      const cwx = minX + halfWorld;
      const cwy = minY + halfWorld;
      const cwz = minZ + halfWorld;
      const ncR = Math.hypot(cwx, cwy, cwz);
      const nodeHalfDiag = halfWorld * 1.7320508;

      if (ncR > nodeHalfDiag + 1e-5) {
        const centerDot = (cwx * fx + cwy * fy + cwz * fz) / ncR;
        if (dotMin > -0.999 || dotMax < 0.999) {
          const sinA = Math.min(1, nodeHalfDiag / ncR);
          const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));
          const sinC = Math.sqrt(Math.max(0, 1 - centerDot * centerDot));
          const boxMaxDot = centerDot > cosA ? 1.0 : centerDot * cosA + sinC * sinA;
          const boxMinDot = centerDot < -cosA ? -1.0 : centerDot * cosA - sinC * sinA;
          if (boxMaxDot < dotMin || boxMinDot > dotMax) return;
        }
        if (size === 1) {
          out.push({ cx: cx0, cy: cy0, cz: cz0, cwx, cwy, cwz, dot: centerDot });
          return;
        }
      } else if (size === 1) {
        if (ncR < 1e-5) return;
        const centerDot = (cwx * fx + cwy * fy + cwz * fz) / ncR;
        if (centerDot >= dotMin && centerDot <= dotMax) {
          out.push({ cx: cx0, cy: cy0, cz: cz0, cwx, cwy, cwz, dot: centerDot });
        }
        return;
      }

      const half = size >> 1;
      for (let dz = 0; dz < 2; dz++) {
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            visit(cx0 + dx * half, cy0 + dy * half, cz0 + dz * half, half);
          }
        }
      }
    };

    visit(-halfTree, -halfTree, -halfTree, treeSize);
  }

  /**
   * Streams 360° full-sphere sparse voxel octree bricks (globe + horizon hemi +
   * dual-cascade altitude-adaptive mid tiers + 1:1 native leaf blocks + edited chunks).
   */
  public streamHighResAround(
    fx: number,
    fy: number,
    fz: number,
    renderMode: TerrainRenderMode,
    maxBuildPerFrame = 28,
    camDistToFocus?: number,
  ): HighResStreamBatch {
    this.streamFrame++;
    const desiredKeys = new Set<string>();
    const rebuiltMeshes: HighResStreamBatch['rebuiltMeshes'] = [];

    if (!this.isHighResStreaming) {
      return {
        active: false,
        hideMacro: false,
        globeBuiltComplete: false,
        hemiCenter: [fx, fy, fz],
        hemiDiscardRadius: 0,
        midOuterCenter: [fx, fy, fz],
        midOuterDiscardRadius: 0,
        midCenter: [fx, fy, fz],
        midDiscardRadius: 0,
        nativeCenter: [fx, fy, fz],
        nativeDiscardRadius: 0,
        pendingTotal: 0,
        desiredKeys,
        rebuiltMeshes,
      };
    }

    const blocky = renderMode === 'blocky';
    const nativeSpan = CHUNK_CELLS * this.nativeVoxelSize;
    const fLen = Math.hypot(fx, fy, fz);
    const focusDir: [number, number, number] =
      fLen > 1e-4 ? [fx / fLen, fy / fLen, fz / fLen] : [0, 1, 0];
    const surfF: [number, number, number] =
      fLen > 1e-4 && fLen > this.baseRadius * 1.35
        ? [
            focusDir[0] * this.baseRadius,
            focusDir[1] * this.baseRadius,
            focusDir[2] * this.baseRadius,
          ]
        : [fx, fy, fz];

    const wantQueue: Array<{
      cx: number;
      cy: number;
      cz: number;
      scaleMult: number;
      tier: 'globe' | 'hemi' | 'midOuter' | 'mid' | 'native';
      prio: number;
      inCore?: boolean;
    }> = [];

    // Always retain & rebuild all user-edited chunks regardless of camera position
    for (const chunk of this.sparseChunks.values()) {
      if (!chunk.edited) continue;
      desiredKeys.add(chunk.key);
      chunk.lastUsedFrame = this.streamFrame;
      if (chunk.dirty) {
        wantQueue.push({
          cx: chunk.cx,
          cy: chunk.cy,
          cz: chunk.cz,
          scaleMult: chunk.scaleMult,
          tier: 'native',
          prio: -100,
        });
      }
    }

    // Small custom-resolution planet (voxelRadius < 18): replace entire macro planet at 1:1
    if (this.voxelRadius < 18) {
      const cBound = Math.ceil(this.worldHalf / nativeSpan);
      let pending = 0;
      for (let cz = -cBound; cz < cBound; cz++) {
        for (let cy = -cBound; cy < cBound; cy++) {
          for (let cx = -cBound; cx < cBound; cx++) {
            const cwx = (cx + 0.5) * nativeSpan;
            const cwy = (cy + 0.5) * nativeSpan;
            const cwz = (cz + 0.5) * nativeSpan;
            const cr = Math.hypot(cwx, cwy, cwz);
            if (cr > this.worldHalf + nativeSpan) continue;
            const key = `1:${cx},${cy},${cz}`;
            desiredKeys.add(key);
            const existing = this.sparseChunks.get(key);
            if (!existing || existing.dirty) {
              pending++;
              const dSq =
                (cwx - surfF[0]) * (cwx - surfF[0]) +
                (cwy - surfF[1]) * (cwy - surfF[1]) +
                (cwz - surfF[2]) * (cwz - surfF[2]);
              wantQueue.push({
                cx,
                cy,
                cz,
                scaleMult: 1,
                tier: 'native',
                prio: (existing?.edited ? 0 : 1e4) + dSq,
              });
            } else {
              existing.lastUsedFrame = this.streamFrame;
            }
          }
        }
      }

      if (wantQueue.length > 0) {
        wantQueue.sort((a, b) => a.prio - b.prio);
        const lim = Math.min(maxBuildPerFrame, wantQueue.length);
        for (let i = 0; i < lim; i++) {
          const w = wantQueue[i];
          const ch = this.getOrCreateSparseChunk(w.cx, w.cy, w.cz, 1);
          ch.dirty = false;
          rebuiltMeshes.push({
            key: ch.key,
            tier: 'native',
            mesh: this.extractSparseChunkMesh(ch, blocky),
          });
          pending = Math.max(0, pending - 1);
        }
      }
      this.evictUnusedSparseChunks(340);
      return {
        active: true,
        hideMacro: pending === 0,
        globeBuiltComplete: pending === 0,
        hemiCenter: [surfF[0], surfF[1], surfF[2]],
        hemiDiscardRadius: 0,
        midOuterCenter: [surfF[0], surfF[1], surfF[2]],
        midOuterDiscardRadius: 0,
        midCenter: [surfF[0], surfF[1], surfF[2]],
        midDiscardRadius: 0,
        nativeCenter: [surfF[0], surfF[1], surfF[2]],
        nativeDiscardRadius: pending === 0 ? this.worldHalf * 2.0 : 0,
        pendingTotal: pending,
        desiredKeys,
        rebuiltMeshes,
      };
    }

    // Large / Ultra-high-res 360° sparse octree planet (up to >1,000,000,000³+)
    const estCamR =
      camDistToFocus !== undefined
        ? Math.max(this.baseRadius * 1.00001, this.baseRadius + camDistToFocus * 0.92)
        : this.baseRadius * 2.35;
    const horizonCos = clamp(this.baseRadius / estCamR, 0.12, 0.96);
    const minHemiDot = Math.max(-0.06, horizonCos - 0.32);
    const capFrac = clamp((1 - minHemiDot) * 0.5, 0.18, 0.54);
    const targetHemiBlocks = clamp(
      Math.round(CHUNK_CELLS * Math.sqrt(420 / (capFrac * 4 * Math.PI))),
      68,
      136,
    );
    const hemiScaleMult = Math.max(1, Math.round(this.voxelRadius / targetHemiBlocks));
    const hemiStep = this.nativeVoxelSize * hemiScaleMult;
    const hemiSpan = CHUNK_CELLS * hemiStep;
    const hemiHalfDiag = hemiSpan * 0.8660254;
    const hemiCenter: [number, number, number] = [
      focusDir[0] * this.baseRadius,
      focusDir[1] * this.baseRadius,
      focusDir[2] * this.baseRadius,
    ];

    const { minEvalR, maxSurfR } = this.getRadialEvalBounds();
    const coreDotThresh = clamp(minHemiDot + 0.12, 0.04, 0.92);

    // 1. hemiTier: High-density visible horizon cap via Octree query
    const hemiLeaves: Array<{ cx: number; cy: number; cz: number; cwx: number; cwy: number; cwz: number; dot: number }> = [];
    this.collectOctreeChunksAtScale(
      hemiSpan,
      minEvalR,
      maxSurfR,
      focusDir,
      minHemiDot,
      1.01,
      hemiLeaves,
    );

    const microMargin =
      Math.min(0.24, this.genCtx.detailLogScale * 0.032) * (this.baseRadius / 13.0) +
      this.nativeVoxelSize * 3.0;

    let pendingHemiCore = 0;
    for (let i = 0; i < hemiLeaves.length; i++) {
      const leaf = hemiLeaves[i];
      const key = `${hemiScaleMult}:${leaf.cx},${leaf.cy},${leaf.cz}`;
      const existing = this.sparseChunks.get(key);
      if (!existing) {
        const dApprox = this.evalAnalyticalAt(leaf.cwx, leaf.cwy, leaf.cwz, false).density;
        if (Math.abs(dApprox) > hemiHalfDiag * 1.04 + microMargin) continue;
      }
      desiredKeys.add(key);
      if (!existing || existing.dirty) {
        const inCore = leaf.dot >= coreDotThresh;
        if (inCore) pendingHemiCore++;
        const dSq =
          (leaf.cwx - surfF[0]) * (leaf.cwx - surfF[0]) +
          (leaf.cwy - surfF[1]) * (leaf.cwy - surfF[1]) +
          (leaf.cwz - surfF[2]) * (leaf.cwz - surfF[2]);
        wantQueue.push({
          cx: leaf.cx,
          cy: leaf.cy,
          cz: leaf.cz,
          scaleMult: hemiScaleMult,
          tier: 'hemi',
          prio: 1e9 + dSq,
          inCore,
        });
      } else {
        existing.lastUsedFrame = this.streamFrame;
      }
    }

    // 2. globeTier: Full 360° back-hemisphere & limb sparse octree complement (closes entire 360° sphere!)
    const targetGlobeBlocks = 42;
    const globeScaleMult = Math.max(hemiScaleMult, Math.round(this.voxelRadius / targetGlobeBlocks));
    const globeSpan = CHUNK_CELLS * this.nativeVoxelSize * globeScaleMult;
    const globeHalfDiag = globeSpan * 0.8660254;
    const globeLeaves: Array<{ cx: number; cy: number; cz: number; cwx: number; cwy: number; cwz: number; dot: number }> = [];
    this.collectOctreeChunksAtScale(
      globeSpan,
      minEvalR,
      maxSurfR,
      focusDir,
      -1.01,
      coreDotThresh + 0.08,
      globeLeaves,
    );

    let pendingGlobe = 0;
    for (let i = 0; i < globeLeaves.length; i++) {
      const leaf = globeLeaves[i];
      const key = `${globeScaleMult}:${leaf.cx},${leaf.cy},${leaf.cz}`;
      if (desiredKeys.has(key)) continue;
      const existing = this.sparseChunks.get(key);
      if (!existing) {
        const dApprox = this.evalAnalyticalAt(leaf.cwx, leaf.cwy, leaf.cwz, false).density;
        if (Math.abs(dApprox) > globeHalfDiag * 1.04 + microMargin) continue;
      }
      desiredKeys.add(key);
      if (!existing || existing.dirty) {
        pendingGlobe++;
        const dSq =
          (leaf.cwx - surfF[0]) * (leaf.cwx - surfF[0]) +
          (leaf.cwy - surfF[1]) * (leaf.cwy - surfF[1]) +
          (leaf.cwz - surfF[2]) * (leaf.cwz - surfF[2]);
        wantQueue.push({
          cx: leaf.cx,
          cy: leaf.cy,
          cz: leaf.cz,
          scaleMult: globeScaleMult,
          tier: 'globe',
          prio: 1e12 + dSq,
        });
      } else {
        existing.lastUsedFrame = this.streamFrame;
      }
    }

    // 3. midTier + optional midOuterTier cascade: continuous altitude-adaptive zoom down to 10^-9 R
    const useMidTier = hemiScaleMult > 2;
    let midScaleMult = 1;
    let midSpan = 0;
    let midCenterX = surfF[0];
    let midCenterY = surfF[1];
    let midCenterZ = surfF[2];
    let pendingMid = 0;

    let useMidOuter = false;
    let midOuterScaleMult = 1;
    let midOuterSpan = 0;
    let midOuterCenterX = surfF[0];
    let midOuterCenterY = surfF[1];
    let midOuterCenterZ = surfF[2];
    let pendingMidOuter = 0;

    if (useMidTier) {
      const targetMidStep =
        camDistToFocus !== undefined
          ? clamp(
              Math.min(hemiStep * 0.25, camDistToFocus / 72),
              this.nativeVoxelSize * 2,
              hemiStep * 0.45,
            )
          : Math.min(hemiStep * 0.45, this.nativeVoxelSize * Math.sqrt(hemiScaleMult));
      midScaleMult = clamp(
        Math.round(targetMidStep / this.nativeVoxelSize),
        2,
        Math.max(2, Math.floor(hemiScaleMult * 0.5)),
      );
      if (midScaleMult === hemiScaleMult) {
        midScaleMult = Math.max(2, hemiScaleMult - 1);
      }

      if (hemiScaleMult / midScaleMult >= 10) {
        useMidOuter = true;
        midOuterScaleMult = clamp(
          Math.round(Math.sqrt(hemiScaleMult * midScaleMult)),
          midScaleMult + 1,
          Math.max(midScaleMult + 1, hemiScaleMult - 1),
        );
        midOuterSpan = CHUNK_CELLS * this.nativeVoxelSize * midOuterScaleMult;
        const midOuterHalfDiag = midOuterSpan * 0.8660254;
        const moCx = Math.floor(surfF[0] / midOuterSpan);
        const moCy = Math.floor(surfF[1] / midOuterSpan);
        const moCz = Math.floor(surfF[2] / midOuterSpan);
        midOuterCenterX = (moCx + 0.5) * midOuterSpan;
        midOuterCenterY = (moCy + 0.5) * midOuterSpan;
        midOuterCenterZ = (moCz + 0.5) * midOuterSpan;

        for (let dz = -3; dz <= 3; dz++) {
          for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              const cx = moCx + dx;
              const cy = moCy + dy;
              const cz = moCz + dz;
              const cwx = (cx + 0.5) * midOuterSpan;
              const cwy = (cy + 0.5) * midOuterSpan;
              const cwz = (cz + 0.5) * midOuterSpan;
              const key = `${midOuterScaleMult}:${cx},${cy},${cz}`;
              const existing = this.sparseChunks.get(key);
              if (!existing) {
                const dApprox = this.evalAnalyticalAt(cwx, cwy, cwz, true).density;
                if (Math.abs(dApprox) > midOuterHalfDiag * 1.45) continue;
              }
              desiredKeys.add(key);
              if (!existing || existing.dirty) {
                pendingMidOuter++;
                const dSq =
                  (cwx - surfF[0]) * (cwx - surfF[0]) +
                  (cwy - surfF[1]) * (cwy - surfF[1]) +
                  (cwz - surfF[2]) * (cwz - surfF[2]);
                wantQueue.push({
                  cx,
                  cy,
                  cz,
                  scaleMult: midOuterScaleMult,
                  tier: 'midOuter',
                  prio: 1e7 + dSq,
                });
              } else {
                existing.lastUsedFrame = this.streamFrame;
              }
            }
          }
        }
      }

      midSpan = CHUNK_CELLS * this.nativeVoxelSize * midScaleMult;
      const midHalfDiag = midSpan * 0.8660254;
      const mCx = Math.floor(surfF[0] / midSpan);
      const mCy = Math.floor(surfF[1] / midSpan);
      const mCz = Math.floor(surfF[2] / midSpan);
      midCenterX = (mCx + 0.5) * midSpan;
      midCenterY = (mCy + 0.5) * midSpan;
      midCenterZ = (mCz + 0.5) * midSpan;

      for (let dz = -4; dz <= 4; dz++) {
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const cx = mCx + dx;
            const cy = mCy + dy;
            const cz = mCz + dz;
            const cwx = (cx + 0.5) * midSpan;
            const cwy = (cy + 0.5) * midSpan;
            const cwz = (cz + 0.5) * midSpan;
            const key = `${midScaleMult}:${cx},${cy},${cz}`;
            const existing = this.sparseChunks.get(key);
            if (!existing) {
              const dApprox = this.evalAnalyticalAt(cwx, cwy, cwz, true).density;
              if (Math.abs(dApprox) > midHalfDiag * 1.45) continue;
            }
            desiredKeys.add(key);
            if (!existing || existing.dirty) {
              pendingMid++;
              const dSq =
                (cwx - surfF[0]) * (cwx - surfF[0]) +
                (cwy - surfF[1]) * (cwy - surfF[1]) +
                (cwz - surfF[2]) * (cwz - surfF[2]);
              wantQueue.push({
                cx,
                cy,
                cz,
                scaleMult: midScaleMult,
                tier: 'mid',
                prio: 1e5 + dSq,
              });
            } else {
              existing.lastUsedFrame = this.streamFrame;
            }
          }
        }
      }
    }

    // 4. nativeTier: 1:1 native 5x5x5 leaf blocks at exact fullCellsPerAxis³ resolution
    const useSeparateNative = hemiScaleMult > 1;
    const centerCx = Math.floor(surfF[0] / nativeSpan);
    const centerCy = Math.floor(surfF[1] / nativeSpan);
    const centerCz = Math.floor(surfF[2] / nativeSpan);
    const nCenterX = (centerCx + 0.5) * nativeSpan;
    const nCenterY = (centerCy + 0.5) * nativeSpan;
    const nCenterZ = (centerCz + 0.5) * nativeSpan;
    let pendingNative = 0;

    if (useSeparateNative) {
      const nativeHalfDiag = nativeSpan * 0.8660254;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const cx = centerCx + dx;
            const cy = centerCy + dy;
            const cz = centerCz + dz;
            const cwx = (cx + 0.5) * nativeSpan;
            const cwy = (cy + 0.5) * nativeSpan;
            const cwz = (cz + 0.5) * nativeSpan;
            const key = `1:${cx},${cy},${cz}`;
            const existing = this.sparseChunks.get(key);
            if (!existing) {
              const dApprox = this.evalAnalyticalAt(cwx, cwy, cwz, true).density;
              if (Math.abs(dApprox) > nativeHalfDiag * 1.55) continue;
            }
            desiredKeys.add(key);
            if (!existing || existing.dirty) {
              pendingNative++;
              const dSq =
                (cwx - surfF[0]) * (cwx - surfF[0]) +
                (cwy - surfF[1]) * (cwy - surfF[1]) +
                (cwz - surfF[2]) * (cwz - surfF[2]);
              wantQueue.push({
                cx,
                cy,
                cz,
                scaleMult: 1,
                tier: 'native',
                prio: (existing?.edited ? 0 : 1e3) + dSq,
              });
            } else {
              existing.lastUsedFrame = this.streamFrame;
            }
          }
        }
      }
    }

    const totalPendingBefore = wantQueue.length;
    if (wantQueue.length > 0) {
      wantQueue.sort((a, b) => a.prio - b.prio);
      const lim = Math.min(maxBuildPerFrame, wantQueue.length);
      for (let i = 0; i < lim; i++) {
        const w = wantQueue[i];
        const ch = this.getOrCreateSparseChunk(w.cx, w.cy, w.cz, w.scaleMult);
        ch.dirty = false;
        rebuiltMeshes.push({
          key: ch.key,
          tier: w.tier,
          mesh: this.extractSparseChunkMesh(ch, blocky),
        });
        if (w.tier === 'native') pendingNative = Math.max(0, pendingNative - 1);
        else if (w.tier === 'mid') pendingMid = Math.max(0, pendingMid - 1);
        else if (w.tier === 'midOuter') pendingMidOuter = Math.max(0, pendingMidOuter - 1);
        else if (w.tier === 'globe') pendingGlobe = Math.max(0, pendingGlobe - 1);
        else if (w.inCore) pendingHemiCore = Math.max(0, pendingHemiCore - 1);
      }
    }

    this.evictUnusedSparseChunks(4800, desiredKeys);

    const safeCapDot = clamp(minHemiDot + 0.1, -0.05, 0.92);
    const safeEdgeDist =
      safeCapDot > 0
        ? this.baseRadius * Math.sqrt(Math.max(0.08, 2 * (1 - safeCapDot) * 0.82))
        : this.baseRadius * 1.32;
    const hemiDiscardRadius =
      pendingHemiCore === 0
        ? clamp(safeEdgeDist, this.baseRadius * 0.45, this.baseRadius * 1.32)
        : 0;
    const midOuterDiscardRadius =
      useMidOuter && pendingMidOuter === 0 ? midOuterSpan * 2.45 : 0;
    const midDiscardRadius =
      useMidTier && pendingMid === 0 ? midSpan * 3.25 : 0;
    const nativeDiscardRadius =
      useSeparateNative && pendingNative === 0 ? nativeSpan * 1.82 : 0;
    const globeBuiltComplete = pendingHemiCore === 0 && pendingGlobe === 0;

    return {
      active: true,
      hideMacro: globeBuiltComplete,
      globeBuiltComplete,
      hemiCenter,
      hemiDiscardRadius,
      midOuterCenter: [midOuterCenterX, midOuterCenterY, midOuterCenterZ],
      midOuterDiscardRadius,
      midCenter: [midCenterX, midCenterY, midCenterZ],
      midDiscardRadius,
      nativeCenter: [nCenterX, nCenterY, nCenterZ],
      nativeDiscardRadius,
      pendingTotal: Math.max(0, totalPendingBefore - rebuiltMeshes.length),
      desiredKeys,
      rebuiltMeshes,
    };
  }
}
