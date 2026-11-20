import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  decodeSeedCode,
  DEFAULT_SEED_CONFIG,
  hashSeedString,
  MaterialId,
  PlanetSeedConfig,
} from './engine/voxelPlanet';
import {
  BUILTIN_TOOLS,
  loadCustomTools,
  loadToolAttributeOverrides,
  PlanetToolDef,
  resolveToolDefinition,
  saveCustomTools,
  saveToolAttributeOverrides,
  ToolAttributes,
} from './engine/toolRegistry';
import { DEFAULT_PLANET_RADIUS } from './engine/gravity';
import {
  createIdleTractorTelemetry,
} from './engine/tractorBeam';
import {
  CameraMode,
  GamePhase,
  GenerationProgress,
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
import { GenerationProgressOverlay } from './components/GenerationProgressOverlay';
import {
  DirectorScreenshotResult,
  DirectorStudioDrawer,
} from './components/DirectorStudioDrawer';
import {
  createDefaultDirectorPlan,
  DirectorShotPlan,
  ScreenshotFormat,
} from './engine/director';
import {
  createDefaultBackendDiagnostic,
  createDefaultPerfSnapshot,
} from './engine/perfMonitor';
import {
  DEFAULT_RENDER_QUALITY,
  OfflineAccumSamples,
  OfflineQualityOverride,
  ShadowQualityLevel,
} from './engine/renderQuality';

const NEXT_CAMERA: Record<CameraMode, CameraMode> = {
  explorer: 'orbit',
  orbit: 'detail',
  detail: 'fps',
  fps: 'landing',
  landing: 'perspective',
  perspective: 'explorer',
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
    toolAttributes: resolveToolDefinition('carve').attributes,
    material: MaterialId.Soil,
    brushRadius: Number((1.9 * rScale).toPrecision(4)),
    brushStrength: 1.85,
    gravityScale: prefs.gravityScale ?? 1.0,
    sunElevationDeg: prefs.sunElevationDeg ?? 28,
    sunAzimuthDeg: prefs.sunAzimuthDeg ?? 28,
    showGravityVectors: false,
    cameraMode: 'explorer',
    perspectiveFov: prefs.perspectiveFov ?? 55,
    muted: false,
    simPaused: false,
    lodMode: prefs.lodMode ?? 'auto',
    lod0Dist: Number(((prefs.lod0Dist ?? 38.0) * rScale).toPrecision(4)),
    lod1Dist: Number(((prefs.lod1Dist ?? 56.0) * rScale).toPrecision(4)),
    wireframe: false,
    showChunkBounds: false,
    debugProbeEnabled: false,
    terrainRenderMode: 'smooth',
    terrainOverlay: 'material',
    voxelEdges: true,
    atmosphere: { ...DEFAULT_ATMOS_CONFIG },
    thermal: { ...DEFAULT_THERMAL_CONFIG },
    renderQuality: { ...DEFAULT_RENDER_QUALITY },
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
  voxelRadius: DEFAULT_SEED_CONFIG.voxelRadius,
  nativeVoxelSize: DEFAULT_SEED_CONFIG.radius / DEFAULT_SEED_CONFIG.voxelRadius,
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
  voxelRevision: 0,
  landingStage: 'selecting',
  detailZoomMag: 1,
  perspectiveFov: 55,
  tractorBeam: createIdleTractorTelemetry(),
  backendInfo: createDefaultBackendDiagnostic(),
  perf: createDefaultPerfSnapshot(),
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
    voxelRadius: launchParams.seedConfig?.voxelRadius ?? DEFAULT_SEED_CONFIG.voxelRadius,
    nativeVoxelSize:
      (launchParams.seedConfig?.radius ?? DEFAULT_SEED_CONFIG.radius) /
      (launchParams.seedConfig?.voxelRadius ?? DEFAULT_SEED_CONFIG.voxelRadius),
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
  const [customTools, setCustomTools] = useState<PlanetToolDef[]>(loadCustomTools);
  const [toolOverrides, setToolOverrides] = useState<
    Record<string, Partial<ToolAttributes>>
  >(loadToolAttributeOverrides);
  const [studioOpen, setStudioOpen] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [directorPreviewing, setDirectorPreviewing] = useState(false);
  const [directorPlan, setDirectorPlan] = useState<DirectorShotPlan>(createDefaultDirectorPlan);
  const [shotToast, setShotToast] = useState<string | null>(null);
  const [seedVersion, setSeedVersion] = useState(0);
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);

  const allTools = useMemo(() => {
    const builtins = BUILTIN_TOOLS.map((t) => {
      const ov = toolOverrides[t.id];
      return ov ? { ...t, attributes: { ...t.attributes, ...ov } } : t;
    });
    return [...customTools, ...builtins];
  }, [customTools, toolOverrides]);

  const activeTool = useMemo(
    () => resolveToolDefinition(config.tool, customTools, toolOverrides),
    [config.tool, customTools, toolOverrides],
  );

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

    const hasExplicitLaunch = Boolean(
      launchParams.autostart || launchParams.slotId,
    );
    const shouldDeferInitialPlanet =
      !hasExplicitLaunch || Boolean(launchParams.slotId);

    const engine = new PlanetarySandboxEngine(
      container,
      (t) => setTelemetry(t),
      configRef.current,
      launchParams.seedConfig,
      { deferInitialPlanet: shouldDeferInitialPlanet },
    );
    engineRef.current = engine;
    engine.setPhase(phaseRef.current);
    engine.setTouchEnabled(touchEnabledRef.current);
    engine.setOnMaterialPicked((picked) => {
      setConfig((prev) => ({ ...prev, material: picked }));
    });

    let cancelled = false;

    engine
      .init()
      .then(async () => {
        if (cancelled) return;
        // If opened from another tab via IndexedDB handoff slot, restore full sculpted state asynchronously
        if (launchParams.slotId) {
          let payload = await loadPlanetFromDb(launchParams.slotId);
          if (!payload && !cancelled) {
            await new Promise((r) => window.setTimeout(r, 180));
            payload = await loadPlanetFromDb(launchParams.slotId);
          }
          if (payload && !cancelled) {
            const oldR = engine.planet.baseRadius;
            const ok = await engine.applySavePayloadAsync(payload, (p) => {
              if (!cancelled) setGenProgress(p);
            });
            if (!cancelled) {
              setGenProgress(null);
            }
            if (ok && !cancelled) {
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
      perspectiveFov: config.perspectiveFov,
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
    config.perspectiveFov,
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


  const handleUpdateConfig = useCallback((partial: Partial<SandboxConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      engineRef.current?.updateConfig(next);
      return next;
    });
  }, []);

  const handleSelectTool = useCallback(
    (toolDef: PlanetToolDef) => {
      handleUpdateConfig({
        tool: toolDef.id,
        toolAttributes: { ...toolDef.attributes },
      });
    },
    [handleUpdateConfig],
  );

  const handleSelectToolById = useCallback(
    (toolId: string) => {
      const resolved = resolveToolDefinition(toolId, customTools, toolOverrides);
      handleSelectTool(resolved);
    },
    [customTools, handleSelectTool, toolOverrides],
  );

  const handleUpdateActiveAttributes = useCallback(
    (partial: Partial<ToolAttributes>) => {
      if (activeTool.isCustom) {
        const nextList = customTools.map((t) =>
          t.id === activeTool.id
            ? { ...t, attributes: { ...t.attributes, ...partial } }
            : t,
        );
        setCustomTools(nextList);
        saveCustomTools(nextList);
        handleUpdateConfig({
          tool: activeTool.id,
          toolAttributes: { ...activeTool.attributes, ...partial },
        });
      } else {
        const nextOverrides = {
          ...toolOverrides,
          [activeTool.id]: {
            ...(toolOverrides[activeTool.id] ?? {}),
            ...partial,
          },
        };
        setToolOverrides(nextOverrides);
        saveToolAttributeOverrides(nextOverrides);
        handleUpdateConfig({
          tool: activeTool.id,
          toolAttributes: { ...activeTool.attributes, ...partial },
        });
      }
    },
    [activeTool, customTools, handleUpdateConfig, toolOverrides],
  );

  const handleResetBuiltinOverride = useCallback(
    (toolId: string) => {
      const nextOverrides = { ...toolOverrides };
      delete nextOverrides[toolId];
      setToolOverrides(nextOverrides);
      saveToolAttributeOverrides(nextOverrides);
      const base = resolveToolDefinition(toolId, customTools, nextOverrides);
      handleUpdateConfig({ tool: base.id, toolAttributes: { ...base.attributes } });
    },
    [customTools, handleUpdateConfig, toolOverrides],
  );

  const handleSaveCustomTool = useCallback(
    (newTool: PlanetToolDef, activate = true) => {
      const nextList = [newTool, ...customTools.filter((t) => t.id !== newTool.id)];
      setCustomTools(nextList);
      saveCustomTools(nextList);
      if (activate) {
        handleSelectTool(newTool);
      }
    },
    [customTools, handleSelectTool],
  );

  const handleDeleteCustomTool = useCallback(
    (toolId: string) => {
      const nextList = customTools.filter((t) => t.id !== toolId);
      setCustomTools(nextList);
      saveCustomTools(nextList);
      if (configRef.current.tool === toolId) {
        const fallback = resolveToolDefinition('carve', nextList, toolOverrides);
        handleSelectTool(fallback);
      }
    },
    [customTools, handleSelectTool, toolOverrides],
  );

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

  const handleCancelGeneration = useCallback(() => {
    engineRef.current?.cancelGeneration();
    setGenProgress(null);
  }, []);

  const handleResetPlanet = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    const oldR = eng.planet.baseRadius;
    const nextSeed = Math.floor(100000 + Math.random() * 899999);
    const nextCfg: PlanetSeedConfig = {
      ...eng.planet.seedConfig,
      seed: nextSeed,
    };
    setGenProgress({
      active: true,
      percent: 1,
      stage: '初始化随机星球参数',
      detail: `准备种子 #${nextCfg.seed}`,
      seed: nextCfg.seed,
      radius: nextCfg.radius,
      voxelRadius: nextCfg.voxelRadius,
    });
    const ok = await eng.generateWorldAsync(nextCfg, (p) => setGenProgress(p));
    setGenProgress(null);
    if (!ok) return;
    syncScaledConfigForRadius(oldR, eng.planet.baseRadius);
    setSeedVersion((v) => v + 1);
    if (phaseRef.current !== 'playing') {
      setPhase('playing');
      document.body.dataset.state = 'playing';
      eng.setPhase('playing');
    }
  }, [syncScaledConfigForRadius]);

  const handleGenerateWithSeed = useCallback(
    async (seedCfg: PlanetSeedConfig) => {
      const eng = engineRef.current;
      if (!eng) return;
      const oldR = eng.planet.baseRadius;
      setGenProgress({
        active: true,
        percent: 1,
        stage: '初始化星球体素与物理场',
        detail: `准备种子 #${seedCfg.seed} · R₀=${seedCfg.radius}m`,
        seed: seedCfg.seed,
        radius: seedCfg.radius,
        voxelRadius: seedCfg.voxelRadius,
      });
      const ok = await eng.generateWorldAsync(seedCfg, (p) => setGenProgress(p));
      setGenProgress(null);
      if (!ok) return;
      syncScaledConfigForRadius(oldR, eng.planet.baseRadius);
      setSeedVersion((v) => v + 1);
      setSeedModalOpen(false);
      setPhase('playing');
      document.body.dataset.state = 'playing';
      eng.setPhase('playing');
    },
    [syncScaledConfigForRadius],
  );

  const handleClearWater = useCallback(() => {
    engineRef.current?.clearWater();
  }, []);

  const handleSaveSlot = useCallback(
    async (name: string) => {
      const eng = engineRef.current;
      if (!eng || !eng.hasWorld) return;
      const id = `slot_${Date.now()}`;
      const payload = eng.exportSavePayload(id, name);
      await savePlanetToDb(payload);
      await refreshSavesList();
    },
    [refreshSavesList],
  );

  const handleQuickSave = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng || !eng.hasWorld) return;
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
      const cfg = payload.planet.seedConfig;
      setGenProgress({
        active: true,
        percent: 4,
        stage: '读取持久化体素存档',
        detail: `载入 ${payload.name}`,
        seed: cfg.seed,
        radius: cfg.radius,
        voxelRadius: cfg.voxelRadius ?? 18,
      });
      const ok = await eng.applySavePayloadAsync(payload, (p) =>
        setGenProgress(p),
      );
      setGenProgress(null);
      if (!ok) return;
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
      document.body.dataset.state = 'playing';
      eng.setPhase('playing');
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

  const handleUpdateDirectorPlan = useCallback(
    (partial: Partial<DirectorShotPlan>) => {
      setDirectorPlan((prev) => ({ ...prev, ...partial }));
    },
    [],
  );

  const handleQuickScreenshot = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng || !eng.hasWorld) return;
    const w = Math.max(64, mountRef.current?.clientWidth || window.innerWidth);
    const h = Math.max(64, mountRef.current?.clientHeight || window.innerHeight);
    const res = await eng.captureDirectorScreenshot({
      width: w,
      height: h,
      format: 'png',
      hideHelpers: true,
    });
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terrasphere-shot-${res.actualWidth}x${res.actualHeight}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 8000);
    setShotToast(`已保存截屏 ${res.actualWidth}×${res.actualHeight} PNG`);
    window.setTimeout(() => setShotToast(null), 2600);
  }, []);

  const handleStartDirectorPreview = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || !eng.hasWorld) return;
    setDirectorPreviewing(true);
    eng.startDirectorPreview(directorPlan, () => {
      setDirectorPreviewing(false);
    });
  }, [directorPlan]);

  const handleStopDirectorPreview = useCallback(() => {
    engineRef.current?.stopDirectorPreview();
    setDirectorPreviewing(false);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (phaseRef.current === 'title') {
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (directorPreviewing && e.code === 'Escape') {
          handleStopDirectorPreview();
          return;
        }
        if (mapsOpen) {
          setMapsOpen(false);
          return;
        }
        if (seedModalOpen) {
          setSeedModalOpen(false);
          return;
        }
        if (directorOpen && e.code === 'Escape') {
          setDirectorOpen(false);
          return;
        }
        setPhase((prev) => (prev === 'playing' ? 'paused' : 'playing'));
        return;
      }

      if (phaseRef.current !== 'playing') return;

      if (e.code === 'F9') {
        e.preventDefault();
        setDirectorOpen((prev) => !prev);
      } else if (e.code === 'F10') {
        e.preventDefault();
        void handleQuickScreenshot();
      } else if (e.code === 'F3' || e.code === 'Backquote') {
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
      } else if (e.code === 'KeyI') {
        handleSelectToolById('probe');
      } else if (e.code === 'Digit1') {
        handleSelectToolById('carve');
      } else if (e.code === 'Digit2') {
        handleSelectToolById('tunnel');
      } else if (e.code === 'Digit3') {
        handleSelectToolById('laser');
      } else if (e.code === 'Digit4') {
        handleSelectToolById('continuousLaser');
      } else if (e.code === 'Digit5') {
        handleSelectToolById('megaLaser');
      } else if (e.code === 'Digit6') {
        handleSelectToolById('explosion');
      } else if (e.code === 'Digit7') {
        handleSelectToolById('nuke');
      } else if (e.code === 'Digit8') {
        handleSelectToolById('burn');
      } else if (e.code === 'Digit9') {
        handleSelectToolById('magma');
      } else if (e.code === 'Digit0') {
        handleSelectToolById('water');
      } else if (e.code === 'KeyX') {
        handleSelectToolById('drain');
      } else if (e.code === 'KeyY') {
        handleSelectToolById('tractorBeam');
      } else if (e.code === 'Tab') {
        e.preventDefault();
        handleUpdateConfig({
          cameraMode: NEXT_CAMERA[configRef.current.cameraMode],
        });
      } else if (e.code === 'KeyF') {
        if (
          configRef.current.cameraMode === 'detail' ||
          configRef.current.cameraMode === 'perspective'
        ) {
          e.preventDefault();
          engineRef.current?.focusCameraAtPointer();
        }
      } else if (e.code === 'KeyR') {
        if (configRef.current.cameraMode === 'landing') {
          e.preventDefault();
          engineRef.current?.reselectLandingSite();
        }
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
  }, [
    directorOpen,
    directorPreviewing,
    handleQuickScreenshot,
    handleSelectToolById,
    handleStopDirectorPreview,
    handleToggleDebug,
    handleUpdateConfig,
    mapsOpen,
    seedModalOpen,
  ]);

  const voxelStats = useMemo(() => {
    void seedVersion;
    void telemetry.voxelRevision;
    return engineRef.current && debugOpen
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
          voxelRadius: DEFAULT_SEED_CONFIG.voxelRadius,
          nativeVoxelSize: DEFAULT_SEED_CONFIG.radius / DEFAULT_SEED_CONFIG.voxelRadius,
          virtualCellsPerAxis: 56,
          fullCellsPerAxis: 56,
          fullChunksPerAxis: 7,
          fullGridN: 57,
          octreeDepth: 3,
          fullTotalVoxelsLabel: (56 * 56 * 56).toLocaleString(),
          sparseActiveChunks: 0,
          isSparseStreaming: false,
        };
  }, [debugOpen, seedVersion, telemetry.voxelRevision]);

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
          saves={saves}
          initialSeedConfig={launchParams.seedConfig}
          isGenerating={Boolean(genProgress?.active)}
          backendInfo={telemetry.backendInfo}
          onGenerateAndEnter={(cfg) => void handleGenerateWithSeed(cfg)}
          onLoadSaveSlot={(id) => void handleLoadSlot(id)}
          onDeleteSaveSlot={(id) => void handleDeleteSlot(id)}
        />
      )}

      {phase === 'playing' && (
        <GameHud
          telemetry={telemetry}
          config={config}
          tools={allTools}
          activeTool={activeTool}
          hasToolOverride={Boolean(toolOverrides[activeTool.id])}
          studioOpen={studioOpen}
          directorOpen={directorOpen}
          directorPreviewing={directorPreviewing}
          debugOpen={debugOpen}
          mapsOpen={mapsOpen}
          atmosPanelOpen={atmosPanelOpen}
          dockOpen={dockOpen}
          touchEnabled={touchEnabled}
          newTabUrl={newTabUrl}
          onToggleStudio={() => setStudioOpen((v) => !v)}
          onToggleDirector={() => setDirectorOpen((v) => !v)}
          onQuickScreenshot={() => void handleQuickScreenshot()}
          onStopDirectorPreview={handleStopDirectorPreview}
          onSelectTool={handleSelectTool}
          onUpdateActiveAttributes={handleUpdateActiveAttributes}
          onResetBuiltinOverride={handleResetBuiltinOverride}
          onSaveCustomTool={handleSaveCustomTool}
          onDeleteCustomTool={handleDeleteCustomTool}
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
          onReselectLanding={() => engineRef.current?.reselectLandingSite()}
          onFocusCamera={() => engineRef.current?.focusCameraAtPointer()}
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

      {phase === 'playing' && directorOpen && engineRef.current && (
        <DirectorStudioDrawer
          plan={directorPlan}
          previewing={directorPreviewing}
          hardwareCaps={engineRef.current.getDirectorHardwareCaps()}
          viewportSize={{
            width: Math.max(64, mountRef.current?.clientWidth || window.innerWidth),
            height: Math.max(64, mountRef.current?.clientHeight || window.innerHeight),
          }}
          onUpdatePlan={handleUpdateDirectorPlan}
          onCaptureKeyframe={() =>
            engineRef.current!.captureCameraKeyframe(
              `机位 ${directorPlan.keyframes.length + 1}`,
            )
          }
          onStartPreview={handleStartDirectorPreview}
          onStopPreview={handleStopDirectorPreview}
          onCaptureScreenshot={async (opts: {
            width: number;
            height: number;
            format: ScreenshotFormat;
            hideHelpers: boolean;
            qualityOverride?: OfflineQualityOverride;
            accumSamples?: OfflineAccumSamples;
            rayTracing?: boolean;
            volumetrics?: boolean;
            shadowQuality?: ShadowQualityLevel;
            pbrEnhanced?: boolean;
          }): Promise<DirectorScreenshotResult> => {
            const res = await engineRef.current!.captureDirectorScreenshot(opts);
            return { ...res, format: opts.format };
          }}
          onRenderOfflineVideo={(onProgress, signal) =>
            engineRef.current!.renderDirectorVideoOffline(directorPlan, onProgress, signal)
          }
          onClose={() => setDirectorOpen(false)}
        />
      )}

      {shotToast && (
        <div className="fixed top-12 right-3 z-30 pointer-events-none px-3 py-1.5 rounded-xs border border-emerald-500/60 bg-[#090d18]/95 text-xs text-emerald-200 font-mono-tabular shadow-lg">
          {shotToast}
        </div>
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
          onGenerateWithSeed={(cfg) => void handleGenerateWithSeed(cfg)}
          onSaveSlot={handleSaveSlot}
          onLoadSlot={handleLoadSlot}
          onDeleteSlot={handleDeleteSlot}
          onClose={() => setSeedModalOpen(false)}
        />
      )}

      <GenerationProgressOverlay
        progress={genProgress}
        onCancel={handleCancelGeneration}
      />
    </main>
  );
}
