import {
  DirectorExportFormat,
  DirectorSceneAnchor,
  DirectorTimelineProject,
  RgbHistogramBins,
} from './director';
import { FluidSnapshot } from './fluidSim';
import { ThermalHotspot } from './thermal';
import { VoxelPlanetSnapshot } from './voxelPlanet';
import { buildTarArchive, WebmMuxer, WebmVideoCodec } from './webmMuxer';

const DIRECTOR_DB_NAME = 'TerraSphereDirectorDB';
const DIRECTOR_DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_JOBS = 'jobs';
const STORE_CHECKPOINTS = 'checkpoints';
const STORE_CHUNKS = 'chunks';

export type RenderJobStatus =
  | 'rendering'
  | 'paused'
  | 'aborted'
  | 'completed'
  | 'error';

export interface RenderCheckpointJob {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: number;
  updatedAt: number;
  status: RenderJobStatus;
  format: DirectorExportFormat;
  webmCodec?: WebmVideoCodec;
  encoderLabel: string;
  width: number;
  height: number;
  fps: number;
  startFrame: number;
  endFrame: number;
  totalFrames: number;
  keyframeInterval: number;
  completedFrames: number;
  lastCheckpointFrame: number;
  errorMessage?: string;
  projectSnapshot: DirectorTimelineProject;
  anchorSnapshot: DirectorSceneAnchor;
}

export interface SimulationCheckpointRecord {
  key: string; // `${jobId}::${frameIdx}`
  jobId: string;
  frameIdx: number;
  createdAt: number;
  simTimeSec: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  planet: VoxelPlanetSnapshot;
  fluid: FluidSnapshot;
  hotspots: ThermalHotspot[];
  firedEventIds: string[];
  playerPos: [number, number, number];
  playerFwd: [number, number, number];
}

export interface EncodedFrameChunkRecord {
  key: string; // `${jobId}::${frameIdx}`
  jobId: string;
  frameIdx: number;
  timestampUs: number;
  isKeyFrame: boolean;
  isPng: boolean;
  payload: ArrayBuffer;
  thumbDataUrl: string;
  renderMs: number;
  meanLuma: number;
  alphaMin: number;
  histogram: RgbHistogramBins;
}

export interface FrameFilmstripItem {
  frameIdx: number;
  thumbDataUrl: string;
  renderMs: number;
  meanLuma: number;
  alphaMin: number;
  histogram: RgbHistogramBins;
  isKeyFrame: boolean;
}

function openDirectorDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DIRECTOR_DB_NAME, DIRECTOR_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_JOBS)) {
        db.createObjectStore(STORE_JOBS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
        const s = db.createObjectStore(STORE_CHECKPOINTS, { keyPath: 'key' });
        s.createIndex('jobId', 'jobId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const s = db.createObjectStore(STORE_CHUNKS, { keyPath: 'key' });
        s.createIndex('jobId', 'jobId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('Failed to open Director IndexedDB'));
  });
}

export async function saveDirectorProjectToDb(
  project: DirectorTimelineProject,
): Promise<void> {
  try {
    const db = await openDirectorDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PROJECTS, 'readwrite');
        tx.objectStore(STORE_PROJECTS).put({
          ...project,
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Save project failed'));
      });
    } finally {
      db.close();
    }
  } catch {
    // Graceful no-op when IndexedDB unavailable
  }
}

export async function listDirectorProjectsFromDb(): Promise<
  DirectorTimelineProject[]
