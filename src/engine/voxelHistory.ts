export interface SparseChunkMeta {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  scaleMult: number;
  edited: boolean;
}

export interface MacroVoxelDelta {
  indices: Uint32Array;
  prevDensity: Float32Array;
  nextDensity: Float32Array;
  prevMaterial: Uint8Array;
  nextMaterial: Uint8Array;
  dirtyChunkIndices: Uint32Array;
}

export interface SparseChunkCellDelta {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  scaleMult: number;
  existedBefore: boolean;
  wasEditedBefore: boolean;
  indices: Uint32Array;
  prevDensity: Float32Array;
  nextDensity: Float32Array;
  prevMaterial: Uint8Array;
  nextMaterial: Uint8Array;
}

export interface BrushOpCheckpointRecord {
  cx: number;
  cy: number;
  cz: number;
  ex: number;
  ey: number;
  ez: number;
  shape: 'sphere' | 'cylinder';
  mode: string;
  radius: number;
  strength: number;
  materialId: number;
  targetShellRadius: number;
  rimMaterial?: number;
  rimHeight?: number;
  floorMaterial?: number;
  jaggedNoise?: number;
}

export interface VoxelHistoryEntry {
  id: number;
  label: string;
  timestamp: number;
  center: [number, number, number];
  radius: number;
  macro: MacroVoxelDelta;
  sparseChunks: SparseChunkCellDelta[];
  brushOpsChanged: boolean;
  prevBrushOps?: BrushOpCheckpointRecord[];
  nextBrushOps?: BrushOpCheckpointRecord[];
}

export interface CircularHistorySnapshot {
  capacity: number;
  head: number;
  size: number;
  cursor: number;
  undoCount: number;
  redoCount: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export class CircularVoxelHistoryBuffer {
  public readonly capacity: number;
  private readonly slots: Array<VoxelHistoryEntry | null>;
  private head = 0;
  private size = 0;
  private cursor = 0;

  constructor(capacity = 64) {
    this.capacity = Math.max(2, Math.floor(capacity));
    this.slots = new Array<VoxelHistoryEntry | null>(this.capacity).fill(null);
  }

  public push(entry: VoxelHistoryEntry): void {
    // Discard invalidated redo branch above the current cursor
    if (this.cursor < this.size) {
      for (let i = this.cursor; i < this.size; i++) {
        this.slots[(this.head + i) % this.capacity] = null;
      }
      this.size = this.cursor;
    }

    if (this.size === this.capacity) {
      // Ring is full: overwrite oldest entry at head and advance head
      this.slots[this.head] = entry;
      this.head = (this.head + 1) % this.capacity;
      this.size = this.capacity;
      this.cursor = this.capacity;
    } else {
      const writeSlot = (this.head + this.size) % this.capacity;
      this.slots[writeSlot] = entry;
      this.size++;
      this.cursor = this.size;
    }
  }

  public undo(): VoxelHistoryEntry | null {
    if (this.cursor <= 0) return null;
    this.cursor--;
    const slot = (this.head + this.cursor) % this.capacity;
    return this.slots[slot];
  }

  public redo(): VoxelHistoryEntry | null {
    if (this.cursor >= this.size) return null;
    const slot = (this.head + this.cursor) % this.capacity;
    const entry = this.slots[slot];
    this.cursor++;
    return entry;
  }

  public clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.slots[i] = null;
    }
    this.head = 0;
    this.size = 0;
    this.cursor = 0;
  }

  public canUndo(): boolean {
    return this.cursor > 0;
  }

  public canRedo(): boolean {
    return this.cursor < this.size;
  }

  public getUndoCount(): number {
    return this.cursor;
  }

  public getRedoCount(): number {
    return this.size - this.cursor;
  }

  public getSize(): number {
    return this.size;
  }

  public getHeadIndex(): number {
    return this.head;
  }

  public peekUndoLabel(): string | null {
    if (this.cursor <= 0) return null;
    const slot = (this.head + this.cursor - 1) % this.capacity;
    return this.slots[slot]?.label ?? null;
  }

  public peekRedoLabel(): string | null {
    if (this.cursor >= this.size) return null;
    const slot = (this.head + this.cursor) % this.capacity;
    return this.slots[slot]?.label ?? null;
  }

  public getUndoEntriesOrdered(): VoxelHistoryEntry[] {
    const out: VoxelHistoryEntry[] = [];
    for (let i = 0; i < this.cursor; i++) {
      const entry = this.slots[(this.head + i) % this.capacity];
      if (entry) out.push(entry);
    }
    return out;
  }

  public getSnapshot(): CircularHistorySnapshot {
    return {
      capacity: this.capacity,
      head: this.head,
      size: this.size,
      cursor: this.cursor,
      undoCount: this.cursor,
      redoCount: this.size - this.cursor,
      canUndo: this.cursor > 0,
      canRedo: this.cursor < this.size,
      undoLabel: this.peekUndoLabel(),
      redoLabel: this.peekRedoLabel(),
    };
  }
}

