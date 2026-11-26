import { CoordSystemId } from './coordinates';
import { FluidSnapshot } from './fluidSim';
import { encodeSeedCode, PlanetSeedConfig, VoxelPlanetSnapshot } from './voxelPlanet';

const DB_NAME = 'TerraSphereDB';
const DB_VERSION = 1;
const STORE_NAME = 'planet_saves';
const PREFS_KEY = 'terrasphere_prefs_v1';
export const AUTOSAVE_SLOT_ID = '__autosave__';
export const HANDOFF_SLOT_PREFIX = '__handoff__';

export interface PlanetSavePayload {
  id: string;
  name: string;
  updatedAt: number;
  planet: VoxelPlanetSnapshot;
  fluid: FluidSnapshot;
  playerPos: [number, number, number];
  playerFwd: [number, number, number];
  gravityScale: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
}

export interface PlanetSaveSummary {
  id: string;
  name: string;
  updatedAt: number;
  seed: number;
  radius: number;
  waterParticles: number;
  isAutosave: boolean;
}

export interface StoredUserPrefs {
  autoSaveEnabled: boolean;
  gravityScale?: number;
  sunElevationDeg?: number;
  sunAzimuthDeg?: number;
  lodMode?: 'auto' | 0 | 1 | 2;
  lod0Dist?: number;
  lod1Dist?: number;
  touchEnabled?: boolean;
  perspectiveFov?: number;
  playerScale?: number;
  coordSystem?: CoordSystemId;
  mouseSensitivity?: number;
  cameraDamping?: number;
  fpsSpeedMult?: number;
  horizonStreamBudget?: number;
  voxelEdges?: boolean;
  showCoordGrid?: boolean;
  showGravityVectors?: boolean;
  muted?: boolean;
  leftDockOpen?: boolean;
  bottomDockOpen?: boolean;
  workspaceDensity?: 'compact' | 'standard';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function savePlanetToDb(payload: PlanetSavePayload): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Save transaction failed'));
    });
  } finally {
    db.close();
  }
}

export async function loadPlanetFromDb(
  id: string,
): Promise<PlanetSavePayload | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise<PlanetSavePayload | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as PlanetSavePayload) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function listPlanetSavesFromDb(): Promise<PlanetSaveSummary[]> {
  try {
    const db = await openDb();
    try {
      const all = await new Promise<PlanetSavePayload[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as PlanetSavePayload[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      return all
        .filter((s) => !s.id.startsWith(HANDOFF_SLOT_PREFIX))
        .map((s) => ({
          id: s.id,
          name: s.name,
          updatedAt: s.updatedAt,
          seed: s.planet.seedConfig.seed,
          radius: s.planet.seedConfig.radius,
          waterParticles: s.fluid.activeCount,
          isAutosave: s.id === AUTOSAVE_SLOT_ID,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function deletePlanetSaveFromDb(id: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore when IndexedDB unavailable
  }
}

export function loadStoredPrefs(): StoredUserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { autoSaveEnabled: true };
    const parsed = JSON.parse(raw) as Partial<StoredUserPrefs>;
    return {
      autoSaveEnabled: parsed.autoSaveEnabled ?? true,
      gravityScale: parsed.gravityScale,
      sunElevationDeg: parsed.sunElevationDeg,
      sunAzimuthDeg: parsed.sunAzimuthDeg,
      lodMode: parsed.lodMode,
      lod0Dist: parsed.lod0Dist,
      lod1Dist: parsed.lod1Dist,
      touchEnabled: parsed.touchEnabled,
      perspectiveFov: parsed.perspectiveFov,
      playerScale: parsed.playerScale,
      coordSystem: parsed.coordSystem,
      mouseSensitivity: parsed.mouseSensitivity,
      cameraDamping: parsed.cameraDamping,
      fpsSpeedMult: parsed.fpsSpeedMult,
      horizonStreamBudget: parsed.horizonStreamBudget,
      voxelEdges: parsed.voxelEdges,
      showCoordGrid: parsed.showCoordGrid,
      showGravityVectors: parsed.showGravityVectors,
      muted: parsed.muted,
      leftDockOpen: parsed.leftDockOpen,
      bottomDockOpen: parsed.bottomDockOpen,
      workspaceDensity: parsed.workspaceDensity,
    };
  } catch {
    return { autoSaveEnabled: true };
  }
}

export function saveStoredPrefs(prefs: StoredUserPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearStoredPrefs(): void {
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    // Ignore
  }
}

export function formatSeedSummary(cfg: PlanetSeedConfig): string {
  return `#${cfg.seed} · R=${cfg.radius}m · 坑=${cfg.craterCount} · 水=${Math.round(cfg.waterFill * 100)}%`;
}

export function buildNewTabLaunchUrl(
  seedCfg: PlanetSeedConfig,
  slotId?: string,
): string {
  if (typeof window === 'undefined') return '?autostart=1';
  const url = new URL(window.location.href);
  url.searchParams.set('seed', encodeSeedCode(seedCfg));
  url.searchParams.set('autostart', '1');
  if (slotId) {
    url.searchParams.set('slot', slotId);
  }
  return url.toString();
}
