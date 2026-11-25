import { fbm3D, ridged3D, seedNoise } from './noise';
import {
  CORNER_OFFSETS,
  EDGE_TABLE,
  EDGE_VERTEX_PAIRS,
  TRI_TABLE,
} from './marchingCubesTables';
import { DEFAULT_PLANET_RADIUS } from './gravity';
import {
  EulerianFvmGrid,
  FvmGridOptions,
  SystemBoundaryMode,
  VoxControlVolume,
} from './metabolism/eulerianFvm';
import { createOpenAutocatalyticHypergraph } from './metabolism/reactionHypergraph';

export enum MaterialId {
  Air = 0,
  Soil = 1,
  Stone = 2,
  Basalt = 3,
  Crystal = 4,
  Ice = 5,
  Sandstone = 6,
}

export type BrushMode =
  | 'probe'
  | 'carve'
  | 'tunnel'
  | 'laser'
  | 'bore'
  | 'build'
  | 'extrude'
  | 'smooth'
  | 'flatten'
  | 'paint'
  | 'crater'
  | 'volcano'
  | 'quake'
  | 'water'
  | 'drain';

export interface BrushApplyOptions {
  ex?: number;
  ey?: number;
  ez?: number;
  shape?: 'sphere' | 'cylinder';
  rimMaterial?: MaterialId;
  rimHeight?: number;
  floorMaterial?: MaterialId;
  jaggedNoise?: number;
}