interface SparseDeltaBucket {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  scaleMult: number;
  existedBefore: boolean;
  wasEditedBefore: boolean;
  slotByCell: Map<number, number>;
  cellIndices: number[];
  prevDensity: number[];
  nextDensity: number[];
  prevMaterial: number[];
  nextMaterial: number[];
}

function cloneBrushOps(ops: ReadonlyArray<BrushOpCheckpointRecord>): BrushOpCheckpointRecord[] {
  return ops.map((op) => ({ ...op }));
}

export class VoxelTransactionRecorder {
  public readonly label: string;
  public readonly timestamp: number;
  private centerX = 0;
  private centerY = 0;
  private centerZ = 0;
  private hasCenter = false;
  private maxRadius = 0;

  private readonly macroSlotByIdx = new Map<number, number>();
  private readonly macroIndices: number[] = [];
  private readonly macroPrevD: number[] = [];
  private readonly macroNextD: number[] = [];
  private readonly macroPrevM: number[] = [];
  private readonly macroNextM: number[] = [];
  private readonly dirtyChunks = new Set<number>();

  private readonly sparseBuckets = new Map<string, SparseDeltaBucket>();

  private brushOpsCapturedBefore = false;
  private prevBrushOpsSnapshot: BrushOpCheckpointRecord[] = [];
  private nextBrushOpsSnapshot: BrushOpCheckpointRecord[] | undefined;
  private brushOpsModified = false;

  constructor(label: string) {
    this.label = label;
    this.timestamp = Date.now();
  }

  public noteBrushRegion(cx: number, cy: number, cz: number, radius: number): void {
    if (!this.hasCenter) {
      this.centerX = cx;
      this.centerY = cy;
      this.centerZ = cz;
      this.hasCenter = true;
    } else {
      // Running midpoint keeps stroke focus bounded inside edited region
      this.centerX = (this.centerX + cx) * 0.5;
      this.centerY = (this.centerY + cy) * 0.5;
      this.centerZ = (this.centerZ + cz) * 0.5;
    }
    if (radius > this.maxRadius) {
      this.maxRadius = radius;
    }
  }

  public recordMacroCell(
    idx: number,
    prevD: number,
    prevM: number,
    nextD: number,
    nextM: number,
  ): void {
    if (prevD === nextD && prevM === nextM) return;
    const existingSlot = this.macroSlotByIdx.get(idx);
    if (existingSlot === undefined) {
      const slot = this.macroIndices.length;
      this.macroSlotByIdx.set(idx, slot);
      this.macroIndices.push(idx);
      this.macroPrevD.push(prevD);
      this.macroNextD.push(nextD);
      this.macroPrevM.push(prevM);
      this.macroNextM.push(nextM);
    } else {
      this.macroNextD[existingSlot] = nextD;
      this.macroNextM[existingSlot] = nextM;
    }
  }

  public recordDirtyChunks(chunkIndices: ReadonlyArray<number>): void {
    for (let i = 0; i < chunkIndices.length; i++) {
      this.dirtyChunks.add(chunkIndices[i]);
    }
  }

  public ensureSparseChunk(
    chunk: SparseChunkMeta,
    existedBefore: boolean,
    wasEditedBefore: boolean,
  ): SparseDeltaBucket {
    let bucket = this.sparseBuckets.get(chunk.key);
    if (!bucket) {
      bucket = {
        key: chunk.key,
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
        scaleMult: chunk.scaleMult,
        existedBefore,
        wasEditedBefore,
        slotByCell: new Map<number, number>(),
        cellIndices: [],
        prevDensity: [],
        nextDensity: [],
        prevMaterial: [],
        nextMaterial: [],
      };
      this.sparseBuckets.set(chunk.key, bucket);
    }
    return bucket;
  }

  public recordSparseCell(
    chunk: SparseChunkMeta,
    cellIdx: number,
    prevD: number,
    prevM: number,
    nextD: number,
    nextM: number,
    existedBefore = true,
    wasEditedBefore = chunk.edited,
  ): void {
    if (prevD === nextD && prevM === nextM) return;
    const bucket = this.ensureSparseChunk(chunk, existedBefore, wasEditedBefore);
    const existingSlot = bucket.slotByCell.get(cellIdx);
    if (existingSlot === undefined) {
      const slot = bucket.cellIndices.length;
      bucket.slotByCell.set(cellIdx, slot);
      bucket.cellIndices.push(cellIdx);
      bucket.prevDensity.push(prevD);
      bucket.nextDensity.push(nextD);
      bucket.prevMaterial.push(prevM);
      bucket.nextMaterial.push(nextM);
    } else {
      bucket.nextDensity[existingSlot] = nextD;
      bucket.nextMaterial[existingSlot] = nextM;
    }
  }

