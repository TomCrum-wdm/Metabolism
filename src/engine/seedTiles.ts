import {
  DEFAULT_SEED_CONFIG,
  PLANET_PRESETS,
  PlanetSeedConfig,
} from './voxelPlanet';

const TILES_STORAGE_KEY = 'terrasphere_seed_tiles_v1';

export const TILE_ACCENT_PALETTE = [
  '#38bdf8',
  '#34d399',
  '#f59e0b',
  '#a855f7',
  '#22d3ee',
  '#fb7185',
] as const;

export interface PlanetTileItem {
  id: string;
  title: string;
  notes: string;
  accent: string;
  builtIn?: boolean;
  pinned?: boolean;
  config: PlanetSeedConfig;
  updatedAt: number;
}

export interface TilePlanetPreview {
  landColor: string;
  ridgeColor: string;
  oceanColor: string;
  atmoColor: string;
  crystalGlow: string;
  waterOpacity: number;
  iceOpacity: number;
  craters: Array<{ cx: number; cy: number; r: number }>;
  continentShiftX: number;
  continentShiftY: number;
}

const PRESET_ACCENTS: Record<string, string> = {
  terran: '#34d399',
  titan: '#f59e0b',
  asteroid: '#a855f7',
  cryo: '#38bdf8',
  pangaea_epic: '#fb7185',
};

export function createStarterTiles(): PlanetTileItem[] {
  const now = Date.now();
  return PLANET_PRESETS.map((p, idx) => ({
    id: `preset_${p.id}`,
    title: p.label,
    notes: p.desc,
    accent: PRESET_ACCENTS[p.id] ?? TILE_ACCENT_PALETTE[idx % TILE_ACCENT_PALETTE.length],
    builtIn: true,
    pinned: idx === 0,
    config: { ...p.config },
    updatedAt: now - idx * 1000,
  }));
}

export function loadSeedTiles(): PlanetTileItem[] {
  try {
    if (typeof localStorage === 'undefined') return createStarterTiles();
    const raw = localStorage.getItem(TILES_STORAGE_KEY);
    if (!raw) return createStarterTiles();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return createStarterTiles();
    }
    const valid = parsed
      .filter(
        (item): item is PlanetTileItem =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          Boolean(item.config) &&
          typeof item.config.seed === 'number',
      )
      .map((item, idx) => ({
        id: item.id,
        title: item.title || `星球方案 ${idx + 1}`,
        notes: typeof item.notes === 'string' ? item.notes : '',
        accent:
          typeof item.accent === 'string'
            ? item.accent
            : TILE_ACCENT_PALETTE[idx % TILE_ACCENT_PALETTE.length],
        builtIn: Boolean(item.builtIn),
        pinned: Boolean(item.pinned),
        config: { ...DEFAULT_SEED_CONFIG, ...item.config },
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
      }));
    return valid.length > 0 ? valid : createStarterTiles();
  } catch {
    return createStarterTiles();
  }
}

export function saveSeedTiles(tiles: PlanetTileItem[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TILES_STORAGE_KEY, JSON.stringify(tiles));
  } catch {
    // Ignore storage quota issues
  }
}

export function resetStarterTiles(): PlanetTileItem[] {
  const starter = createStarterTiles();
  saveSeedTiles(starter);
  return starter;
}

export function createCustomSeedTile(
  baseConfig?: Partial<PlanetSeedConfig>,
  title?: string,
  notes?: string,
  accent?: string,
): PlanetTileItem {
  const randomSeed = Math.floor(100000 + Math.random() * 899999);
  const cfg: PlanetSeedConfig = {
    ...DEFAULT_SEED_CONFIG,
    ...baseConfig,
    seed: baseConfig?.seed ?? randomSeed,
  };
  const paletteIdx = cfg.seed % TILE_ACCENT_PALETTE.length;
  return {
    id: `tile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: title ?? `自定义星球 #${cfg.seed}`,
    notes: notes ?? `R=${cfg.radius}m · 分辨率 ${cfg.voxelRadius} 块 · 水体 ${Math.round(cfg.waterFill * 100)}%`,
    accent: accent ?? TILE_ACCENT_PALETTE[paletteIdx],
    builtIn: false,
    pinned: false,
    config: cfg,
    updatedAt: Date.now(),
  };
}

export function computeTilePlanetPreview(cfg: PlanetSeedConfig): TilePlanetPreview {
  let rng = (Math.max(1, Math.floor(Math.abs(cfg.seed))) ^ 0x6d2b79f5) >>> 0;
  const rand = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };

  const hueShift = rand();
  const landColor =
    cfg.crystalRichness > 0.72
      ? '#475569'
      : cfg.waterFill < 0.35
        ? '#a16207'
        : hueShift > 0.55
          ? '#2f855a'
          : '#3b8c66';
  const ridgeColor =
    cfg.crystalRichness > 0.72
      ? '#67e8f9'
      : cfg.ridgeAmp > 2.7
        ? '#94a3b8'
        : '#64748b';
  const oceanColor = cfg.waterFill > 1.2 ? '#0284c7' : '#0ea5e9';
  const atmoColor =
    cfg.crystalRichness > 0.72
      ? '#38bdf8'
      : cfg.waterFill < 0.35
        ? '#f59e0b'
        : '#38bdf8';
  const crystalGlow = cfg.crystalRichness > 0.65 ? '#22d3ee' : '#34d399';

  const craterDrawCount = Math.min(6, Math.max(0, Math.round(cfg.craterCount)));
  const craters: Array<{ cx: number; cy: number; r: number }> = [];
  for (let i = 0; i < craterDrawCount; i++) {
    craters.push({
      cx: 18 + rand() * 28,
      cy: 16 + rand() * 32,
      r: 2.2 + rand() * 3.8,
    });
  }

  return {
    landColor,
    ridgeColor,
    oceanColor,
    atmoColor,
    crystalGlow,
    waterOpacity: Math.min(0.85, Math.max(0, cfg.waterFill * 0.42)),
    iceOpacity: cfg.crystalRichness > 0.65 ? 0.65 : 0.38,
    craters,
    continentShiftX: (rand() - 0.5) * 14,
    continentShiftY: (rand() - 0.5) * 10,
  };
}