export type ChunkLodLevel = 0 | 1 | 2;
export type TerrainRenderMode = 'smooth' | 'blocky';
export type TerrainOverlayMode = 'material' | 'temperature' | 'density' | 'lod' | 'metabolism';

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
  {
    id: 'pangaea_epic',
    label: '史诗盘古 · 沧海桑田',
    desc: '26m 辽阔陆海、高分辨率雪峰大河、阶梯高原与熔融地核',
    config: {
      seed: 314159,
      radius: 26.0,
      voxelRadius: 384,
      continentAmp: 2.55,
      ridgeAmp: 3.15,
      ridgeFreq: 2.2,
      craterCount: 4,
      craterDepth: 3.6,
      caveDensity: 0.9,
      crystalRichness: 0.52,
      waterFill: 1.35,
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
  fvmControlVolume?: VoxControlVolume;
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
  [MaterialId.Soil]: { rgb: [0.19, 0.45, 0.21], rough: 0.88, metal: 0.02, glow: 0 },
  [MaterialId.Stone]: { rgb: [0.46, 0.49, 0.54], rough: 0.84, metal: 0.05, glow: 0 },
  [MaterialId.Basalt]: { rgb: [0.21, 0.23, 0.28], rough: 0.78, metal: 0.12, glow: 0 },
  [MaterialId.Crystal]: { rgb: [0.16, 0.82, 0.88], rough: 0.18, metal: 0.25, glow: 0.65 },
  [MaterialId.Ice]: { rgb: [0.91, 0.95, 0.99], rough: 0.24, metal: 0.03, glow: 0.04 },
  [MaterialId.Sandstone]: { rgb: [0.75, 0.56, 0.39], rough: 0.86, metal: 0.02, glow: 0 },
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

function distPointToSegment(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const vz = bz - az;
  const lenSq = vx * vx + vy * vy + vz * vz;
  if (lenSq <= 1e-12) {
    return Math.hypot(px - ax, py - ay, pz - az);
  }
  const t = clamp(
    ((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / lenSq,
    0,
    1,
  );
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t), pz - (az + vz * t));
}

function distSegmentToAabbSq(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): number {
  const mx = (minX + maxX) * 0.5;
  const my = (minY + maxY) * 0.5;
  const mz = (minZ + maxZ) * 0.5;
  const vx = bx - ax;
  const vy = by - ay;
  const vz = bz - az;
  const lenSq = vx * vx + vy * vy + vz * vz;
  let t =
    lenSq > 1e-12
      ? clamp(((mx - ax) * vx + (my - ay) * vy + (mz - az) * vz) / lenSq, 0, 1)
      : 0;
  let sx = ax + vx * t;
  let sy = ay + vy * t;
  let sz = az + vz * t;
  let qx = clamp(sx, minX, maxX);
  let qy = clamp(sy, minY, maxY);
  let qz = clamp(sz, minZ, maxZ);

  if (lenSq > 1e-12) {
    t = clamp(((qx - ax) * vx + (qy - ay) * vy + (qz - az) * vz) / lenSq, 0, 1);
    sx = ax + vx * t;
    sy = ay + vy * t;
    sz = az + vz * t;
    qx = clamp(sx, minX, maxX);
    qy = clamp(sy, minY, maxY);
    qz = clamp(sz, minZ, maxZ);
  }

  const dx = sx - qx;
  const dy = sy - qy;
  const dz = sz - qz;
  return dx * dx + dy * dy + dz * dz;
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
  built: boolean;
  isEmpty: boolean;
  lastSeamMask: number;
  lastUsedFrame: number;
}

type SculptBrushMode = Exclude<BrushMode, 'water' | 'drain' | 'probe'>;

interface BrushOpRecord {
  cx: number;
  cy: number;
  cz: number;
  ex: number;
  ey: number;
  ez: number;
  shape: 'sphere' | 'cylinder';
  mode: Exclude<SculptBrushMode, 'smooth'>;
  radius: number;
  strength: number;
  materialId: MaterialId;
  targetShellRadius: number;
  rimMaterial?: MaterialId;
  rimHeight?: number;
  floorMaterial?: MaterialId;
  jaggedNoise?: number;
}

interface StructuralBasinSpec {
  dx: number;
  dy: number;
  dz: number;
  cosRad: number;
  depth: number;
  rimHeight: number;
}

interface GreatRiverSpec {
  centerDx: number;
  centerDy: number;
  centerDz: number;
  minDot: number;
  halfWidthRad: number;
  depth: number;
  pts: Array<[number, number, number]>; // unit sphere waypoints
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
  basins: StructuralBasinSpec[];
  rivers: GreatRiverSpec[];
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
  retainKeys: Set<string>;
  rebuiltMeshes: Array<{
    key: string;
    tier: 'globe' | 'hemi' | 'midOuter' | 'mid' | 'native';
    scaleMult: number;
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
  private brushOps: BrushOpRecord[] = [];
  private svRootBuilt = false;
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
  public fvmGrid: EulerianFvmGrid | null = null;
  private interiorCutawayActive = false;
  private preCutawayDensity: Float32Array | null = null;
  private preCutawayMaterial: Uint8Array | null = null;

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

    // 3 broad structural basins (sedimentary inland/oceanic depressions)
    const basins: StructuralBasinSpec[] = [];
    for (let b = 0; b < 3; b++) {
      const ang = phaseOffset + 0.8 + b * 2.15 + (rand() - 0.5) * 0.45;
      const tilt = 0.78 + rand() * 0.65;
      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);
      let bdx = spawnDir[0] * cosT + (t1x * Math.cos(ang) + t2x * Math.sin(ang)) * sinT;
      let bdy = spawnDir[1] * cosT + (t1y * Math.cos(ang) + t2y * Math.sin(ang)) * sinT;
      let bdz = spawnDir[2] * cosT + (t1z * Math.cos(ang) + t2z * Math.sin(ang)) * sinT;
      const bLen = Math.hypot(bdx, bdy, bdz) || 1;
      bdx /= bLen;
      bdy /= bLen;
      bdz /= bLen;
      const angRad = 0.28 + rand() * 0.14;
      basins.push({
        dx: bdx,
        dy: bdy,
        dz: bdz,
        cosRad: Math.cos(angRad),
        depth: 1.45 + rand() * 0.95,
        rimHeight: 0.42 + rand() * 0.28,
      });
    }

    // 3 sinuous Great Rivers flowing from highland ridges toward basins/oceans
    const rivers: GreatRiverSpec[] = [];
    for (let rIdx = 0; rIdx < 3; rIdx++) {
      const targetBasin = basins[rIdx % basins.length];
      const startAng = phaseOffset + rIdx * 2.09 + 0.35;
      const startTilt = 0.55 + rand() * 0.35;
      let sx = spawnDir[0] * Math.cos(startTilt) + (t1x * Math.cos(startAng) + t2x * Math.sin(startAng)) * Math.sin(startTilt);
      let sy = spawnDir[1] * Math.cos(startTilt) + (t1y * Math.cos(startAng) + t2y * Math.sin(startAng)) * Math.sin(startTilt);
      let sz = spawnDir[2] * Math.cos(startTilt) + (t1z * Math.cos(startAng) + t2z * Math.sin(startAng)) * Math.sin(startTilt);
      const sMag = Math.hypot(sx, sy, sz) || 1;
      sx /= sMag; sy /= sMag; sz /= sMag;

      const ex = targetBasin.dx;
      const ey = targetBasin.dy;
      const ez = targetBasin.dz;
      // Lateral meander axis perpendicular to river chord
      let lx = sy * ez - sz * ey;
      let ly = sz * ex - sx * ez;
      let lz = sx * ey - sy * ex;
      const lMag = Math.hypot(lx, ly, lz) || 1;
      lx /= lMag; ly /= lMag; lz /= lMag;

      const pts: Array<[number, number, number]> = [];
      const segs = 6;
      const meanderAmp = 0.14 + rand() * 0.08;
      const meanderFreq = Math.PI * (2.2 + rand() * 0.8);
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const wiggle = Math.sin(t * meanderFreq) * meanderAmp * Math.sin(t * Math.PI);
        let px = sx + (ex - sx) * t + lx * wiggle;
        let py = sy + (ey - sy) * t + ly * wiggle;
        let pz = sz + (ez - sz) * t + lz * wiggle;
        const pMag = Math.hypot(px, py, pz) || 1;
        pts.push([px / pMag, py / pMag, pz / pMag]);
      }

      let mx = 0;
      let my = 0;
      let mz = 0;
      for (const p of pts) {
        mx += p[0];
        my += p[1];
        mz += p[2];
      }
      const mMag = Math.hypot(mx, my, mz) || 1;
      mx /= mMag; my /= mMag; mz /= mMag;
      let minDot = 1.0;
      for (const p of pts) {
        const d = p[0] * mx + p[1] * my + p[2] * mz;
        if (d < minDot) minDot = d;
      }
      const halfWidthRad = 0.072;
      rivers.push({
        centerDx: mx,
        centerDy: my,
        centerDz: mz,
        minDot: Math.cos(Math.acos(clamp(minDot, -1, 1)) + halfWidthRad * 2.2),
        halfWidthRad,
        depth: 0.92 + rand() * 0.35,
        pts,
      });
    }

    const ctx: AnalyticalContext = {
      cfg,
      rScale,
      seedOffX,
      seedOffY,
      seedOffZ,
      iceLatThresh,
      sandBias,
      craters,
      basins,
      rivers,
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

  private evalEpicLandformDeltas(
    nx: number,
    ny: number,
    nz: number,
    continent: number,
    ridge: number,
    rScale: number,
  ): {
    plateauOffset: number;
    basinOffset: number;
    fjordCarve: number;
    riverCarve: number;
    terracedRidge: number;
    inBasinFloor: boolean;
    inRiverBank: boolean;
  } {
    const { cfg, seedOffX, seedOffY, seedOffZ, basins, rivers } = this.genCtx;

    const isEpicWorld = cfg.seed === 314159 || cfg.continentAmp >= 2.4;
    if (!isEpicWorld) {
      return {
        plateauOffset: 0,
        basinOffset: 0,
        fjordCarve: 0,
        riverCarve: 0,
        terracedRidge: 0,
        inBasinFloor: continent < -0.18,
        inRiverBank: false,
      };
    }
    const epicAmp = 1.0;

    // 1. Stepped Highland Plateaus (高原) & Domain-Warped Alpine Ranges
    let plateauOffset = 0;
    let terracedRidge = 0;
    if (isEpicWorld) {
      const orogenMask = smoothstep(-0.06, 0.48, continent);
      const sharpCrest = Math.pow(clamp(ridge, 0, 1.3), 1.45);
      const rawMount = orogenMask * sharpCrest * 1.15 * cfg.ridgeAmp;
      // Subtle stepped contour terracing along alpine slopes
      const terraceWave = Math.sin(rawMount * 4.4) * 0.075 * orogenMask;
      terracedRidge = (rawMount + terraceWave) * rScale;

      if (continent > 0.14) {
        const plateauStep = smoothstep(0.14, 0.36, continent);
        const mesaCap = Math.min(ridge, 0.56) * 0.4 + 0.48;
        plateauOffset =
          plateauStep *
          (0.68 * cfg.continentAmp * 0.44 + (mesaCap - 0.5) * 0.28) *
          rScale;
      }
    } else if (continent > 0.18) {
      const plateauStep = smoothstep(0.18, 0.38, continent);
      const mesaCap = Math.min(ridge, 0.58) * 0.45 + 0.52;
      plateauOffset =
        plateauStep *
        (0.72 * cfg.continentAmp * 0.48 + (mesaCap - 0.5) * 0.35) *
        epicAmp *
        rScale;
    }

    // 2. Broad Flat-Floored Structural & Glacial Lake Basins (盆地/冰川湖泊)
    let basinOffset = 0;
    let inBasinFloor = continent < -0.16;
    for (let b = 0; b < basins.length; b++) {
      const bs = basins[b];
      const dot = nx * bs.dx + ny * bs.dy + nz * bs.dz;
      if (dot > bs.cosRad) {
        const norm = (1 - dot) / Math.max(1e-5, 1 - bs.cosRad);
        if (norm < 0.76) {
          // Flat center lakebed floor rising gently along scenic shores
          const bowl = 1 - smoothstep(0.32, 0.76, norm);
          basinOffset -= bowl * bs.depth * epicAmp * rScale;
          inBasinFloor = true;
        } else {
          const shoulder = Math.sin(clamp((norm - 0.76) / 0.24, 0, 1) * Math.PI);
          basinOffset += shoulder * bs.rimHeight * epicAmp * rScale;
        }
      }
    }

    // 3. Glacial Coastal Fjords (峡湾): deep U-shaped valleys along cold coastal margins
    let fjordCarve = 0;
    const absLat = Math.abs(ny);
    if (absLat > 0.34 && continent > -0.28 && continent < 0.3) {
      const coastWeight =
        smoothstep(0.34, 0.56, absLat) * (1 - Math.abs(continent - 0.02) / 0.3);
      if (coastWeight > 0.02) {
        const fjordChannel = ridged3D(
          nx * 5.2 + seedOffX * 0.13,
          ny * 2.1 + seedOffY * 0.13,
          nz * 5.2 - seedOffZ * 0.13,
          2,
        );
        if (fjordChannel > 0.66) {
          const incise = smoothstep(0.66, 0.93, fjordChannel);
          fjordCarve = incise * coastWeight * 1.48 * epicAmp * rScale;
        }
      }
    }

    // 4. Great Sinuous Rivers (大河): wide meandering channels flowing from highlands to basins/sea
    let riverCarve = 0;
    let inRiverBank = false;
    for (let i = 0; i < rivers.length; i++) {
      const rv = rivers[i];
      if (nx * rv.centerDx + ny * rv.centerDy + nz * rv.centerDz < rv.minDot) {
        continue;
      }
      let minSegDist = Infinity;
      let progressT = 0;
      const pts = rv.pts;
      for (let s = 0; s < pts.length - 1; s++) {
        const a = pts[s];
        const b = pts[s + 1];
        const vx = b[0] - a[0];
        const vy = b[1] - a[1];
        const vz = b[2] - a[2];
        const lenSq = vx * vx + vy * vy + vz * vz;
        const proj =
          lenSq > 1e-8
            ? clamp(((nx - a[0]) * vx + (ny - a[1]) * vy + (nz - a[2]) * vz) / lenSq, 0, 1)
            : 0;
        const d = Math.hypot(nx - (a[0] + vx * proj), ny - (a[1] + vy * proj), nz - (a[2] + vz * proj));
        if (d < minSegDist) {
          minSegDist = d;
          progressT = (s + proj) / (pts.length - 1);
        }
      }
      const localHalfW = rv.halfWidthRad * (0.85 + progressT * 1.15);
      if (minSegDist < localHalfW * 1.75) {
        inRiverBank = true;
        if (minSegDist < localHalfW) {
          const channelProfile = 1 - smoothstep(localHalfW * 0.25, localHalfW, minSegDist);
          riverCarve = Math.max(
            riverCarve,
            channelProfile * rv.depth * epicAmp * (0.88 + progressT * 0.55) * rScale,
          );
        }
      }
    }

    return { plateauOffset, basinOffset, fjordCarve, riverCarve, terracedRidge, inBasinFloor, inRiverBank };
  }

  private evalUnflattenedRadius(nx: number, ny: number, nz: number): number {
    const { cfg, rScale, seedOffX, seedOffY, seedOffZ, craters } = this.genCtx;
    const isEpicWorld = cfg.seed === 314159 || cfg.continentAmp >= 2.4;
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
    const warpX = isEpicWorld ? fbm3D(nx * 2.1 + 3.7, ny * 2.1, nz * 2.1 - 1.9, 2) * 0.24 : 0;
    const warpY = isEpicWorld ? fbm3D(ny * 2.1 - 2.3, nz * 2.1 + 4.1, nx * 2.1, 2) * 0.24 : 0;
    const ridge = ridged3D(
      (nx + warpX) * cfg.ridgeFreq + 5.1 + seedOffX * 0.11,
      (ny + warpY) * cfg.ridgeFreq + seedOffY * 0.11,
      (nz - warpX) * cfg.ridgeFreq - 3.2 + seedOffZ * 0.11,
      3,
    );
    const micro =
      fbm3D(wxN * 0.22 + seedOffX * 0.05, wyN * 0.22 + seedOffY * 0.05, wzN * 0.22 + seedOffZ * 0.05, 2) *
      (isEpicWorld ? 0.24 : 0.42) *
      rScale;

    const epic = this.evalEpicLandformDeltas(nx, ny, nz, continent, ridge, rScale);

    const ridgeContribution = isEpicWorld
      ? epic.terracedRidge + (ridge - 0.42) * 0.28 * cfg.ridgeAmp * rScale
      : (ridge - 0.38) * cfg.ridgeAmp * rScale;

    let targetRadius =
      this.baseRadius +
      continent * cfg.continentAmp * rScale +
      ridgeContribution +
      epic.plateauOffset +
      epic.basinOffset -
      epic.fjordCarve -
      epic.riverCarve +
      micro;

    if (isEpicWorld && continent < -0.14) {
      const seaFloorBlend = smoothstep(-0.14, -0.45, continent);
      const flatBed = this.baseRadius - 1.35 * rScale;
      targetRadius = targetRadius * (1 - seaFloorBlend * 0.55) + flatBed * (seaFloorBlend * 0.55);
    }

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
    sampleScale = 0,
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

    const isEpicWorld = cfg.seed === 314159 || cfg.continentAmp >= 2.4;
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
    const warpX = isEpicWorld ? fbm3D(nx * 2.1 + 3.7, ny * 2.1, nz * 2.1 - 1.9, 2) * 0.24 : 0;
    const warpY = isEpicWorld ? fbm3D(ny * 2.1 - 2.3, nz * 2.1 + 4.1, nx * 2.1, 2) * 0.24 : 0;
    const ridge = ridged3D(
      (nx + warpX) * cfg.ridgeFreq + 5.1 + seedOffX * 0.11,
      (ny + warpY) * cfg.ridgeFreq + seedOffY * 0.11,
      (nz - warpX) * cfg.ridgeFreq - 3.2 + seedOffZ * 0.11,
      3,
    );
    const micro =
      fbm3D(
        wxN * 0.22 + seedOffX * 0.05,
        wyN * 0.22 + seedOffY * 0.05,
        wzN * 0.22 + seedOffZ * 0.05,
        2,
      ) *
      (isEpicWorld ? 0.24 : 0.42) *
      rScale;

    const epic = this.evalEpicLandformDeltas(nx, ny, nz, continent, ridge, rScale);

    const ridgeContribution = isEpicWorld
      ? epic.terracedRidge + (ridge - 0.42) * 0.28 * cfg.ridgeAmp * rScale
      : (ridge - 0.38) * cfg.ridgeAmp * rScale;

    let targetRadius =
      this.baseRadius +
      continent * cfg.continentAmp * rScale +
      ridgeContribution +
      epic.plateauOffset +
      epic.basinOffset -
      epic.fjordCarve -
      epic.riverCarve +
      micro;

    if (isEpicWorld && continent < -0.14) {
      const seaFloorBlend = smoothstep(-0.14, -0.45, continent);
      const flatBed = this.baseRadius - 1.35 * rScale;
      targetRadius = targetRadius * (1 - seaFloorBlend * 0.55) + flatBed * (seaFloorBlend * 0.55);
    }

    // Multi-octave high-resolution terrain terraces & cliff relief when voxelRadius >> 18
    if (includeMicroDetail && detailLogScale > 0.3) {
      const fineAmp = Math.min(isEpicWorld ? 0.16 : 0.24, detailLogScale * 0.028) * rScale;
      const fineWave = fbm3D(wxN * 1.85 + seedOffX, wyN * 1.85 + seedOffY, wzN * 1.85 + seedOffZ, 2) * fineAmp;
      targetRadius += fineWave;
      if (detailLogScale > 2.2 && (sampleScale === 0 || sampleScale <= this.nativeVoxelSize * 96)) {
        const blockWaveFreq = 1 / Math.max(this.nativeVoxelSize * 14, 1e-12);
        const bx = (((wx * blockWaveFreq) % 256) + 256) % 256;
        const by = (((wy * blockWaveFreq) % 256) + 256) % 256;
        const bz = (((wz * blockWaveFreq) % 256) + 256) % 256;
        const blockRelief =
          fbm3D(bx + seedOffX, by + seedOffY, bz + seedOffZ, 2, 2.0, 0.5) *
          this.nativeVoxelSize *
          (isEpicWorld ? 1.8 : 2.6);
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

    const caveMinR = cfg.radius * 0.30;
    const caveMaxR = cfg.radius * 0.74;
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
    // Core–Mantle–Crust radial & alpine-biome differentiation
    const alpineSnowAlt = this.baseRadius + (isEpicWorld ? 1.85 - absLat * 1.25 : 2.9 - absLat * 1.2) * rScale;
    let mat: MaterialId;
    if (r < cfg.radius * 0.17) {
      // Inner metallic-crystalline Core
      mat = MaterialId.Crystal;
    } else if (r < cfg.radius * 0.30) {
      // Molten Outer Core
      mat = crystalVein > 0.72 ? MaterialId.Crystal : MaterialId.Basalt;
    } else if (r < cfg.radius * 0.79) {
      // Convective Mantle + rising magma plume conduits
      const mantlePlume = ridged3D(nx * 2.3 + seedOffX * 0.05, ny * 2.3 + seedOffY * 0.05, nz * 2.3, 2);
      mat =
        mantlePlume > 0.78 || crystalVein > crystalThreshMid
          ? MaterialId.Crystal
          : r < cfg.radius * 0.52
            ? MaterialId.Basalt
            : MaterialId.Stone;
    } else if (
      r > alpineSnowAlt ||
      (absLat > iceLatThresh && (r > this.baseRadius + 0.35 * rScale || epic.fjordCarve > 0.22 * rScale))
    ) {
      mat = MaterialId.Ice;
    } else if (epic.fjordCarve > 0.25 * rScale && r > this.baseRadius - 0.4 * rScale) {
      mat = absLat > 0.54 ? MaterialId.Ice : MaterialId.Stone;
    } else if (r > this.baseRadius + (isEpicWorld ? 1.15 : 1.85) * rScale) {
      mat = epic.plateauOffset > 0.45 * rScale && r < this.baseRadius + 1.8 * rScale ? MaterialId.Sandstone : MaterialId.Stone;
    } else if (epic.inBasinFloor && r < this.baseRadius - 0.65 * rScale) {
      mat = MaterialId.Basalt;
    } else if (
      inCraterRim ||
      epic.inRiverBank ||
      Math.abs(r - (this.baseRadius - 0.12 * rScale)) < 0.24 * rScale ||
      continent < sandBias
    ) {
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
    this.brushOps = [];
    this.svRootBuilt = false;
    this.interiorCutawayActive = false;
    this.preCutawayDensity = null;
    this.preCutawayMaterial = null;
    this.genCtx = this.buildAnalyticalContext(cfg);
    this.lakeBasinCenters = [
      ...this.genCtx.craters.slice(0, 3).map((c): [number, number, number] => [c.x, c.y, c.z]),
      ...this.genCtx.basins
        .slice(0, 2)
        .map((b): [number, number, number] => [
          b.dx * cfg.radius * 0.96,
          b.dy * cfg.radius * 0.96,
          b.dz * cfg.radius * 0.96,
        ]),
    ];

    const gridN = this.gridN;
    const cpa = this.chunksPerAxis;
    const { minEvalR, maxSurfR, rScale } = this.getRadialEvalBounds();
    const edgeClip = this.worldHalf * 0.94;
    const includeMicro = !this.isHighResStreaming || this.gridN <= 64;
    const evalMask = this.computeChunkEvalMask();

    const evalInteriorMat = (r: number): MaterialId => {
      if (r < cfg.radius * 0.17) return MaterialId.Crystal;
      if (r < cfg.radius * 0.30) return MaterialId.Basalt;
      if (r < cfg.radius * 0.52) return MaterialId.Basalt;
      return MaterialId.Stone;
    };

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
              this.material[idx] = d > 0 ? evalInteriorMat(r) : MaterialId.Air;
            } else {
              this.density[idx] = d;
              this.material[idx] = evalInteriorMat(r);
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
    this.brushOps = [];
    this.svRootBuilt = false;
    this.interiorCutawayActive = false;
    this.preCutawayDensity = null;
    this.preCutawayMaterial = null;
    this.genCtx = this.buildAnalyticalContext(cfg);
    this.lakeBasinCenters = [
      ...this.genCtx.craters.slice(0, 3).map((c): [number, number, number] => [c.x, c.y, c.z]),
      ...this.genCtx.basins
        .slice(0, 2)
        .map((b): [number, number, number] => [
          b.dx * cfg.radius * 0.96,
          b.dy * cfg.radius * 0.96,
          b.dz * cfg.radius * 0.96,
        ]),
    ];

    onProgress?.(0.02, '初始化星球参数与表面分块掩码');

    const gridN = this.gridN;
    const cpa = this.chunksPerAxis;
    const { minEvalR, maxSurfR, rScale } = this.getRadialEvalBounds();
    const edgeClip = this.worldHalf * 0.94;
    const includeMicro = !this.isHighResStreaming || this.gridN <= 64;
    const evalMask = this.computeChunkEvalMask();
    let sliceStart = performance.now();

    const evalInteriorMat = (r: number): MaterialId => {
      if (r < cfg.radius * 0.17) return MaterialId.Crystal;
      if (r < cfg.radius * 0.30) return MaterialId.Basalt;
      if (r < cfg.radius * 0.52) return MaterialId.Basalt;
      return MaterialId.Stone;
    };

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
              this.material[idx] = d > 0 ? evalInteriorMat(r) : MaterialId.Air;
            } else {
              this.density[idx] = d;
              this.material[idx] = evalInteriorMat(r);
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
    this.interiorCutawayActive = false;
    this.preCutawayDensity = null;
    this.preCutawayMaterial = null;
    this.genCtx = this.buildAnalyticalContext(this.seedConfig);
    this.sparseChunks.clear();
    this.brushOps = [];
    this.svRootBuilt = false;
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
          built: true,
          isEmpty: false,
          lastSeamMask: -1,
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

    let fvmControlVolume: VoxControlVolume | undefined;
    if (this.fvmGrid) {
      const fn = this.fvmGrid.cellsPerAxis;
      const fx = clamp(Math.floor((wx + this.fvmGrid.worldHalf) / this.fvmGrid.voxelSize), 0, fn - 1);
      const fy = clamp(Math.floor((wy + this.fvmGrid.worldHalf) / this.fvmGrid.voxelSize), 0, fn - 1);
      const fz = clamp(Math.floor((wz + this.fvmGrid.worldHalf) / this.fvmGrid.voxelSize), 0, fn - 1);
      fvmControlVolume = this.fvmGrid.getVoxControlVolume(fx, fy, fz);
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
      fvmControlVolume,
    };
  }

  /**
   * Upgrades this VoxelPlanet's Chunk/Vox structure into an attached Eulerian Finite Volume
   * control-volume grid without modifying graphical density/material arrays.
   */
  public upgradeChunksToEulerianFvm(
    options?: Partial<Omit<FvmGridOptions, 'worldHalf' | 'baseRadius'>> & {
      chunksPerAxis?: number;
      boundaryMode?: SystemBoundaryMode;
    },
  ): EulerianFvmGrid {
    const targetChunks =
      options?.chunksPerAxis ?? (this.chunksPerAxis <= 3 ? this.chunksPerAxis : 3);
    const hypergraph = options?.hypergraph ?? createOpenAutocatalyticHypergraph();
    const grid = new EulerianFvmGrid({
      chunksPerAxis: targetChunks,
      worldHalf: this.worldHalf,
      baseRadius: this.baseRadius,
      hypergraph,
      boundaryMode: options?.boundaryMode ?? 'open',
      feedRatePerSec: options?.feedRatePerSec,
      exhaustRatePerSec: options?.exhaustRatePerSec,
      feedSpeciesIndex: options?.feedSpeciesIndex,
      feedConcentrationMolM3: options?.feedConcentrationMolM3,
      ambientTempK: options?.ambientTempK,
      ambientPressureAtm: options?.ambientPressureAtm,
    });

    const n = grid.cellsPerAxis;
    const minShellR = this.baseRadius * 0.62;
    const maxShellR = this.baseRadius * 1.22;
    for (let iz = 0; iz < n; iz++) {
      for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
          const [wx, wy, wz] = grid.cellCenterWorld(ix, iy, iz);
          const idx = grid.cellIndex(ix, iy, iz);
          const r = Math.hypot(wx, wy, wz);
          if (r < minShellR || r > maxShellR) {
            grid.activeMask[idx] = 0;
            grid.porosity[idx] = 0;
            continue;
          }
          const d = this.sampleDensity(wx, wy, wz, true);
          const mat = this.sampleNearestMaterial(wx, wy, wz);
          const nearSurface = Math.abs(d) < grid.voxelSize * 2.2;
          grid.activeMask[idx] = 1;
          grid.porosity[idx] =
            d <= 0
              ? 1.0
              : nearSurface
                ? 0.65
                : mat === MaterialId.Crystal || mat === MaterialId.Sandstone
                  ? 0.45
                  : 0.22;
        }
      }
    }
    grid.rebuildActiveCellList();
    grid.syncInternalEnergyFromTemp();
    this.fvmGrid = grid;
    return grid;
  }

  public getVoxControlVolume(ix: number, iy: number, iz: number): VoxControlVolume | null {
    if (!this.fvmGrid) return null;
    const fn = this.fvmGrid.cellsPerAxis;
    const fx =
      this.cellsPerAxis === fn
        ? clamp(ix, 0, fn - 1)
        : clamp(Math.floor((ix / Math.max(1, this.cellsPerAxis)) * fn), 0, fn - 1);
    const fy =
      this.cellsPerAxis === fn
        ? clamp(iy, 0, fn - 1)
        : clamp(Math.floor((iy / Math.max(1, this.cellsPerAxis)) * fn), 0, fn - 1);
    const fz =
      this.cellsPerAxis === fn
        ? clamp(iz, 0, fn - 1)
        : clamp(Math.floor((iz / Math.max(1, this.cellsPerAxis)) * fn), 0, fn - 1);
    return this.fvmGrid.getVoxControlVolume(fx, fy, fz);
  }

  public isInteriorCutawayEnabled(): boolean {
    return this.interiorCutawayActive;
  }

  /**
   * Toggles a reversible 90° spherical cross-section cutaway (+X, +Y, +Z octant)
   * leaving the glowing Inner Core sphere exposed inside the Outer Core, Mantle, and Crust.
   */
  public setInteriorCutaway(enabled: boolean): boolean {
    if (enabled === this.interiorCutawayActive) return false;
    const gridN = this.gridN;
    const rScale = this.baseRadius / 13.0;
    const innerCoreR = this.baseRadius * 0.19;

    if (enabled) {
      this.preCutawayDensity = new Float32Array(this.density);
      this.preCutawayMaterial = new Uint8Array(this.material);
      for (let iz = 0; iz < gridN; iz++) {
        const wz = this.gridToWorld(iz);
        if (wz <= -0.15 * rScale) continue;
        for (let iy = 0; iy < gridN; iy++) {
          const wy = this.gridToWorld(iy);
          if (wy <= -0.15 * rScale) continue;
          for (let ix = 0; ix < gridN; ix++) {
            const wx = this.gridToWorld(ix);
            if (wx <= -0.15 * rScale) continue;
            const r = Math.hypot(wx, wy, wz);
            if (r <= innerCoreR) continue;
            const idx = this.gridIndex(ix, iy, iz);
            const cutDist = Math.min(wx, wy, wz);
            const shellClear = r - innerCoreR;
            const carveVal = -Math.min(cutDist + 0.05 * rScale, shellClear);
            if (carveVal < this.density[idx]) {
              this.density[idx] = carveVal;
              if (carveVal <= 0) {
                this.material[idx] = MaterialId.Air;
              }
            }
          }
        }
      }
      this.interiorCutawayActive = true;
    } else if (this.preCutawayDensity && this.preCutawayMaterial) {
      this.density.set(this.preCutawayDensity);
      this.material.set(this.preCutawayMaterial);
      this.preCutawayDensity = null;
      this.preCutawayMaterial = null;
      this.interiorCutawayActive = false;
    }

    const cpa = this.chunksPerAxis;
    const sY = this.gridN;
    const sZ = sY * sY;
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
          const ci = this.chunkIndex(cx, cy, cz);
          this.nonUniformChunks[ci] = anyS && anyA ? 1 : 0;
          this.dirtyChunks[ci] = 1;
        }
      }
    }
    this.voxelRevision++;
    return true;
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
      let d = this.evalAnalyticalAt(wx, wy, wz, true).density;
      if (this.brushOps.length > 0) {
        const rScale = this.baseRadius / 13.0;
        for (let i = 0; i < this.brushOps.length; i++) {
          const op = this.brushOps[i];
          const dist =
            op.shape === 'cylinder'
              ? distPointToSegment(wx, wy, wz, op.cx, op.cy, op.cz, op.ex, op.ey, op.ez)
              : Math.hypot(wx - op.cx, wy - op.cy, wz - op.cz);
          if (dist >= op.radius) continue;
          const falloff = 1 - smoothstep(0, op.radius, dist);
          if (op.mode === 'carve' || op.mode === 'tunnel' || op.mode === 'laser' || op.mode === 'bore') {
            const mult =
              op.mode === 'tunnel' || op.mode === 'laser' ? 8.0 : op.mode === 'bore' ? 4.5 : 1.0;
            d = Math.max(-4.5 * rScale, d - op.strength * rScale * mult * falloff);
          } else if (op.mode === 'build' || op.mode === 'extrude') {
            d = Math.min(4.5 * rScale, d + op.strength * rScale * falloff);
          } else if (op.mode === 'flatten') {
            const desired = op.targetShellRadius - Math.hypot(wx, wy, wz);
            d = d + (desired - d) * clamp(falloff * op.strength * 0.65, 0, 1);
          } else if (op.mode === 'crater') {
            const nr = dist / op.radius;
            if (nr < 0.72) {
              const pit = 1 - smoothstep(0, 0.72, nr);
              d = Math.max(-4.5 * rScale, d - op.strength * rScale * 2.2 * pit);
            } else if ((op.rimHeight ?? 0) > 0) {
              const rimT = Math.sin(clamp((nr - 0.68) / 0.32, 0, 1) * Math.PI);
              d = Math.min(4.5 * rScale, d + (op.rimHeight ?? 0.65) * rScale * rimT);
            }
          } else if (op.mode === 'volcano') {
            const nr = dist / op.radius;
            if (nr < 0.34) {
              const caldera = 1 - smoothstep(0, 0.34, nr);
              d = Math.max(-4.5 * rScale, d - op.strength * rScale * 1.45 * caldera);
            } else {
              const cone = 1 - smoothstep(0.32, 1.0, nr);
              d = Math.min(4.5 * rScale, d + op.strength * rScale * 2.1 * cone);
            }
          } else if (op.mode === 'quake') {
            const n = Math.sin(wx * 3.7 + wy * 2.9 - wz * 4.1) * 0.5 + 0.5;
            const crag = (n - 0.52) * 2.0 * (op.jaggedNoise ?? 1.0);
            d = clamp(d + crag * op.strength * rScale * falloff * 1.8, -4.5 * rScale, 4.5 * rScale);
          }
        }
      }
      return d;
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
   * Sculpt, pierce, extrude, paint, smooth, or flatten the planetary voxel field (and active high-res sparse chunks).
   */
  public applyBrush(
    cx: number,
    cy: number,
    cz: number,
    mode: Exclude<BrushMode, 'water' | 'drain' | 'probe'>,
    radius: number,
    strength: number,
    materialId: MaterialId,
    options?: BrushApplyOptions,
  ): BrushResult {
    const minUnit = this.isHighResStreaming
      ? Math.min(this.voxelSize, this.nativeVoxelSize)
      : this.voxelSize;
    const safeRad = Math.max(minUnit * 0.5, radius);
    const rScale = this.baseRadius / 13.0;
    const isCylinder = options?.shape === 'cylinder';
    const ex = isCylinder && options?.ex !== undefined ? options.ex : cx;
    const ey = isCylinder && options?.ey !== undefined ? options.ey : cy;
    const ez = isCylinder && options?.ez !== undefined ? options.ez : cz;
    const shape: 'sphere' | 'cylinder' = isCylinder ? 'cylinder' : 'sphere';

    const pad = safeRad + this.voxelSize * 1.5;
    const cellsPerAxis = this.cellsPerAxis;
    const minX = clamp(Math.floor(this.worldToGrid(Math.min(cx, ex) - pad)), 1, cellsPerAxis - 1);
    const maxX = clamp(Math.ceil(this.worldToGrid(Math.max(cx, ex) + pad)), 1, cellsPerAxis - 1);
    const minY = clamp(Math.floor(this.worldToGrid(Math.min(cy, ey) - pad)), 1, cellsPerAxis - 1);
    const maxY = clamp(Math.ceil(this.worldToGrid(Math.max(cy, ey) + pad)), 1, cellsPerAxis - 1);
    const minZ = clamp(Math.floor(this.worldToGrid(Math.min(cz, ez) - pad)), 1, cellsPerAxis - 1);
    const maxZ = clamp(Math.ceil(this.worldToGrid(Math.max(cz, ez) + pad)), 1, cellsPerAxis - 1);

    const targetShellRadius = Math.hypot(cx, cy, cz);
    let deltaVolume = 0;

    // 1. Update macro grid
    const macroRad = Math.max(safeRad, this.voxelSize * 0.65);
    const macroWeight = clamp(safeRad / (this.voxelSize * 0.65), 0.12, 1.0);
    let copySnapshot: Float32Array | null = null;
    if (mode === 'smooth') {
      copySnapshot = new Float32Array(this.density);
    }

    const isPiercingCarve = mode === 'tunnel' || mode === 'laser';
    const carveMult = isPiercingCarve ? 9.0 : mode === 'bore' ? 5.0 : 1.0;

    for (let iz = minZ; iz <= maxZ; iz++) {
      const wz = this.gridToWorld(iz);
      for (let iy = minY; iy <= maxY; iy++) {
        const wy = this.gridToWorld(iy);
        for (let ix = minX; ix <= maxX; ix++) {
          const wx = this.gridToWorld(ix);
          const dist =
            shape === 'cylinder'
              ? distPointToSegment(wx, wy, wz, cx, cy, cz, ex, ey, ez)
              : Math.hypot(wx - cx, wy - cy, wz - cz);
          if (dist >= macroRad) continue;

          const rawFalloff = 1 - smoothstep(0, macroRad, dist);
          const falloff =
            (isPiercingCarve
              ? Math.max(rawFalloff, dist < macroRad * 0.72 ? 1.0 : rawFalloff)
              : rawFalloff) * macroWeight;
          const idx = this.gridIndex(ix, iy, iz);
          const prev = this.density[idx];
          let next = prev;

          if (mode === 'carve' || mode === 'tunnel' || mode === 'laser' || mode === 'bore') {
            next = Math.max(-4.5 * rScale, prev - strength * rScale * carveMult * falloff);
            if (next <= 0) {
              this.material[idx] = MaterialId.Air;
            } else if (
              options?.rimMaterial !== undefined &&
              options.rimMaterial !== MaterialId.Air &&
              dist >= macroRad * 0.62
            ) {
              this.material[idx] = options.rimMaterial;
            }
          } else if (mode === 'crater') {
            const nr = dist / macroRad;
            const rimH = options?.rimHeight ?? 0;
            if (nr < 0.72) {
              const pit = 1 - smoothstep(0, 0.72, nr);
              next = Math.max(-4.5 * rScale, prev - strength * rScale * 2.4 * macroWeight * pit);
              if (next <= 0) {
                this.material[idx] = MaterialId.Air;
              } else if (
                options?.floorMaterial !== undefined &&
                options.floorMaterial !== MaterialId.Air
              ) {
                this.material[idx] = options.floorMaterial;
              }
            } else if (rimH > 0) {
              const rimT = Math.sin(clamp((nr - 0.68) / 0.32, 0, 1) * Math.PI);
              next = Math.min(4.5 * rScale, prev + rimH * rScale * macroWeight * rimT);
              if (
                next > -0.2 * rScale &&
                ((options?.rimMaterial !== undefined && options.rimMaterial !== MaterialId.Air) ||
                  materialId !== MaterialId.Air)
              ) {
                this.material[idx] =
                  options?.rimMaterial !== undefined && options.rimMaterial !== MaterialId.Air
                    ? options.rimMaterial
                    : materialId;
              }
            } else {
              if (
                next > 0 &&
                options?.floorMaterial !== undefined &&
                options.floorMaterial !== MaterialId.Air
              ) {
                this.material[idx] = options.floorMaterial;
              }
            }
          } else if (mode === 'volcano') {
            const nr = dist / macroRad;
            if (nr < 0.34) {
              const caldera = 1 - smoothstep(0, 0.34, nr);
              next = Math.max(-4.5 * rScale, prev - strength * rScale * 1.5 * macroWeight * caldera);
              if (next <= 0) this.material[idx] = MaterialId.Air;
              else this.material[idx] = MaterialId.Basalt;
            } else {
              const cone = 1 - smoothstep(0.32, 1.0, nr);
              next = Math.min(4.5 * rScale, prev + strength * rScale * 2.1 * macroWeight * cone);
              if (next > -0.2 * rScale) {
                this.material[idx] = materialId !== MaterialId.Air ? materialId : MaterialId.Basalt;
              }
            }
          } else if (mode === 'quake') {
            const wave = Math.sin(wx * 3.7 + wy * 2.9 - wz * 4.1) * Math.cos(wz * 2.4 - wx * 1.8);
            const delta = (wave - 0.18) * (options?.jaggedNoise ?? 1.0) * strength * rScale * falloff * 2.1;
            next = clamp(prev + delta, -4.5 * rScale, 4.5 * rScale);
            if (next <= 0) {
              this.material[idx] = MaterialId.Air;
            } else if (Math.abs(delta) > 0.15 * rScale && options?.rimMaterial) {
              this.material[idx] = options.rimMaterial;
            }
          } else if (mode === 'build' || mode === 'extrude') {
            const mult = mode === 'extrude' ? 2.4 : 1.0;
            next = Math.min(4.5 * rScale, prev + strength * rScale * mult * falloff);
            if (next > -0.25 * rScale && materialId !== MaterialId.Air) {
              this.material[idx] = materialId;
            }
          } else if (mode === 'paint') {
            if (prev > -0.15 * this.voxelSize && materialId !== MaterialId.Air) {
              if (this.material[idx] !== materialId) {
                this.material[idx] = materialId;
                deltaVolume += 0.0005;
              }
            }
            continue;
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
      const scMinX = Math.floor((Math.min(cx, ex) - sparsePad) / nativeSpan);
      const scMaxX = Math.floor((Math.max(cx, ex) + sparsePad) / nativeSpan);
      const scMinY = Math.floor((Math.min(cy, ey) - sparsePad) / nativeSpan);
      const scMaxY = Math.floor((Math.max(cy, ey) + sparsePad) / nativeSpan);
      const scMinZ = Math.floor((Math.min(cz, ez) - sparsePad) / nativeSpan);
      const scMaxZ = Math.floor((Math.max(cz, ez) + sparsePad) / nativeSpan);

      const totalTouched =
        (scMaxX - scMinX + 1) * (scMaxY - scMinY + 1) * (scMaxZ - scMinZ + 1);

      const opRecord: BrushOpRecord = {
        cx,
        cy,
        cz,
        ex,
        ey,
        ez,
        shape,
        mode: mode === 'smooth' ? 'flatten' : mode,
        radius: safeRad,
        strength,
        materialId,
        targetShellRadius,
        rimMaterial: options?.rimMaterial,
        rimHeight: options?.rimHeight,
        floorMaterial: options?.floorMaterial,
        jaggedNoise: options?.jaggedNoise,
      };

      const applyBrushToChunk = (chunk: SparseVoxelChunk) => {
        const didEdit = this.applyBrushOpToSparseChunk(chunk, opRecord, mode === 'smooth');
        if (didEdit) {
          deltaVolume += 0.001;
          chunk.edited = true;
          chunk.dirty = true;
          chunk.built = true;
          chunk.isEmpty = false;
        }
      };

      // Update every already-resident chunk across all octree scales in place
      for (const chunk of this.sparseChunks.values()) {
        applyBrushToChunk(chunk);
      }

      if (totalTouched <= 125 && shape === 'sphere') {
        for (let scz = scMinZ; scz <= scMaxZ; scz++) {
          for (let scy = scMinY; scy <= scMaxY; scy++) {
            for (let scx = scMinX; scx <= scMaxX; scx++) {
              const key = `1:${scx},${scy},${scz}`;
              if (!this.sparseChunks.has(key)) {
                const chunk = this.getOrCreateSparseChunk(scx, scy, scz, 1);
                applyBrushToChunk(chunk);
              }
            }
          }
        }
      } else if (mode !== 'smooth') {
        // Coalesce near-identical consecutive cylinder ops (e.g. holding laser in place)
        const prevOp = this.brushOps[this.brushOps.length - 1];
        const canCoalesce =
          prevOp &&
          prevOp.shape === shape &&
          prevOp.mode === opRecord.mode &&
          shape === 'cylinder' &&
          Math.hypot(prevOp.cx - cx, prevOp.cy - cy, prevOp.cz - cz) < safeRad * 0.25 &&
          Math.hypot(prevOp.ex - ex, prevOp.ey - ey, prevOp.ez - ez) < safeRad * 0.25;
        if (canCoalesce && prevOp) {
          prevOp.strength = Math.max(prevOp.strength, strength);
          prevOp.radius = Math.max(prevOp.radius, safeRad);
        } else {
          if (this.brushOps.length >= 512) {
            this.brushOps.shift();
          }
          this.brushOps.push(opRecord);
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
                const rRatio = r / Math.max(this.baseRadius, 0.05);
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

                // Core-Mantle-Crust geological coloring for exposed planetary cross-sections & deep bores
                if (rRatio < 0.79) {
                  if (rRatio < 0.175) {
                    const innerW = 1 - smoothstep(0.08, 0.175, rRatio);
                    cr = 1.0;
                    cg = 0.72 + innerW * 0.22;
                    cb = 0.24 + innerW * 0.36;
                    metal = Math.max(metal, 0.75);
                    glow = Math.max(glow, 0.88);
                  } else if (rRatio < 0.305) {
                    const outerW = smoothstep(0.175, 0.305, rRatio);
                    cr = 0.96 - outerW * 0.08;
                    cg = 0.46 - outerW * 0.18;
                    cb = 0.14 - outerW * 0.04;
                    metal = Math.max(metal, 0.45);
                    glow = Math.max(glow, 0.58 - outerW * 0.18);
                  } else {
                    const mNorm = (rRatio - 0.305) / 0.485;
                    const isPlume = glow > 0.25;
                    if (isPlume) {
                      cr = 0.95;
                      cg = 0.44 - mNorm * 0.12;
                      cb = 0.16;
                      glow = Math.max(glow, 0.52);
                    } else {
                      cr = cr * 0.32 + (0.58 - mNorm * 0.18) * 0.68;
                      cg = cg * 0.32 + (0.24 + mNorm * 0.12) * 0.68;
                      cb = cb * 0.32 + (0.14 + mNorm * 0.12) * 0.68;
                      glow = Math.max(glow, (1 - mNorm) * 0.18);
                    }
                  }
                } else {
                  // Crust biome enrichment: alpine snow on flat ledges vs exposed slate ridges, lush conifer/meadow valleys, sandy coastal shores
                  const snowLike = cb - cr > 0.05 && cr > 0.76;
                  const soilLike = cg > cr + 0.12 && cg > cb + 0.12;
                  const sandLike = cr > cg + 0.1 && cg > cb + 0.06 && glow < 0.1;
                  if (snowLike && slopeDot < 0.74) {
                    const cliffExpose = (1 - smoothstep(0.46, 0.74, slopeDot)) * 0.88;
                    cr = cr * (1 - cliffExpose) + 0.34 * cliffExpose;
                    cg = cg * (1 - cliffExpose) + 0.37 * cliffExpose;
                    cb = cb * (1 - cliffExpose) + 0.42 * cliffExpose;
                  } else if (soilLike) {
                    const canopyVar = 0.5 + 0.5 * Math.sin(vx * 0.9 / Math.max(rScale, 0.1) + vz * 0.7 / Math.max(rScale, 0.1) + vy * 0.6);
                    cr = cr * (0.68 + canopyVar * 0.35);
                    cg = cg * (0.78 + canopyVar * 0.26);
                    cb = cb * (0.65 + canopyVar * 0.28);
                  } else if (sandLike && r < this.baseRadius + 0.42 * rScale) {
                    cr = 0.74;
                    cg = 0.67;
                    cb = 0.52;
                  }
                  const cliffBlend = (1 - smoothstep(0.58, 0.86, slopeDot)) * (1 - glow);
                  const stoneCol = MATERIAL_PALETTE[MaterialId.Stone].rgb;
                  cr = cr * (1 - cliffBlend * 0.72) + stoneCol[0] * cliffBlend * 0.72;
                  cg = cg * (1 - cliffBlend * 0.72) + stoneCol[1] * cliffBlend * 0.72;
                  cb = cb * (1 - cliffBlend * 0.72) + stoneCol[2] * cliffBlend * 0.72;
                }

                const depthShade =
                  rRatio < 0.31
                    ? 1.0
                    : smoothstep(this.baseRadius * 0.32, this.baseRadius * 0.85, r) * 0.22 +
                      0.78;
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
          const rRatio = r / Math.max(this.baseRadius, 0.05);
          let bR = pal.rgb[0];
          let bG = pal.rgb[1];
          let bB = pal.rgb[2];
          let bMetal = pal.metal;
          let bGlow = pal.glow;
          if (rRatio < 0.79) {
            if (rRatio < 0.175) {
              bR = 1.0; bG = 0.78; bB = 0.28; bMetal = 0.75; bGlow = 0.88;
            } else if (rRatio < 0.305) {
              bR = 0.94; bG = 0.36; bB = 0.12; bMetal = 0.45; bGlow = 0.52;
            } else {
              const mNorm = (rRatio - 0.305) / 0.485;
              if (pal.glow > 0.25) {
                bR = 0.95; bG = 0.42; bB = 0.16; bGlow = 0.52;
              } else {
                bR = bR * 0.32 + (0.58 - mNorm * 0.18) * 0.68;
                bG = bG * 0.32 + (0.24 + mNorm * 0.12) * 0.68;
                bB = bB * 0.32 + (0.14 + mNorm * 0.12) * 0.68;
                bGlow = Math.max(bGlow, (1 - mNorm) * 0.16);
              }
            }
          } else if (matId === MaterialId.Soil) {
            const patch =
              Math.sin(wx0 * 0.42 + wz0 * 0.37) * Math.cos(wy0 * 0.45 - wx0 * 0.31);
            const spruce = clamp(patch * 0.5 + 0.5, 0, 1);
            bR = 0.13 + spruce * 0.14;
            bG = 0.34 + spruce * 0.2;
            bB = 0.15 + spruce * 0.1;
          } else if (matId === MaterialId.Sandstone) {
            const shoreMix = clamp(
              (r - (this.baseRadius - 0.25 * (this.baseRadius / 13))) * 0.8,
              0,
              1,
            );
            bR = 0.78 - shoreMix * 0.06;
            bG = 0.65 - shoreMix * 0.08;
            bB = 0.46 - shoreMix * 0.06;
          }
          const depthShade =
            rRatio < 0.31
              ? 1.0
              : smoothstep(this.baseRadius * 0.32, this.baseRadius * 0.85, r) * 0.22 + 0.78;

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

              this.scratchCol[p3] = clamp(bR * shade, 0, 1);
              this.scratchCol[p3 + 1] = clamp(bG * shade, 0, 1);
              this.scratchCol[p3 + 2] = clamp(bB * shade, 0, 1);

              this.scratchMat[p3] = pal.rough;
              this.scratchMat[p3 + 1] = bMetal;
              this.scratchMat[p3 + 2] = bGlow;

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

  private applyBrushOpToSparseChunk(
    chunk: SparseVoxelChunk,
    op: BrushOpRecord,
    isSmooth = false,
  ): boolean {
    const step = chunk.stepSize;
    const safeRad = Math.max(op.radius, step * 0.75);
    const rScale = this.baseRadius / 13.0;
    const cMinWX = chunk.originX - SPARSE_PAD * step;
    const cMaxWX = chunk.originX + (CHUNK_CELLS + SPARSE_PAD) * step;
    const cMinWY = chunk.originY - SPARSE_PAD * step;
    const cMaxWY = chunk.originY + (CHUNK_CELLS + SPARSE_PAD) * step;
    const cMinWZ = chunk.originZ - SPARSE_PAD * step;
    const cMaxWZ = chunk.originZ + (CHUNK_CELLS + SPARSE_PAD) * step;

    if (op.shape === 'cylinder') {
      const dSq = distSegmentToAabbSq(
        op.cx,
        op.cy,
        op.cz,
        op.ex,
        op.ey,
        op.ez,
        cMinWX,
        cMaxWX,
        cMinWY,
        cMaxWY,
        cMinWZ,
        cMaxWZ,
      );
      if (dSq > safeRad * safeRad) {
        return false;
      }
    } else {
      if (
        op.cx + safeRad < cMinWX ||
        op.cx - safeRad > cMaxWX ||
        op.cy + safeRad < cMinWY ||
        op.cy - safeRad > cMaxWY ||
        op.cz + safeRad < cMinWZ ||
        op.cz - safeRad > cMaxWZ
      ) {
        return false;
      }
    }

    const localCopy = isSmooth ? new Float32Array(chunk.density) : null;
    let touched = false;
    const strengthScale = Math.max(step * 2.2, Math.min(rScale, safeRad * 1.4));
    const isPiercingCarve = op.mode === 'tunnel' || op.mode === 'laser';
    const carveMult = isPiercingCarve ? 9.0 : op.mode === 'bore' ? 5.0 : 1.0;

    for (let lz = 0; lz < SPARSE_N; lz++) {
      const wz = chunk.originZ + (lz - SPARSE_PAD) * step;
      for (let ly = 0; ly < SPARSE_N; ly++) {
        const wy = chunk.originY + (ly - SPARSE_PAD) * step;
        for (let lx = 0; lx < SPARSE_N; lx++) {
          const wx = chunk.originX + (lx - SPARSE_PAD) * step;
          const dist =
            op.shape === 'cylinder'
              ? distPointToSegment(wx, wy, wz, op.cx, op.cy, op.cz, op.ex, op.ey, op.ez)
              : Math.hypot(wx - op.cx, wy - op.cy, wz - op.cz);
          if (dist >= safeRad) continue;

          const rawFalloff = 1 - smoothstep(0, safeRad, dist);
          const falloff =
            isPiercingCarve
              ? Math.max(rawFalloff, dist < safeRad * 0.72 ? 1.0 : rawFalloff)
              : rawFalloff;
          const idx = lx + ly * SPARSE_NY + lz * SPARSE_NZ;
          const prev = chunk.density[idx];
          let next = prev;

          if (isSmooth && localCopy) {
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
              const blend = clamp(falloff * op.strength * 0.55, 0, 1);
              next = prev + (avg - prev) * blend;
              if (next > 0 && chunk.material[idx] === MaterialId.Air) {
                chunk.material[idx] = MaterialId.Stone;
              } else if (next <= 0) {
                chunk.material[idx] = MaterialId.Air;
              }
            }
          } else if (
            op.mode === 'carve' ||
            op.mode === 'tunnel' ||
            op.mode === 'laser' ||
            op.mode === 'bore'
          ) {
            next = Math.max(
              -4.5 * rScale,
              prev - op.strength * strengthScale * carveMult * falloff,
            );
            if (next <= 0) {
              chunk.material[idx] = MaterialId.Air;
            } else if (
              op.rimMaterial !== undefined &&
              op.rimMaterial !== MaterialId.Air &&
              dist >= safeRad * 0.62
            ) {
              chunk.material[idx] = op.rimMaterial;
              touched = true;
            }
          } else if (op.mode === 'crater') {
            const nr = dist / safeRad;
            const rimH = op.rimHeight ?? 0;
            if (nr < 0.72) {
              const pit = 1 - smoothstep(0, 0.72, nr);
              next = Math.max(-4.5 * rScale, prev - op.strength * strengthScale * 2.4 * pit);
              if (next <= 0) {
                chunk.material[idx] = MaterialId.Air;
              } else if (op.floorMaterial !== undefined && op.floorMaterial !== MaterialId.Air) {
                chunk.material[idx] = op.floorMaterial;
                touched = true;
              }
            } else if (rimH > 0) {
              const rimT = Math.sin(clamp((nr - 0.68) / 0.32, 0, 1) * Math.PI);
              next = Math.min(4.5 * rScale, prev + rimH * strengthScale * rimT);
              if (
                next > -0.2 * step &&
                ((op.rimMaterial !== undefined && op.rimMaterial !== MaterialId.Air) ||
                  op.materialId !== MaterialId.Air)
              ) {
                chunk.material[idx] =
                  op.rimMaterial !== undefined && op.rimMaterial !== MaterialId.Air
                    ? op.rimMaterial
                    : op.materialId;
                touched = true;
              }
            } else if (
              next > 0 &&
              op.floorMaterial !== undefined &&
              op.floorMaterial !== MaterialId.Air
            ) {
              chunk.material[idx] = op.floorMaterial;
              touched = true;
            }
          } else if (op.mode === 'volcano') {
            const nr = dist / safeRad;
            if (nr < 0.34) {
              const caldera = 1 - smoothstep(0, 0.34, nr);
              next = Math.max(-4.5 * rScale, prev - op.strength * strengthScale * 1.5 * caldera);
              chunk.material[idx] = next <= 0 ? MaterialId.Air : MaterialId.Basalt;
            } else {
              const cone = 1 - smoothstep(0.32, 1.0, nr);
              next = Math.min(4.5 * rScale, prev + op.strength * strengthScale * 2.1 * cone);
              if (next > -0.2 * step) {
                chunk.material[idx] = op.materialId !== MaterialId.Air ? op.materialId : MaterialId.Basalt;
              }
            }
          } else if (op.mode === 'quake') {
            const wave = Math.sin(wx * 3.7 + wy * 2.9 - wz * 4.1) * Math.cos(wz * 2.4 - wx * 1.8);
            const delta = (wave - 0.18) * (op.jaggedNoise ?? 1.0) * op.strength * strengthScale * falloff * 2.1;
            next = clamp(prev + delta, -4.5 * rScale, 4.5 * rScale);
            if (next <= 0) {
              chunk.material[idx] = MaterialId.Air;
            } else if (Math.abs(delta) > 0.12 * step && op.rimMaterial) {
              chunk.material[idx] = op.rimMaterial;
              touched = true;
            }
          } else if (op.mode === 'build' || op.mode === 'extrude') {
            const mult = op.mode === 'extrude' ? 2.4 : 1.0;
            next = Math.min(
              4.5 * rScale,
              prev + op.strength * strengthScale * mult * falloff,
            );
            if (next > -0.25 * step && op.materialId !== MaterialId.Air) {
              chunk.material[idx] = op.materialId;
            }
          } else if (op.mode === 'paint') {
            if (prev > -0.15 * step && op.materialId !== MaterialId.Air) {
              if (chunk.material[idx] !== op.materialId) {
                chunk.material[idx] = op.materialId;
                touched = true;
              }
            }
            continue;
          } else if (op.mode === 'flatten') {
            const vr = Math.hypot(wx, wy, wz);
            const desired = op.targetShellRadius - vr;
            const blend = clamp(falloff * op.strength * 0.65, 0, 1);
            next = prev + (desired - prev) * blend;
            if (next > 0 && chunk.material[idx] === MaterialId.Air) {
              chunk.material[idx] = op.materialId;
            } else if (next <= 0) {
              chunk.material[idx] = MaterialId.Air;
            }
          }

          if (next !== prev) {
            chunk.density[idx] = next;
            touched = true;
          }
        }
      }
    }
    return touched;
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
              const res = this.evalAnalyticalAt(wx, wy, wz, true, stepSize);
              density[idx] = res.density;
              material[idx] = res.material;
            }
          }
        }
      }
    }

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
      built: false,
      isEmpty: false,
      lastSeamMask: -1,
      lastUsedFrame: this.streamFrame,
    };

    if (this.brushOps.length > 0) {
      for (let i = 0; i < this.brushOps.length; i++) {
        this.applyBrushOpToSparseChunk(chunk, this.brushOps[i], false);
      }
    }

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
    lodSeamMask = 0,
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
      chunk.isEmpty = true;
      chunk.dirty = false;
      chunk.built = true;
      chunk.lastSeamMask = lodSeamMask;
      return {
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
        lod: 0,
        origin: [chunk.originX, chunk.originY, chunk.originZ],
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
            const rRatio = r / Math.max(this.baseRadius, 0.05);
            let sbR = pal.rgb[0];
            let sbG = pal.rgb[1];
            let sbB = pal.rgb[2];
            let sbMetal = pal.metal;
            let sbGlow = pal.glow;
            if (rRatio < 0.79) {
              if (rRatio < 0.175) {
                sbR = 1.0; sbG = 0.78; sbB = 0.28; sbMetal = 0.75; sbGlow = 0.88;
              } else if (rRatio < 0.305) {
                sbR = 0.94; sbG = 0.36; sbB = 0.12; sbMetal = 0.45; sbGlow = 0.52;
              } else {
                const mNorm = (rRatio - 0.305) / 0.485;
                if (pal.glow > 0.25) {
                  sbR = 0.95; sbG = 0.42; sbB = 0.16; sbGlow = 0.52;
                } else {
                  sbR = sbR * 0.32 + (0.58 - mNorm * 0.18) * 0.68;
                  sbG = sbG * 0.32 + (0.24 + mNorm * 0.12) * 0.68;
                  sbB = sbB * 0.32 + (0.14 + mNorm * 0.12) * 0.68;
                  sbGlow = Math.max(sbGlow, (1 - mNorm) * 0.16);
                }
              }
            } else if (matId === MaterialId.Soil) {
              const patch =
                Math.sin(wx0 * 0.42 + wz0 * 0.37) * Math.cos(wy0 * 0.45 - wx0 * 0.31);
              const spruce = clamp(patch * 0.5 + 0.5, 0, 1);
              sbR = 0.13 + spruce * 0.14;
              sbG = 0.34 + spruce * 0.2;
              sbB = 0.15 + spruce * 0.1;
            } else if (matId === MaterialId.Sandstone) {
              const shoreMix = clamp(
                (r - (this.baseRadius - 0.25 * (this.baseRadius / 13))) * 0.8,
                0,
                1,
              );
              sbR = 0.78 - shoreMix * 0.06;
              sbG = 0.65 - shoreMix * 0.08;
              sbB = 0.46 - shoreMix * 0.06;
            }
            const depthShade =
              rRatio < 0.31
                ? 1.0
                : smoothstep(this.baseRadius * 0.32, this.baseRadius * 0.85, r) * 0.22 + 0.78;

            for (let f = 0; f < 6; f++) {
              const face = FACES[f];
              const [nx, ny, nz] = face.n;
              if (isBlockSolid(px + nx, py + ny, pz + nz)) {
                const isBoundaryFace =
                  (f === 0 && lx === CHUNK_CELLS - 1) ||
                  (f === 1 && lx === 0) ||
                  (f === 2 && ly === CHUNK_CELLS - 1) ||
                  (f === 3 && ly === 0) ||
                  (f === 4 && lz === CHUNK_CELLS - 1) ||
                  (f === 5 && lz === 0);
                if (!((lodSeamMask & (1 << f)) !== 0 && isBoundaryFace)) {
                  continue;
                }
                const baseIdx = px + py * SPARSE_NY + pz * SPARSE_NZ;
                if (Math.abs(dArr[baseIdx]) > stepSize * 3.0) {
                  continue;
                }
              }
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

                this.scratchCol[p3] = clamp(sbR * shade, 0, 1);
                this.scratchCol[p3 + 1] = clamp(sbG * shade, 0, 1);
                this.scratchCol[p3 + 2] = clamp(sbB * shade, 0, 1);

                this.scratchMat[p3] = pal.rough;
                this.scratchMat[p3 + 1] = sbMetal;
                this.scratchMat[p3 + 2] = sbGlow;

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
                  const rRatio = r / Math.max(this.baseRadius, 0.05);
                  if (rRatio < 0.79) {
                    if (rRatio < 0.175) {
                      cr = 1.0; cg = 0.76; cb = 0.28; metal = 0.75; glow = 0.88;
                    } else if (rRatio < 0.305) {
                      cr = 0.94; cg = 0.38; cb = 0.12; metal = 0.45; glow = 0.52;
                    } else {
                      const mNorm = (rRatio - 0.305) / 0.485;
                      if (glow > 0.25) {
                        cr = 0.95; cg = 0.42; cb = 0.16; glow = 0.52;
                      } else {
                        cr = cr * 0.32 + (0.58 - mNorm * 0.18) * 0.68;
                        cg = cg * 0.32 + (0.24 + mNorm * 0.12) * 0.68;
                        cb = cb * 0.32 + (0.14 + mNorm * 0.12) * 0.68;
                        glow = Math.max(glow, (1 - mNorm) * 0.16);
                      }
                    }
                  } else {
                    const slopeDot = (vx * nx + vy * ny + vz * nz) / r;
                    const snowLike = cb - cr > 0.05 && cr > 0.76;
                    const soilLike = cg > cr + 0.12 && cg > cb + 0.12;
                    const sandLike = cr > cg + 0.1 && cg > cb + 0.06 && glow < 0.1;
                    if (snowLike && slopeDot < 0.74) {
                      const cliffExpose = (1 - smoothstep(0.46, 0.74, slopeDot)) * 0.88;
                      cr = cr * (1 - cliffExpose) + 0.34 * cliffExpose;
                      cg = cg * (1 - cliffExpose) + 0.37 * cliffExpose;
                      cb = cb * (1 - cliffExpose) + 0.42 * cliffExpose;
                    } else if (soilLike) {
                      const canopyVar = 0.5 + 0.5 * Math.sin(vx * 0.9 / Math.max(rScale, 0.1) + vz * 0.7 / Math.max(rScale, 0.1) + vy * 0.6);
                      cr = cr * (0.68 + canopyVar * 0.35);
                      cg = cg * (0.78 + canopyVar * 0.26);
                      cb = cb * (0.65 + canopyVar * 0.28);
                    } else if (sandLike && r < this.baseRadius + 0.42 * rScale) {
                      cr = 0.74;
                      cg = 0.67;
                      cb = 0.52;
                    }
                    const cliffBlend = (1 - smoothstep(0.58, 0.86, slopeDot)) * (1 - glow);
                    const stoneCol = MATERIAL_PALETTE[MaterialId.Stone].rgb;
                    cr = cr * (1 - cliffBlend * 0.72) + stoneCol[0] * cliffBlend * 0.72;
                    cg = cg * (1 - cliffBlend * 0.72) + stoneCol[1] * cliffBlend * 0.72;
                    cb = cb * (1 - cliffBlend * 0.72) + stoneCol[2] * cliffBlend * 0.72;
                  }

                  const depthShade =
                    rRatio < 0.31
                      ? 1.0
                      : smoothstep(this.baseRadius * 0.32, this.baseRadius * 0.85, r) * 0.22 +
                        0.78;
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

              // Emit narrow inward T-junction skirts along chunk boundary edges bordering a different LOD
              if (lodSeamMask !== 0 && vCount >= 3 && vCount + 6 <= maxVerts) {
                const chunkSpan = CHUNK_CELLS * stepSize;
                const eps = stepSize * 1e-4;
                const triBase = (vCount - 3) * 3;
                const skirtDepth = stepSize * 0.55;
                for (let eIdxPair = 0; eIdxPair < 3; eIdxPair++) {
                  if (vCount + 6 > maxVerts) break;
                  const iA = triBase + eIdxPair * 3;
                  const iB = triBase + ((eIdxPair + 1) % 3) * 3;
                  const ax = this.scratchPos[iA];
                  const ay = this.scratchPos[iA + 1];
                  const az = this.scratchPos[iA + 2];
                  const bx = this.scratchPos[iB];
                  const by = this.scratchPos[iB + 1];
                  const bz = this.scratchPos[iB + 2];
                  const onSeamBoundary =
                    ((lodSeamMask & 1) !== 0 && Math.abs(ax - chunkSpan) < eps && Math.abs(bx - chunkSpan) < eps) ||
                    ((lodSeamMask & 2) !== 0 && Math.abs(ax) < eps && Math.abs(bx) < eps) ||
                    ((lodSeamMask & 4) !== 0 && Math.abs(ay - chunkSpan) < eps && Math.abs(by - chunkSpan) < eps) ||
                    ((lodSeamMask & 8) !== 0 && Math.abs(ay) < eps && Math.abs(by) < eps) ||
                    ((lodSeamMask & 16) !== 0 && Math.abs(az - chunkSpan) < eps && Math.abs(bz - chunkSpan) < eps) ||
                    ((lodSeamMask & 32) !== 0 && Math.abs(az) < eps && Math.abs(bz) < eps);
                  if (!onSeamBoundary) continue;

                  const nax = this.scratchNorm[iA];
                  const nay = this.scratchNorm[iA + 1];
                  const naz = this.scratchNorm[iA + 2];
                  const nbx = this.scratchNorm[iB];
                  const nby = this.scratchNorm[iB + 1];
                  const nbz = this.scratchNorm[iB + 2];

                  const axIn = ax - nax * skirtDepth;
                  const ayIn = ay - nay * skirtDepth;
                  const azIn = az - naz * skirtDepth;
                  const bxIn = bx - nbx * skirtDepth;
                  const byIn = by - nby * skirtDepth;
                  const bzIn = bz - nbz * skirtDepth;

                  const pushSkirtVert = (
                    pxv: number,
                    pyv: number,
                    pzv: number,
                    srcIdx: number,
                  ) => {
                    const p3 = vCount * 3;
                    const u2 = vCount * 2;
                    this.scratchPos[p3] = pxv;
                    this.scratchPos[p3 + 1] = pyv;
                    this.scratchPos[p3 + 2] = pzv;
                    this.scratchNorm[p3] = this.scratchNorm[srcIdx];
                    this.scratchNorm[p3 + 1] = this.scratchNorm[srcIdx + 1];
                    this.scratchNorm[p3 + 2] = this.scratchNorm[srcIdx + 2];
                    this.scratchCol[p3] = this.scratchCol[srcIdx];
                    this.scratchCol[p3 + 1] = this.scratchCol[srcIdx + 1];
                    this.scratchCol[p3 + 2] = this.scratchCol[srcIdx + 2];
                    this.scratchMat[p3] = this.scratchMat[srcIdx];
                    this.scratchMat[p3 + 1] = this.scratchMat[srcIdx + 1];
                    this.scratchMat[p3 + 2] = this.scratchMat[srcIdx + 2];
                    this.scratchUv[u2] = 0.5;
                    this.scratchUv[u2 + 1] = 0.5;
                    vCount++;
                  };

                  pushSkirtVert(ax, ay, az, iA);
                  pushSkirtVert(bx, by, bz, iB);
                  pushSkirtVert(bxIn, byIn, bzIn, iB);
                  pushSkirtVert(ax, ay, az, iA);
                  pushSkirtVert(bxIn, byIn, bzIn, iB);
                  pushSkirtVert(axIn, ayIn, azIn, iA);
                }
              }
            }
          }
        }
      }
    }

    chunk.isEmpty = vCount === 0;
    chunk.dirty = false;
    chunk.built = true;
    chunk.lastSeamMask = lodSeamMask;

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
   * Streams a gapless 360° dyadic power-of-2 Sparse Voxel Octree partition with atomic
   * parent/child swap (eliminating LOD overlap, Z-fighting, and holes across 1:1 native
   * up to >1,000,000,000³).
   */
  public streamHighResAround(
    fx: number,
    fy: number,
    fz: number,
    renderMode: TerrainRenderMode,
    maxBuildPerFrame = 28,
    camDistToFocus?: number,
    camPosArg?: [number, number, number],
    camFwdArg?: [number, number, number],
    lodOptions?: {
      lodMode?: 'auto' | 0 | 1 | 2;
      lod0Dist?: number;
      timeBudgetMs?: number;
      distantHorizon?: boolean;
    },
  ): HighResStreamBatch {
    this.streamFrame++;
    const desiredKeys = new Set<string>();
    const retainKeys = new Set<string>();
    const rebuiltMeshes: HighResStreamBatch['rebuiltMeshes'] = [];
    const lodMode = lodOptions?.lodMode ?? 'auto';
    const lod0DistOpt = lodOptions?.lod0Dist;
    const timeBudgetMs = lodOptions?.timeBudgetMs ?? Number.POSITIVE_INFINITY;
    const streamStartMs = Number.isFinite(timeBudgetMs) ? performance.now() : 0;

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
        retainKeys,
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

    // Small custom-resolution planet (voxelRadius < 18): replace entire macro planet at 1:1
    if (this.voxelRadius < 18) {
      const cBound = Math.ceil(this.worldHalf / nativeSpan);
      const wantQueue: Array<{
        cx: number;
        cy: number;
        cz: number;
        prio: number;
        chunk?: SparseVoxelChunk;
      }> = [];
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
            retainKeys.add(key);
            const existing = this.sparseChunks.get(key);
            if (!existing || !existing.built || existing.dirty || existing.lastSeamMask !== 0) {
              pending++;
              const dSq =
                (cwx - surfF[0]) * (cwx - surfF[0]) +
                (cwy - surfF[1]) * (cwy - surfF[1]) +
                (cwz - surfF[2]) * (cwz - surfF[2]);
              wantQueue.push({
                cx,
                cy,
                cz,
                prio: (existing?.edited ? 0 : 1e4) + dSq,
                chunk: existing,
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
          if (
            i >= 2 &&
            Number.isFinite(timeBudgetMs) &&
            performance.now() - streamStartMs >= timeBudgetMs
          ) {
            break;
          }
          const w = wantQueue[i];
          const ch = w.chunk ?? this.getOrCreateSparseChunk(w.cx, w.cy, w.cz, 1);
          rebuiltMeshes.push({
            key: ch.key,
            tier: 'native',
            scaleMult: 1,
            mesh: this.extractSparseChunkMesh(ch, blocky, 0),
          });
          pending = Math.max(0, pending - 1);
        }
      }

      if (pending === 0) {
        this.svRootBuilt = true;
      }
      this.evictUnusedSparseChunks(340, retainKeys);
      return {
        active: true,
        hideMacro: this.svRootBuilt,
        globeBuiltComplete: this.svRootBuilt,
        hemiCenter: [surfF[0], surfF[1], surfF[2]],
        hemiDiscardRadius: 0,
        midOuterCenter: [surfF[0], surfF[1], surfF[2]],
        midOuterDiscardRadius: 0,
        midCenter: [surfF[0], surfF[1], surfF[2]],
        midDiscardRadius: 0,
        nativeCenter: [surfF[0], surfF[1], surfF[2]],
        nativeDiscardRadius: this.svRootBuilt ? this.worldHalf * 2.0 : 0,
        pendingTotal: pending,
        desiredKeys,
        retainKeys,
        rebuiltMeshes,
      };
    }

    // Dyadic SVO streaming for high-res & ultra-high-res (>1,000,000,000³+) planets
    const { minEvalR, maxSurfR, rScale } = this.getRadialEvalBounds();
    const effectiveCamDist = camDistToFocus ?? this.baseRadius * 2.0;
    const camPosX = camPosArg ? camPosArg[0] : surfF[0] + focusDir[0] * effectiveCamDist;
    const camPosY = camPosArg ? camPosArg[1] : surfF[1] + focusDir[1] * effectiveCamDist;
    const camPosZ = camPosArg ? camPosArg[2] : surfF[2] + focusDir[2] * effectiveCamDist;

    let fwdX = camFwdArg ? camFwdArg[0] : -focusDir[0];
    let fwdY = camFwdArg ? camFwdArg[1] : -focusDir[1];
    let fwdZ = camFwdArg ? camFwdArg[2] : -focusDir[2];
    const fwdLen = Math.hypot(fwdX, fwdY, fwdZ);
    if (fwdLen > 1e-6) {
      fwdX /= fwdLen;
      fwdY /= fwdLen;
      fwdZ /= fwdLen;
    } else {
      fwdX = -focusDir[0];
      fwdY = -focusDir[1];
      fwdZ = -focusDir[2];
    }

    const kRoot = Math.max(0, Math.round(Math.log2(Math.max(1, this.voxelRadius / 32))));
    let kTop = kRoot;
    while (nativeSpan * Math.pow(2, kTop) < maxSurfR * 1.12) {
      kTop++;
    }

    const levelScaleMult = new Array<number>(kTop + 1);
    const levelSpan = new Array<number>(kTop + 1);
    for (let k = 0; k <= kTop; k++) {
      const sm = Math.pow(2, k);
      levelScaleMult[k] = sm;
      levelSpan[k] = nativeSpan * sm;
    }

    const tierForLevel = (
      k: number,
    ): 'globe' | 'hemi' | 'midOuter' | 'mid' | 'native' => {
      if (k === 0) return 'native';
      if (k >= kRoot) return 'globe';
      if (k === kRoot - 1) return 'hemi';
      if (kRoot - 1 > 3 && k >= Math.floor((kRoot - 1) * 0.55)) return 'midOuter';
      return 'mid';
    };

    const { cfg } = this.genCtx;
    const minTerrainR = Math.max(
      0,
      cfg.radius -
        (Math.abs(cfg.continentAmp) * 0.85 +
          Math.abs(cfg.ridgeAmp) * 0.45 +
          Math.abs(cfg.craterDepth) +
          0.9) *
          rScale,
    );
    const minCrustR = Math.max(minTerrainR, cfg.radius * 0.68);
    const camR = Math.hypot(camPosX, camPosY, camPosZ);
    const cameraUnderground = camR < minCrustR + nativeSpan * 2 || fLen < minCrustR;
    const blockReliefTol =
      this.genCtx.detailLogScale > 2.2 ? this.nativeVoxelSize * 3.2 : 0;

    const editedWorldBoxes: Array<{ minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }> = [];
    const editedSegments: Array<{
      cx: number;
      cy: number;
      cz: number;
      ex: number;
      ey: number;
      ez: number;
      r: number;
    }> = [];
    for (let i = 0; i < this.brushOps.length; i++) {
      const op = this.brushOps[i];
      const r = op.radius + nativeSpan * 0.5;
      if (op.shape === 'cylinder') {
        editedSegments.push({
          cx: op.cx,
          cy: op.cy,
          cz: op.cz,
          ex: op.ex,
          ey: op.ey,
          ez: op.ez,
          r,
        });
      } else {
        editedWorldBoxes.push({
          minX: op.cx - r,
          maxX: op.cx + r,
          minY: op.cy - r,
          maxY: op.cy + r,
          minZ: op.cz - r,
          maxZ: op.cz + r,
        });
      }
    }
    for (const c of this.sparseChunks.values()) {
      if (!c.edited || c.scaleMult > 1) continue;
      const span = CHUNK_CELLS * c.stepSize;
      editedWorldBoxes.push({
        minX: c.originX - this.nativeVoxelSize * 2,
        maxX: c.originX + span + this.nativeVoxelSize * 2,
        minY: c.originY - this.nativeVoxelSize * 2,
        maxY: c.originY + span + this.nativeVoxelSize * 2,
        minZ: c.originZ - this.nativeVoxelSize * 2,
        maxZ: c.originZ + span + this.nativeVoxelSize * 2,
      });
    }

    const boxIntersectsEdits = (
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
      minZ: number,
      maxZ: number,
    ): boolean => {
      for (let i = 0; i < editedWorldBoxes.length; i++) {
        const b = editedWorldBoxes[i];
        if (
          maxX >= b.minX &&
          minX <= b.maxX &&
          maxY >= b.minY &&
          minY <= b.maxY &&
          maxZ >= b.minZ &&
          minZ <= b.maxZ
        ) {
          return true;
        }
      }
      for (let i = 0; i < editedSegments.length; i++) {
        const s = editedSegments[i];
        if (
          distSegmentToAabbSq(
            s.cx,
            s.cy,
            s.cz,
            s.ex,
            s.ey,
            s.ez,
            minX,
            maxX,
            minY,
            maxY,
            minZ,
            maxZ,
          ) <=
          s.r * s.r
        ) {
          return true;
        }
      }
      return false;
    };

    const boxMightContainSurface = (
      k: number,
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
      minZ: number,
      maxZ: number,
    ): boolean => {
      const span = levelSpan[k];
      const stepSize = span / CHUNK_CELLS;
      const pad = stepSize * SPARSE_PAD;

      const clX = minX > 0 ? minX : maxX < 0 ? maxX : 0;
      const clY = minY > 0 ? minY : maxY < 0 ? maxY : 0;
      const clZ = minZ > 0 ? minZ : maxZ < 0 ? maxZ : 0;
      const rMinSq = clX * clX + clY * clY + clZ * clZ;
      const maxRBound = maxSurfR + pad;
      const hasEdits =
        editedWorldBoxes.length > 0 &&
        boxIntersectsEdits(minX - pad, maxX + pad, minY - pad, maxY + pad, minZ - pad, maxZ + pad);

      if (!hasEdits && rMinSq > maxRBound * maxRBound) return false;

      const farX = Math.max(Math.abs(minX), Math.abs(maxX));
      const farY = Math.max(Math.abs(minY), Math.abs(maxY));
      const farZ = Math.max(Math.abs(minZ), Math.abs(maxZ));
      const qCx0 = camPosX < minX ? minX : camPosX > maxX ? maxX : camPosX;
      const qCy0 = camPosY < minY ? minY : camPosY > maxY ? maxY : camPosY;
      const qCz0 = camPosZ < minZ ? minZ : camPosZ > maxZ ? maxZ : camPosZ;
      const nearCamBox =
        Math.hypot(camPosX - qCx0, camPosY - qCy0, camPosZ - qCz0) < span * 2.5;

      const useDeepCaves = cameraUnderground || nearCamBox;
      const effectiveMinR = useDeepCaves ? minEvalR : minCrustR;
      const minRBound = Math.max(0, effectiveMinR - pad);
      if (!hasEdits && farX * farX + farY * farY + farZ * farZ < minRBound * minRBound) {
        return false;
      }

      if (hasEdits || k > kRoot) return true;

      const half = span * 0.5;
      const cwx = minX + half;
      const cwy = minY + half;
      const cwz = minZ + half;

      const pSpan = span + pad * 2;
      const pHalfDiag = pSpan * 0.8660254;
      const sphereSag = (0.28 * pSpan * pSpan) / Math.max(2 * this.baseRadius, 1);
      const grainTol =
        stepSize <= this.nativeVoxelSize * 96 ? blockReliefTol : 0;
      const fineGradBoost = k === 0 ? pHalfDiag * 0.85 : 0;
      const curvTol =
        sphereSag + Math.min(0.20 * rScale, pSpan * 0.085) + grainTol + stepSize * 0.35 + fineGradBoost;

      const dCenter = this.evalAnalyticalAt(cwx, cwy, cwz, true, stepSize).density;
      const gradScale = k === 0 ? 2.45 : k === 1 ? 1.45 : 1.35;
      if (Math.abs(dCenter) > pHalfDiag * gradScale + curvTol) {
        return false;
      }

      const sMinX = minX - pad;
      const sMaxX = maxX + pad;
      const sMinY = minY - pad;
      const sMaxY = maxY + pad;
      const sMinZ = minZ - pad;
      const sMaxZ = maxZ + pad;

      let minD = dCenter;
      let maxD = dCenter;
      for (let dz = 0; dz <= 1; dz++) {
        const pz = dz === 0 ? sMinZ : sMaxZ;
        for (let dy = 0; dy <= 1; dy++) {
          const py = dy === 0 ? sMinY : sMaxY;
          for (let dx = 0; dx <= 1; dx++) {
            const px = dx === 0 ? sMinX : sMaxX;
            const dc = this.evalAnalyticalAt(px, py, pz, true, stepSize).density;
            if (dc < minD) minD = dc;
            if (dc > maxD) maxD = dc;
            if (minD <= curvTol && maxD >= -curvTol) {
              return true;
            }
          }
        }
      }
      return false;
    };

    const isOrbitalView = effectiveCamDist >= this.baseRadius * 0.5;
    const isMicroZoom = kRoot > 6 && effectiveCamDist < this.baseRadius * 0.005;
    const isForcedLod0 = lodMode === 0;
    const useDistantHorizon =
      lodOptions?.distantHorizon !== false && !isForcedLod0 && !isMicroZoom;
    const minLeafK =
      lodMode === 1
        ? Math.min(kRoot, 1)
        : lodMode === 2
          ? Math.min(kRoot, 2)
          : 0;

    // For forced LOD 0: render full uniform smallest voxels across the visible planet (if <=180)
    // or across the entire visible screen frustum (down to 1:1 native whenever <=360 voxels wide).
    const frustumSpan = Math.max(effectiveCamDist, nativeSpan * 2) * 1.45;
    const fullPlanetLod0 = isForcedLod0 && this.voxelRadius <= 180;
    let uniformLod0TargetK = 0;
    if (isForcedLod0 && !fullPlanetLod0) {
      const blocksAcrossNative = frustumSpan / Math.max(this.nativeVoxelSize, 1e-12);
      if (blocksAcrossNative > 360) {
        const minStepFor280 = frustumSpan / 280;
        while (
          uniformLod0TargetK < kRoot &&
          this.nativeVoxelSize * levelScaleMult[uniformLod0TargetK] < minStepFor280
        ) {
          uniformLod0TargetK++;
        }
      }
    }
    const effectiveMinK = isForcedLod0 ? uniformLod0TargetK : minLeafK;

    const hemiDotThresh = isForcedLod0
      ? fullPlanetLod0
        ? -0.25
        : effectiveCamDist > this.baseRadius * 0.9
          ? -0.05
          : 0.15
      : effectiveCamDist > this.baseRadius * 0.9
        ? 0.05
        : isOrbitalView
          ? 0.24
          : useDistantHorizon
            ? 0.42
            : 0.58;
    const minFunnelSpan = isForcedLod0 ? 0 : effectiveCamDist * 0.001;
    const hemiBlocksPerR =
      kRoot > 0 ? this.voxelRadius / levelScaleMult[kRoot - 1] : this.voxelRadius;
    const lod0Boost = clamp(
      (lod0DistOpt ?? this.baseRadius * 2.8) / Math.max(this.baseRadius * 2.8, 1e-4),
      1.0,
      3.0,
    );

    interface TravNode {
      k: number;
      cx: number;
      cy: number;
      cz: number;
      scaleMult: number;
      key: string;
      wantsSubdivide: boolean;
      chunk: SparseVoxelChunk | undefined;
      children: TravNode[] | null;
    }

    const wantBuildQueue: Array<{
      cx: number;
      cy: number;
      cz: number;
      scaleMult: number;
      k: number;
      prio: number;
      existing?: SparseVoxelChunk;
    }> = [];
    const queuedBuildKeys = new Set<string>();

    const shouldSubdivideNode = (
      k: number,
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
      minZ: number,
      maxZ: number,
    ): boolean => {
      if (k <= effectiveMinK) return false;
      if (k > kRoot) return true;

      const span = levelSpan[k];
      const half = span * 0.5;
      const cwx = minX + half;
      const cwy = minY + half;
      const cwz = minZ + half;

      const qCx = camPosX < minX ? minX : camPosX > maxX ? maxX : camPosX;
      const qCy = camPosY < minY ? minY : camPosY > maxY ? maxY : camPosY;
      const qCz = camPosZ < minZ ? minZ : camPosZ > maxZ ? maxZ : camPosZ;
      const dCam = Math.hypot(camPosX - qCx, camPosY - qCy, camPosZ - qCz);

      const qFx = surfF[0] < minX ? minX : surfF[0] > maxX ? maxX : surfF[0];
      const qFy = surfF[1] < minY ? minY : surfF[1] > maxY ? maxY : surfF[1];
      const qFz = surfF[2] < minZ ? minZ : surfF[2] > maxZ ? maxZ : surfF[2];
      const dFocus = Math.hypot(surfF[0] - qFx, surfF[1] - qFy, surfF[2] - qFz);

      const ncR = Math.hypot(cwx, cwy, cwz);
      const nodeHalfDiag = span * 0.8660254;
      let boxMaxDot = 1.0;
      if (ncR > nodeHalfDiag + 1e-5) {
        const centerDot = (cwx * focusDir[0] + cwy * focusDir[1] + cwz * focusDir[2]) / ncR;
        const sinA = Math.min(1, nodeHalfDiag / ncR);
        const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));
        const sinC = Math.sqrt(Math.max(0, 1 - centerDot * centerDot));
        boxMaxDot = centerDot > cosA ? 1.0 : centerDot * cosA + sinC * sinA;
      }

      const toCamX = cwx - camPosX;
      const toCamY = cwy - camPosY;
      const toCamZ = cwz - camPosZ;
      const toCamLen = Math.hypot(toCamX, toCamY, toCamZ);
      const viewDirDot =
        toCamLen > 1e-7
          ? (toCamX * fwdX + toCamY * fwdY + toCamZ * fwdZ) / toCamLen
          : 1.0;
      const angPad = Math.min(0.45, nodeHalfDiag / Math.max(toCamLen, 1e-5));

      if (isForcedLod0) {
        if (fullPlanetLod0) {
          // Moderate high-res (<=180): subdivide visible & close planet uniformly all the way to 1:1 native
          const maxWorldCap = Math.max(lod0DistOpt ?? this.baseRadius * 3.0, this.baseRadius * 2.2);
          return boxMaxDot >= hemiDotThresh || dCam <= maxWorldCap || viewDirDot > 0.25 - angPad;
        }
        // Ultra-high-res LOD 0: fill the ENTIRE visible viewport uniformly down to uniformLod0TargetK (0 = 1:1 native)
        if (dFocus < span * 0.6) return true;
        if (dCam < span * 0.85) return true;
        const inFrustum = viewDirDot > 0.25 - angPad;
        if (
          inFrustum &&
          (dFocus <= frustumSpan * 0.9 || dCam <= effectiveCamDist * 1.55)
        ) {
          return true;
        }
        if (k === kRoot && boxMaxDot >= hemiDotThresh) return true;
        return false;
      }

      if (k === kRoot) {
        if (
          useDistantHorizon &&
          !isOrbitalView &&
          camFwdArg &&
          dCam > span * 1.15 &&
          viewDirDot < -0.15 - angPad
        ) {
          return false;
        }
        const forwardHorizonHit =
          useDistantHorizon &&
          !isOrbitalView &&
          Boolean(camFwdArg) &&
          viewDirDot > 0.35 - angPad &&
          dCam < this.baseRadius * 1.35;
        return (
          dCam < span * 2.4 ||
          dFocus < span * 1.3 ||
          boxMaxDot >= hemiDotThresh ||
          forwardHorizonHit
        );
      }

      if (span <= minFunnelSpan) {
        return false;
      }

      if (
        useDistantHorizon &&
        !isOrbitalView &&
        camFwdArg &&
        dCam > span * 1.15 &&
        dFocus > span * 0.9 &&
        viewDirDot < -0.15 - angPad
      ) {
        return false;
      }

      const inViewCone = viewDirDot > 0.32 - angPad || dCam < span * 0.72;

      if (dFocus < span * 0.52) return true;
      if (dCam < span * 0.72 && inViewCone) return true;

      // Distant Horizons continuous screen-space angular LOD pyramid:
      // Scale-invariant dyadic ring cascade (O(1) chunks per octave) from 1:1 foreground to wide horizons.
      if (useDistantHorizon) {
        const coneFactor = viewDirDot > 0.62 - angPad ? 1.28 : inViewCone ? 0.96 : 0.65;
        const horizonReachScale = !isOrbitalView ? 1.15 : 0.92;
        const angSplitRatio = clamp(
          0.58 / (coneFactor * horizonReachScale * Math.sqrt(lod0Boost)),
          0.26,
          0.85,
        );
        if (span > dCam * angSplitRatio && (inViewCone || dCam < span * 1.25)) {
          return true;
        }
      }

      // Widen crisp near-native patch in auto mode during close-up surface inspection
      if (
        !isOrbitalView &&
        k <= 5 &&
        effectiveCamDist > nativeSpan * 8 &&
        span >= effectiveCamDist * 0.072 &&
        inViewCone &&
        dFocus < effectiveCamDist * 0.42 * lod0Boost
      ) {
        return true;
      }
      if (
        isOrbitalView &&
        k === kRoot - 1 &&
        hemiBlocksPerR <= 72 &&
        boxMaxDot >= 0.93
      ) {
        return true;
      }
      return false;
    };

    const buildTravTree = (
      k: number,
      cx: number,
      cy: number,
      cz: number,
    ): TravNode | null => {
      const span = levelSpan[k];
      const minX = cx * span;
      const maxX = minX + span;
      const minY = cy * span;
      const maxY = minY + span;
      const minZ = cz * span;
      const maxZ = minZ + span;

      if (!boxMightContainSurface(k, minX, maxX, minY, maxY, minZ, maxZ)) {
        return null;
      }

      const scaleMult = levelScaleMult[k];
      const key = `${scaleMult}:${cx},${cy},${cz}`;
      const existing = k <= kRoot ? this.sparseChunks.get(key) : undefined;
      if (existing) {
        existing.lastUsedFrame = this.streamFrame;
      }

      const wantsSubdivide = shouldSubdivideNode(k, minX, maxX, minY, maxY, minZ, maxZ);
      const half = span * 0.5;
      const cwx = minX + half;
      const cwy = minY + half;
      const cwz = minZ + half;

      const queueThisNode = () => {
        if (k > kRoot) return;
        if (queuedBuildKeys.has(key)) return;
        if (!existing || !existing.built) {
          queuedBuildKeys.add(key);
          const dSq =
            (cwx - surfF[0]) * (cwx - surfF[0]) +
            (cwy - surfF[1]) * (cwy - surfF[1]) +
            (cwz - surfF[2]) * (cwz - surfF[2]);
          const isPreRoot = !this.svRootBuilt && k === kRoot;
          const levelRank = (kRoot - k) * 3e6;
          wantBuildQueue.push({
            cx,
            cy,
            cz,
            scaleMult,
            k,
            prio: existing?.edited
              ? -1000
              : isPreRoot
                ? dSq
                : 1e8 + levelRank + dSq * 2e5,
            existing,
          });
        }
      };

      if (!wantsSubdivide || k === 0) {
        queueThisNode();
        return {
          k,
          cx,
          cy,
          cz,
          scaleMult,
          key,
          wantsSubdivide: false,
          chunk: existing,
          children: null,
        };
      }

      // When k <= kRoot and parent chunk isn't built yet, queue parent first for seamless top-down fallback
      if (k <= kRoot && (!existing || !existing.built)) {
        queueThisNode();
      }

      const children: TravNode[] = [];
      const cx2 = cx * 2;
      const cy2 = cy * 2;
      const cz2 = cz * 2;
      for (let dz = 0; dz < 2; dz++) {
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const child = buildTravTree(k - 1, cx2 + dx, cy2 + dy, cz2 + dz);
            if (child) children.push(child);
          }
        }
      }

      if (children.length === 0 && k <= kRoot) {
        return {
          k,
          cx,
          cy,
          cz,
          scaleMult,
          key,
          wantsSubdivide: false,
          chunk: existing,
          children: null,
        };
      }

      return {
        k,
        cx,
        cy,
        cz,
        scaleMult,
        key,
        wantsSubdivide: true,
        chunk: existing,
        children,
      };
    };

    const roots: TravNode[] = [];
    for (let dz = -1; dz <= 0; dz++) {
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const rNode = buildTravTree(kTop, dx, dy, dz);
          if (rNode) roots.push(rNode);
        }
      }
    }

    const totalPendingBuilds = wantBuildQueue.length;
    let builtThisFrame = 0;
    if (wantBuildQueue.length > 0) {
      wantBuildQueue.sort((a, b) => a.prio - b.prio);
      const lim = Math.min(maxBuildPerFrame, wantBuildQueue.length);
      for (let i = 0; i < lim; i++) {
        if (
          i >= 2 &&
          Number.isFinite(timeBudgetMs) &&
          performance.now() - streamStartMs >= timeBudgetMs * 0.7
        ) {
          break;
        }
        const w = wantBuildQueue[i];
        const ch = w.existing ?? this.getOrCreateSparseChunk(w.cx, w.cy, w.cz, w.scaleMult);
        let hasSolid = false;
        let hasAir = false;
        const dArr = ch.density;
        for (let j = 0; j < dArr.length; j++) {
          if (dArr[j] > 0) hasSolid = true;
          else hasAir = true;
          if (hasSolid && hasAir) break;
        }
        ch.isEmpty = !hasSolid || !hasAir;
        ch.built = true;
        ch.lastUsedFrame = this.streamFrame;
        builtThisFrame++;
      }
    }

    // Refresh TravNode.chunk pointers after building & resolve non-overlapping leaf cut
    interface ResolvedLeaf {
      node: TravNode;
      chunk: SparseVoxelChunk;
      tier: 'globe' | 'hemi' | 'midOuter' | 'mid' | 'native';
    }
    const resolvedLeaves: ResolvedLeaf[] = [];

    const resolveNodeInto = (node: TravNode, out: ResolvedLeaf[]): boolean => {
      if (node.k <= kRoot && !node.chunk) {
        node.chunk = this.sparseChunks.get(node.key);
      }

      if (!node.wantsSubdivide || node.k === 0 || !node.children) {
        const ch = node.chunk;
        if (ch && ch.built) {
          retainKeys.add(ch.key);
          if (!ch.isEmpty) {
            out.push({ node, chunk: ch, tier: tierForLevel(node.k) });
          }
          return true;
        }
        return false;
      }

      const childOut: ResolvedLeaf[] = [];
      let allCovered = true;
      for (let i = 0; i < node.children.length; i++) {
        if (!resolveNodeInto(node.children[i], childOut)) {
          allCovered = false;
        }
      }

      if (allCovered) {
        for (let i = 0; i < childOut.length; i++) {
          out.push(childOut[i]);
        }
        return true;
      }

      if (node.k > kRoot) {
        for (let i = 0; i < childOut.length; i++) {
          out.push(childOut[i]);
        }
        return false;
      }

      // Atomic fallback: keep built parent while waiting for incomplete children (keep built child meshes in retainKeys)
      for (let i = 0; i < childOut.length; i++) {
        retainKeys.add(childOut[i].chunk.key);
      }
      const ch = node.chunk;
      if (ch && ch.built) {
        retainKeys.add(ch.key);
        if (!ch.isEmpty) {
          out.push({ node, chunk: ch, tier: tierForLevel(node.k) });
        }
        return true;
      }

      return false;
    };

    let allRootCovered = true;
    for (let i = 0; i < roots.length; i++) {
      if (!resolveNodeInto(roots[i], resolvedLeaves)) {
        allRootCovered = false;
      }
    }
    if (allRootCovered) {
      this.svRootBuilt = true;
    }

    // Build lookup maps for O(octreeDepth) 6-neighbor LOD seam detection across all scales
    const leafMap = new Map<string, ResolvedLeaf>();
    const splitNodes = new Set<string>();
    for (let i = 0; i < resolvedLeaves.length; i++) {
      const lf = resolvedLeaves[i];
      desiredKeys.add(lf.chunk.key);
      retainKeys.add(lf.chunk.key);
      leafMap.set(lf.chunk.key, lf);

      let ax = lf.node.cx;
      let ay = lf.node.cy;
      let az = lf.node.cz;
      for (let ak = lf.node.k + 1; ak <= kRoot; ak++) {
        ax = Math.floor(ax / 2);
        ay = Math.floor(ay / 2);
        az = Math.floor(az / 2);
        splitNodes.add(`${levelScaleMult[ak]}:${ax},${ay},${az}`);
      }
    }

    const SEAM_DIRS: ReadonlyArray<readonly [number, number, number]> = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    let deferredSeamCount = 0;
    for (let i = 0; i < resolvedLeaves.length; i++) {
      const lf = resolvedLeaves[i];
      const ch = lf.chunk;
      const k = lf.node.k;
      const sm = lf.node.scaleMult;
      let seamMask = 0;

      for (let f = 0; f < 6; f++) {
        const dir = SEAM_DIRS[f];
        const ncx = lf.node.cx + dir[0];
        const ncy = lf.node.cy + dir[1];
        const ncz = lf.node.cz + dir[2];
        const nKey = `${sm}:${ncx},${ncy},${ncz}`;
        if (leafMap.has(nKey)) continue;
        if (splitNodes.has(nKey)) {
          seamMask |= 1 << f;
          continue;
        }
        let ax = ncx;
        let ay = ncy;
        let az = ncz;
        for (let ak = k + 1; ak <= kRoot; ak++) {
          ax = Math.floor(ax / 2);
          ay = Math.floor(ay / 2);
          az = Math.floor(az / 2);
          if (leafMap.has(`${levelScaleMult[ak]}:${ax},${ay},${az}`)) {
            seamMask |= 1 << f;
            break;
          }
        }
      }

      if (ch.dirty || ch.lastSeamMask !== seamMask) {
        if (
          Number.isFinite(timeBudgetMs) &&
          !ch.dirty &&
          rebuiltMeshes.length >= 4 &&
          performance.now() - streamStartMs >= timeBudgetMs * 1.3
        ) {
          deferredSeamCount++;
          continue;
        }
        rebuiltMeshes.push({
          key: ch.key,
          tier: lf.tier,
          scaleMult: ch.scaleMult,
          mesh: this.extractSparseChunkMesh(ch, blocky, seamMask),
        });
      }
    }

    // Retain already-built GPU meshes inside our sparse chunk cache so zoom transitions never allocate needlessly
    for (const c of this.sparseChunks.values()) {
      if (c.edited || c.built) {
        retainKeys.add(c.key);
      }
    }
    this.evictUnusedSparseChunks(isForcedLod0 ? 12000 : 5400, retainKeys);

    // Sync retainKeys to the surviving sparseChunks after eviction
    for (const key of retainKeys) {
      if (!this.sparseChunks.has(key)) {
        retainKeys.delete(key);
      }
    }

    const safeCapDot = clamp(hemiDotThresh + 0.1, -0.05, 0.92);
    const hemiDiscardRadius = this.svRootBuilt
      ? clamp(
          safeCapDot > 0
            ? this.baseRadius * Math.sqrt(Math.max(0.08, 2 * (1 - safeCapDot) * 0.82))
            : this.baseRadius * 1.32,
          this.baseRadius * 0.45,
          this.baseRadius * 1.32,
        )
      : 0;
    const midSpan = kRoot >= 2 ? levelSpan[Math.max(1, Math.floor((kRoot - 1) * 0.5))] : nativeSpan;
    const pendingTotal = Math.max(0, totalPendingBuilds - builtThisFrame) + deferredSeamCount;

    return {
      active: true,
      hideMacro: this.svRootBuilt,
      globeBuiltComplete: this.svRootBuilt,
      hemiCenter: [
        focusDir[0] * this.baseRadius,
        focusDir[1] * this.baseRadius,
        focusDir[2] * this.baseRadius,
      ],
      hemiDiscardRadius,
      midOuterCenter: [surfF[0], surfF[1], surfF[2]],
      midOuterDiscardRadius: pendingTotal === 0 ? midSpan * 2.0 : 0,
      midCenter: [surfF[0], surfF[1], surfF[2]],
      midDiscardRadius: pendingTotal === 0 ? midSpan * 1.2 : 0,
      nativeCenter: [surfF[0], surfF[1], surfF[2]],
      nativeDiscardRadius: pendingTotal === 0 ? nativeSpan * 1.8 : 0,
      pendingTotal,
      desiredKeys,
      retainKeys,
      rebuiltMeshes,
    };
  }
}
