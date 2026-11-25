import * as THREE from 'three/webgpu';
import {
  Discard,
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp as tslClamp,
  color,
  convertToTexture,
  cos,
  diffuseColor,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  mrt,
  normalLocal,
  normalView,
  normalWorld,
  output,
  pass,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  roughness,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  computeEscapeVelocity,
  computeGravityMagnitude,
  computeGravityVector,
  DEFAULT_PLANET_RADIUS,
  EARTH_SURFACE_GRAVITY,
  parallelTransportTangentFrame,
  PlanetaryGravityParams,
  Vec3Like,
} from './gravity';
import {
  CHUNK_CELLS,
  ChunkLodLevel,
  HighResStreamBatch,
  MaterialId,
  PlanetSeedConfig,
  TerrainOverlayMode,
  TerrainRenderMode,
  VoxelCellProbe,
  VoxelFormatStats,
  VoxelPlanet,
  VoxelPlanetSnapshot,
} from './voxelPlanet';
import {
  ActiveFluidTractorField,
  FluidSim,
  FluidSnapshot,
  MAX_FLUID_PARTICLES,
} from './fluidSim';
import {
  computeRayPointDistanceSq,
  computeTractorSpringForce,
  createIdleTractorTelemetry,
  evaluateStretchedAnchorPoint,
  intersectCursorWithDragPlane,
  summarizeEscapeStatus,
  TractorBeamTelemetry,
  TractorForceParams,
  TractorForceResult,
  TractorRayPickResult,
} from './tractorBeam';
import { SoundEngine } from './audio';
import { PlanetSavePayload } from './persistence';
import {
  AtmosphereConfig,
  computeGreenhouseBoostC,
  DEFAULT_ATMOS_CONFIG,
  sampleAtmosphereAtPoint,
} from './atmosphere';
import {
  computeHotspotDeltaC,
  DEFAULT_THERMAL_CONFIG,
  sampleThermalField,
  ThermalConfig,
  ThermalHotspot,
} from './thermal';
import {
  resolveToolDefinition,
  ToolAttributes,
} from './toolRegistry';
import { dirToLonLat, lonLatToDir } from './cartography';
import {
  clampPlayerScale,
  computeCharacterScaleMetrics,
  computeDetailCameraOptics,
  computeFirstPersonEyePose,
  computeSafeClipPlanes,
  DEFAULT_PLAYER_SCALE,
  DetailCameraOptics,
  evaluateLandingDescentPose,
  resolveSphericalCoreUp,
  stabilizeRadialAnchor,
  transportCameraForwardOnSphere,
} from './cameraMath';
import {
  computePlanFrameCount,
  computeProjectFrameRange,
  DirectorKeyframe,
  DirectorRenderProgress,
  DirectorSceneAnchor,
  DirectorShotPlan,
  DirectorTimelineProject,
  DirectorVisualFilter,
  DirectorWorldEvent,
  EvaluatedPostFxState,
  evaluateCameraTrackPose,
  evaluateDirectorPose,
  evaluateEnvironmentTrack,
  evaluateFullTimelineAtTime,
  getLutColorMatrixParams,
  VISUAL_FILTER_META,
  WORLD_EVENT_META,
} from './director';
import {
  applyAspectMatteToCanvas2D,
  blitRgbaTopDownToCanvas2D,
  computeCheckpointResumeStartFrame,
  computeOfflineSubsteps,
  computeRgbHistogram,
  normalizeReadbackRgbaToTopDown,
} from './directorCapture';
import {
  assembleDirectorJobBlob,
  getLatestCheckpointAtOrBefore,
  RenderCheckpointJob,
  saveEncodedFrameChunkToDb,
  saveRenderJobToDb,
  saveSimulationCheckpointToDb,
} from './directorStorage';
import { buildTarArchive, WebmMuxer, WebmVideoCodec } from './webmMuxer';
import {
  CoordDatum,
  CoordReadout,
  CoordSystemId,
  worldToCoord,
} from './coordinates';
import {
  BoreholeLogReport,
  GeologicalAttitude,
  GeologicalTransectReport,
  measureGeologicalAttitude,
  sampleBoreholeColumn,
  sampleGeologicalTransect,
  SurveyBenchmark,
  SurveyToolKind,
} from './geologySurvey';
import {
  BackendDiagnosticInfo,
  classifyBackendDiagnostic,
  createDefaultBackendDiagnostic,
  PerformanceMetricsSnapshot,
  RollingPerfTracker,
} from './perfMonitor';
import {
  accumulateRgbaSample,
  buildRenderQualityConfig,
  computeSubpixelJitterOffset,
  computeTightShadowFrustum,
  createRgbaAccumulator,
  DEFAULT_RENDER_QUALITY,
  DirectorQualitySettings,
  finalizeAccumulatedRgba,
  OfflineAccumSamples,
  OfflineQualityOverride,
  RenderQualityConfig,
  resolveDirectorOfflineQuality,
  resolveShadowMapSize,
  ShadowQualityLevel,
} from './renderQuality';
import {
  buildPostGradingCompositeNode,
  buildTerrainSubVoxelPbrBundle,
  buildVisualFilterNode,
  buildVolumetricAtmoCompositeNode,
  buildWaterWaveNormalNode,
} from './tslVolumetrics';
import {
  BifurcationSweepReport,
  createFvmFluxArrowsVisual,
  createFvmVoxelBlocksVisual,
  createGeologicalVisualsAssembly,
  createHoveredVoxHighlightVisual,
  createProtocellVisualAssembly,
  FvmComputeBackendKind,
  FvmFluxArrowsVisual,
  FvmResolutionCells,
  FvmVoxelBlocksVisual,
  GeologicalEvolutionConfig,
  GeologicalFluidOp,
  GeologicalTerrainOp,
  GeologicalVisualsAssembly,
  HoveredVoxHighlightVisual,
  LagrangianBoundaryState,
  MetabolismDemoMode,
  MetabolismSimRunner,
  MetabolismSummarySnapshot,
  MetabolismVisualChannel,
  MicroCalibrationRecord,
  PlanetaryFeedbackConfig,
  ProtocellVisualAssembly,
  sampleFvmRenderColor,
  VoxChemicalProfile,
} from './metabolism';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export type CameraMode =
  | 'explorer'
  | 'firstPerson'
  | 'orbit'
  | 'detail'
  | 'fps'
  | 'landing'
  | 'perspective';
export type LandingCameraStage = 'selecting' | 'descending' | 'landed';
export type GamePhase = 'title' | 'playing' | 'paused';
export type LodMode = 'auto' | ChunkLodLevel;

export interface DirectorWorldSnapshot {
  planet: VoxelPlanetSnapshot;
  fluid: FluidSnapshot;
  hotspots: ThermalHotspot[];
  simTimeSec: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  atmosphere: AtmosphereConfig;
  thermal: ThermalConfig;
  playerPos: [number, number, number];
  playerFwd: [number, number, number];
}

export interface GenerationProgress {
  active: boolean;
  percent: number;
  stage: string;
  detail: string;
  seed: number;
  radius: number;
  voxelRadius: number;
  phaseIndex?: number;
  builtChunks?: number;
  totalChunks?: number;
  waterParticles?: number;
  terrainVertices?: number;
}

export interface SandboxTelemetry {
  altitude: number;
  localGravity: number;
  escapeVelocity: number;
  waterParticles: number;
  terrainVertices: number;
  backend: 'WebGPU' | 'WebGL2';
  grounded: boolean;
  cameraMode: CameraMode;
  fps: number;
  frameTimeMs: number;
  simStepMs: number;
  lodCounts: [number, number, number, number]; // [LOD0, LOD1, LOD2, empty/culled]
  activeChunks: number;
  planetRadius: number;
  voxelRadius: number;
  nativeVoxelSize: number;
  seed: number;
  fpsSpeed: number;
  hoveredProbe: VoxelCellProbe | null;
  localTempC: number;
  localTempK: number;
  localPressureAtm: number;
  localHumidity: number;
  windSpeedMs: number;
  atmoLayer: string;
  thermalRegime: string;
  playerLatDeg: number;
  playerLonDeg: number;
  sunDir: [number, number, number];
  simTimeSec: number;
  voxelRevision: number;
  landingStage: LandingCameraStage;
  detailZoomMag: number;
  perspectiveFov: number;
  tractorBeam: TractorBeamTelemetry;
  backendInfo: BackendDiagnosticInfo;
  perf: PerformanceMetricsSnapshot;
  playerCoord: CoordReadout;
  hoveredCoord: CoordReadout | null;
  hoveredWorldPos: [number, number, number] | null;
  hoveredAttitude: GeologicalAttitude | null;
  hoveredVoxProfile?: VoxChemicalProfile | null;
  voxLocked?: boolean;
  interiorCutawayEnabled?: boolean;
  metabolismSummary?: MetabolismSummarySnapshot;
}

export interface SandboxConfig {
  tool: string;
  toolAttributes?: ToolAttributes;
  material: MaterialId;
  brushRadius: number;
  brushStrength: number;
  gravityScale: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  showGravityVectors: boolean;
  cameraMode: CameraMode;
  perspectiveFov: number;
  playerScale: number;
  muted: boolean;
  simPaused: boolean;
  lodMode: LodMode;
  lod0Dist: number;
  lod1Dist: number;
  wireframe: boolean;
  showChunkBounds: boolean;
  debugProbeEnabled: boolean;
  terrainRenderMode: TerrainRenderMode;
  terrainOverlay: TerrainOverlayMode;
  voxelEdges: boolean;
  coordSystem: CoordSystemId;
  showCoordGrid: boolean;
  enuOrigin: [number, number, number];
  atmosphere: AtmosphereConfig;
  thermal: ThermalConfig;
  renderQuality: RenderQualityConfig;
  visualFilter?: DirectorVisualFilter;
  filterIntensity?: number;
  filterScale?: number;
  metabolismChannel?: MetabolismVisualChannel;
  showCouplingZones?: boolean;
  showFvmFluxVectors?: boolean;
  showProtocell3d?: boolean;
  showHoveredFvmVox?: boolean;
  showFvmVoxelBlocks?: boolean;
}

function detectSoftwareRenderer(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

const BOX_EDGES: ReadonlyArray<[number, number, number, number, number, number]> = [
  [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 1], [1, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0],
  [0, 1, 0, 1, 1, 0], [1, 1, 0, 1, 1, 1], [1, 1, 1, 0, 1, 1], [0, 1, 1, 0, 1, 0],
  [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [1, 0, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
];

export class PlanetarySandboxEngine {
  private container: HTMLElement;
  private onTelemetry: (t: SandboxTelemetry) => void;

  public readonly planet: VoxelPlanet;
  public readonly fluid: FluidSim;
  public readonly sound: SoundEngine;
  public readonly metabolism = new MetabolismSimRunner('planetary_carbon_water');

  private renderer!: THREE.WebGPURenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private isSoftware = false;
  private isDisposed = false;
  private frameHandle = 0;
  private timerHandle = 0;
  public hasWorld = true;
  public isGenerating = false;
  private generationToken = 0;
  private isOfflineRendering = false;
  private directorPreviewPlan: DirectorShotPlan | null = null;
  private directorPreviewTime = 0;
  private directorPreviewAnchor: DirectorSceneAnchor | null = null;
  private directorPreviewBaseSunAzimuth = 28;
  private onDirectorPreviewEnd?: () => void;
  private directorTimelineLocked = false;

  // Lighting & Sky
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private rimLight!: THREE.DirectionalLight;
  private sunDirUniform = new THREE.Vector3(0.65, 0.68, 0.34).normalize();
  private sunDirNode = uniform(this.sunDirUniform);
  private simTimeNode = uniform(0.0);
  private planetRadiusNode = uniform(DEFAULT_PLANET_RADIUS);
  private isBlockyNode = uniform(0.0);
  private voxelEdgesNode = uniform(1.0);
  private overlayModeNode = uniform(0.0); // 0=material, 1=temperature, 2=density, 3=metabolism
  private atmoEnabledNode = uniform(1.0);
  private atmoDensityNode = uniform(1.0);
  private rayleighNode = uniform(1.0);
  private mieNode = uniform(0.65);
  private cloudCoverNode = uniform(0.48);
  private windSpeedNode = uniform(1.0);
  private solarRatioNode = uniform(1.0);
  private coreTempNode = uniform(1150.0);
  private lapseRateNode = uniform(24.0);
  private scaleHeightNode = uniform(0.14);
  private greenhouseNode = uniform(18.0);
  private pbrEnhancedNode = uniform(1.0);
  private pbrReliefDepthNode = uniform(1.15);
  private nativeVoxelSizeNode = uniform(DEFAULT_PLANET_RADIUS / 128);
  private volFogEnabledNode = uniform(1.0);
  private atmoScatterEnabledNode = uniform(1.0);
  private volStepsNode = uniform(14.0);
  private contactShadowNode = uniform(0.0);
  private bloomEnabledNode = uniform(1.0);
  private legacyAtmoShellScaleNode = uniform(1.0);
  private gpuFvmActiveNode = uniform(0.0);
  private gpuFvmChannelNode = uniform(0.0);
  private metabHotspotPos0 = uniform(new THREE.Vector4(0, 0, 0, 1));
  private metabHotspotPos1 = uniform(new THREE.Vector4(0, 0, 0, 1));
  private metabHotspotPos2 = uniform(new THREE.Vector4(0, 0, 0, 1));
  private metabHotspotPos3 = uniform(new THREE.Vector4(0, 0, 0, 1));
  private metabHotspotDeltaC = uniform(new THREE.Vector4(0, 0, 0, 0));

  // Director NLE Color Grading & Film Finishing uniforms
  private solarIntensityNode = uniform(1.0);
  private activeSolarIntensity = 1.0;
  private postExposureGainNode = uniform(1.0);
  private postContrastNode = uniform(1.0);
  private postSaturationNode = uniform(1.0);
  private postLutIntensityNode = uniform(0.0);
  private postShadowTintNode = uniform(new THREE.Vector3(1.0, 1.0, 1.0));
  private postHighlightTintNode = uniform(new THREE.Vector3(1.0, 1.0, 1.0));
  private postVignetteNode = uniform(0.0);
  private postFilmGrainNode = uniform(0.0);
  private postFilterModeNode = uniform(0.0);
  private postFilterIntensityNode = uniform(0.85);
  private postFilterScaleNode = uniform(1.0);
  private integralDampNode = uniform(0.86);
  private activeVisualFilter: DirectorVisualFilter = 'none';
  private activeFilterIntensity = 0.85;
  private activeFilterScale = 1.0;
  private directorWaterBaseCount: number | null = null;
  private activePostGradingEnabled = false;
  private activeBloomStrength = 0.34;
  private activeAspectMask: 'none' | '2.39:1' | '16:9' | '9:16' = 'none';
  private resizeObserver: ResizeObserver | null = null;
  private directorGizmoGroup: THREE.Group | null = null;
  private genCoreGroup: THREE.Group | null = null;
  private genCoreMesh: THREE.Mesh | null = null;
  private genCageMesh: THREE.Mesh | null = null;

  // TSL Post-Processing RenderPipeline (SSGI + SSR + GTAO + Volumetric Scattering + Bloom + Grading)
  private renderPipeline: THREE.RenderPipeline | null = null;
  private activePipelineKey = '';
  private pipelineFailed = false;
  private activeSsgiNode: ReturnType<typeof ssgi> | null = null;
  private activeSsrNode: ReturnType<typeof ssr> | null = null;
  private activeAoNode: ReturnType<typeof gtao> | null = null;
  private activeBloomNode: ReturnType<typeof bloom> | null = null;
  private activeDenoiseNodes: Array<ReturnType<typeof denoise>> = [];
  private pipelineDisposables: Array<{ dispose?: () => void }> = [];
  private currentShadowMapSize = 2048;
  private lastShadowHalfSpan = 0;
  private lastShadowCenter = new THREE.Vector3(9999, 9999, 9999);

  private sunOrbMesh!: THREE.Mesh;
  private starPoints!: THREE.Points;
  private moonGroup!: THREE.Group;
  private atmoMesh!: THREE.Mesh;
  private atmoInnerMesh!: THREE.Mesh;
  private atmosphereMat!: THREE.MeshBasicNodeMaterial;
  private cloudShellMesh!: THREE.Mesh;
  private cloudShellMat!: THREE.MeshStandardNodeMaterial;
  private cloudPuffsMesh!: THREE.InstancedMesh;
  private readonly CLOUD_PUFF_COUNT = 84;
  private cloudSeeds: Array<{
    lat: number;
    lon: number;
    altJitter: number;
    sx: number;
    sy: number;
    sz: number;
    phase: number;
  }> = [];

  // Terrain chunks + LOD tracking + high-res sparse streaming
  private chunkMeshes: Array<THREE.Mesh | null> = [];
  private chunkLod = new Int8Array(343).fill(-1);
  private chunkCenters = new Float32Array(343 * 3);
  private terrainMaterial!: THREE.MeshPhysicalNodeMaterial;
  private highResGlobeMaterial!: THREE.MeshPhysicalNodeMaterial;
  private highResHemiMaterial!: THREE.MeshPhysicalNodeMaterial;
  private highResMidOuterMaterial!: THREE.MeshPhysicalNodeMaterial;
  private highResMidMaterial!: THREE.MeshPhysicalNodeMaterial;
  private highResNativeMaterial!: THREE.MeshPhysicalNodeMaterial;
  private highResGroup!: THREE.Group;
  private highResMeshes = new Map<string, THREE.Mesh>();
  private highResVertices = 0;
  private highResActiveCount = 0;
  private lastHighResHideMacro = false;
  private lastHighResFocus = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS, 0);
  private highResStreamDirty = true;
  private lastStreamPendingTotal = 1;
  private readonly lastStreamCamPos = new THREE.Vector3(NaN, NaN, NaN);
  private readonly lastStreamCamFwd = new THREE.Vector3(NaN, NaN, NaN);
  private readonly lastStreamFocusCheck = new THREE.Vector3(NaN, NaN, NaN);
  private lastStreamLodMode: LodMode | null = null;
  private lastStreamLod0Dist = -1;
  private lastStreamRenderMode: TerrainRenderMode | null = null;
  private lastStreamVoxelRevision = -1;
  private lastStreamOverrideActive = false;
  private totalTerrainVertices = 0;
  private lodCounts: [number, number, number, number] = [0, 0, 0, 343];
  private activeChunks = 0;

  // Chunk Bounds Debug Lines
  private chunkBoundsLines!: THREE.LineSegments;
  private chunkBoundsPos = new Float32Array(343 * 24 * 3);
  private chunkBoundsCol = new Float32Array(343 * 24 * 3);
  private chunkBoundsDirty = true;

  // Read-only 《Metabolism》 Eulerian Field & PIC Coupling Zone AABB Overlays
  private metabolismFieldPoints: THREE.Points | null = null;
  private metabolismPointsPos = new Float32Array(13824 * 3);
  private metabolismPointsCol = new Float32Array(13824 * 3);
  private couplingZoneLines: THREE.LineSegments | null = null;
  private couplingZonePos = new Float32Array(12 * 24 * 3);
  private protocellVisual: ProtocellVisualAssembly | null = null;
  private fvmFluxVisual: FvmFluxArrowsVisual | null = null;
  private hoveredVoxVisual: HoveredVoxHighlightVisual | null = null;
  private lockedVoxVisual: HoveredVoxHighlightVisual | null = null;
  private lockedVoxWorldPos: [number, number, number] | null = null;
  private fvmVoxelBlocksVisual: FvmVoxelBlocksVisual | null = null;
  private geologicalVisuals: GeologicalVisualsAssembly | null = null;
  private metabolismUiOpen = false;
  private lastMetabolismVisualRevision = -1;
  private lastMetabolismVisualOverlay: TerrainOverlayMode = 'material';
  private lastMetabolismVisualChannel: MetabolismVisualChannel = 'species';
  private readonly _metabRgb: [number, number, number] = [0, 0, 0];

  // Fluid rendering (dynamic SPH pockets + planetary hydrostatic sea/river/lake equipotential sphere)
  private waterMesh!: THREE.Mesh;
  private oceanSeaMesh: THREE.Mesh | null = null;
  private waterMaterial!: THREE.MeshPhysicalNodeMaterial;
  private oceanMaterial: THREE.MeshPhysicalNodeMaterial | null = null;
  private cutawayActiveNode = uniform(0.0);
  private splashMesh!: THREE.InstancedMesh;
  private waterMeshDirty = true;
  private waterRebuildCooldown = 0;
  private lastSeaRadius = -1;
  private lastSeaHidden = false;

  // Gravity vector visualizer
  private gravityFieldGroup!: THREE.Group;
  private gravityArrowsMesh!: THREE.InstancedMesh;
  private gravityArrowBasePositions: Array<[number, number, number]> = [];

  // Explorer character & Physics
  private playerGroup!: THREE.Group;
  private playerLeftLeg!: THREE.Mesh;
  private playerRightLeg!: THREE.Mesh;
  private playerLeftArm!: THREE.Mesh;
  private playerRightArm!: THREE.Mesh;
  private playerPos = new THREE.Vector3();
  private playerVel = new THREE.Vector3();
  private playerUp = new THREE.Vector3(0, 1, 0);
  private playerFwd = new THREE.Vector3(0, 0, -1);
  private playerRight = new THREE.Vector3(1, 0, 0);
  private playerGrounded = false;
  private walkPhase = 0;
  private squashY = 1.0;

  // Camera states (Explorer / First-Person / Orbit / Detail / FPS / Landing / Perspective)
  private explorerCamFwd = new THREE.Vector3(0, 0, -1);
  private explorerCamAnchor = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS, 0);
  private camPitch = 0.36;
  private firstPersonPitch = 0.08;
  private camDistance = 9.0 * DEFAULT_PLAYER_SCALE;
  private orbitYaw = 0.52;
  private orbitPitch = 0.46;
  private orbitDistance = 30.5;
  private fpsPos = new THREE.Vector3(0, 18, 22);
  private fpsYaw = 0;
  private fpsPitch = -0.35;
  private fpsSpeed = 12.0;

  // Detail Inspection Camera (cursor-ray voxel zoom without clipping)
  private detailTarget = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS, 0);
  private detailNormal = new THREE.Vector3(0, 1, 0);
  private detailBasisFwd = new THREE.Vector3(0, 0, -1);
  private detailPitch = 0.58;
  private detailViewDist = DEFAULT_PLANET_RADIUS * 1.1;
  private detailOptics: DetailCameraOptics = {
    physicalDist: DEFAULT_PLANET_RADIUS * 1.1,
    effectiveStreamDist: DEFAULT_PLANET_RADIUS * 1.1,
    fovDeg: 55,
    magnification: 1,
  };

  // Landing Camera (select site -> smooth orbital descent -> planetary FPS walk)
  private landingStage: LandingCameraStage = 'selecting';
  private landingSite = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS, 0);
  private landingNormal = new THREE.Vector3(0, 1, 0);
  private landingHoverPos = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS, 0);
  private landingHoverNormal = new THREE.Vector3(0, 1, 0);
  private landingHasHover = false;
  private landingDescentT = 0;
  private landingDescentStartPos = new THREE.Vector3(0, 22, 24);
  private landingDescentEndPos = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS + 1.65, 0);
  private landingDescentEndLook = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS + 1.65, -8);
  private landingOrbitYaw = 0.52;
  private landingOrbitPitch = 0.48;
  private landingOrbitDist = 30.5;
  private landingPos = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS + 1.65, 0);
  private landingVel = new THREE.Vector3();
  private landingUp = new THREE.Vector3(0, 1, 0);
  private landingFwd = new THREE.Vector3(0, 0, -1);
  private landingPitch = -0.05;
  private landingGrounded = false;
  private landingJumpQueued = false;

  // Perspective CAD Camera
  private perspTarget = new THREE.Vector3(0, 0, 0);
  private perspYaw = 0.62;
  private perspPitch = 0.44;
  private perspDist = 28.0;
  private isPanningCamera = false;

  private camPosSmooth = new THREE.Vector3(0, 22, 24);
  private camLookSmooth = new THREE.Vector3(0, 6, 0);
  private titleAngle = 0.35;

  // Brush preview, Procedural Landing Beacon & Detail Reticle, Orbital Laser Beam, Debris
  private brushPreview!: THREE.Mesh;
  private brushMat!: THREE.MeshBasicNodeMaterial;
  private brushColorNode = uniform(new THREE.Color(0xf97316));
  private landingBeaconGroup!: THREE.Group;
  private detailReticleRing!: THREE.Mesh;
  private laserBeamGroup!: THREE.Group;
  private laserOuterMesh!: THREE.Mesh;
  private laserCoreMesh!: THREE.Mesh;
  private laserImpactMesh!: THREE.Mesh;
  private laserBeamColorNode = uniform(new THREE.Color(0xf43f5e));
  private laserImpactColorNode = uniform(new THREE.Color(0xfb7185));
  private laserBeamScaleRad = 0.42;
  private laserBeamActiveUntil = 0;
  private laserBeamStart = new THREE.Vector3();
  private laserBeamEnd = new THREE.Vector3();
  private laserImpactPos = new THREE.Vector3();

  // Dynamic Planet Creator Entity Pools (Meteors, Voxel Worms, Magma, Lightning, Shockwaves, Vortices)
  private debrisMesh!: THREE.InstancedMesh;
  private readonly MAX_DEBRIS = 96;
  private debrisPos = new Float32Array(96 * 3);
  private debrisVel = new Float32Array(96 * 3);
  private debrisLife = new Float32Array(96);
  private debrisGrabbed = new Float32Array(96);
  private debrisStretchU = new Float32Array(96);
  private debrisNext = 0;

  private magmaMesh!: THREE.InstancedMesh;
  private readonly MAX_MAGMA = 256;
  private magmaPos = new Float32Array(256 * 3);
  private magmaVel = new Float32Array(256 * 3);
  private magmaLife = new Float32Array(256);
  private magmaRad = new Float32Array(256);
  private magmaGrabbed = new Float32Array(256);
  private magmaStretchU = new Float32Array(256);
  private magmaNext = 0;

  private wormMesh!: THREE.InstancedMesh;
  private readonly MAX_WORM_INSTANCES = 180;
  private activeWorms: Array<{
    segments: Array<[number, number, number]>;
    dir: [number, number, number];
    speed: number;
    radius: number;
    strength: number;
    material: MaterialId;
    life: number;
    phase: number;
    stepAccum: number;
    grabbedWeight?: number;
    stretchU?: number;
  }> = [];

  private meteorMesh!: THREE.InstancedMesh;
  private readonly MAX_METEORS = 24;
  private activeMeteors: Array<{
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    radius: number;
    strength: number;
    thermalDeltaC: number;
    debrisCount: number;
    material: MaterialId;
    rimMaterial: MaterialId;
    leaveRim: boolean;
    life: number;
    grabbedWeight?: number;
    stretchU?: number;
  }> = [];

  private shockwaveRingMesh!: THREE.InstancedMesh;
  private fireballMesh!: THREE.InstancedMesh;
  private readonly MAX_SHOCKWAVES = 16;
  private activeShockwaves: Array<{
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    age: number;
    maxAge: number;
    maxRadius: number;
    hasFireball: boolean;
    isNuke: boolean;
  }> = [];

  private vortexMesh!: THREE.InstancedMesh;
  private readonly MAX_VORTEX_INSTANCES = 64;
  private activeVortices: Array<{
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    radius: number;
    strength: number;
    speed: number;
    kind: 'blackHole' | 'tornado';
    material: MaterialId;
    age: number;
    maxAge: number;
    carveTimer: number;
  }> = [];

  private lightningLines!: THREE.LineSegments;
  private readonly MAX_LIGHTNING_SEGS = 240;
  private lightningPosArr = new Float32Array(240 * 6);
  private lightningLife = 0;

  // Procedural 3D Tractor Beam Assembly & Newtonian Force State
  private tractorBeamGroup!: THREE.Group;
  private tractorConeMesh!: THREE.Mesh;
  private tractorRings: THREE.Mesh[] = [];
  private tractorCursorOrb!: THREE.Mesh;
  private tractorStretchLine!: THREE.Line;
  private tractorStretchPosArr = new Float32Array(6);
  private tractorBeamColorNode = uniform(new THREE.Color(0x22d3ee));
  private isTractorDragging = false;
  private tractorGrabbedPlayer = false;
  private tractorCapturedEntityCount = 0;
  private tractorAnchor = new THREE.Vector3();
  private tractorTarget = new THREE.Vector3();
  private tractorPrevTarget = new THREE.Vector3();
  private tractorDragVel = new THREE.Vector3();
  private tractorDragDepthDist = 20;
  private tractorTelemetry: TractorBeamTelemetry = createIdleTractorTelemetry();
  private readonly _tractorField: ActiveFluidTractorField = {
    anchorX: 0,
    anchorY: 0,
    anchorZ: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    dragVelX: 0,
    dragVelY: 0,
    dragVelZ: 0,
    radius: 2.5,
    beamPower: 1.5,
    stretchStrength: 0.68,
  };
  private readonly _tractorForceParams: TractorForceParams = {
    planetRadius: DEFAULT_PLANET_RADIUS,
    beamPower: 1.5,
    gravityCompFactor: 0.44,
    maxAccelG: 5.8,
    massKg: 1.0,
  };
  private readonly _tractorForceRes: TractorForceResult = {
    fx: 0,
    fy: 0,
    fz: 0,
    beamForceN: 0,
    gravityWeightN: 0,
    localGravityMs2: 0,
    loadRatio: 0,
    saturated: false,
  };
  private readonly _tractorRayPick: TractorRayPickResult = { hit: false, t: 0, distSq: 0 };
  private readonly _tractorTargetPt: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly _tractorPlaneHit: Vec3Like = { x: 0, y: 0, z: 0 };

  private thermalHotspots: ThermalHotspot[] = [];
  private onMaterialPicked: ((mat: MaterialId) => void) | null = null;
  private onSurveyAction:
    | ((action: {
        kind: SurveyToolKind;
        worldPos: [number, number, number];
        normal: [number, number, number];
        attitude: GeologicalAttitude;
        hasWater: boolean;
      }) => void)
    | null = null;
  private coordGridGroup!: THREE.Group;
  private coordGridBuiltRadius = 0;
  private surveyOverlayGroup!: THREE.Group;
  private lastHoveredWorldPos: [number, number, number] | null = null;
  private lastHoveredAttitude: GeologicalAttitude | null = null;

  // Input & Touch state
  private keys = new Set<string>();
  private jumpQueued = false;
  private pointerNDC = new THREE.Vector2(0, 0);
  private pointerActive = false;
  private isDraggingOrbit = false;
  private isSculpting = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private brushCooldown = 0;

  private touchEnabled = false;
  private touchActionMode: 'sculpt' | 'look' = 'sculpt';
  private virtualMoveX = 0;
  private virtualMoveY = 0;
  private virtualUp = false;
  private virtualDown = false;
  private activeTouches = new Map<number, { x: number; y: number }>();
  private prevPinchDist = 0;

  // Simulation state
  private phase: GamePhase = 'title';
  private simTimeSec = 0;
  private config: SandboxConfig = {
    tool: 'carve',
    material: MaterialId.Soil,
    brushRadius: 1.9,
    brushStrength: 1.85,
    gravityScale: 1.0,
    sunElevationDeg: 28,
    sunAzimuthDeg: 28,
    showGravityVectors: false,
    cameraMode: 'explorer',
    perspectiveFov: 55,
    playerScale: DEFAULT_PLAYER_SCALE,
    muted: false,
    simPaused: false,
    lodMode: 'auto',
    lod0Dist: 38.0,
    lod1Dist: 56.0,
    wireframe: false,
    showChunkBounds: false,
    debugProbeEnabled: false,
    terrainRenderMode: 'smooth',
    terrainOverlay: 'material',
    voxelEdges: true,
    coordSystem: 'geo_dd',
    showCoordGrid: false,
    enuOrigin: [DEFAULT_PLANET_RADIUS, 0, 0],
    atmosphere: { ...DEFAULT_ATMOS_CONFIG },
    thermal: { ...DEFAULT_THERMAL_CONFIG },
    renderQuality: { ...DEFAULT_RENDER_QUALITY },
    visualFilter: 'none',
    filterIntensity: 0.85,
    filterScale: 1.0,
    metabolismChannel: 'species',
    showCouplingZones: false,
    showFvmFluxVectors: true,
    showProtocell3d: true,
    showHoveredFvmVox: true,
    showFvmVoxelBlocks: true,
  };

  private lastTime = 0;
  private telemetryTimer = 0.2;
  private fpsSmooth = 60;
  private frameTimeSmooth = 16.6;
  private simStepMsSmooth = 0;
  private backendDiagnostic: BackendDiagnosticInfo = createDefaultBackendDiagnostic();
  private perfTracker = new RollingPerfTracker(60);
  private gpuTimestampInFlight = false;
  private lastProbe: VoxelCellProbe | null = null;
  private raycaster = new THREE.Raycaster();

  // Pre-allocated scratch math objects (zero GC in render loop)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _v4 = new THREE.Vector3();
  private readonly _tanE = new THREE.Vector3();
  private readonly _tanN = new THREE.Vector3();
  private readonly _v2Center = new THREE.Vector2(0, 0);
  private readonly _m4 = new THREE.Matrix4();
  private readonly _q1 = new THREE.Quaternion();
  private readonly _s1 = new THREE.Vector3();
  private readonly _euler = new THREE.Euler();
  private readonly _grav: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly _upLike: Vec3Like = { x: 0, y: 1, z: 0 };
  private readonly _fwdLike: Vec3Like = { x: 0, y: 0, z: -1 };
  private readonly _rightLike: Vec3Like = { x: 1, y: 0, z: 0 };
  private readonly _normalArr: [number, number, number] = [0, 1, 0];

  constructor(
    container: HTMLElement,
    onTelemetry: (t: SandboxTelemetry) => void,
    initialConfig?: Partial<SandboxConfig>,
    initialSeed?: Partial<PlanetSeedConfig>,
    options?: { deferInitialPlanet?: boolean },
  ) {
    this.container = container;
    this.onTelemetry = onTelemetry;
    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }
    this.hasWorld = !options?.deferInitialPlanet;
    this.planet = new VoxelPlanet(initialSeed ?? 202611, {
      skipGenerate: !this.hasWorld,
    });
    this.fluid = new FluidSim();
    if (this.hasWorld) {
      this.fluid.seedInitialLakes(this.planet);
    }
    this.sound = new SoundEngine();
    this.sound.setMuted(this.config.muted);

    this.rebuildChunkCenters();
    if (this.hasWorld) {
      this.bindMetabolismToCurrentPlanet();
    }
  }

  private getPlanetScale(): number {
    return Math.max(this.planet.baseRadius / 13.0, 0.005);
  }

  private getPlayerMetrics() {
    return computeCharacterScaleMetrics(
      this.getPlanetScale(),
      this.config.playerScale,
      this.config.gravityScale,
      this.planet.nativeVoxelSize,
    );
  }

  private ensureMacroChunkCapacity(): void {
    const needed = this.planet.totalChunks;
    if (this.chunkLod.length === needed) return;

    for (const m of this.chunkMeshes) {
      if (m) {
        this.scene?.remove(m);
        m.geometry.dispose();
      }
    }
    this.chunkMeshes = new Array(needed).fill(null);
    this.chunkLod = new Int8Array(needed).fill(-1);
    this.chunkCenters = new Float32Array(needed * 3);
    if (this.chunkBoundsLines) {
      this.chunkBoundsLines.geometry.setDrawRange(0, 0);
    }
    this.lodCounts = [0, 0, 0, needed];
    this.activeChunks = 0;
    this.totalTerrainVertices = 0;
    this.chunkBoundsDirty = true;
  }

  private rebuildChunkCenters(): void {
    this.ensureMacroChunkCapacity();
    const n = this.planet.chunksPerAxis;
    for (let cz = 0; cz < n; cz++) {
      for (let cy = 0; cy < n; cy++) {
        for (let cx = 0; cx < n; cx++) {
          const ci = this.planet.chunkIndex(cx, cy, cz);
          const [wx, wy, wz] = this.planet.chunkCenterWorld(cx, cy, cz);
          this.chunkCenters[ci * 3] = wx;
          this.chunkCenters[ci * 3 + 1] = wy;
          this.chunkCenters[ci * 3 + 2] = wz;
        }
      }
    }
  }

  private syncScaleDependentRig(): void {
    const scale = this.getPlanetScale();
    this.planetRadiusNode.value = this.planet.baseRadius;
    if (this.camera) {
      this.camera.near = Math.max(0.02, 0.15 * scale);
      this.camera.far = Math.max(280, 280 * scale);
      this.camera.updateProjectionMatrix();
    }
    if (this.atmoMesh) {
      const atmoHeightScale =
        1.0 + Math.max(0.05, this.config.atmosphere.scaleHeightRatio) * 1.4;
      this.atmoMesh.scale.setScalar(scale * (atmoHeightScale / 1.196));
    }
    if (this.atmoInnerMesh) {
      this.atmoInnerMesh.scale.setScalar(scale);
    }
    if (this.cloudShellMesh) {
      const cloudRScale =
        (this.planet.baseRadius * (1 + this.config.atmosphere.cloudAltitudeRatio)) /
        15.2;
      this.cloudShellMesh.scale.setScalar(cloudRScale);
    }
    if (this.starPoints) {
      this.starPoints.scale.setScalar(scale);
    }
    if (this.sunOrbMesh) {
      this.sunOrbMesh.scale.setScalar(scale);
    }
    if (this.moonGroup) {
      this.moonGroup.scale.setScalar(scale);
      this.moonGroup.position.y = 14 * scale;
    }
    if (this.sunLight) {
      const d = 21.5 * scale;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.near = Math.max(0.1, 2 * scale);
      this.sunLight.shadow.camera.far = Math.max(30, 88 * scale);
      this.sunLight.shadow.normalBias = 0.035 * scale;
      this.sunLight.shadow.camera.updateProjectionMatrix();
    }
    if (this.rimLight) {
      this.rimLight.position.set(-28 * scale, -12 * scale, -26 * scale);
    }
    this.orbitDistance = 30.5 * scale;
    this.camDistance = this.getPlayerMetrics().defaultExplorerCamDist;
    this.fpsSpeed = 12.0 * scale;
    this.detailViewDist = 14.0 * scale;
    this.landingOrbitDist = 30.5 * scale;
    this.perspDist = 28.0 * scale;
    this.perspTarget.set(0, 0, 0);
    this.syncEnvironmentUniforms();
    this.syncOceanSeaMeshScale();
    this.updateCloudPuffs(0);
    this.updateSunDirection();
    this.rebuildCoordGridOverlay();
  }

  public async init(): Promise<void> {
    this.isSoftware = detectSoftwareRenderer();
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040711);

    const scale = this.getPlanetScale();
    this.camera = new THREE.PerspectiveCamera(
      52,
      w / h,
      Math.max(0.02, 0.15 * scale),
      Math.max(280, 280 * scale),
    );
    this.camera.position.set(16 * scale, 20 * scale, 22 * scale);

    this.renderer = new THREE.WebGPURenderer({
      antialias: !this.isSoftware,
      powerPreference: 'high-performance',
      trackTimestamp: true,
    });
    this.renderer.setPixelRatio(
      this.isSoftware ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    this.container.appendChild(canvas);

    await this.renderer.init();
    if (this.isDisposed) return;

    await this.inspectAndRecordBackendDiagnostic();

    if (
      (this.isSoftware || this.backendDiagnostic.isSoftwareRenderer) &&
      this.config.renderQuality.preset !== 'performance'
    ) {
      this.config.renderQuality = buildRenderQualityConfig('performance', true);
    }

    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new RoomEnvironment();
      const envRT = pmrem.fromScene(envScene, 0.04);
      this.scene.environment = envRT.texture;
      this.scene.environmentIntensity = this.config.renderQuality.pbrEnhanced ? 0.42 : 0.24;
      envScene.dispose();
      pmrem.dispose();
    } catch {
      // Safe fallback
    }

    this.setupLighting();
    this.setupSpaceBackdrop();
    this.setupGenerationCoreRig();

    // Auto-select WebGPU Compute (64^3 = 262k voxels) when hardware WebGPU is active; deterministic CPU fallback otherwise
    const webGpuOk = this.backendDiagnostic.backend === 'WebGPU' && !this.isSoftware && !this.backendDiagnostic.isSoftwareRenderer;
    this.metabolism.configureComputeBackend(
      webGpuOk,
      webGpuOk ? 64 : 24,
      webGpuOk ? 'webgpu' : 'cpu',
      this.renderer,
    );

    this.setupMaterials();
    this.highResGroup = new THREE.Group();
    this.scene.add(this.highResGroup);
    this.setupChunkBoundsOverlay();
    this.setupMetabolismOverlays();
    this.setupCoordGridOverlay();
    this.setupSurveyOverlayGroup();
    this.setupDirectorGizmoGroup();
    this.setupFluidMeshes();
    this.setupPlayer();
    this.setupGravityVisualizer();
    this.setupBrushAndDebris();

    this.syncScaleDependentRig();
    if (this.hasWorld) {
      this.resetPlayerToSpawn();
      this.rebuildAllChunks();
      this.rebuildWaterMesh();
      this.setPlanetRigVisible(true);
    } else {
      this.setPlanetRigVisible(false);
    }

    this.applyShadowQualitySettings();
    this.syncRenderPipeline(false);

    this.bindEvents();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    }
    this.emitTelemetrySnapshot();
    this.lastTime = performance.now();
    this.scheduleNextFrame();
  }

  private async inspectAndRecordBackendDiagnostic(): Promise<void> {
    const backendObj = this.renderer?.backend as
      | {
          isWebGPUBackend?: boolean;
          isWebGLBackend?: boolean;
          compatibilityMode?: boolean;
          trackTimestamp?: boolean;
          device?: {
            adapterInfo?: {
              vendor?: string;
              architecture?: string;
              device?: string;
              description?: string;
            };
            limits?: { maxTextureDimension2D?: number };
          };
          gl?: WebGL2RenderingContext;
        }
      | undefined;

    const isWebGPUBackend = Boolean(backendObj?.isWebGPUBackend);
    const navGpu =
      typeof navigator !== 'undefined'
        ? (
            navigator as Navigator & {
              gpu?: {
                requestAdapter?: (opts?: unknown) => Promise<{
                  info?: {
                    vendor?: string;
                    architecture?: string;
                    device?: string;
                    description?: string;
                    isFallbackAdapter?: boolean;
                  };
                } | null>;
              };
            }
          ).gpu
        : undefined;
    const navigatorGpuAvailable = Boolean(navGpu);

    let adapterLabel = '';
    let adapterVendor = '';
    let adapterArchitecture = '';
    let fallbackProbeReason = '';
    let maxTextureDim = 8192;
    let isSoftwareAdapter = this.isSoftware;

    if (isWebGPUBackend) {
      const devInfo = backendObj?.device?.adapterInfo;
      if (devInfo) {
        adapterVendor = devInfo.vendor || '';
        adapterArchitecture = devInfo.architecture || '';
        adapterLabel = devInfo.description || devInfo.device || devInfo.vendor || 'WebGPU GPU';
      }
      if (backendObj?.device?.limits?.maxTextureDimension2D) {
        maxTextureDim = backendObj.device.limits.maxTextureDimension2D;
      }
      if ((!devInfo || !adapterLabel) && navGpu?.requestAdapter) {
        try {
          const adapter = await navGpu.requestAdapter({ powerPreference: 'high-performance' });
          if (adapter?.info) {
            adapterVendor = adapter.info.vendor || adapterVendor;
            adapterArchitecture = adapter.info.architecture || adapterArchitecture;
            adapterLabel =
              adapter.info.description || adapter.info.device || adapter.info.vendor || adapterLabel;
            if (adapter.info.isFallbackAdapter) {
              isSoftwareAdapter = true;
            }
          }
        } catch {
          // Safe optional metadata lookup
        }
      }
    } else {
      const gl = backendObj?.gl;
      if (gl) {
        try {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          adapterLabel = dbg
            ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
            : String(gl.getParameter(gl.RENDERER) || 'WebGL2');
          adapterVendor = dbg
            ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '')
            : String(gl.getParameter(gl.VENDOR) || '');
          const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
          if (typeof maxTex === 'number' && maxTex > 512) {
            maxTextureDim = maxTex;
          }
        } catch {
          adapterLabel = 'WebGL2 Context';
        }
      }

      if (!navigatorGpuAvailable) {
        fallbackProbeReason =
          '浏览器或当前运行上下文未暴露 WebGPU (navigator.gpu 缺失)，已自动降级为 WebGL2 兼容渲染后端。';
      } else if (navGpu?.requestAdapter) {
        try {
          const probeAdapter = await navGpu.requestAdapter({
            powerPreference: 'high-performance',
          });
          if (!probeAdapter) {
            fallbackProbeReason =
              '无法获取可用的 WebGPU 硬件适配器 (requestAdapter 返回 null)，已自动降级为 WebGL2 渲染后端。';
          } else if (probeAdapter.info?.isFallbackAdapter) {
            isSoftwareAdapter = true;
            fallbackProbeReason =
              '浏览器仅提供了 WebGPU 回退/软件适配器且硬件初始化未通过，已自动降级为 WebGL2 后端。';
          } else {
            fallbackProbeReason =
              'WebGPU 设备或着色器特性初始化失败，Three.js 已自动回退至 WebGL2 兼容后端。';
          }
        } catch {
          fallbackProbeReason =
            '请求 WebGPU 适配器时发生异常，已自动降级为 WebGL2 渲染后端。';
        }
      }
    }

    this.backendDiagnostic = classifyBackendDiagnostic({
      isWebGPUBackend,
      navigatorGpuAvailable,
      webgpuAttempted: true,
      isCompatibilityMode: Boolean(backendObj?.compatibilityMode),
      isSoftwareRenderer: isSoftwareAdapter,
      gpuTimestampSupported: Boolean(backendObj?.trackTimestamp),
      adapterLabel,
      adapterVendor,
      adapterArchitecture,
      fallbackProbeReason,
      maxTextureDim,
    });

    if (this.backendDiagnostic.isDowngraded) {
      console.warn(
        `[TerraSphere] 渲染后端已降级 (${this.backendDiagnostic.backend}): ${this.backendDiagnostic.downgradeReason}`,
      );
    }
  }

  private getGravityParams(): PlanetaryGravityParams {
    return {
      referenceRadius: this.planet.baseRadius,
      surfaceGravity: EARTH_SURFACE_GRAVITY * this.config.gravityScale,
    };
  }

  private setupLighting(): void {
    this.hemiLight = new THREE.HemisphereLight(0x7cc4ff, 0x12182b, 0.52);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 3.25);
    this.sunLight.castShadow = true;
    const mapSize = resolveShadowMapSize(
      this.config.renderQuality.shadowQuality,
      this.backendDiagnostic.maxTextureDim,
      this.isSoftware,
    );
    this.currentShadowMapSize = mapSize;
    this.sunLight.shadow.mapSize.set(mapSize, mapSize);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 88;
    const d = 21.5;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.03;
    this.sunLight.shadow.radius = 2.2;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0x60a5fa, 0.65);
    this.rimLight.position.set(-28, -12, -26);
    this.scene.add(this.rimLight);
  }

  private setupSpaceBackdrop(): void {
    const starCount = 1600;
    const pos = new Float32Array(starCount * 3);
    const col = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const rad = 95 + Math.random() * 55;
      pos[i * 3] = rad * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = rad * Math.cos(phi);
      pos[i * 3 + 2] = rad * Math.sin(phi) * Math.sin(theta);

      const tint = Math.random();
      const b = 0.45 + Math.random() * 0.55;
      col[i * 3] = tint > 0.75 ? b : b * 0.88;
      col[i * 3 + 1] = b * 0.92;
      col[i * 3 + 2] = tint < 0.35 ? b : b * 0.85;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const starMat = new THREE.PointsNodeMaterial();
    starMat.vertexColors = true;
    starMat.sizeNode = float(2.0);
    starMat.colorNode = vertexColor();
    this.starPoints = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starPoints);

    const sunOrbGeo = new THREE.SphereGeometry(2.4, 24, 24);
    const sunOrbMat = new THREE.MeshBasicNodeMaterial();
    sunOrbMat.colorNode = color(0xfffae0).mul(2.2);
    this.sunOrbMesh = new THREE.Mesh(sunOrbGeo, sunOrbMat);
    this.scene.add(this.sunOrbMesh);

    this.moonGroup = new THREE.Group();
    const moonGeo = new THREE.SphereGeometry(2.2, 28, 28);
    const moonMat = new THREE.MeshStandardNodeMaterial();
    moonMat.colorNode = Fn(() => {
      const n = sin(positionLocal.x.mul(3.1))
        .mul(cos(positionLocal.y.mul(2.7)))
        .mul(sin(positionLocal.z.mul(3.5)))
        .mul(0.5)
        .add(0.5);
      return mix(color(0x64748b), color(0xbac6d9), n);
    })();
    moonMat.roughnessNode = float(0.92);
    moonMat.metalnessNode = float(0.02);
    this.moonGroup.add(new THREE.Mesh(moonGeo, moonMat));
    this.moonGroup.position.set(-34, 14, -26);
    this.scene.add(this.moonGroup);

    // Outer Rayleigh + Mie Sunset Atmospheric Limb Scattering Shell
    const atmoGeo = new THREE.SphereGeometry(18.2, 48, 48);
    this.atmosphereMat = new THREE.MeshBasicNodeMaterial();
    const sunDirNode = this.sunDirNode;
    const atmoEnabledNode = this.atmoEnabledNode;
    const atmoDensityNode = this.atmoDensityNode;
    const rayleighNode = this.rayleighNode;
    const mieNode = this.mieNode;

    this.atmosphereMat.colorNode = Fn(() => {
      const sunDot = normalWorld.dot(sunDirNode);
      const dayPhase = sunDot.mul(0.5).add(0.5);
      const rayleighCol = color(0x38bdf8).mul(rayleighNode);
      const deepSky = color(0x0369a1);
      const twilightCol = color(0xf97316).mul(mieNode.mul(0.9).add(0.25));
      const nightCol = color(0x071226);

      // Mie forward/terminator amber scattering band around sunDot ≈ 0
      const terminatorBand = pow(
        float(1.0).sub(tslClamp(abs(sunDot), 0.0, 1.0)),
        float(3.2),
      ).mul(tslClamp(mieNode, 0.0, 2.5));

      const skyBase = mix(nightCol, mix(deepSky, rayleighCol, smoothstep(0.4, 0.9, dayPhase)), smoothstep(0.16, 0.56, dayPhase));
      return mix(skyBase, twilightCol, tslClamp(terminatorBand.mul(0.78), 0.0, 0.85));
    })();

    this.atmosphereMat.opacityNode = Fn(() => {
      const viewDir = cameraPosition.sub(positionWorld).normalize();
      const fres = pow(float(1.0).sub(abs(normalWorld.dot(viewDir))), float(2.8));
      const sunDot = normalWorld.dot(sunDirNode).mul(0.5).add(0.5);
      const densScale = tslClamp(atmoDensityNode.mul(0.75).add(0.25), 0.0, 2.2);
      return fres
        .mul(smoothstep(0.12, 0.88, sunDot).mul(0.46).add(0.06))
        .mul(densScale)
        .mul(atmoEnabledNode)
        .mul(this.legacyAtmoShellScaleNode);
    })();
    this.atmosphereMat.transparent = true;
    this.atmosphereMat.depthWrite = false;
    this.atmosphereMat.side = THREE.BackSide;
    this.atmoMesh = new THREE.Mesh(atmoGeo, this.atmosphereMat);
    this.atmoMesh.scale.setScalar(this.planet.baseRadius / 13.0);
    this.scene.add(this.atmoMesh);

    // Inner Aerial-Perspective Haze Shell (FrontSide)
    const atmoInnerGeo = new THREE.SphereGeometry(15.6, 40, 40);
    const atmoInnerMat = new THREE.MeshBasicNodeMaterial();
    atmoInnerMat.colorNode = Fn(() => {
      const sunDot = normalWorld.dot(sunDirNode);
      const daySky = color(0x7dd3fc).mul(rayleighNode);
      const sunsetGlow = color(0xfb923c).mul(mieNode);
      const term = pow(float(1.0).sub(tslClamp(abs(sunDot), 0.0, 1.0)), float(4.0));
      return mix(daySky, sunsetGlow, tslClamp(term.mul(0.65), 0.0, 0.8));
    })();
    atmoInnerMat.opacityNode = Fn(() => {
      const viewDir = cameraPosition.sub(positionWorld).normalize();
      const grazing = pow(float(1.0).sub(tslClamp(abs(normalWorld.dot(viewDir)), 0.0, 1.0)), float(4.0));
      const sunVis = smoothstep(-0.25, 0.55, normalWorld.dot(sunDirNode));
      return grazing
        .mul(sunVis)
        .mul(tslClamp(atmoDensityNode, 0.0, 2.5))
        .mul(0.22)
        .mul(atmoEnabledNode)
        .mul(this.legacyAtmoShellScaleNode);
    })();
    atmoInnerMat.transparent = true;
    atmoInnerMat.depthWrite = false;
    this.atmoInnerMesh = new THREE.Mesh(atmoInnerGeo, atmoInnerMat);
    this.atmoInnerMesh.scale.setScalar(this.planet.baseRadius / 13.0);
    this.scene.add(this.atmoInnerMesh);

    // Animated Spherical Cloud Canopy Layer (Coriolis Zonal Bands & Cyclone Swirls)
    const cloudGeo = new THREE.SphereGeometry(15.2, 56, 40);
    this.cloudShellMat = new THREE.MeshStandardNodeMaterial();
    const simTimeNode = this.simTimeNode;
    const windSpeedNode = this.windSpeedNode;
    const cloudCoverNode = this.cloudCoverNode;

    const cloudDensityField = Fn(() => {
      const p = positionLocal.normalize();
      const latBand = sin(p.y.mul(5.5));
      const drift = simTimeNode.mul(windSpeedNode).mul(0.085);
      const swirlX = p.x.mul(cos(drift.mul(1.2).add(latBand.mul(0.45)))).sub(
        p.z.mul(sin(drift.mul(1.2).add(latBand.mul(0.45)))),
      );
      const swirlZ = p.x.mul(sin(drift.mul(1.2).add(latBand.mul(0.45)))).add(
        p.z.mul(cos(drift.mul(1.2).add(latBand.mul(0.45)))),
      );

      const n1 = sin(swirlX.mul(4.2).add(cos(p.y.mul(5.1)).mul(1.4)))
        .mul(cos(swirlZ.mul(3.9).sub(p.y.mul(4.3))))
        .mul(0.5)
        .add(0.5);
      const n2 = sin(swirlX.mul(9.5).sub(drift.mul(2.1)).add(p.y.mul(7.0)))
        .mul(cos(swirlZ.mul(8.8).add(p.y.mul(6.4))))
        .mul(0.5)
        .add(0.5);
      const fbm = n1.mul(0.68).add(n2.mul(0.32));
      const coverNorm = tslClamp(cloudCoverNode, 0.0, 2.0);
      const thresh = float(1.0).sub(tslClamp(coverNorm.mul(0.55), 0.0, 0.98));
      return smoothstep(thresh.sub(0.16), thresh.add(0.22), fbm).mul(
        tslClamp(coverNorm, 0.0, 1.45),
      );
    });

    this.cloudShellMat.colorNode = Fn(() => {
      const sunDot = normalWorld.dot(sunDirNode);
      const dayCloud = color(0xf8fafc);
      const sunsetCloud = color(0xfdba74);
      const nightCloud = color(0x1e293b);
      const rimTerm = pow(float(1.0).sub(tslClamp(abs(sunDot), 0.0, 1.0)), float(4.2)).mul(
        mieNode,
      );
      const litCol = mix(dayCloud, sunsetCloud, tslClamp(rimTerm.mul(0.65), 0.0, 0.85));
      return mix(nightCloud, litCol, smoothstep(-0.22, 0.35, sunDot));
    })();
    this.cloudShellMat.roughnessNode = float(0.92);
    this.cloudShellMat.metalnessNode = float(0.0);
    this.cloudShellMat.opacityNode = Fn(() => {
      const c = cloudDensityField();
      return tslClamp(c.mul(0.68), 0.0, 0.94).mul(atmoEnabledNode);
    })();
    this.cloudShellMat.transparent = true;
    this.cloudShellMat.depthWrite = false;
    this.cloudShellMat.side = THREE.DoubleSide;
    this.cloudShellMesh = new THREE.Mesh(cloudGeo, this.cloudShellMat);
    this.scene.add(this.cloudShellMesh);

    // Volumetric 3D Cloud Billow Clusters (InstancedMesh orbiting with Coriolis wind)
    const puffGeo = new THREE.IcosahedronGeometry(0.95, 1);
    const puffMat = new THREE.MeshStandardNodeMaterial();
    puffMat.colorNode = Fn(() => {
      const sunDot = normalWorld.dot(sunDirNode).mul(0.5).add(0.5);
      return mix(color(0x94a3b8), color(0xffffff), smoothstep(0.25, 0.85, sunDot));
    })();
    puffMat.roughnessNode = float(0.9);
    puffMat.metalnessNode = float(0.0);
    puffMat.opacityNode = float(0.76);
    puffMat.transparent = true;
    this.cloudPuffsMesh = new THREE.InstancedMesh(puffGeo, puffMat, this.CLOUD_PUFF_COUNT);
    this.cloudPuffsMesh.castShadow = !this.isSoftware;
    this.cloudPuffsMesh.receiveShadow = false;
    this.cloudPuffsMesh.frustumCulled = false;

    this.cloudSeeds = [];
    for (let i = 0; i < this.CLOUD_PUFF_COUNT; i++) {
      // Deterministic cloud cluster layout distributed along tropical/mid-latitude belts
      const golden = i * 2.3999632;
      const band = ((i % 7) - 3) * 0.24 + Math.sin(i * 1.7) * 0.12;
      this.cloudSeeds.push({
        lat: clamp(band, -1.2, 1.2),
        lon: (golden % (Math.PI * 2)) - Math.PI,
        altJitter: (Math.sin(i * 3.1) * 0.5 + 0.5) * 0.04,
        sx: 1.15 + (i % 3) * 0.48,
        sy: 0.42 + (i % 2) * 0.16,
        sz: 0.85 + ((i + 1) % 3) * 0.38,
        phase: i * 0.73,
      });
    }
    this.scene.add(this.cloudPuffsMesh);
  }

  private setupGenerationCoreRig(): void {
    this.genCoreGroup = new THREE.Group();
    const coreGeo = new THREE.SphereGeometry(1, 32, 24);
    const coreMat = new THREE.MeshStandardNodeMaterial();
    coreMat.colorNode = color(0x38bdf8);
    coreMat.emissiveNode = color(0x0ea5e9).mul(1.65);
    coreMat.roughnessNode = float(0.28);
    coreMat.metalnessNode = float(0.15);
    this.genCoreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.genCoreGroup.add(this.genCoreMesh);

    const cageGeo = new THREE.IcosahedronGeometry(1.16, 2);
    const cageMat = new THREE.MeshBasicNodeMaterial();
    cageMat.colorNode = color(0x7dd3fc);
    cageMat.wireframe = true;
    cageMat.transparent = true;
    cageMat.opacity = 0.42;
    this.genCageMesh = new THREE.Mesh(cageGeo, cageMat);
    this.genCoreGroup.add(this.genCageMesh);

    this.genCoreGroup.visible = false;
    this.scene.add(this.genCoreGroup);
  }

  private createTerrainMaterial(): THREE.MeshPhysicalNodeMaterial {
    const mat = new THREE.MeshPhysicalNodeMaterial();
    mat.vertexColors = true;
    mat.wireframe = this.config.wireframe;

    const matPropsAttr = attribute('aMatProps', 'vec3');
    const sunDirNode = this.sunDirNode;
    const planetRadiusNode = this.planetRadiusNode;
    const isBlockyNode = this.isBlockyNode;
    const voxelEdgesNode = this.voxelEdgesNode;
    const overlayModeNode = this.overlayModeNode;
    const atmoDensityNode = this.atmoDensityNode;
    const solarRatioNode = this.solarRatioNode;
    const coreTempNode = this.coreTempNode;
    const lapseRateNode = this.lapseRateNode;
    const scaleHeightNode = this.scaleHeightNode;
    const greenhouseNode = this.greenhouseNode;
    const pbrEnhancedNode = this.pbrEnhancedNode;
    const pbrReliefDepthNode = this.pbrReliefDepthNode;
    const nativeVoxelSizeNode = this.nativeVoxelSizeNode;
    const bloomEnabledNode = this.bloomEnabledNode;

    const pbrBundle = buildTerrainSubVoxelPbrBundle({
      isBlockyNode,
      voxelEdgesNode,
      pbrEnhancedNode,
      pbrReliefDepthNode,
      nativeVoxelSizeNode,
      sunDirNode,
      matPropsNode: matPropsAttr,
    });

    const computeThermalColor = Fn(() => {
      const p = positionWorld;
      const r = length(p);
      const safeR0 = max(planetRadiusNode, 0.05);
      const dir = p.div(max(r, 0.001));
      const sunDot = dot(dir, sunDirNode);
      const cosLat = sqrt(max(0.0, float(1.0).sub(dir.y.mul(dir.y))));
      const altRatio = r.div(safeR0).sub(1.0);

      const inertia = tslClamp(atmoDensityNode.mul(0.55), 0.0, 0.85);
      const diurnalRange = float(1.0).sub(inertia.mul(0.72)).mul(34.0).mul(sqrt(max(0.01, solarRatioNode)));
      const solarHeat = cosLat.mul(22.0).add(10.0).mul(pow(max(0.01, solarRatioNode), float(0.25))).sub(18.0).add(sunDot.mul(0.5).add(0.15).mul(diurnalRange));
      const altCool = max(0.0, altRatio).div(max(scaleHeightNode, 0.02)).mul(lapseRateNode);
      const coreDepth = tslClamp(float(0.98).sub(r.div(safeR0)).div(0.98), 0.0, 1.0);
      const geoHeat = pow(coreDepth, float(1.65)).mul(coreTempNode);

      // Bidirectional exothermic/endothermic reaction hotspot coupling in 3D thermal overlay
      const h0D = length(p.sub(this.metabHotspotPos0.xyz));
      const h0W = float(1.0).sub(smoothstep(0.0, max(this.metabHotspotPos0.w, 0.1), h0D));
      const h1D = length(p.sub(this.metabHotspotPos1.xyz));
      const h1W = float(1.0).sub(smoothstep(0.0, max(this.metabHotspotPos1.w, 0.1), h1D));
      const h2D = length(p.sub(this.metabHotspotPos2.xyz));
      const h2W = float(1.0).sub(smoothstep(0.0, max(this.metabHotspotPos2.w, 0.1), h2D));
      const h3D = length(p.sub(this.metabHotspotPos3.xyz));
      const h3W = float(1.0).sub(smoothstep(0.0, max(this.metabHotspotPos3.w, 0.1), h3D));
      const metabHeatC = h0W
        .mul(this.metabHotspotDeltaC.x)
        .add(h1W.mul(this.metabHotspotDeltaC.y))
        .add(h2W.mul(this.metabHotspotDeltaC.z))
        .add(h3W.mul(this.metabHotspotDeltaC.w));

      const tempC = float(-18.0)
        .add(solarHeat)
        .add(greenhouseNode)
        .sub(min(float(95.0), altCool))
        .add(geoHeat)
        .add(metabHeatC);

      // Calibrated Coolwarm / Geothermal color ramp (-70°C .. +900°C)
      const cCold = color(0x2840b8);
      const cFreeze = color(0x22d3ee);
      const cTemperate = color(0x34d399);
      const cWarm = color(0xfbbf24);
      const cMagma = color(0xef4444);
      const cCore = color(0xfef08a);

      let col = mix(cCold, cFreeze, smoothstep(-70.0, -5.0, tempC));
      col = mix(col, cTemperate, smoothstep(-5.0, 20.0, tempC));
      col = mix(col, cWarm, smoothstep(20.0, 48.0, tempC));
      col = mix(col, cMagma, smoothstep(48.0, 220.0, tempC));
      col = mix(col, cCore, smoothstep(220.0, 850.0, tempC));

      // Crisp 12°C / 80°C isotherm contour lines across terrain
      const band = fract(tempC.div(14.0));
      const isoLine = float(1.0).sub(smoothstep(0.0, 0.07, band)).mul(0.25);
      return col.add(vec3(isoLine)).saturate();
    });

    // Zero-readback GPU Compute FVM StorageBuffer direct color sampler (only bound when WebGPU Compute solver exists)
    // In blocky mode, step slightly inward along -normalWorld so cube faces never straddle FVM cell boundaries.
    const fvmSampleWorldPos = select(
      isBlockyNode.greaterThan(0.5),
      positionWorld.sub(normalWorld.mul(nativeVoxelSizeNode.mul(0.08))),
      positionWorld,
    );
    const gpuSamplerNode =
      this.metabolism.gpuSolver && this.backendDiagnostic.backend === 'WebGPU'
        ? this.metabolism.gpuSolver.buildTerrainColorSampleFn(fvmSampleWorldPos, this.gpuFvmChannelNode)
        : null;

    mat.colorNode = Fn(() => {
      const p = positionWorld;
      const radialDist = p.length();
      const viewDist = cameraPosition.sub(p).length();
      // Distant Horizons mip fade: eliminate sub-pixel triplanar shimmer & moiré on far mountains
      const grainFade = smoothstep(
        max(planetRadiusNode.mul(0.85), float(5.0)),
        max(planetRadiusNode.mul(0.12), float(0.8)),
        viewDist,
      );
      const edgeFade = smoothstep(
        max(planetRadiusNode.mul(0.95), float(6.0)),
        max(planetRadiusNode.mul(0.15), float(1.2)),
        viewDist,
      );
      const strata = sin(radialDist.mul(5.2).add(sin(p.x.mul(1.8)).mul(0.7)))
        .mul(0.5)
        .add(0.5);
      const grainX = sin(p.y.mul(8.5).add(p.z.mul(7.3)));
      const grainY = sin(p.x.mul(8.1).add(p.z.mul(6.9)));
      const grainZ = sin(p.x.mul(7.7).add(p.y.mul(8.3)));
      const triWeight = abs(normalLocal);
      const grain = grainX
        .mul(triWeight.x)
        .add(grainY.mul(triWeight.y))
        .add(grainZ.mul(triWeight.z))
        .mul(0.055)
        .mul(grainFade);

      const base = vertexColor();
      const smoothCol = base.mul(float(0.93).add(strata.mul(0.11)).add(grain));

      // Minecraft-style blocky face border & pixel tile shading using face UV
      const blockUv = uv();
      const edgeDist = min(
        min(blockUv.x, float(1.0).sub(blockUv.x)),
        min(blockUv.y, float(1.0).sub(blockUv.y)),
      );
      const borderMask = smoothstep(0.0, 0.068, edgeDist);
      const pixelStep = sin(blockUv.x.mul(25.1327))
        .mul(cos(blockUv.y.mul(25.1327)))
        .mul(0.045)
        .mul(edgeFade);
      const effectiveEdge = voxelEdgesNode.mul(edgeFade);
      const blockBorderShade = mix(
        float(1.0),
        mix(float(0.48), float(1.0), borderMask),
        isBlockyNode.mul(effectiveEdge),
      );
      const blockBody = base.mul(float(1.02).add(pixelStep));
      const blockyEdgeCol = mix(blockBody.mul(0.56), blockBody, borderMask);
      const blockyCol = mix(blockBody, blockyEdgeCol, effectiveEdge);

      const materialStyled = mix(smoothCol, blockyCol, isBlockyNode);
      const subVoxelPbrStyled = pbrBundle.applyAlbedoPbr(materialStyled.rgb);

      // Thermal, Strata Density & Read-Only Metabolism Field Overlays (preserving crisp voxel seams in blocky mode)
      const thermalCol = computeThermalColor().mul(blockBorderShade);
      const isThermal = smoothstep(0.5, 1.0, overlayModeNode).mul(
        float(1.0).sub(smoothstep(1.5, 2.0, overlayModeNode)),
      );
      const isDensity = smoothstep(1.5, 2.0, overlayModeNode).mul(
        float(1.0).sub(smoothstep(2.5, 3.0, overlayModeNode)),
      );
      const isMetabolism = smoothstep(2.5, 3.0, overlayModeNode);
      const metabDirectCol = (
        gpuSamplerNode
          ? mix(base.rgb, gpuSamplerNode, this.gpuFvmActiveNode)
          : base.rgb
      ).mul(blockBorderShade);

      const rRatio = radialDist.div(max(planetRadiusNode, 0.05));
      const ringBand = fract(rRatio.mul(10.0));
      const ringLine = float(1.0).sub(smoothstep(0.0, 0.06, ringBand)).mul(0.28);
      // 4-Sphere Radial Planetary Stratification: Inner Core (<0.17), Outer Core (0.17..0.30), Mantle (0.30..0.79), Crust (>=0.79)
      const cInnerCore = color(0xfef08a); // Incandescent solid Fe-Ni inner core
      const cOuterCore = color(0xf97316); // Liquid convecting outer core
      const cMantle = color(0x991b1b);    // Magmatic silicate mantle
      const cCrust = color(0x38bdf8);     // Differentiated rocky crust
      let strataCol = mix(cInnerCore, cOuterCore, smoothstep(0.155, 0.185, rRatio));
      strataCol = mix(strataCol, cMantle, smoothstep(0.285, 0.315, rRatio));
      strataCol = mix(strataCol, cCrust, smoothstep(0.77, 0.81, rRatio));
      const densityCol = strataCol.add(vec3(ringLine)).mul(blockBorderShade);

      let outCol = mix(subVoxelPbrStyled, thermalCol, isThermal);
      outCol = mix(outCol, densityCol, isDensity);
      outCol = mix(outCol, metabDirectCol, isMetabolism);
      return outCol.saturate();
    })();

    mat.normalNode = pbrBundle.normalNode;
    mat.aoNode = pbrBundle.aoNode;
    mat.roughnessNode = pbrBundle.roughnessNode;
    mat.metalnessNode = matPropsAttr.y;
    mat.clearcoatNode = pbrBundle.clearcoatNode;
    mat.clearcoatRoughnessNode = float(0.07);
    mat.emissiveNode = Fn(() => {
      const crystalGlow = vertexColor()
        .mul(matPropsAttr.z)
        .mul(pbrBundle.emissiveBoostNode)
        .mul(float(1.0).add(bloomEnabledNode.mul(0.8)));
      const isThermal = smoothstep(0.5, 1.0, overlayModeNode).mul(
        float(1.0).sub(smoothstep(1.5, 2.0, overlayModeNode)),
      );
      const isMetabolism = smoothstep(2.5, 3.0, overlayModeNode);
      const metabEmCol = gpuSamplerNode
        ? mix(vertexColor().rgb, gpuSamplerNode, this.gpuFvmActiveNode)
        : vertexColor().rgb;
      let em = mix(crystalGlow, computeThermalColor().mul(0.32), isThermal);
      em = mix(em, metabEmCol.mul(0.3), isMetabolism);
      return em;
    })();

    return mat;
  }

  private setupMaterials(): void {
    this.terrainMaterial = this.createTerrainMaterial();
    this.highResGlobeMaterial = this.terrainMaterial;
    this.highResHemiMaterial = this.terrainMaterial;
    this.highResMidOuterMaterial = this.terrainMaterial;
    this.highResMidMaterial = this.terrainMaterial;
    this.highResNativeMaterial = this.terrainMaterial;

    const buildCalmReflectiveWaterMat = (isHydrostaticOcean: boolean): THREE.MeshPhysicalNodeMaterial => {
      const wMat = new THREE.MeshPhysicalNodeMaterial();
      const sunDirNode = this.sunDirNode;
      const cutawayNode = this.cutawayActiveNode;
      wMat.colorNode = Fn(() => {
        const p = positionWorld;
        const tAnim = this.simTimeNode;
        const wave1 = sin(p.x.mul(1.8).add(tAnim.mul(1.3)))
          .mul(cos(p.z.mul(1.6).sub(tAnim.mul(1.1))));
        const wave2 = sin(p.y.mul(2.1).sub(tAnim.mul(1.2))).mul(0.5).add(0.5);
        const ripple = wave1.mul(0.5).add(0.5).mul(wave2);

        const deepWater = color(0x0b2a4a);
        const midWater = color(0x165378);
        const skyReflect = color(0x8bc3f2);
        const sunGlintCol = color(0xfff4d6);

        const n = normalWorld.normalize();
        const viewDir = cameraPosition.sub(p).normalize();
        const nDotV = tslClamp(dot(n, viewDir), 0.0, 1.0);
        const fresnel = pow(float(1.0).sub(nDotV), float(2.8));

        const reflDir = n.mul(nDotV.mul(2.0)).sub(viewDir);
        const sunGlint = pow(max(0.0, dot(reflDir, sunDirNode)), float(92.0)).mul(0.58);
        const baseTint = mix(deepWater, midWater, ripple.mul(0.35).add(0.2));
        return mix(baseTint, skyReflect, tslClamp(fresnel.mul(0.88), 0.0, 0.92)).add(
          sunGlintCol.mul(sunGlint),
        );
      })();
      wMat.normalNode = buildWaterWaveNormalNode({
        simTimeNode: this.simTimeNode,
        windSpeedNode: this.windSpeedNode,
        pbrEnhancedNode: this.pbrEnhancedNode,
      });
      wMat.roughnessNode = float(0.035);
      wMat.metalnessNode = float(0.12);
      wMat.clearcoatNode = float(1.0);
      wMat.clearcoatRoughnessNode = float(0.03);
      wMat.opacityNode = Fn(() => {
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        const fres = pow(
          float(1.0).sub(tslClamp(dot(normalWorld.normalize(), viewDir), 0.0, 1.0)),
          float(2.4),
        );
        const baseAlpha = mix(float(0.68), float(0.96), fres);
        if (!isHydrostaticOcean) {
          return baseAlpha;
        }
        const inCutaway = cutawayNode
          .greaterThan(0.5)
          .and(positionWorld.x.greaterThan(0.0))
          .and(positionWorld.y.greaterThan(0.0))
          .and(positionWorld.z.greaterThan(0.0));
        return select(inCutaway, float(0.0), baseAlpha);
      })();
      if (isHydrostaticOcean) {
        wMat.alphaTest = 0.05;
        wMat.side = THREE.FrontSide;
      } else {
        wMat.side = THREE.DoubleSide;
      }
      wMat.transparent = true;
      wMat.depthWrite = false;
      return wMat;
    };

    this.waterMaterial = buildCalmReflectiveWaterMat(false);
    this.oceanMaterial = buildCalmReflectiveWaterMat(true);
  }

  private setupChunkBoundsOverlay(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.chunkBoundsPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.chunkBoundsCol, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicNodeMaterial();
    mat.vertexColors = true;
    mat.colorNode = vertexColor();
    mat.opacityNode = float(0.55);
    mat.transparent = true;

    this.chunkBoundsLines = new THREE.LineSegments(geo, mat);
    this.chunkBoundsLines.frustumCulled = false;
    this.chunkBoundsLines.visible = this.config.showChunkBounds;
    this.scene.add(this.chunkBoundsLines);
  }

  private setupMetabolismOverlays(): void {
    // 1. Read-only Volumetric Field Point Cloud consuming FvmRenderFieldView
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.metabolismPointsPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.metabolismPointsCol, 3));
    pGeo.setDrawRange(0, 0);
    const pMat = new THREE.PointsNodeMaterial();
    pMat.vertexColors = true;
    pMat.sizeNode = float(3.4);
    pMat.colorNode = vertexColor();
    pMat.opacityNode = float(0.68);
    pMat.transparent = true;
    pMat.depthWrite = false;
    this.metabolismFieldPoints = new THREE.Points(pGeo, pMat);
    this.metabolismFieldPoints.frustumCulled = false;
    this.metabolismFieldPoints.visible = false;
    this.scene.add(this.metabolismFieldPoints);

    // 2. PIC Lagrangian Coupling Zone AABB Wireframe Gizmo
    const zGeo = new THREE.BufferGeometry();
    zGeo.setAttribute('position', new THREE.BufferAttribute(this.couplingZonePos, 3));
    zGeo.setDrawRange(0, 0);
    const zMat = new THREE.LineBasicNodeMaterial();
    zMat.colorNode = color(0x22d3ee);
    zMat.opacityNode = float(0.88);
    zMat.transparent = true;
    this.couplingZoneLines = new THREE.LineSegments(zGeo, zMat);
    this.couplingZoneLines.frustumCulled = false;
    this.couplingZoneLines.visible = false;
    this.scene.add(this.couplingZoneLines);

    // 3. Composite 3D Living Protocell + PIC AABB Brownian Particles
    this.protocellVisual = createProtocellVisualAssembly(this.isSoftware);
    this.protocellVisual.root.visible = false;
    this.scene.add(this.protocellVisual.root);

    // 4. 3D Directional Eulerian FVM Flux Streamlines
    this.fvmFluxVisual = createFvmFluxArrowsVisual(420);
    this.scene.add(this.fvmFluxVisual.lines);

    // 5. Hovered & Locked Single FVM Control-Volume Wireframe Boxes
    this.hoveredVoxVisual = createHoveredVoxHighlightVisual(0xfbbf24);
    this.scene.add(this.hoveredVoxVisual.lines);
    this.lockedVoxVisual = createHoveredVoxHighlightVisual(0x22d3ee);
    this.scene.add(this.lockedVoxVisual.lines);

    // 6. Discrete 3D Instanced FVM Control-Volume Blocks across the reactive shell
    this.fvmVoxelBlocksVisual = createFvmVoxelBlocksVisual(640);
    this.scene.add(this.fvmVoxelBlocksVisual.mesh);

    // 7. Geological Evolution 3D Wavefront Rings + Volcano Plume Assembly
    this.geologicalVisuals = createGeologicalVisualsAssembly();
    this.scene.add(this.geologicalVisuals.root);

    this.syncCouplingZoneLines();
  }

  private bindMetabolismToCurrentPlanet(): void {
    const sunArr: [number, number, number] = [
      this.sunDirUniform.x,
      this.sunDirUniform.y,
      this.sunDirUniform.z,
    ];
    this.metabolism.bindToPlanet(
      this.planet,
      sunArr,
      this.config.atmosphere,
      this.config.thermal,
    );
    // Attach the active EulerianFvmGrid onto VoxelPlanet so Chunk/Vox probes read live FVM state
    this.planet.fvmGrid = this.metabolism.grid;
    if (this.metabolism.computeBackend === 'webgpu' && this.metabolism.gpuSolver) {
      this.rebuildTerrainMaterialBindings();
    }
    this.lastMetabolismVisualRevision = -1;
    this.syncCouplingZoneLines();
    this.syncMetabolismReadOnlyVisuals(true);
  }

  private syncCouplingZoneLines(): void {
    if (!this.couplingZoneLines) return;
    const zones = this.metabolism.couplingRegistry.listZones();
    const show = Boolean(this.config.showCouplingZones) && this.hasWorld && zones.length > 0;
    this.couplingZoneLines.visible = show;
    if (!show) return;

    let v = 0;
    const maxBoxes = Math.min(zones.length, 12);
    for (let zIdx = 0; zIdx < maxBoxes; zIdx++) {
      const z = zones[zIdx];
      const [x0, y0, z0] = z.aabbMin;
      const [x1, y1, z1] = z.aabbMax;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dz = z1 - z0;
      for (const e of BOX_EDGES) {
        this.couplingZonePos[v * 3] = x0 + e[0] * dx;
        this.couplingZonePos[v * 3 + 1] = y0 + e[1] * dy;
        this.couplingZonePos[v * 3 + 2] = z0 + e[2] * dz;
        v++;
        this.couplingZonePos[v * 3] = x0 + e[3] * dx;
        this.couplingZonePos[v * 3 + 1] = y0 + e[4] * dy;
        this.couplingZonePos[v * 3 + 2] = z0 + e[5] * dz;
        v++;
      }
    }
    const posAttr = this.couplingZoneLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    this.couplingZoneLines.geometry.setDrawRange(0, v);
  }

  private applyFvmColorsToMesh(
    mesh: THREE.Mesh,
    paintMetabolism: boolean,
    channel: MetabolismVisualChannel,
  ): void {
    const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const normAttr = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const colAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!posAttr || !colAttr) return;

    const colArr = colAttr.array as Float32Array;
    if (!mesh.userData.baseColors || (mesh.userData.baseColors as Float32Array).length !== colArr.length) {
      mesh.userData.baseColors = new Float32Array(colArr);
    }

    if (!paintMetabolism) {
      const base = mesh.userData.baseColors as Float32Array;
      colArr.set(base);
      colAttr.needsUpdate = true;
      return;
    }

    const view = this.metabolism.getReadOnlyRenderView();
    const posArr = posAttr.array as Float32Array;
    const normArr = normAttr ? (normAttr.array as Float32Array) : null;
    const ox = mesh.position.x;
    const oy = mesh.position.y;
    const oz = mesh.position.z;
    const count = posAttr.count;
    const rgb = this._metabRgb;
    const isBlocky = this.config.terrainRenderMode === 'blocky';
    const inset = isBlocky && normArr ? this.planet.voxelSize * 0.08 : 0;
    const needMat = channel === 'mineral';

    for (let i = 0; i < count; i++) {
      let sx = posArr[i * 3] + ox;
      let sy = posArr[i * 3 + 1] + oy;
      let sz = posArr[i * 3 + 2] + oz;
      if (inset > 0 && normArr) {
        sx -= normArr[i * 3] * inset;
        sy -= normArr[i * 3 + 1] * inset;
        sz -= normArr[i * 3 + 2] * inset;
      }
      const matId = needMat ? this.planet.sampleNearestMaterial(sx, sy, sz) : undefined;
      if (sampleFvmRenderColor(view, sx, sy, sz, channel, rgb, matId)) {
        colArr[i * 3] = rgb[0];
        colArr[i * 3 + 1] = rgb[1];
        colArr[i * 3 + 2] = rgb[2];
      } else {
        colArr[i * 3] = 0.14;
        colArr[i * 3 + 1] = 0.18;
        colArr[i * 3 + 2] = 0.24;
      }
    }
    colAttr.needsUpdate = true;
  }

  /**
   * Decoupled Read-Only Field Visualization Sync:
   * Consumes FvmRenderFieldView snapshots strictly read-only to color terrain meshes
   * and the volumetric atmosphere/reaction point field without blocking simulation.
   */
  private syncMetabolismReadOnlyVisuals(force = false): void {
    if (!this.scene || !this.hasWorld) return;
    const overlay = this.config.terrainOverlay;
    const channel: MetabolismVisualChannel = this.config.metabolismChannel ?? 'species';
    const isMetab = overlay === 'metabolism';
    const gpuActive = this.metabolism.computeBackend === 'webgpu' && this.metabolism.gpuSolver !== null;
    const snap = this.metabolism.getSummarySnapshot();
    const curRev = snap.renderRevision;

    this.gpuFvmActiveNode.value = gpuActive ? 1.0 : 0.0;
    this.gpuFvmChannelNode.value =
      channel === 'species'
        ? 0.0
        : channel === 'energy'
          ? 1.0
          : channel === 'phase'
            ? 2.0
            : channel === 'flux'
              ? 3.0
              : channel === 'mineral'
                ? 4.0
                : 5.0;

    const modeChanged =
      overlay !== this.lastMetabolismVisualOverlay ||
      channel !== this.lastMetabolismVisualChannel;
    const revChanged = curRev !== this.lastMetabolismVisualRevision;

    if (!force && !modeChanged && (!isMetab || !revChanged)) {
      return;
    }

    // In WebGPU Compute mode, terrain shaders read StorageBuffers directly with zero CPU readback!
    // In CPU fallback mode, paint read-only vertex colors onto macro & high-res meshes.
    if (!gpuActive && (isMetab || this.lastMetabolismVisualOverlay === 'metabolism')) {
      for (const m of this.chunkMeshes) {
        if (m) {
          this.applyFvmColorsToMesh(m, isMetab, channel);
        }
      }
      for (const m of this.highResMeshes.values()) {
        this.applyFvmColorsToMesh(m, isMetab, channel);
      }
    } else if (gpuActive && this.lastMetabolismVisualOverlay === 'metabolism' && !isMetab) {
      for (const m of this.chunkMeshes) {
        if (m) this.applyFvmColorsToMesh(m, false, channel);
      }
      for (const m of this.highResMeshes.values()) {
        this.applyFvmColorsToMesh(m, false, channel);
      }
    }

    const view = this.metabolism.getReadOnlyRenderView();
    if (this.metabolismFieldPoints) {
      // Keep atmospheric plume points visible in CPU mode; in GPU mode, 3D GPU shader covers full surface directly
      this.metabolismFieldPoints.visible = isMetab && !gpuActive;
      if (isMetab && !gpuActive) {
        const n = view.cellsPerAxis;
        const r0 = this.planet.baseRadius;
        const rgb = this._metabRgb;
        let ptCount = 0;
        const maxPts = Math.floor(this.metabolismPointsPos.length / 3);
        const stride = n > 24 ? 2 : 1;

        for (let iz = 0; iz < n; iz += stride) {
          for (let iy = 0; iy < n; iy += stride) {
            for (let ix = 0; ix < n; ix += stride) {
              if (ptCount >= maxPts) break;
              const idx = ix + iy * n + iz * n * n;
              if (view.activeMask[idx] === 0) continue;
              const wx = -view.worldHalf + (ix + 0.5) * view.voxelSize;
              const wy = -view.worldHalf + (iy + 0.5) * view.voxelSize;
              const wz = -view.worldHalf + (iz + 0.5) * view.voxelSize;
              const r = Math.hypot(wx, wy, wz);
              if (r < r0 * 0.96 || r > r0 * 1.2) continue;

              const matId = channel === 'mineral' ? this.planet.sampleNearestMaterial(wx, wy, wz) : undefined;
              sampleFvmRenderColor(view, wx, wy, wz, channel, rgb, matId);
              this.metabolismPointsPos[ptCount * 3] = wx;
              this.metabolismPointsPos[ptCount * 3 + 1] = wy;
              this.metabolismPointsPos[ptCount * 3 + 2] = wz;
              this.metabolismPointsCol[ptCount * 3] = rgb[0];
              this.metabolismPointsCol[ptCount * 3 + 1] = rgb[1];
              this.metabolismPointsCol[ptCount * 3 + 2] = rgb[2];
              ptCount++;
            }
          }
        }
        const pAttr = this.metabolismFieldPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
        const cAttr = this.metabolismFieldPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
        pAttr.needsUpdate = true;
        cAttr.needsUpdate = true;
        this.metabolismFieldPoints.geometry.setDrawRange(0, ptCount);
      }
    }

    if (this.fvmFluxVisual) {
      const showFlux =
        this.hasWorld &&
        Boolean(this.config.showFvmFluxVectors ?? true) &&
        (isMetab || this.metabolismUiOpen);
      this.fvmFluxVisual.update(
        view,
        this.planet.baseRadius,
        this.simTimeSec,
        showFlux,
      );
    }

    if (this.fvmVoxelBlocksVisual) {
      const showBlocks =
        this.hasWorld &&
        Boolean(this.config.showFvmVoxelBlocks ?? true) &&
        (isMetab || this.metabolismUiOpen);
      this.fvmVoxelBlocksVisual.update(
        view,
        this.planet.baseRadius,
        channel,
        showBlocks,
      );
    }

    this.lastMetabolismVisualRevision = curRev;
    this.lastMetabolismVisualOverlay = overlay;
    this.lastMetabolismVisualChannel = channel;
  }

  private rebuildTerrainMaterialBindings(): void {
    if (!this.renderer || !this.hasWorld) return;
    const oldMat = this.terrainMaterial;
    this.terrainMaterial = this.createTerrainMaterial();
    this.highResGlobeMaterial = this.terrainMaterial;
    this.highResHemiMaterial = this.terrainMaterial;
    this.highResMidOuterMaterial = this.terrainMaterial;
    this.highResMidMaterial = this.terrainMaterial;
    this.highResNativeMaterial = this.terrainMaterial;
    for (const m of this.chunkMeshes) {
      if (m) m.material = this.terrainMaterial;
    }
    for (const m of this.highResMeshes.values()) {
      m.material = this.terrainMaterial;
    }
    oldMat?.dispose();
  }

  private applyMetabolismThermalHotspots(metabHotspots: ThermalHotspot[]): void {
    // Replace only 'metabolism'-tagged persistent hotspots while preserving brush/meteor/volcano event hotspots
    for (let i = this.thermalHotspots.length - 1; i >= 0; i--) {
      if (this.thermalHotspots[i].source === 'metabolism') {
        this.thermalHotspots.splice(i, 1);
      }
    }
    for (const h of metabHotspots) {
      if (this.thermalHotspots.length >= 24) {
        const idx = this.thermalHotspots.findIndex((item) => item.source !== 'metabolism');
        if (idx >= 0) this.thermalHotspots.splice(idx, 1);
        else break;
      }
      this.thermalHotspots.push(h);
    }

    // Update GPU shader hotspot uniforms (top 4 hotspots) so 3D thermal overlay reflects reaction exotherms live
    const posUniforms = [
      this.metabHotspotPos0,
      this.metabHotspotPos1,
      this.metabHotspotPos2,
      this.metabHotspotPos3,
    ];
    const deltas = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const h = metabHotspots[i];
      if (h) {
        posUniforms[i].value.set(h.x, h.y, h.z, Math.max(0.1, h.radius));
        deltas[i] = h.deltaC;
      } else {
        posUniforms[i].value.set(0, 0, 0, 1);
        deltas[i] = 0;
      }
    }
    this.metabHotspotDeltaC.value.set(deltas[0], deltas[1], deltas[2], deltas[3]);
  }

  private applyMetabolismMineralOp(op: GeologicalTerrainOp): void {
    this.planet.applyBrush(
      op.wx,
      op.wy,
      op.wz,
      op.mode,
      op.radius,
      op.strength,
      op.material,
      {
        ex: op.ex,
        ey: op.ey,
        ez: op.ez,
        shape: op.shape,
        rimMaterial: op.rimMaterial ?? op.material,
        jaggedNoise: op.jaggedNoise,
      },
    );

    const len = Math.hypot(op.wx, op.wy, op.wz) || 1;
    const nx = op.wx / len;
    const ny = op.wy / len;
    const nz = op.wz / len;

    if (op.mode === 'volcano') {
      this.spawnMagmaBurst(
        op.wx + nx * op.radius * 0.4,
        op.wy + ny * op.radius * 0.4,
        op.wz + nz * op.radius * 0.4,
        nx,
        ny,
        nz,
        6,
        op.radius * 0.28,
        1.15,
        false,
      );
      this.spawnDebrisBurst(op.wx, op.wy, op.wz, nx, ny, nz, 8);
    } else if (op.mode === 'quake') {
      this.spawnShockwave(op.wx, op.wy, op.wz, nx, ny, nz, op.radius * 2.1, false, false);
      this.spawnDebrisBurst(op.wx, op.wy, op.wz, nx, ny, nz, 6);
    }

    this.updateChunksWithLod(28);
    this.waterMeshDirty = true;
  }

  private applyMetabolismFluidOp(fop: GeologicalFluidOp): void {
    const scale = this.getPlanetScale();
    if (fop.kind === 'spawn_rain') {
      const len = Math.hypot(fop.wx, fop.wy, fop.wz) || 1;
      this.fluid.emitStream(
        fop.wx,
        fop.wy,
        fop.wz,
        -fop.wx / len,
        -fop.wy / len,
        -fop.wz / len,
        clamp(Math.round(fop.count), 1, 32),
        fop.radius,
        scale,
      );
      this.waterMeshDirty = true;
    } else {
      const drained = this.fluid.drainWithinRadius(fop.wx, fop.wy, fop.wz, fop.radius);
      if (drained > 0) this.waterMeshDirty = true;
    }
  }

  public setMetabolismGeologicalConfig(partial: Partial<GeologicalEvolutionConfig>): void {
    this.metabolism.setGeologicalEvolutionConfig(partial);
    this.emitTelemetrySnapshot();
  }

  public triggerGeologicalEvent(kind: 'volcano' | 'quake' | 'uplift' | 'erosion'): void {
    if (!this.hasWorld) return;
    this.metabolism.triggerGeologicalEvent(
      kind,
      this.planet,
      undefined,
      (op) => this.applyMetabolismMineralOp(op),
      (fop) => this.applyMetabolismFluidOp(fop),
      (hs) => this.applyMetabolismThermalHotspots(hs),
    );
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
  }

  public runDeepTimeGeologicalEpoch(deltaMyr = 10): void {
    if (!this.hasWorld) return;
    this.metabolism.runDeepTimeEpoch(
      deltaMyr,
      this.planet,
      (op) => this.applyMetabolismMineralOp(op),
      (fop) => this.applyMetabolismFluidOp(fop),
      (hs) => this.applyMetabolismThermalHotspots(hs),
    );
    this.updateChunksWithLod(48);
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
  }

  public togglePlanetInteriorCutaway(): boolean {
    if (!this.hasWorld) return false;
    const next = !this.planet.isInteriorCutawayEnabled();
    this.planet.setInteriorCutaway(next);
    this.cutawayActiveNode.value = next ? 1.0 : 0.0;
    this.syncOceanSeaMeshScale();
    this.updateChunksWithLod(64);
    this.waterMeshDirty = true;
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
    return next;
  }

  public getMetabolismSnapshot(): MetabolismSummarySnapshot {
    return this.metabolism.getSummarySnapshot();
  }

  public setMetabolismMode(mode: MetabolismDemoMode): void {
    this.metabolism.resetDemo(mode);
    this.planet.fvmGrid = this.metabolism.grid;
    this.applyMetabolismThermalHotspots([]);
    this.syncCouplingZoneLines();
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
  }

  public setMetabolismBackend(
    cellsPerAxis: FvmResolutionCells,
    backend: FvmComputeBackendKind,
  ): void {
    const webGpuOk =
      this.backendDiagnostic.backend === 'WebGPU' &&
      !this.isSoftware &&
      !this.backendDiagnostic.isSoftwareRenderer;
    const { changedShaderBinding } = this.metabolism.configureComputeBackend(
      webGpuOk,
      cellsPerAxis,
      backend,
      this.renderer,
    );
    if (changedShaderBinding) {
      this.rebuildTerrainMaterialBindings();
    }
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
  }

  public setMetabolismRunning(running: boolean): void {
    this.metabolism.running = running;
    this.emitTelemetrySnapshot();
  }

  public stepMetabolismOnce(): void {
    this.metabolism.stepOnce(this.metabolism.fixedDtSec);
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
  }

  public setMetabolismParams(params: {
    feedRatePerSec?: number;
    exhaustRatePerSec?: number;
    ambientTempK?: number;
    timeScale?: number;
  }): void {
    if (params.feedRatePerSec !== undefined) {
      this.metabolism.grid.feedRatePerSec = Math.max(0, params.feedRatePerSec);
    }
    if (params.exhaustRatePerSec !== undefined) {
      this.metabolism.grid.exhaustRatePerSec = Math.max(0, params.exhaustRatePerSec);
    }
    if (params.ambientTempK !== undefined) {
      const targetT = clamp(params.ambientTempK, 140, 2200);
      this.metabolism.grid.ambientTempK = targetT;
      this.metabolism.grid.temperatureK.fill(targetT);
      this.metabolism.grid.syncInternalEnergyFromTemp();
      this.metabolism.grid.revision++;
      this.metabolism.grid.publishRenderSnapshot();
    }
    if (params.timeScale !== undefined) {
      this.metabolism.timeScale = clamp(params.timeScale, 0.1, 8.0);
    }
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
  }

  public setMetabolismAutoCalibrate(enabled: boolean): void {
    this.metabolism.autoCalibrateEnabled = enabled;
    this.emitTelemetrySnapshot();
  }

  public setMetabolismFeedbackConfig(partial: Partial<PlanetaryFeedbackConfig>): void {
    this.metabolism.feedbackConfig = {
      ...this.metabolism.feedbackConfig,
      ...partial,
    };
    if (!this.metabolism.feedbackConfig.thermalFeedbackEnabled) {
      this.applyMetabolismThermalHotspots([]);
    }
    this.emitTelemetrySnapshot();
  }

  public runMetabolismMicroCalibration(zoneId?: string): MicroCalibrationRecord | null {
    const rec = this.metabolism.runMicroCalibration(zoneId);
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
    return rec;
  }

  public injectMetabolismPerturbation(
    speciesIndex = 1,
    amountMolM3 = 1.6,
  ): void {
    const r0 = this.planet.baseRadius;
    this.metabolism.injectPerturbation(0, r0 * 0.96, 0, speciesIndex, amountMolM3);
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
  }

  public injectMetabolismNutrientBurst(): number {
    const touched = this.metabolism.injectCellularNutrientBurst();
    this.syncMetabolismReadOnlyVisuals(true);
    this.emitTelemetrySnapshot();
    return touched;
  }

  public setMetabolismUiOpen(open: boolean): void {
    this.metabolismUiOpen = open;
    this.syncCouplingZoneLines();
    this.syncMetabolismReadOnlyVisuals(true);
    if (this.hasWorld && this.renderer) {
      this.emitTelemetrySnapshot();
    }
  }

  public lockHoveredMetabolismVox(): boolean {
    const pos = this.lastHoveredWorldPos ?? this.metabolism.getPrimaryProtocellZoneCenter();
    this.lockedVoxWorldPos = [pos[0], pos[1], pos[2]];
    if (this.hasWorld && this.renderer) {
      this.emitTelemetrySnapshot();
    }
    return true;
  }

  public unlockMetabolismVox(): void {
    this.lockedVoxWorldPos = null;
    this.lockedVoxVisual?.update(null, 0, false);
    if (this.hasWorld && this.renderer) {
      this.emitTelemetrySnapshot();
    }
  }

  public toggleMetabolismVoxLock(): boolean {
    if (this.lockedVoxWorldPos) {
      this.unlockMetabolismVox();
      return false;
    }
    return this.lockHoveredMetabolismVox();
  }

  public focusCameraOnProtocellZone(): void {
    if (!this.hasWorld) return;
    const [zx, zy, zz] = this.metabolism.getPrimaryProtocellZoneCenter();
    this.updateConfig({
      cameraMode: 'perspective',
      showCouplingZones: true,
      showProtocell3d: true,
    });
    this.perspTarget.set(zx, zy, zz);
    this.perspDist = Math.max(2.6, this.planet.baseRadius * 0.44);
    this.perspYaw = 0.65;
    this.perspPitch = 0.42;
    this.emitTelemetrySnapshot();
  }

  public runMetabolismBifurcationSweep(): BifurcationSweepReport {
    const report = this.metabolism.runAutocatalyticBifurcationSweep();
    this.emitTelemetrySnapshot();
    return report;
  }

  public testMetabolismPicHook(zoneId?: string): LagrangianBoundaryState | null {
    const res = this.metabolism.testPicCouplingInterface(zoneId);
    this.emitTelemetrySnapshot();
    return res;
  }

  private setupCoordGridOverlay(): void {
    this.coordGridGroup = new THREE.Group();
    this.coordGridGroup.visible = this.config.showCoordGrid;
    this.scene.add(this.coordGridGroup);
    this.rebuildCoordGridOverlay();
  }

  private rebuildCoordGridOverlay(): void {
    if (!this.coordGridGroup) return;
    const baseR = this.planet.baseRadius;
    if (Math.abs(this.coordGridBuiltRadius - baseR) < 1e-4 && this.coordGridGroup.children.length > 0) {
      return;
    }
    this.coordGridBuiltRadius = baseR;

    while (this.coordGridGroup.children.length > 0) {
      const child = this.coordGridGroup.children.pop() as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material;
      };
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }

    const rGrid = baseR * 1.18 + Math.max(0.25, this.planet.voxelSize * 0.8);
    const verts: number[] = [];
    const cols: number[] = [];

    const pushSeg = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      cr: number,
      cg: number,
      cb: number,
    ) => {
      verts.push(ax, ay, az, bx, by, bz);
      cols.push(cr, cg, cb, cr, cg, cb);
    };

    const segs = 96;
    // Latitude parallels every 30° (-60..+60)
    for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
      const lat = (latDeg * Math.PI) / 180;
      const cosL = Math.cos(lat);
      const y = rGrid * Math.sin(lat);
      const isEq = latDeg === 0;
      const cr = isEq ? 0.16 : 0.24;
      const cg = isEq ? 0.92 : 0.62;
      const cb = isEq ? 0.72 : 0.88;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        pushSeg(
          rGrid * cosL * Math.cos(a0),
          y,
          rGrid * cosL * Math.sin(a0),
          rGrid * cosL * Math.cos(a1),
          y,
          rGrid * cosL * Math.sin(a1),
          cr,
          cg,
          cb,
        );
      }
    }

    // Meridians every 30° (0..330)
    for (let lonDeg = 0; lonDeg < 180; lonDeg += 30) {
      const lon = (lonDeg * Math.PI) / 180;
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);
      const isPrime = lonDeg === 0;
      const cr = isPrime ? 0.98 : 0.22;
      const cg = isPrime ? 0.78 : 0.56;
      const cb = isPrime ? 0.22 : 0.84;
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * Math.PI * 2;
        const t1 = ((i + 1) / segs) * Math.PI * 2;
        pushSeg(
          rGrid * Math.cos(t0) * cosLon,
          rGrid * Math.sin(t0),
          rGrid * Math.cos(t0) * sinLon,
          rGrid * Math.cos(t1) * cosLon,
          rGrid * Math.sin(t1),
          rGrid * Math.cos(t1) * sinLon,
          cr,
          cg,
          cb,
        );
      }
    }

    // ECEF Principal Axes (X Prime Meridian, Y North Pole, Z 90°E)
    const axisExt = rGrid * 1.24;
    pushSeg(-axisExt, 0, 0, axisExt, 0, 0, 0.96, 0.36, 0.36); // X
    pushSeg(0, -axisExt, 0, 0, axisExt, 0, 0.32, 0.92, 0.48); // Y
    pushSeg(0, 0, -axisExt, 0, 0, axisExt, 0.32, 0.68, 0.98); // Z

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.LineBasicNodeMaterial();
    mat.vertexColors = true;
    mat.colorNode = vertexColor();
    mat.opacityNode = float(0.45);
    mat.transparent = true;

    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    this.coordGridGroup.add(lines);
  }

  private setupSurveyOverlayGroup(): void {
    this.surveyOverlayGroup = new THREE.Group();
    this.scene.add(this.surveyOverlayGroup);
  }

  private setupDirectorGizmoGroup(): void {
    this.directorGizmoGroup = new THREE.Group();
    this.directorGizmoGroup.visible = false;
    this.scene.add(this.directorGizmoGroup);
  }

  public updateDirectorGizmoOverlay(
    project: DirectorTimelineProject | null,
    anchor: DirectorSceneAnchor | null,
    visible: boolean,
  ): void {
    if (!this.directorGizmoGroup) return;
    while (this.directorGizmoGroup.children.length > 0) {
      const child = this.directorGizmoGroup.children.pop() as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material;
      };
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    this.directorGizmoGroup.visible = visible && Boolean(project && anchor);
    if (!visible || !project || !anchor) return;

    const scale = this.getPlanetScale();
    const dur = Math.max(0.25, project.durationSec);

    // 1. 3D Spline Camera Trajectory
    if (project.cameraTrack.length >= 2) {
      const steps = Math.max(24, Math.min(120, project.cameraTrack.length * 14));
      const pts: number[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * dur;
        const pose = evaluateCameraTrackPose(project.cameraTrack, t, anchor);
        pts.push(pose.position[0], pose.position[1], pose.position[2]);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.frustumCulled = false;
      this.directorGizmoGroup.add(line);

      // Camera keyframe frustum markers
      for (const kf of project.cameraTrack) {
        const coneGeo = new THREE.ConeGeometry(0.28 * scale, 0.56 * scale, 4);
        const coneMat = new THREE.MeshBasicMaterial({
          color: 0x06b6d4,
          wireframe: true,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(kf.position[0], kf.position[1], kf.position[2]);
        cone.lookAt(kf.lookAt[0], kf.lookAt[1], kf.lookAt[2]);
        cone.rotateX(-Math.PI / 2);
        this.directorGizmoGroup.add(cone);
      }
    }

    // 2. Planetary Event Pins anchored on spherical surface (latDeg, lonDeg)
    for (const ev of project.eventTrack) {
      if (!ev.enabled) continue;
      const latRad = (clamp(ev.latDeg, -89.5, 89.5) * Math.PI) / 180;
      const lonRad = (ev.lonDeg * Math.PI) / 180;
      const [dx, dy, dz] = lonLatToDir(lonRad, latRad);
      const surfR = this.planet.findSurfaceRadiusAlongRay(dx, dy, dz);
      const liftR = surfR + Math.max(this.planet.nativeVoxelSize * 2, 0.55 * scale);
      const meta = WORLD_EVENT_META.find((m) => m.type === ev.type);
      const hex = meta?.colorHex ?? '#f43f5e';

      const stemGeo = new THREE.BufferGeometry();
      stemGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [dx * surfR, dy * surfR, dz * surfR, dx * liftR, dy * liftR, dz * liftR],
          3,
        ),
      );
      const stemMat = new THREE.LineBasicMaterial({ color: hex });
      const stem = new THREE.Line(stemGeo, stemMat);
      stem.frustumCulled = false;
      this.directorGizmoGroup.add(stem);

      const pinGeo = new THREE.OctahedronGeometry(0.24 * scale, 0);
      const pinMat = new THREE.MeshBasicMaterial({ color: hex });
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.set(dx * liftR, dy * liftR, dz * liftR);
      this.directorGizmoGroup.add(pin);
    }
  }

  public updateSurveyOverlays(
    benchmarks: ReadonlyArray<SurveyBenchmark>,
    transectSamples: ReadonlyArray<{ worldPos: [number, number, number] }>,
    pendingTransectA: [number, number, number] | null,
    activeBorehole: BoreholeLogReport | null,
    activeAttitude: GeologicalAttitude | null,
  ): void {
    if (!this.surveyOverlayGroup) return;
    while (this.surveyOverlayGroup.children.length > 0) {
      const child = this.surveyOverlayGroup.children.pop() as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material;
      };
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }

    const scale = this.getPlanetScale();
    const lift = Math.max(this.planet.nativeVoxelSize * 0.45, 0.05 * scale);
    const stemH = Math.max(this.planet.nativeVoxelSize * 2.5, 0.72 * scale);

    // 1. Survey Benchmark Pins (vertical mast + diamond cap)
    if (benchmarks.length > 0) {
      const segs: number[] = [];
      const cols: number[] = [];
      for (const b of benchmarks) {
        const [wx, wy, wz] = b.worldPos;
        const r = Math.hypot(wx, wy, wz) || this.planet.baseRadius;
        const ux = wx / r;
        const uy = wy / r;
        const uz = wz / r;
        const tx = wx + ux * stemH;
        const ty = wy + uy * stemH;
        const tz = wz + uz * stemH;
        segs.push(wx, wy, wz, tx, ty, tz);
        cols.push(0.22, 0.74, 0.97, 0.22, 0.96, 0.85);

        const capGeo = new THREE.OctahedronGeometry(0.16 * scale, 0);
        const capMat = new THREE.MeshBasicNodeMaterial();
        capMat.colorNode = color(0x38bdf8);
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(tx, ty, tz);
        this.surveyOverlayGroup.add(cap);
      }
      const pinGeo = new THREE.BufferGeometry();
      pinGeo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      pinGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const pinMat = new THREE.LineBasicNodeMaterial();
      pinMat.vertexColors = true;
      pinMat.colorNode = vertexColor();
      const pinLines = new THREE.LineSegments(pinGeo, pinMat);
      pinLines.frustumCulled = false;
      this.surveyOverlayGroup.add(pinLines);
    }

    // 2. Pending Transect Start Pin (Point A)
    if (pendingTransectA) {
      const [wx, wy, wz] = pendingTransectA;
      const r = Math.hypot(wx, wy, wz) || this.planet.baseRadius;
      const ringGeo = new THREE.SphereGeometry(0.18 * scale, 12, 12);
      const ringMat = new THREE.MeshBasicNodeMaterial();
      ringMat.colorNode = color(0x2dd4bf);
      const m = new THREE.Mesh(ringGeo, ringMat);
      m.position.set(wx + (wx / r) * lift * 2, wy + (wy / r) * lift * 2, wz + (wz / r) * lift * 2);
      this.surveyOverlayGroup.add(m);
    }

    // 3. Active Geodesic Transect Polyline
    if (transectSamples.length >= 2) {
      const pts: number[] = [];
      for (const s of transectSamples) {
        const [wx, wy, wz] = s.worldPos;
        const r = Math.hypot(wx, wy, wz) || this.planet.baseRadius;
        pts.push(wx + (wx / r) * lift, wy + (wy / r) * lift, wz + (wz / r) * lift);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const lineMat = new THREE.LineBasicNodeMaterial();
      lineMat.colorNode = color(0x2dd4bf);
      const line = new THREE.Line(lineGeo, lineMat);
      line.frustumCulled = false;
      this.surveyOverlayGroup.add(line);
    }

    // 4. Active Borehole Collar & Radial Core Line
    if (activeBorehole) {
      const [cx, cy, cz] = activeBorehole.collarPos;
      const r = Math.hypot(cx, cy, cz) || this.planet.baseRadius;
      const ux = cx / r;
      const uy = cy / r;
      const uz = cz / r;
      const topR = r + stemH * 1.1;
      const botR = Math.max(0.1, r - activeBorehole.drilledDepthM);
      const bGeo = new THREE.BufferGeometry();
      bGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [ux * topR, uy * topR, uz * topR, ux * botR, uy * botR, uz * botR],
          3,
        ),
      );
      const bMat = new THREE.LineBasicNodeMaterial();
      bMat.colorNode = color(0xc084fc);
      const bLine = new THREE.LineSegments(bGeo, bMat);
      bLine.frustumCulled = false;
      this.surveyOverlayGroup.add(bLine);

      const collarGeo = new THREE.CylinderGeometry(0.18 * scale, 0.18 * scale, 0.12 * scale, 16);
      const collarMat = new THREE.MeshBasicNodeMaterial();
      collarMat.colorNode = color(0xa855f7);
      const collarMesh = new THREE.Mesh(collarGeo, collarMat);
      collarMesh.position.set(cx + ux * lift, cy + uy * lift, cz + uz * lift);
      collarMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ux, uy, uz));
      this.surveyOverlayGroup.add(collarMesh);
    }

    // 5. Active Strike/Dip Clinometer Vector
    if (activeAttitude) {
      const [ax, ay, az] = activeAttitude.worldPos;
      const [nx, ny, nz] = activeAttitude.normal;
      const tipLen = stemH * 1.15;
      const attGeo = new THREE.BufferGeometry();
      attGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            ax + nx * lift,
            ay + ny * lift,
            az + nz * lift,
            ax + nx * (lift + tipLen),
            ay + ny * (lift + tipLen),
            az + nz * (lift + tipLen),
          ],
          3,
        ),
      );
      const attMat = new THREE.LineBasicNodeMaterial();
      attMat.colorNode = color(0xfbbf24);
      const attLine = new THREE.LineSegments(attGeo, attMat);
      attLine.frustumCulled = false;
      this.surveyOverlayGroup.add(attLine);
    }
  }

  private refreshChunkBoundsOverlay(): void {
    if (!this.chunkBoundsLines || !this.config.showChunkBounds) return;
    this.chunkBoundsDirty = false;
    const neededVerts = Math.max(1, this.activeChunks) * 24;
    if (this.chunkBoundsPos.length < neededVerts * 3) {
      this.chunkBoundsPos = new Float32Array(neededVerts * 3);
      this.chunkBoundsCol = new Float32Array(neededVerts * 3);
      this.chunkBoundsLines.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(this.chunkBoundsPos, 3),
      );
      this.chunkBoundsLines.geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(this.chunkBoundsCol, 3),
      );
    }
    const chunkWorldSize = CHUNK_CELLS * this.planet.voxelSize;
    const n = this.planet.chunksPerAxis;
    let v = 0;

    // LOD colors: LOD0 green, LOD1 sky blue, LOD2 amber
    const lodColors: Record<number, [number, number, number]> = {
      0: [0.2, 0.9, 0.5],
      1: [0.22, 0.74, 0.97],
      2: [0.98, 0.72, 0.2],
    };

    for (let cz = 0; cz < n; cz++) {
      const z0 = this.planet.gridToWorld(cz * CHUNK_CELLS);
      for (let cy = 0; cy < n; cy++) {
        const y0 = this.planet.gridToWorld(cy * CHUNK_CELLS);
        for (let cx = 0; cx < n; cx++) {
          const ci = this.planet.chunkIndex(cx, cy, cz);
          const mesh = this.chunkMeshes[ci];
          const lod = this.chunkLod[ci];
          if (!mesh || lod < 0) continue;

          const x0 = this.planet.gridToWorld(cx * CHUNK_CELLS);
          const col = lodColors[lod] ?? [0.6, 0.7, 0.8];

          for (let e = 0; e < BOX_EDGES.length; e++) {
            const [ax, ay, az, bx, by, bz] = BOX_EDGES[e];
            const p0 = v * 3;
            this.chunkBoundsPos[p0] = x0 + ax * chunkWorldSize;
            this.chunkBoundsPos[p0 + 1] = y0 + ay * chunkWorldSize;
            this.chunkBoundsPos[p0 + 2] = z0 + az * chunkWorldSize;
            this.chunkBoundsCol[p0] = col[0];
            this.chunkBoundsCol[p0 + 1] = col[1];
            this.chunkBoundsCol[p0 + 2] = col[2];
            v++;

            const p1 = v * 3;
            this.chunkBoundsPos[p1] = x0 + bx * chunkWorldSize;
            this.chunkBoundsPos[p1 + 1] = y0 + by * chunkWorldSize;
            this.chunkBoundsPos[p1 + 2] = z0 + bz * chunkWorldSize;
            this.chunkBoundsCol[p1] = col[0];
            this.chunkBoundsCol[p1 + 1] = col[1];
            this.chunkBoundsCol[p1 + 2] = col[2];
            v++;
          }
        }
      }
    }

    const posAttr = this.chunkBoundsLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.chunkBoundsLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.chunkBoundsLines.geometry.setDrawRange(0, v);
  }

  private desiredLodForChunk(ci: number): ChunkLodLevel {
    if (this.config.lodMode !== 'auto') {
      return this.config.lodMode;
    }
    const cx = this.chunkCenters[ci * 3];
    const cy = this.chunkCenters[ci * 3 + 1];
    const cz = this.chunkCenters[ci * 3 + 2];
    const dx = this.camera.position.x - cx;
    const dy = this.camera.position.y - cy;
    const dz = this.camera.position.z - cz;
    const dist = Math.hypot(dx, dy, dz);

    const prev = this.chunkLod[ci];
    const h = 1.4 * this.getPlanetScale(); // scale-invariant hysteresis
    const t0 = prev === 0 ? this.config.lod0Dist + h : this.config.lod0Dist;
    const t1 = prev === 2 ? this.config.lod1Dist - h : this.config.lod1Dist;

    if (dist < t0) return 0;
    if (dist < t1) return 1;
    return 2;
  }

  private clearHighResMeshes(): void {
    if (this.highResMeshes.size > 0) {
      for (const mesh of this.highResMeshes.values()) {
        this.highResGroup?.remove(mesh);
        mesh.geometry.dispose();
      }
      this.highResMeshes.clear();
    }
    this.highResVertices = 0;
    this.highResActiveCount = 0;
    this.lastHighResHideMacro = false;
    this.highResStreamDirty = true;
    this.lastStreamPendingTotal = 1;
    for (const m of this.chunkMeshes) {
      if (m) m.visible = true;
    }
    for (const c of this.planet.sparseChunks.values()) {
      c.dirty = true;
      c.lastSeamMask = -1;
    }
  }

  private updateHighResStreaming(
    hoveredHit: ReturnType<VoxelPlanet['raycastTerrain']> | null,
    budget = 28,
    explicitOverride?: {
      focus: readonly [number, number, number];
      dist: number;
      lodModeOverride?: LodMode;
    },
    timeBudgetMs = Number.POSITIVE_INFINITY,
  ): HighResStreamBatch | null {
    void hoveredHit;
    if (!this.planet.isHighResStreaming || !this.highResGroup) {
      if (this.highResMeshes.size > 0) {
        this.clearHighResMeshes();
      }
      return null;
    }

    // Anchor streaming focus to the active camera target / surface region
    let fx = 0;
    let fy = 1;
    let fz = 0;
    let useExplicitFocus = false;
    let effectiveCamDistOverride: number | null = null;

    if (explicitOverride) {
      this.lastHighResFocus.set(
        explicitOverride.focus[0],
        explicitOverride.focus[1],
        explicitOverride.focus[2],
      );
      useExplicitFocus = true;
      effectiveCamDistOverride = explicitOverride.dist;
    } else if (this.config.cameraMode === 'explorer' && (this.phase === 'playing' || this.isGenerating)) {
      const pLen = this.playerPos.length();
      if (pLen > 1e-4) {
        fx = this.playerPos.x / pLen;
        fy = this.playerPos.y / pLen;
        fz = this.playerPos.z / pLen;
      }
    } else if (this.config.cameraMode === 'firstPerson' && (this.phase === 'playing' || this.isGenerating)) {
      if (this.camera) {
        this.camera.getWorldDirection(this._v1);
        const fpHit = this.planet.raycastTerrain(
          this.camera.position.x,
          this.camera.position.y,
          this.camera.position.z,
          this._v1.x,
          this._v1.y,
          this._v1.z,
          this.planet.worldHalf * 3.0,
        );
        if (fpHit.hit) {
          this.lastHighResFocus.set(fpHit.x, fpHit.y, fpHit.z);
          useExplicitFocus = true;
        }
      }
      if (!useExplicitFocus) {
        const pLen = this.playerPos.length();
        if (pLen > 1e-4) {
          fx = this.playerPos.x / pLen;
          fy = this.playerPos.y / pLen;
          fz = this.playerPos.z / pLen;
        }
      }
    } else if (this.config.cameraMode === 'orbit' && (this.phase === 'playing' || this.isGenerating)) {
      const cosP = Math.cos(this.orbitPitch);
      fx = cosP * Math.cos(this.orbitYaw);
      fy = Math.sin(this.orbitPitch);
      fz = cosP * Math.sin(this.orbitYaw);
    } else if (this.config.cameraMode === 'detail' && (this.phase === 'playing' || this.isGenerating)) {
      this.lastHighResFocus.copy(this.detailTarget);
      useExplicitFocus = true;
      effectiveCamDistOverride = this.detailOptics.effectiveStreamDist;
    } else if (this.config.cameraMode === 'landing' && (this.phase === 'playing' || this.isGenerating)) {
      if (this.landingStage === 'descending') {
        this.lastHighResFocus.copy(this.landingSite);
        useExplicitFocus = true;
      } else if (this.landingStage === 'landed') {
        if (this.camera) {
          this.camera.getWorldDirection(this._v1);
          const lHit = this.planet.raycastTerrain(
            this.camera.position.x,
            this.camera.position.y,
            this.camera.position.z,
            this._v1.x,
            this._v1.y,
            this._v1.z,
            this.planet.worldHalf * 3.0,
          );
          if (lHit.hit) {
            this.lastHighResFocus.set(lHit.x, lHit.y, lHit.z);
            useExplicitFocus = true;
          }
        }
        if (!useExplicitFocus) {
          const lLen = this.landingPos.length();
          if (lLen > 1e-4) {
            fx = this.landingPos.x / lLen;
            fy = this.landingPos.y / lLen;
            fz = this.landingPos.z / lLen;
          }
        }
      } else if (this.landingHasHover) {
        this.lastHighResFocus.copy(this.landingHoverPos);
        useExplicitFocus = true;
      } else {
        const cosP = Math.cos(this.landingOrbitPitch);
        fx = cosP * Math.cos(this.landingOrbitYaw);
        fy = Math.sin(this.landingOrbitPitch);
        fz = cosP * Math.sin(this.landingOrbitYaw);
      }
    } else if (this.config.cameraMode === 'perspective' && (this.phase === 'playing' || this.isGenerating)) {
      const tLen = this.perspTarget.length();
      if (tLen > this.planet.baseRadius * 0.25) {
        fx = this.perspTarget.x / tLen;
        fy = this.perspTarget.y / tLen;
        fz = this.perspTarget.z / tLen;
      } else if (this.camera) {
        this._v1.copy(this.camera.position).sub(this.perspTarget);
        const dLen = this._v1.length();
        if (dLen > 1e-4) {
          fx = this._v1.x / dLen;
          fy = this._v1.y / dLen;
          fz = this._v1.z / dLen;
        }
      }
    } else if (this.config.cameraMode === 'fps' && (this.phase === 'playing' || this.isGenerating)) {
      if (this.camera) {
        this.camera.getWorldDirection(this._v1);
        const fpsHit = this.planet.raycastTerrain(
          this.fpsPos.x,
          this.fpsPos.y,
          this.fpsPos.z,
          this._v1.x,
          this._v1.y,
          this._v1.z,
          this.planet.worldHalf * 4.5,
        );
        if (fpsHit.hit) {
          this.lastHighResFocus.set(fpsHit.x, fpsHit.y, fpsHit.z);
          useExplicitFocus = true;
        }
      }
      if (!useExplicitFocus) {
        const fLen = this.fpsPos.length();
        if (fLen > 1e-4) {
          fx = this.fpsPos.x / fLen;
          fy = this.fpsPos.y / fLen;
          fz = this.fpsPos.z / fLen;
        }
      }
    } else if (this.camera) {
      const cLen = this.camera.position.length();
      if (cLen > 1e-4) {
        fx = this.camera.position.x / cLen;
        fy = this.camera.position.y / cLen;
        fz = this.camera.position.z / cLen;
      }
    }

    if (!useExplicitFocus) {
      const surfR = this.planet.findSurfaceRadiusAlongRay(fx, fy, fz);
      this.lastHighResFocus.set(fx * surfR, fy * surfR, fz * surfR);
    }

    let camPosArr: [number, number, number] | undefined;
    let camFwdArr: [number, number, number] | undefined;
    if (this.camera) {
      camPosArr = [this.camera.position.x, this.camera.position.y, this.camera.position.z];
      this.camera.getWorldDirection(this._v1);
      camFwdArr = [this._v1.x, this._v1.y, this._v1.z];
    }

    const camDistToFocus =
      effectiveCamDistOverride !== null
        ? effectiveCamDistOverride
        : this.camera
          ? this.camera.position.distanceTo(this.lastHighResFocus)
          : this.planet.baseRadius * 2.0;

    const activeLodMode = explicitOverride?.lodModeOverride ?? this.config.lodMode;
    const posMoveTol = Math.max(this.planet.nativeVoxelSize * 0.5, camDistToFocus * 0.008);
    const focusMoveTol = Math.max(this.planet.nativeVoxelSize * 0.5, camDistToFocus * 0.01);
    const canIdleSkip =
      !this.highResStreamDirty &&
      this.lastStreamPendingTotal === 0 &&
      this.highResMeshes.size > 0 &&
      this.lastStreamLodMode === activeLodMode &&
      this.lastStreamLod0Dist === this.config.lod0Dist &&
      this.lastStreamRenderMode === this.config.terrainRenderMode &&
      this.lastStreamVoxelRevision === this.planet.voxelRevision &&
      this.lastStreamOverrideActive === Boolean(explicitOverride) &&
      this.lastStreamFocusCheck.distanceTo(this.lastHighResFocus) <= focusMoveTol &&
      (!camPosArr ||
        this._v2.set(camPosArr[0], camPosArr[1], camPosArr[2]).distanceTo(this.lastStreamCamPos) <=
          posMoveTol) &&
      (!camFwdArr ||
        this._v3.set(camFwdArr[0], camFwdArr[1], camFwdArr[2]).dot(this.lastStreamCamFwd) >=
          0.9985);
    if (canIdleSkip) {
      return null;
    }

    const batch = this.planet.streamHighResAround(
      this.lastHighResFocus.x,
      this.lastHighResFocus.y,
      this.lastHighResFocus.z,
      this.config.terrainRenderMode,
      budget,
      camDistToFocus,
      camPosArr,
      camFwdArr,
      {
        lodMode: activeLodMode,
        lod0Dist: this.config.lod0Dist,
        timeBudgetMs,
        distantHorizon: true,
      },
    );

    if (!batch.active) {
      if (this.highResMeshes.size > 0) this.clearHighResMeshes();
      return batch;
    }
    this.highResStreamDirty = false;
    this.lastStreamPendingTotal = batch.pendingTotal;
    this.lastHighResHideMacro = batch.hideMacro;
    this.lastStreamFocusCheck.copy(this.lastHighResFocus);
    if (camPosArr) this.lastStreamCamPos.set(camPosArr[0], camPosArr[1], camPosArr[2]);
    if (camFwdArr) this.lastStreamCamFwd.set(camFwdArr[0], camFwdArr[1], camFwdArr[2]);
    this.lastStreamLodMode = activeLodMode;
    this.lastStreamLod0Dist = this.config.lod0Dist;
    this.lastStreamRenderMode = this.config.terrainRenderMode;
    this.lastStreamVoxelRevision = this.planet.voxelRevision;
    this.lastStreamOverrideActive = Boolean(explicitOverride);

    // Evict only GPU meshes outside retainKeys so standby parent/child meshes stay cached for instant atomic swaps
    for (const [key, mesh] of this.highResMeshes.entries()) {
      if (!batch.retainKeys.has(key)) {
        this.highResGroup.remove(mesh);
        mesh.geometry.dispose();
        this.highResMeshes.delete(key);
      }
    }

    const scale = this.getPlanetScale();
    for (const item of batch.rebuiltMeshes) {
      const existing = this.highResMeshes.get(item.key);
      if (item.mesh.vertexCount === 0) {
        if (existing) {
          this.highResGroup.remove(existing);
          existing.geometry.dispose();
          this.highResMeshes.delete(item.key);
        }
        continue;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(item.mesh.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(item.mesh.normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(item.mesh.colors, 3));
      geo.setAttribute('aMatProps', new THREE.BufferAttribute(item.mesh.matProps, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(item.mesh.uvs, 2));
      geo.computeBoundingSphere();

      const targetMat =
        item.tier === 'native'
          ? this.highResNativeMaterial
          : item.tier === 'mid'
            ? this.highResMidMaterial
            : item.tier === 'midOuter'
              ? this.highResMidOuterMaterial
              : item.tier === 'hemi'
                ? this.highResHemiMaterial
                : this.highResGlobeMaterial;

      const ox = item.mesh.origin ? item.mesh.origin[0] : 0;
      const oy = item.mesh.origin ? item.mesh.origin[1] : 0;
      const oz = item.mesh.origin ? item.mesh.origin[2] : 0;
      const voxelSpan = this.planet.nativeVoxelSize * item.scaleMult;
      const shouldCastShadow =
        item.tier === 'globe' || item.tier === 'hemi' || voxelSpan >= 0.04 * scale;

      if (existing) {
        existing.geometry.dispose();
        existing.geometry = geo;
        existing.material = targetMat;
        existing.position.set(ox, oy, oz);
        existing.castShadow = shouldCastShadow;
        existing.userData.baseColors = undefined;
        if (this.config.terrainOverlay === 'metabolism') {
          this.applyFvmColorsToMesh(existing, true, this.config.metabolismChannel ?? 'species');
        }
      } else {
        const mesh = new THREE.Mesh(geo, targetMat);
        mesh.position.set(ox, oy, oz);
        mesh.castShadow = shouldCastShadow;
        mesh.receiveShadow = true;
        if (this.config.terrainOverlay === 'metabolism') {
          this.applyFvmColorsToMesh(mesh, true, this.config.metabolismChannel ?? 'species');
        }
        this.highResGroup.add(mesh);
        this.highResMeshes.set(item.key, mesh);
      }
    }

    const showMacro = !batch.hideMacro;
    for (const m of this.chunkMeshes) {
      if (m) m.visible = showMacro;
    }

    let verts = 0;
    let activeVis = 0;
    let svoC0 = 0;
    let svoC1 = 0;
    let svoC2 = 0;
    for (const [key, mesh] of this.highResMeshes.entries()) {
      const vis = batch.desiredKeys.has(key);
      mesh.visible = vis;
      if (vis) {
        verts += mesh.geometry.getAttribute('position').count;
        activeVis++;
        const ch = this.planet.sparseChunks.get(key);
        const sm = ch ? ch.scaleMult : 1;
        if (sm <= 1) svoC0++;
        else if (sm <= 2) svoC1++;
        else svoC2++;
      }
    }
    this.highResVertices = verts;
    this.highResActiveCount = activeVis;
    this.lodCounts = [
      svoC0,
      svoC1,
      svoC2,
      Math.max(0, this.planet.sparseChunks.size - activeVis),
    ];
    return batch;
  }

  private setPlanetRigVisible(visible: boolean): void {
    if (this.atmoMesh) this.atmoMesh.visible = visible;
    if (this.atmoInnerMesh) this.atmoInnerMesh.visible = visible;
    if (this.cloudShellMesh) this.cloudShellMesh.visible = visible;
    if (this.cloudPuffsMesh) this.cloudPuffsMesh.visible = visible;
    if (this.waterMesh) this.waterMesh.visible = visible;
    if (this.oceanSeaMesh) {
      const hasSea = (this.planet.seedConfig.waterFill ?? 1.0) > 0.04;
      this.oceanSeaMesh.visible = visible && hasSea && !this.lastSeaHidden;
    }
    if (this.splashMesh) this.splashMesh.visible = visible;
    if (this.highResGroup) this.highResGroup.visible = visible;
    if (this.surveyOverlayGroup) this.surveyOverlayGroup.visible = visible;
    if (this.coordGridGroup) this.coordGridGroup.visible = visible && this.config.showCoordGrid;
    if (this.playerGroup) {
      this.playerGroup.visible = visible && this.phase !== 'title';
    }
    if (!visible) {
      for (const m of this.chunkMeshes) {
        if (m) m.visible = false;
      }
      if (this.brushPreview) this.brushPreview.visible = false;
      if (this.landingBeaconGroup) this.landingBeaconGroup.visible = false;
      if (this.detailReticleRing) this.detailReticleRing.visible = false;
      if (this.tractorBeamGroup) this.tractorBeamGroup.visible = false;
      if (this.tractorStretchLine) this.tractorStretchLine.visible = false;
      if (this.metabolismFieldPoints) this.metabolismFieldPoints.visible = false;
      if (this.couplingZoneLines) this.couplingZoneLines.visible = false;
      if (this.protocellVisual) this.protocellVisual.root.visible = false;
      if (this.fvmFluxVisual) this.fvmFluxVisual.lines.visible = false;
      if (this.hoveredVoxVisual) this.hoveredVoxVisual.lines.visible = false;
      if (this.lockedVoxVisual) this.lockedVoxVisual.lines.visible = false;
      if (this.fvmVoxelBlocksVisual) this.fvmVoxelBlocksVisual.mesh.visible = false;
    }
  }

  private rebuildAllChunks(): void {
    this.clearHighResMeshes();
    this.ensureMacroChunkCapacity();
    const total = this.planet.totalChunks;
    for (let i = 0; i < total; i++) {
      const existing = this.chunkMeshes[i];
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
        this.chunkMeshes[i] = null;
      }
    }
    this.chunkLod.fill(-1);
    for (let i = 0; i < total; i++) {
      this.planet.dirtyChunks[i] = this.planet.nonUniformChunks[i];
    }
    this.updateChunksWithLod(total);
    for (let pass = 0; pass < 36; pass++) {
      const b = this.updateHighResStreaming(null, 48);
      if (!b || b.pendingTotal === 0) break;
    }
  }

  private updateChunksWithLod(budget = 14): number {
    const n = this.planet.chunksPerAxis;
    const total = this.planet.totalChunks;
    const nonUniform = this.planet.nonUniformChunks;
    const candidates: Array<{ ci: number; cx: number; cy: number; cz: number; lod: ChunkLodLevel; prio: number }> = [];

    for (let cz = 0; cz < n; cz++) {
      for (let cy = 0; cy < n; cy++) {
        for (let cx = 0; cx < n; cx++) {
          const ci = this.planet.chunkIndex(cx, cy, cz);
          const dirty = this.planet.dirtyChunks[ci] === 1;
          const hasMesh = this.chunkMeshes[ci] !== null;
          if (nonUniform[ci] === 0 && !dirty && !hasMesh) continue;
          const wantLod = this.desiredLodForChunk(ci);
          const curLod = this.chunkLod[ci];

          // Only rebuild LOD if dirty, or never built, or already has geometry (skip empty air/core chunks)
          if (dirty || curLod === -1 || (hasMesh && wantLod !== curLod)) {
            const dx = this.camera.position.x - this.chunkCenters[ci * 3];
            const dy = this.camera.position.y - this.chunkCenters[ci * 3 + 1];
            const dz = this.camera.position.z - this.chunkCenters[ci * 3 + 2];
            const distSq = dx * dx + dy * dy + dz * dz;
            // Prioritize dirty edits first, then closer chunks
            const prio = (dirty ? 0 : 1e6) + distSq;
            candidates.push({ ci, cx, cy, cz, lod: wantLod, prio });
          }
        }
      }
    }

    if (candidates.length === 0) return 0;
    if (candidates.length > budget) {
      candidates.sort((a, b) => a.prio - b.prio);
    }

    const limit = Math.min(budget, candidates.length);
    for (let i = 0; i < limit; i++) {
      const { ci, cx, cy, cz, lod } = candidates[i];
      this.planet.dirtyChunks[ci] = 0;
      this.chunkLod[ci] = lod;

      const data =
        this.config.terrainRenderMode === 'blocky'
          ? this.planet.extractBlockyChunkMesh(cx, cy, cz, lod)
          : this.planet.extractChunkMesh(cx, cy, cz, lod);
      const existing = this.chunkMeshes[ci];

      if (data.vertexCount === 0) {
        if (existing) {
          this.scene.remove(existing);
          existing.geometry.dispose();
          this.chunkMeshes[ci] = null;
        }
      } else {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
        geo.setAttribute('aMatProps', new THREE.BufferAttribute(data.matProps, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
        geo.computeBoundingSphere();

        if (existing) {
          existing.geometry.dispose();
          existing.geometry = geo;
          existing.userData.baseColors = undefined;
          if (this.config.terrainOverlay === 'metabolism') {
            this.applyFvmColorsToMesh(existing, true, this.config.metabolismChannel ?? 'species');
          }
        } else {
          const mesh = new THREE.Mesh(geo, this.terrainMaterial);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (this.config.terrainOverlay === 'metabolism') {
            this.applyFvmColorsToMesh(mesh, true, this.config.metabolismChannel ?? 'species');
          }
          this.scene.add(mesh);
          this.chunkMeshes[ci] = mesh;
        }
      }
    }

    // Recompute terrain vertex & LOD counts cleanly
    let verts = 0;
    let c0 = 0;
    let c1 = 0;
    let c2 = 0;
    let culled = 0;
    for (let i = 0; i < total; i++) {
      const m = this.chunkMeshes[i];
      if (!m) {
        culled++;
      } else {
        verts += m.geometry.getAttribute('position').count;
        const l = this.chunkLod[i];
        if (l === 0) c0++;
        else if (l === 1) c1++;
        else c2++;
      }
    }
    this.totalTerrainVertices = verts;
    this.lodCounts = [c0, c1, c2, culled];
    this.activeChunks = c0 + c1 + c2;
    this.chunkBoundsDirty = true;
    return limit;
  }

  private setupFluidMeshes(): void {
    const emptyGeo = new THREE.BufferGeometry();
    emptyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    emptyGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.waterMesh = new THREE.Mesh(emptyGeo, this.waterMaterial);
    this.waterMesh.receiveShadow = true;
    this.waterMesh.castShadow = false;
    this.waterMesh.frustumCulled = false;
    this.scene.add(this.waterMesh);

    const dropGeo = new THREE.IcosahedronGeometry(0.17, 1);
    const dropMat = new THREE.MeshPhysicalNodeMaterial();
    dropMat.colorNode = color(0x7dd3fc);
    dropMat.emissiveNode = color(0x0284c7).mul(0.25);
    dropMat.roughnessNode = float(0.12);
    dropMat.metalnessNode = float(0.05);
    dropMat.opacityNode = float(0.82);
    dropMat.transparent = true;

    const seaGeo = new THREE.IcosahedronGeometry(1, 5);
    this.oceanSeaMesh = new THREE.Mesh(seaGeo, this.oceanMaterial ?? this.waterMaterial);
    this.oceanSeaMesh.receiveShadow = true;
    this.oceanSeaMesh.castShadow = false;
    this.oceanSeaMesh.frustumCulled = false;
    this.scene.add(this.oceanSeaMesh);
    this.syncOceanSeaMeshScale();

    this.splashMesh = new THREE.InstancedMesh(dropGeo, dropMat, MAX_FLUID_PARTICLES);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.count = 0;
    this.scene.add(this.splashMesh);
  }

  private syncOceanSeaMeshScale(): void {
    this.cutawayActiveNode.value = this.planet.isInteriorCutawayEnabled() ? 1.0 : 0.0;
    if (!this.oceanSeaMesh) return;
    const waterFill = clamp(this.planet.seedConfig.waterFill ?? 1.0, 0, 2.5);
    if (waterFill <= 0.04 || this.lastSeaHidden) {
      this.oceanSeaMesh.visible = false;
      return;
    }
    const rScale = this.planet.baseRadius / 13.0;
    const geoSnap = this.metabolism.getSummarySnapshot().geologicalStats;
    const seaOffsetScaled = clamp(geoSnap.seaLevelOffsetM * 0.008, -1.8, 1.8) * rScale;
    const seaRadius = Math.max(
      0.5,
      this.planet.baseRadius - 0.14 * rScale + (waterFill - 1.0) * 0.38 * rScale + seaOffsetScaled,
    );
    if (Math.abs(seaRadius - this.lastSeaRadius) > 1e-4) {
      this.oceanSeaMesh.scale.setScalar(seaRadius);
      this.lastSeaRadius = seaRadius;
    }
    this.oceanSeaMesh.visible = this.hasWorld;
  }

  private rebuildWaterMesh(): void {
    const blocky = this.config.terrainRenderMode === 'blocky';
    const wData = this.fluid.extractWaterSurface(this.planet, blocky);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(wData.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(wData.normals, 3));
    geo.computeBoundingSphere();
    this.waterMesh.geometry.dispose();
    this.waterMesh.geometry = geo;
    this.syncOceanSeaMeshScale();
    this.waterMeshDirty = false;
  }

  private updateSplashInstances(): void {
    const count = Math.min(this.fluid.splashCount, MAX_FLUID_PARTICLES);
    this.splashMesh.count = count;
    const scale = this.getPlanetScale();
    const invSqrtScale = 1 / Math.sqrt(scale);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      this._v1.set(
        this.fluid.splashPositions[i3],
        this.fluid.splashPositions[i3 + 1],
        this.fluid.splashPositions[i3 + 2],
      );
      const spd = Math.hypot(
        this.fluid.splashVelocities[i3],
        this.fluid.splashVelocities[i3 + 1],
        this.fluid.splashVelocities[i3 + 2],
      ) * invSqrtScale;
      const sc = clamp(0.65 + spd * 0.14, 0.65, 1.35) * scale;
      this._s1.set(sc, sc, sc);
      this._q1.identity();
      this._m4.compose(this._v1, this._q1, this._s1);
      this.splashMesh.setMatrixAt(i, this._m4);
    }
    this.splashMesh.instanceMatrix.needsUpdate = true;
  }

  private setupPlayer(): void {
    this.playerGroup = new THREE.Group();

    const suitMat = new THREE.MeshStandardNodeMaterial();
    suitMat.colorNode = color(0xe2e8f0);
    suitMat.roughnessNode = float(0.58);
    suitMat.metalnessNode = float(0.18);

    const trimMat = new THREE.MeshStandardNodeMaterial();
    trimMat.colorNode = color(0xf97316);
    trimMat.roughnessNode = float(0.42);
    trimMat.metalnessNode = float(0.25);

    const darkJointMat = new THREE.MeshStandardNodeMaterial();
    darkJointMat.colorNode = color(0x1e293b);
    darkJointMat.roughnessNode = float(0.75);
    darkJointMat.metalnessNode = float(0.35);

    const visorMat = new THREE.MeshPhysicalNodeMaterial();
    visorMat.colorNode = color(0x0ea5e9);
    visorMat.emissiveNode = color(0x0284c7).mul(0.35);
    visorMat.roughnessNode = float(0.08);
    visorMat.metalnessNode = float(0.65);
    visorMat.clearcoatNode = float(1.0);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.34, 6, 12), suitMat);
    torso.position.y = 0.72;
    torso.castShadow = true;
    this.playerGroup.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.12), trimMat);
    chest.position.set(0, 0.78, -0.2);
    chest.castShadow = true;
    this.playerGroup.add(chest);

    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.22), darkJointMat);
    pack.position.set(0, 0.76, 0.24);
    pack.castShadow = true;
    this.playerGroup.add(pack);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), suitMat);
    helmet.position.y = 1.18;
    helmet.castShadow = true;
    this.playerGroup.add(helmet);

    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 14), visorMat);
    visor.position.set(0, 1.18, -0.09);
    visor.scale.set(1.0, 0.82, 0.78);
    this.playerGroup.add(visor);

    const legGeo = new THREE.CapsuleGeometry(0.095, 0.28, 4, 8);
    this.playerLeftLeg = new THREE.Mesh(legGeo, darkJointMat);
    this.playerLeftLeg.position.set(-0.13, 0.26, 0);
    this.playerLeftLeg.castShadow = true;
    this.playerGroup.add(this.playerLeftLeg);

    this.playerRightLeg = new THREE.Mesh(legGeo, darkJointMat);
    this.playerRightLeg.position.set(0.13, 0.26, 0);
    this.playerRightLeg.castShadow = true;
    this.playerGroup.add(this.playerRightLeg);

    const armGeo = new THREE.CapsuleGeometry(0.075, 0.26, 4, 8);
    this.playerLeftArm = new THREE.Mesh(armGeo, suitMat);
    this.playerLeftArm.position.set(-0.31, 0.76, 0);
    this.playerLeftArm.castShadow = true;
    this.playerGroup.add(this.playerLeftArm);

    this.playerRightArm = new THREE.Mesh(armGeo, trimMat);
    this.playerRightArm.position.set(0.31, 0.76, 0);
    this.playerRightArm.castShadow = true;
    this.playerGroup.add(this.playerRightArm);

    this.playerGroup.visible =
      this.hasWorld && this.phase !== 'title' && this.config.cameraMode !== 'firstPerson';
    this.scene.add(this.playerGroup);
  }

  private setupGravityVisualizer(): void {
    this.gravityFieldGroup = new THREE.Group();
    const dirs: Array<[number, number, number]> = [];
    const rings = 2;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const samplesPerRing = 26;
    for (let ring = 0; ring < rings; ring++) {
      const r = ring === 0 ? 15.2 : 18.8;
      for (let i = 0; i < samplesPerRing; i++) {
        const y = 1 - (i / (samplesPerRing - 1)) * 2;
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = goldenAngle * i + ring * 0.7;
        dirs.push([
          Math.cos(theta) * radiusAtY * r,
          y * r,
          Math.sin(theta) * radiusAtY * r,
        ]);
      }
    }
    this.gravityArrowBasePositions = dirs;

    const arrowGeo = new THREE.ConeGeometry(0.18, 0.85, 8);
    const arrowMat = new THREE.MeshBasicNodeMaterial();
    arrowMat.colorNode = color(0x38bdf8);
    arrowMat.opacityNode = float(0.65);
    arrowMat.transparent = true;

    this.gravityArrowsMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, dirs.length);
    this.gravityFieldGroup.add(this.gravityArrowsMesh);
    this.gravityFieldGroup.visible = this.config.showGravityVectors;
    this.scene.add(this.gravityFieldGroup);
    this.refreshGravityVisualizer();
    this.telemetryTimer = 1;
  }

  private refreshGravityVisualizer(): void {
    if (!this.gravityFieldGroup || !this.gravityArrowsMesh) return;
    this.gravityFieldGroup.visible = this.config.showGravityVectors;
    if (!this.config.showGravityVectors) return;
    const scale = this.getPlanetScale();
    const upDefault = new THREE.Vector3(0, 1, 0);
    const params = this.getGravityParams();
    const count = this.gravityArrowBasePositions.length;
    for (let i = 0; i < count; i++) {
      const [bx, by, bz] = this.gravityArrowBasePositions[i];
      this._v1.set(bx * scale, by * scale, bz * scale);
      const r = this._v1.length();
      this._v2.copy(this._v1).normalize().negate();
      this._q1.setFromUnitVectors(upDefault, this._v2);
      const gMag = computeGravityMagnitude(r, params);
      const lenScale = clamp(gMag / EARTH_SURFACE_GRAVITY, 0.35, 1.8);
      this._s1.set(0.85 * scale, lenScale * scale, 0.85 * scale);
      this._m4.compose(this._v1, this._q1, this._s1);
      this.gravityArrowsMesh.setMatrixAt(i, this._m4);
    }
    this.gravityArrowsMesh.instanceMatrix.needsUpdate = true;
  }

  private setupBrushAndDebris(): void {
    const bGeo = new THREE.SphereGeometry(1, 20, 16);
    this.brushMat = new THREE.MeshBasicNodeMaterial();
    this.brushMat.colorNode = this.brushColorNode;
    this.brushMat.opacityNode = float(0.32);
    this.brushMat.transparent = true;
    this.brushMat.wireframe = true;
    this.brushPreview = new THREE.Mesh(bGeo, this.brushMat);
    this.brushPreview.visible = false;
    this.scene.add(this.brushPreview);

    // Procedural Landing Site Beacon (orbital ring + vertical guide beam)
    this.landingBeaconGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.68, 1.0, 36);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicNodeMaterial();
    ringMat.colorNode = color(0x34d399).mul(1.6);
    ringMat.opacityNode = float(0.82);
    ringMat.transparent = true;
    ringMat.side = THREE.DoubleSide;
    ringMat.depthWrite = false;
    this.landingBeaconGroup.add(new THREE.Mesh(ringGeo, ringMat));

    const innerRingGeo = new THREE.RingGeometry(0.28, 0.42, 24);
    innerRingGeo.rotateX(-Math.PI / 2);
    const innerRingMesh = new THREE.Mesh(innerRingGeo, ringMat);
    innerRingMesh.position.y = 0.04;
    this.landingBeaconGroup.add(innerRingMesh);

    const beamGeo = new THREE.CylinderGeometry(0.055, 0.09, 2.8, 12, 1, true);
    const beamMat = new THREE.MeshBasicNodeMaterial();
    beamMat.colorNode = color(0x38bdf8).mul(1.4);
    beamMat.opacityNode = float(0.45);
    beamMat.transparent = true;
    beamMat.side = THREE.DoubleSide;
    beamMat.depthWrite = false;
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.y = 1.4;
    this.landingBeaconGroup.add(beamMesh);
    this.landingBeaconGroup.visible = false;
    this.scene.add(this.landingBeaconGroup);

    // Procedural Open-Center Detail Reticle Ring (never obscures target voxels)
    const detGeo = new THREE.RingGeometry(0.86, 1.0, 40);
    detGeo.rotateX(-Math.PI / 2);
    const detMat = new THREE.MeshBasicNodeMaterial();
    detMat.colorNode = color(0x38bdf8).mul(1.3);
    detMat.opacityNode = float(0.42);
    detMat.transparent = true;
    detMat.side = THREE.DoubleSide;
    detMat.depthWrite = false;
    this.detailReticleRing = new THREE.Mesh(detGeo, detMat);
    this.detailReticleRing.visible = false;
    this.scene.add(this.detailReticleRing);

    const dGeo = new THREE.DodecahedronGeometry(0.18, 0);
    const dMat = new THREE.MeshStandardNodeMaterial();
    dMat.colorNode = color(0x94a3b8);
    dMat.roughnessNode = float(0.85);
    this.debrisMesh = new THREE.InstancedMesh(dGeo, dMat, this.MAX_DEBRIS);
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    this.scene.add(this.debrisMesh);

    // Procedural Orbital Laser & Tunnel Piercing Beam
    this.laserBeamGroup = new THREE.Group();
    const outerBeamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    const outerBeamMat = new THREE.MeshBasicNodeMaterial();
    outerBeamMat.colorNode = this.laserBeamColorNode.mul(2.3);
    outerBeamMat.opacityNode = float(0.45);
    outerBeamMat.transparent = true;
    outerBeamMat.side = THREE.DoubleSide;
    outerBeamMat.depthWrite = false;
    this.laserOuterMesh = new THREE.Mesh(outerBeamGeo, outerBeamMat);
    this.laserBeamGroup.add(this.laserOuterMesh);

    const coreBeamGeo = new THREE.CylinderGeometry(0.32, 0.32, 1, 10, 1, true);
    const coreBeamMat = new THREE.MeshBasicNodeMaterial();
    coreBeamMat.colorNode = color(0xffffff).mul(2.8);
    coreBeamMat.opacityNode = float(0.92);
    coreBeamMat.transparent = true;
    coreBeamMat.side = THREE.DoubleSide;
    coreBeamMat.depthWrite = false;
    this.laserCoreMesh = new THREE.Mesh(coreBeamGeo, coreBeamMat);
    this.laserBeamGroup.add(this.laserCoreMesh);

    const impactGeo = new THREE.SphereGeometry(1, 14, 10);
    const impactMat = new THREE.MeshBasicNodeMaterial();
    impactMat.colorNode = this.laserImpactColorNode.mul(2.5);
    impactMat.opacityNode = float(0.68);
    impactMat.transparent = true;
    impactMat.depthWrite = false;
    this.laserImpactMesh = new THREE.Mesh(impactGeo, impactMat);
    this.scene.add(this.laserImpactMesh);
    this.laserImpactMesh.visible = false;

    this.laserBeamGroup.visible = false;
    this.scene.add(this.laserBeamGroup);

    // Molten Magma / Fire Embers Pool
    const magmaGeo = new THREE.DodecahedronGeometry(0.24, 0);
    const magmaMat = new THREE.MeshBasicNodeMaterial();
    magmaMat.colorNode = color(0xff5a1f).mul(2.4);
    this.magmaMesh = new THREE.InstancedMesh(magmaGeo, magmaMat, this.MAX_MAGMA);
    this.magmaMesh.frustumCulled = false;
    this.magmaMesh.count = 0;
    this.scene.add(this.magmaMesh);

    // Living Voxel Worm Segments Pool
    const wormGeo = new THREE.BoxGeometry(1, 1, 1);
    const wormMat = new THREE.MeshStandardNodeMaterial();
    wormMat.colorNode = color(0x84cc16).mul(1.35);
    wormMat.roughnessNode = float(0.45);
    this.wormMesh = new THREE.InstancedMesh(wormGeo, wormMat, this.MAX_WORM_INSTANCES);
    this.wormMesh.castShadow = true;
    this.wormMesh.frustumCulled = false;
    this.wormMesh.count = 0;
    this.scene.add(this.wormMesh);

    // Flaming Meteor Boulders Pool
    const meteorGeo = new THREE.IcosahedronGeometry(0.55, 1);
    const meteorMat = new THREE.MeshBasicNodeMaterial();
    meteorMat.colorNode = color(0xfb923c).mul(2.1);
    this.meteorMesh = new THREE.InstancedMesh(meteorGeo, meteorMat, this.MAX_METEORS);
    this.meteorMesh.frustumCulled = false;
    this.meteorMesh.count = 0;
    this.scene.add(this.meteorMesh);

    // Shockwave Ring & Fireball Mushroom Pools
    const shockGeo = new THREE.TorusGeometry(1.0, 0.08, 8, 36);
    shockGeo.rotateX(Math.PI / 2);
    const shockMat = new THREE.MeshBasicNodeMaterial();
    shockMat.colorNode = color(0xfef08a).mul(2.3);
    shockMat.opacityNode = float(0.62);
    shockMat.transparent = true;
    shockMat.depthWrite = false;
    this.shockwaveRingMesh = new THREE.InstancedMesh(shockGeo, shockMat, this.MAX_SHOCKWAVES);
    this.shockwaveRingMesh.frustumCulled = false;
    this.shockwaveRingMesh.count = 0;
    this.scene.add(this.shockwaveRingMesh);

    const fbGeo = new THREE.SphereGeometry(0.65, 14, 10);
    const fbMat = new THREE.MeshBasicNodeMaterial();
    fbMat.colorNode = color(0xf97316).mul(2.2);
    fbMat.opacityNode = float(0.58);
    fbMat.transparent = true;
    fbMat.depthWrite = false;
    this.fireballMesh = new THREE.InstancedMesh(fbGeo, fbMat, this.MAX_SHOCKWAVES);
    this.fireballMesh.frustumCulled = false;
    this.fireballMesh.count = 0;
    this.scene.add(this.fireballMesh);

    // Tornado & Black Hole Vortex Rings Pool
    const vortexGeo = new THREE.TorusGeometry(1.0, 0.14, 8, 24);
    vortexGeo.rotateX(Math.PI / 2);
    const vortexMat = new THREE.MeshBasicNodeMaterial();
    vortexMat.colorNode = color(0x6366f1).mul(1.85);
    vortexMat.opacityNode = float(0.68);
    vortexMat.transparent = true;
    vortexMat.depthWrite = false;
    this.vortexMesh = new THREE.InstancedMesh(vortexGeo, vortexMat, this.MAX_VORTEX_INSTANCES);
    this.vortexMesh.frustumCulled = false;
    this.vortexMesh.count = 0;
    this.scene.add(this.vortexMesh);

    // Jagged Procedural 3D Lightning Arcs
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.BufferAttribute(this.lightningPosArr, 3));
    lGeo.setDrawRange(0, 0);
    const lMat = new THREE.LineBasicNodeMaterial();
    lMat.colorNode = color(0x93c5fd).mul(3.2);
    lMat.transparent = true;
    this.lightningLines = new THREE.LineSegments(lGeo, lMat);
    this.lightningLines.frustumCulled = false;
    this.lightningLines.visible = false;
    this.scene.add(this.lightningLines);

    // Procedural 3D Tractor Beam Cone + Traveling Capture Rings + Stretch Spine
    this.tractorBeamGroup = new THREE.Group();
    const coneGeo = new THREE.CylinderGeometry(0.18, 1.0, 1, 20, 1, true);
    const coneMat = new THREE.MeshBasicNodeMaterial();
    coneMat.colorNode = this.tractorBeamColorNode.mul(1.8);
    coneMat.opacityNode = float(0.24);
    coneMat.transparent = true;
    coneMat.side = THREE.DoubleSide;
    coneMat.depthWrite = false;
    this.tractorConeMesh = new THREE.Mesh(coneGeo, coneMat);
    this.tractorBeamGroup.add(this.tractorConeMesh);

    const tRingGeo = new THREE.TorusGeometry(1.0, 0.055, 8, 28);
    tRingGeo.rotateX(Math.PI / 2);
    const tRingMat = new THREE.MeshBasicNodeMaterial();
    tRingMat.colorNode = this.tractorBeamColorNode.mul(2.4);
    tRingMat.opacityNode = float(0.78);
    tRingMat.transparent = true;
    tRingMat.depthWrite = false;
    this.tractorRings = [];
    for (let r = 0; r < 3; r++) {
      const ringMesh = new THREE.Mesh(tRingGeo, tRingMat);
      this.tractorBeamGroup.add(ringMesh);
      this.tractorRings.push(ringMesh);
    }

    const orbGeo = new THREE.SphereGeometry(0.28, 14, 12);
    const orbMat = new THREE.MeshBasicNodeMaterial();
    orbMat.colorNode = color(0xe0f2fe).mul(2.2);
    orbMat.opacityNode = float(0.78);
    orbMat.transparent = true;
    orbMat.depthWrite = false;
    this.tractorCursorOrb = new THREE.Mesh(orbGeo, orbMat);
    this.tractorBeamGroup.add(this.tractorCursorOrb);
    this.tractorBeamGroup.visible = false;
    this.scene.add(this.tractorBeamGroup);

    const stretchGeo = new THREE.BufferGeometry();
    stretchGeo.setAttribute('position', new THREE.BufferAttribute(this.tractorStretchPosArr, 3));
    const stretchMat = new THREE.LineBasicNodeMaterial();
    stretchMat.colorNode = this.tractorBeamColorNode.mul(2.2);
    stretchMat.opacityNode = float(0.82);
    stretchMat.transparent = true;
    this.tractorStretchLine = new THREE.Line(stretchGeo, stretchMat);
    this.tractorStretchLine.frustumCulled = false;
    this.tractorStretchLine.visible = false;
    this.scene.add(this.tractorStretchLine);
  }

  private clearDynamicEntities(): void {
    this.releaseTractorBeam();
    this.debrisLife.fill(0);
    this.debrisGrabbed.fill(0);
    this.magmaLife.fill(0);
    this.magmaGrabbed.fill(0);
    this.activeWorms.length = 0;
    this.activeMeteors.length = 0;
    this.activeShockwaves.length = 0;
    this.activeVortices.length = 0;
    this.thermalHotspots.length = 0;
    this.lightningLife = 0;
    if (this.debrisMesh) this.debrisMesh.count = 0;
    if (this.magmaMesh) this.magmaMesh.count = 0;
    if (this.wormMesh) this.wormMesh.count = 0;
    if (this.meteorMesh) this.meteorMesh.count = 0;
    if (this.shockwaveRingMesh) this.shockwaveRingMesh.count = 0;
    if (this.fireballMesh) this.fireballMesh.count = 0;
    if (this.vortexMesh) this.vortexMesh.count = 0;
    if (this.lightningLines) this.lightningLines.visible = false;
    if (this.tractorBeamGroup) this.tractorBeamGroup.visible = false;
    if (this.tractorStretchLine) this.tractorStretchLine.visible = false;
  }

  private addThermalHotspot(
    x: number,
    y: number,
    z: number,
    radius: number,
    deltaC: number,
    decayPerSec = 45,
  ): void {
    if (Math.abs(deltaC) < 1) return;
    if (this.thermalHotspots.length >= 24) {
      this.thermalHotspots.shift();
    }
    this.thermalHotspots.push({ x, y, z, radius, deltaC, decayPerSec });
  }

  private spawnShockwave(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    maxRadius: number,
    hasFireball: boolean,
    isNuke = false,
  ): void {
    if (this.activeShockwaves.length >= this.MAX_SHOCKWAVES) {
      this.activeShockwaves.shift();
    }
    this.activeShockwaves.push({
      x,
      y,
      z,
      nx,
      ny,
      nz,
      age: 0,
      maxAge: isNuke ? 2.1 : hasFireball ? 0.95 : 0.65,
      maxRadius,
      hasFireball,
      isNuke,
    });
  }

  private spawnMagmaBurst(
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    count: number,
    rad: number,
    speedMult = 1.0,
    burnOnly = false,
  ): void {
    const scale = this.getPlanetScale();
    const velScale = Math.sqrt(scale) * speedMult;
    for (let k = 0; k < count; k++) {
      const i = this.magmaNext;
      this.magmaNext = (this.magmaNext + 1) % this.MAX_MAGMA;
      const i3 = i * 3;
      this.magmaPos[i3] = cx + (Math.random() - 0.5) * rad * 0.7;
      this.magmaPos[i3 + 1] = cy + (Math.random() - 0.5) * rad * 0.7;
      this.magmaPos[i3 + 2] = cz + (Math.random() - 0.5) * rad * 0.7;
      this.magmaVel[i3] = (nx * (1.8 + Math.random() * 2.4) + (Math.random() - 0.5) * 3.8) * velScale;
      this.magmaVel[i3 + 1] = (ny * (1.8 + Math.random() * 2.4) + (Math.random() - 0.5) * 3.8) * velScale;
      this.magmaVel[i3 + 2] = (nz * (1.8 + Math.random() * 2.4) + (Math.random() - 0.5) * 3.8) * velScale;
      this.magmaLife[i] = burnOnly ? 0.65 + Math.random() * 0.55 : 2.6 + Math.random() * 1.4;
      this.magmaRad[i] = burnOnly ? -Math.max(rad * 0.25, 0.2 * scale) : Math.max(rad * 0.35, 0.35 * scale);
    }
  }

  private spawnLightningBolt(
    hx: number,
    hy: number,
    hz: number,
    nx: number,
    ny: number,
    nz: number,
    forks = 3,
  ): void {
    const scale = this.getPlanetScale();
    const height = Math.max(this.planet.baseRadius * 0.95, 9 * scale);
    let segIdx = 0;
    const pushSeg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      if (segIdx >= this.MAX_LIGHTNING_SEGS) return;
      const o = segIdx * 6;
      this.lightningPosArr[o] = ax;
      this.lightningPosArr[o + 1] = ay;
      this.lightningPosArr[o + 2] = az;
      this.lightningPosArr[o + 3] = bx;
      this.lightningPosArr[o + 4] = by;
      this.lightningPosArr[o + 5] = bz;
      segIdx++;
    };

    const fCount = clamp(Math.round(forks), 1, 6);
    for (let f = 0; f < fCount; f++) {
      let cx = hx + nx * height + (f === 0 ? 0 : (Math.random() - 0.5) * 3.5 * scale);
      let cy = hy + ny * height + (f === 0 ? 0 : (Math.random() - 0.5) * 3.5 * scale);
      let cz = hz + nz * height + (f === 0 ? 0 : (Math.random() - 0.5) * 3.5 * scale);
      const steps = 14;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const jitter = (1 - t) * 1.45 * scale;
        const tx = cx * (1 - 1 / (steps - s + 1)) + hx * (1 / (steps - s + 1)) + (s < steps ? (Math.random() - 0.5) * jitter : 0);
        const ty = cy * (1 - 1 / (steps - s + 1)) + hy * (1 / (steps - s + 1)) + (s < steps ? (Math.random() - 0.5) * jitter : 0);
        const tz = cz * (1 - 1 / (steps - s + 1)) + hz * (1 / (steps - s + 1)) + (s < steps ? (Math.random() - 0.5) * jitter : 0);
        pushSeg(cx, cy, cz, tx, ty, tz);
        // Occasional side arc branch
        if (s > 3 && s < steps - 2 && Math.random() < 0.35) {
          pushSeg(
            tx,
            ty,
            tz,
            tx + (Math.random() - 0.5) * 2.2 * scale,
            ty + (Math.random() - 0.5) * 2.2 * scale,
            tz + (Math.random() - 0.5) * 2.2 * scale,
          );
        }
        cx = tx;
        cy = ty;
        cz = tz;
      }
    }

    this.lightningLines.geometry.setDrawRange(0, segIdx * 2);
    (this.lightningLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.lightningLines.visible = segIdx > 0;
    this.lightningLife = 0.24;
  }

  private spawnDebrisBurst(
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    count = 8,
    lifeSec = 1.2,
    grabWeight = 0,
  ): void {
    const scale = this.getPlanetScale();
    const velScale = Math.sqrt(scale);
    for (let k = 0; k < count; k++) {
      const i = this.debrisNext;
      this.debrisNext = (this.debrisNext + 1) % this.MAX_DEBRIS;
      const i3 = i * 3;
      this.debrisPos[i3] = cx + (Math.random() - 0.5) * 0.9 * scale;
      this.debrisPos[i3 + 1] = cy + (Math.random() - 0.5) * 0.9 * scale;
      this.debrisPos[i3 + 2] = cz + (Math.random() - 0.5) * 0.9 * scale;
      this.debrisVel[i3] = (nx * (2.2 + Math.random() * 2.4) + (Math.random() - 0.5) * 3.2) * velScale;
      this.debrisVel[i3 + 1] = (ny * (2.2 + Math.random() * 2.4) + (Math.random() - 0.5) * 3.2) * velScale;
      this.debrisVel[i3 + 2] = (nz * (2.2 + Math.random() * 2.4) + (Math.random() - 0.5) * 3.2) * velScale;
      this.debrisLife[i] = lifeSec + Math.random() * 0.65;
      this.debrisGrabbed[i] = grabWeight;
      this.debrisStretchU[i] = count > 1 ? k / (count - 1) : 0.7;
    }
  }

  private updateDebris(dt: number): {
    grabbedCount: number;
    beamForceN: number;
    gravityWeightN: number;
    loadRatioSum: number;
    peakSpeedMs: number;
  } {
    const params = this.getGravityParams();
    const scale = this.getPlanetScale();
    let active = 0;
    let grabbedCount = 0;
    let beamForceN = 0;
    let gravityWeightN = 0;
    let loadRatioSum = 0;
    let peakSpeedMs = 0;
    const attrs = this.getActiveToolAttrs();
    const beamPower = Math.max(0.25, this.config.brushStrength * attrs.strengthMult);
    const debrisRadius = 0.19 * scale;

    if (this.isTractorDragging) {
      this._tractorForceParams.planetRadius = this.planet.baseRadius;
      this._tractorForceParams.beamPower = beamPower;
      this._tractorForceParams.gravityCompFactor = 0.44;
      this._tractorForceParams.maxAccelG = 5.8;
      this._tractorForceParams.massKg = 1.4;
    }

    for (let i = 0; i < this.MAX_DEBRIS; i++) {
      let life = this.debrisLife[i];
      if (life <= 0) continue;
      const grabW = this.isTractorDragging ? this.debrisGrabbed[i] : 0;
      if (grabW > 0) {
        life = Math.max(life, 14.0);
        this.debrisLife[i] = life;
      } else {
        life -= dt;
        this.debrisLife[i] = life;
      }
      const i3 = i * 3;
      const px = this.debrisPos[i3];
      const py = this.debrisPos[i3 + 1];
      const pz = this.debrisPos[i3 + 2];

      computeGravityVector(px, py, pz, params, this._grav);
      let ax = this._grav.x;
      let ay = this._grav.y;
      let az = this._grav.z;

      if (grabW > 0) {
        evaluateStretchedAnchorPoint(
          this.tractorAnchor.x,
          this.tractorAnchor.y,
          this.tractorAnchor.z,
          this.tractorTarget.x,
          this.tractorTarget.y,
          this.tractorTarget.z,
          this.debrisStretchU[i],
          0.72,
          this._tractorTargetPt,
        );
        computeTractorSpringForce(
          px,
          py,
          pz,
          this.debrisVel[i3],
          this.debrisVel[i3 + 1],
          this.debrisVel[i3 + 2],
          this._tractorTargetPt.x,
          this._tractorTargetPt.y,
          this._tractorTargetPt.z,
          this.tractorDragVel.x,
          this.tractorDragVel.y,
          this.tractorDragVel.z,
          params,
          this._tractorForceParams,
          grabW,
          this._tractorForceRes,
        );
        const invM = 1 / this._tractorForceParams.massKg;
        ax += this._tractorForceRes.fx * invM;
        ay += this._tractorForceRes.fy * invM;
        az += this._tractorForceRes.fz * invM;

        grabbedCount++;
        beamForceN += this._tractorForceRes.beamForceN;
        gravityWeightN += this._tractorForceRes.gravityWeightN;
        loadRatioSum += this._tractorForceRes.loadRatio;
      }

      this.debrisVel[i3] += ax * dt;
      this.debrisVel[i3 + 1] += ay * dt;
      this.debrisVel[i3 + 2] += az * dt;

      let npx = px + this.debrisVel[i3] * dt;
      let npy = py + this.debrisVel[i3 + 1] * dt;
      let npz = pz + this.debrisVel[i3 + 2] * dt;

      // Real SDF collision against voxel terrain so boulders bounce & roll across planet
      const d = this.planet.sampleDensityAndNormal(npx, npy, npz, this._normalArr, true);
      if (d > -debrisRadius) {
        const pen = d + debrisRadius;
        const nx = this._normalArr[0];
        const ny = this._normalArr[1];
        const nz = this._normalArr[2];
        npx += nx * pen;
        npy += ny * pen;
        npz += nz * pen;
        const vn = this.debrisVel[i3] * nx + this.debrisVel[i3 + 1] * ny + this.debrisVel[i3 + 2] * nz;
        if (vn < 0) {
          const restitution = 0.32;
          this.debrisVel[i3] -= (1 + restitution) * vn * nx;
          this.debrisVel[i3 + 1] -= (1 + restitution) * vn * ny;
          this.debrisVel[i3 + 2] -= (1 + restitution) * vn * nz;
          this.debrisVel[i3] *= 0.9;
          this.debrisVel[i3 + 1] *= 0.9;
          this.debrisVel[i3 + 2] *= 0.9;
        }
      }

      this.debrisPos[i3] = npx;
      this.debrisPos[i3 + 1] = npy;
      this.debrisPos[i3 + 2] = npz;

      const spd = Math.hypot(this.debrisVel[i3], this.debrisVel[i3 + 1], this.debrisVel[i3 + 2]);
      if (grabW > 0 && spd > peakSpeedMs) peakSpeedMs = spd;

      const s = clamp(life, 0.08, 1.15) * scale;
      this._v1.set(npx, npy, npz);
      this._euler.set(life * 4.5, life * 3.1, i * 0.5);
      this._q1.setFromEuler(this._euler);
      this._s1.set(s, s, s);
      this._m4.compose(this._v1, this._q1, this._s1);
      this.debrisMesh.setMatrixAt(active, this._m4);
      active++;
    }
    this.debrisMesh.count = active;
    if (active > 0) {
      this.debrisMesh.instanceMatrix.needsUpdate = true;
    }
    return { grabbedCount, beamForceN, gravityWeightN, loadRatioSum, peakSpeedMs };
  }

  private updateDynamicEntities(dt: number): {
    grabbedCount: number;
    beamForceN: number;
    gravityWeightN: number;
    loadRatioSum: number;
    peakSpeedMs: number;
  } {
    const params = this.getGravityParams();
    const scale = this.getPlanetScale();
    let terrainDirty = false;
    let grabbedCount = 0;
    let beamForceN = 0;
    let gravityWeightN = 0;
    let loadRatioSum = 0;
    let peakSpeedMs = 0;
    const attrs = this.getActiveToolAttrs();
    const beamPower = Math.max(0.25, this.config.brushStrength * attrs.strengthMult);

    if (this.isTractorDragging) {
      this._tractorForceParams.planetRadius = this.planet.baseRadius;
      this._tractorForceParams.beamPower = beamPower;
      this._tractorForceParams.gravityCompFactor = 0.44;
      this._tractorForceParams.maxAccelG = 6.0;
      this._tractorForceParams.massKg = 1.6;
    }

    // 1. Decay thermal hotspots
    for (let i = this.thermalHotspots.length - 1; i >= 0; i--) {
      const h = this.thermalHotspots[i];
      const step = h.decayPerSec * dt;
      if (Math.abs(h.deltaC) <= step) {
        this.thermalHotspots.splice(i, 1);
      } else {
        h.deltaC -= Math.sign(h.deltaC) * step;
      }
    }

    // 2. Lightning visibility fade
    if (this.lightningLife > 0) {
      this.lightningLife -= dt;
      if (this.lightningLife <= 0 && this.lightningLines) {
        this.lightningLines.visible = false;
      }
    }

    // 3. Magma blobs & embers (magmaRad > 0 solidifies into Basalt when settling!)
    let magmaActive = 0;
    for (let i = 0; i < this.MAX_MAGMA; i++) {
      let life = this.magmaLife[i];
      if (life <= 0) continue;
      const grabW = this.isTractorDragging ? this.magmaGrabbed[i] : 0;
      const nextLife = grabW > 0 ? Math.max(life, 3.0) : life - dt;
      this.magmaLife[i] = nextLife;
      const i3 = i * 3;
      const px = this.magmaPos[i3];
      const py = this.magmaPos[i3 + 1];
      const pz = this.magmaPos[i3 + 2];
      computeGravityVector(px, py, pz, params, this._grav);
      let ax = this._grav.x * 0.75;
      let ay = this._grav.y * 0.75;
      let az = this._grav.z * 0.75;

      if (grabW > 0) {
        evaluateStretchedAnchorPoint(
          this.tractorAnchor.x,
          this.tractorAnchor.y,
          this.tractorAnchor.z,
          this.tractorTarget.x,
          this.tractorTarget.y,
          this.tractorTarget.z,
          this.magmaStretchU[i],
          0.7,
          this._tractorTargetPt,
        );
        computeTractorSpringForce(
          px,
          py,
          pz,
          this.magmaVel[i3],
          this.magmaVel[i3 + 1],
          this.magmaVel[i3 + 2],
          this._tractorTargetPt.x,
          this._tractorTargetPt.y,
          this._tractorTargetPt.z,
          this.tractorDragVel.x,
          this.tractorDragVel.y,
          this.tractorDragVel.z,
          params,
          this._tractorForceParams,
          grabW,
          this._tractorForceRes,
        );
        const invM = 1 / this._tractorForceParams.massKg;
        ax += this._tractorForceRes.fx * invM;
        ay += this._tractorForceRes.fy * invM;
        az += this._tractorForceRes.fz * invM;
        grabbedCount++;
        beamForceN += this._tractorForceRes.beamForceN;
        gravityWeightN += this._tractorForceRes.gravityWeightN;
        loadRatioSum += this._tractorForceRes.loadRatio;
      }

      this.magmaVel[i3] += ax * dt;
      this.magmaVel[i3 + 1] += ay * dt;
      this.magmaVel[i3 + 2] += az * dt;
      const nx = px + this.magmaVel[i3] * dt;
      const ny = py + this.magmaVel[i3 + 1] * dt;
      const nz = pz + this.magmaVel[i3 + 2] * dt;

      const d = this.planet.sampleDensity(nx, ny, nz);
      if (d > 0) {
        // Bounce & slide along surface normal with viscous lava drag
        this.magmaVel[i3] *= 0.48;
        this.magmaVel[i3 + 1] *= 0.48;
        this.magmaVel[i3 + 2] *= 0.48;
        const speedSq =
          this.magmaVel[i3] * this.magmaVel[i3] +
          this.magmaVel[i3 + 1] * this.magmaVel[i3 + 1] +
          this.magmaVel[i3 + 2] * this.magmaVel[i3 + 2];
        if (nextLife <= 0.15 && this.magmaRad[i] > 0 && speedSq < 2.2 * scale) {
          this.planet.applyBrush(px, py, pz, 'build', this.magmaRad[i], 0.9, MaterialId.Basalt);
          this.magmaLife[i] = 0;
          terrainDirty = true;
          continue;
        }
      } else {
        this.magmaPos[i3] = nx;
        this.magmaPos[i3 + 1] = ny;
        this.magmaPos[i3 + 2] = nz;
      }

      const mSpd = Math.hypot(this.magmaVel[i3], this.magmaVel[i3 + 1], this.magmaVel[i3 + 2]);
      if (grabW > 0 && mSpd > peakSpeedMs) peakSpeedMs = mSpd;

      const baseScale = Math.max(Math.abs(this.magmaRad[i]), 0.18 * scale) * clamp(nextLife, 0.25, 1.3);
      this._v1.set(this.magmaPos[i3], this.magmaPos[i3 + 1], this.magmaPos[i3 + 2]);
      this._euler.set(nextLife * 3.1, i * 0.7, 0);
      this._q1.setFromEuler(this._euler);
      this._s1.set(baseScale, baseScale, baseScale);
      this._m4.compose(this._v1, this._q1, this._s1);
      this.magmaMesh.setMatrixAt(magmaActive++, this._m4);
    }
    this.magmaMesh.count = magmaActive;
    if (magmaActive > 0) this.magmaMesh.instanceMatrix.needsUpdate = true;

    // 4. Flaming Meteors hurtling from orbit (deflectable mid-air via Tractor Beam!)
    let meteorActive = 0;
    for (let i = this.activeMeteors.length - 1; i >= 0; i--) {
      const m = this.activeMeteors[i];
      m.life -= dt;
      const mGrab = this.isTractorDragging ? (m.grabbedWeight ?? 0) : 0;
      if (mGrab > 0) {
        m.life = Math.max(m.life, 4.0);
        this._tractorForceParams.massKg = 4.2;
        evaluateStretchedAnchorPoint(
          this.tractorAnchor.x,
          this.tractorAnchor.y,
          this.tractorAnchor.z,
          this.tractorTarget.x,
          this.tractorTarget.y,
          this.tractorTarget.z,
          m.stretchU ?? 0.85,
          0.75,
          this._tractorTargetPt,
        );
        computeTractorSpringForce(
          m.x,
          m.y,
          m.z,
          m.vx,
          m.vy,
          m.vz,
          this._tractorTargetPt.x,
          this._tractorTargetPt.y,
          this._tractorTargetPt.z,
          this.tractorDragVel.x,
          this.tractorDragVel.y,
          this.tractorDragVel.z,
          params,
          this._tractorForceParams,
          mGrab,
          this._tractorForceRes,
        );
        computeGravityVector(m.x, m.y, m.z, params, this._grav);
        const invM = 1 / this._tractorForceParams.massKg;
        m.vx += (this._grav.x + this._tractorForceRes.fx * invM) * dt;
        m.vy += (this._grav.y + this._tractorForceRes.fy * invM) * dt;
        m.vz += (this._grav.z + this._tractorForceRes.fz * invM) * dt;
        grabbedCount++;
        beamForceN += this._tractorForceRes.beamForceN;
        gravityWeightN += this._tractorForceRes.gravityWeightN;
        loadRatioSum += this._tractorForceRes.loadRatio;
        const mSpd = Math.hypot(m.vx, m.vy, m.vz);
        if (mSpd > peakSpeedMs) peakSpeedMs = mSpd;
        this._tractorForceParams.massKg = 1.6;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      // Trail ember
      if (Math.random() < 0.75) {
        this.spawnMagmaBurst(m.x, m.y, m.z, -m.vx * 0.05, -m.vy * 0.05, -m.vz * 0.05, 1, m.radius * 0.28, 0.3, true);
      }

      const d = this.planet.sampleDensity(m.x, m.y, m.z);
      if (d >= 0 || m.life <= 0) {
        // Meteor impact detonation!
        const rLen = Math.hypot(m.x, m.y, m.z) || 1;
        const nrmX = m.x / rLen;
        const nrmY = m.y / rLen;
        const nrmZ = m.z / rLen;
        this.planet.applyBrush(m.x, m.y, m.z, 'crater', m.radius, m.strength, m.material, {
          rimHeight: m.leaveRim ? 0.85 : 0,
          rimMaterial: m.rimMaterial,
          floorMaterial: m.material,
        });
        this.fluid.applyRadialImpulse(m.x, m.y, m.z, m.radius * 2.2, 16 * Math.sqrt(scale), 7 * Math.sqrt(scale));
        this.spawnShockwave(m.x, m.y, m.z, nrmX, nrmY, nrmZ, m.radius * 2.6, true, false);
        this.spawnDebrisBurst(m.x, m.y, m.z, nrmX, nrmY, nrmZ, m.debrisCount);
        this.addThermalHotspot(m.x, m.y, m.z, m.radius * 2.4, m.thermalDeltaC, 65);
        this.sound.playExplosion(true);
        terrainDirty = true;
        this.activeMeteors.splice(i, 1);
        continue;
      }

      if (meteorActive < this.MAX_METEORS) {
        const ms = clamp(m.radius * 0.75, 0.35 * scale, 5.0 * scale);
        this._v1.set(m.x, m.y, m.z);
        this._euler.set(this.simTimeSec * 4 + i, this.simTimeSec * 3, 0);
        this._q1.setFromEuler(this._euler);
        this._s1.set(ms, ms, ms);
        this._m4.compose(this._v1, this._q1, this._s1);
        this.meteorMesh.setMatrixAt(meteorActive++, this._m4);
      }
    }
    this.meteorMesh.count = meteorActive;
    if (meteorActive > 0) this.meteorMesh.instanceMatrix.needsUpdate = true;

    // 5. Autonomous Burrowing Voxel Worms (can be yanked & stretched out of the crust!)
    let wormSegCount = 0;
    for (let i = this.activeWorms.length - 1; i >= 0; i--) {
      const w = this.activeWorms[i];
      w.life -= dt;
      w.phase += dt * 4.5;
      if (w.life <= 0) {
        this.activeWorms.splice(i, 1);
        continue;
      }
      const head = w.segments[0];
      const wGrab = this.isTractorDragging ? (w.grabbedWeight ?? 0) : 0;
      let nx: number;
      let ny: number;
      let nz: number;
      const prevHeadX = head[0];
      const prevHeadY = head[1];
      const prevHeadZ = head[2];

      if (wGrab > 0) {
        w.life = Math.max(w.life, 6.0);
        this._tractorForceParams.massKg = 2.4;
        evaluateStretchedAnchorPoint(
          this.tractorAnchor.x,
          this.tractorAnchor.y,
          this.tractorAnchor.z,
          this.tractorTarget.x,
          this.tractorTarget.y,
          this.tractorTarget.z,
          w.stretchU ?? 0.9,
          0.72,
          this._tractorTargetPt,
        );
        computeTractorSpringForce(
          head[0],
          head[1],
          head[2],
          w.dir[0] * w.speed * 7.5 * scale,
          w.dir[1] * w.speed * 7.5 * scale,
          w.dir[2] * w.speed * 7.5 * scale,
          this._tractorTargetPt.x,
          this._tractorTargetPt.y,
          this._tractorTargetPt.z,
          this.tractorDragVel.x,
          this.tractorDragVel.y,
          this.tractorDragVel.z,
          params,
          this._tractorForceParams,
          wGrab,
          this._tractorForceRes,
        );
        const pullVecX = this._tractorTargetPt.x - head[0];
        const pullVecY = this._tractorTargetPt.y - head[1];
        const pullVecZ = this._tractorTargetPt.z - head[2];
        const pullRate = clamp(beamPower * 6.5, 2.5, 16) * dt;
        nx = head[0] + pullVecX * clamp(pullRate, 0, 0.75);
        ny = head[1] + pullVecY * clamp(pullRate, 0, 0.75);
        nz = head[2] + pullVecZ * clamp(pullRate, 0, 0.75);
        const pdLen = Math.hypot(nx - prevHeadX, ny - prevHeadY, nz - prevHeadZ);
        if (pdLen > 1e-4) {
          w.dir[0] = (nx - prevHeadX) / pdLen;
          w.dir[1] = (ny - prevHeadY) / pdLen;
          w.dir[2] = (nz - prevHeadZ) / pdLen;
        }
        grabbedCount++;
        beamForceN += this._tractorForceRes.beamForceN;
        gravityWeightN += this._tractorForceRes.gravityWeightN;
        loadRatioSum += this._tractorForceRes.loadRatio;
        const wSpd = pdLen / Math.max(dt, 1e-4);
        if (wSpd > peakSpeedMs) peakSpeedMs = wSpd;
        this._tractorForceParams.massKg = 1.6;
      } else {
        // Steer gently in 3D wiggle and curve back inside planet sphere if far outside
        const rHead = Math.hypot(head[0], head[1], head[2]);
        let dx = w.dir[0] + Math.sin(w.phase * 1.3 + i) * 0.42 * dt * 4;
        let dy = w.dir[1] + Math.cos(w.phase * 1.1 + i * 2) * 0.42 * dt * 4;
        let dz = w.dir[2] + Math.sin(w.phase * 0.9 - i) * 0.42 * dt * 4;
        if (rHead > this.planet.baseRadius * 1.05) {
          dx -= (head[0] / rHead) * dt * 3.5;
          dy -= (head[1] / rHead) * dt * 3.5;
          dz -= (head[2] / rHead) * dt * 3.5;
        }
        const dLen = Math.hypot(dx, dy, dz) || 1;
        w.dir[0] = dx / dLen;
        w.dir[1] = dy / dLen;
        w.dir[2] = dz / dLen;

        const stepDist = w.speed * 7.5 * scale * dt;
        nx = head[0] + w.dir[0] * stepDist;
        ny = head[1] + w.dir[1] * stepDist;
        nz = head[2] + w.dir[2] * stepDist;
      }

      // Follow spine smoothly (stretches elastically when pulled by tractor beam!)
      head[0] = nx;
      head[1] = ny;
      head[2] = nz;
      const stepDist = Math.hypot(nx - prevHeadX, ny - prevHeadY, nz - prevHeadZ);
      const spacing = w.radius * (wGrab > 0 ? 1.45 : 0.95);
      for (let s = 1; s < w.segments.length; s++) {
        const prev = w.segments[s - 1];
        const cur = w.segments[s];
        const vx = prev[0] - cur[0];
        const vy = prev[1] - cur[1];
        const vz = prev[2] - cur[2];
        const dist = Math.hypot(vx, vy, vz);
        if (dist > spacing && dist > 1e-5) {
          const pull = (dist - spacing) / dist;
          cur[0] += vx * pull;
          cur[1] += vy * pull;
          cur[2] += vz * pull;
        }
      }

      w.stepAccum += stepDist;
      if (w.stepAccum >= w.radius * 0.45) {
        w.stepAccum = 0;
        this.planet.applyBrush(prevHeadX, prevHeadY, prevHeadZ, 'carve', w.radius, w.strength, w.material, {
          shape: 'cylinder',
          ex: nx,
          ey: ny,
          ez: nz,
          rimMaterial: w.material,
        });
        terrainDirty = true;
      }

      for (let s = 0; s < w.segments.length && wormSegCount < this.MAX_WORM_INSTANCES; s++) {
        const seg = w.segments[s];
        const taper = 1.0 - (s / w.segments.length) * 0.55;
        const sc = Math.max(w.radius * 0.95 * taper, 0.25 * scale);
        this._v1.set(seg[0], seg[1], seg[2]);
        this._euler.set(w.phase + s * 0.3, s * 0.5, 0);
        this._q1.setFromEuler(this._euler);
        this._s1.set(sc, sc, sc);
        this._m4.compose(this._v1, this._q1, this._s1);
        this.wormMesh.setMatrixAt(wormSegCount++, this._m4);
      }
    }
    this.wormMesh.count = wormSegCount;
    if (wormSegCount > 0) this.wormMesh.instanceMatrix.needsUpdate = true;

    // 6. Shockwave Rings & Nuke/Explosion Fireballs
    let shockCount = 0;
    let fbCount = 0;
    for (let i = this.activeShockwaves.length - 1; i >= 0; i--) {
      const sw = this.activeShockwaves[i];
      sw.age += dt;
      if (sw.age >= sw.maxAge) {
        this.activeShockwaves.splice(i, 1);
        continue;
      }
      const p = sw.age / sw.maxAge;
      const easeOut = 1 - Math.pow(1 - p, 3);
      const rad = Math.max(0.1 * scale, sw.maxRadius * easeOut);

      if (shockCount < this.MAX_SHOCKWAVES) {
        this._v1.set(sw.x + sw.nx * 0.25 * scale, sw.y + sw.ny * 0.25 * scale, sw.z + sw.nz * 0.25 * scale);
        this._q1.setFromUnitVectors(this._v3.set(0, 1, 0), this._v2.set(sw.nx, sw.ny, sw.nz));
        this._s1.set(rad, rad * (1 - p * 0.6), rad);
        this._m4.compose(this._v1, this._q1, this._s1);
        this.shockwaveRingMesh.setMatrixAt(shockCount++, this._m4);
      }

      if (sw.hasFireball && fbCount < this.MAX_SHOCKWAVES) {
        const rise = (sw.isNuke ? sw.maxRadius * 0.9 : sw.maxRadius * 0.4) * easeOut;
        const fbScale = Math.max(0.1 * scale, sw.maxRadius * (sw.isNuke ? 0.55 : 0.38) * Math.sin(p * Math.PI));
        this._v1.set(sw.x + sw.nx * rise, sw.y + sw.ny * rise, sw.z + sw.nz * rise);
        this._q1.identity();
        this._s1.set(fbScale, fbScale * (sw.isNuke ? 1.25 : 0.9), fbScale);
        this._m4.compose(this._v1, this._q1, this._s1);
        this.fireballMesh.setMatrixAt(fbCount++, this._m4);
      }
    }
    this.shockwaveRingMesh.count = shockCount;
    this.fireballMesh.count = fbCount;
    if (shockCount > 0) this.shockwaveRingMesh.instanceMatrix.needsUpdate = true;
    if (fbCount > 0) this.fireballMesh.instanceMatrix.needsUpdate = true;

    // 7. Tornados & Black Hole Gravity Vortices
    let vortexInstCount = 0;
    for (let i = this.activeVortices.length - 1; i >= 0; i--) {
      const vx = this.activeVortices[i];
      vx.age += dt;
      if (vx.age >= vx.maxAge) {
        if (vx.kind === 'blackHole') {
          this.planet.applyBrush(vx.x, vx.y, vx.z, 'crater', vx.radius * 0.9, vx.strength * 1.8, vx.material, {
            floorMaterial: MaterialId.Crystal,
          });
          this.spawnShockwave(vx.x, vx.y, vx.z, vx.nx, vx.ny, vx.nz, vx.radius * 1.8, false, false);
          terrainDirty = true;
        }
        this.activeVortices.splice(i, 1);
        continue;
      }

      if (vx.kind === 'blackHole') {
        this.fluid.applyRadialImpulse(vx.x, vx.y, vx.z, vx.radius * 3.4, -22 * Math.sqrt(scale) * dt * 10, 0);
        this.fluid.drainWithinRadius(vx.x, vx.y, vx.z, Math.max(vx.radius * 0.45, 0.5 * scale));
        vx.carveTimer -= dt;
        if (vx.carveTimer <= 0) {
          vx.carveTimer = 0.35;
          this.planet.applyBrush(vx.x, vx.y, vx.z, 'paint', vx.radius * 1.1, 1.0, MaterialId.Crystal);
          terrainDirty = true;
        }
        if (vortexInstCount < this.MAX_VORTEX_INSTANCES) {
          this._v1.set(vx.x + vx.nx * vx.radius * 0.5, vx.y + vx.ny * vx.radius * 0.5, vx.z + vx.nz * vx.radius * 0.5);
          this._euler.set(this.simTimeSec * 7, this.simTimeSec * 4, i);
          this._q1.setFromEuler(this._euler);
          const sc = vx.radius * (0.65 + 0.12 * Math.sin(this.simTimeSec * 12));
          this._s1.set(sc, sc, sc);
          this._m4.compose(this._v1, this._q1, this._s1);
          this.vortexMesh.setMatrixAt(vortexInstCount++, this._m4);
        }
      } else {
        // Tornado: drifts tangentially across planet surface, lifting fluid & scouring dirt
        this.fluid.applySwirlVortex(
          vx.x,
          vx.y,
          vx.z,
          vx.nx,
          vx.ny,
          vx.nz,
          vx.radius * 2.4,
          14 * Math.sqrt(scale) * dt * 10,
          9 * Math.sqrt(scale) * dt * 10,
        );
        vx.carveTimer -= dt;
        if (vx.carveTimer <= 0) {
          vx.carveTimer = 0.25;
          this.planet.applyBrush(vx.x, vx.y, vx.z, 'carve', vx.radius * 0.55, vx.strength * 0.55, vx.material);
          terrainDirty = true;
        }
        const rings = 5;
        for (let r = 0; r < rings && vortexInstCount < this.MAX_VORTEX_INSTANCES; r++) {
          const hFrac = r / (rings - 1);
          const h = hFrac * vx.radius * 2.6;
          const swirlAng = this.simTimeSec * 9 + r * 1.1;
          const rScaleRing = vx.radius * (0.28 + hFrac * 0.82);
          this._v1.set(
            vx.x + vx.nx * h + Math.cos(swirlAng) * 0.12 * scale,
            vx.y + vx.ny * h,
            vx.z + vx.nz * h + Math.sin(swirlAng) * 0.12 * scale,
          );
          this._q1.setFromUnitVectors(this._v3.set(0, 1, 0), this._v2.set(vx.nx, vx.ny, vx.nz));
          this._s1.set(rScaleRing, rScaleRing, rScaleRing);
          this._m4.compose(this._v1, this._q1, this._s1);
          this.vortexMesh.setMatrixAt(vortexInstCount++, this._m4);
        }
      }
    }
    this.vortexMesh.count = vortexInstCount;
    if (vortexInstCount > 0) this.vortexMesh.instanceMatrix.needsUpdate = true;

    if (terrainDirty) {
      if (!this.isOfflineRendering) {
        this.updateChunksWithLod(36);
        this.updateHighResStreaming(null, 44);
      }
      this.waterMeshDirty = true;
    }
    return { grabbedCount, beamForceN, gravityWeightN, loadRatioSum, peakSpeedMs };
  }

  public resetPlayerToSpawn(): void {
    const [sx, sy, sz] = this.planet.spawnPosition;
    this.playerPos.set(sx, sy, sz);
    this.playerVel.set(0, 0, 0);
    this.playerUp.copy(this.playerPos).normalize();
    this.playerFwd.set(0, 0, -1);
    parallelTransportTangentFrame(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this.playerFwd,
      this._upLike,
      this._fwdLike,
      this._rightLike,
    );
    this.playerUp.set(this._upLike.x, this._upLike.y, this._upLike.z);
    this.playerFwd.set(this._fwdLike.x, this._fwdLike.y, this._fwdLike.z);
    this.playerRight.set(this._rightLike.x, this._rightLike.y, this._rightLike.z);

    const metrics = this.getPlayerMetrics();
    this.camPitch = 0.24;
    this.firstPersonPitch = 0.08;
    this.camDistance = metrics.defaultExplorerCamDist;
    const initBasis = transportCameraForwardOnSphere(
      [this.playerUp.x, this.playerUp.y, this.playerUp.z],
      [this.playerFwd.x, this.playerFwd.y, this.playerFwd.z],
      -0.35,
    );
    this.explorerCamFwd.set(
      initBasis.forward[0],
      initBasis.forward[1],
      initBasis.forward[2],
    );
    this.explorerCamAnchor.copy(this.playerPos);

    const horiz = Math.cos(this.camPitch) * this.camDistance;
    const vert = Math.sin(this.camPitch) * this.camDistance + metrics.shoulderLift;
    this.camPosSmooth
      .copy(this.playerPos)
      .addScaledVector(this.playerUp, vert)
      .addScaledVector(this.explorerCamFwd, -horiz);
    this.camLookSmooth.copy(this.playerPos).addScaledVector(this.playerUp, metrics.lookLift);
    if (this.camera) {
      this.camera.position.copy(this.camPosSmooth);
      this.camera.up.copy(this.playerUp);
      this.camera.lookAt(this.camLookSmooth);
    }
    this.syncFpsPoseFromActiveCamera();
    this.syncPlayerTransform();
  }

  private syncFpsPoseFromActiveCamera(): void {
    this.fpsPos.copy(this.camPosSmooth);
    this._v1.copy(this.camLookSmooth).sub(this.camPosSmooth);
    if (this._v1.lengthSq() > 1e-4) {
      this._v1.normalize();
      this.fpsYaw = Math.atan2(-this._v1.x, -this._v1.z);
      this.fpsPitch = clamp(Math.asin(clamp(this._v1.y, -0.99, 0.99)), -1.45, 1.45);
    }
  }

  private raycastDetailAnchor(preferPointer: boolean): boolean {
    if (!this.camera) return false;
    let hit = preferPointer && this.pointerActive ? this.raycastFromPointer() : null;
    if (!hit || !hit.hit) {
      this.raycaster.setFromCamera(this._v2Center, this.camera);
      const orig = this.raycaster.ray.origin;
      const dir = this.raycaster.ray.direction;
      hit = this.planet.raycastTerrain(
        orig.x,
        orig.y,
        orig.z,
        dir.x,
        dir.y,
        dir.z,
        this.planet.worldHalf * 5.0,
      );
    }
    if (hit.hit) {
      this.detailTarget.set(hit.x, hit.y, hit.z);
      this.detailNormal.set(hit.nx, hit.ny, hit.nz).normalize();
      return true;
    }
    return false;
  }

  private initDetailCamera(preferPointer = false): void {
    const scale = this.getPlanetScale();
    if (!this.raycastDetailAnchor(preferPointer)) {
      const refDir = this._v1.copy(this.camPosSmooth);
      if (refDir.lengthSq() < 1e-4) refDir.set(0, 1, 0);
      else refDir.normalize();
      const surfR = this.planet.findSurfaceRadiusAlongRay(refDir.x, refDir.y, refDir.z);
      this.detailTarget.copy(refDir).multiplyScalar(surfR);
      this.detailNormal.copy(refDir);
    }

    const offset = this._v1.copy(this.camPosSmooth).sub(this.detailTarget);
    const rawDist = offset.length();
    this.detailViewDist = clamp(
      rawDist > this.planet.nativeVoxelSize * 2 ? rawDist : 14 * scale,
      Math.max(this.planet.nativeVoxelSize * 4, 0.25 * scale),
      this.planet.baseRadius * 4.5,
    );

    if (rawDist > 1e-4) {
      offset.divideScalar(rawDist);
      const upProj = clamp(offset.dot(this.detailNormal), 0.12, 0.995);
      this.detailPitch = clamp(Math.asin(upProj), 0.14, 1.44);
      const fwdToTarget = this._v2.copy(offset).negate();
      const basis = transportCameraForwardOnSphere(
        [this.detailNormal.x, this.detailNormal.y, this.detailNormal.z],
        [fwdToTarget.x, fwdToTarget.y, fwdToTarget.z],
        0,
      );
      this.detailBasisFwd.set(basis.forward[0], basis.forward[1], basis.forward[2]);
    } else {
      this.detailPitch = 0.58;
      const basis = transportCameraForwardOnSphere(
        [this.detailNormal.x, this.detailNormal.y, this.detailNormal.z],
        [this.detailBasisFwd.x, this.detailBasisFwd.y, this.detailBasisFwd.z],
        0,
      );
      this.detailBasisFwd.set(basis.forward[0], basis.forward[1], basis.forward[2]);
    }
  }

  private initLandingCamera(): void {
    const scale = this.getPlanetScale();
    this.landingStage = 'selecting';
    this.landingHasHover = false;
    const refDir = this._v1.copy(this.camPosSmooth);
    const dist = Math.max(refDir.length(), this.planet.baseRadius * 2.25);
    if (refDir.lengthSq() > 1e-4) {
      refDir.normalize();
      this.landingOrbitYaw = Math.atan2(refDir.z, refDir.x);
      this.landingOrbitPitch = clamp(Math.asin(clamp(refDir.y, -0.95, 0.95)), -1.35, 1.35);
    } else {
      this.landingOrbitYaw = this.orbitYaw;
      this.landingOrbitPitch = this.orbitPitch;
    }
    this.landingOrbitDist = clamp(
      Math.max(dist, this.planet.baseRadius * 2.15),
      this.planet.baseRadius * 1.45,
      80 * scale,
    );
  }

  private initPerspectiveCamera(): void {
    const scale = this.getPlanetScale();
    const lookDir = this._v1.copy(this.camLookSmooth).sub(this.camPosSmooth);
    if (lookDir.lengthSq() > 1e-4 && this.camera) {
      const hit = this.planet.raycastTerrain(
        this.camPosSmooth.x,
        this.camPosSmooth.y,
        this.camPosSmooth.z,
        lookDir.normalize().x,
        lookDir.y,
        lookDir.z,
        this.planet.worldHalf * 4.5,
      );
      if (hit.hit) {
        this.perspTarget.set(hit.x, hit.y, hit.z);
      } else {
        this.perspTarget.set(0, 0, 0);
      }
    } else {
      this.perspTarget.set(0, 0, 0);
    }

    const offset = this._v2.copy(this.camPosSmooth).sub(this.perspTarget);
    const dist = offset.length();
    this.perspDist = clamp(
      dist > 0.2 * scale ? dist : 28 * scale,
      Math.max(this.planet.nativeVoxelSize * 6, 0.05 * scale),
      120 * scale,
    );
    if (dist > 1e-4) {
      offset.divideScalar(dist);
      this.perspYaw = Math.atan2(offset.z, offset.x);
      this.perspPitch = clamp(Math.asin(clamp(offset.y, -0.99, 0.99)), -1.42, 1.42);
    }
  }

  public reselectLandingSite(): void {
    if (this.config.cameraMode !== 'landing') {
      this.updateConfig({ cameraMode: 'landing' });
      return;
    }
    const scale = this.getPlanetScale();
    const wasLanded = this.landingStage === 'landed';
    this.landingStage = 'selecting';
    this.landingHasHover = false;
    const refDir = this._v1.copy(wasLanded ? this.landingPos : this.camPosSmooth);
    if (refDir.lengthSq() > 1e-4) {
      refDir.normalize();
      this.landingOrbitYaw = Math.atan2(refDir.z, refDir.x);
      this.landingOrbitPitch = clamp(Math.asin(clamp(refDir.y, -0.95, 0.95)), -1.35, 1.35);
    }
    this.landingOrbitDist = Math.max(this.planet.baseRadius * 2.35, 30 * scale);
  }

  public focusCameraAtPointer(): void {
    if (this.phase !== 'playing') return;
    const hit = this.raycastFromPointer();
    if (this.config.cameraMode === 'detail') {
      if (hit.hit) {
        this.detailTarget.set(hit.x, hit.y, hit.z);
        this.detailNormal.set(hit.nx, hit.ny, hit.nz).normalize();
      } else {
        this.raycastDetailAnchor(false);
      }
    } else if (this.config.cameraMode === 'perspective') {
      if (hit.hit) {
        this.perspTarget.set(hit.x, hit.y, hit.z);
        this.perspDist = Math.min(
          this.perspDist,
          Math.max(this.planet.baseRadius * 0.95, this.camera.position.distanceTo(this.perspTarget)),
        );
      } else {
        this.perspTarget.set(0, 0, 0);
      }
    }
  }

  public cancelGeneration(): void {
    this.generationToken++;
    this.isGenerating = false;
  }

  private async prewarmHighResAsync(
    onProgress: (fraction: number, detail: string) => void,
    shouldAbort: () => boolean,
  ): Promise<boolean> {
    if (!this.planet.isHighResStreaming) return true;
    this.updateCamera(1.0);
    const maxPasses = 120;
    let sliceStart = performance.now();
    let initialPending = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      if (shouldAbort()) return false;
      const batch = this.updateHighResStreaming(null, 48);
      if (!batch) break;
      if (pass === 0) {
        initialPending = Math.max(1, batch.pendingTotal + batch.rebuiltMeshes.length);
      }
      if (batch.pendingTotal === 0) break;
      if (pass >= 60 && batch.globeBuiltComplete && batch.pendingTotal < 120) break;
      if (performance.now() - sliceStart >= 8 || pass === maxPasses - 1) {
        const done = Math.max(1, initialPending - batch.pendingTotal);
        const frac = clamp(done / initialPending, 0.05, 0.99);
        onProgress(frac, `流式构建高分辨率半球表面区块 (剩余 ${batch.pendingTotal})`);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (shouldAbort()) return false;
        sliceStart = performance.now();
      }
    }
    return true;
  }

  private async rebuildAllChunksAsync(
    onProgress: (fraction: number, detail: string) => void,
    shouldAbort: () => boolean,
  ): Promise<boolean> {
    this.clearHighResMeshes();
    this.ensureMacroChunkCapacity();
    const total = this.planet.totalChunks;
    for (let i = 0; i < total; i++) {
      const existing = this.chunkMeshes[i];
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
        this.chunkMeshes[i] = null;
      }
    }
    this.chunkLod.fill(-1);
    this.planet.dirtyChunks.fill(0);

    const n = this.planet.chunksPerAxis;
    const nonUniform = this.planet.nonUniformChunks;
    const tasks: Array<{ ci: number; cx: number; cy: number; cz: number; lod: ChunkLodLevel; prio: number }> = [];
    for (let cz = 0; cz < n; cz++) {
      for (let cy = 0; cy < n; cy++) {
        for (let cx = 0; cx < n; cx++) {
          const ci = this.planet.chunkIndex(cx, cy, cz);
          if (nonUniform[ci] === 0) continue;
          const lod = this.desiredLodForChunk(ci);
          const dx = this.camera.position.x - this.chunkCenters[ci * 3];
          const dy = this.camera.position.y - this.chunkCenters[ci * 3 + 1];
          const dz = this.camera.position.z - this.chunkCenters[ci * 3 + 2];
          tasks.push({ ci, cx, cy, cz, lod, prio: dx * dx + dy * dy + dz * dz });
        }
      }
    }
    tasks.sort((a, b) => a.prio - b.prio);

    let sliceStart = performance.now();
    let builtVerts = 0;
    for (let i = 0; i < tasks.length; i++) {
      if (shouldAbort()) return false;
      const { ci, cx, cy, cz, lod } = tasks[i];
      this.planet.dirtyChunks[ci] = 0;
      this.chunkLod[ci] = lod;

      const data =
        this.config.terrainRenderMode === 'blocky'
          ? this.planet.extractBlockyChunkMesh(cx, cy, cz, lod)
          : this.planet.extractChunkMesh(cx, cy, cz, lod);

      if (data.vertexCount > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
        geo.setAttribute('aMatProps', new THREE.BufferAttribute(data.matProps, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
        geo.computeBoundingSphere();

        const mesh = new THREE.Mesh(geo, this.terrainMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = true;
        this.scene.add(mesh);
        this.chunkMeshes[ci] = mesh;
        builtVerts += data.vertexCount;
        this.totalTerrainVertices = builtVerts;
      }

      if (performance.now() - sliceStart >= 8 || i === tasks.length - 1) {
        onProgress((i + 1) / tasks.length, `提取表面区块网格 ${i + 1}/${tasks.length}`);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (shouldAbort()) return false;
        sliceStart = performance.now();
      }
    }

    let verts = 0;
    let c0 = 0;
    let c1 = 0;
    let c2 = 0;
    let culled = 0;
    for (let i = 0; i < total; i++) {
      const m = this.chunkMeshes[i];
      if (!m) {
        culled++;
      } else {
        verts += m.geometry.getAttribute('position').count;
        const l = this.chunkLod[i];
        if (l === 0) c0++;
        else if (l === 1) c1++;
        else c2++;
      }
    }
    this.totalTerrainVertices = verts;
    this.lodCounts = [c0, c1, c2, culled];
    this.activeChunks = c0 + c1 + c2;
    this.chunkBoundsDirty = true;
    return true;
  }

  public async generateWorldAsync(
    seedOrConfig?: number | Partial<PlanetSeedConfig>,
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<boolean> {
    const token = ++this.generationToken;
    const shouldAbort = () => this.isDisposed || this.generationToken !== token;
    this.isGenerating = true;

    const targetSeed: number | Partial<PlanetSeedConfig> =
      seedOrConfig !== undefined
        ? seedOrConfig
        : {
            ...this.planet.seedConfig,
            seed: Math.floor(100000 + Math.random() * 899999),
          };

    const previewSeed =
      typeof targetSeed === 'number'
        ? targetSeed
        : (targetSeed.seed ?? this.planet.seedConfig.seed);
    const previewRadius =
      typeof targetSeed === 'number'
        ? this.planet.seedConfig.radius
        : (targetSeed.radius ?? this.planet.seedConfig.radius);
    const previewVoxelRes =
      typeof targetSeed === 'number'
        ? this.planet.seedConfig.voxelRadius
        : (targetSeed.voxelRadius ?? this.planet.seedConfig.voxelRadius);

    const emit = (
      percent: number,
      stage: string,
      detail: string,
      extra?: Partial<GenerationProgress>,
    ) => {
      if (shouldAbort()) return;
      onProgress?.({
        active: true,
        percent: clamp(Math.round(percent), 0, 100),
        stage,
        detail,
        seed: previewSeed,
        radius: previewRadius,
        voxelRadius: previewVoxelRes,
        waterParticles: this.fluid.activeCount,
        terrainVertices: this.totalTerrainVertices,
        ...extra,
      });
    };

    try {
      let lastPreviewRenderMs = 0;
      const renderGenFrame = (force = false) => {
        if (!this.renderer || !this.scene || !this.camera || shouldAbort()) return;
        const now = performance.now();
        if (!force && now - lastPreviewRenderMs < (this.isSoftware ? 160 : 75)) return;
        lastPreviewRenderMs = now;
        this.simTimeSec += 0.04;
        this.simTimeNode.value = this.simTimeSec;
        this.titleAngle += 0.055;
        if (this.genCoreGroup && this.genCoreGroup.visible) {
          this.genCoreGroup.rotation.y += 0.08;
          this.genCoreGroup.rotation.x = Math.sin(this.simTimeSec * 0.8) * 0.18;
        }
        const camR = Math.max(previewRadius, 4);
        this.camera.position.set(
          Math.cos(this.titleAngle) * 2.75 * camR,
          0.82 * camR,
          Math.sin(this.titleAngle) * 2.75 * camR,
        );
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(0, 0, 0);
        this.updateDynamicShadowFrustum(0, 0, 0, 2.75 * camR);
        this.renderActiveScene();
      };

      // Clear previous terrain & activate visual planetary core accretion rig on open 3D canvas
      this.clearHighResMeshes();
      for (let i = 0; i < this.chunkMeshes.length; i++) {
        const m = this.chunkMeshes[i];
        if (m) {
          this.scene?.remove(m);
          m.geometry.dispose();
          this.chunkMeshes[i] = null;
        }
      }
      this.totalTerrainVertices = 0;
      this.fluid.clear();
      this.rebuildWaterMesh();
      this.lastSeaHidden = false;
      this.updateSplashInstances();
      this.setPlanetRigVisible(false);
      if (this.genCoreGroup) {
        this.genCoreGroup.visible = true;
        this.genCoreGroup.scale.setScalar(Math.max(previewRadius * 0.34, 0.5));
      }

      emit(2, '初始化地形参数场', '构建 3D 连续噪声与陨坑上下文', { phaseIndex: 0 });
      renderGenFrame(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (shouldAbort()) return false;

      const okVoxel = await this.planet.generatePlanetAsync(
        targetSeed,
        (fraction, detail) => {
          if (this.genCoreGroup) {
            this.genCoreGroup.scale.setScalar(previewRadius * (0.34 + fraction * 0.62));
          }
          emit(4 + fraction * 36, '合成体素密度场', detail, { phaseIndex: 0 });
          renderGenFrame();
        },
        shouldAbort,
      );
      if (!okVoxel || shouldAbort()) return false;

      if (this.genCoreGroup) {
        // Keep glowing planetary core visible beneath emerging crust chunks until surface seals
        this.genCoreGroup.scale.setScalar(previewRadius * 0.72);
      }
      this.rebuildChunkCenters();
      this.syncScaleDependentRig();
      this.resetPlayerToSpawn();
      // Reveal atmosphere shells & incremental terrain emergence live in 3D
      this.setPlanetRigVisible(true);

      const estNonUniform = Math.max(1, this.planet.nonUniformChunks.reduce((acc, v) => acc + (v > 0 ? 1 : 0), 0));
      const okMesh = await this.rebuildAllChunksAsync((fraction, detail) => {
        emit(40 + fraction * 28, '提取分块等值面几何', detail, {
          phaseIndex: 1,
          builtChunks: Math.round(fraction * estNonUniform),
          totalChunks: estNonUniform,
        });
        renderGenFrame(fraction >= 0.99);
      }, shouldAbort);
      if (!okMesh || shouldAbort()) return false;

      if (this.genCoreGroup) {
        this.genCoreGroup.visible = false;
      }

      let lastWaterVisualMs = 0;
      const okFluid = await this.fluid.seedInitialLakesAsync(
        this.planet,
        (fraction, detail) => {
          const now = performance.now();
          if (now - lastWaterVisualMs >= 90 || fraction >= 0.99) {
            this.rebuildWaterMesh();
            this.updateSplashInstances();
            lastWaterVisualMs = now;
            renderGenFrame(fraction >= 0.99);
          }
          emit(68 + fraction * 16, '注水与静水压平衡', detail, {
            phaseIndex: 2,
          });
        },
        shouldAbort,
      );
      if (!okFluid || shouldAbort()) return false;

      emit(85, '合成地表水体网格', '提取平滑水面与流体粒子', { phaseIndex: 2 });
      this.rebuildWaterMesh();
      this.updateSplashInstances();
      renderGenFrame(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (shouldAbort()) return false;

      const okHiRes = await this.prewarmHighResAsync((fraction, detail) => {
        emit(86 + fraction * 13, '构建全视角高分辨率表面', detail, { phaseIndex: 3 });
        renderGenFrame();
      }, shouldAbort);
      if (!okHiRes || shouldAbort()) return false;

      this.refreshGravityVisualizer();
      this.bindMetabolismToCurrentPlanet();

      this.hasWorld = true;
      this.setPlanetRigVisible(true);
      this.telemetryTimer = 1;
      if (this.renderer) {
        this.emitTelemetrySnapshot();
      }
      emit(100, '星球生成完毕', '进入行星表面工作区', { phaseIndex: 3 });
      return true;
    } finally {
      if (this.genCoreGroup) {
        this.genCoreGroup.visible = false;
      }
      if (this.generationToken === token) {
        this.isGenerating = false;
      }
    }
  }

  public async applySavePayloadAsync(
    payload: PlanetSavePayload,
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<boolean> {
    const token = ++this.generationToken;
    const shouldAbort = () => this.isDisposed || this.generationToken !== token;
    this.isGenerating = true;

    const cfg = payload.planet.seedConfig;
    const emit = (percent: number, stage: string, detail: string) => {
      if (shouldAbort()) return;
      onProgress?.({
        active: true,
        percent: clamp(Math.round(percent), 0, 100),
        stage,
        detail,
        seed: cfg.seed,
        radius: cfg.radius,
        voxelRadius: cfg.voxelRadius ?? 18,
      });
    };

    try {
      emit(10, '读取持久化体素存档', `恢复种子 #${cfg.seed} 体素与修改块`);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (shouldAbort()) return false;

      this.lastSeaHidden = false;
      this.planet.importSnapshot(payload.planet);
      this.rebuildChunkCenters();
      this.syncScaleDependentRig();
      this.fluid.importState(payload.fluid);

      if (payload.playerPos) {
        this.playerPos.set(payload.playerPos[0], payload.playerPos[1], payload.playerPos[2]);
      } else {
        this.resetPlayerToSpawn();
      }
      if (payload.playerFwd) {
        this.playerFwd.set(payload.playerFwd[0], payload.playerFwd[1], payload.playerFwd[2]).normalize();
      }
      this.playerVel.set(0, 0, 0);
      this.syncPlayerTransform();

      const okMesh = await this.rebuildAllChunksAsync((fraction, detail) => {
        emit(20 + fraction * 58, '重建存档区块网格', detail);
      }, shouldAbort);
      if (!okMesh || shouldAbort()) return false;

      emit(80, '重建水面与流体系统', '恢复 SPH 流体粒子');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (shouldAbort()) return false;

      this.rebuildWaterMesh();
      this.updateSplashInstances();

      const okHiRes = await this.prewarmHighResAsync((fraction, detail) => {
        emit(82 + fraction * 16, '重建全视角高分辨率表面', detail);
      }, shouldAbort);
      if (!okHiRes || shouldAbort()) return false;

      this.updateConfig({
        gravityScale: payload.gravityScale ?? this.config.gravityScale,
        sunElevationDeg: payload.sunElevationDeg ?? this.config.sunElevationDeg,
        sunAzimuthDeg: payload.sunAzimuthDeg ?? this.config.sunAzimuthDeg,
      });
      this.refreshGravityVisualizer();
      this.bindMetabolismToCurrentPlanet();
      this.hasWorld = true;
      this.setPlanetRigVisible(true);
      this.telemetryTimer = 1;
      emit(100, '存档恢复完成', '进入行星表面工作区');
      return true;
    } finally {
      if (this.generationToken === token) {
        this.isGenerating = false;
      }
    }
  }

  public resetPlanet(seedOrConfig?: number | Partial<PlanetSeedConfig>): void {
    this.lastSeaHidden = false;
    const targetSeed =
      seedOrConfig !== undefined
        ? seedOrConfig
        : {
            ...this.planet.seedConfig,
            seed: Math.floor(100000 + Math.random() * 899999),
          };
    this.planet.generatePlanet(targetSeed);
    this.rebuildChunkCenters();
    this.syncScaleDependentRig();
    this.resetPlayerToSpawn();
    this.rebuildAllChunks();
    this.fluid.seedInitialLakes(this.planet);
    this.rebuildWaterMesh();
    this.updateSplashInstances();
    this.refreshGravityVisualizer();
    this.bindMetabolismToCurrentPlanet();
    this.hasWorld = true;
    this.setPlanetRigVisible(true);
    this.telemetryTimer = 1;
    if (this.renderer) {
      this.emitTelemetrySnapshot();
    }
  }

  public regenerateWithSeed(seedConfig: PlanetSeedConfig): void {
    this.resetPlanet(seedConfig);
  }

  public clearWater(): void {
    this.lastSeaHidden = true;
    this.fluid.clear();
    this.clearDynamicEntities();
    this.updateSplashInstances();
    this.rebuildWaterMesh();
  }

  public getVoxelStats(): VoxelFormatStats {
    return this.planet.getVoxelStats();
  }

  public getEffectiveRenderQuality(): RenderQualityConfig {
    return { ...this.config.renderQuality };
  }

  public exportSavePayload(id: string, name: string): PlanetSavePayload {
    return {
      id,
      name,
      updatedAt: Date.now(),
      planet: this.planet.exportSnapshot(),
      fluid: this.fluid.exportState(),
      playerPos: [this.playerPos.x, this.playerPos.y, this.playerPos.z],
      playerFwd: [this.playerFwd.x, this.playerFwd.y, this.playerFwd.z],
      gravityScale: this.config.gravityScale,
      sunElevationDeg: this.config.sunElevationDeg,
      sunAzimuthDeg: this.config.sunAzimuthDeg,
    };
  }

  public applySavePayload(payload: PlanetSavePayload): void {
    this.lastSeaHidden = false;
    this.planet.importSnapshot(payload.planet);
    this.rebuildChunkCenters();
    this.syncScaleDependentRig();
    this.fluid.importState(payload.fluid);

    if (payload.playerPos) {
      this.playerPos.set(payload.playerPos[0], payload.playerPos[1], payload.playerPos[2]);
    } else {
      this.resetPlayerToSpawn();
    }
    if (payload.playerFwd) {
      this.playerFwd.set(payload.playerFwd[0], payload.playerFwd[1], payload.playerFwd[2]).normalize();
    }
    this.playerVel.set(0, 0, 0);
    this.syncPlayerTransform();

    this.rebuildAllChunks();
    this.rebuildWaterMesh();
    this.updateSplashInstances();

    this.updateConfig({
      gravityScale: payload.gravityScale ?? this.config.gravityScale,
      sunElevationDeg: payload.sunElevationDeg ?? this.config.sunElevationDeg,
      sunAzimuthDeg: payload.sunAzimuthDeg ?? this.config.sunAzimuthDeg,
    });
    this.refreshGravityVisualizer();
    this.bindMetabolismToCurrentPlanet();
    this.hasWorld = true;
    this.setPlanetRigVisible(true);
    this.telemetryTimer = 1;
  }

  public setPhase(phase: GamePhase): void {
    this.phase = phase;
    if (this.playerGroup) {
      this.playerGroup.visible =
        this.hasWorld && phase !== 'title' && this.config.cameraMode !== 'firstPerson';
    }
    if (phase !== 'playing') {
      this.keys.clear();
      this.isSculpting = false;
      this.isDraggingOrbit = false;
      this.releaseTractorBeam();
      if (this.brushPreview) {
        this.brushPreview.visible = false;
      }
    }
  }

  private syncEnvironmentUniforms(): void {
    const atmo = this.config.atmosphere;
    const th = this.config.thermal;
    this.isBlockyNode.value = this.config.terrainRenderMode === 'blocky' ? 1.0 : 0.0;
    this.voxelEdgesNode.value = this.config.voxelEdges ? 1.0 : 0.0;
    this.overlayModeNode.value =
      this.config.terrainOverlay === 'temperature'
        ? 1.0
        : this.config.terrainOverlay === 'density'
          ? 2.0
          : this.config.terrainOverlay === 'metabolism'
            ? 3.0
            : 0.0;

    this.atmoEnabledNode.value = atmo.enabled ? 1.0 : 0.0;
    this.atmoDensityNode.value = atmo.surfacePressureAtm;
    this.rayleighNode.value = atmo.rayleighStrength;
    this.mieNode.value = atmo.mieHaze;
    this.cloudCoverNode.value = atmo.cloudCover;
    this.windSpeedNode.value = atmo.windSpeed;
    this.scaleHeightNode.value = Math.max(0.02, atmo.scaleHeightRatio);
    this.greenhouseNode.value = computeGreenhouseBoostC(atmo);

    this.solarRatioNode.value = Math.max(
      0.0,
      (th.solarIrradiance / 1361.0) * this.activeSolarIntensity,
    );
    this.solarIntensityNode.value = clamp(this.activeSolarIntensity, 0.05, 4.5);
    if (this.sunLight && !this.directorTimelineLocked) {
      this.sunLight.intensity = 3.25 * clamp(this.activeSolarIntensity, 0.05, 4.5);
    }
    this.coreTempNode.value = th.coreTempC;
    this.lapseRateNode.value = th.lapseRateCPerScale;

    if (this.cloudShellMesh) {
      this.cloudShellMesh.visible = atmo.enabled && atmo.cloudCover > 0.01;
      const cloudRScale =
        (this.planet.baseRadius * (1 + atmo.cloudAltitudeRatio)) / 15.2;
      this.cloudShellMesh.scale.setScalar(cloudRScale);
    }
    if (this.cloudPuffsMesh) {
      this.cloudPuffsMesh.visible = atmo.enabled && atmo.cloudCover > 0.04;
    }
    if (this.atmoMesh) {
      this.atmoMesh.visible = atmo.enabled && atmo.surfacePressureAtm > 0.005;
      const atmoHeightScale =
        1.0 + Math.max(0.05, atmo.scaleHeightRatio) * 1.4;
      this.atmoMesh.scale.setScalar(
        this.getPlanetScale() * (atmoHeightScale / 1.196),
      );
    }
    if (this.atmoInnerMesh) {
      this.atmoInnerMesh.visible = atmo.enabled && atmo.surfacePressureAtm > 0.005;
    }

    const rq = this.config.renderQuality;
    this.pbrEnhancedNode.value = rq.pbrEnhanced ? 1.0 : 0.0;
    this.pbrReliefDepthNode.value = rq.pbrReliefDepth ?? (rq.pbrEnhanced ? 1.15 : 0.0);
    this.nativeVoxelSizeNode.value = this.planet.nativeVoxelSize;
    this.volFogEnabledNode.value = rq.volumetricFog ? 1.0 : 0.0;
    this.atmoScatterEnabledNode.value = rq.atmoScattering ? 1.0 : 0.0;
    this.volStepsNode.value = rq.volumetricSteps;
    this.contactShadowNode.value = rq.contactShadows ? 1.0 : 0.0;
    this.bloomEnabledNode.value = rq.bloomEnabled ? 1.0 : 0.0;
    const volumetricActive =
      Boolean(this.renderPipeline) &&
      !this.pipelineFailed &&
      (rq.atmoScattering || rq.volumetricFog);
    this.legacyAtmoShellScaleNode.value = volumetricActive ? 0.34 : 1.0;
    if (this.scene) {
      this.scene.environmentIntensity = rq.pbrEnhanced ? 0.42 : 0.24;
    }
  }

  private updateCloudPuffs(dt: number): void {
    if (!this.cloudPuffsMesh) return;
    const atmo = this.config.atmosphere;
    if (!atmo.enabled || atmo.cloudCover <= 0.04) {
      this.cloudPuffsMesh.count = 0;
      return;
    }

    const scale = this.getPlanetScale();
    const visibleCount = Math.min(
      this.CLOUD_PUFF_COUNT,
      Math.max(0, Math.round(clamp(atmo.cloudCover, 0, 2.0) * 44)),
    );
    this.cloudPuffsMesh.count = visibleCount;

    const baseCloudR = this.planet.baseRadius * (1 + atmo.cloudAltitudeRatio);
    const upDefault = this._v4.set(0, 1, 0);

    for (let i = 0; i < visibleCount; i++) {
      const c = this.cloudSeeds[i];
      const zonalSign = Math.cos(c.lat * 3.0);
      if (dt > 0) {
        c.lon += zonalSign * 0.065 * atmo.windSpeed * dt;
      }
      const r =
        baseCloudR +
        (c.altJitter + Math.sin(this.simTimeSec * 0.4 + c.phase) * 0.015) *
          this.planet.baseRadius;
      const [dx, dy, dz] = lonLatToDir(c.lon, c.lat);
      this._v1.set(dx * r, dy * r, dz * r);
      this._v2.set(dx, dy, dz).normalize();
      this._q1.setFromUnitVectors(upDefault, this._v2);

      const puffScale = clamp(atmo.cloudCover * 0.72 + 0.32, 0.3, 1.85) * scale;
      this._s1.set(c.sx * puffScale, c.sy * puffScale, c.sz * puffScale);
      this._m4.compose(this._v1, this._q1, this._s1);
      this.cloudPuffsMesh.setMatrixAt(i, this._m4);
    }
    this.cloudPuffsMesh.instanceMatrix.needsUpdate = true;
  }

  public teleportToLatLon(latDeg: number, lonDeg: number): void {
    const latRad = (clamp(latDeg, -89.5, 89.5) * Math.PI) / 180;
    const lonRad = (lonDeg * Math.PI) / 180;
    const [dx, dy, dz] = lonLatToDir(lonRad, latRad);
    const surfR = this.planet.findSurfaceRadiusAlongRay(dx, dy, dz);
    const scale = this.getPlanetScale();

    if (this.config.cameraMode === 'fps') {
      const targetR = surfR + 3.2 * scale;
      this.fpsPos.set(dx * targetR, dy * targetR, dz * targetR);
      this.camPosSmooth.copy(this.fpsPos);
    } else if (this.config.cameraMode === 'orbit') {
      this.orbitYaw = Math.atan2(dz, dx);
      this.orbitPitch = clamp(latRad, -1.35, 1.35);
    }

    const metrics = this.getPlayerMetrics();
    const spawnR = surfR + Math.max(metrics.footRadius * 2.2, 0.25 * scale);
    this.playerPos.set(dx * spawnR, dy * spawnR, dz * spawnR);
    this.playerVel.set(0, 0, 0);
    parallelTransportTangentFrame(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this.playerFwd,
      this._upLike,
      this._fwdLike,
      this._rightLike,
    );
    this.playerUp.set(this._upLike.x, this._upLike.y, this._upLike.z);
    this.playerFwd.set(this._fwdLike.x, this._fwdLike.y, this._fwdLike.z);
    this.playerRight.set(this._rightLike.x, this._rightLike.y, this._rightLike.z);
    this.explorerCamAnchor.copy(this.playerPos);
    const basis = transportCameraForwardOnSphere(
      [this.playerUp.x, this.playerUp.y, this.playerUp.z],
      [this.explorerCamFwd.x, this.explorerCamFwd.y, this.explorerCamFwd.z],
      0,
    );
    this.explorerCamFwd.set(basis.forward[0], basis.forward[1], basis.forward[2]);
    this.syncPlayerTransform();
    if (this.hasWorld && this.renderer) {
      this.emitTelemetrySnapshot();
    }
  }

  public setOnMaterialPicked(cb: ((mat: MaterialId) => void) | null): void {
    this.onMaterialPicked = cb;
  }

  public setOnSurveyAction(
    cb:
      | ((action: {
          kind: SurveyToolKind;
          worldPos: [number, number, number];
          normal: [number, number, number];
          attitude: GeologicalAttitude;
          hasWater: boolean;
        }) => void)
      | null,
  ): void {
    this.onSurveyAction = cb;
  }

  public getCoordDatum(): CoordDatum {
    return {
      planetRadius: this.planet.baseRadius,
      nativeVoxelSize: this.planet.nativeVoxelSize,
      enuOrigin: this.config.enuOrigin,
    };
  }

  public sampleAttitudeAt(wx: number, wy: number, wz: number): GeologicalAttitude {
    const sunDirArr: [number, number, number] = [
      this.sunDirUniform.x,
      this.sunDirUniform.y,
      this.sunDirUniform.z,
    ];
    return measureGeologicalAttitude(
      this.planet,
      this.fluid,
      this.getGravityParams(),
      this.config.atmosphere,
      this.config.thermal,
      sunDirArr,
      this.simTimeSec,
      wx,
      wy,
      wz,
    );
  }

  public sampleTransectBetween(
    pointA: [number, number, number],
    pointB: [number, number, number],
    numSamples = 80,
  ): GeologicalTransectReport {
    const sunDirArr: [number, number, number] = [
      this.sunDirUniform.x,
      this.sunDirUniform.y,
      this.sunDirUniform.z,
    ];
    return sampleGeologicalTransect(
      this.planet,
      this.fluid,
      pointA,
      pointB,
      this.config.atmosphere,
      this.config.thermal,
      sunDirArr,
      this.simTimeSec,
      numSamples,
    );
  }

  public sampleBoreholeAt(
    wx: number,
    wy: number,
    wz: number,
    maxDepthM?: number,
  ): BoreholeLogReport {
    const sunDirArr: [number, number, number] = [
      this.sunDirUniform.x,
      this.sunDirUniform.y,
      this.sunDirUniform.z,
    ];
    return sampleBoreholeColumn(
      this.planet,
      wx,
      wy,
      wz,
      this.config.atmosphere,
      this.config.thermal,
      sunDirArr,
      this.simTimeSec,
      maxDepthM,
    );
  }

  public teleportToWorldPos(wx: number, wy: number, wz: number): void {
    const r = Math.hypot(wx, wy, wz);
    if (r < 1e-4) return;
    const ux = wx / r;
    const uy = wy / r;
    const uz = wz / r;
    const latRad = Math.asin(clamp(uy, -1, 1));
    const surfR = this.planet.findSurfaceRadiusAlongRay(ux, uy, uz);
    const scale = this.getPlanetScale();
    const metrics = this.getPlayerMetrics();
    const targetR = Math.max(r, surfR + Math.max(metrics.footRadius * 2.2, 0.25 * scale));

    this.playerPos.set(ux * targetR, uy * targetR, uz * targetR);
    this.playerVel.set(0, 0, 0);
    parallelTransportTangentFrame(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this.playerFwd,
      this._upLike,
      this._fwdLike,
      this._rightLike,
    );
    this.playerUp.set(this._upLike.x, this._upLike.y, this._upLike.z);
    this.playerFwd.set(this._fwdLike.x, this._fwdLike.y, this._fwdLike.z);
    this.playerRight.set(this._rightLike.x, this._rightLike.y, this._rightLike.z);
    this.explorerCamAnchor.copy(this.playerPos);
    const basis = transportCameraForwardOnSphere(
      [this.playerUp.x, this.playerUp.y, this.playerUp.z],
      [this.explorerCamFwd.x, this.explorerCamFwd.y, this.explorerCamFwd.z],
      0,
    );
    this.explorerCamFwd.set(basis.forward[0], basis.forward[1], basis.forward[2]);

    if (this.config.cameraMode === 'orbit') {
      this.orbitYaw = Math.atan2(uz, ux);
      this.orbitPitch = clamp(latRad, -1.35, 1.35);
    } else if (this.config.cameraMode === 'detail') {
      this.detailTarget.set(ux * surfR, uy * surfR, uz * surfR);
      this.detailNormal.set(ux, uy, uz);
    } else if (this.config.cameraMode === 'fps') {
      const standR = surfR + 3.2 * scale;
      this.fpsPos.set(ux * standR, uy * standR, uz * standR);
      this.camPosSmooth.copy(this.fpsPos);
    } else if (this.config.cameraMode === 'perspective') {
      this.perspTarget.set(ux * surfR, uy * surfR, uz * surfR);
    }
    this.syncPlayerTransform();
    if (this.hasWorld && this.renderer) {
      this.emitTelemetrySnapshot();
    }
  }

  public updateConfig(partial: Partial<SandboxConfig>): void {
    const prevSunEl = this.config.sunElevationDeg;
    const prevSunAz = this.config.sunAzimuthDeg;
    const prevGrav = this.config.gravityScale;
    const prevShowGrav = this.config.showGravityVectors;
    const prevCamMode = this.config.cameraMode;
    const prevWireframe = this.config.wireframe;
    const prevChunkBounds = this.config.showChunkBounds;
    const prevLodMode = this.config.lodMode;
    const prevRenderMode = this.config.terrainRenderMode;
    const prevCoordSystem = this.config.coordSystem;
    const prevShowCoordGrid = this.config.showCoordGrid;
    const prevEnuOrigin = this.config.enuOrigin;

    const prevLod0Dist = this.config.lod0Dist;
    const prevLod1Dist = this.config.lod1Dist;

    const prevPlayerScale = clampPlayerScale(this.config.playerScale);
    const nextPlayerScale =
      partial.playerScale !== undefined
        ? clampPlayerScale(partial.playerScale)
        : prevPlayerScale;

    this.config = {
      ...this.config,
      ...partial,
      playerScale: nextPlayerScale,
      atmosphere: partial.atmosphere
        ? { ...this.config.atmosphere, ...partial.atmosphere }
        : this.config.atmosphere,
      thermal: partial.thermal
        ? { ...this.config.thermal, ...partial.thermal }
        : this.config.thermal,
      renderQuality: partial.renderQuality
        ? { ...this.config.renderQuality, ...partial.renderQuality }
        : this.config.renderQuality,
    };
    this.sound.setMuted(this.config.muted);

    if (partial.playerScale !== undefined && Math.abs(nextPlayerScale - prevPlayerScale) > 1e-4) {
      const nextMetrics = this.getPlayerMetrics();
      const ratio = nextPlayerScale / Math.max(prevPlayerScale, 0.01);
      this.camDistance = clamp(
        this.camDistance * ratio,
        nextMetrics.minExplorerCamDist,
        nextMetrics.maxExplorerCamDist,
      );
      if (this.hasWorld) {
        const dFoot = this.planet.sampleDensityAndNormal(
          this.playerPos.x,
          this.playerPos.y,
          this.playerPos.z,
          this._normalArr,
        );
        if (dFoot > -nextMetrics.footRadius) {
          const pen = dFoot + nextMetrics.footRadius;
          this.playerPos.x += this._normalArr[0] * pen;
          this.playerPos.y += this._normalArr[1] * pen;
          this.playerPos.z += this._normalArr[2] * pen;
        }
        this.syncPlayerTransform();
      }
    }

    if (prevCamMode !== this.config.cameraMode) {
      this.isSculpting = false;
      this.isDraggingOrbit = false;
      this.isPanningCamera = false;
      this.releaseTractorBeam();
      if (this.config.cameraMode === 'fps') {
        this.syncFpsPoseFromActiveCamera();
      } else if (this.config.cameraMode === 'detail') {
        this.initDetailCamera(this.pointerActive);
      } else if (this.config.cameraMode === 'landing') {
        this.initLandingCamera();
      } else if (this.config.cameraMode === 'perspective') {
        this.initPerspectiveCamera();
      } else if (this.config.cameraMode === 'explorer' || this.config.cameraMode === 'firstPerson') {
        this.explorerCamAnchor.copy(this.playerPos);
        if (prevCamMode !== 'explorer' && prevCamMode !== 'firstPerson' && this.camera) {
          this.camera.getWorldDirection(this._v1);
          const basis = transportCameraForwardOnSphere(
            [this.playerUp.x, this.playerUp.y, this.playerUp.z],
            [this._v1.x, this._v1.y, this._v1.z],
            0,
          );
          this.explorerCamFwd.set(basis.forward[0], basis.forward[1], basis.forward[2]);
          if (this.config.cameraMode === 'firstPerson') {
            this.firstPersonPitch = clamp(
              Math.asin(clamp(this._v1.dot(this.playerUp), -0.92, 0.96)),
              -1.42,
              1.48,
            );
          }
        } else if (this.config.cameraMode === 'firstPerson' && prevCamMode === 'explorer') {
          this.firstPersonPitch = 0.08;
        }
      }
      if (this.playerGroup) {
        this.playerGroup.visible =
          this.hasWorld && this.phase !== 'title' && this.config.cameraMode !== 'firstPerson';
      }
      if (this.camera && this.config.cameraMode !== 'detail' && this.config.cameraMode !== 'perspective') {
        this.camera.fov = 52;
        this.camera.updateProjectionMatrix();
      }
    }

    if (
      this.camera &&
      this.config.cameraMode === 'perspective' &&
      partial.perspectiveFov !== undefined
    ) {
      this.camera.fov = clamp(this.config.perspectiveFov, 18, 115);
      this.camera.updateProjectionMatrix();
    }

    if (
      (partial.sunElevationDeg !== undefined && partial.sunElevationDeg !== prevSunEl) ||
      (partial.sunAzimuthDeg !== undefined && partial.sunAzimuthDeg !== prevSunAz)
    ) {
      this.updateSunDirection();
    }
    if (
      (partial.gravityScale !== undefined && partial.gravityScale !== prevGrav) ||
      (partial.showGravityVectors !== undefined && partial.showGravityVectors !== prevShowGrav)
    ) {
      this.refreshGravityVisualizer();
    }

    if (this.terrainMaterial && this.config.wireframe !== prevWireframe) {
      this.terrainMaterial.wireframe = this.config.wireframe;
      this.terrainMaterial.needsUpdate = true;
      for (const m of [
        this.highResGlobeMaterial,
        this.highResHemiMaterial,
        this.highResMidOuterMaterial,
        this.highResMidMaterial,
        this.highResNativeMaterial,
      ]) {
        if (m) {
          m.wireframe = this.config.wireframe;
          m.needsUpdate = true;
        }
      }
    }

    if (this.chunkBoundsLines && this.config.showChunkBounds !== prevChunkBounds) {
      this.chunkBoundsLines.visible = this.config.showChunkBounds;
      if (this.config.showChunkBounds) {
        this.chunkBoundsDirty = true;
      }
    }

    if (this.coordGridGroup) {
      this.coordGridGroup.visible = this.config.showCoordGrid;
      if (this.config.showCoordGrid) {
        this.rebuildCoordGridOverlay();
      }
    }

    if (
      (this.config.coordSystem !== prevCoordSystem ||
        this.config.showCoordGrid !== prevShowCoordGrid ||
        this.config.enuOrigin !== prevEnuOrigin) &&
      this.hasWorld &&
      this.renderer
    ) {
      queueMicrotask(() => {
        if (!this.isDisposed && this.hasWorld && this.renderer) {
          this.emitTelemetrySnapshot();
        }
      });
    }

    if (
      (partial.renderQuality ||
        partial.visualFilter !== undefined ||
        partial.filterIntensity !== undefined ||
        partial.filterScale !== undefined) &&
      this.renderer
    ) {
      if (partial.renderQuality) {
        this.applyShadowQualitySettings();
      }
      this.syncRenderPipeline(this.isOfflineRendering);
      if (!this.isOfflineRendering && !this.isGenerating) {
        this.renderActiveScene();
      }
    }

    this.syncEnvironmentUniforms();
    this.syncCouplingZoneLines();
    this.syncMetabolismReadOnlyVisuals(false);

    if (this.config.terrainRenderMode !== prevRenderMode && this.scene) {
      this.rebuildAllChunks();
      this.rebuildWaterMesh();
    } else if (
      (this.config.lodMode !== prevLodMode ||
        this.config.lod0Dist !== prevLod0Dist ||
        this.config.lod1Dist !== prevLod1Dist) &&
      this.scene
    ) {
      this.updateChunksWithLod(this.planet.totalChunks);
      if (this.planet.isHighResStreaming) {
        for (let pass = 0; pass < 16; pass++) {
          const b = this.updateHighResStreaming(null, 56);
          if (!b || b.pendingTotal === 0) break;
        }
      }
    }

    const attrs = this.getActiveToolAttrs();
    if (attrs.behavior !== 'tractorBeam' && this.isTractorDragging) {
      this.releaseTractorBeam();
    }
    this.brushColorNode.value.set(attrs.colorHex);
    this.laserBeamColorNode.value.set(attrs.colorHex);
    this.laserImpactColorNode.value.set(attrs.colorHex);
    this.tractorBeamColorNode.value.set(attrs.colorHex);
  }

  private getActiveToolAttrs(): ToolAttributes {
    return (
      this.config.toolAttributes ??
      resolveToolDefinition(this.config.tool).attributes
    );
  }

  public setTouchEnabled(enabled: boolean): void {
    this.touchEnabled = enabled;
    if (!enabled) {
      this.virtualMoveX = 0;
      this.virtualMoveY = 0;
      this.virtualUp = false;
      this.virtualDown = false;
      this.activeTouches.clear();
      this.prevPinchDist = 0;
    }
  }

  public setTouchActionMode(mode: 'sculpt' | 'look'): void {
    this.touchActionMode = mode;
  }

  public setVirtualJoystick(x: number, y: number): void {
    this.virtualMoveX = clamp(x, -1, 1);
    this.virtualMoveY = clamp(y, -1, 1);
  }

  public setVirtualVertical(up: boolean, down: boolean): void {
    this.virtualUp = up;
    this.virtualDown = down;
  }

  public triggerVirtualJump(): void {
    if (this.phase !== 'playing') return;
    if (this.config.cameraMode === 'explorer' || this.config.cameraMode === 'firstPerson') {
      this.jumpQueued = true;
    } else if (this.config.cameraMode === 'landing' && this.landingStage === 'landed') {
      this.landingJumpQueued = true;
    }
  }

  private updateSunDirection(): void {
    const el = THREE.MathUtils.degToRad(this.config.sunElevationDeg);
    const az = THREE.MathUtils.degToRad(this.config.sunAzimuthDeg);
    const cosEl = Math.cos(el);
    this.sunDirUniform
      .set(cosEl * Math.cos(az), Math.sin(el), cosEl * Math.sin(az))
      .normalize();
    this.sunDirNode.value.copy(this.sunDirUniform);

    const scale = this.getPlanetScale();
    if (this.sunLight && this.sunOrbMesh) {
      this.sunLight.position
        .copy(this.sunLight.target.position)
        .addScaledVector(this.sunDirUniform, 42 * scale);
      this.sunOrbMesh.position.copy(this.sunDirUniform).multiplyScalar(115 * scale);
    }
  }

  private applyShadowQualitySettings(): void {
    if (!this.sunLight) return;
    const sq = this.config.renderQuality.shadowQuality;
    const mapSize = resolveShadowMapSize(
      sq,
      this.backendDiagnostic.maxTextureDim,
      this.isSoftware,
    );
    if (mapSize !== this.currentShadowMapSize) {
      this.currentShadowMapSize = mapSize;
      this.sunLight.shadow.mapSize.set(mapSize, mapSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
    const scale = this.getPlanetScale();
    if (sq === 'ultra') {
      this.sunLight.shadow.bias = -0.00025;
      this.sunLight.shadow.normalBias = 0.018 * scale;
      this.sunLight.shadow.radius = 2.6;
    } else if (sq === 'high') {
      this.sunLight.shadow.bias = -0.00038;
      this.sunLight.shadow.normalBias = 0.026 * scale;
      this.sunLight.shadow.radius = 2.2;
    } else {
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.035 * scale;
      this.sunLight.shadow.radius = 1.5;
    }
  }

  private updateDynamicShadowFrustum(
    focusX: number,
    focusY: number,
    focusZ: number,
    viewDistance: number,
  ): void {
    if (!this.sunLight) return;
    const sol = computeTightShadowFrustum(
      this.planet.baseRadius,
      this.planet.nativeVoxelSize,
      focusX,
      focusY,
      focusZ,
      viewDistance,
      this.config.renderQuality.shadowQuality,
    );
    const scale = this.getPlanetScale();
    this.sunLight.target.position.set(sol.centerX, sol.centerY, sol.centerZ);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.position
      .set(sol.centerX, sol.centerY, sol.centerZ)
      .addScaledVector(this.sunDirUniform, 42 * scale);

    const spanDelta = Math.abs(sol.halfSpan - this.lastShadowHalfSpan) / Math.max(sol.halfSpan, 1e-4);
    const moveDelta = Math.hypot(
      sol.centerX - this.lastShadowCenter.x,
      sol.centerY - this.lastShadowCenter.y,
      sol.centerZ - this.lastShadowCenter.z,
    );
    if (spanDelta > 0.03 || moveDelta > sol.halfSpan * 0.04) {
      this.lastShadowHalfSpan = sol.halfSpan;
      this.lastShadowCenter.set(sol.centerX, sol.centerY, sol.centerZ);
      this.sunLight.shadow.camera.left = -sol.halfSpan;
      this.sunLight.shadow.camera.right = sol.halfSpan;
      this.sunLight.shadow.camera.top = sol.halfSpan;
      this.sunLight.shadow.camera.bottom = -sol.halfSpan;
      this.sunLight.shadow.camera.near = sol.near;
      this.sunLight.shadow.camera.far = sol.far;
      this.sunLight.shadow.camera.updateProjectionMatrix();
    }
  }

  private disposeRenderPipeline(): void {
    for (const n of this.pipelineDisposables) {
      try {
        n.dispose?.();
      } catch {
        // Ignore disposal error on already-freed nodes
      }
    }
    this.pipelineDisposables = [];
    if (this.renderPipeline) {
      try {
        this.renderPipeline.dispose();
      } catch {
        // Ignore
      }
      this.renderPipeline = null;
    }
    this.activeSsgiNode = null;
    this.activeSsrNode = null;
    this.activeAoNode = null;
    this.activeBloomNode = null;
    this.activeDenoiseNodes = [];
    this.activePipelineKey = '';
  }

  private syncRenderPipeline(isOffline: boolean, offlineRenderW = 1920): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const rq = this.config.renderQuality;
    const effectiveFilter: DirectorVisualFilter =
      this.activeVisualFilter !== 'none'
        ? this.activeVisualFilter
        : (this.config.visualFilter ?? 'none');
    const effectiveFilterIntensity =
      this.activeVisualFilter !== 'none'
        ? this.activeFilterIntensity
        : clamp(this.config.filterIntensity ?? 0.85, 0, 1);
    const effectiveFilterScale =
      this.activeVisualFilter !== 'none'
        ? this.activeFilterScale
        : clamp(this.config.filterScale ?? 1.0, 0.25, 3.0);

    const filterMeta = VISUAL_FILTER_META.find((m) => m.id === effectiveFilter);
    this.postFilterModeNode.value = filterMeta?.modeIndex ?? 0;
    this.postFilterIntensityNode.value = effectiveFilterIntensity;
    this.postFilterScaleNode.value = effectiveFilterScale;
    this.integralDampNode.value = clamp(0.68 + effectiveFilterIntensity * 0.28, 0.55, 0.96);

    const hasVol = rq.volumetricFog || rq.atmoScattering || rq.contactShadows;
    const hasFilter = effectiveFilter !== 'none';
    const hasAnyPost =
      rq.rayTracingMode !== 'off' ||
      rq.aoEnabled ||
      hasVol ||
      rq.bloomEnabled ||
      this.activePostGradingEnabled ||
      hasFilter;

    if (!hasAnyPost || this.pipelineFailed) {
      this.disposeRenderPipeline();
      this.syncEnvironmentUniforms();
      return;
    }

    const resScaleCap = isOffline && offlineRenderW > 3840 ? 'hi6k' : isOffline ? 'hi' : 'live';
    const filterBucket = `flt_${effectiveFilter}`;
    const desiredKey = [
      rq.rayTracingMode,
      rq.aoEnabled ? 'ao1' : 'ao0',
      hasVol ? 'vol1' : 'vol0',
      rq.bloomEnabled ? 'blm1' : 'blm0',
      this.activePostGradingEnabled ? 'pfx1' : 'pfx0',
      filterBucket,
      resScaleCap,
    ].join('|');

    // Update uniform-driven parameters if structural pipeline matches
    if (this.renderPipeline && this.activePipelineKey === desiredKey) {
      if (this.activeSsgiNode) {
        const highSteps = rq.raySteps >= 0.9 || isOffline;
        this.activeSsgiNode.sliceCount.value = highSteps ? 3 : 2;
        this.activeSsgiNode.stepCount.value = highSteps ? 14 : 8;
        this.activeSsgiNode.radius.value = Math.max(4, this.planet.baseRadius * 0.55);
      }
      if (this.activeSsrNode) {
        this.activeSsrNode.quality.value = Math.max(0.35, Math.min(1.0, rq.raySteps));
        this.activeSsrNode.maxDistance.value = Math.max(8, this.planet.baseRadius * 1.1);
        this.activeSsrNode.thickness.value = Math.max(0.12, this.planet.nativeVoxelSize * 3.5);
      }
      if (this.activeAoNode) {
        this.activeAoNode.samples.value = rq.raySteps >= 0.8 || isOffline ? 16 : 8;
        this.activeAoNode.radius.value = Math.max(0.45, this.planet.baseRadius * 0.06);
      }
      if (this.activeBloomNode) {
        this.activeBloomNode.strength.value = this.activeBloomStrength;
      }
      this.syncEnvironmentUniforms();
      return;
    }

    this.disposeRenderPipeline();

    try {
      const pipeline = new THREE.RenderPipeline(this.renderer);
      const scenePass = pass(this.scene, this.camera);
      this.pipelineDisposables.push(scenePass);

      const needMrt = rq.rayTracingMode !== 'off' || rq.aoEnabled;
      if (needMrt) {
        scenePass.setMRT(
          mrt({
            output,
            normal: normalView,
            diffuseColor,
            roughness,
          }),
        );
      }

      const scenePassColor = scenePass.getTextureNode('output');
      const scenePassDepth = scenePass.getTextureNode('depth');

      let composedNode: THREE.Node<'vec4'> = scenePassColor;

      if (needMrt) {
        const scenePassNormal = scenePass.getTextureNode('normal');
        const scenePassDiffuse = scenePass.getTextureNode('diffuseColor');
        const scenePassRoughness = scenePass.getTextureNode('roughness');
        const rtScale = resScaleCap === 'hi6k' ? 0.5 : resScaleCap === 'hi' ? 1.0 : 0.75;

        if (rq.rayTracingMode === 'ssgi_ssr') {
          const ssgiPass = ssgi(scenePassColor, scenePassDepth, scenePassNormal, this.camera);
          ssgiPass.useTemporalFiltering = false;
          ssgiPass.resolutionScale = rtScale;
          const highSteps = rq.raySteps >= 0.9 || isOffline;
          ssgiPass.sliceCount.value = highSteps ? 3 : 2;
          ssgiPass.stepCount.value = highSteps ? 14 : 8;
          ssgiPass.radius.value = Math.max(4, this.planet.baseRadius * 0.55);
          ssgiPass.giIntensity.value = 6.2;
          ssgiPass.aoIntensity.value = 1.15;
          ssgiPass.useScreenSpaceSampling.value = true;
          this.activeSsgiNode = ssgiPass;
          this.pipelineDisposables.push(ssgiPass);

          const denoisedGi = denoise(
            ssgiPass.getGINode(),
            scenePassDepth,
            scenePassNormal,
            this.camera,
          );
          this.pipelineDisposables.push(denoisedGi);
          this.activeDenoiseNodes.push(denoisedGi);

          let baseRgb: THREE.Node<'vec3'> = scenePassColor.rgb;
          if (rq.aoEnabled) {
            const denoisedAo = denoise(
              ssgiPass.getAONode(),
              scenePassDepth,
              scenePassNormal,
              this.camera,
            );
            this.pipelineDisposables.push(denoisedAo);
            this.activeDenoiseNodes.push(denoisedAo);
            const aoNode = denoisedAo as unknown as THREE.Node<'vec4'>;
            baseRgb = baseRgb.mul(mix(float(1.0), aoNode.r, float(0.68)));
          }

          const giNode = denoisedGi as unknown as THREE.Node<'vec4'>;
          const indirectGi = giNode.rgb.mul(scenePassDiffuse.rgb).mul(0.55);
          composedNode = vec4(baseRgb.add(indirectGi), scenePassColor.a);
        } else if (rq.aoEnabled) {
          const aoPass = gtao(scenePassDepth, scenePassNormal, this.camera);
          aoPass.resolutionScale = resScaleCap === 'hi6k' ? 0.5 : rq.raySteps >= 0.8 ? 1.0 : 0.68;
          aoPass.samples.value = rq.raySteps >= 0.8 || isOffline ? 16 : 8;
          aoPass.radius.value = Math.max(0.45, this.planet.baseRadius * 0.06);
          this.activeAoNode = aoPass;
          this.pipelineDisposables.push(aoPass);

          const denoisedAo = denoise(
            aoPass.getTextureNode(),
            scenePassDepth,
            scenePassNormal,
            this.camera,
          );
          this.pipelineDisposables.push(denoisedAo);
          this.activeDenoiseNodes.push(denoisedAo);

          const aoNode = denoisedAo as unknown as THREE.Node<'vec4'>;
          composedNode = vec4(
            scenePassColor.rgb.mul(mix(float(1.0), aoNode.r, float(0.64))),
            scenePassColor.a,
          );
        }

        if (rq.rayTracingMode === 'ssr' || rq.rayTracingMode === 'ssgi_ssr') {
          const ssrPass = ssr(
            composedNode,
            scenePassDepth,
            scenePassNormal as unknown as THREE.Node<'vec3'>,
            {
              metalnessNode: float(0.05),
            roughnessNode: scenePassRoughness.r,
            diffuseNode: scenePassDiffuse,
            binaryRefine: true,
            reflectNonMetals: true,
            camera: this.camera,
          });
          ssrPass.resolutionScale = resScaleCap === 'hi6k' ? 0.65 : isOffline ? 1.0 : 0.75;
          ssrPass.quality.value = Math.max(0.35, Math.min(1.0, rq.raySteps));
          ssrPass.maxDistance.value = Math.max(8, this.planet.baseRadius * 1.1);
          ssrPass.thickness.value = Math.max(0.12, this.planet.nativeVoxelSize * 3.5);
          ssrPass.intensity.value = 0.88;
          this.activeSsrNode = ssrPass;
          this.pipelineDisposables.push(ssrPass);

          const specMask = float(1.0).sub(smoothstep(0.06, 0.52, scenePassRoughness.r));
          const hasHit = ssrPass.a.greaterThan(0.001).select(float(1.0), float(0.0));
          composedNode = vec4(
            composedNode.rgb.add(ssrPass.rgb.mul(specMask).mul(hasHit).mul(0.85)),
            composedNode.a,
          );
        }
      }

      if (hasVol) {
        composedNode = buildVolumetricAtmoCompositeNode({
          colorNode: composedNode,
          depthNode: scenePassDepth,
          sunDirNode: this.sunDirNode,
          planetRadiusNode: this.planetRadiusNode,
          atmoEnabledNode: this.atmoEnabledNode,
          atmoDensityNode: this.atmoDensityNode,
          rayleighNode: this.rayleighNode,
          mieNode: this.mieNode,
          scaleHeightNode: this.scaleHeightNode,
          volFogEnabledNode: this.volFogEnabledNode,
          atmoScatterEnabledNode: this.atmoScatterEnabledNode,
          volStepsNode: this.volStepsNode,
          contactShadowNode: this.contactShadowNode,
          solarIntensityNode: this.solarIntensityNode,
        });
      }

      if (rq.bloomEnabled) {
        const bloomPass = bloom(composedNode, this.activeBloomStrength, 0.45, 0.88);
        this.activeBloomNode = bloomPass;
        this.pipelineDisposables.push(bloomPass);
        composedNode = vec4(composedNode.rgb.add(bloomPass.rgb), composedNode.a);
      }

      if (this.activePostGradingEnabled) {
        composedNode = buildPostGradingCompositeNode({
          colorNode: composedNode,
          exposureGainNode: this.postExposureGainNode,
          contrastNode: this.postContrastNode,
          saturationNode: this.postSaturationNode,
          lutIntensityNode: this.postLutIntensityNode,
          shadowTintNode: this.postShadowTintNode,
          highlightTintNode: this.postHighlightTintNode,
          vignetteNode: this.postVignetteNode,
          filmGrainNode: this.postFilmGrainNode,
          simTimeNode: this.simTimeNode,
        });
      }

      if (effectiveFilter === 'integral') {
        const aiNode = afterImage(composedNode, this.integralDampNode);
        this.pipelineDisposables.push(aiNode);
        composedNode = buildVisualFilterNode({
          texNode: aiNode.getTextureNode(),
          filterMode: effectiveFilter,
          filterModeNode: this.postFilterModeNode,
          filterIntensityNode: this.postFilterIntensityNode,
          filterScaleNode: this.postFilterScaleNode,
          simTimeNode: this.simTimeNode,
        });
      } else if (effectiveFilter !== 'none') {
        const texNode = convertToTexture(composedNode);
        composedNode = buildVisualFilterNode({
          texNode,
          filterMode: effectiveFilter,
          filterModeNode: this.postFilterModeNode,
          filterIntensityNode: this.postFilterIntensityNode,
          filterScaleNode: this.postFilterScaleNode,
          simTimeNode: this.simTimeNode,
        });
      }

      pipeline.outputNode = composedNode;
      pipeline.needsUpdate = true;
      this.renderPipeline = pipeline;
      this.activePipelineKey = desiredKey;
    } catch (err) {
      console.warn('[TerraSphere] 构建光追/体积后期管线失败，回退基础管线:', err);
      this.pipelineFailed = true;
      this.disposeRenderPipeline();
    }

    this.syncEnvironmentUniforms();
  }

  private renderActiveScene(): void {
    if (this.renderPipeline && !this.pipelineFailed) {
      try {
        this.renderPipeline.render();
        return;
      } catch (err) {
        console.warn('[TerraSphere] RenderPipeline 渲染异常，已回退基础管线:', err);
        this.pipelineFailed = true;
        this.disposeRenderPipeline();
        this.syncEnvironmentUniforms();
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    dom.addEventListener('wheel', this.handleWheel, { passive: false });
    dom.addEventListener('contextmenu', this.handleContextMenu);
  }

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleResize = (): void => {
    if (this.isDisposed || this.isOfflineRendering) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (!this.isGenerating) {
      this.renderActiveScene();
    }
  };

  public getDirectorHardwareCaps(): {
    maxGpuTextureDim: number;
    webCodecsAvailable: boolean;
    mediaRecorderAvailable: boolean;
  } {
    let maxGpuTextureDim = 8192;
    try {
      const backend = this.renderer?.backend as
        | {
            device?: { limits?: { maxTextureDimension2D?: number } };
            gl?: WebGL2RenderingContext;
          }
        | undefined;
      if (backend?.device?.limits?.maxTextureDimension2D) {
        maxGpuTextureDim = backend.device.limits.maxTextureDimension2D;
      } else if (backend?.gl) {
        const val = backend.gl.getParameter(backend.gl.MAX_TEXTURE_SIZE);
        if (typeof val === 'number' && val > 512) {
          maxGpuTextureDim = val;
        }
      }
    } catch {
      // safe default
    }
    const g = globalThis as unknown as {
      VideoEncoder?: unknown;
      VideoFrame?: unknown;
      MediaRecorder?: unknown;
    };
    return {
      maxGpuTextureDim,
      webCodecsAvailable: typeof g.VideoEncoder === 'function' && typeof g.VideoFrame === 'function',
      mediaRecorderAvailable: typeof g.MediaRecorder === 'function',
    };
  }

  public captureCameraKeyframe(label?: string): DirectorKeyframe {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const lookDist =
      this.config.cameraMode === 'detail'
        ? Math.max(this.planet.nativeVoxelSize, this.camera.position.distanceTo(this.detailTarget))
        : this.config.cameraMode === 'perspective'
          ? Math.max(this.planet.nativeVoxelSize, this.camera.position.distanceTo(this.perspTarget))
          : Math.max(this.planet.baseRadius * 0.4, 4);
    const lookAt: [number, number, number] =
      this.config.cameraMode === 'detail'
        ? [this.detailTarget.x, this.detailTarget.y, this.detailTarget.z]
        : this.config.cameraMode === 'perspective'
          ? [this.perspTarget.x, this.perspTarget.y, this.perspTarget.z]
          : [
              this.camera.position.x + dir.x * lookDist,
              this.camera.position.y + dir.y * lookDist,
              this.camera.position.z + dir.z * lookDist,
            ];
    return {
      id: `kf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      label: label ?? '机位',
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      lookAt,
      up: [this.camera.up.x, this.camera.up.y, this.camera.up.z],
      fovDeg: this.camera.fov,
    };
  }

  public buildDirectorAnchor(): DirectorSceneAnchor {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    let tp: [number, number, number];
    if (this.config.cameraMode === 'detail') {
      tp = [this.detailTarget.x, this.detailTarget.y, this.detailTarget.z];
    } else if (this.config.cameraMode === 'perspective' && this.perspTarget.lengthSq() > 1e-4) {
      const pLen = this.perspTarget.length();
      const nx = this.perspTarget.x / pLen;
      const ny = this.perspTarget.y / pLen;
      const nz = this.perspTarget.z / pLen;
      const sr = this.planet.findSurfaceRadiusAlongRay(nx, ny, nz);
      tp = [nx * sr, ny * sr, nz * sr];
    } else {
      const hit = this.planet.raycastTerrain(
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
        dir.x,
        dir.y,
        dir.z,
        this.planet.worldHalf * 6,
      );
      if (hit.hit) {
        tp = [hit.x, hit.y, hit.z];
      } else {
        const pLen = Math.hypot(this.playerPos.x, this.playerPos.y, this.playerPos.z) || 1;
        const nx = this.playerPos.x / pLen;
        const ny = this.playerPos.y / pLen;
        const nz = this.playerPos.z / pLen;
        const sr = this.planet.findSurfaceRadiusAlongRay(nx, ny, nz);
        tp = [nx * sr, ny * sr, nz * sr];
      }
    }

    const tpLen = Math.hypot(tp[0], tp[1], tp[2]) || 1;
    const tn: [number, number, number] = [tp[0] / tpLen, tp[1] / tpLen, tp[2] / tpLen];
    const kf = this.captureCameraKeyframe('seed');

    return {
      baseRadius: this.planet.baseRadius,
      nativeVoxelSize: this.planet.nativeVoxelSize,
      targetPoint: tp,
      targetNormal: tn,
      currentPos: kf.position,
      currentLookAt: kf.lookAt,
      currentUp: kf.up,
      currentFovDeg: kf.fovDeg,
      sampleSurfaceRadius: (dx, dy, dz) => this.planet.findSurfaceRadiusAlongRay(dx, dy, dz),
    };
  }

  public startDirectorPreview(plan: DirectorShotPlan, onEnd?: () => void): void {
    this.directorPreviewPlan = {
      ...plan,
      keyframes: plan.keyframes.map((k) => ({ ...k })),
    };
    this.directorPreviewTime = 0;
    this.directorPreviewAnchor = this.buildDirectorAnchor();
    this.directorPreviewBaseSunAzimuth = this.config.sunAzimuthDeg;
    this.onDirectorPreviewEnd = onEnd;
  }

  public stopDirectorPreview(): void {
    if (!this.directorPreviewPlan) return;
    this.directorPreviewPlan = null;
    this.directorPreviewAnchor = null;
    this.config.sunAzimuthDeg = this.directorPreviewBaseSunAzimuth;
    this.updateSunDirection();
    if (Math.abs(this.camera.fov - 52) > 0.1) {
      this.camera.fov = this.config.cameraMode === 'perspective' ? this.config.perspectiveFov : 52;
      this.camera.updateProjectionMatrix();
    }
    const cb = this.onDirectorPreviewEnd;
    this.onDirectorPreviewEnd = undefined;
    cb?.();
  }

  private setEditorHelpersVisible(visible: boolean): {
    brush: boolean;
    detailRing: boolean;
    landingBeacon: boolean;
    chunkBounds: boolean;
    player: boolean;
    tractorBeam: boolean;
    tractorStretch: boolean;
    directorGizmo: boolean;
  } {
    const prev = {
      brush: this.brushPreview?.visible ?? false,
      detailRing: this.detailReticleRing?.visible ?? false,
      landingBeacon: this.landingBeaconGroup?.visible ?? false,
      chunkBounds: this.chunkBoundsLines?.visible ?? false,
      player: this.playerGroup?.visible ?? false,
      tractorBeam: this.tractorBeamGroup?.visible ?? false,
      tractorStretch: this.tractorStretchLine?.visible ?? false,
      directorGizmo: this.directorGizmoGroup?.visible ?? false,
    };
    if (!visible) {
      if (this.brushPreview) this.brushPreview.visible = false;
      if (this.detailReticleRing) this.detailReticleRing.visible = false;
      if (this.landingBeaconGroup) this.landingBeaconGroup.visible = false;
      if (this.chunkBoundsLines) this.chunkBoundsLines.visible = false;
      if (this.tractorBeamGroup) this.tractorBeamGroup.visible = false;
      if (this.tractorStretchLine) this.tractorStretchLine.visible = false;
      if (this.directorGizmoGroup) this.directorGizmoGroup.visible = false;
      if (this.playerGroup && this.config.cameraMode !== 'explorer') {
        this.playerGroup.visible = false;
      }
    } else {
      if (this.brushPreview) this.brushPreview.visible = prev.brush;
      if (this.detailReticleRing) this.detailReticleRing.visible = prev.detailRing;
      if (this.landingBeaconGroup) this.landingBeaconGroup.visible = prev.landingBeacon;
      if (this.chunkBoundsLines) this.chunkBoundsLines.visible = prev.chunkBounds;
      if (this.tractorBeamGroup) this.tractorBeamGroup.visible = prev.tractorBeam;
      if (this.tractorStretchLine) this.tractorStretchLine.visible = prev.tractorStretch;
      if (this.directorGizmoGroup) this.directorGizmoGroup.visible = prev.directorGizmo;
      if (this.playerGroup) this.playerGroup.visible = prev.player;
    }
    return prev;
  }

  private restoreEditorHelpersVisible(prev: {
    brush: boolean;
    detailRing: boolean;
    landingBeacon: boolean;
    chunkBounds: boolean;
    player: boolean;
    tractorBeam: boolean;
    tractorStretch: boolean;
    directorGizmo?: boolean;
  }): void {
    if (this.brushPreview) this.brushPreview.visible = prev.brush;
    if (this.detailReticleRing) this.detailReticleRing.visible = prev.detailRing;
    if (this.landingBeaconGroup) this.landingBeaconGroup.visible = prev.landingBeacon;
    if (this.chunkBoundsLines) this.chunkBoundsLines.visible = prev.chunkBounds;
    if (this.tractorBeamGroup) this.tractorBeamGroup.visible = prev.tractorBeam;
    if (this.tractorStretchLine) this.tractorStretchLine.visible = prev.tractorStretch;
    if (this.directorGizmoGroup && prev.directorGizmo !== undefined) {
      this.directorGizmoGroup.visible = prev.directorGizmo;
    }
    if (this.playerGroup) this.playerGroup.visible = prev.player;
  }

  private computeRenderBufferSize(
    targetW: number,
    targetH: number,
  ): { renderW: number; renderH: number; maxGpuDim: number } {
    const caps = this.getDirectorHardwareCaps();
    const maxGpuDim = Math.max(1024, caps.maxGpuTextureDim);
    const scaleDown = Math.min(1, maxGpuDim / Math.max(targetW, targetH));
    const renderW = Math.max(2, Math.floor((targetW * scaleDown) / 2) * 2);
    const renderH = Math.max(2, Math.floor((targetH * scaleDown) / 2) * 2);
    return { renderW, renderH, maxGpuDim };
  }

  private async canvasToBlob(
    canvas: HTMLCanvasElement,
    mimeType: string,
    quality?: number,
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to encode canvas image'));
        },
        mimeType,
        quality,
      );
    });
  }

  private isUsingWebGLBackend(): boolean {
    return Boolean(
      (this.renderer?.backend as { isWebGLBackend?: boolean } | undefined)?.isWebGLBackend,
    );
  }

  private syncLaserBeamVisuals(): void {
    if (!this.laserBeamGroup) return;
    const scale = this.getPlanetScale();
    if (this.phase === 'playing' && this.simTimeSec < this.laserBeamActiveUntil) {
      this.laserBeamGroup.visible = true;
      this.laserImpactMesh.visible = true;

      this._v1.copy(this.laserBeamEnd).sub(this.laserBeamStart);
      const beamLen = Math.max(this._v1.length(), 0.01);
      const beamMid = this._v2
        .copy(this.laserBeamStart)
        .add(this.laserBeamEnd)
        .multiplyScalar(0.5);
      this._v1.divideScalar(beamLen);
      this._q1.setFromUnitVectors(this._v3.set(0, 1, 0), this._v1);

      const pulse = 1 + 0.16 * Math.sin(this.simTimeSec * 42);
      const rad = Math.max(this.config.brushRadius * this.laserBeamScaleRad * pulse, 0.06 * scale);
      this.laserBeamGroup.position.copy(beamMid);
      this.laserBeamGroup.quaternion.copy(this._q1);
      this.laserBeamGroup.scale.set(rad, beamLen, rad);

      this.laserImpactMesh.position.copy(this.laserImpactPos);
      this.laserImpactMesh.scale.setScalar(
        Math.max(this.config.brushRadius * this.laserBeamScaleRad * 1.9 * pulse, 0.14 * scale),
      );
    } else {
      this.laserBeamGroup.visible = false;
      this.laserImpactMesh.visible = false;
    }
  }

  private stepOfflineSimulation(
    simDt: number,
    advanceClock: boolean,
    includeEditorVisuals: boolean,
  ): void {
    const scale = this.getPlanetScale();
    if (advanceClock && simDt > 0) {
      const { subSteps, subDt } = computeOfflineSubsteps(simDt, 0.02);
      const gravParams = this.getGravityParams();
      for (let s = 0; s < subSteps; s++) {
        this.simTimeSec += subDt;
        this.simTimeNode.value = this.simTimeSec;
        if (this.moonGroup) {
          this.moonGroup.position.x = Math.cos(this.simTimeSec * 0.12) * -36 * scale;
          this.moonGroup.position.z = Math.sin(this.simTimeSec * 0.12) * -36 * scale;
        }
        if (this.starPoints) {
          this.starPoints.rotation.y += subDt * 0.008;
        }
        this.updateCloudPuffs(subDt);

        if (this.phase === 'playing') {
          if (this.tractorGrabbedPlayer || !this.playerGrounded) {
            this.integrateSuspendedExplorerPhysics(subDt);
          } else {
            this.syncPlayerTransform();
          }
          const activeFluidTractor = this.updateTractorBeamSolver(subDt);
          this.fluid.step(subDt, this.planet, gravParams, 2, activeFluidTractor);
          if (this.isTractorDragging && this.fluid.tractorCapturedCount > 0) {
            this.waterMeshDirty = true;
          }
          this.updateDebris(subDt);
          this.updateDynamicEntities(subDt);
        }
      }
    } else {
      this.simTimeNode.value = this.simTimeSec;
      if (this.moonGroup) {
        this.moonGroup.position.x = Math.cos(this.simTimeSec * 0.12) * -36 * scale;
        this.moonGroup.position.z = Math.sin(this.simTimeSec * 0.12) * -36 * scale;
      }
      this.updateCloudPuffs(0);
      if (this.phase === 'playing') {
        this.syncPlayerTransform();
      }
    }

    this.updateSplashInstances();
    if (this.fluid.activeCount > 0 || this.waterMeshDirty) {
      this.rebuildWaterMesh();
    }
    this.syncLaserBeamVisuals();
    if (includeEditorVisuals) {
      this.updateTractorBeamVisuals();
    }
  }

  private async convergeOfflineGeometryAndShaders(
    forceCompile: boolean,
    streamOverride?: {
      focus: readonly [number, number, number];
      dist: number;
      lodModeOverride?: LodMode;
    },
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const rebuiltMacro = this.updateChunksWithLod(this.planet.totalChunks);
    let rebuiltAny = forceCompile || rebuiltMacro > 0 || this.fluid.activeCount > 0;

    if (this.planet.isHighResStreaming) {
      for (let pass = 0; pass < 1200; pass++) {
        if (abortSignal?.aborted) {
          throw new DOMException('Director offline render aborted', 'AbortError');
        }
        const batch = this.updateHighResStreaming(null, 256, streamOverride);
        if (batch && batch.rebuiltMeshes.length > 0) {
          rebuiltAny = true;
        }
        if (!batch || batch.pendingTotal === 0) break;
        if (pass % 10 === 9) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }

    this.scene.updateMatrixWorld();
    if (rebuiltAny) {
      await this.renderer.compileAsync(this.scene, this.camera);
    }
  }

  private createOfflineCaptureTarget(width: number, height: number): THREE.RenderTarget {
    return new THREE.RenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples: 0,
    });
  }

  private async renderTargetToRgbaTopDown(
    captureRT: THREE.RenderTarget,
    width: number,
    height: number,
    outRgba?: Uint8ClampedArray,
  ): Promise<Uint8ClampedArray> {
    this.renderer.setOutputRenderTarget(captureRT);
    try {
      this.renderActiveScene();
    } finally {
      this.renderer.setOutputRenderTarget(null);
    }
    const rawPixels = await this.renderer.readRenderTargetPixelsAsync(
      captureRT,
      0,
      0,
      width,
      height,
    );
    const bytes =
      rawPixels instanceof Uint8Array || rawPixels instanceof Uint8ClampedArray
        ? rawPixels
        : new Uint8Array(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength);
    return normalizeReadbackRgbaToTopDown(
      bytes,
      width,
      height,
      this.isUsingWebGLBackend(),
      outRgba,
    );
  }

  private async renderTargetAccumulatedRgbaTopDown(
    captureRT: THREE.RenderTarget,
    width: number,
    height: number,
    accumSamples: OfflineAccumSamples,
    outRgba?: Uint8ClampedArray,
    abortSignal?: AbortSignal,
  ): Promise<Uint8ClampedArray> {
    const samples = Math.max(1, Math.min(8, Math.round(accumSamples)));
    if (samples <= 1) {
      this.camera.clearViewOffset();
      return this.renderTargetToRgbaTopDown(captureRT, width, height, outRgba);
    }

    const accum = createRgbaAccumulator(width * height);
    const scratch = new Uint8ClampedArray(width * height * 4);
    try {
      for (let s = 0; s < samples; s++) {
        if (abortSignal?.aborted) {
          throw new DOMException('Director offline render aborted', 'AbortError');
        }
        const { offsetX, offsetY } = computeSubpixelJitterOffset(s, samples);
        this.camera.setViewOffset(width, height, offsetX, offsetY, width, height);
        this.camera.updateProjectionMatrix();
        for (const dn of this.activeDenoiseNodes) {
          dn.index.value = s;
        }
        await this.renderTargetToRgbaTopDown(captureRT, width, height, scratch);
        accumulateRgbaSample(accum, scratch);
      }
    } finally {
      this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
    }

    return finalizeAccumulatedRgba(accum, samples, outRgba);
  }

  public async captureDirectorScreenshot(options: {
    width: number;
    height: number;
    format: 'png' | 'webp' | 'jpeg';
    quality?: number;
    hideHelpers?: boolean;
    qualityOverride?: OfflineQualityOverride;
    accumSamples?: OfflineAccumSamples;
    rayTracing?: boolean;
    volumetrics?: boolean;
    shadowQuality?: ShadowQualityLevel;
    pbrEnhanced?: boolean;
  }): Promise<{
    blob: Blob;
    actualWidth: number;
    actualHeight: number;
    previewDataUrl: string;
  }> {
    cancelAnimationFrame(this.frameHandle);
    clearTimeout(this.timerHandle);

    const targetW = Math.max(16, Math.min(8192, Math.round(options.width)));
    const targetH = Math.max(16, Math.min(8192, Math.round(options.height)));
    const { renderW, renderH } = this.computeRenderBufferSize(targetW, targetH);

    const prevAspect = this.camera.aspect;
    const prevPixelRatio = this.renderer.getPixelRatio();
    const prevCssW = Math.max(1, this.container.clientWidth);
    const prevCssH = Math.max(1, this.container.clientHeight);
    const savedQuality = { ...this.config.renderQuality };
    const prevHelpers = options.hideHelpers !== false ? this.setEditorHelpersVisible(false) : null;
    const captureRT = this.createOfflineCaptureTarget(renderW, renderH);

    this.isOfflineRendering = true;
    try {
      const offlineQual = resolveDirectorOfflineQuality(savedQuality, {
        overrideMode: options.qualityOverride ?? 'inherit',
        accumSamples: options.accumSamples,
        rayTracing: options.rayTracing,
        volumetrics: options.volumetrics,
        shadowQuality: options.shadowQuality,
        pbrEnhanced: options.pbrEnhanced,
      });
      this.config.renderQuality = offlineQual;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(renderW, renderH, false);
      this.applyShadowQualitySettings();
      this.syncRenderPipeline(true, renderW);

      this.camera.aspect = targetW / targetH;
      this.camera.updateProjectionMatrix();

      this.stepOfflineSimulation(0, false, options.hideHelpers === false);
      const focusDist = Math.max(
        this.planet.nativeVoxelSize * 0.5,
        this.camera.position.distanceTo(this.lastHighResFocus),
      );
      this.updateDynamicShadowFrustum(
        this.lastHighResFocus.x,
        this.lastHighResFocus.y,
        this.lastHighResFocus.z,
        focusDist,
      );
      await this.convergeOfflineGeometryAndShaders(true);

      const rgbaTopDown = await this.renderTargetAccumulatedRgbaTopDown(
        captureRT,
        renderW,
        renderH,
        offlineQual.offlineAccumSamples,
      );

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = renderW;
      srcCanvas.height = renderH;
      const srcCtx = srcCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!srcCtx) {
        throw new Error('Failed to create 2D screenshot canvas context');
      }

      let outputCanvas: HTMLCanvasElement = srcCanvas;
      if (renderW !== targetW || renderH !== targetH) {
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = targetW;
        dstCanvas.height = targetH;
        const dstCtx = dstCanvas.getContext('2d', { alpha: false });
        if (dstCtx) {
          blitRgbaTopDownToCanvas2D(rgbaTopDown, renderW, renderH, srcCanvas, srcCtx, dstCanvas, dstCtx);
          outputCanvas = dstCanvas;
        } else {
          blitRgbaTopDownToCanvas2D(rgbaTopDown, renderW, renderH, srcCanvas, srcCtx);
        }
      } else {
        blitRgbaTopDownToCanvas2D(rgbaTopDown, renderW, renderH, srcCanvas, srcCtx);
      }

      const mime =
        options.format === 'webp'
          ? 'image/webp'
          : options.format === 'jpeg'
            ? 'image/jpeg'
            : 'image/png';
      const blob = await this.canvasToBlob(outputCanvas, mime, options.quality ?? 0.96);

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 480;
      thumbCanvas.height = Math.max(120, Math.round((480 * targetH) / targetW));
      const tctx = thumbCanvas.getContext('2d', { alpha: false });
      let previewDataUrl = '';
      if (tctx) {
        tctx.fillStyle = '#040711';
        tctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
        tctx.drawImage(outputCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        previewDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);
      }

      return {
        blob,
        actualWidth: outputCanvas.width,
        actualHeight: outputCanvas.height,
        previewDataUrl,
      };
    } finally {
      this.renderer.setOutputRenderTarget(null);
      this.renderer.setRenderTarget(null);
      captureRT.dispose();
      this.camera.clearViewOffset();
      this.camera.aspect = prevAspect;
      this.camera.updateProjectionMatrix();
      this.config.renderQuality = savedQuality;
      this.renderer.setPixelRatio(prevPixelRatio);
      this.renderer.setSize(prevCssW, prevCssH, false);
      this.applyShadowQualitySettings();
      this.syncRenderPipeline(false);
      if (prevHelpers) this.restoreEditorHelpersVisible(prevHelpers);
      this.isOfflineRendering = false;
      this.lastTime = performance.now();
      this.scheduleNextFrame();
    }
  }

  public async renderDirectorVideoOffline(
    plan: DirectorShotPlan,
    onProgress: (p: DirectorRenderProgress) => void,
    abortSignal?: AbortSignal,
  ): Promise<{
    blob: Blob;
    mimeType: string;
    filename: string;
    frameCount: number;
    actualWidth: number;
    actualHeight: number;
    fps: number;
    elapsedMs: number;
    encoderLabel: string;
  }> {
    this.stopDirectorPreview();
    cancelAnimationFrame(this.frameHandle);
    clearTimeout(this.timerHandle);

    const targetW = Math.max(64, Math.min(8192, Math.floor(plan.width / 2) * 2));
    const targetH = Math.max(64, Math.min(8192, Math.floor(plan.height / 2) * 2));
    const fps = clamp(Math.round(plan.fps), 1, 300);
    const totalFrames = computePlanFrameCount({ ...plan, fps });
    const dt = 1 / fps;

    const anchor = this.buildDirectorAnchor();
    const { renderW, renderH } = this.computeRenderBufferSize(targetW, targetH);

    // Snapshot live camera, sun, quality, viewport, and simulation clock to restore cleanly after offline export
    const savedPos = this.camera.position.clone();
    const savedQuat = this.camera.quaternion.clone();
    const savedUp = this.camera.up.clone();
    const savedFov = this.camera.fov;
    const savedNear = this.camera.near;
    const savedFar = this.camera.far;
    const savedAspect = this.camera.aspect;
    const savedPixelRatio = this.renderer.getPixelRatio();
    const savedCssW = Math.max(1, this.container.clientWidth);
    const savedCssH = Math.max(1, this.container.clientHeight);
    const savedQuality = { ...this.config.renderQuality };
    const savedSunAzimuth = this.config.sunAzimuthDeg;
    const savedSimTime = this.simTimeSec;
    const prevHelpers = plan.cleanFrame ? this.setEditorHelpersVisible(false) : null;

    this.isOfflineRendering = true;
    const renderT0 = performance.now();

    // Dedicated GPU RenderTarget & CPU 2D staging buffers (immune to WebGL/WebGPU swapchain clears & alpha YUV green-screen)
    const captureRT = this.createOfflineCaptureTarget(renderW, renderH);
    const rgbaBuf = new Uint8ClampedArray(renderW * renderH * 4);

    const srcCanvas2D = document.createElement('canvas');
    srcCanvas2D.width = renderW;
    srcCanvas2D.height = renderH;
    const srcCtx2D = srcCanvas2D.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!srcCtx2D) {
      captureRT.dispose();
      throw new Error('Failed to create offline staging 2D canvas context');
    }

    let encodeCanvas2D: HTMLCanvasElement = srcCanvas2D;
    let encodeCtx2D: CanvasRenderingContext2D = srcCtx2D;
    if (renderW !== targetW || renderH !== targetH) {
      encodeCanvas2D = document.createElement('canvas');
      encodeCanvas2D.width = targetW;
      encodeCanvas2D.height = targetH;
      encodeCtx2D =
        encodeCanvas2D.getContext('2d', { alpha: false, willReadFrequently: true }) ?? srcCtx2D;
    }

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 360;
    thumbCanvas.height = Math.max(90, Math.round((360 * targetH) / targetW));
    const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
    let cachedImageData: ImageData | null = null;

    type WebCodecsEnc = {
      configure: (cfg: Record<string, unknown>) => void;
      encode: (frame: unknown, opts?: { keyFrame?: boolean }) => void;
      flush: () => Promise<void>;
      close: () => void;
      encodeQueueSize: number;
    };

    let encoder: WebCodecsEnc | null = null;
    let encoderClosed = false;

    try {
      const offlineQual = resolveDirectorOfflineQuality(savedQuality, plan.offlineQuality);
      this.config.renderQuality = offlineQual;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(renderW, renderH, false);
      this.applyShadowQualitySettings();
      this.syncRenderPipeline(true, renderW);

      this.camera.aspect = targetW / targetH;
      this.camera.updateProjectionMatrix();

      type WebCodecsCtor = {
        new (init: {
          output: (chunk: {
            byteLength: number;
            timestamp: number;
            type: 'key' | 'delta';
            copyTo: (dest: Uint8Array) => void;
          }) => void;
          error: (err: unknown) => void;
        }): WebCodecsEnc;
        isConfigSupported: (cfg: Record<string, unknown>) => Promise<{ supported?: boolean }>;
      };
      type VideoFrameCtor = new (
        source: BufferSource | HTMLCanvasElement,
        init: Record<string, unknown>,
      ) => { close: () => void };

      const g = globalThis as unknown as {
        VideoEncoder?: WebCodecsCtor;
        VideoFrame?: VideoFrameCtor;
      };

      let muxer: WebmMuxer | null = null;
      let encoderError: unknown = null;
      let encoderLabel = 'PNG 无损序列 (.tar)';
      let activeEncodeW = targetW;
      let activeEncodeH = targetH;

      const wantWebm = plan.format !== 'png-tar';
      if (wantWebm && typeof g.VideoEncoder === 'function' && typeof g.VideoFrame === 'function') {
        const candidates: Array<{
          codec: string;
          webmCodec: WebmVideoCodec;
          label: string;
          w: number;
          h: number;
          hintFps: number;
        }> = [];

        const primaryCodecs =
          plan.format === 'webm-vp8'
            ? [{ codec: 'vp8', webmCodec: 'V_VP8' as WebmVideoCodec, label: 'WebCodecs VP8' }]
            : [
                { codec: 'vp09.00.62.08', webmCodec: 'V_VP9' as WebmVideoCodec, label: 'WebCodecs VP9 L6.2' },
                { codec: 'vp09.00.61.08', webmCodec: 'V_VP9' as WebmVideoCodec, label: 'WebCodecs VP9 L6.1' },
                { codec: 'vp09.00.52.08', webmCodec: 'V_VP9' as WebmVideoCodec, label: 'WebCodecs VP9 L5.2' },
                { codec: 'vp09.00.51.08', webmCodec: 'V_VP9' as WebmVideoCodec, label: 'WebCodecs VP9 L5.1' },
                { codec: 'vp8', webmCodec: 'V_VP8' as WebmVideoCodec, label: 'WebCodecs VP8' },
              ];

        for (const c of primaryCodecs) {
          candidates.push({ ...c, w: targetW, h: targetH, hintFps: fps });
          if (fps > 60) {
            candidates.push({ ...c, w: targetW, h: targetH, hintFps: 60 });
          }
        }
        if (targetW > 4096) {
          const capScale = 4096 / targetW;
          const capW = 4096;
          const capH = Math.max(64, Math.floor((targetH * capScale) / 2) * 2);
          for (const c of primaryCodecs) {
            candidates.push({
              ...c,
              label: `${c.label} (4K编码适配)`,
              w: capW,
              h: capH,
              hintFps: Math.min(fps, 60),
            });
          }
        }

        let selected: (typeof candidates)[0] | null = null;
        for (const cand of candidates) {
          try {
            const bitrate = Math.min(
              140_000_000,
              Math.max(4_000_000, Math.round(cand.w * cand.h * Math.min(fps, 60) * 0.14)),
            );
            const res = await g.VideoEncoder.isConfigSupported({
              codec: cand.codec,
              width: cand.w,
              height: cand.h,
              bitrate,
              framerate: cand.hintFps,
            });
            if (res.supported) {
              selected = cand;
              break;
            }
          } catch {
            // Try next candidate
          }
        }

        if (selected) {
          activeEncodeW = selected.w;
          activeEncodeH = selected.h;
          if (activeEncodeW !== renderW || activeEncodeH !== renderH) {
            if (encodeCanvas2D === srcCanvas2D) {
              encodeCanvas2D = document.createElement('canvas');
              encodeCtx2D =
                encodeCanvas2D.getContext('2d', { alpha: false, willReadFrequently: true }) ??
                srcCtx2D;
            }
            encodeCanvas2D.width = activeEncodeW;
            encodeCanvas2D.height = activeEncodeH;
          }

          muxer = new WebmMuxer({
            width: activeEncodeW,
            height: activeEncodeH,
            fps,
            codec: selected.webmCodec,
          });
          encoder = new g.VideoEncoder({
            output: (chunk) => {
              const bytes = new Uint8Array(chunk.byteLength);
              chunk.copyTo(bytes);
              muxer!.addVideoChunk(bytes, chunk.timestamp, chunk.type === 'key');
            },
            error: (err) => {
              encoderError = err;
            },
          });
          const bitrate = Math.min(
            140_000_000,
            Math.max(4_000_000, Math.round(activeEncodeW * activeEncodeH * Math.min(fps, 60) * 0.14)),
          );
          encoder.configure({
            codec: selected.codec,
            width: activeEncodeW,
            height: activeEncodeH,
            bitrate,
            framerate: selected.hintFps,
            latencyMode: 'quality',
          });
          encoderLabel = `${selected.label} · ${activeEncodeW}×${activeEncodeH} @ ${fps}FPS`;
        }
      }

      const tarEntries: Array<{ name: string; data: Uint8Array }> = [];
      const keyframeInterval = Math.max(12, Math.min(120, fps));
      const frameDurUs = Math.round(1_000_000 / fps);
      const needsResample = activeEncodeW !== renderW || activeEncodeH !== renderH;

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (abortSignal?.aborted) {
          throw new DOMException('Director offline render aborted', 'AbortError');
        }
        if (encoderError) {
          throw encoderError instanceof Error ? encoderError : new Error(String(encoderError));
        }

        const u = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 1;
        const pose = evaluateDirectorPose(plan, u, anchor);

        // Deterministic substepped physics, fluid, entities, clouds, celestial sky & beam FX
        if (frameIdx === 0) {
          this.stepOfflineSimulation(0, false, !plan.cleanFrame);
        } else if (plan.simTimeScale > 0) {
          this.stepOfflineSimulation(dt * plan.simTimeScale, true, !plan.cleanFrame);
        }

        this.config.sunAzimuthDeg = savedSunAzimuth + pose.sunAzimuthDeltaDeg;
        this.updateSunDirection();

        this.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
        this.camera.up.set(pose.up[0], pose.up[1], pose.up[2]).normalize();
        this.camera.fov = pose.fovDeg;
        this.camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);

        const distFromCenter = this.camera.position.length();
        const surfDist = Math.max(
          this.planet.nativeVoxelSize * 0.25,
          Math.abs(distFromCenter - this.planet.baseRadius),
        );
        const focusDist = Math.max(
          this.planet.nativeVoxelSize * 0.45,
          Math.hypot(
            this.camera.position.x - pose.streamFocus[0],
            this.camera.position.y - pose.streamFocus[1],
            this.camera.position.z - pose.streamFocus[2],
          ),
        );
        const safeClips = computeSafeClipPlanes(
          surfDist,
          focusDist,
          this.planet.baseRadius,
          this.camera.fov,
        );
        this.camera.near = safeClips.near;
        this.camera.far = safeClips.far;
        this.camera.updateProjectionMatrix();

        // Tighten directional shadow frustum smoothly for sharp close-up voxel shadows
        this.updateDynamicShadowFrustum(
          pose.streamFocus[0],
          pose.streamFocus[1],
          pose.streamFocus[2],
          focusDist,
        );

        // Zero-budget-cap full convergence: wait until ALL pending macro & SVO chunks complete
        await this.convergeOfflineGeometryAndShaders(
          frameIdx === 0,
          {
            focus: pose.streamFocus,
            dist: pose.streamDist,
            lodModeOverride: plan.forceMaxVoxelDetail ? 0 : this.config.lodMode,
          },
          abortSignal,
        );

        // GPU-synchronized offscreen render with optional subpixel Halton jitter accumulation & RGBA top-down readback
        await this.renderTargetAccumulatedRgbaTopDown(
          captureRT,
          renderW,
          renderH,
          offlineQual.offlineAccumSamples,
          rgbaBuf,
          abortSignal,
        );

        const wantsCanvasFrame =
          needsResample ||
          !encoder ||
          !muxer ||
          !g.VideoFrame ||
          frameIdx === 0 ||
          frameIdx === totalFrames - 1 ||
          frameIdx % Math.max(4, Math.floor(fps / 6)) === 0;

        if (wantsCanvasFrame) {
          cachedImageData = blitRgbaTopDownToCanvas2D(
            rgbaBuf,
            renderW,
            renderH,
            srcCanvas2D,
            srcCtx2D,
            needsResample ? encodeCanvas2D : undefined,
            needsResample ? encodeCtx2D : null,
            cachedImageData,
          );
        }

        if (encoder && muxer && g.VideoFrame) {
          while (encoder.encodeQueueSize >= 6) {
            await new Promise((r) => setTimeout(r, 4));
          }
          const timestampUs = Math.round((frameIdx * 1_000_000) / fps);
          const framePixels = needsResample
            ? encodeCtx2D.getImageData(0, 0, activeEncodeW, activeEncodeH).data
            : rgbaBuf;

          let vf: { close: () => void };
          try {
            vf = new g.VideoFrame(framePixels, {
              format: 'RGBA',
              codedWidth: activeEncodeW,
              codedHeight: activeEncodeH,
              timestamp: timestampUs,
              duration: frameDurUs,
            });
          } catch {
            if (!wantsCanvasFrame) {
              cachedImageData = blitRgbaTopDownToCanvas2D(
                rgbaBuf,
                renderW,
                renderH,
                srcCanvas2D,
                srcCtx2D,
                needsResample ? encodeCanvas2D : undefined,
                needsResample ? encodeCtx2D : null,
                cachedImageData,
              );
            }
            vf = new g.VideoFrame(encodeCanvas2D, {
              timestamp: timestampUs,
              duration: frameDurUs,
            });
          }
          encoder.encode(vf, { keyFrame: frameIdx % keyframeInterval === 0 });
          vf.close();
        } else {
          const pngBlob = await this.canvasToBlob(encodeCanvas2D, 'image/png');
          const ab = await pngBlob.arrayBuffer();
          const numStr = String(frameIdx).padStart(5, '0');
          tarEntries.push({
            name: `frame_${numStr}.png`,
            data: new Uint8Array(ab),
          });
        }

        const nowMs = performance.now();
        const elapsedSec = (nowMs - renderT0) / 1000;
        const doneCount = frameIdx + 1;
        const etaSec = doneCount > 0 ? (elapsedSec / doneCount) * (totalFrames - doneCount) : 0;

        let previewDataUrl: string | undefined;
        if (
          thumbCtx &&
          (frameIdx === 0 ||
            frameIdx === totalFrames - 1 ||
            frameIdx % Math.max(4, Math.floor(fps / 6)) === 0)
        ) {
          thumbCtx.fillStyle = '#040711';
          thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
          thumbCtx.drawImage(srcCanvas2D, 0, 0, thumbCanvas.width, thumbCanvas.height);
          previewDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.72);
        }

        onProgress({
          frame: doneCount,
          totalFrames,
          percent: Math.round((doneCount / totalFrames) * 1000) / 10,
          elapsedSec,
          etaSec,
          actualWidth: activeEncodeW,
          actualHeight: activeEncodeH,
          encoderLabel,
          statusText: `全量物理&体素逐帧渲染中 · 第 ${doneCount}/${totalFrames} 帧`,
          previewDataUrl,
        });

        await new Promise((r) => setTimeout(r, 0));
      }

      const seedTag = this.planet.seedConfig.seed;
      const elapsedMs = performance.now() - renderT0;

      if (encoder && muxer) {
        onProgress({
          frame: totalFrames,
          totalFrames,
          percent: 99.5,
          elapsedSec: elapsedMs / 1000,
          etaSec: 0,
          actualWidth: activeEncodeW,
          actualHeight: activeEncodeH,
          encoderLabel,
          statusText: '正在封装 WebM 视频容器...',
        });
        await encoder.flush();
        encoder.close();
        encoderClosed = true;
        const webmBytes = muxer.finalize();
        const blob = new Blob([new Uint8Array(webmBytes)], { type: 'video/webm' });
        return {
          blob,
          mimeType: 'video/webm',
          filename: `terrasphere-${seedTag}-${plan.action}-${activeEncodeW}x${activeEncodeH}-${fps}fps.webm`,
          frameCount: totalFrames,
          actualWidth: activeEncodeW,
          actualHeight: activeEncodeH,
          fps,
          elapsedMs: performance.now() - renderT0,
          encoderLabel,
        };
      }

      const tarBytes = buildTarArchive(tarEntries);
      const blob = new Blob([new Uint8Array(tarBytes)], { type: 'application/x-tar' });
      return {
        blob,
        mimeType: 'application/x-tar',
        filename: `terrasphere-${seedTag}-${plan.action}-${activeEncodeW}x${activeEncodeH}-${fps}fps-frames.tar`,
        frameCount: totalFrames,
        actualWidth: activeEncodeW,
        actualHeight: activeEncodeH,
        fps,
        elapsedMs: performance.now() - renderT0,
        encoderLabel,
      };
    } finally {
      if (encoder && !encoderClosed) {
        try {
          encoder.close();
        } catch {
          // ignore already-closed codec state
        }
      }
      this.renderer.setOutputRenderTarget(null);
      this.renderer.setRenderTarget(null);
      captureRT.dispose();

      this.camera.clearViewOffset();
      this.camera.position.copy(savedPos);
      this.camera.quaternion.copy(savedQuat);
      this.camera.up.copy(savedUp);
      this.camera.fov = savedFov;
      this.camera.near = savedNear;
      this.camera.far = savedFar;
      this.camera.aspect = savedAspect;
      this.camera.updateProjectionMatrix();

      this.config.renderQuality = savedQuality;
      this.renderer.setPixelRatio(savedPixelRatio);
      this.renderer.setSize(savedCssW, savedCssH, false);
      this.applyShadowQualitySettings();
      this.syncRenderPipeline(false);

      this.config.sunAzimuthDeg = savedSunAzimuth;
      this.updateSunDirection();
      this.simTimeSec = savedSimTime;
      this.simTimeNode.value = savedSimTime;

      if (prevHelpers) this.restoreEditorHelpersVisible(prevHelpers);

      this.isOfflineRendering = false;
      this.lastTime = performance.now();
      this.scheduleNextFrame();
    }
  }

  public pickLatLonAtClientXY(
    clientX: number,
    clientY: number,
  ): { latDeg: number; lonDeg: number; worldPos: [number, number, number] } | null {
    if (!this.renderer || !this.camera || !this.hasWorld) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const orig = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    const hit = this.planet.raycastTerrain(
      orig.x,
      orig.y,
      orig.z,
      dir.x,
      dir.y,
      dir.z,
      this.planet.worldHalf * 6.0,
    );
    if (!hit.hit) return null;
    const sph = dirToLonLat(hit.x, hit.y, hit.z);
    return {
      latDeg: Number(((sph.latRad * 180) / Math.PI).toFixed(2)),
      lonDeg: Number(((sph.lonRad * 180) / Math.PI).toFixed(2)),
      worldPos: [hit.x, hit.y, hit.z],
    };
  }

  public applyPostFxState(pfx: EvaluatedPostFxState, rebuildIfNeeded = true): void {
    const lut = getLutColorMatrixParams(pfx.lutPreset);
    this.postExposureGainNode.value = clamp(pfx.exposure / 1.12, 0.25, 3.0);
    this.postContrastNode.value = clamp(pfx.contrast * lut.contrastScale, 0.5, 2.2);
    this.postSaturationNode.value = clamp(pfx.saturation * lut.saturationScale, 0.0, 2.5);
    this.postLutIntensityNode.value = clamp(pfx.lutIntensity, 0.0, 1.4);
    this.postShadowTintNode.value.set(
      lut.shadowTint[0],
      lut.shadowTint[1],
      lut.shadowTint[2],
    );
    this.postHighlightTintNode.value.set(
      lut.highlightTint[0],
      lut.highlightTint[1],
      lut.highlightTint[2],
    );
    this.postVignetteNode.value = clamp(pfx.vignette, 0.0, 0.95);
    this.postFilmGrainNode.value = clamp(pfx.filmGrain, 0.0, 0.35);
    this.activeBloomStrength = clamp(pfx.bloomStrength, 0.0, 1.8);
    this.activeAspectMask = pfx.aspectMask;
    const prevFilter = this.activeVisualFilter;
    this.activeVisualFilter = pfx.visualFilter ?? 'none';
    this.activeFilterIntensity = clamp(pfx.filterIntensity ?? 0.85, 0.0, 1.0);
    this.activeFilterScale = clamp(pfx.filterScale ?? 1.0, 0.25, 3.0);
    if (this.activeBloomNode) {
      this.activeBloomNode.strength.value = this.activeBloomStrength;
    }

    const needsNode =
      pfx.lutPreset !== 'natural' ||
      Math.abs(pfx.exposure - 1.12) > 0.02 ||
      Math.abs(pfx.contrast - 1.0) > 0.02 ||
      Math.abs(pfx.saturation - 1.0) > 0.02 ||
      pfx.vignette > 0.01 ||
      pfx.filmGrain > 0.005;

    const filterBucketChanged = prevFilter !== this.activeVisualFilter;

    if (rebuildIfNeeded && (needsNode !== this.activePostGradingEnabled || filterBucketChanged)) {
      this.activePostGradingEnabled = needsNode;
      this.syncRenderPipeline(this.isOfflineRendering);
    } else {
      this.activePostGradingEnabled = needsNode;
      const meta = VISUAL_FILTER_META.find(
        (m) => m.id === (this.activeVisualFilter !== 'none' ? this.activeVisualFilter : (this.config.visualFilter ?? 'none')),
      );
      this.postFilterModeNode.value = meta?.modeIndex ?? 0;
      this.postFilterIntensityNode.value =
        this.activeVisualFilter !== 'none' ? this.activeFilterIntensity : clamp(this.config.filterIntensity ?? 0.85, 0, 1);
      this.postFilterScaleNode.value =
        this.activeVisualFilter !== 'none' ? this.activeFilterScale : clamp(this.config.filterScale ?? 1.0, 0.25, 3.0);
      this.integralDampNode.value = clamp(0.68 + this.postFilterIntensityNode.value * 0.28, 0.55, 0.96);
    }
  }

  public resetDirectorPostGradingUniforms(): void {
    this.postExposureGainNode.value = 1.0;
    this.postContrastNode.value = 1.0;
    this.postSaturationNode.value = 1.0;
    this.postLutIntensityNode.value = 0.0;
    this.postShadowTintNode.value.set(1, 1, 1);
    this.postHighlightTintNode.value.set(1, 1, 1);
    this.postVignetteNode.value = 0.0;
    this.postFilmGrainNode.value = 0.0;
    this.activeBloomStrength = 0.34;
    this.activeAspectMask = 'none';
    const hadDirectorFilter = this.activeVisualFilter !== 'none';
    this.activeVisualFilter = 'none';
    this.activeFilterIntensity = this.config.filterIntensity ?? 0.85;
    this.activeFilterScale = this.config.filterScale ?? 1.0;
    if (this.activePostGradingEnabled || hadDirectorFilter) {
      this.activePostGradingEnabled = false;
      this.syncRenderPipeline(this.isOfflineRendering);
    }
  }

  public exportDirectorWorldRestoreSnapshot(): DirectorWorldSnapshot {
    return {
      planet: this.planet.exportSnapshot(),
      fluid: this.fluid.exportState(),
      hotspots: this.thermalHotspots.map((h) => ({ ...h })),
      simTimeSec: this.simTimeSec,
      sunAzimuthDeg: this.config.sunAzimuthDeg,
      sunElevationDeg: this.config.sunElevationDeg,
      atmosphere: { ...this.config.atmosphere },
      thermal: { ...this.config.thermal },
      playerPos: [this.playerPos.x, this.playerPos.y, this.playerPos.z],
      playerFwd: [this.playerFwd.x, this.playerFwd.y, this.playerFwd.z],
    };
  }

  public restoreDirectorWorldSnapshot(snap: DirectorWorldSnapshot): void {
    this.planet.importSnapshot(snap.planet);
    this.rebuildChunkCenters();
    this.fluid.importState(snap.fluid);
    this.thermalHotspots = snap.hotspots.map((h) => ({ ...h }));
    this.simTimeSec = snap.simTimeSec;
    this.simTimeNode.value = snap.simTimeSec;
    this.playerPos.set(snap.playerPos[0], snap.playerPos[1], snap.playerPos[2]);
    this.playerFwd
      .set(snap.playerFwd[0], snap.playerFwd[1], snap.playerFwd[2])
      .normalize();
    this.playerVel.set(0, 0, 0);
    this.syncPlayerTransform();
    this.activeMeteors = [];
    this.activeShockwaves = [];
    this.activeVortices = [];
    this.activeWorms = [];
    this.lightningLife = 0;

    this.config = {
      ...this.config,
      sunAzimuthDeg: snap.sunAzimuthDeg,
      sunElevationDeg: snap.sunElevationDeg,
      atmosphere: { ...snap.atmosphere },
      thermal: { ...snap.thermal },
    };
    this.updateSunDirection();
    this.syncEnvironmentUniforms();
    this.rebuildAllChunks();
    this.rebuildWaterMesh();
    this.updateSplashInstances();
    this.emitTelemetrySnapshot();
  }

  public dispatchDirectorWorldEvent(
    ev: DirectorWorldEvent,
    phaseScale = 1.0,
  ): void {
    if (!ev.enabled || !this.hasWorld) return;
    const scale = this.getPlanetScale();
    const latRad = (clamp(ev.latDeg, -89.5, 89.5) * Math.PI) / 180;
    const lonRad = (ev.lonDeg * Math.PI) / 180;
    const [nx, ny, nz] = lonLatToDir(lonRad, latRad);
    const surfR = this.planet.findSurfaceRadiusAlongRay(nx, ny, nz);
    const hx = nx * surfR;
    const hy = ny * surfR;
    const hz = nz * surfR;
    const effRad = Math.max(
      this.planet.nativeVoxelSize * 1.4,
      1.9 * scale * clamp(ev.radiusMult, 0.25, 6.0),
    );
    const effStr = clamp(ev.strength, 0.2, 5.0) * Math.max(0.25, phaseScale);

    switch (ev.type) {
      case 'volcano': {
        this.planet.applyBrush(hx, hy, hz, 'volcano', effRad, effStr * 1.5, ev.materialId || MaterialId.Basalt);
        this.spawnMagmaBurst(
          hx + nx * effRad * 0.45,
          hy + ny * effRad * 0.45,
          hz + nz * effRad * 0.45,
          nx,
          ny,
          nz,
          8,
          effRad * 0.28,
          1.25,
          false,
        );
        this.spawnDebrisBurst(hx, hy, hz, nx, ny, nz, 10, 14, effStr);
        this.addThermalHotspot(hx, hy, hz, effRad * 2.4, 480 * effStr, 35);
        this.updateChunksWithLod(56);
        this.updateHighResStreaming({ hit: true, distance: 0, x: hx, y: hy, z: hz, nx, ny, nz }, 56);
        this.waterMeshDirty = true;
        break;
      }
      case 'nuke': {
        this.planet.applyBrush(hx, hy, hz, 'crater', effRad * 1.35, effStr * 2.4, MaterialId.Basalt, {
          rimHeight: 1.1,
          rimMaterial: MaterialId.Basalt,
          floorMaterial: MaterialId.Crystal,
        });
        this.fluid.applyRadialImpulse(hx, hy, hz, effRad * 2.8, 28 * Math.sqrt(scale), 14 * Math.sqrt(scale));
        this.fluid.drainWithinRadius(hx, hy, hz, effRad * 0.9);
        this.spawnMagmaBurst(hx, hy, hz, nx, ny, nz, 14, effRad * 0.35, 1.35, false);
        this.spawnShockwave(hx, hy, hz, nx, ny, nz, effRad * 2.9, true, true);
        this.spawnDebrisBurst(hx, hy, hz, nx, ny, nz, 14, 18, effStr);
        this.addThermalHotspot(hx, hy, hz, effRad * 2.8, 860 * effStr, 55);
        this.updateChunksWithLod(64);
        this.updateHighResStreaming({ hit: true, distance: 0, x: hx, y: hy, z: hz, nx, ny, nz }, 64);
        this.waterMeshDirty = true;
        break;
      }
      case 'crater': {
        this.planet.applyBrush(hx, hy, hz, 'crater', effRad * 1.1, effStr * 1.8, MaterialId.Stone, {
          rimHeight: 0.72,
          rimMaterial: MaterialId.Sandstone,
          floorMaterial: ev.materialId || MaterialId.Stone,
        });
        this.spawnShockwave(hx, hy, hz, nx, ny, nz, effRad * 2.1, true, false);
        this.spawnDebrisBurst(hx, hy, hz, nx, ny, nz, 10, 15, effStr);
        this.addThermalHotspot(hx, hy, hz, effRad * 2.0, 260 * effStr, 60);
        this.updateChunksWithLod(56);
        this.updateHighResStreaming({ hit: true, distance: 0, x: hx, y: hy, z: hz, nx, ny, nz }, 56);
        this.waterMeshDirty = true;
        break;
      }
      case 'meteorShower': {
        const orbitDist = Math.max(this.planet.baseRadius * 1.25, 13 * scale);
        const speed = 26 * Math.sqrt(scale);
        const mCount = clamp(Math.round(2 + ev.strength * 2), 2, 6);
        for (let k = 0; k < mCount; k++) {
          if (this.activeMeteors.length >= this.MAX_METEORS) break;
          const jx = (Math.random() - 0.5) * effRad * 2.2;
          const jy = (Math.random() - 0.5) * effRad * 2.2;
          const jz = (Math.random() - 0.5) * effRad * 2.2;
          const tx = hx + jx * 0.6;
          const ty = hy + jy * 0.6;
          const tz = hz + jz * 0.6;
          const sx = hx + nx * orbitDist + jx;
          const sy = hy + ny * orbitDist + jy;
          const sz = hz + nz * orbitDist + jz;
          const dLen = Math.hypot(tx - sx, ty - sy, tz - sz) || 1;
          this.activeMeteors.push({
            x: sx,
            y: sy,
            z: sz,
            vx: ((tx - sx) / dLen) * speed,
            vy: ((ty - sy) / dLen) * speed,
            vz: ((tz - sz) / dLen) * speed,
            radius: effRad * 0.72,
            strength: effStr * 1.5,
            thermalDeltaC: 340,
            debrisCount: 8,
            material: ev.materialId || MaterialId.Basalt,
            rimMaterial: MaterialId.Sandstone,
            leaveRim: true,
            life: 3.0,
          });
        }
        break;
      }
      case 'waterFlood': {
        const streamCount = clamp(Math.round(18 * ev.strength), 8, 64);
        this.fluid.emitStream(hx, hy, hz, nx, ny, nz, streamCount, effRad * 0.85, scale);
        this.fluid.applyRadialImpulse(hx, hy, hz, effRad * 1.5, 4.5 * Math.sqrt(scale), 3.0 * Math.sqrt(scale));
        this.waterMeshDirty = true;
        break;
      }
      case 'drain': {
        this.fluid.drainWithinRadius(hx, hy, hz, Math.max(effRad * 1.35, 1.2 * scale));
        this.waterMeshDirty = true;
        break;
      }
      case 'tractorBurst': {
        this.fluid.applyRadialImpulse(
          hx,
          hy,
          hz,
          effRad * 2.2,
          16 * effStr * Math.sqrt(scale),
          14 * effStr * Math.sqrt(scale),
        );
        this.spawnDebrisBurst(hx, hy, hz, nx, ny, nz, 10, 14 * effStr, effStr);
        this.spawnShockwave(hx, hy, hz, nx, ny, nz, effRad * 2.0, false, false);
        break;
      }
      case 'thermalHotspot': {
        this.addThermalHotspot(hx, hy, hz, effRad * 2.6, 550 * effStr, 25);
        this.spawnMagmaBurst(hx, hy, hz, nx, ny, nz, 6, effRad * 0.25, 1.0, true);
        break;
      }
      case 'terraformMaterial': {
        this.planet.applyBrush(hx, hy, hz, 'build', effRad, effStr * 1.35, ev.materialId || MaterialId.Crystal);
        this.updateChunksWithLod(48);
        this.updateHighResStreaming({ hit: true, distance: 0, x: hx, y: hy, z: hz, nx, ny, nz }, 48);
        this.waterMeshDirty = true;
        break;
      }
    }
  }

  public setDirectorTimelineLocked(locked: boolean): void {
    this.directorTimelineLocked = locked;
    if (locked) {
      this.directorWaterBaseCount = Math.max(
        this.fluid.activeCount,
        Math.round(560 * this.planet.seedConfig.waterFill),
        320,
      );
    } else {
      this.directorWaterBaseCount = null;
      this.activeSolarIntensity = 1.0;
      this.solarIntensityNode.value = 1.0;
      if (this.sunLight) {
        this.sunLight.intensity = 3.25;
      }
      this.syncEnvironmentUniforms();
    }
  }

  /**
   * Applies full NLE timeline state (Camera, Environment/Sun/Clouds, Post-FX LUTs, optional World Events
   * & per-parameter overrides including solarIntensity & waterVolume) at `timeSec`.
   */
  public applyDirectorTimelineAtTime(
    project: DirectorTimelineProject,
    anchor: DirectorSceneAnchor,
    timeSec: number,
    options?: {
      advanceEventsFromSec?: number;
      firedEventIds?: Set<string>;
      updateEnvironment?: boolean;
      updatePostFx?: boolean;
    },
  ): {
    pose: ReturnType<typeof evaluateCameraTrackPose>;
    env: ReturnType<typeof evaluateEnvironmentTrack>;
    pfx: EvaluatedPostFxState;
  } {
    const t = clamp(timeSec, 0, Math.max(0.25, project.durationSec));
    const { pose, env, pfx } = evaluateFullTimelineAtTime(project, anchor, t, {
      sunElevationDeg: this.config.sunElevationDeg,
      sunAzimuthDeg: this.config.sunAzimuthDeg,
      solarIntensity: this.activeSolarIntensity,
      atmoDensity: this.config.atmosphere.surfacePressureAtm,
      scatterStrength: this.config.atmosphere.rayleighStrength,
      cloudCoverage: this.config.atmosphere.cloudCover,
      cloudAltitudeRatio: this.config.atmosphere.cloudAltitudeRatio,
      windSpeed: this.config.atmosphere.windSpeed,
      tempOffsetC: this.config.thermal.baseEquilibriumC + 18,
    });

    if (options?.updateEnvironment !== false) {
      this.config.sunElevationDeg = env.sunElevationDeg;
      this.config.sunAzimuthDeg = env.sunAzimuthDeg;
      this.activeSolarIntensity = clamp(env.solarIntensity, 0.05, 4.5);
      this.solarIntensityNode.value = this.activeSolarIntensity;
      if (this.sunLight) {
        this.sunLight.intensity = 3.25 * this.activeSolarIntensity;
      }
      this.config.atmosphere = {
        ...this.config.atmosphere,
        surfacePressureAtm: env.atmoDensity,
        rayleighStrength: env.scatterStrength,
        cloudCover: env.cloudCoverage,
        cloudAltitudeRatio: env.cloudAltitudeRatio,
        windSpeed: env.windSpeed,
      };
      this.config.thermal = {
        ...this.config.thermal,
        baseEquilibriumC: -18 + env.tempOffsetC,
      };
      this.updateSunDirection();
      this.syncEnvironmentUniforms();

      if (env.waterVolume !== null) {
        const baseWater =
          this.directorWaterBaseCount ??
          Math.max(480, Math.round(560 * this.planet.seedConfig.waterFill));
        const targetWater = Math.round(
          clamp(baseWater * clamp(env.waterVolume, 0, 2.5), 0, MAX_FLUID_PARTICLES),
        );
        const waterChanged = this.fluid.setTargetParticleCount(
          this.planet,
          targetWater,
          Math.round(t * 10) + 1,
        );
        if (waterChanged) {
          this.rebuildWaterMesh();
          this.updateSplashInstances();
          this.waterMeshDirty = false;
        }
      }
    }

    if (options?.updatePostFx !== false) {
      this.applyPostFxState(pfx, !this.isOfflineRendering);
    }

    if (options?.firedEventIds && options.advanceEventsFromSec !== undefined) {
      const fromT = options.advanceEventsFromSec;
      for (const ev of project.eventTrack) {
        if (!ev.enabled) continue;
        if (options.firedEventIds.has(ev.id)) continue;
        if (ev.triggerTimeSec <= t && ev.triggerTimeSec >= Math.min(fromT - 0.05, 0)) {
          this.dispatchDirectorWorldEvent(ev, 1.0);
          options.firedEventIds.add(ev.id);
        }
      }
    }

    this.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.camera.up.set(pose.up[0], pose.up[1], pose.up[2]).normalize();
    this.camera.fov = pose.fovDeg;
    this.camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);

    const distFromCenter = this.camera.position.length();
    const surfDist = Math.max(
      this.planet.nativeVoxelSize * 0.25,
      Math.abs(distFromCenter - this.planet.baseRadius),
    );
    const focusDist = Math.max(
      this.planet.nativeVoxelSize * 0.45,
      Math.hypot(
        this.camera.position.x - pose.streamFocus[0],
        this.camera.position.y - pose.streamFocus[1],
        this.camera.position.z - pose.streamFocus[2],
      ),
    );
    const safeClips = computeSafeClipPlanes(
      surfDist,
      focusDist,
      this.planet.baseRadius,
      this.camera.fov,
    );
    this.camera.near = safeClips.near;
    this.camera.far = safeClips.far;
    this.camera.updateProjectionMatrix();
    this.lastHighResFocus.set(pose.streamFocus[0], pose.streamFocus[1], pose.streamFocus[2]);

    if (!this.isOfflineRendering && !this.isGenerating && this.renderer) {
      this.renderActiveScene();
    }

    return { pose, env, pfx };
  }

  /**
   * Checkpointed & Resumable Offline Multi-Track Director Render Engine.
   * Persists simulation snapshots, encoded chunks, RGB histograms & thumbnails to IndexedDB on every frame
   * so renders survive Pause, Abort-Keep, and full page reload cleanly.
   */
  public async renderDirectorProjectOffline(options: {
    project: DirectorTimelineProject;
    anchor?: DirectorSceneAnchor;
    resumeJob?: RenderCheckpointJob;
    onProgress: (p: DirectorRenderProgress) => void;
    abortSignal?: AbortSignal;
    shouldPause?: () => boolean;
  }): Promise<{
    status: 'completed' | 'paused' | 'aborted';
    job: RenderCheckpointJob;
    result?: {
      blob: Blob;
      mimeType: string;
      filename: string;
      frameCount: number;
      actualWidth: number;
      actualHeight: number;
      fps: number;
      elapsedMs: number;
      encoderLabel: string;
    };
  }> {
    this.stopDirectorPreview();
    cancelAnimationFrame(this.frameHandle);
    clearTimeout(this.timerHandle);

    const project = options.resumeJob?.projectSnapshot ?? options.project;
    const range = computeProjectFrameRange(project);
    const startFrame = options.resumeJob ? options.resumeJob.startFrame : range.startFrame;
    const endFrame = options.resumeJob ? options.resumeJob.endFrame : range.endFrame;
    const fps = range.fps;
    const totalRangeFrames = Math.max(1, endFrame - startFrame + 1);
    const dt = 1 / fps;

    const targetW = Math.max(64, Math.min(8192, Math.floor(project.width / 2) * 2));
    const targetH = Math.max(64, Math.min(8192, Math.floor(project.height / 2) * 2));
    const anchor = options.resumeJob?.anchorSnapshot ?? options.anchor ?? this.buildDirectorAnchor();
    const { renderW, renderH } = this.computeRenderBufferSize(targetW, targetH);

    // Save live interactive sandbox state so exiting/completing never leaves stale viewport settings
    const savedPos = this.camera.position.clone();
    const savedQuat = this.camera.quaternion.clone();
    const savedUp = this.camera.up.clone();
    const savedFov = this.camera.fov;
    const savedNear = this.camera.near;
    const savedFar = this.camera.far;
    const savedAspect = this.camera.aspect;
    const savedPixelRatio = this.renderer.getPixelRatio();
    const savedCssW = Math.max(1, this.container.clientWidth);
    const savedCssH = Math.max(1, this.container.clientHeight);
    const savedQuality = { ...this.config.renderQuality };
    const savedSunAzimuth = this.config.sunAzimuthDeg;
    const savedSunElevation = this.config.sunElevationDeg;
    const savedAtmo = { ...this.config.atmosphere };
    const savedThermal = { ...this.config.thermal };
    const savedSimTime = this.simTimeSec;
    const prevHelpers = project.cleanFrame ? this.setEditorHelpersVisible(false) : null;

    this.isOfflineRendering = true;
    const renderT0 = performance.now();

    const captureRT = this.createOfflineCaptureTarget(renderW, renderH);
    const rgbaBuf = new Uint8ClampedArray(renderW * renderH * 4);

    const srcCanvas2D = document.createElement('canvas');
    srcCanvas2D.width = renderW;
    srcCanvas2D.height = renderH;
    const srcCtx2D = srcCanvas2D.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!srcCtx2D) {
      captureRT.dispose();
      throw new Error('Failed to create offline staging 2D canvas context');
    }

    let encodeCanvas2D: HTMLCanvasElement = srcCanvas2D;
    let encodeCtx2D: CanvasRenderingContext2D = srcCtx2D;
    if (renderW !== targetW || renderH !== targetH) {
      encodeCanvas2D = document.createElement('canvas');
      encodeCanvas2D.width = targetW;
      encodeCanvas2D.height = targetH;
      encodeCtx2D =
        encodeCanvas2D.getContext('2d', { alpha: false, willReadFrequently: true }) ?? srcCtx2D;
    }

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 240;
    thumbCanvas.height = Math.max(72, Math.round((240 * targetH) / targetW));
    const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
    let cachedImageData: ImageData | null = null;

    type WebCodecsEnc = {
      configure: (cfg: Record<string, unknown>) => void;
      encode: (frame: unknown, opts?: { keyFrame?: boolean }) => void;
      flush: () => Promise<void>;
      close: () => void;
      encodeQueueSize: number;
    };

    let encoder: WebCodecsEnc | null = null;
    let encoderClosed = false;
    const jobId = options.resumeJob?.id ?? `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    let jobRecord: RenderCheckpointJob | null = null;

    try {
      const offlineQual = resolveDirectorOfflineQuality(savedQuality, project.offlineQuality);
      this.config.renderQuality = offlineQual;
      this.activePostGradingEnabled = true;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(renderW, renderH, false);
      this.applyShadowQualitySettings();
      this.syncRenderPipeline(true, renderW);

      this.camera.aspect = targetW / targetH;
      this.camera.updateProjectionMatrix();

      type WebCodecsCtor = {
        new (init: {
          output: (chunk: {
            byteLength: number;
            timestamp: number;
            type: 'key' | 'delta';
            copyTo: (dest: Uint8Array) => void;
          }) => void;
          error: (err: unknown) => void;
        }): WebCodecsEnc;
        isConfigSupported: (cfg: Record<string, unknown>) => Promise<{ supported?: boolean }>;
      };
      type VideoFrameCtor = new (
        source: BufferSource | HTMLCanvasElement,
        init: Record<string, unknown>,
      ) => { close: () => void };

      const g = globalThis as unknown as {
        VideoEncoder?: WebCodecsCtor;
        VideoFrame?: VideoFrameCtor;
      };

      let useWebm = false;
      let webmCodec: WebmVideoCodec = 'V_VP9';
      let encoderError: unknown = null;
      let encoderLabel = 'PNG 无损序列 (.tar)';
      let activeEncodeW = targetW;
      let activeEncodeH = targetH;

      // Collect serialized WebCodecs chunks tagged chronologically with pending metadata
      const pendingChunkQueue: Array<{
        frameIdx: number;
        timestampUs: number;
        thumbDataUrl: string;
        renderMs: number;
        meanLuma: number;
        alphaMin: number;
        histogram: ReturnType<typeof computeRgbHistogram>;
      }> = [];
      let chunkSavePromises: Promise<void>[] = [];

      const wantWebm = project.format !== 'png-tar';
      if (wantWebm && typeof g.VideoEncoder === 'function' && typeof g.VideoFrame === 'function') {
        const candidates: Array<{
          codec: string;
          webmCodec: WebmVideoCodec;
          label: string;
          w: number;
          h: number;
          hintFps: number;
        }> = [];
        const primaryCodecs =
          project.format === 'webm-vp8'
            ? [{ codec: 'vp8', webmCodec: 'V_VP8' as WebmVideoCodec, label: 'WebCodecs VP8' }]
            : [
                { codec: 'vp09.00.62.08', webmCodec: 'V_VP9' as WebmVideoCodec, label: 'WebCodecs VP9 L6.2' },
                { codec: 'vp09.00.61.08', webmCodec: 'V_VP9' as WebmVideoCodec, label: 'WebCodecs VP9 L6.1' },
                { codec: 'vp09.00.52.08', webmCodec: 'V_VP9' as WebmVideoCodec, label: 'WebCodecs VP9 L5.2' },
                { codec: 'vp09.00.51.08', webmCodec: 'V_VP9' as WebmVideoCodec, label: 'WebCodecs VP9 L5.1' },
                { codec: 'vp8', webmCodec: 'V_VP8' as WebmVideoCodec, label: 'WebCodecs VP8' },
              ];

        for (const c of primaryCodecs) {
          candidates.push({ ...c, w: targetW, h: targetH, hintFps: fps });
          if (fps > 60) {
            candidates.push({ ...c, w: targetW, h: targetH, hintFps: 60 });
          }
        }
        if (targetW > 4096) {
          const capScale = 4096 / targetW;
          const capW = 4096;
          const capH = Math.max(64, Math.floor((targetH * capScale) / 2) * 2);
          for (const c of primaryCodecs) {
            candidates.push({
              ...c,
              label: `${c.label} (4K编码适配)`,
              w: capW,
              h: capH,
              hintFps: Math.min(fps, 60),
            });
          }
        }

        let selected: (typeof candidates)[0] | null = null;
        for (const cand of candidates) {
          try {
            const bitrate = Math.min(
              140_000_000,
              Math.max(4_000_000, Math.round(cand.w * cand.h * Math.min(fps, 60) * 0.14)),
            );
            const res = await g.VideoEncoder.isConfigSupported({
              codec: cand.codec,
              width: cand.w,
              height: cand.h,
              bitrate,
              framerate: cand.hintFps,
            });
            if (res.supported) {
              selected = cand;
              break;
            }
          } catch {
            // Try next candidate
          }
        }

        if (selected) {
          useWebm = true;
          webmCodec = selected.webmCodec;
          activeEncodeW = selected.w;
          activeEncodeH = selected.h;
          if (activeEncodeW !== renderW || activeEncodeH !== renderH) {
            if (encodeCanvas2D === srcCanvas2D) {
              encodeCanvas2D = document.createElement('canvas');
              encodeCtx2D =
                encodeCanvas2D.getContext('2d', { alpha: false, willReadFrequently: true }) ??
                srcCtx2D;
            }
            encodeCanvas2D.width = activeEncodeW;
            encodeCanvas2D.height = activeEncodeH;
          }

          encoder = new g.VideoEncoder({
            output: (chunk) => {
              const meta = pendingChunkQueue.shift();
              if (!meta) return;
              const bytes = new Uint8Array(chunk.byteLength);
              chunk.copyTo(bytes);
              chunkSavePromises.push(
                saveEncodedFrameChunkToDb({
                  jobId,
                  frameIdx: meta.frameIdx,
                  timestampUs: chunk.timestamp,
                  isKeyFrame: chunk.type === 'key',
                  isPng: false,
                  payload: bytes.buffer,
                  thumbDataUrl: meta.thumbDataUrl,
                  renderMs: meta.renderMs,
                  meanLuma: meta.meanLuma,
                  alphaMin: meta.alphaMin,
                  histogram: meta.histogram,
                }),
              );
            },
            error: (err) => {
              encoderError = err;
            },
          });

          const bitrate = Math.min(
            140_000_000,
            Math.max(4_000_000, Math.round(activeEncodeW * activeEncodeH * Math.min(fps, 60) * 0.14)),
          );
          encoder.configure({
            codec: selected.codec,
            width: activeEncodeW,
            height: activeEncodeH,
            bitrate,
            framerate: selected.hintFps,
            latencyMode: 'quality',
          });
          encoderLabel = `${selected.label} · ${activeEncodeW}×${activeEncodeH} @ ${fps}FPS`;
        }
      }

      const keyframeInterval = clamp(
        Math.round(project.checkpointIntervalFrames || Math.max(12, Math.min(60, Math.round(fps / 2)))),
        4,
        180,
      );
      const frameDurUs = Math.round(1_000_000 / fps);
      const needsResample = activeEncodeW !== renderW || activeEncodeH !== renderH;

      // Determine exact resume startFrame from latest saved SimulationCheckpoint
      let resumeFrame = startFrame;
      const firedEventIds = new Set<string>();
      if (options.resumeJob) {
        const latestCp = await getLatestCheckpointAtOrBefore(
          options.resumeJob.id,
          options.resumeJob.lastCheckpointFrame,
        );
        resumeFrame = computeCheckpointResumeStartFrame({
          startFrame,
          endFrame,
          latestCheckpointFrame: latestCp ? latestCp.frameIdx : null,
        });
        if (latestCp) {
          this.planet.importSnapshot(latestCp.planet);
          this.rebuildChunkCenters();
          this.fluid.importState(latestCp.fluid);
          this.thermalHotspots = latestCp.hotspots.map((h) => ({ ...h }));
          this.simTimeSec = latestCp.simTimeSec;
          this.simTimeNode.value = latestCp.simTimeSec;
          this.config.sunAzimuthDeg = latestCp.sunAzimuthDeg;
          this.config.sunElevationDeg = latestCp.sunElevationDeg;
          this.updateSunDirection();
          for (const eid of latestCp.firedEventIds) {
            firedEventIds.add(eid);
          }
          this.playerPos.set(latestCp.playerPos[0], latestCp.playerPos[1], latestCp.playerPos[2]);
          this.playerFwd.set(latestCp.playerFwd[0], latestCp.playerFwd[1], latestCp.playerFwd[2]).normalize();
          this.rebuildAllChunks();
          this.rebuildWaterMesh();
        }
      }

      jobRecord = {
        id: jobId,
        projectId: project.id,
        projectName: project.name,
        createdAt: options.resumeJob?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        status: 'rendering',
        format: project.format,
        webmCodec: useWebm ? webmCodec : undefined,
        encoderLabel,
        width: activeEncodeW,
        height: activeEncodeH,
        fps,
        startFrame,
        endFrame,
        totalFrames: range.totalFrames,
        keyframeInterval,
        completedFrames: options.resumeJob?.completedFrames ?? 0,
        lastCheckpointFrame: options.resumeJob?.lastCheckpointFrame ?? startFrame,
        projectSnapshot: project,
        anchorSnapshot: anchor,
      };
      await saveRenderJobToDb(jobRecord);

      let prevTimeSec = resumeFrame * dt;
      for (let frameIdx = resumeFrame; frameIdx <= endFrame; frameIdx++) {
        if (options.shouldPause?.()) {
          // Save clean simulation checkpoint right before yielding pause
          if (encoder && !encoderClosed) {
            await encoder.flush();
            await Promise.all(chunkSavePromises);
            chunkSavePromises = [];
          }
          await saveSimulationCheckpointToDb({
            jobId,
            frameIdx,
            createdAt: Date.now(),
            simTimeSec: this.simTimeSec,
            sunAzimuthDeg: this.config.sunAzimuthDeg,
            sunElevationDeg: this.config.sunElevationDeg,
            planet: this.planet.exportSnapshot(),
            fluid: this.fluid.exportState(),
            hotspots: this.thermalHotspots.map((h) => ({ ...h })),
            firedEventIds: Array.from(firedEventIds),
            playerPos: [this.playerPos.x, this.playerPos.y, this.playerPos.z],
            playerFwd: [this.playerFwd.x, this.playerFwd.y, this.playerFwd.z],
          });
          jobRecord = {
            ...jobRecord,
            updatedAt: Date.now(),
            status: 'paused',
            completedFrames: frameIdx - startFrame,
            lastCheckpointFrame: frameIdx,
          };
          await saveRenderJobToDb(jobRecord);
          return { status: 'paused', job: jobRecord };
        }

        if (options.abortSignal?.aborted) {
          if (encoder && !encoderClosed) {
            try {
              await encoder.flush();
              await Promise.all(chunkSavePromises);
            } catch {
              // ignore flush errors on abort
            }
          }
          jobRecord = {
            ...jobRecord,
            updatedAt: Date.now(),
            status: 'aborted',
            completedFrames: frameIdx - startFrame,
          };
          await saveRenderJobToDb(jobRecord);
          return { status: 'aborted', job: jobRecord };
        }

        if (encoderError) {
          throw encoderError instanceof Error ? encoderError : new Error(String(encoderError));
        }

        const frameStartMs = performance.now();
        const curTimeSec = frameIdx * dt;
        const isCpBoundary =
          frameIdx === startFrame || (frameIdx - startFrame) % keyframeInterval === 0;

        // Save IndexedDB physical snapshot at every checkpoint/keyframe boundary before advancing
        if (isCpBoundary) {
          await saveSimulationCheckpointToDb({
            jobId,
            frameIdx,
            createdAt: Date.now(),
            simTimeSec: this.simTimeSec,
            sunAzimuthDeg: this.config.sunAzimuthDeg,
            sunElevationDeg: this.config.sunElevationDeg,
            planet: this.planet.exportSnapshot(),
            fluid: this.fluid.exportState(),
            hotspots: this.thermalHotspots.map((h) => ({ ...h })),
            firedEventIds: Array.from(firedEventIds),
            playerPos: [this.playerPos.x, this.playerPos.y, this.playerPos.z],
            playerFwd: [this.playerFwd.x, this.playerFwd.y, this.playerFwd.z],
          });
          jobRecord.lastCheckpointFrame = frameIdx;
        }

        // Advance simulation + evaluate timeline tracks & timed world events
        if (frameIdx === startFrame && !options.resumeJob) {
          this.stepOfflineSimulation(0, false, !project.cleanFrame);
        } else if (project.simTimeScale > 0) {
          this.stepOfflineSimulation(dt * project.simTimeScale, true, !project.cleanFrame);
        }

        const evaluated = this.applyDirectorTimelineAtTime(project, anchor, curTimeSec, {
          advanceEventsFromSec: prevTimeSec,
          firedEventIds,
          updateEnvironment: true,
          updatePostFx: true,
        });
        prevTimeSec = curTimeSec;

        this.updateDynamicShadowFrustum(
          evaluated.pose.streamFocus[0],
          evaluated.pose.streamFocus[1],
          evaluated.pose.streamFocus[2],
          Math.max(
            this.planet.nativeVoxelSize * 0.45,
            Math.hypot(
              this.camera.position.x - evaluated.pose.streamFocus[0],
              this.camera.position.y - evaluated.pose.streamFocus[1],
              this.camera.position.z - evaluated.pose.streamFocus[2],
            ),
          ),
        );

        await this.convergeOfflineGeometryAndShaders(
          frameIdx === resumeFrame,
          {
            focus: evaluated.pose.streamFocus,
            dist: evaluated.pose.streamDist,
            lodModeOverride: project.forceMaxVoxelDetail ? 0 : this.config.lodMode,
          },
          options.abortSignal,
        );

        await this.renderTargetAccumulatedRgbaTopDown(
          captureRT,
          renderW,
          renderH,
          offlineQual.offlineAccumSamples,
          rgbaBuf,
          options.abortSignal,
        );

        const wantsAspectMatte = evaluated.pfx.aspectMask !== 'none';
        const wantsCanvasFrame =
          needsResample || wantsAspectMatte || !useWebm || !encoder || !g.VideoFrame;

        // Always update srcCanvas2D when resampled/matted or generating thumbnail
        cachedImageData = blitRgbaTopDownToCanvas2D(
          rgbaBuf,
          renderW,
          renderH,
          srcCanvas2D,
          srcCtx2D,
          needsResample ? encodeCanvas2D : undefined,
          needsResample ? encodeCtx2D : null,
          cachedImageData,
        );
        if (wantsAspectMatte) {
          applyAspectMatteToCanvas2D(
            encodeCtx2D,
            activeEncodeW,
            activeEncodeH,
            evaluated.pfx.aspectMask,
          );
        }

        const histogram = computeRgbHistogram(rgbaBuf, 32, 48);
        let thumbDataUrl = '';
        if (thumbCtx) {
          thumbCtx.fillStyle = '#040711';
          thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
          thumbCtx.drawImage(
            wantsAspectMatte ? encodeCanvas2D : srcCanvas2D,
            0,
            0,
            thumbCanvas.width,
            thumbCanvas.height,
          );
          thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.72);
        }

        const frameRenderMs = performance.now() - frameStartMs;

        if (useWebm && encoder && g.VideoFrame) {
          while (encoder.encodeQueueSize >= 6) {
            await new Promise((r) => setTimeout(r, 4));
          }
          const timestampUs = Math.round((frameIdx * 1_000_000) / fps);
          pendingChunkQueue.push({
            frameIdx,
            timestampUs,
            thumbDataUrl,
            renderMs: frameRenderMs,
            meanLuma: histogram.meanLuma,
            alphaMin: histogram.alphaMin,
            histogram,
          });

          const framePixels =
            needsResample || wantsAspectMatte
              ? encodeCtx2D.getImageData(0, 0, activeEncodeW, activeEncodeH).data
              : rgbaBuf;

          let vf: { close: () => void };
          try {
            vf = new g.VideoFrame(framePixels, {
              format: 'RGBA',
              codedWidth: activeEncodeW,
              codedHeight: activeEncodeH,
              timestamp: timestampUs,
              duration: frameDurUs,
            });
          } catch {
            vf = new g.VideoFrame(encodeCanvas2D, {
              timestamp: timestampUs,
              duration: frameDurUs,
            });
          }
          const forceKey = isCpBoundary || frameIdx === startFrame;
          encoder.encode(vf, { keyFrame: forceKey });
          vf.close();
          void wantsCanvasFrame;
        } else {
          const pngBlob = await this.canvasToBlob(encodeCanvas2D, 'image/png');
          const ab = await pngBlob.arrayBuffer();
          await saveEncodedFrameChunkToDb({
            jobId,
            frameIdx,
            timestampUs: Math.round((frameIdx * 1_000_000) / fps),
            isKeyFrame: true,
            isPng: true,
            payload: ab,
            thumbDataUrl,
            renderMs: frameRenderMs,
            meanLuma: histogram.meanLuma,
            alphaMin: histogram.alphaMin,
            histogram,
          });
        }

        if (chunkSavePromises.length >= 6) {
          await Promise.all(chunkSavePromises);
          chunkSavePromises = [];
        }

        const completedInRange = frameIdx - startFrame + 1;
        jobRecord.completedFrames = completedInRange;
        jobRecord.updatedAt = Date.now();
        if (isCpBoundary || frameIdx === endFrame) {
          await saveRenderJobToDb(jobRecord);
        }

        const elapsedSec = (performance.now() - renderT0) / 1000;
        const processedThisRun = frameIdx - resumeFrame + 1;
        const etaSec =
          processedThisRun > 0 ? (elapsedSec / processedThisRun) * (endFrame - frameIdx) : 0;

        options.onProgress({
          jobId,
          frame: frameIdx,
          totalFrames: range.totalFrames,
          completedInRange,
          rangeTotal: totalRangeFrames,
          percent: Math.round((completedInRange / totalRangeFrames) * 1000) / 10,
          elapsedSec,
          etaSec,
          frameRenderMs,
          actualWidth: activeEncodeW,
          actualHeight: activeEncodeH,
          encoderLabel,
          statusText: `非线性断点渲染 · 帧 ${frameIdx + 1}/${endFrame + 1} (${offlineQual.offlineAccumSamples}×SSAA)`,
          previewDataUrl: thumbDataUrl,
          histogram,
          meanLuma: histogram.meanLuma,
          alphaMin: histogram.alphaMin,
          checkpointSaved: isCpBoundary,
        });

        await new Promise((r) => setTimeout(r, 0));
      }

      if (encoder && !encoderClosed) {
        options.onProgress({
          jobId,
          frame: endFrame,
          totalFrames: range.totalFrames,
          completedInRange: totalRangeFrames,
          rangeTotal: totalRangeFrames,
          percent: 99.5,
          elapsedSec: (performance.now() - renderT0) / 1000,
          etaSec: 0,
          actualWidth: activeEncodeW,
          actualHeight: activeEncodeH,
          encoderLabel,
          statusText: '正在刷新编码队列并封装无损容器...',
        });
        await encoder.flush();
        encoder.close();
        encoderClosed = true;
      }
      await Promise.all(chunkSavePromises);

      jobRecord = {
        ...jobRecord,
        status: 'completed',
        updatedAt: Date.now(),
        completedFrames: totalRangeFrames,
      };
      await saveRenderJobToDb(jobRecord);

      const assembled = await assembleDirectorJobBlob(jobRecord, this.planet.seedConfig.seed);
      return {
        status: 'completed',
        job: jobRecord,
        result: {
          ...assembled,
          elapsedMs: performance.now() - renderT0,
        },
      };
    } catch (err) {
      if (jobRecord) {
        jobRecord.status = 'error';
        jobRecord.updatedAt = Date.now();
        jobRecord.errorMessage = err instanceof Error ? err.message : String(err);
        await saveRenderJobToDb(jobRecord);
      }
      throw err;
    } finally {
      if (encoder && !encoderClosed) {
        try {
          encoder.close();
        } catch {
          // ignore
        }
      }
      this.renderer.setOutputRenderTarget(null);
      this.renderer.setRenderTarget(null);
      captureRT.dispose();

      this.camera.clearViewOffset();
      this.camera.position.copy(savedPos);
      this.camera.quaternion.copy(savedQuat);
      this.camera.up.copy(savedUp);
      this.camera.fov = savedFov;
      this.camera.near = savedNear;
      this.camera.far = savedFar;
      this.camera.aspect = savedAspect;
      this.camera.updateProjectionMatrix();

      this.config.renderQuality = savedQuality;
      this.config.sunAzimuthDeg = savedSunAzimuth;
      this.config.sunElevationDeg = savedSunElevation;
      this.config.atmosphere = savedAtmo;
      this.config.thermal = savedThermal;
      this.activeSolarIntensity = 1.0;
      this.solarIntensityNode.value = 1.0;
      if (this.sunLight) {
        this.sunLight.intensity = 3.25;
      }
      this.resetDirectorPostGradingUniforms();

      this.renderer.setPixelRatio(savedPixelRatio);
      this.renderer.setSize(savedCssW, savedCssH, false);
      this.applyShadowQualitySettings();
      this.syncRenderPipeline(false);

      this.updateSunDirection();
      this.simTimeSec = savedSimTime;
      this.simTimeNode.value = savedSimTime;

      if (prevHelpers) this.restoreEditorHelpersVisible(prevHelpers);

      this.isOfflineRendering = false;
      this.lastTime = performance.now();
      this.scheduleNextFrame();
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.phase !== 'playing') return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const code = e.code;
    this.keys.add(code);
    if (code === 'Space' && !e.repeat) {
      if (this.config.cameraMode === 'explorer' || this.config.cameraMode === 'firstPerson') {
        this.jumpQueued = true;
      } else if (this.config.cameraMode === 'landing' && this.landingStage === 'landed') {
        this.landingJumpQueued = true;
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleWindowBlur = (): void => {
    this.keys.clear();
    this.isSculpting = false;
    this.isDraggingOrbit = false;
    this.isPanningCamera = false;
    this.releaseTractorBeam();
  };

  private updatePointerNDC(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerActive = true;
  }

  private getPinchDistance(): number {
    if (this.activeTouches.size < 2) return 0;
    const pts = Array.from(this.activeTouches.values());
    return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  }

  private applyZoomDelta(delta: number): void {
    const scale = this.getPlanetScale();
    const minBlockSpan = Math.max(1e-8 * scale, this.planet.nativeVoxelSize * 6);
    if (this.config.cameraMode === 'explorer') {
      const metrics = this.getPlayerMetrics();
      const factor = Math.exp(delta * 0.1);
      this.camDistance = clamp(
        this.camDistance * factor,
        metrics.minExplorerCamDist,
        metrics.maxExplorerCamDist,
      );
    } else if (this.config.cameraMode === 'firstPerson') {
      // Wheel pitch nudge or stride comfort in first-person
      this.firstPersonPitch = clamp(this.firstPersonPitch - delta * 0.04, -1.42, 1.48);
    } else if (this.config.cameraMode === 'orbit') {
      const cosP = Math.cos(this.orbitPitch);
      const surfR = this.planet.findSurfaceRadiusAlongRay(
        cosP * Math.cos(this.orbitYaw),
        Math.sin(this.orbitPitch),
        cosP * Math.sin(this.orbitYaw),
      );
      const floorR = Math.max(this.planet.baseRadius * 0.85, surfR);
      const minClearance = Math.min(3.5 * scale, minBlockSpan);
      const curClearance = Math.max(minClearance, this.orbitDistance - floorR);
      const nextClearance = clamp(
        curClearance * Math.exp(delta * 0.11),
        minClearance,
        120.0 * scale,
      );
      this.orbitDistance = floorR + nextClearance;
    } else if (this.config.cameraMode === 'detail') {
      // Cursor-ray re-centering on zoom-in so user magnifies whichever voxel region the ray hits
      if (delta < 0 && this.pointerActive) {
        const hit = this.raycastFromPointer();
        if (hit.hit) {
          const blend = clamp(0.42 + Math.abs(delta) * 0.25, 0.35, 0.85);
          this._v1.set(hit.x, hit.y, hit.z);
          this.detailTarget.lerp(this._v1, blend);
          this._v2.set(hit.nx, hit.ny, hit.nz).normalize();
          this.detailNormal.lerp(this._v2, blend).normalize();
        }
      }
      const minDetail = Math.max(this.planet.nativeVoxelSize * 0.45, 1e-8);
      this.detailViewDist = clamp(
        this.detailViewDist * Math.exp(delta * 0.13),
        minDetail,
        this.planet.baseRadius * 6.0,
      );
    } else if (this.config.cameraMode === 'landing') {
      if (this.landingStage === 'selecting') {
        this.landingOrbitDist = clamp(
          this.landingOrbitDist * Math.exp(delta * 0.11),
          this.planet.baseRadius * 1.32,
          120.0 * scale,
        );
      } else if (this.landingStage === 'landed') {
        this.fpsSpeed = clamp(
          this.fpsSpeed * Math.exp(-delta * 0.08),
          Math.max(1e-7 * scale, this.planet.nativeVoxelSize * 6),
          40.0 * scale,
        );
      }
    } else if (this.config.cameraMode === 'perspective') {
      const minPersp = Math.max(this.planet.nativeVoxelSize * 6, 1e-7 * scale);
      this.perspDist = clamp(
        this.perspDist * Math.exp(delta * 0.12),
        minPersp,
        130.0 * scale,
      );
    } else {
      const minFps = Math.min(
        0.1 * scale,
        Math.max(1e-8 * scale, this.planet.nativeVoxelSize * 8),
      );
      this.fpsSpeed = clamp(
        this.fpsSpeed * Math.exp(-delta * 0.1),
        minFps,
        180.0 * scale,
      );
    }
  }

  private confirmLandingSite(hit: ReturnType<VoxelPlanet['raycastTerrain']>): void {
    if (!hit.hit) return;
    const scale = this.getPlanetScale();
    this.landingSite.set(hit.x, hit.y, hit.z);
    this.landingNormal.set(hit.nx, hit.ny, hit.nz).normalize();
    if (this.landingNormal.lengthSq() < 1e-4) {
      this.landingNormal.copy(this.landingSite).normalize();
    }

    const eyeHeight = Math.max(1.65 * scale, this.planet.nativeVoxelSize * 4);
    this.landingDescentStartPos.copy(this.camera.position);
    this.landingDescentEndPos
      .copy(this.landingSite)
      .addScaledVector(this.landingNormal, eyeHeight);

    // Derive horizontal forward vector aligned with orbital view toward landing site
    this._v1.copy(this.landingSite).sub(this.landingDescentStartPos);
    const dotN = this._v1.dot(this.landingNormal);
    this._v1.addScaledVector(this.landingNormal, -dotN);
    if (this._v1.lengthSq() < 1e-4) {
      this._v1.set(0, 0, -1);
      const d = this._v1.dot(this.landingNormal);
      this._v1.addScaledVector(this.landingNormal, -d);
    }
    this.landingFwd.copy(this._v1.normalize());
    this.landingUp.copy(this.landingNormal);
    this.landingDescentEndLook
      .copy(this.landingDescentEndPos)
      .addScaledVector(this.landingFwd, Math.max(8 * scale, this.planet.baseRadius * 0.4));
    this.landingDescentT = 0;
    this.landingStage = 'descending';
    this.isSculpting = false;
    this.isDraggingOrbit = false;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.phase !== 'playing') return;
    this.updatePointerNDC(e.clientX, e.clientY);
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    const bhv = this.getActiveToolAttrs().behavior;
    const isTractorTool = bhv === 'tractorBeam';
    const isSingleShotSurveyTool =
      bhv === 'surveyPin' ||
      bhv === 'surveyTransect' ||
      bhv === 'surveyBorehole' ||
      bhv === 'surveyClinometer';

    if (e.pointerType === 'touch') {
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size >= 2) {
        this.isSculpting = false;
        this.isDraggingOrbit = false;
        this.isPanningCamera = false;
        this.releaseTractorBeam();
        this.prevPinchDist = this.getPinchDistance();
        return;
      }
      if (this.config.cameraMode === 'landing' && this.landingStage === 'selecting') {
        const hit = this.raycastFromPointer();
        if (hit.hit) {
          this.confirmLandingSite(hit);
        } else {
          this.isDraggingOrbit = true;
        }
        return;
      }
      if (this.touchEnabled && this.touchActionMode === 'look') {
        this.isDraggingOrbit = true;
        return;
      }
      if (isTractorTool) {
        if (this.beginTractorBeamDrag()) {
          return;
        }
        this.isDraggingOrbit = true;
        return;
      }
      const hit = this.raycastFromPointer();
      if (hit.hit) {
        this.isSculpting = !isSingleShotSurveyTool;
        this.brushCooldown = 0;
        this.performBrushAction(hit);
      } else {
        this.isDraggingOrbit = true;
      }
      return;
    }

    if (
      this.config.cameraMode === 'perspective' &&
      (e.button === 1 || (e.button === 0 && e.shiftKey))
    ) {
      this.isPanningCamera = true;
      return;
    }

    if (e.button === 2 || e.altKey) {
      this.isDraggingOrbit = true;
      return;
    }

    if (e.button === 0) {
      if (this.config.cameraMode === 'landing' && this.landingStage === 'selecting') {
        const hit = this.raycastFromPointer();
        if (hit.hit) {
          this.confirmLandingSite(hit);
        } else {
          this.isDraggingOrbit = true;
        }
        return;
      }
      if (this.config.cameraMode === 'detail' && e.shiftKey) {
        const hit = this.raycastFromPointer();
        if (hit.hit) {
          this.detailTarget.set(hit.x, hit.y, hit.z);
          this.detailNormal.set(hit.nx, hit.ny, hit.nz).normalize();
          return;
        }
      }
      if (isTractorTool) {
        if (this.beginTractorBeamDrag()) {
          return;
        }
        this.isDraggingOrbit = true;
        return;
      }
      const hit = this.raycastFromPointer();
      if (hit.hit) {
        this.isSculpting = !isSingleShotSurveyTool;
        this.brushCooldown = 0;
        this.performBrushAction(hit);
      } else {
        this.isDraggingOrbit = true;
      }
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.phase !== 'playing') return;
    if (e.pointerType === 'touch') {
      if (this.activeTouches.has(e.pointerId)) {
        this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (this.activeTouches.size >= 2) {
        const dist = this.getPinchDistance();
        if (this.prevPinchDist > 0 && dist > 0) {
          this.applyZoomDelta((this.prevPinchDist - dist) * 0.08);
        }
        this.prevPinchDist = dist;
        return;
      }
    }

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.updatePointerNDC(e.clientX, e.clientY);

    if (this.isPanningCamera && this.config.cameraMode === 'perspective' && this.camera) {
      const panSpeed = this.perspDist * 0.0018;
      this.camera.getWorldDirection(this._v1);
      this._v2.crossVectors(this._v1, this.camera.up).normalize(); // right
      this._v3.crossVectors(this._v2, this._v1).normalize(); // cam up
      this.perspTarget.addScaledVector(this._v2, -dx * panSpeed);
      this.perspTarget.addScaledVector(this._v3, dy * panSpeed);
      return;
    }

    if (this.isDraggingOrbit) {
      if (this.config.cameraMode === 'explorer') {
        const rot = transportCameraForwardOnSphere(
          [this.playerUp.x, this.playerUp.y, this.playerUp.z],
          [this.explorerCamFwd.x, this.explorerCamFwd.y, this.explorerCamFwd.z],
          -dx * 0.0055,
        );
        this.explorerCamFwd.set(rot.forward[0], rot.forward[1], rot.forward[2]);
        this.camPitch = clamp(this.camPitch + dy * 0.005, -0.45, 1.32);
      } else if (this.config.cameraMode === 'firstPerson') {
        const rot = transportCameraForwardOnSphere(
          [this.playerUp.x, this.playerUp.y, this.playerUp.z],
          [this.explorerCamFwd.x, this.explorerCamFwd.y, this.explorerCamFwd.z],
          -dx * 0.0046,
        );
        this.explorerCamFwd.set(rot.forward[0], rot.forward[1], rot.forward[2]);
        this.firstPersonPitch = clamp(this.firstPersonPitch - dy * 0.0046, -1.42, 1.48);
      } else if (this.config.cameraMode === 'orbit') {
        this.orbitYaw -= dx * 0.0055;
        this.orbitPitch = clamp(this.orbitPitch + dy * 0.005, -1.35, 1.35);
      } else if (this.config.cameraMode === 'detail') {
        const rot = transportCameraForwardOnSphere(
          [this.detailNormal.x, this.detailNormal.y, this.detailNormal.z],
          [this.detailBasisFwd.x, this.detailBasisFwd.y, this.detailBasisFwd.z],
          -dx * 0.0052,
        );
        this.detailBasisFwd.set(rot.forward[0], rot.forward[1], rot.forward[2]);
        this.detailPitch = clamp(this.detailPitch + dy * 0.0048, 0.1, 1.46);
      } else if (this.config.cameraMode === 'perspective') {
        this.perspYaw += dx * 0.0055;
        this.perspPitch = clamp(this.perspPitch + dy * 0.005, -1.42, 1.42);
      } else if (this.config.cameraMode === 'landing') {
        if (this.landingStage === 'selecting') {
          this.landingOrbitYaw -= dx * 0.0055;
          this.landingOrbitPitch = clamp(this.landingOrbitPitch + dy * 0.005, -1.35, 1.35);
        } else if (this.landingStage === 'landed') {
          this.landingFwd.applyAxisAngle(this.landingUp, -dx * 0.0042).normalize();
          this.landingPitch = clamp(this.landingPitch - dy * 0.0042, -1.36, 1.36);
        }
      } else if (this.config.cameraMode === 'fps') {
        this.fpsYaw -= dx * 0.0045;
        this.fpsPitch = clamp(this.fpsPitch - dy * 0.0045, -1.48, 1.48);
      }
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.activeTouches.delete(e.pointerId);
      if (this.activeTouches.size < 2) {
        this.prevPinchDist = 0;
      }
    }
    this.isSculpting = false;
    this.isDraggingOrbit = false;
    this.isPanningCamera = false;
    this.releaseTractorBeam();
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this.phase !== 'playing') return;
    e.preventDefault();
    if (this.isTractorDragging) {
      const scale = this.getPlanetScale();
      const minDepth = Math.max(this.planet.nativeVoxelSize * 8, 1.5 * scale);
      const maxDepth = Math.max(this.planet.baseRadius * 8.0, 110.0 * scale);
      this.tractorDragDepthDist = clamp(
        this.tractorDragDepthDist * Math.exp(e.deltaY * 0.0014),
        minDepth,
        maxDepth,
      );
      return;
    }
    this.applyZoomDelta(e.deltaY * 0.012);
  };

  private beginTractorBeamDrag(): boolean {
    if (!this.camera || !this.hasWorld) return false;
    const scale = this.getPlanetScale();
    const attrs = this.getActiveToolAttrs();
    const effRad = Math.max(this.planet.nativeVoxelSize * 0.75, this.config.brushRadius * attrs.radiusMult);
    const captureRadius = Math.max(effRad * 1.45, 2.2 * scale);

    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const ox = this.raycaster.ray.origin.x;
    const oy = this.raycaster.ray.origin.y;
    const oz = this.raycaster.ray.origin.z;
    const dir = this._v1.copy(this.raycaster.ray.direction);
    if (dir.lengthSq() < 1e-8) return false;
    dir.normalize();
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;

    let bestScore = Infinity;
    let pickX = 0;
    let pickY = 0;
    let pickZ = 0;
    let pickT = 0;
    let foundNonTerrain = false;

    const fHit = this.fluid.findClosestParticleToRay(ox, oy, oz, dx, dy, dz, captureRadius);
    if (fHit) {
      const score = fHit.distSq + fHit.rayT * 0.015;
      if (score < bestScore) {
        bestScore = score;
        pickX = fHit.x;
        pickY = fHit.y;
        pickZ = fHit.z;
        pickT = fHit.rayT;
        foundNonTerrain = true;
      }
    }

    const maxPickSq = captureRadius * captureRadius;
    for (let i = 0; i < this.MAX_DEBRIS; i++) {
      if (this.debrisLife[i] <= 0) continue;
      const i3 = i * 3;
      computeRayPointDistanceSq(
        ox, oy, oz, dx, dy, dz,
        this.debrisPos[i3], this.debrisPos[i3 + 1], this.debrisPos[i3 + 2],
        this._tractorRayPick,
      );
      if (this._tractorRayPick.distSq <= maxPickSq) {
        const score = this._tractorRayPick.distSq + this._tractorRayPick.t * 0.015;
        if (score < bestScore) {
          bestScore = score;
          pickX = this.debrisPos[i3];
          pickY = this.debrisPos[i3 + 1];
          pickZ = this.debrisPos[i3 + 2];
          pickT = this._tractorRayPick.t;
          foundNonTerrain = true;
        }
      }
    }

    for (let i = 0; i < this.MAX_MAGMA; i++) {
      if (this.magmaLife[i] <= 0) continue;
      const i3 = i * 3;
      computeRayPointDistanceSq(
        ox, oy, oz, dx, dy, dz,
        this.magmaPos[i3], this.magmaPos[i3 + 1], this.magmaPos[i3 + 2],
        this._tractorRayPick,
      );
      if (this._tractorRayPick.distSq <= maxPickSq) {
        const score = this._tractorRayPick.distSq + this._tractorRayPick.t * 0.015;
        if (score < bestScore) {
          bestScore = score;
          pickX = this.magmaPos[i3];
          pickY = this.magmaPos[i3 + 1];
          pickZ = this.magmaPos[i3 + 2];
          pickT = this._tractorRayPick.t;
          foundNonTerrain = true;
        }
      }
    }

    const meteorPickSq = Math.max(maxPickSq, (captureRadius * 1.45) ** 2);
    for (let i = 0; i < this.activeMeteors.length; i++) {
      const m = this.activeMeteors[i];
      computeRayPointDistanceSq(ox, oy, oz, dx, dy, dz, m.x, m.y, m.z, this._tractorRayPick);
      if (this._tractorRayPick.distSq <= meteorPickSq) {
        const score = this._tractorRayPick.distSq + this._tractorRayPick.t * 0.015;
        if (score < bestScore) {
          bestScore = score;
          pickX = m.x;
          pickY = m.y;
          pickZ = m.z;
          pickT = this._tractorRayPick.t;
          foundNonTerrain = true;
        }
      }
    }

    for (let i = 0; i < this.activeWorms.length; i++) {
      const head = this.activeWorms[i].segments[0];
      if (!head) continue;
      computeRayPointDistanceSq(ox, oy, oz, dx, dy, dz, head[0], head[1], head[2], this._tractorRayPick);
      if (this._tractorRayPick.distSq <= maxPickSq) {
        const score = this._tractorRayPick.distSq + this._tractorRayPick.t * 0.015;
        if (score < bestScore) {
          bestScore = score;
          pickX = head[0];
          pickY = head[1];
          pickZ = head[2];
          pickT = this._tractorRayPick.t;
          foundNonTerrain = true;
        }
      }
    }

    if (
      this.config.cameraMode !== 'explorer' &&
      this.config.cameraMode !== 'firstPerson' &&
      this.playerGroup?.visible
    ) {
      computeRayPointDistanceSq(
        ox, oy, oz, dx, dy, dz,
        this.playerPos.x, this.playerPos.y, this.playerPos.z,
        this._tractorRayPick,
      );
      if (this._tractorRayPick.distSq <= maxPickSq) {
        const score = this._tractorRayPick.distSq + this._tractorRayPick.t * 0.015;
        if (score < bestScore) {
          bestScore = score;
          pickX = this.playerPos.x;
          pickY = this.playerPos.y;
          pickZ = this.playerPos.z;
          pickT = this._tractorRayPick.t;
          foundNonTerrain = true;
        }
      }
    }

    const terrainHit = this.raycastFromPointer();
    if (!foundNonTerrain) {
      if (!terrainHit.hit) return false;
      pickX = terrainHit.x;
      pickY = terrainHit.y;
      pickZ = terrainHit.z;
      pickT = Math.hypot(pickX - ox, pickY - oy, pickZ - oz);
    }

    this.releaseTractorBeam();

    const pLen = Math.hypot(pickX, pickY, pickZ);
    const axX = pLen > 1e-5 ? pickX / pLen : 0;
    const axY = pLen > 1e-5 ? pickY / pLen : 1;
    const axZ = pLen > 1e-5 ? pickZ / pLen : 0;

    const fluidCount = this.fluid.captureParticlesForTractor(
      pickX,
      pickY,
      pickZ,
      captureRadius,
      axX,
      axY,
      axZ,
      340,
    );

    this.debrisGrabbed.fill(0);
    this.magmaGrabbed.fill(0);
    let entityCount = 0;

    for (let i = 0; i < this.MAX_DEBRIS; i++) {
      if (this.debrisLife[i] <= 0) continue;
      const i3 = i * 3;
      const ddx = this.debrisPos[i3] - pickX;
      const ddy = this.debrisPos[i3 + 1] - pickY;
      const ddz = this.debrisPos[i3 + 2] - pickZ;
      const dist = Math.hypot(ddx, ddy, ddz);
      if (dist <= captureRadius) {
        this.debrisGrabbed[i] = 0.65 + 0.35 * (1 - dist / captureRadius);
        this.debrisStretchU[i] = clamp(0.5 + ((ddx * axX + ddy * axY + ddz * axZ) / captureRadius) * 0.45, 0.05, 1.0);
        this.debrisLife[i] = Math.max(this.debrisLife[i], 14.0);
        entityCount++;
      }
    }

    for (let i = 0; i < this.MAX_MAGMA; i++) {
      if (this.magmaLife[i] <= 0) continue;
      const i3 = i * 3;
      const ddx = this.magmaPos[i3] - pickX;
      const ddy = this.magmaPos[i3 + 1] - pickY;
      const ddz = this.magmaPos[i3 + 2] - pickZ;
      const dist = Math.hypot(ddx, ddy, ddz);
      if (dist <= captureRadius) {
        this.magmaGrabbed[i] = 0.65 + 0.35 * (1 - dist / captureRadius);
        this.magmaStretchU[i] = clamp(0.5 + ((ddx * axX + ddy * axY + ddz * axZ) / captureRadius) * 0.45, 0.05, 1.0);
        entityCount++;
      }
    }

    for (const m of this.activeMeteors) {
      const dist = Math.hypot(m.x - pickX, m.y - pickY, m.z - pickZ);
      if (dist <= captureRadius * 1.45) {
        m.grabbedWeight = 1.0;
        m.stretchU = 0.88;
        entityCount++;
      }
    }

    for (const w of this.activeWorms) {
      const head = w.segments[0];
      if (!head) continue;
      const dist = Math.hypot(head[0] - pickX, head[1] - pickY, head[2] - pickZ);
      if (dist <= captureRadius) {
        w.grabbedWeight = 1.0;
        w.stretchU = 0.92;
        entityCount++;
      }
    }

    if (
      this.config.cameraMode !== 'explorer' &&
      this.config.cameraMode !== 'firstPerson' &&
      this.playerGroup?.visible
    ) {
      const pDist = Math.hypot(
        this.playerPos.x - pickX,
        this.playerPos.y - pickY,
        this.playerPos.z - pickZ,
      );
      if (pDist <= captureRadius * 1.15) {
        this.tractorGrabbedPlayer = true;
        this.playerGrounded = false;
        entityCount++;
      }
    }

    // Dry terrain click-and-drag automatically detaches loose rock boulders into the beam
    if (fluidCount === 0 && entityCount === 0 && terrainHit.hit) {
      const pocketRad = Math.max(effRad * 0.42, this.planet.nativeVoxelSize * 1.4);
      this.planet.applyBrush(
        terrainHit.x,
        terrainHit.y,
        terrainHit.z,
        'carve',
        pocketRad,
        Math.max(this.config.brushStrength * 0.78, 0.7),
        MaterialId.Air,
      );
      const chunkCount = clamp(Math.round(attrs.debrisCount) || 6, 5, 10);
      this.spawnDebrisBurst(
        terrainHit.x + terrainHit.nx * 0.25 * scale,
        terrainHit.y + terrainHit.ny * 0.25 * scale,
        terrainHit.z + terrainHit.nz * 0.25 * scale,
        terrainHit.nx,
        terrainHit.ny,
        terrainHit.nz,
        chunkCount,
        16.0,
        1.0,
      );
      this.updateChunksWithLod(64);
      this.updateHighResStreaming(terrainHit, 64);
      entityCount += chunkCount;
    }

    if (fluidCount === 0 && entityCount === 0) {
      return false;
    }

    this.isTractorDragging = true;
    this.isDraggingOrbit = false;
    this.isSculpting = false;
    this.tractorCapturedEntityCount = entityCount;
    this.tractorDragDepthDist = Math.max(
      pickT,
      Math.max(this.planet.nativeVoxelSize * 8, 1.5 * scale),
    );
    this.tractorAnchor.set(pickX, pickY, pickZ);
    this.tractorTarget.set(pickX, pickY, pickZ);
    this.tractorPrevTarget.set(pickX, pickY, pickZ);
    this.tractorDragVel.set(0, 0, 0);
    this.tractorBeamColorNode.value.set(attrs.colorHex);
    this.sound.playProbe();
    return true;
  }

  private updateTractorBeamSolver(dt: number): ActiveFluidTractorField | null {
    if (!this.isTractorDragging || !this.camera) return null;
    const scale = this.getPlanetScale();
    const attrs = this.getActiveToolAttrs();
    const effRad = Math.max(this.planet.nativeVoxelSize * 0.75, this.config.brushRadius * attrs.radiusMult);
    const captureRadius = Math.max(effRad * 1.45, 2.2 * scale);

    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const rayOrig = this.raycaster.ray.origin;
    const rayDir = this.raycaster.ray.direction;
    this.camera.getWorldDirection(this._v1);
    const planeX = rayOrig.x + this._v1.x * this.tractorDragDepthDist;
    const planeY = rayOrig.y + this._v1.y * this.tractorDragDepthDist;
    const planeZ = rayOrig.z + this._v1.z * this.tractorDragDepthDist;

    const minRayDist = Math.max(this.planet.nativeVoxelSize * 6, 1.2 * scale);
    const maxRayDist = Math.max(this.planet.baseRadius * 9.0, 120.0 * scale);
    const ok = intersectCursorWithDragPlane(
      rayOrig.x,
      rayOrig.y,
      rayOrig.z,
      rayDir.x,
      rayDir.y,
      rayDir.z,
      planeX,
      planeY,
      planeZ,
      this._v1.x,
      this._v1.y,
      this._v1.z,
      minRayDist,
      maxRayDist,
      this.planet.baseRadius,
      this._tractorPlaneHit,
    );
    if (ok) {
      this.tractorPrevTarget.copy(this.tractorTarget);
      this.tractorTarget.set(
        this._tractorPlaneHit.x,
        this._tractorPlaneHit.y,
        this._tractorPlaneHit.z,
      );
      const invDt = dt > 1e-4 ? 1 / dt : 60;
      this.tractorDragVel
        .copy(this.tractorTarget)
        .sub(this.tractorPrevTarget)
        .multiplyScalar(clamp(invDt, 1, 90));
    } else {
      this.tractorDragVel.multiplyScalar(0.8);
    }

    const anchorFollow = 1 - Math.exp(-1.9 * dt);
    this.tractorAnchor.lerp(this.tractorTarget, anchorFollow);

    this.fluid.entrainParticlesNearTractor(
      this.tractorTarget.x,
      this.tractorTarget.y,
      this.tractorTarget.z,
      this.tractorAnchor.x,
      this.tractorAnchor.y,
      this.tractorAnchor.z,
      captureRadius * 0.85,
      360,
    );

    const beamPower = Math.max(0.25, this.config.brushStrength * attrs.strengthMult);
    this._tractorField.anchorX = this.tractorAnchor.x;
    this._tractorField.anchorY = this.tractorAnchor.y;
    this._tractorField.anchorZ = this.tractorAnchor.z;
    this._tractorField.targetX = this.tractorTarget.x;
    this._tractorField.targetY = this.tractorTarget.y;
    this._tractorField.targetZ = this.tractorTarget.z;
    this._tractorField.dragVelX = this.tractorDragVel.x;
    this._tractorField.dragVelY = this.tractorDragVel.y;
    this._tractorField.dragVelZ = this.tractorDragVel.z;
    this._tractorField.radius = captureRadius;
    this._tractorField.beamPower = beamPower;
    this._tractorField.stretchStrength = 0.72;

    return this.fluid.tractorCapturedCount > 0 ? this._tractorField : null;
  }

  private releaseTractorBeam(): void {
    this.isTractorDragging = false;
    this.tractorGrabbedPlayer = false;
    this.tractorCapturedEntityCount = 0;
    this.tractorDragVel.set(0, 0, 0);
    this.debrisGrabbed.fill(0);
    this.magmaGrabbed.fill(0);
    for (const m of this.activeMeteors) {
      m.grabbedWeight = 0;
    }
    for (const w of this.activeWorms) {
      w.grabbedWeight = 0;
    }
    this.fluid.releaseTractorCapture();
    if (this.tractorBeamGroup) this.tractorBeamGroup.visible = false;
    if (this.tractorStretchLine) this.tractorStretchLine.visible = false;
    this.tractorTelemetry = createIdleTractorTelemetry();
    const params = this.getGravityParams();
    const r = this.planet.baseRadius;
    this.tractorTelemetry.localGravityMs2 = computeGravityMagnitude(r, params);
    this.tractorTelemetry.escapeVelocityMs = computeEscapeVelocity(r, params);
  }

  private integrateSuspendedExplorerPhysics(dt: number): {
    grabbedCount: number;
    beamForceN: number;
    gravityWeightN: number;
    loadRatioSum: number;
    peakSpeedMs: number;
  } {
    const scale = this.getPlanetScale();
    const params = this.getGravityParams();
    parallelTransportTangentFrame(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this.playerFwd,
      this._upLike,
      this._fwdLike,
      this._rightLike,
    );
    this.playerUp.set(this._upLike.x, this._upLike.y, this._upLike.z);
    this.playerFwd.set(this._fwdLike.x, this._fwdLike.y, this._fwdLike.z);
    this.playerRight.set(this._rightLike.x, this._rightLike.y, this._rightLike.z);

    computeGravityVector(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      params,
      this._grav,
    );
    let ax = this._grav.x;
    let ay = this._grav.y;
    let az = this._grav.z;

    let grabbedCount = 0;
    let beamForceN = 0;
    let gravityWeightN = 0;
    let loadRatioSum = 0;
    let peakSpeedMs = 0;

    if (this.isTractorDragging && this.tractorGrabbedPlayer) {
      const attrs = this.getActiveToolAttrs();
      this._tractorForceParams.planetRadius = this.planet.baseRadius;
      this._tractorForceParams.beamPower = Math.max(0.25, this.config.brushStrength * attrs.strengthMult);
      this._tractorForceParams.gravityCompFactor = 0.45;
      this._tractorForceParams.maxAccelG = 5.6;
      this._tractorForceParams.massKg = 2.0;

      evaluateStretchedAnchorPoint(
        this.tractorAnchor.x,
        this.tractorAnchor.y,
        this.tractorAnchor.z,
        this.tractorTarget.x,
        this.tractorTarget.y,
        this.tractorTarget.z,
        0.85,
        0.72,
        this._tractorTargetPt,
      );
      computeTractorSpringForce(
        this.playerPos.x,
        this.playerPos.y,
        this.playerPos.z,
        this.playerVel.x,
        this.playerVel.y,
        this.playerVel.z,
        this._tractorTargetPt.x,
        this._tractorTargetPt.y,
        this._tractorTargetPt.z,
        this.tractorDragVel.x,
        this.tractorDragVel.y,
        this.tractorDragVel.z,
        params,
        this._tractorForceParams,
        1.0,
        this._tractorForceRes,
      );
      const invM = 1 / this._tractorForceParams.massKg;
      ax += this._tractorForceRes.fx * invM;
      ay += this._tractorForceRes.fy * invM;
      az += this._tractorForceRes.fz * invM;

      grabbedCount = 1;
      beamForceN = this._tractorForceRes.beamForceN;
      gravityWeightN = this._tractorForceRes.gravityWeightN;
      loadRatioSum = this._tractorForceRes.loadRatio;
    }

    this.playerVel.x += ax * dt;
    this.playerVel.y += ay * dt;
    this.playerVel.z += az * dt;

    const maxVel = 36 * scale;
    const spd = this.playerVel.length();
    if (spd > maxVel) {
      this.playerVel.multiplyScalar(maxVel / spd);
    }
    if (grabbedCount > 0) {
      peakSpeedMs = Math.min(spd, maxVel);
    }

    this.playerPos.addScaledVector(this.playerVel, dt);
    const maxAtmo = this.planet.baseRadius + 40.0 * scale;
    if (this.playerPos.length() > maxAtmo) {
      this.playerPos.setLength(maxAtmo);
    }

    this.playerGrounded = false;
    const footRadius = 0.36 * scale;
    const dFoot = this.planet.sampleDensityAndNormal(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this._normalArr,
    );
    if (dFoot > -footRadius) {
      const pen = dFoot + footRadius;
      const nx = this._normalArr[0];
      const ny = this._normalArr[1];
      const nz = this._normalArr[2];
      this.playerPos.x += nx * pen;
      this.playerPos.y += ny * pen;
      this.playerPos.z += nz * pen;

      this._v1.set(nx, ny, nz);
      const vn = this.playerVel.dot(this._v1);
      if (vn < 0) {
        this.playerVel.addScaledVector(this._v1, -vn * (this.tractorGrabbedPlayer ? 1.15 : 1.0));
        this.playerVel.multiplyScalar(0.86);
      }
      if (this._v1.dot(this.playerUp) > 0.35 && !this.tractorGrabbedPlayer) {
        this.playerGrounded = true;
      }
    }

    this.syncPlayerTransform();
    return { grabbedCount, beamForceN, gravityWeightN, loadRatioSum, peakSpeedMs };
  }

  private updateTractorBeamVisuals(): void {
    if (!this.tractorBeamGroup || !this.tractorStretchLine || !this.camera) return;
    if (this.phase !== 'playing' || !this.isTractorDragging) {
      this.tractorBeamGroup.visible = false;
      this.tractorStretchLine.visible = false;
      return;
    }

    const scale = this.getPlanetScale();
    const attrs = this.getActiveToolAttrs();
    const effRad = Math.max(this.planet.nativeVoxelSize * 0.75, this.config.brushRadius * attrs.radiusMult);
    const coneRadius = clamp(effRad * 0.65, 0.35 * scale, 5.5 * scale);

    // Offset beam origin slightly below-right of lens so perspective shows an oblique energy funnel
    this.camera.getWorldDirection(this._v3);
    this._v4.crossVectors(this._v3, this.camera.up).normalize();
    const beamOrigin = this._v1
      .copy(this.camera.position)
      .addScaledVector(this._v3, 0.8 * scale)
      .addScaledVector(this.camera.up, -0.55 * scale)
      .addScaledVector(this._v4, 0.65 * scale);

    this._v2.copy(this.tractorTarget).sub(beamOrigin);
    const beamLen = Math.max(this._v2.length(), 0.25 * scale);
    const beamDir = this._v2.divideScalar(beamLen);
    const beamMid = this._v3.copy(beamOrigin).addScaledVector(beamDir, beamLen * 0.5);

    this._q1.setFromUnitVectors(this._v4.set(0, 1, 0), beamDir);
    this.tractorBeamGroup.visible = true;
    this.tractorBeamGroup.position.copy(beamMid);
    this.tractorBeamGroup.quaternion.copy(this._q1);

    const pulse = 1 + 0.08 * Math.sin(this.simTimeSec * 12.0);
    this.tractorConeMesh.scale.set(coneRadius * pulse, beamLen, coneRadius * pulse);

    // Three capture rings sweep smoothly from beam waist into dragged target head
    for (let r = 0; r < this.tractorRings.length; r++) {
      const ring = this.tractorRings[r];
      const u = (this.simTimeSec * 1.15 + r / this.tractorRings.length) % 1;
      const yLocal = (u - 0.5) * beamLen;
      const ringR = coneRadius * (0.28 + 0.72 * u) * (1 + 0.06 * Math.sin(this.simTimeSec * 9 + r));
      ring.position.set(0, yLocal, 0);
      ring.scale.set(ringR, 1, ringR);
    }

    this.tractorCursorOrb.position.set(0, beamLen * 0.5, 0);
    const orbScale = clamp(coneRadius * 0.42 * (1 + 0.12 * Math.sin(this.simTimeSec * 16)), 0.14 * scale, 1.8 * scale);
    this.tractorCursorOrb.scale.setScalar(orbScale);

    // Highlight color toward amber under high Newtonian gravitational load
    if (this.tractorTelemetry.loadRatio > 0.85) {
      this.tractorBeamColorNode.value.set(0xf59e0b);
    } else {
      this.tractorBeamColorNode.value.set(attrs.colorHex);
    }

    // Stretch filament line connecting lagging anchor to target cursor head
    this.tractorStretchPosArr[0] = this.tractorAnchor.x;
    this.tractorStretchPosArr[1] = this.tractorAnchor.y;
    this.tractorStretchPosArr[2] = this.tractorAnchor.z;
    this.tractorStretchPosArr[3] = this.tractorTarget.x;
    this.tractorStretchPosArr[4] = this.tractorTarget.y;
    this.tractorStretchPosArr[5] = this.tractorTarget.z;
    (this.tractorStretchLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.tractorStretchLine.visible =
      this.tractorAnchor.distanceToSquared(this.tractorTarget) > 1e-4;
  }

  private raycastFromPointer() {
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const orig = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    return this.planet.raycastTerrain(
      orig.x,
      orig.y,
      orig.z,
      dir.x,
      dir.y,
      dir.z,
      this.planet.worldHalf * 5.0,
    );
  }

  private performBrushAction(hit: ReturnType<VoxelPlanet['raycastTerrain']>): void {
    if (!hit.hit) return;
    const { brushRadius, brushStrength, material } = this.config;
    const attrs = this.getActiveToolAttrs();
    const scale = this.getPlanetScale();

    const effRad = Math.max(this.planet.nativeVoxelSize * 0.75, brushRadius * attrs.radiusMult);
    const effStr = Math.max(0.05, brushStrength * attrs.strengthMult);
    const depMat: MaterialId =
      attrs.depositMaterial === 'active' ? material : attrs.depositMaterial;
    const rimMat: MaterialId | undefined =
      attrs.rimMaterial === 'none'
        ? undefined
        : attrs.rimMaterial === 'active'
          ? material
          : attrs.rimMaterial;

    const getRayDir = () => {
      this.raycaster.setFromCamera(this.pointerNDC, this.camera);
      const d = this._v1.copy(this.raycaster.ray.direction);
      if (d.lengthSq() < 1e-6) d.set(-hit.nx, -hit.ny, -hit.nz);
      return d.normalize();
    };

    const bhv = attrs.behavior;

    if (
      bhv === 'surveyPin' ||
      bhv === 'surveyTransect' ||
      bhv === 'surveyBorehole' ||
      bhv === 'surveyClinometer'
    ) {
      const worldPos: [number, number, number] = [hit.x, hit.y, hit.z];
      const attitude = this.sampleAttitudeAt(hit.x, hit.y, hit.z);
      const hasWater = this.fluid.sampleWaterAt(hit.x, hit.y, hit.z) > 0.02;
      this.lastProbe = this.planet.probeVoxelCell(hit.x, hit.y, hit.z);
      this.lastHoveredWorldPos = worldPos;
      this.lastHoveredAttitude = attitude;
      this.onSurveyAction?.({
        kind: bhv,
        worldPos,
        normal: [hit.nx, hit.ny, hit.nz],
        attitude,
        hasWater,
      });
      this.sound.playProbe();
      return;
    }

    if (bhv === 'probe' || bhv === 'seismicProbe') {
      const sampleStep = Math.max(this.planet.nativeVoxelSize * 0.6, this.planet.voxelSize * 0.2);
      const picked = this.planet.sampleNearestMaterial(
        hit.x - hit.nx * sampleStep,
        hit.y - hit.ny * sampleStep,
        hit.z - hit.nz * sampleStep,
      );
      this.lastProbe = this.planet.probeVoxelCell(hit.x, hit.y, hit.z);
      if (picked !== MaterialId.Air && picked !== this.config.material) {
        this.config = { ...this.config, material: picked };
        this.onMaterialPicked?.(picked);
      }
      if (bhv === 'seismicProbe') {
        this.spawnShockwave(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, effRad * 2.5, false, false);
      }
      this.sound.playProbe();
      return;
    }

    if (bhv === 'water' || bhv === 'geyser') {
      const streamCount = clamp(Math.round(attrs.entityCount), 4, 48);
      if (bhv === 'geyser') {
        this.fluid.emitStream(
          hit.x,
          hit.y,
          hit.z,
          hit.nx,
          hit.ny,
          hit.nz,
          streamCount,
          effRad * 0.45,
          scale,
        );
        this.fluid.applyRadialImpulse(
          hit.x,
          hit.y,
          hit.z,
          effRad * 1.4,
          3.5 * Math.sqrt(scale) * attrs.entitySpeed,
          12 * Math.sqrt(scale) * attrs.entitySpeed,
        );
        this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 1.8, attrs.thermalDeltaC, 40);
      } else {
        this.fluid.emitStream(
          hit.x,
          hit.y,
          hit.z,
          hit.nx,
          hit.ny,
          hit.nz,
          streamCount,
          effRad * 0.65,
          scale,
        );
      }
      this.waterMeshDirty = true;
      this.sound.playWater();
      return;
    }

    if (bhv === 'drain') {
      this.fluid.drainWithinRadius(
        hit.x,
        hit.y,
        hit.z,
        Math.max(effRad, 0.9 * scale),
      );
      this.waterMeshDirty = true;
      this.sound.playWater();
      return;
    }

    if (bhv === 'pierce' || bhv === 'continuousLaser' || bhv === 'megaLaser') {
      const rayDir = getRayDir();
      const depthMult = Math.max(attrs.pierceDepthRatio, 0.5);
      const pierceLen = Math.max(this.planet.baseRadius * depthMult, effRad * 4.0);
      const backPad = Math.max(effRad * 0.6, this.planet.voxelSize * 0.5);
      const sx = hit.x - rayDir.x * backPad;
      const sy = hit.y - rayDir.y * backPad;
      const sz = hit.z - rayDir.z * backPad;
      const ex = hit.x + rayDir.x * pierceLen;
      const ey = hit.y + rayDir.y * pierceLen;
      const ez = hit.z + rayDir.z * pierceLen;

      const isBeam = attrs.continuousBeam || bhv !== 'pierce';
      this.planet.applyBrush(
        sx,
        sy,
        sz,
        isBeam ? 'laser' : 'tunnel',
        effRad,
        effStr,
        depMat,
        { shape: 'cylinder', ex, ey, ez, rimMaterial: rimMat },
      );
      if (attrs.leaveRim && bhv === 'megaLaser') {
        this.spawnShockwave(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, effRad * 2.2, true, false);
      }
      this.updateChunksWithLod(64);
      this.updateHighResStreaming(hit, 64);
      this.waterMeshDirty = true;

      const beamOriginDist = Math.max(this.planet.baseRadius * 0.85, 4.0 * scale);
      if (isBeam) {
        this.laserBeamStart.set(
          hit.x - rayDir.x * beamOriginDist,
          hit.y - rayDir.y * beamOriginDist,
          hit.z - rayDir.z * beamOriginDist,
        );
      } else {
        this.laserBeamStart.set(sx, sy, sz);
      }
      this.laserBeamEnd.set(ex, ey, ez);
      this.laserImpactPos.set(hit.x, hit.y, hit.z);
      this.laserBeamScaleRad = bhv === 'megaLaser' ? 0.62 * attrs.radiusMult : 0.42 * attrs.radiusMult;
      this.laserBeamActiveUntil = this.simTimeSec + (bhv === 'continuousLaser' ? 0.09 : 0.18);

      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 2.2, attrs.thermalDeltaC, 80);
      this.spawnDebrisBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, attrs.debrisCount);
      if (isBeam) this.sound.playLaser();
      else this.sound.playCarve();
      return;
    }

    if (bhv === 'explosion' || bhv === 'nuke') {
      const isNuke = bhv === 'nuke';
      this.planet.applyBrush(hit.x, hit.y, hit.z, 'crater', effRad, effStr, depMat, {
        rimHeight: attrs.leaveRim ? (isNuke ? 1.1 : 0.72) : 0,
        rimMaterial: rimMat ?? MaterialId.Basalt,
        floorMaterial: depMat,
      });
      this.fluid.applyRadialImpulse(
        hit.x,
        hit.y,
        hit.z,
        effRad * 2.6,
        (isNuke ? 28 : 16) * Math.sqrt(scale),
        (isNuke ? 14 : 6) * Math.sqrt(scale),
      );
      if (isNuke) {
        this.fluid.drainWithinRadius(hit.x, hit.y, hit.z, effRad * 0.85);
        this.spawnMagmaBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 14, effRad * 0.3, 1.3, false);
      }
      this.spawnShockwave(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, effRad * (isNuke ? 2.8 : 2.1), true, isNuke);
      this.spawnDebrisBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, attrs.debrisCount);
      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 2.6, attrs.thermalDeltaC, 55);
      this.metabolism.syncLocalTerrainPorosity(hit.x, hit.y, hit.z, effRad, this.planet);
      this.updateChunksWithLod(56);
      this.updateHighResStreaming(hit, 64);
      this.waterMeshDirty = true;
      this.sound.playExplosion(isNuke);
      return;
    }

    if (bhv === 'burn' || bhv === 'magma') {
      const isMagma = bhv === 'magma';
      this.planet.applyBrush(hit.x, hit.y, hit.z, 'crater', effRad, effStr * (isMagma ? 0.95 : 0.65), depMat, {
        rimHeight: attrs.leaveRim ? 0.38 : 0,
        rimMaterial: rimMat ?? MaterialId.Basalt,
        floorMaterial: depMat,
      });
      if (isMagma) {
        this.fluid.drainWithinRadius(hit.x, hit.y, hit.z, effRad * 0.8);
      }
      this.spawnMagmaBurst(
        hit.x,
        hit.y,
        hit.z,
        hit.nx,
        hit.ny,
        hit.nz,
        clamp(Math.round(attrs.entityCount), 1, 16),
        effRad * 0.35,
        attrs.entitySpeed,
        !isMagma,
      );
      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 2.0, attrs.thermalDeltaC, 50);
      this.metabolism.syncLocalTerrainPorosity(hit.x, hit.y, hit.z, effRad, this.planet);
      this.updateChunksWithLod(36);
      this.updateHighResStreaming(hit, 48);
      this.waterMeshDirty = true;
      this.sound.playBurnOrMagma();
      return;
    }

    if (bhv === 'lightning') {
      this.planet.applyBrush(hit.x, hit.y, hit.z, 'crater', effRad, effStr, depMat, {
        rimHeight: attrs.leaveRim ? 0.45 : 0,
        rimMaterial: rimMat ?? MaterialId.Crystal,
        floorMaterial: depMat,
      });
      this.spawnLightningBolt(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, attrs.entityCount);
      this.spawnShockwave(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, effRad * 1.9, false, false);
      this.spawnDebrisBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, attrs.debrisCount);
      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 2.0, attrs.thermalDeltaC, 110);
      this.metabolism.syncLocalTerrainPorosity(hit.x, hit.y, hit.z, effRad, this.planet);
      this.updateChunksWithLod(42);
      this.updateHighResStreaming(hit, 48);
      this.sound.playLightning();
      return;
    }

    if (bhv === 'meteor') {
      const mCount = clamp(Math.round(attrs.entityCount), 1, 6);
      const orbitDist = Math.max(this.planet.baseRadius * 1.3, 14 * scale);
      const speed = 26 * Math.sqrt(scale) * attrs.entitySpeed;
      for (let k = 0; k < mCount; k++) {
        if (this.activeMeteors.length >= this.MAX_METEORS) break;
        const jx = (Math.random() - 0.5) * 3.5 * scale;
        const jy = (Math.random() - 0.5) * 3.5 * scale;
        const jz = (Math.random() - 0.5) * 3.5 * scale;
        const tx = hit.x + (k === 0 ? 0 : (Math.random() - 0.5) * effRad * 1.6);
        const ty = hit.y + (k === 0 ? 0 : (Math.random() - 0.5) * effRad * 1.6);
        const tz = hit.z + (k === 0 ? 0 : (Math.random() - 0.5) * effRad * 1.6);
        const sx = hit.x + hit.nx * orbitDist + jx;
        const sy = hit.y + hit.ny * orbitDist + jy;
        const sz = hit.z + hit.nz * orbitDist + jz;
        const dx = tx - sx;
        const dy = ty - sy;
        const dz = tz - sz;
        const dLen = Math.hypot(dx, dy, dz) || 1;
        this.activeMeteors.push({
          x: sx,
          y: sy,
          z: sz,
          vx: (dx / dLen) * speed,
          vy: (dy / dLen) * speed,
          vz: (dz / dLen) * speed,
          radius: effRad,
          strength: effStr,
          thermalDeltaC: attrs.thermalDeltaC,
          debrisCount: attrs.debrisCount,
          material: depMat,
          rimMaterial: rimMat ?? MaterialId.Sandstone,
          leaveRim: attrs.leaveRim,
          life: 3.0,
        });
      }
      this.sound.playVortex();
      return;
    }

    if (bhv === 'worm') {
      const segs = clamp(Math.round(attrs.entityCount), 4, 16);
      const segments: Array<[number, number, number]> = [];
      for (let s = 0; s < segs; s++) {
        segments.push([
          hit.x + hit.nx * s * 0.25 * scale,
          hit.y + hit.ny * s * 0.25 * scale,
          hit.z + hit.nz * s * 0.25 * scale,
        ]);
      }
      const rLen = Math.hypot(hit.x, hit.y, hit.z) || 1;
      const inX = -hit.x / rLen + (Math.random() - 0.5) * 0.35;
      const inY = -hit.y / rLen + (Math.random() - 0.5) * 0.35;
      const inZ = -hit.z / rLen + (Math.random() - 0.5) * 0.35;
      const dLen = Math.hypot(inX, inY, inZ) || 1;
      if (this.activeWorms.length >= 12) this.activeWorms.shift();
      this.activeWorms.push({
        segments,
        dir: [inX / dLen, inY / dLen, inZ / dLen],
        speed: attrs.entitySpeed,
        radius: effRad,
        strength: effStr,
        material: depMat,
        life: 9.0,
        phase: Math.random() * Math.PI * 2,
        stepAccum: 0,
      });
      this.sound.playWorm();
      return;
    }

    if (bhv === 'orbitalStrike') {
      const rounds = clamp(Math.round(attrs.entityCount), 1, 6);
      const rayDir = getRayDir();
      const depth = Math.max(effRad * 2.2, this.planet.baseRadius * attrs.pierceDepthRatio);
      for (let k = 0; k < rounds; k++) {
        const jx = (k === 0 ? 0 : (Math.random() - 0.5) * effRad * 2.0);
        const jy = (k === 0 ? 0 : (Math.random() - 0.5) * effRad * 2.0);
        const jz = (k === 0 ? 0 : (Math.random() - 0.5) * effRad * 2.0);
        const sx = hit.x + jx;
        const sy = hit.y + jy;
        const sz = hit.z + jz;
        this.planet.applyBrush(sx, sy, sz, 'bore', effRad * 0.72, effStr, depMat, {
          shape: 'cylinder',
          ex: sx + rayDir.x * depth,
          ey: sy + rayDir.y * depth,
          ez: sz + rayDir.z * depth,
          rimMaterial: rimMat ?? MaterialId.Basalt,
        });
      }
      this.spawnShockwave(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, effRad * 2.4, true, false);
      this.spawnDebrisBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, attrs.debrisCount);
      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 2.2, attrs.thermalDeltaC, 65);
      this.updateChunksWithLod(56);
      this.updateHighResStreaming(hit, 64);
      this.waterMeshDirty = true;
      this.sound.playExplosion(false);
      return;
    }

    if (bhv === 'blackHole' || bhv === 'tornado') {
      if (this.activeVortices.length >= 6) this.activeVortices.shift();
      this.activeVortices.push({
        x: hit.x,
        y: hit.y,
        z: hit.z,
        nx: hit.nx,
        ny: hit.ny,
        nz: hit.nz,
        radius: effRad,
        strength: effStr,
        speed: attrs.entitySpeed,
        kind: bhv,
        material: depMat,
        age: 0,
        maxAge: bhv === 'blackHole' ? 3.4 : 4.6,
        carveTimer: 0,
      });
      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 2.0, attrs.thermalDeltaC, 30);
      this.sound.playVortex();
      return;
    }

    if (bhv === 'volcano') {
      this.planet.applyBrush(hit.x, hit.y, hit.z, 'volcano', effRad, effStr, depMat);
      this.spawnMagmaBurst(
        hit.x + hit.nx * effRad * 0.45,
        hit.y + hit.ny * effRad * 0.45,
        hit.z + hit.nz * effRad * 0.45,
        hit.nx,
        hit.ny,
        hit.nz,
        clamp(Math.round(attrs.entityCount), 2, 12),
        effRad * 0.25,
        attrs.entitySpeed,
        false,
      );
      this.spawnDebrisBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, attrs.debrisCount);
      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 2.2, attrs.thermalDeltaC, 35);
      this.metabolism.syncLocalTerrainPorosity(hit.x, hit.y, hit.z, effRad, this.planet);
      this.updateChunksWithLod(52);
      this.updateHighResStreaming(hit, 56);
      this.waterMeshDirty = true;
      this.sound.playBurnOrMagma();
      return;
    }

    if (bhv === 'crystalGrow') {
      const spires = clamp(Math.round(attrs.entityCount), 1, 8);
      const len = Math.max(effRad * 2.2, this.planet.voxelSize * 1.8);
      for (let k = 0; k < spires; k++) {
        const jx = k === 0 ? 0 : (Math.random() - 0.5) * 0.85;
        const jy = k === 0 ? 0 : (Math.random() - 0.5) * 0.85;
        const jz = k === 0 ? 0 : (Math.random() - 0.5) * 0.85;
        const dLen = Math.hypot(hit.nx + jx, hit.ny + jy, hit.nz + jz) || 1;
        this.planet.applyBrush(hit.x, hit.y, hit.z, 'extrude', effRad * 0.55, effStr, depMat, {
          shape: 'cylinder',
          ex: hit.x + ((hit.nx + jx) / dLen) * len,
          ey: hit.y + ((hit.ny + jy) / dLen) * len,
          ez: hit.z + ((hit.nz + jz) / dLen) * len,
        });
      }
      this.metabolism.syncLocalTerrainPorosity(hit.x, hit.y, hit.z, Math.max(effRad, len), this.planet);
      this.updateChunksWithLod(48);
      this.updateHighResStreaming(hit, 56);
      this.sound.playBuild();
      return;
    }

    if (bhv === 'quake') {
      const rayDir = getRayDir();
      const faultLen = Math.max(effRad * 2.4, this.planet.baseRadius * attrs.pierceDepthRatio);
      // Tangential fault line perpendicular to strike normal
      let tx = rayDir.y * hit.nz - rayDir.z * hit.ny;
      let ty = rayDir.z * hit.nx - rayDir.x * hit.nz;
      let tz = rayDir.x * hit.ny - rayDir.y * hit.nx;
      const tLen = Math.hypot(tx, ty, tz) || 1;
      tx /= tLen; ty /= tLen; tz /= tLen;
      this.planet.applyBrush(
        hit.x - tx * faultLen * 0.5,
        hit.y - ty * faultLen * 0.5,
        hit.z - tz * faultLen * 0.5,
        'quake',
        effRad,
        effStr,
        depMat,
        {
          shape: 'cylinder',
          ex: hit.x + tx * faultLen * 0.5,
          ey: hit.y + ty * faultLen * 0.5,
          ez: hit.z + tz * faultLen * 0.5,
          rimMaterial: rimMat ?? MaterialId.Basalt,
          jaggedNoise: 1.25,
        },
      );
      this.spawnShockwave(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, effRad * 2.0, false, false);
      this.spawnDebrisBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, attrs.debrisCount);
      this.updateChunksWithLod(52);
      this.updateHighResStreaming(hit, 56);
      this.sound.playExplosion(false);
      return;
    }

    if (bhv === 'terraform') {
      this.planet.applyBrush(hit.x, hit.y, hit.z, 'paint', effRad, effStr, depMat);
      this.planet.applyBrush(hit.x, hit.y, hit.z, 'smooth', effRad, effStr * 0.65, depMat);
      this.fluid.emitStream(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, clamp(Math.round(attrs.entityCount), 2, 14), effRad * 0.5, scale);
      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 1.6, attrs.thermalDeltaC, 25);
      this.updateChunksWithLod(40);
      this.updateHighResStreaming(hit, 48);
      this.waterMeshDirty = true;
      this.sound.playBuild();
      return;
    }

    if (bhv === 'freezeBeam') {
      this.planet.applyBrush(hit.x, hit.y, hit.z, 'paint', effRad, effStr, MaterialId.Ice);
      this.addThermalHotspot(hit.x, hit.y, hit.z, effRad * 2.2, attrs.thermalDeltaC, 45);
      const rayDir = getRayDir();
      const beamOriginDist = Math.max(this.planet.baseRadius * 0.75, 4.0 * scale);
      this.laserBeamStart.set(
        hit.x - rayDir.x * beamOriginDist,
        hit.y - rayDir.y * beamOriginDist,
        hit.z - rayDir.z * beamOriginDist,
      );
      this.laserBeamEnd.set(hit.x, hit.y, hit.z);
      this.laserImpactPos.set(hit.x, hit.y, hit.z);
      this.laserBeamScaleRad = 0.36 * attrs.radiusMult;
      this.laserBeamActiveUntil = this.simTimeSec + 0.1;
      this.updateChunksWithLod(36);
      this.updateHighResStreaming(hit, 48);
      this.sound.playFreeze();
      return;
    }

    if (bhv === 'bore') {
      const rayDir = getRayDir();
      const boreDepth = Math.max(effRad * 3.4, this.planet.baseRadius * Math.max(attrs.pierceDepthRatio, 0.45));
      const sx = hit.x - rayDir.x * (effRad * 0.25);
      const sy = hit.y - rayDir.y * (effRad * 0.25);
      const sz = hit.z - rayDir.z * (effRad * 0.25);
      const ex = hit.x + rayDir.x * boreDepth;
      const ey = hit.y + rayDir.y * boreDepth;
      const ez = hit.z + rayDir.z * boreDepth;

      this.planet.applyBrush(sx, sy, sz, 'bore', effRad, effStr, depMat, {
        shape: 'cylinder',
        ex,
        ey,
        ez,
        rimMaterial: rimMat,
      });
      this.updateChunksWithLod(48);
      this.updateHighResStreaming(hit, 56);
      this.waterMeshDirty = true;
      this.spawnDebrisBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, attrs.debrisCount);
      this.sound.playCarve();
      return;
    }

    if (bhv === 'extrude') {
      const len = Math.max(effRad * 2.1, this.planet.voxelSize * 1.6);
      const ex = hit.x + hit.nx * len;
      const ey = hit.y + hit.ny * len;
      const ez = hit.z + hit.nz * len;
      this.planet.applyBrush(
        hit.x,
        hit.y,
        hit.z,
        'extrude',
        effRad,
        effStr * 0.9,
        depMat,
        { shape: 'cylinder', ex, ey, ez },
      );
      this.metabolism.syncLocalTerrainPorosity(hit.x, hit.y, hit.z, Math.max(effRad, len), this.planet);
      this.updateChunksWithLod(44);
      this.updateHighResStreaming(hit, 52);
      this.waterMeshDirty = true;
      this.sound.playBuild();
      return;
    }

    // Standard primitives: carve, build, smooth, flatten, paint
    const primitiveMode =
      bhv === 'build' || bhv === 'smooth' || bhv === 'flatten' || bhv === 'paint'
        ? bhv
        : 'carve';
    const offset = primitiveMode === 'build' ? effRad * 0.25 : 0;
    const bx = hit.x + hit.nx * offset;
    const by = hit.y + hit.ny * offset;
    const bz = hit.z + hit.nz * offset;

    this.planet.applyBrush(
      bx,
      by,
      bz,
      primitiveMode,
      effRad,
      effStr * 0.72,
      depMat,
      { rimMaterial: rimMat },
    );
    this.metabolism.syncLocalTerrainPorosity(bx, by, bz, effRad, this.planet);
    this.updateChunksWithLod(36);
    this.updateHighResStreaming(hit, 48);
    this.waterMeshDirty = true;

    if (primitiveMode === 'carve') {
      this.spawnDebrisBurst(bx, by, bz, hit.nx, hit.ny, hit.nz, attrs.debrisCount);
      this.sound.playCarve();
    } else {
      this.sound.playBuild();
    }
  }

  private updateExplorerPhysics(dt: number): void {
    const params = this.getGravityParams();
    const scale = this.getPlanetScale();
    const metrics = this.getPlayerMetrics();
    const coreGuardR = this.planet.baseRadius * 0.08;

    const guardedUp = resolveSphericalCoreUp(
      [this.playerPos.x, this.playerPos.y, this.playerPos.z],
      [this.playerUp.x, this.playerUp.y, this.playerUp.z],
      coreGuardR,
    );
    this.playerUp.set(guardedUp[0], guardedUp[1], guardedUp[2]);

    const bodyBasis = transportCameraForwardOnSphere(
      guardedUp,
      [this.playerFwd.x, this.playerFwd.y, this.playerFwd.z],
      0,
    );
    this.playerFwd.set(bodyBasis.forward[0], bodyBasis.forward[1], bodyBasis.forward[2]);
    this.playerRight.set(bodyBasis.right[0], bodyBasis.right[1], bodyBasis.right[2]);

    let keyYawDelta = 0;
    if (this.keys.has('KeyQ')) keyYawDelta += 1.9 * dt;
    if (this.keys.has('KeyE')) keyYawDelta -= 1.9 * dt;

    // Decoupled from camera.position: transport persistent explorerCamFwd strictly around playerUp
    const camBasis = transportCameraForwardOnSphere(
      guardedUp,
      [this.explorerCamFwd.x, this.explorerCamFwd.y, this.explorerCamFwd.z],
      keyYawDelta,
    );
    this.explorerCamFwd.set(camBasis.forward[0], camBasis.forward[1], camBasis.forward[2]);
    this._v1.copy(this.explorerCamFwd);
    this._v2.set(camBasis.right[0], camBasis.right[1], camBasis.right[2]);

    let moveF = this.virtualMoveY;
    let moveR = this.virtualMoveX;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveF += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveF -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveR += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveR -= 1;
    moveF = clamp(moveF, -1, 1);
    moveR = clamp(moveR, -1, 1);

    this._v3.set(0, 0, 0);
    const hasMove = Math.abs(moveF) > 0.02 || Math.abs(moveR) > 0.02;
    if (hasMove) {
      this._v3
        .addScaledVector(this._v1, moveF)
        .addScaledVector(this._v2, moveR);
      const len = this._v3.length();
      if (len > 1) this._v3.divideScalar(len);
      this.playerFwd.lerp(this._v3, 1 - Math.exp(-12 * dt)).normalize();
    } else if (this.config.cameraMode === 'firstPerson') {
      this.playerFwd.copy(this._v1);
    }

    computeGravityVector(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      params,
      this._grav,
    );
    this.playerVel.x += this._grav.x * dt;
    this.playerVel.y += this._grav.y * dt;
    this.playerVel.z += this._grav.z * dt;

    if (this.jumpQueued && this.playerGrounded) {
      this.playerVel.addScaledVector(this.playerUp, metrics.jumpSpeed);
      this.playerGrounded = false;
      this.squashY = 1.24;
      this.sound.playJump();
    }
    this.jumpQueued = false;

    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.virtualUp) {
      this.playerVel.addScaledVector(this.playerUp, metrics.jetpackThrust * dt);
      this.playerGrounded = false;
    }

    const radialSpeed = this.playerVel.dot(this.playerUp);
    this._v4.copy(this.playerVel).addScaledVector(this.playerUp, -radialSpeed);
    const maxWalkSpeed = metrics.walkSpeed;
    if (hasMove) {
      this._v4.lerp(
        this._v3.multiplyScalar(maxWalkSpeed),
        1 - Math.exp(-(this.playerGrounded ? 14 : 5) * dt),
      );
      this.walkPhase += (this._v4.length() / Math.max(metrics.charScale, 0.02)) * dt * 2.2;
    } else if (this.playerGrounded) {
      this._v4.multiplyScalar(Math.exp(-12 * dt));
    }

    this.playerVel.copy(this._v4).addScaledVector(this.playerUp, radialSpeed);
    const maxVel = 24 * scale;
    if (this.playerVel.length() > maxVel) {
      this.playerVel.setLength(maxVel);
    }

    this.playerPos.addScaledVector(this.playerVel, dt);
    const maxAtmo = this.planet.baseRadius + 10.0 * scale;
    if (this.playerPos.length() > maxAtmo) {
      this.playerPos.setLength(maxAtmo);
      if (this.playerVel.dot(this.playerUp) > 0) {
        this.playerVel.addScaledVector(this.playerUp, -this.playerVel.dot(this.playerUp));
      }
    }

    const wasGrounded = this.playerGrounded;
    this.playerGrounded = false;
    const footRadius = metrics.footRadius;
    const dFoot = this.planet.sampleDensityAndNormal(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this._normalArr,
    );
    if (dFoot > -footRadius) {
      const pen = dFoot + footRadius;
      const nx = this._normalArr[0];
      const ny = this._normalArr[1];
      const nz = this._normalArr[2];
      this.playerPos.x += nx * pen;
      this.playerPos.y += ny * pen;
      this.playerPos.z += nz * pen;

      this._v1.set(nx, ny, nz);
      const vn = this.playerVel.dot(this._v1);
      if (vn < 0) {
        this.playerVel.addScaledVector(this._v1, -vn);
        if (!wasGrounded && vn < -2.2 * Math.sqrt(Math.max(metrics.charScale, 0.05))) {
          this.squashY = 0.78;
        }
      }
      if (this._v1.dot(this.playerUp) > 0.35) {
        this.playerGrounded = true;
      }
    }

    this.squashY += (1.0 - this.squashY) * (1 - Math.exp(-14 * dt));
    this.syncPlayerTransform();
  }

  private syncPlayerTransform(): void {
    const metrics = this.getPlayerMetrics();
    const charScale = metrics.charScale;
    this.playerGroup.position.copy(this.playerPos);
    this.playerGroup.visible =
      this.hasWorld && this.phase !== 'title' && this.config.cameraMode !== 'firstPerson';

    this._v1.crossVectors(this.playerFwd, this.playerUp).normalize();
    this._v2.crossVectors(this.playerUp, this._v1).normalize();
    this._m4.makeBasis(this._v1, this.playerUp, this._v2.negate());
    this.playerGroup.quaternion.setFromRotationMatrix(this._m4);

    const invSq = 1 / Math.sqrt(Math.max(0.5, this.squashY));
    this.playerGroup.scale.set(
      invSq * charScale,
      this.squashY * charScale,
      invSq * charScale,
    );

    const swing = this.playerGrounded ? Math.sin(this.walkPhase) * 0.45 : 0.2;
    this.playerLeftLeg.rotation.x = swing;
    this.playerRightLeg.rotation.x = -swing;
    this.playerLeftArm.rotation.x = -swing * 0.7;
    this.playerRightArm.rotation.x = swing * 0.7;
  }

  private updateFpsCamera(dt: number): void {
    const scale = this.getPlanetScale();
    const cosP = Math.cos(this.fpsPitch);
    const lookX = -Math.sin(this.fpsYaw) * cosP;
    const lookY = Math.sin(this.fpsPitch);
    const lookZ = -Math.cos(this.fpsYaw) * cosP;

    this._v1.set(lookX, lookY, lookZ).normalize(); // forward
    this._v2.set(Math.cos(this.fpsYaw), 0, -Math.sin(this.fpsYaw)).normalize(); // right

    let mf = this.virtualMoveY;
    let mr = this.virtualMoveX;
    let mu = (this.virtualUp ? 1 : 0) - (this.virtualDown ? 1 : 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mf += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mf -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mr += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mr -= 1;
    if (this.keys.has('Space') || this.keys.has('KeyE')) mu += 1;
    if (this.keys.has('KeyC') || this.keys.has('KeyQ') || this.keys.has('ControlLeft')) mu -= 1;

    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.2 : 1.0;
    const spd = this.fpsSpeed * boost;

    this._v3
      .set(0, 0, 0)
      .addScaledVector(this._v1, mf)
      .addScaledVector(this._v2, mr);
    this._v3.y += mu;
    if (this._v3.lengthSq() > 1e-4) {
      if (this._v3.lengthSq() > 1) this._v3.normalize();
      this._v3.multiplyScalar(spd * dt);
      this.fpsPos.add(this._v3);
      const maxFpsDist = 70 * scale;
      if (this.fpsPos.length() > maxFpsDist) {
        this.fpsPos.setLength(maxFpsDist);
      }
    }

    const damp = 1 - Math.exp(-16 * dt);
    this.camPosSmooth.lerp(this.fpsPos, damp);
    this._v4.copy(this.fpsPos).add(this._v1);
    this.camLookSmooth.lerp(this._v4, damp);

    this.camera.position.copy(this.camPosSmooth);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLookSmooth);
  }

  private updateDetailCamera(dt: number): void {
    const scale = this.getPlanetScale();

    let moveF = this.virtualMoveY;
    let moveR = this.virtualMoveX;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveF += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveF -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveR += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveR -= 1;

    let keyYaw = 0;
    if (this.keys.has('KeyQ')) keyYaw += 1.6 * dt;
    if (this.keys.has('KeyE')) keyYaw -= 1.6 * dt;

    let basis = transportCameraForwardOnSphere(
      [this.detailNormal.x, this.detailNormal.y, this.detailNormal.z],
      [this.detailBasisFwd.x, this.detailBasisFwd.y, this.detailBasisFwd.z],
      keyYaw,
    );
    this.detailBasisFwd.set(basis.forward[0], basis.forward[1], basis.forward[2]);

    if (Math.abs(moveF) > 0.02 || Math.abs(moveR) > 0.02) {
      const panSpeed = Math.max(this.detailViewDist * 0.65, this.planet.nativeVoxelSize * 8);
      const fwdDir = this._v3.set(basis.forward[0], basis.forward[1], basis.forward[2]);
      const rightDir = this._v4.set(basis.right[0], basis.right[1], basis.right[2]);
      this.detailTarget
        .addScaledVector(fwdDir, moveF * panSpeed * dt)
        .addScaledVector(rightDir, moveR * panSpeed * dt);

      const rLen = this.detailTarget.length();
      if (rLen > 1e-4) {
        const rx = this.detailTarget.x / rLen;
        const ry = this.detailTarget.y / rLen;
        const rz = this.detailTarget.z / rLen;
        const surfR = this.planet.findSurfaceRadiusAlongRay(rx, ry, rz);
        this.detailTarget.set(rx * surfR, ry * surfR, rz * surfR);
        this.detailNormal.set(rx, ry, rz);
        basis = transportCameraForwardOnSphere(
          [rx, ry, rz],
          [this.detailBasisFwd.x, this.detailBasisFwd.y, this.detailBasisFwd.z],
          0,
        );
        this.detailBasisFwd.set(basis.forward[0], basis.forward[1], basis.forward[2]);
      }
    }

    this.detailOptics = computeDetailCameraOptics(
      this.detailViewDist,
      this.planet.baseRadius,
      this.planet.nativeVoxelSize,
      55,
    );

    const cosP = Math.cos(this.detailPitch);
    const dirToCam = this._v1
      .set(0, 0, 0)
      .addScaledVector(this.detailNormal, Math.sin(this.detailPitch))
      .addScaledVector(this.detailBasisFwd, -cosP)
      .normalize();

    let safeDist = this.detailOptics.physicalDist;
    const rayStartOffset = Math.max(this.planet.nativeVoxelSize * 2.5, 0.04 * scale);
    const occHit = this.planet.raycastTerrain(
      this.detailTarget.x + this.detailNormal.x * rayStartOffset,
      this.detailTarget.y + this.detailNormal.y * rayStartOffset,
      this.detailTarget.z + this.detailNormal.z * rayStartOffset,
      dirToCam.x,
      dirToCam.y,
      dirToCam.z,
      safeDist,
    );
    if (occHit.hit && occHit.distance < safeDist) {
      safeDist = Math.max(this.planet.nativeVoxelSize * 4.5, occHit.distance * 0.82);
    }

    const desiredPos = this._v2
      .copy(this.detailTarget)
      .addScaledVector(dirToCam, safeDist);

    const minSurfaceClear = Math.max(this.planet.nativeVoxelSize * 3.0, 0.06 * scale);
    const dCam = this.planet.sampleDensityAndNormal(
      desiredPos.x,
      desiredPos.y,
      desiredPos.z,
      this._normalArr,
    );
    if (dCam > -minSurfaceClear) {
      const push = dCam + minSurfaceClear;
      desiredPos.x += this._normalArr[0] * push;
      desiredPos.y += this._normalArr[1] * push;
      desiredPos.z += this._normalArr[2] * push;
    }

    const damp = 1 - Math.exp(-15 * dt);
    this.camPosSmooth.lerp(desiredPos, damp);
    this.camLookSmooth.lerp(this.detailTarget, damp);

    if (Math.abs(this.camera.fov - this.detailOptics.fovDeg) > 0.05) {
      this.camera.fov = this.detailOptics.fovDeg;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.copy(this.camPosSmooth);
    this.camera.up.lerp(this.detailNormal, 1 - Math.exp(-10 * dt)).normalize();
    this.camera.lookAt(this.camLookSmooth);
  }

  private updateLandingCamera(dt: number): void {
    const scale = this.getPlanetScale();

    if (this.landingStage === 'selecting') {
      let yawDelta = this.virtualMoveX;
      let pitchDelta = this.virtualMoveY;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) yawDelta -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) yawDelta += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pitchDelta += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pitchDelta -= 1;
      this.landingOrbitYaw += yawDelta * 1.4 * dt;
      this.landingOrbitPitch = clamp(this.landingOrbitPitch + pitchDelta * 1.1 * dt, -1.35, 1.35);

      const cosP = Math.cos(this.landingOrbitPitch);
      const rx = cosP * Math.cos(this.landingOrbitYaw);
      const ry = Math.sin(this.landingOrbitPitch);
      const rz = cosP * Math.sin(this.landingOrbitYaw);
      const desired = this._v1.set(
        this.landingOrbitDist * rx,
        this.landingOrbitDist * ry,
        this.landingOrbitDist * rz,
      );
      const damp = 1 - Math.exp(-10 * dt);
      this.camPosSmooth.lerp(desired, damp);
      this.camLookSmooth.lerp(this._v2.set(0, 0, 0), damp);
      this.camera.position.copy(this.camPosSmooth);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camLookSmooth);
      return;
    }

    if (this.landingStage === 'descending') {
      this.landingDescentT = Math.min(1, this.landingDescentT + dt / 0.95);
      const pose = evaluateLandingDescentPose(
        this.landingDescentT,
        [
          this.landingDescentStartPos.x,
          this.landingDescentStartPos.y,
          this.landingDescentStartPos.z,
        ],
        [
          this.landingDescentEndPos.x,
          this.landingDescentEndPos.y,
          this.landingDescentEndPos.z,
        ],
        [this.landingSite.x, this.landingSite.y, this.landingSite.z],
        [
          this.landingDescentEndLook.x,
          this.landingDescentEndLook.y,
          this.landingDescentEndLook.z,
        ],
      );
      this.camPosSmooth.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      this.camLookSmooth.set(pose.look[0], pose.look[1], pose.look[2]);
      this.camera.position.copy(this.camPosSmooth);
      this.camera.up.lerp(this.landingNormal, 1 - Math.exp(-7 * dt)).normalize();
      this.camera.lookAt(this.camLookSmooth);

      if (pose.done) {
        this.landingStage = 'landed';
        this.landingPos.copy(this.landingDescentEndPos);
        this.landingVel.set(0, 0, 0);
        this.landingUp.copy(this.landingNormal);
        this.landingPitch = -0.04;
        this.landingGrounded = false;
      }
      return;
    }

    // Stage 3: 'landed' -> Planetary gravity-aligned surface FPS walk (with core-pass guard)
    const coreUp = resolveSphericalCoreUp(
      [this.landingPos.x, this.landingPos.y, this.landingPos.z],
      [this.landingUp.x, this.landingUp.y, this.landingUp.z],
      this.planet.baseRadius * 0.08,
    );
    this.landingUp.set(coreUp[0], coreUp[1], coreUp[2]);
    const landedBasis = transportCameraForwardOnSphere(
      coreUp,
      [this.landingFwd.x, this.landingFwd.y, this.landingFwd.z],
      0,
    );
    this.landingFwd.set(landedBasis.forward[0], landedBasis.forward[1], landedBasis.forward[2]);
    const rightVec = this._v4.set(landedBasis.right[0], landedBasis.right[1], landedBasis.right[2]);

    if (this.keys.has('KeyQ')) {
      this.landingFwd.applyAxisAngle(this.landingUp, 1.8 * dt).normalize();
    }
    if (this.keys.has('KeyE')) {
      this.landingFwd.applyAxisAngle(this.landingUp, -1.8 * dt).normalize();
    }

    let mf = this.virtualMoveY;
    let mr = this.virtualMoveX;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mf += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mf -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mr += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mr -= 1;
    mf = clamp(mf, -1, 1);
    mr = clamp(mr, -1, 1);

    const wish = this._v3
      .set(0, 0, 0)
      .addScaledVector(this.landingFwd, mf)
      .addScaledVector(rightVec, mr);
    if (wish.lengthSq() > 1) wish.normalize();

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.85 : 1.0;
    const walkSpd = Math.min(this.fpsSpeed, 14 * scale) * sprint;

    const params = this.getGravityParams();
    computeGravityVector(
      this.landingPos.x,
      this.landingPos.y,
      this.landingPos.z,
      params,
      this._grav,
    );
    this.landingVel.x += this._grav.x * dt;
    this.landingVel.y += this._grav.y * dt;
    this.landingVel.z += this._grav.z * dt;

    if (this.landingJumpQueued && this.landingGrounded) {
      const jumpSpd = 6.8 * Math.sqrt(Math.max(0.08, this.config.gravityScale * scale));
      this.landingVel.addScaledVector(this.landingUp, jumpSpd);
      this.landingGrounded = false;
      this.sound.playJump();
    }
    this.landingJumpQueued = false;

    const radialV = this.landingVel.dot(this.landingUp);
    this._v1.copy(this.landingVel).addScaledVector(this.landingUp, -radialV);
    this._v1.lerp(
      this._v2.copy(wish).multiplyScalar(walkSpd),
      1 - Math.exp(-(this.landingGrounded ? 15 : 5) * dt),
    );
    this.landingVel.copy(this._v1).addScaledVector(this.landingUp, radialV);
    this.landingPos.addScaledVector(this.landingVel, dt);

    // Collide feet against voxel terrain keeping eye height clear above ground
    const eyeHeight = Math.max(1.65 * scale, this.planet.nativeVoxelSize * 4);
    const footClear = eyeHeight * 0.85;
    const footCheckPos = this._v1
      .copy(this.landingPos)
      .addScaledVector(this.landingUp, -footClear);
    const dGround = this.planet.sampleDensityAndNormal(
      footCheckPos.x,
      footCheckPos.y,
      footCheckPos.z,
      this._normalArr,
    );
    this.landingGrounded = false;
    const stepRadius = Math.max(0.28 * scale, this.planet.nativeVoxelSize * 1.5);
    if (dGround > -stepRadius) {
      const pen = dGround + stepRadius;
      const nx = this._normalArr[0];
      const ny = this._normalArr[1];
      const nz = this._normalArr[2];
      this.landingPos.x += nx * pen;
      this.landingPos.y += ny * pen;
      this.landingPos.z += nz * pen;
      this._v2.set(nx, ny, nz);
      const vn = this.landingVel.dot(this._v2);
      if (vn < 0) {
        this.landingVel.addScaledVector(this._v2, -vn);
      }
      if (this._v2.dot(this.landingUp) > 0.3) {
        this.landingGrounded = true;
      }
    }

    const lookDir = this._v2
      .copy(this.landingFwd)
      .multiplyScalar(Math.cos(this.landingPitch))
      .addScaledVector(this.landingUp, Math.sin(this.landingPitch))
      .normalize();

    const damp = 1 - Math.exp(-18 * dt);
    this.camPosSmooth.lerp(this.landingPos, damp);
    this._v1.copy(this.landingPos).add(lookDir);
    this.camLookSmooth.lerp(this._v1, damp);

    this.camera.position.copy(this.camPosSmooth);
    this.camera.up.lerp(this.landingUp, 1 - Math.exp(-12 * dt)).normalize();
    this.camera.lookAt(this.camLookSmooth);
  }

  private updatePerspectiveCamera(dt: number): void {
    const scale = this.getPlanetScale();

    // Free CAD target panning via WASD / Space / C
    const cosP = Math.cos(this.perspPitch);
    const offsetDir = this._v1
      .set(cosP * Math.cos(this.perspYaw), Math.sin(this.perspPitch), cosP * Math.sin(this.perspYaw))
      .normalize();

    let mf = this.virtualMoveY;
    let mr = this.virtualMoveX;
    let mu = (this.virtualUp ? 1 : 0) - (this.virtualDown ? 1 : 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mf += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mf -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mr += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mr -= 1;
    if (this.keys.has('Space') || this.keys.has('KeyE')) mu += 1;
    if (this.keys.has('KeyC') || this.keys.has('KeyQ')) mu -= 1;

    if (Math.abs(mf) > 0.02 || Math.abs(mr) > 0.02 || Math.abs(mu) > 0.02) {
      const fwdHoriz = this._v2.set(-offsetDir.x, 0, -offsetDir.z);
      if (fwdHoriz.lengthSq() < 1e-4) fwdHoriz.set(0, 0, -1);
      fwdHoriz.normalize();
      const rightHoriz = this._v3.crossVectors(fwdHoriz, this.camera.up).normalize();
      const panRate = Math.max(this.perspDist * 0.75, 2.0 * scale);
      this.perspTarget
        .addScaledVector(fwdHoriz, mf * panRate * dt)
        .addScaledVector(rightHoriz, mr * panRate * dt);
      this.perspTarget.y += mu * panRate * dt;
      const maxTargetOff = 45 * scale;
      if (this.perspTarget.length() > maxTargetOff) {
        this.perspTarget.setLength(maxTargetOff);
      }
    }

    const desiredPos = this._v4
      .copy(this.perspTarget)
      .addScaledVector(offsetDir, this.perspDist);
    const damp = 1 - Math.exp(-12 * dt);
    this.camPosSmooth.lerp(desiredPos, damp);
    this.camLookSmooth.lerp(this.perspTarget, damp);

    const targetFov = clamp(this.config.perspectiveFov, 18, 115);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.copy(this.camPosSmooth);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLookSmooth);
  }

  private updateCamera(dt: number): void {
    const scale = this.getPlanetScale();
    if (this.phase === 'title') {
      this.titleAngle += dt * 0.16;
      const dist = 35.5 * scale;
      const cx = Math.cos(this.titleAngle) * dist;
      const cz = Math.sin(this.titleAngle) * dist;
      const cy = 10.5 * scale + Math.sin(this.titleAngle * 0.7) * 2.5 * scale;
      this.camera.position.set(cx, cy, cz);
      this.camera.up.set(0, 1, 0);
      this._v1.set(-cx, -cy + 0.3 * scale, -cz).normalize();
      this._v2.crossVectors(this._v1, this.camera.up).normalize();
      this._v3.set(0, 0.3 * scale, 0).addScaledVector(this._v2, -4.4 * scale);
      this.camera.lookAt(this._v3);
      return;
    }

    if (this.directorPreviewPlan && this.directorPreviewAnchor) {
      this.directorPreviewTime += dt;
      const dur = Math.max(0.25, this.directorPreviewPlan.durationSec);
      const u = clamp(this.directorPreviewTime / dur, 0, 1);
      const pose = evaluateDirectorPose(
        this.directorPreviewPlan,
        u,
        this.directorPreviewAnchor,
      );
      this.config.sunAzimuthDeg = this.directorPreviewBaseSunAzimuth + pose.sunAzimuthDeltaDeg;
      this.updateSunDirection();
      this.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      this.camera.up.set(pose.up[0], pose.up[1], pose.up[2]).normalize();
      this.camera.fov = pose.fovDeg;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
      this.lastHighResFocus.set(pose.streamFocus[0], pose.streamFocus[1], pose.streamFocus[2]);
      if (this.directorPreviewTime >= dur) {
        this.stopDirectorPreview();
      }
      return;
    }

    if (this.directorTimelineLocked) {
      return;
    }

    if (this.config.cameraMode === 'fps') {
      this.updateFpsCamera(dt);
      return;
    }

    if (this.config.cameraMode === 'detail') {
      this.updateDetailCamera(dt);
      return;
    }

    if (this.config.cameraMode === 'landing') {
      this.updateLandingCamera(dt);
      return;
    }

    if (this.config.cameraMode === 'perspective') {
      this.updatePerspectiveCamera(dt);
      return;
    }

    if (this.config.cameraMode === 'orbit') {
      let yawDelta = this.virtualMoveX;
      let pitchDelta = this.virtualMoveY;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) yawDelta -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) yawDelta += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pitchDelta += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pitchDelta -= 1;
      this.orbitYaw += yawDelta * 1.4 * dt;
      this.orbitPitch = clamp(this.orbitPitch + pitchDelta * 1.1 * dt, -1.35, 1.35);

      const cosP = Math.cos(this.orbitPitch);
      const rx = cosP * Math.cos(this.orbitYaw);
      const ry = Math.sin(this.orbitPitch);
      const rz = cosP * Math.sin(this.orbitYaw);
      const surfR = this.planet.findSurfaceRadiusAlongRay(rx, ry, rz);
      const minOrbitR =
        surfR +
        Math.min(
          1.5 * scale,
          Math.max(1e-7 * scale, this.planet.nativeVoxelSize * 4),
        );
      if (this.orbitDistance < minOrbitR) {
        this.orbitDistance = minOrbitR;
      }
      this._v1.set(
        this.orbitDistance * rx,
        this.orbitDistance * ry,
        this.orbitDistance * rz,
      );
      const damp = 1 - Math.exp(-9 * dt);
      this.camPosSmooth.lerp(this._v1, damp);
      this.camLookSmooth.lerp(this._v2.set(0, 0, 0), damp);
      this.camera.position.copy(this.camPosSmooth);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camLookSmooth);
      return;
    }

    if (this.config.cameraMode === 'firstPerson') {
      this.updateFirstPersonCamera(dt);
      return;
    }

    const metrics = this.getPlayerMetrics();
    const charScale = metrics.charScale;
    const up = this.playerUp;
    const radAlpha = 1 - Math.exp(-9.5 * dt);
    const tanAlpha = 1 - Math.exp(-22 * dt);
    const stabilized = stabilizeRadialAnchor(
      [this.explorerCamAnchor.x, this.explorerCamAnchor.y, this.explorerCamAnchor.z],
      [this.playerPos.x, this.playerPos.y, this.playerPos.z],
      [up.x, up.y, up.z],
      radAlpha,
      tanAlpha,
    );
    this.explorerCamAnchor.set(stabilized[0], stabilized[1], stabilized[2]);

    const expBasis = transportCameraForwardOnSphere(
      [up.x, up.y, up.z],
      [this.explorerCamFwd.x, this.explorerCamFwd.y, this.explorerCamFwd.z],
      0,
    );
    this.explorerCamFwd.set(expBasis.forward[0], expBasis.forward[1], expBasis.forward[2]);

    const lookLift = Math.max(
      this.planet.nativeVoxelSize * 1.4,
      Math.min(metrics.lookLift, this.camDistance * 0.24),
    );
    const desiredLook = this._v1
      .copy(this.explorerCamAnchor)
      .addScaledVector(up, lookLift);

    const cosP = Math.cos(this.camPitch);
    const shoulderLift = Math.max(
      this.planet.nativeVoxelSize * 1.0,
      Math.min(metrics.shoulderLift, this.camDistance * 0.16),
    );
    const camOffsetDir = this._v2
      .copy(this.explorerCamFwd)
      .multiplyScalar(-cosP)
      .addScaledVector(up, Math.sin(this.camPitch))
      .normalize();

    let safeCamDist = this.camDistance;
    const occHit = this.planet.raycastTerrain(
      desiredLook.x,
      desiredLook.y,
      desiredLook.z,
      camOffsetDir.x,
      camOffsetDir.y,
      camOffsetDir.z,
      safeCamDist,
    );
    if (occHit.hit && occHit.distance < safeCamDist) {
      safeCamDist = Math.max(
        Math.min(1.5 * charScale, this.camDistance * 0.45),
        occHit.distance * 0.84,
      );
    }

    const desiredPos = this._v4
      .copy(desiredLook)
      .addScaledVector(camOffsetDir, safeCamDist)
      .addScaledVector(up, shoulderLift);

    const minClear = Math.max(this.planet.nativeVoxelSize * 1.8, 0.16 * charScale);
    const dCam = this.planet.sampleDensityAndNormal(
      desiredPos.x,
      desiredPos.y,
      desiredPos.z,
      this._normalArr,
    );
    if (dCam > -minClear) {
      const push = dCam + minClear;
      desiredPos.x += this._normalArr[0] * push;
      desiredPos.y += this._normalArr[1] * push;
      desiredPos.z += this._normalArr[2] * push;
    }

    const damp = 1 - Math.exp(-15 * dt);
    this.camPosSmooth.lerp(desiredPos, damp);
    this.camLookSmooth.lerp(desiredLook, damp);

    this.camera.position.copy(this.camPosSmooth);
    this.camera.up.lerp(up, 1 - Math.exp(-11 * dt)).normalize();
    this.camera.lookAt(this.camLookSmooth);
  }

  private updateFirstPersonCamera(dt: number): void {
    const metrics = this.getPlayerMetrics();
    const up = this.playerUp;
    const radAlpha = 1 - Math.exp(-14 * dt);
    const tanAlpha = 1 - Math.exp(-28 * dt);
    const stabilized = stabilizeRadialAnchor(
      [this.explorerCamAnchor.x, this.explorerCamAnchor.y, this.explorerCamAnchor.z],
      [this.playerPos.x, this.playerPos.y, this.playerPos.z],
      [up.x, up.y, up.z],
      radAlpha,
      tanAlpha,
    );
    this.explorerCamAnchor.set(stabilized[0], stabilized[1], stabilized[2]);

    const expBasis = transportCameraForwardOnSphere(
      [up.x, up.y, up.z],
      [this.explorerCamFwd.x, this.explorerCamFwd.y, this.explorerCamFwd.z],
      0,
    );
    this.explorerCamFwd.set(expBasis.forward[0], expBasis.forward[1], expBasis.forward[2]);

    const eyePose = computeFirstPersonEyePose(
      [this.explorerCamAnchor.x, this.explorerCamAnchor.y, this.explorerCamAnchor.z],
      [up.x, up.y, up.z],
      [this.explorerCamFwd.x, this.explorerCamFwd.y, this.explorerCamFwd.z],
      this.firstPersonPitch,
      metrics.eyeHeight,
    );

    const desiredEye = this._v4.set(eyePose.eyePos[0], eyePose.eyePos[1], eyePose.eyePos[2]);
    const minClear = Math.max(this.planet.nativeVoxelSize * 0.9, 0.08 * metrics.charScale);
    const dCam = this.planet.sampleDensityAndNormal(
      desiredEye.x,
      desiredEye.y,
      desiredEye.z,
      this._normalArr,
    );
    if (dCam > -minClear) {
      const push = dCam + minClear;
      desiredEye.x += this._normalArr[0] * push;
      desiredEye.y += this._normalArr[1] * push;
      desiredEye.z += this._normalArr[2] * push;
    }

    const posDamp = 1 - Math.exp(-26 * dt);
    const lookDamp = 1 - Math.exp(-28 * dt);
    this.camPosSmooth.lerp(desiredEye, posDamp);
    this._v1
      .copy(desiredEye)
      .add(this._v2.set(eyePose.lookDir[0], eyePose.lookDir[1], eyePose.lookDir[2]));
    this.camLookSmooth.lerp(this._v1, lookDamp);

    this.camera.position.copy(this.camPosSmooth);
    this.camera.up.lerp(up, 1 - Math.exp(-14 * dt)).normalize();
    this.camera.lookAt(this.camLookSmooth);
  }

  private scheduleNextFrame(): void {
    if (this.isDisposed) return;
    if (this.isSoftware) {
      const backendAny = this.renderer?.backend as
        | { gl?: WebGL2RenderingContext }
        | undefined;
      const gl = backendAny?.gl;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (this.isDisposed) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
          if (state === gl.UNSIGNALED) {
            this.timerHandle = window.setTimeout(poll, 6);
          } else {
            if (sync) gl.deleteSync(sync);
            this.timerHandle = window.setTimeout(() => {
              this.frameHandle = requestAnimationFrame(this.tick);
            }, 75);
          }
        };
        this.timerHandle = window.setTimeout(poll, 6);
        return;
      }
      this.timerHandle = window.setTimeout(() => {
        this.frameHandle = requestAnimationFrame(this.tick);
      }, 80);
    } else {
      this.frameHandle = requestAnimationFrame(this.tick);
    }
  }

  private tick = (): void => {
    if (this.isDisposed || this.isOfflineRendering) return;

    const frameStart = performance.now();
    const rawDt = (frameStart - this.lastTime) / 1000;
    this.lastTime = frameStart;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.045);

    if (rawDt > 0) {
      const instFps = 1 / rawDt;
      this.fpsSmooth = this.fpsSmooth * 0.88 + instFps * 0.12;
      this.frameTimeSmooth = this.frameTimeSmooth * 0.88 + rawDt * 1000 * 0.12;
    }

    const scale = this.getPlanetScale();

    if (!this.hasWorld || this.isGenerating) {
      this.simTimeSec += dt;
      this.simTimeNode.value = this.simTimeSec;
      this.titleAngle += dt * (this.isGenerating ? 0.35 : 0.08);
      if (this.starPoints) {
        this.starPoints.rotation.y = this.titleAngle * 0.12;
      }
      if (this.genCoreGroup && this.genCoreGroup.visible) {
        this.genCoreGroup.rotation.y += dt * 0.65;
        this.genCoreGroup.rotation.x = Math.sin(this.simTimeSec * 0.8) * 0.18;
      }
      if (this.moonGroup) {
        this.moonGroup.position.x = Math.cos(this.simTimeSec * 0.12) * -36 * scale;
        this.moonGroup.position.z = Math.sin(this.simTimeSec * 0.12) * -36 * scale;
      }
      this.camera.position.set(
        Math.cos(this.titleAngle) * 35.5 * scale,
        10.5 * scale,
        Math.sin(this.titleAngle) * 35.5 * scale,
      );
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
      this.updateDynamicShadowFrustum(0, 0, 0, 35.5 * scale);
      const renderT0 = performance.now();
      this.renderActiveScene();
      const renderSubmitMs = performance.now() - renderT0;
      this.pollGpuTimestamps();
      this.perfTracker.recordCpuFrame({
        frameIntervalMs: rawDt > 0 ? rawDt * 1000 : 16.6,
        cpuTickMs: performance.now() - frameStart,
        simStepMs: 0,
        meshBuildMs: 0,
        renderSubmitMs,
      });
      this.scheduleNextFrame();
      return;
    }

    let simStepMsThisFrame = 0;
    let meshBuildMsThisFrame = 0;

    const simActive = this.phase === 'playing' && !this.config.simPaused;
    if (simActive || this.phase === 'title') {
      this.simTimeSec += dt;
      this.simTimeNode.value = this.simTimeSec;
      this.moonGroup.position.x = Math.cos(this.simTimeSec * 0.12) * -36 * scale;
      this.moonGroup.position.z = Math.sin(this.simTimeSec * 0.12) * -36 * scale;
      this.updateCloudPuffs(dt);
    }

    let hoveredHit: ReturnType<VoxelPlanet['raycastTerrain']> | null = null;
    if (this.phase === 'playing') {
      let playerStats = {
        grabbedCount: 0,
        beamForceN: 0,
        gravityWeightN: 0,
        loadRatioSum: 0,
        peakSpeedMs: 0,
      };
      if (
        simActive &&
        (this.config.cameraMode === 'explorer' || this.config.cameraMode === 'firstPerson')
      ) {
        this.updateExplorerPhysics(dt);
      } else if (
        simActive &&
        (this.tractorGrabbedPlayer || !this.playerGrounded)
      ) {
        playerStats = this.integrateSuspendedExplorerPhysics(dt);
      }

      // Live brush hover preview, voxel probe, landing site hover & sculpting
      if (this.pointerActive) {
        hoveredHit = this.raycastFromPointer();
        if (this.config.cameraMode === 'landing' && this.landingStage === 'selecting') {
          this.brushPreview.visible = false;
          if (hoveredHit.hit) {
            this.landingHasHover = true;
            this.landingHoverPos.set(hoveredHit.x, hoveredHit.y, hoveredHit.z);
            this.landingHoverNormal.set(hoveredHit.nx, hoveredHit.ny, hoveredHit.nz).normalize();
          } else {
            this.landingHasHover = false;
          }
        } else if (this.isTractorDragging) {
          this.brushPreview.visible = false;
        } else if (hoveredHit.hit) {
          const activeAttrs = this.getActiveToolAttrs();
          this.brushPreview.visible = true;
          this.brushPreview.position.set(hoveredHit.x, hoveredHit.y, hoveredHit.z);
          this.brushPreview.scale.setScalar(
            Math.max(this.planet.nativeVoxelSize * 0.75, this.config.brushRadius * activeAttrs.radiusMult),
          );
          if (this.isSculpting && activeAttrs.behavior !== 'tractorBeam') {
            this.brushCooldown -= dt;
            if (this.brushCooldown <= 0) {
              this.performBrushAction(hoveredHit);
              this.brushCooldown = activeAttrs.cooldownSec;
            }
          }
        } else {
          this.brushPreview.visible = false;
        }
      }

      if (simActive) {
        const simT0 = performance.now();
        const gravParams = this.getGravityParams();
        const activeFluidTractor = this.updateTractorBeamSolver(dt);
        this.fluid.step(dt, this.planet, gravParams, 2, activeFluidTractor);
        if (this.isTractorDragging && this.fluid.tractorCapturedCount > 0) {
          this.waterMeshDirty = true;
        }
        this.updateSplashInstances();

        this.waterRebuildCooldown -= dt;
        if (this.waterRebuildCooldown <= 0 || this.waterMeshDirty) {
          if (this.fluid.activeCount > 0 || this.waterMeshDirty) {
            const wT0 = performance.now();
            this.rebuildWaterMesh();
            meshBuildMsThisFrame += performance.now() - wT0;
          }
          this.waterRebuildCooldown = this.isSoftware ? 0.16 : 0.07;
        }
        const debrisStats = this.updateDebris(dt);
        const entityStats = this.updateDynamicEntities(dt);

        if (this.isTractorDragging) {
          const fluidCount = this.fluid.tractorCapturedCount;
          const totalEntities =
            debrisStats.grabbedCount + entityStats.grabbedCount + playerStats.grabbedCount;
          const totalBeamForceN =
            this.fluid.tractorTotalBeamForceN +
            debrisStats.beamForceN +
            entityStats.beamForceN +
            playerStats.beamForceN;
          const totalGravityWeightN =
            this.fluid.tractorTotalGravityWeightN +
            debrisStats.gravityWeightN +
            entityStats.gravityWeightN +
            playerStats.gravityWeightN;
          const totalUnits = fluidCount + totalEntities;
          const weightedLoad =
            totalUnits > 0
              ? (this.fluid.tractorAvgLoadRatio * fluidCount +
                  debrisStats.loadRatioSum +
                  entityStats.loadRatioSum +
                  playerStats.loadRatioSum) /
                totalUnits
              : 0;
          const peakSpeedMs = Math.max(
            this.fluid.tractorPeakSpeedMs,
            debrisStats.peakSpeedMs,
            entityStats.peakSpeedMs,
            playerStats.peakSpeedMs,
          );
          const esc = summarizeEscapeStatus(
            this.tractorTarget.x,
            this.tractorTarget.y,
            this.tractorTarget.z,
            peakSpeedMs,
            gravParams,
          );
          this.tractorTelemetry = {
            active: true,
            capturedFluidCount: fluidCount,
            capturedEntityCount: totalEntities,
            localGravityMs2: esc.localGravityMs2,
            beamForceN: totalBeamForceN,
            gravityWeightN: totalGravityWeightN,
            loadRatio: weightedLoad,
            stretchDistanceM: this.tractorAnchor.distanceTo(this.tractorTarget),
            peakSpeedMs,
            escapeVelocityMs: esc.escapeVelocityMs,
            nearEscape: esc.nearEscape,
          };
        } else {
          const rCur = this.planet.baseRadius;
          this.tractorTelemetry = {
            ...createIdleTractorTelemetry(),
            localGravityMs2: computeGravityMagnitude(rCur, gravParams),
            escapeVelocityMs: computeEscapeVelocity(rCur, gravParams),
          };
        }
        this.metabolism.advanceAsync(dt, 2);
        this.metabolism.tickPlanetaryFeedback(
          dt,
          this.planet,
          (hs) => this.applyMetabolismThermalHotspots(hs),
          (op) => this.applyMetabolismMineralOp(op),
          (fop) => this.applyMetabolismFluidOp(fop),
        );
        this.syncMetabolismReadOnlyVisuals(false);

        if (this.geologicalVisuals) {
          const geoSnap = this.metabolism.getSummarySnapshot();
          this.geologicalVisuals.update(
            this.simTimeSec,
            this.planet.baseRadius,
            geoSnap.geologicalStats,
            this.hasWorld,
          );
          this.syncOceanSeaMeshScale();
        }

        if (this.protocellVisual) {
          const zones = this.metabolism.couplingRegistry.listZones();
          const primaryZone = zones[0];
          const zoneCenter = this.metabolism.getPrimaryProtocellZoneCenter();
          const zoneHalf = primaryZone
            ? Math.max(0.5, 0.5 * (primaryZone.aabbMax[0] - primaryZone.aabbMin[0]))
            : Math.max(0.8, this.planet.baseRadius * 0.18);
          const showVisGroup =
            this.hasWorld &&
            (Boolean(this.config.showCouplingZones) ||
              this.config.terrainOverlay === 'metabolism' ||
              this.metabolismUiOpen);
          const showCell = showVisGroup && Boolean(this.config.showProtocell3d ?? true);
          const showPicPts = showVisGroup;
          const metabSnap = this.metabolism.getSummarySnapshot();
          this.protocellVisual.update(
            dt,
            this.simTimeSec,
            zoneCenter,
            zoneHalf,
            metabSnap.cellularBio,
            showCell,
            showPicPts,
          );
        }

        simStepMsThisFrame = performance.now() - simT0;
        this.simStepMsSmooth = this.simStepMsSmooth * 0.85 + simStepMsThisFrame * 0.15;
      } else if (this.waterMeshDirty) {
        const wT0 = performance.now();
        this.rebuildWaterMesh();
        meshBuildMsThisFrame += performance.now() - wT0;
      }

      if (hoveredHit && hoveredHit.hit) {
        this.lastHoveredWorldPos = [hoveredHit.x, hoveredHit.y, hoveredHit.z];
        const curBhv = this.getActiveToolAttrs().behavior;
        if (
          this.config.debugProbeEnabled ||
          curBhv === 'surveyClinometer' ||
          curBhv === 'surveyPin'
        ) {
          this.lastHoveredAttitude = this.sampleAttitudeAt(hoveredHit.x, hoveredHit.y, hoveredHit.z);
        } else {
          this.lastHoveredAttitude = null;
        }
        if (this.config.debugProbeEnabled) {
          this.lastProbe = this.planet.probeVoxelCell(hoveredHit.x, hoveredHit.y, hoveredHit.z);
        }
        if (this.hoveredVoxVisual) {
          const showHoveredBox =
            Boolean(this.config.showHoveredFvmVox ?? true) &&
            (this.metabolismUiOpen ||
              this.config.terrainOverlay === 'metabolism' ||
              this.config.debugProbeEnabled);
          if (showHoveredBox) {
            const [ix, iy, iz] = this.metabolism.grid.worldToCell(hoveredHit.x, hoveredHit.y, hoveredHit.z);
            const cellCenter = this.metabolism.grid.cellCenterWorld(ix, iy, iz);
            this.hoveredVoxVisual.update(cellCenter, this.metabolism.grid.voxelSize, true);
          } else {
            this.hoveredVoxVisual.update(null, 0, false);
          }
        }
      } else {
        this.lastHoveredWorldPos = null;
        this.lastHoveredAttitude = null;
        this.hoveredVoxVisual?.update(null, 0, false);
      }

      if (this.lockedVoxVisual) {
        const showLockedBox =
          Boolean(this.lockedVoxWorldPos) &&
          (this.metabolismUiOpen ||
            this.config.terrainOverlay === 'metabolism' ||
            this.config.debugProbeEnabled);
        if (showLockedBox && this.lockedVoxWorldPos) {
          const [ix, iy, iz] = this.metabolism.grid.worldToCell(
            this.lockedVoxWorldPos[0],
            this.lockedVoxWorldPos[1],
            this.lockedVoxWorldPos[2],
          );
          const cellCenter = this.metabolism.grid.cellCenterWorld(ix, iy, iz);
          this.lockedVoxVisual.update(cellCenter, this.metabolism.grid.voxelSize * 1.03, true);
        } else {
          this.lockedVoxVisual.update(null, 0, false);
        }
      }
    } else if (this.phase === 'title') {
      if (this.waterMeshDirty) {
        const wT0 = performance.now();
        this.rebuildWaterMesh();
        meshBuildMsThisFrame += performance.now() - wT0;
      }
    }

    // Update Camera & Procedural Visual Markers
    this.updateCamera(dt);
    this.updateTractorBeamVisuals();

    if (this.landingBeaconGroup) {
      if (
        this.phase === 'playing' &&
        this.config.cameraMode === 'landing' &&
        (this.landingStage === 'descending' ||
          (this.landingStage === 'selecting' && this.landingHasHover))
      ) {
        const bPos =
          this.landingStage === 'descending' ? this.landingSite : this.landingHoverPos;
        const bNorm =
          this.landingStage === 'descending' ? this.landingNormal : this.landingHoverNormal;
        this.landingBeaconGroup.visible = true;
        this.landingBeaconGroup.position.copy(bPos).addScaledVector(bNorm, 0.03 * scale);
        this._q1.setFromUnitVectors(this._v1.set(0, 1, 0), bNorm);
        this.landingBeaconGroup.quaternion.copy(this._q1);
        const pulse = 1.0 + Math.sin(this.simTimeSec * 5.0) * 0.1;
        const bScale = Math.max(
          this.planet.nativeVoxelSize * 5,
          this.camera.position.distanceTo(bPos) * 0.035,
        );
        this.landingBeaconGroup.scale.set(bScale * pulse, bScale, bScale * pulse);
      } else {
        this.landingBeaconGroup.visible = false;
      }
    }

    if (this.detailReticleRing) {
      if (this.phase === 'playing' && this.config.cameraMode === 'detail') {
        this.detailReticleRing.visible = true;
        this.detailReticleRing.position
          .copy(this.detailTarget)
          .addScaledVector(this.detailNormal, Math.max(this.planet.nativeVoxelSize * 0.35, 0.004 * scale));
        this._q1.setFromUnitVectors(this._v1.set(0, 1, 0), this.detailNormal);
        this.detailReticleRing.quaternion.copy(this._q1);
        const rScale = clamp(
          this.detailOptics.effectiveStreamDist * 0.055,
          this.planet.nativeVoxelSize * 2.5,
          2.6 * scale,
        );
        this.detailReticleRing.scale.setScalar(rScale);
      } else {
        this.detailReticleRing.visible = false;
      }
    }

    this.syncLaserBeamVisuals();

    if (
      this.planet.isHighResStreaming ||
      this.config.cameraMode === 'detail' ||
      this.config.cameraMode === 'firstPerson' ||
      this.config.cameraMode === 'explorer'
    ) {
      const camR = this.camera.position.length();
      const surfDist = Math.max(
        this.planet.nativeVoxelSize * 0.25,
        Math.abs(camR - this.planet.baseRadius),
      );
      const focusDist =
        this.config.cameraMode === 'firstPerson'
          ? Math.max(
              this.planet.nativeVoxelSize * 0.5,
              this.getPlayerMetrics().eyeHeight * 0.65,
            )
          : Math.max(
              this.planet.nativeVoxelSize * 0.5,
              this.camera.position.distanceTo(this.lastHighResFocus),
            );
      const safeClips = computeSafeClipPlanes(
        surfDist,
        focusDist,
        this.planet.baseRadius,
        this.camera.fov,
      );
      const targetNear = safeClips.near;
      const targetFar = safeClips.far;

      if (
        Math.abs(this.camera.near - targetNear) / Math.max(this.camera.near, 1e-10) > 0.15 ||
        Math.abs(this.camera.far - targetFar) / Math.max(this.camera.far, 1) > 0.15
      ) {
        this.camera.near = targetNear;
        this.camera.far = targetFar;
        this.camera.updateProjectionMatrix();
      }
    }
    const meshT0 = performance.now();
    if (
      !this.planet.isHighResStreaming ||
      !this.lastHighResHideMacro ||
      this.highResActiveCount === 0
    ) {
      this.updateChunksWithLod(this.isSoftware ? 8 : 14);
    }
    const smoothFrameMs = this.frameTimeSmooth;
    const underStress = smoothFrameMs > 24;
    const severeStress = smoothFrameMs > 38;
    const streamBudget =
      this.config.lodMode === 0
        ? this.isSoftware
          ? 16
          : severeStress
            ? 18
            : 40
        : this.isSoftware
          ? 10
          : severeStress
            ? 8
            : underStress
              ? 14
              : 24;
    const streamTimeBudgetMs =
      this.config.lodMode === 0
        ? this.isSoftware
          ? 4.0
          : 7.5
        : this.isSoftware
          ? 2.8
          : severeStress
            ? 2.5
            : underStress
              ? 3.8
              : 5.5;
    let previewStreamOverride:
      | {
          focus: readonly [number, number, number];
          dist: number;
          lodModeOverride?: LodMode;
        }
      | undefined;
    if (this.directorPreviewPlan && this.directorPreviewAnchor) {
      const dur = Math.max(0.25, this.directorPreviewPlan.durationSec);
      const u = clamp(this.directorPreviewTime / dur, 0, 1);
      const pose = evaluateDirectorPose(
        this.directorPreviewPlan,
        u,
        this.directorPreviewAnchor,
      );
      previewStreamOverride = {
        focus: pose.streamFocus,
        dist: pose.streamDist,
        lodModeOverride: this.directorPreviewPlan.forceMaxVoxelDetail ? 0 : this.config.lodMode,
      };
    }

    this.updateHighResStreaming(
      hoveredHit,
      streamBudget,
      previewStreamOverride,
      streamTimeBudgetMs,
    );
    if (this.config.showChunkBounds && this.chunkBoundsDirty) {
      this.refreshChunkBoundsOverlay();
    }
    meshBuildMsThisFrame += performance.now() - meshT0;

    const activeFocusDist = Math.max(
      this.planet.nativeVoxelSize * 0.5,
      this.camera.position.distanceTo(this.lastHighResFocus),
    );
    this.updateDynamicShadowFrustum(
      this.lastHighResFocus.x,
      this.lastHighResFocus.y,
      this.lastHighResFocus.z,
      activeFocusDist,
    );

    const renderT0 = performance.now();
    this.renderActiveScene();
    const renderSubmitMs = performance.now() - renderT0;
    this.pollGpuTimestamps();

    this.perfTracker.recordCpuFrame({
      frameIntervalMs: rawDt > 0 ? rawDt * 1000 : 16.6,
      cpuTickMs: performance.now() - frameStart,
      simStepMs: simStepMsThisFrame,
      meshBuildMs: meshBuildMsThisFrame,
      renderSubmitMs,
    });

    // Throttled telemetry emission (~8Hz)
    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.12) {
      this.telemetryTimer = 0;
      this.emitTelemetrySnapshot();
    }

    this.scheduleNextFrame();
  };

  private pollGpuTimestamps(): void {
    if (
      !this.backendDiagnostic.gpuTimestampSupported ||
      this.gpuTimestampInFlight ||
      this.isOfflineRendering ||
      this.isDisposed
    ) {
      return;
    }
    this.gpuTimestampInFlight = true;
    void this.renderer
      .resolveTimestampsAsync('render')
      .then((gpuMs) => {
        if (!this.isDisposed && typeof gpuMs === 'number' && Number.isFinite(gpuMs)) {
          this.perfTracker.recordGpuTime(gpuMs);
        }
      })
      .catch(() => {
        // Ignore transient timestamp loss/disjoint query errors
      })
      .finally(() => {
        this.gpuTimestampInFlight = false;
      });
  }

  private emitTelemetrySnapshot(): void {
    const refPos =
      this.config.cameraMode === 'fps'
        ? this.fpsPos
        : this.config.cameraMode === 'landing' && this.landingStage === 'landed'
          ? this.landingPos
          : this.config.cameraMode === 'detail'
            ? this.detailTarget
            : this.config.cameraMode === 'perspective'
              ? this.camera.position
              : this.playerPos;
    const r = refPos.length();
    const params = this.getGravityParams();

    const sunDirArr: [number, number, number] = [
      this.sunDirUniform.x,
      this.sunDirUniform.y,
      this.sunDirUniform.z,
    ];
    const nearWater = clamp(
      (this.fluid.sampleWaterAt(refPos.x, refPos.y, refPos.z) + 0.15) * 2.5,
      0,
      1,
    );
    const localMat = this.planet.sampleNearestMaterial(
      refPos.x,
      refPos.y,
      refPos.z,
    );
    const atmoSample = sampleAtmosphereAtPoint(
      refPos.x,
      refPos.y,
      refPos.z,
      this.planet.baseRadius,
      this.config.atmosphere,
      this.simTimeSec,
      nearWater,
    );
    const thermalSample = sampleThermalField(
      refPos.x,
      refPos.y,
      refPos.z,
      this.planet.baseRadius,
      sunDirArr,
      this.config.atmosphere,
      this.config.thermal,
      this.simTimeSec,
      localMat,
      nearWater,
      computeHotspotDeltaC(refPos.x, refPos.y, refPos.z, this.thermalHotspots),
    );
    const sph = dirToLonLat(refPos.x, refPos.y, refPos.z);

    const renderInfo = this.renderer?.info?.render;
    const memInfo = this.renderer?.info?.memory;
    const perfWithMem = performance as Performance & {
      memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
    };
    const jsHeapUsedMb =
      typeof perfWithMem.memory?.usedJSHeapSize === 'number'
        ? Number((perfWithMem.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1))
        : null;
    const jsHeapLimitMb =
      typeof perfWithMem.memory?.jsHeapSizeLimit === 'number'
        ? Number((perfWithMem.memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(0))
        : null;
    const dom = this.renderer?.domElement;

    const perf = this.perfTracker.buildSnapshot({
      backendInfo: this.backendDiagnostic,
      drawCalls: renderInfo?.drawCalls ?? 0,
      renderPasses: renderInfo?.frameCalls ?? 0,
      triangles: renderInfo?.triangles ?? 0,
      points: renderInfo?.points ?? 0,
      lines: renderInfo?.lines ?? 0,
      geometriesCount: memInfo?.geometries ?? 0,
      texturesCount: memInfo?.textures ?? 0,
      renderTargetsCount: memInfo?.renderTargets ?? 0,
      gpuMemoryBytes: memInfo?.total ?? 0,
      jsHeapUsedMb,
      jsHeapLimitMb,
      pixelRatio: this.renderer?.getPixelRatio?.() ?? 1,
      canvasWidth: dom?.width ?? Math.max(1, this.container.clientWidth),
      canvasHeight: dom?.height ?? Math.max(1, this.container.clientHeight),
    });

    const datum = this.getCoordDatum();
    const playerCoord = worldToCoord([refPos.x, refPos.y, refPos.z], this.config.coordSystem, datum);
    const hoveredCoord = this.lastHoveredWorldPos
      ? worldToCoord(this.lastHoveredWorldPos, this.config.coordSystem, datum)
      : null;

    const probeWorldPos = this.lockedVoxWorldPos ?? this.lastHoveredWorldPos;
    const hoveredVoxProfile =
      probeWorldPos &&
      (this.metabolismUiOpen ||
        this.config.terrainOverlay === 'metabolism' ||
        this.config.debugProbeEnabled)
        ? this.metabolism.getVoxChemicalProfile(
            probeWorldPos[0],
            probeWorldPos[1],
            probeWorldPos[2],
          )
        : null;

    this.onTelemetry({
      altitude: r - this.planet.baseRadius,
      localGravity: computeGravityMagnitude(r, params),
      escapeVelocity: computeEscapeVelocity(r, params),
      waterParticles: this.fluid.activeCount,
      terrainVertices: this.totalTerrainVertices + this.highResVertices,
      backend: this.backendDiagnostic.backend,
      grounded:
        this.config.cameraMode === 'landing'
          ? this.landingGrounded
          : this.playerGrounded,
      cameraMode: this.config.cameraMode,
      fps: perf.fps,
      frameTimeMs: perf.frameTimeMs,
      simStepMs: perf.simStepMs,
      lodCounts: [...this.lodCounts] as [number, number, number, number],
      activeChunks: this.activeChunks + this.highResActiveCount,
      planetRadius: this.planet.baseRadius,
      voxelRadius: this.planet.voxelRadius,
      nativeVoxelSize: this.planet.nativeVoxelSize,
      seed: this.planet.seedConfig.seed,
      fpsSpeed: this.fpsSpeed,
      hoveredProbe: this.lastProbe,
      localTempC: thermalSample.tempC,
      localTempK: thermalSample.tempK,
      localPressureAtm: atmoSample.pressureAtm,
      localHumidity: atmoSample.humidity,
      windSpeedMs: atmoSample.windSpeedMs,
      atmoLayer: atmoSample.layerName,
      thermalRegime: thermalSample.regime,
      playerLatDeg: (sph.latRad * 180) / Math.PI,
      playerLonDeg: (sph.lonRad * 180) / Math.PI,
      sunDir: sunDirArr,
      simTimeSec: this.simTimeSec,
      voxelRevision: this.planet.voxelRevision,
      landingStage: this.landingStage,
      detailZoomMag: Number(this.detailOptics.magnification.toFixed(1)),
      perspectiveFov: this.config.perspectiveFov,
      tractorBeam: { ...this.tractorTelemetry },
      backendInfo: this.backendDiagnostic,
      perf,
      playerCoord,
      hoveredCoord,
      hoveredWorldPos: this.lastHoveredWorldPos,
      hoveredAttitude: this.lastHoveredAttitude,
      hoveredVoxProfile,
      voxLocked: Boolean(this.lockedVoxWorldPos),
      interiorCutawayEnabled: this.planet.isInteriorCutawayEnabled(),
      metabolismSummary: this.metabolism.getSummarySnapshot(),
    });
  }

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameHandle);
    clearTimeout(this.timerHandle);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);

    if (this.metabolismFieldPoints) {
      this.metabolismFieldPoints.geometry.dispose();
      (this.metabolismFieldPoints.material as THREE.Material).dispose();
    }
    if (this.couplingZoneLines) {
      this.couplingZoneLines.geometry.dispose();
      (this.couplingZoneLines.material as THREE.Material).dispose();
    }
    this.protocellVisual?.dispose();
    this.fvmFluxVisual?.dispose();
    this.hoveredVoxVisual?.dispose();
    this.lockedVoxVisual?.dispose();
    this.fvmVoxelBlocksVisual?.dispose();
    this.geologicalVisuals?.dispose();
    if (this.oceanSeaMesh) {
      this.oceanSeaMesh.geometry.dispose();
      this.oceanSeaMesh = null;
    }
    this.oceanMaterial?.dispose();
    this.oceanMaterial = null;

    if (this.renderer) {
      this.disposeRenderPipeline();
      const dom = this.renderer.domElement;
      dom.removeEventListener('pointerdown', this.handlePointerDown);
      dom.removeEventListener('wheel', this.handleWheel);
      dom.removeEventListener('contextmenu', this.handleContextMenu);
      dom.remove();
      this.renderer.dispose();
    }
  }
}