  public captureBrushOpsBefore(ops: ReadonlyArray<BrushOpCheckpointRecord>): void {
    if (!this.brushOpsCapturedBefore) {
      this.brushOpsCapturedBefore = true;
      this.prevBrushOpsSnapshot = cloneBrushOps(ops);
    }
  }

  public markBrushOpsAfter(ops: ReadonlyArray<BrushOpCheckpointRecord>): void {
    this.brushOpsModified = true;
    this.nextBrushOpsSnapshot = cloneBrushOps(ops);
  }

  public finalize(id: number): VoxelHistoryEntry | null {
    // Keep only cells whose net post-state actually differs from pre-state
    let netMacroCount = 0;
    for (let i = 0; i < this.macroIndices.length; i++) {
      if (
        this.macroPrevD[i] !== this.macroNextD[i] ||
        this.macroPrevM[i] !== this.macroNextM[i]
      ) {
        netMacroCount++;
      }
    }

    const sparseChunks: SparseChunkCellDelta[] = [];
    for (const bucket of this.sparseBuckets.values()) {
      let netSparseCount = 0;
      for (let i = 0; i < bucket.cellIndices.length; i++) {
        if (
          bucket.prevDensity[i] !== bucket.nextDensity[i] ||
          bucket.prevMaterial[i] !== bucket.nextMaterial[i]
        ) {
          netSparseCount++;
        }
      }
      if (netSparseCount === 0) continue;

      const indices = new Uint32Array(netSparseCount);
      const prevDensity = new Float32Array(netSparseCount);
      const nextDensity = new Float32Array(netSparseCount);
      const prevMaterial = new Uint8Array(netSparseCount);
      const nextMaterial = new Uint8Array(netSparseCount);

      let w = 0;
      for (let i = 0; i < bucket.cellIndices.length; i++) {
        if (
          bucket.prevDensity[i] !== bucket.nextDensity[i] ||
          bucket.prevMaterial[i] !== bucket.nextMaterial[i]
        ) {
          indices[w] = bucket.cellIndices[i];
          prevDensity[w] = bucket.prevDensity[i];
          nextDensity[w] = bucket.nextDensity[i];
          prevMaterial[w] = bucket.prevMaterial[i];
          nextMaterial[w] = bucket.nextMaterial[i];
          w++;
        }
      }

      sparseChunks.push({
        key: bucket.key,
        cx: bucket.cx,
        cy: bucket.cy,
        cz: bucket.cz,
        scaleMult: bucket.scaleMult,
        existedBefore: bucket.existedBefore,
        wasEditedBefore: bucket.wasEditedBefore,
        indices,
        prevDensity,
        nextDensity,
        prevMaterial,
        nextMaterial,
      });
    }

    if (netMacroCount === 0 && sparseChunks.length === 0 && !this.brushOpsModified) {
      return null;
    }

    const mIndices = new Uint32Array(netMacroCount);
    const mPrevD = new Float32Array(netMacroCount);
    const mNextD = new Float32Array(netMacroCount);
    const mPrevM = new Uint8Array(netMacroCount);
    const mNextM = new Uint8Array(netMacroCount);

    let mw = 0;
    for (let i = 0; i < this.macroIndices.length; i++) {
      if (
        this.macroPrevD[i] !== this.macroNextD[i] ||
        this.macroPrevM[i] !== this.macroNextM[i]
      ) {
        mIndices[mw] = this.macroIndices[i];
        mPrevD[mw] = this.macroPrevD[i];
        mNextD[mw] = this.macroNextD[i];
        mPrevM[mw] = this.macroPrevM[i];
        mNextM[mw] = this.macroNextM[i];
        mw++;
      }
    }

    const dirtyChunkIndices = Uint32Array.from(this.dirtyChunks);

    return {
      id,
      label: this.label,
      timestamp: this.timestamp,
      center: [this.centerX, this.centerY, this.centerZ],
      radius: this.maxRadius,
      macro: {
        indices: mIndices,
        prevDensity: mPrevD,
        nextDensity: mNextD,
        prevMaterial: mPrevM,
        nextMaterial: mNextM,
        dirtyChunkIndices,
      },
      sparseChunks,
      brushOpsChanged: this.brushOpsModified,
      prevBrushOps: this.brushOpsModified ? this.prevBrushOpsSnapshot : undefined,
      nextBrushOps: this.brushOpsModified ? this.nextBrushOpsSnapshot : undefined,
    };
  }
}
