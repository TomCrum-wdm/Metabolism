import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  decodeSeedCode,
  DEFAULT_SEED_CONFIG,
  hashSeedString,
  MaterialId,
  PlanetSeedConfig,
} from './engine/voxelPlanet';
import { DEFAULT_PLANET_RADIUS } from './engine/gravity';
import {
  CameraMode,
  GamePhase,
  PlanetarySandboxEngine,
  SandboxConfig,
  SandboxTelemetry,
} from './engine/webgpuScene';
import {
  AUTOSAVE_SLOT_ID,
  buildNewTabLaunchUrl,
  deletePlanetSaveFromDb,
  HANDOFF_SLOT_PREFIX,
  listPlanetSavesFromDb,
  loadPlanetFromDb,
  loadStoredPrefs,
  PlanetSaveSummary,
  savePlanetToDb,
  saveStoredPrefs,
} from './engine/persistence';
import { DEFAULT_ATMOS_CONFIG } from './engine/atmosphere';
import { DEFAULT_THERMAL_CONFIG } from './engine/thermal';
import { TitleOverlay } from './components/TitleOverlay';
import { GameHud } from './components/GameHud';
import { PauseModal } from './components/PauseModal';
import { DebugMenu } from './components/DebugMenu';
import { WorldSeedModal } from './components/WorldSeedModal';
import { TouchControlsOverlay } from './components/TouchControlsOverlay';
import { MapsModal } from './components/MapsModal';
import { AtmosphereThermalPanel } from './components/AtmosphereThermalPanel';

const NEXT_CAMERA: Record<CameraMode, CameraMode> = {
  explorer: 'orbit',
  orbit: 'fps',
  fps: 'explorer',
};

interface InitialLaunchParams {
  autostart: boolean;
  seedConfig?: PlanetSeedConfig;
  slotId?: string;
}

function parseInitialLaunchParams(): InitialLaunchParams {
  if (typeof window === 'undefined') {
    return { autostart: false };
  }
  const params = new URLSearchParams(window.location.search);
  const autostart = params.get('autostart') === '1';
  const slotParam = params.get('slot')?.trim() || undefined;
  const seedParam = params.get('seed')?.trim();

  let seedConfig: PlanetSeedConfig | undefined;
  if (seedParam) {
    const decoded = decodeSeedCode(seedParam);
    if (decoded) {
      seedConfig = decoded;
    } else {
      seedConfig = {
        ...DEFAULT_SEED_CONFIG,
        seed: hashSeedString(seedParam),
      };
    }
  }

  return { autostart, seedConfig, slotId: slotParam };
}

function buildInitialConfig(initialRadius?: number): SandboxConfig {
  const prefs = loadStoredPrefs();
  const rScale =
    initialRadius && initialRadius > 0.05
      ? initialRadius / DEFAULT_PLANET_RADIUS
      : 1.0;

  return {
    tool: 'carve',
    material: MaterialId.Soil,
    brushRadius: Number((1.9 * rScale).toPrecision(4)),
    brushStrength: 1.85,
    gravityScale: prefs.gravityScale ?? 1.0,
    sunElevationDeg: prefs.sunElevationDeg ?? 28,
    sunAzimuthDeg: prefs.sunAzimuthDeg ?? 28,
    showGravityVectors: false,
    cameraMode: 'explorer',
    muted: false,
    simPaused: false,
    lodMode: prefs.lodMode ?? 'auto',
    lod0Dist: Number(((prefs.lod0Dist ?? 23.0) * rScale).toPrecision(4)),
    lod1Dist: Number(((prefs.lod1Dist ?? 34.0) * rScale).toPrecision(4)),
    wireframe: false,
    showChunkBounds: false,
    debugProbeEnabled: false,
    terrainRenderMode: 'smooth',
    terrainOverlay: 'material',
    voxelEdges: true,
    atmosphere: { ...DEFAULT_ATMOS_CONFIG },
    thermal: { ...DEFAULT_THERMAL_CONFIG },
  };
}