> {
  try {
    const db = await openDirectorDb();
    try {
      const rows = await new Promise<DirectorTimelineProject[]>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_PROJECTS, 'readonly');
          const req = tx.objectStore(STORE_PROJECTS).getAll();
          req.onsuccess = () =>
            resolve((req.result as DirectorTimelineProject[]) ?? []);
          req.onerror = () => reject(req.error);
        },
      );
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function deleteDirectorProjectFromDb(id: string): Promise<void> {
  try {
    const db = await openDirectorDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PROJECTS, 'readwrite');
        tx.objectStore(STORE_PROJECTS).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function saveRenderJobToDb(
  job: RenderCheckpointJob,
): Promise<void> {
  try {
    const db = await openDirectorDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_JOBS, 'readwrite');
        tx.objectStore(STORE_JOBS).put(job);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Save job failed'));
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function getRenderJobFromDb(
  jobId: string,
): Promise<RenderCheckpointJob | null> {
  try {
    const db = await openDirectorDb();
    try {
      return await new Promise<RenderCheckpointJob | null>((resolve, reject) => {
        const tx = db.transaction(STORE_JOBS, 'readonly');
        const req = tx.objectStore(STORE_JOBS).get(jobId);
        req.onsuccess = () =>
          resolve((req.result as RenderCheckpointJob) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function listRenderJobsFromDb(): Promise<RenderCheckpointJob[]> {
  try {
    const db = await openDirectorDb();
    try {
      const rows = await new Promise<RenderCheckpointJob[]>((resolve, reject) => {
        const tx = db.transaction(STORE_JOBS, 'readonly');
        const req = tx.objectStore(STORE_JOBS).getAll();
        req.onsuccess = () =>
          resolve((req.result as RenderCheckpointJob[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function saveSimulationCheckpointToDb(
  cp: Omit<SimulationCheckpointRecord, 'key'>,
): Promise<void> {
  const key = `${cp.jobId}::${cp.frameIdx}`;
  try {
    const db = await openDirectorDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_CHECKPOINTS, 'readwrite');
        tx.objectStore(STORE_CHECKPOINTS).put({ ...cp, key });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Save checkpoint failed'));
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function getLatestCheckpointAtOrBefore(
  jobId: string,
  maxFrameIdx: number,
): Promise<SimulationCheckpointRecord | null> {
  try {
    const db = await openDirectorDb();
    try {
      const matches = await new Promise<SimulationCheckpointRecord[]>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_CHECKPOINTS, 'readonly');
          const idx = tx.objectStore(STORE_CHECKPOINTS).index('jobId');
          const req = idx.getAll(IDBKeyRange.only(jobId));
          req.onsuccess = () =>
            resolve((req.result as SimulationCheckpointRecord[]) ?? []);
          req.onerror = () => reject(req.error);
        },
      );
      let best: SimulationCheckpointRecord | null = null;
      for (const item of matches) {
        if (item.frameIdx <= maxFrameIdx) {
          if (!best || item.frameIdx > best.frameIdx) {
            best = item;
          }
        }
      }
      return best;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function saveEncodedFrameChunkToDb(
  chunk: Omit<EncodedFrameChunkRecord, 'key'>,
): Promise<void> {
  const key = `${chunk.jobId}::${chunk.frameIdx}`;
  try {
    const db = await openDirectorDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, 'readwrite');
        tx.objectStore(STORE_CHUNKS).put({ ...chunk, key });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Save chunk failed'));
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function getEncodedFrameChunksForJob(
  jobId: string,
  maxFrameInclusive?: number,
): Promise<EncodedFrameChunkRecord[]> {
  try {
    const db = await openDirectorDb();
    try {
      const rows = await new Promise<EncodedFrameChunkRecord[]>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_CHUNKS, 'readonly');
          const idx = tx.objectStore(STORE_CHUNKS).index('jobId');
          const req = idx.getAll(IDBKeyRange.only(jobId));
          req.onsuccess = () =>
            resolve((req.result as EncodedFrameChunkRecord[]) ?? []);
          req.onerror = () => reject(req.error);
        },
      );
      return rows
        .filter(
          (r) =>
            maxFrameInclusive === undefined || r.frameIdx <= maxFrameInclusive,
        )
        .sort((a, b) => a.frameIdx - b.frameIdx);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function getJobFilmstripItems(
  jobId: string,
): Promise<FrameFilmstripItem[]> {
  const chunks = await getEncodedFrameChunksForJob(jobId);
  return chunks.map((c) => ({
    frameIdx: c.frameIdx,
    thumbDataUrl: c.thumbDataUrl,
    renderMs: c.renderMs,
    meanLuma: c.meanLuma,
    alphaMin: c.alphaMin,
    histogram: c.histogram,
    isKeyFrame: c.isKeyFrame,
  }));
}

export async function deleteRenderJobAndAssetsFromDb(
  jobId: string,
): Promise<void> {
  try {
    const db = await openDirectorDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          [STORE_JOBS, STORE_CHECKPOINTS, STORE_CHUNKS],
          'readwrite',
        );
        tx.objectStore(STORE_JOBS).delete(jobId);

        const clearByIndex = (storeName: string) => {
          const idx = tx.objectStore(storeName).index('jobId');
          const curReq = idx.openKeyCursor(IDBKeyRange.only(jobId));
          curReq.onsuccess = () => {
            const cur = curReq.result;
            if (cur) {
              tx.objectStore(storeName).delete(cur.primaryKey);
              cur.continue();
            }
          };
        };
        clearByIndex(STORE_CHECKPOINTS);
        clearByIndex(STORE_CHUNKS);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

/**
 * Stitches ordered IndexedDB chunks of a checkpointed render job into a downloadable WebM video or TAR PNG archive.
 * Works seamlessly for BOTH completed renders AND partial/paused renders (safe partial export!).
 */
export async function assembleDirectorJobBlob(
  job: RenderCheckpointJob,
  seedTag: number,
): Promise<{
  blob: Blob;
  mimeType: string;
  filename: string;
  frameCount: number;
  actualWidth: number;
  actualHeight: number;
  fps: number;
  encoderLabel: string;
}> {
  const chunks = await getEncodedFrameChunksForJob(job.id);
  if (chunks.length === 0) {
    throw new Error('该渲染任务尚无可导出的已渲染帧数据');
  }

  // Keep only contiguous frames starting from job.startFrame so muxed timestamps remain gapless
  const contiguous: EncodedFrameChunkRecord[] = [];
  let expectedFrame = chunks[0].frameIdx;
  for (const ch of chunks) {
    if (ch.frameIdx !== expectedFrame) break;
    contiguous.push(ch);
    expectedFrame++;
  }
  const usable = contiguous.length > 0 ? contiguous : chunks;

  const isTar = usable[0].isPng || job.format === 'png-tar';
  if (isTar) {
    const tarEntries = usable.map((c) => ({
      name: `frame_${String(c.frameIdx).padStart(5, '0')}.png`,
      data: new Uint8Array(c.payload),
    }));
    const tarBytes = buildTarArchive(tarEntries);
    return {
      blob: new Blob([new Uint8Array(tarBytes)], { type: 'application/x-tar' }),
      mimeType: 'application/x-tar',
      filename: `terrasphere-${seedTag}-nle-${job.width}x${job.height}-${job.fps}fps-${usable.length}f.tar`,
      frameCount: usable.length,
      actualWidth: job.width,
      actualHeight: job.height,
      fps: job.fps,
      encoderLabel: job.encoderLabel,
    };
  }

  const muxer = new WebmMuxer({
    width: job.width,
    height: job.height,
    fps: job.fps,
    codec: job.webmCodec ?? (job.format === 'webm-vp8' ? 'V_VP8' : 'V_VP9'),
  });
  const baseTs = usable[0].timestampUs;
  for (const c of usable) {
    muxer.addVideoChunk(
      new Uint8Array(c.payload),
      Math.max(0, c.timestampUs - baseTs),
      c.isKeyFrame,
    );
  }
  const webmBytes = muxer.finalize();
  return {
    blob: new Blob([new Uint8Array(webmBytes)], { type: 'video/webm' }),
    mimeType: 'video/webm',
    filename: `terrasphere-${seedTag}-nle-${job.width}x${job.height}-${job.fps}fps-${usable.length}f.webm`,
    frameCount: usable.length,
    actualWidth: job.width,
    actualHeight: job.height,
    fps: job.fps,
    encoderLabel: job.encoderLabel,
  };
}