function detectInitialTouchEnabled(): boolean {
  const prefs = loadStoredPrefs();
  if (prefs.touchEnabled !== undefined) {
    return prefs.touchEnabled;
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(pointer: coarse)').matches;
  }
  return false;
}

const INITIAL_TELEMETRY: SandboxTelemetry = {
  altitude: 1.4,
  localGravity: 9.81,
  escapeVelocity: 16.0,
  waterParticles: 560,
  terrainVertices: 48000,
  backend: 'WebGPU',
  grounded: true,
  cameraMode: 'explorer',
  fps: 60,
  frameTimeMs: 16.6,
  simStepMs: 0.4,
  lodCounts: [120, 0, 0, 223],
  activeChunks: 120,
  planetRadius: DEFAULT_SEED_CONFIG.radius,
  seed: DEFAULT_SEED_CONFIG.seed,
  fpsSpeed: 12.0,
  hoveredProbe: null,
  localTempC: 18.4,
  localTempK: 291.55,
  localPressureAtm: 1.0,
  localHumidity: 0.46,
  windSpeedMs: 4.2,
  atmoLayer: '对流层',
  thermalRegime: '温带',
  playerLatDeg: 0,
  playerLonDeg: 0,
  sunDir: [0.7, 0.5, 0.5],
  simTimeSec: 0,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PlanetarySandboxEngine | null>(null);
  const launchParamsRef = useRef<InitialLaunchParams | null>(null);
  if (!launchParamsRef.current) {
    launchParamsRef.current = parseInitialLaunchParams();
  }
  const launchParams = launchParamsRef.current;

  const tabHandoffIdRef = useRef<string>(
    `${HANDOFF_SLOT_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  );

  const [phase, setPhase] = useState<GamePhase>(() =>
    launchParams.autostart || launchParams.slotId ? 'playing' : 'title',
  );
  const [config, setConfig] = useState<SandboxConfig>(() =>
    buildInitialConfig(launchParams.seedConfig?.radius),
  );
  const [telemetry, setTelemetry] = useState<SandboxTelemetry>(() => ({
    ...INITIAL_TELEMETRY,
    planetRadius: launchParams.seedConfig?.radius ?? DEFAULT_SEED_CONFIG.radius,
    seed: launchParams.seedConfig?.seed ?? DEFAULT_SEED_CONFIG.seed,
  }));
  const [initError, setInitError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [atmosPanelOpen, setAtmosPanelOpen] = useState(false);
  const [seedModalOpen, setSeedModalOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [touchEnabled, setTouchEnabled] = useState<boolean>(
    detectInitialTouchEnabled,
  );
  const [touchActionMode, setTouchActionMode] = useState<'sculpt' | 'look'>(
    'sculpt',
  );
  const [saves, setSaves] = useState<PlanetSaveSummary[]>([]);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(
    () => loadStoredPrefs().autoSaveEnabled,
  );
  const [seedVersion, setSeedVersion] = useState(0);

  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  const configRef = useRef<SandboxConfig>(config);
  configRef.current = config;

  const touchEnabledRef = useRef(touchEnabled);
  touchEnabledRef.current = touchEnabled;

  const refreshSavesList = useCallback(async () => {
    const list = await listPlanetSavesFromDb();
    setSaves(list);
  }, []);

  // Scale brush & LOD thresholds proportionally when planet radius jumps
  const syncScaledConfigForRadius = useCallback(
    (oldRadius: number, newRadius: number) => {
      if (Math.abs(newRadius - oldRadius) <= 0.01) return;
      const ratio = Math.max(newRadius, 0.05) / Math.max(oldRadius, 0.05);
      setConfig((prev) => {
        const next: SandboxConfig = {
          ...prev,
          brushRadius: Number((prev.brushRadius * ratio).toPrecision(4)),
          lod0Dist: Number((prev.lod0Dist * ratio).toPrecision(4)),
          lod1Dist: Number((prev.lod1Dist * ratio).toPrecision(4)),
        };
        engineRef.current?.updateConfig(next);
        return next;
      });
    },
    [],
  );

  // Sync game state machine to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = phase;
    engineRef.current?.setPhase(phase);
  }, [phase]);

  // Sync touch control flags to engine
  useEffect(() => {
    engineRef.current?.setTouchEnabled(touchEnabled);
  }, [touchEnabled]);

  useEffect(() => {
    engineRef.current?.setTouchActionMode(touchActionMode);
  }, [touchActionMode]);

  // Mount WebGPU renderer & planetary engine once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new PlanetarySandboxEngine(
      container,
      (t) => setTelemetry(t),
      configRef.current,
      launchParams.seedConfig,
    );
    engineRef.current = engine;
    engine.setPhase(phaseRef.current);
    engine.setTouchEnabled(touchEnabledRef.current);

    let cancelled = false;

    engine
      .init()
      .then(async () => {
        if (cancelled) return;
        // If opened from another tab via IndexedDB handoff slot, restore full sculpted state
        if (launchParams.slotId) {
          let payload = await loadPlanetFromDb(launchParams.slotId);
          if (!payload && !cancelled) {
            await new Promise((r) => window.setTimeout(r, 180));
            payload = await loadPlanetFromDb(launchParams.slotId);
          }
          if (payload && !cancelled) {
            const oldR = engine.planet.baseRadius;
            engine.applySavePayload(payload);
            const newR = engine.planet.baseRadius;
            syncScaledConfigForRadius(oldR, newR);
            setConfig((prev) => ({
              ...prev,
              gravityScale: payload.gravityScale ?? prev.gravityScale,
              sunElevationDeg: payload.sunElevationDeg ?? prev.sunElevationDeg,
              sunAzimuthDeg: payload.sunAzimuthDeg ?? prev.sunAzimuthDeg,
            }));
            setSeedVersion((v) => v + 1);
          }
        }
      })
      .catch((err) => {
        console.error('WebGPU/WebGL initialization failed:', err);
        setInitError(
          err instanceof Error ? err.message : '图形渲染器初始化失败',
        );
      });

    void refreshSavesList();

    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, [launchParams, refreshSavesList, syncScaledConfigForRadius]);

  // Persist user preferences when LOD/gravity/sun/autosave/touch change
  useEffect(() => {
    saveStoredPrefs({
      autoSaveEnabled,
      gravityScale: config.gravityScale,
      sunElevationDeg: config.sunElevationDeg,
      sunAzimuthDeg: config.sunAzimuthDeg,
      lodMode: config.lodMode,
      lod0Dist: config.lod0Dist,
      lod1Dist: config.lod1Dist,
      touchEnabled,
    });
  }, [
    autoSaveEnabled,
    touchEnabled,
    config.gravityScale,
    config.sunElevationDeg,
    config.sunAzimuthDeg,
    config.lodMode,
    config.lod0Dist,
    config.lod1Dist,
  ]);

  // Periodic IndexedDB autosave + tab-handoff snapshot refresh during active gameplay
  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      const eng = engineRef.current;
      if (!eng) return;
      if (autoSaveEnabled) {
        const payload = eng.exportSavePayload(
          AUTOSAVE_SLOT_ID,
          `星球 #${eng.planet.seedConfig.seed}`,
        );
        void savePlanetToDb(payload)
          .then(() => refreshSavesList())
          .catch(() => {});
      }
      const handoff = eng.exportSavePayload(
        tabHandoffIdRef.current,
        'Tab Handoff',
      );
      void savePlanetToDb(handoff).catch(() => {});
    }, 6000);
    return () => window.clearInterval(timer);
  }, [autoSaveEnabled, phase, refreshSavesList]);

  const handleStart = useCallback(() => {
    setPhase('playing');
    document.body.dataset.state = 'playing';
    engineRef.current?.setPhase('playing');
  }, []);

  const handleUpdateConfig = useCallback((partial: Partial<SandboxConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      engineRef.current?.updateConfig(next);
      return next;
    });
  }, []);

  const handleToggleDebug = useCallback(() => {
    setDebugOpen((prev) => {
      const next = !prev;
      handleUpdateConfig({ debugProbeEnabled: next });
      return next;
    });
  }, [handleUpdateConfig]);

  const handleToggleTouch = useCallback(() => {
    setTouchEnabled((prev) => !prev);
  }, []);

  const handlePrepareNewTab = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const payload = eng.exportSavePayload(
      tabHandoffIdRef.current,
      'Tab Handoff',
    );
    void savePlanetToDb(payload).catch(() => {});
  }, []);

  const handleResetPlanet = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const oldR = eng.planet.baseRadius;
    eng.resetPlanet();
    syncScaledConfigForRadius(oldR, eng.planet.baseRadius);
    setSeedVersion((v) => v + 1);
    if (phaseRef.current === 'paused') {
      setPhase('playing');
    }
  }, [syncScaledConfigForRadius]);

  const handleGenerateWithSeed = useCallback(
    (seedCfg: PlanetSeedConfig) => {
      const eng = engineRef.current;
      if (eng) {
        const oldR = eng.planet.baseRadius;
        eng.regenerateWithSeed(seedCfg);
        syncScaledConfigForRadius(oldR, eng.planet.baseRadius);
      }
      setSeedVersion((v) => v + 1);
      setSeedModalOpen(false);
      if (phaseRef.current !== 'playing') {
        setPhase('playing');
      }
    },
    [syncScaledConfigForRadius],
  );

  const handleClearWater = useCallback(() => {
    engineRef.current?.clearWater();
  }, []);

  const handleSaveSlot = useCallback(
    async (name: string) => {
      const eng = engineRef.current;
      if (!eng) return;
      const id = `slot_${Date.now()}`;
      const payload = eng.exportSavePayload(id, name);
      await savePlanetToDb(payload);
      await refreshSavesList();
    },
    [refreshSavesList],
  );

  const handleQuickSave = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    const payload = eng.exportSavePayload(
      AUTOSAVE_SLOT_ID,
      `星球 #${eng.planet.seedConfig.seed}`,
    );
    await savePlanetToDb(payload);
    await refreshSavesList();
  }, [refreshSavesList]);

  const handleLoadSlot = useCallback(
    async (id: string) => {
      const eng = engineRef.current;
      if (!eng) return;
      const payload = await loadPlanetFromDb(id);
      if (!payload) return;
      const oldR = eng.planet.baseRadius;
      eng.applySavePayload(payload);
      syncScaledConfigForRadius(oldR, eng.planet.baseRadius);
      setConfig((prev) => ({
        ...prev,
        gravityScale: payload.gravityScale ?? prev.gravityScale,
        sunElevationDeg: payload.sunElevationDeg ?? prev.sunElevationDeg,
        sunAzimuthDeg: payload.sunAzimuthDeg ?? prev.sunAzimuthDeg,
      }));
      setSeedVersion((v) => v + 1);
      setSeedModalOpen(false);
      setPhase('playing');
    },
    [syncScaledConfigForRadius],
  );

  const handleDeleteSlot = useCallback(
    async (id: string) => {
      await deletePlanetSaveFromDb(id);
      await refreshSavesList();
    },
    [refreshSavesList],
  );

  const handleContinueSaved = useCallback(() => {
    if (saves.length > 0) {
      void handleLoadSlot(saves[0].id);
    } else {
      handleStart();
    }
  }, [saves, handleLoadSlot, handleStart]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (phaseRef.current === 'title') {
        if (e.code === 'Enter' && !seedModalOpen) {
          e.preventDefault();
          handleStart();
        }
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (mapsOpen) {
          setMapsOpen(false);
          return;
        }
        if (seedModalOpen) {
          setSeedModalOpen(false);
          return;
        }
        setPhase((prev) => (prev === 'playing' ? 'paused' : 'playing'));
        return;
      }

      if (phaseRef.current !== 'playing') return;

      if (e.code === 'F3' || e.code === 'Backquote') {
        e.preventDefault();
        handleToggleDebug();
      } else if (e.code === 'KeyB') {
        e.preventDefault();
        setSeedModalOpen((prev) => !prev);
      } else if (e.code === 'KeyN') {
        e.preventDefault();
        setMapsOpen((prev) => !prev);
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        setAtmosPanelOpen((prev) => !prev);
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        handleUpdateConfig({
          terrainRenderMode:
            configRef.current.terrainRenderMode === 'blocky'
              ? 'smooth'
              : 'blocky',
        });
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        const cur = configRef.current.terrainOverlay;
        handleUpdateConfig({
          terrainOverlay:
            cur === 'material'
              ? 'temperature'
              : cur === 'temperature'
                ? 'density'
                : 'material',
        });
      } else if (e.code === 'KeyK') {
        e.preventDefault();
        handleUpdateConfig({ simPaused: !configRef.current.simPaused });
      } else if (e.code === 'Digit1') {
        handleUpdateConfig({ tool: 'carve' });
      } else if (e.code === 'Digit2') {
        handleUpdateConfig({ tool: 'build' });
      } else if (e.code === 'Digit3') {
        handleUpdateConfig({ tool: 'smooth' });
      } else if (e.code === 'Digit4') {
        handleUpdateConfig({ tool: 'flatten' });
      } else if (e.code === 'Digit5') {
        handleUpdateConfig({ tool: 'water' });
      } else if (e.code === 'Tab') {
        e.preventDefault();
        handleUpdateConfig({
          cameraMode: NEXT_CAMERA[configRef.current.cameraMode],
        });
      } else if (e.code === 'KeyG') {
        handleUpdateConfig({
          showGravityVectors: !configRef.current.showGravityVectors,
        });
      } else if (e.code === 'KeyM') {
        handleUpdateConfig({ muted: !configRef.current.muted });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStart, handleToggleDebug, handleUpdateConfig, mapsOpen, seedModalOpen]);

  const voxelStats = useMemo(() => {
    void seedVersion;
    void telemetry.terrainVertices;
    return engineRef.current
      ? engineRef.current.getVoxelStats()
      : {
          gridN: 57,
          cellsPerAxis: 56,
          chunkCells: 8,
          chunksPerAxis: 7,
          totalVoxels: 185193,
          totalCells: 175616,
          totalChunks: 343,
          voxelSize: 40 / 56,
          worldHalf: 20,
          densityBytes: 185193 * 4,
          materialBytes: 185193,
          totalBytes: 185193 * 5 + 343,
          solidVoxels: 0,
          materialCounts: {
            [MaterialId.Air]: 0,
            [MaterialId.Soil]: 0,
            [MaterialId.Stone]: 0,
            [MaterialId.Basalt]: 0,
            [MaterialId.Crystal]: 0,
            [MaterialId.Ice]: 0,
            [MaterialId.Sandstone]: 0,
          },
        };
  }, [seedVersion, telemetry.terrainVertices, debugOpen]);

  const currentSeedConfig =
    engineRef.current?.planet.seedConfig ??
    launchParams.seedConfig ??
    DEFAULT_SEED_CONFIG;

  const newTabUrl = useMemo(() => {
    void seedVersion;
    const cfg =
      engineRef.current?.planet.seedConfig ??
      launchParams.seedConfig ??
      DEFAULT_SEED_CONFIG;
    return buildNewTabLaunchUrl(cfg, tabHandoffIdRef.current);
  }, [launchParams.seedConfig, seedVersion]);

  const latestSave = saves[0];

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#050810]">
      {/* Isolated WebGPU/WebGL Canvas Mount */}
      <div
        ref={mountRef}
        data-testid="planet-canvas-mount"
        className="absolute inset-0 w-full h-full"
        style={{ touchAction: 'none' }}
      />

      {initError && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-[#050810]/95">
          <div className="max-w-md rounded-sm border border-rose-500/40 bg-slate-900 p-6 text-center">
            <h2 className="font-display text-lg font-semibold text-white mb-2">
              3D 渲染环境不可用
            </h2>
            <p className="text-sm text-slate-300">{initError}</p>
          </div>
        </div>
      )}

      {phase === 'title' && (
        <TitleOverlay
          hasSavedWorld={saves.length > 0}
          savedWorldLabel={latestSave ? `#${latestSave.seed}` : undefined}
          newTabUrl={newTabUrl}
          onStart={handleStart}
          onContinueSaved={handleContinueSaved}
          onOpenSeedModal={() => setSeedModalOpen(true)}
        />
      )}

      {phase === 'playing' && (
        <GameHud
          telemetry={telemetry}
          config={config}
          debugOpen={debugOpen}
          mapsOpen={mapsOpen}
          atmosPanelOpen={atmosPanelOpen}
          dockOpen={dockOpen}
          touchEnabled={touchEnabled}
          newTabUrl={newTabUrl}
          onToggleDock={() => setDockOpen((v) => !v)}
          onToggleTouch={handleToggleTouch}
          onPrepareNewTab={handlePrepareNewTab}
          onUpdateConfig={handleUpdateConfig}
          onClearWater={handleClearWater}
          onResetPlanet={handleResetPlanet}
          onOpenSeedModal={() => setSeedModalOpen(true)}
          onToggleMaps={() => setMapsOpen((v) => !v)}
          onToggleAtmosPanel={() => setAtmosPanelOpen((v) => !v)}
          onToggleDebug={handleToggleDebug}
          onPause={() => setPhase('paused')}
        />
      )}

      {phase === 'playing' && touchEnabled && (
        <TouchControlsOverlay
          cameraMode={config.cameraMode}
          touchActionMode={touchActionMode}
          dockOpen={dockOpen}
          onChangeTouchActionMode={setTouchActionMode}
          onJoystickMove={(x, y) =>
            engineRef.current?.setVirtualJoystick(x, y)
          }
          onVerticalChange={(up, down) =>
            engineRef.current?.setVirtualVertical(up, down)
          }
          onJump={() => engineRef.current?.triggerVirtualJump()}
        />
      )}

      {phase === 'playing' && atmosPanelOpen && (
        <AtmosphereThermalPanel
          telemetry={telemetry}
          config={config}
          onUpdateConfig={handleUpdateConfig}
          onClose={() => setAtmosPanelOpen(false)}
        />
      )}

      {phase === 'playing' && debugOpen && (
        <DebugMenu
          telemetry={telemetry}
          config={config}
          voxelStats={voxelStats}
          onUpdateConfig={handleUpdateConfig}
          onClose={handleToggleDebug}
        />
      )}

      {phase === 'playing' && mapsOpen && engineRef.current && (
        <MapsModal
          planet={engineRef.current.planet}
          fluid={engineRef.current.fluid}
          telemetry={telemetry}
          config={config}
          onTeleport={(latDeg, lonDeg) => {
            engineRef.current?.teleportToLatLon(latDeg, lonDeg);
            setMapsOpen(false);
          }}
          onClose={() => setMapsOpen(false)}
        />
      )}

      {phase === 'paused' && (
        <PauseModal
          telemetry={telemetry}
          gravityScale={config.gravityScale}
          newTabUrl={newTabUrl}
          onPrepareNewTab={handlePrepareNewTab}
          onResume={() => setPhase('playing')}
          onQuickSave={handleQuickSave}
          onOpenSeedModal={() => setSeedModalOpen(true)}
          onResetPlanet={handleResetPlanet}
          onReturnTitle={() => setPhase('title')}
        />
      )}

      {seedModalOpen && (
        <WorldSeedModal
          currentSeedConfig={currentSeedConfig}
          saves={saves}
          autoSaveEnabled={autoSaveEnabled}
          onToggleAutoSave={setAutoSaveEnabled}
          onGenerateWithSeed={handleGenerateWithSeed}
          onSaveSlot={handleSaveSlot}
          onLoadSlot={handleLoadSlot}
          onDeleteSlot={handleDeleteSlot}
          onClose={() => setSeedModalOpen(false)}
        />
      )}
    </main>
  );
}
