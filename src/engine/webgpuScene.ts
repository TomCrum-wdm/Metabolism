import * as THREE from 'three/webgpu';
import {
  Discard,
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp as tslClamp,
  color,
  cos,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  sin,
  smoothstep,
  sqrt,
  time,
  uniform,
  uv,
  vec3,
  vertexColor,
} from 'three/tsl';
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
  BrushMode,
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
} from './voxelPlanet';
import { FluidSim, MAX_FLUID_PARTICLES } from './fluidSim';
import { SoundEngine } from './audio';
import { PlanetSavePayload } from './persistence';
import {
  AtmosphereConfig,
  computeGreenhouseBoostC,
  DEFAULT_ATMOS_CONFIG,
  sampleAtmosphereAtPoint,
} from './atmosphere';
import {
  DEFAULT_THERMAL_CONFIG,
  sampleThermalField,
  ThermalConfig,
} from './thermal';
import { dirToLonLat, lonLatToDir } from './cartography';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export type CameraMode = 'explorer' | 'orbit' | 'fps';
export type GamePhase = 'title' | 'playing' | 'paused';
export type LodMode = 'auto' | ChunkLodLevel;

export interface GenerationProgress {
  active: boolean;
  percent: number;
  stage: string;
  detail: string;
  seed: number;
  radius: number;
  voxelRadius: number;
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
}

export interface SandboxConfig {
  tool: BrushMode;
  material: MaterialId;
  brushRadius: number;
  brushStrength: number;
  gravityScale: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  showGravityVectors: boolean;
  cameraMode: CameraMode;
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
  atmosphere: AtmosphereConfig;
  thermal: ThermalConfig;
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
  private overlayModeNode = uniform(0.0); // 0=material, 1=temperature, 2=density, 3=lod
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
  private terrainMaterial!: THREE.MeshStandardNodeMaterial;
  private highResGlobeMaterial!: THREE.MeshStandardNodeMaterial;
  private highResHemiMaterial!: THREE.MeshStandardNodeMaterial;
  private highResMidOuterMaterial!: THREE.MeshStandardNodeMaterial;
  private highResMidMaterial!: THREE.MeshStandardNodeMaterial;
  private highResNativeMaterial!: THREE.MeshStandardNodeMaterial;
  private readonly hemiDiscardCenterWorld = new THREE.Vector3(0, 0, 0);
  private readonly midOuterDiscardCenterWorld = new THREE.Vector3(0, 0, 0);
  private readonly midDiscardCenterWorld = new THREE.Vector3(0, 0, 0);
  private readonly nativeDiscardCenterWorld = new THREE.Vector3(0, 0, 0);
  private hemiDiscardCenterViewNode = uniform(new THREE.Vector3(0, 0, 0));
  private hemiDiscardRadiusNode = uniform(0.0);
  private midOuterDiscardCenterViewNode = uniform(new THREE.Vector3(0, 0, 0));
  private midOuterDiscardRadiusNode = uniform(0.0);
  private midDiscardCenterViewNode = uniform(new THREE.Vector3(0, 0, 0));
  private midDiscardRadiusNode = uniform(0.0);
  private nativeDiscardCenterViewNode = uniform(new THREE.Vector3(0, 0, 0));
  private nativeDiscardRadiusNode = uniform(0.0);
  private highResGroup!: THREE.Group;
  private highResMeshes = new Map<string, THREE.Mesh>();
  private highResVertices = 0;
  private highResActiveCount = 0;
  private lastHighResFocus = new THREE.Vector3(0, DEFAULT_PLANET_RADIUS, 0);
  private totalTerrainVertices = 0;
  private lodCounts: [number, number, number, number] = [0, 0, 0, 343];
  private activeChunks = 0;

  // Chunk Bounds Debug Lines
  private chunkBoundsLines!: THREE.LineSegments;
  private chunkBoundsPos = new Float32Array(343 * 24 * 3);
  private chunkBoundsCol = new Float32Array(343 * 24 * 3);
  private chunkBoundsDirty = true;

  // Fluid rendering
  private waterMesh!: THREE.Mesh;
  private waterMaterial!: THREE.MeshPhysicalNodeMaterial;
  private splashMesh!: THREE.InstancedMesh;
  private waterMeshDirty = true;
  private waterRebuildCooldown = 0;

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

  // Camera states (Explorer / Orbit / FPS Free-Fly)
  private camYaw = -0.35;
  private camPitch = 0.36;
  private camDistance = 9.0;
  private orbitYaw = 0.52;
  private orbitPitch = 0.46;
  private orbitDistance = 30.5;
  private fpsPos = new THREE.Vector3(0, 18, 22);
  private fpsYaw = 0;
  private fpsPitch = -0.35;
  private fpsSpeed = 12.0;

  private camPosSmooth = new THREE.Vector3(0, 22, 24);
  private camLookSmooth = new THREE.Vector3(0, 6, 0);
  private titleAngle = 0.35;

  // Brush preview & Debris particles
  private brushPreview!: THREE.Mesh;
  private brushMat!: THREE.MeshBasicNodeMaterial;
  private brushColorNode = uniform(new THREE.Color(0xf97316));
  private debrisMesh!: THREE.InstancedMesh;
  private readonly MAX_DEBRIS = 96;
  private debrisPos = new Float32Array(96 * 3);
  private debrisVel = new Float32Array(96 * 3);
  private debrisLife = new Float32Array(96);
  private debrisNext = 0;

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
    muted: false,
    simPaused: false,
    lodMode: 'auto',
    lod0Dist: 23.0,
    lod1Dist: 34.0,
    wireframe: false,
    showChunkBounds: false,
    debugProbeEnabled: false,
    terrainRenderMode: 'smooth',
    terrainOverlay: 'material',
    voxelEdges: true,
    atmosphere: { ...DEFAULT_ATMOS_CONFIG },
    thermal: { ...DEFAULT_THERMAL_CONFIG },
  };

  private lastTime = 0;
  private telemetryTimer = 0;
  private fpsSmooth = 60;
  private frameTimeSmooth = 16.6;
  private simStepMsSmooth = 0;
  private lastProbe: VoxelCellProbe | null = null;
  private raycaster = new THREE.Raycaster();

  // Pre-allocated scratch math objects (zero GC in render loop)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _v4 = new THREE.Vector3();
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
  }

  private getPlanetScale(): number {
    return Math.max(this.planet.baseRadius / 13.0, 0.005);
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
    this.camDistance = 9.0 * scale;
    this.fpsSpeed = 12.0 * scale;
    this.syncEnvironmentUniforms();
    this.updateCloudPuffs(0);
    this.updateSunDirection();
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

    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new RoomEnvironment();
      const envRT = pmrem.fromScene(envScene, 0.04);
      this.scene.environment = envRT.texture;
      this.scene.environmentIntensity = 0.28;
      envScene.dispose();
      pmrem.dispose();
    } catch {
      // Safe fallback
    }

    this.setupLighting();
    this.setupSpaceBackdrop();
    this.setupMaterials();
    this.highResGroup = new THREE.Group();
    this.scene.add(this.highResGroup);
    this.setupChunkBoundsOverlay();
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

    this.bindEvents();
    this.lastTime = performance.now();
    this.scheduleNextFrame();
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
    const mapSize = this.isSoftware ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(mapSize, mapSize);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 88;
    const d = 21.5;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.035;
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
        .mul(atmoEnabledNode);
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
        .mul(atmoEnabledNode);
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
      const thresh = float(1.0).sub(tslClamp(cloudCoverNode, 0.0, 1.3).mul(0.88));
      return smoothstep(thresh.sub(0.14), thresh.add(0.22), fbm).mul(
        tslClamp(cloudCoverNode, 0.0, 1.0),
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
      return c.mul(0.56).mul(atmoEnabledNode);
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

  private syncDiscardViewUniforms(): void {
    if (!this.camera) return;
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    const inv = this.camera.matrixWorldInverse;
    this.hemiDiscardCenterViewNode.value.copy(this.hemiDiscardCenterWorld).applyMatrix4(inv);
    this.midOuterDiscardCenterViewNode.value.copy(this.midOuterDiscardCenterWorld).applyMatrix4(inv);
    this.midDiscardCenterViewNode.value.copy(this.midDiscardCenterWorld).applyMatrix4(inv);
    this.nativeDiscardCenterViewNode.value.copy(this.nativeDiscardCenterWorld).applyMatrix4(inv);
  }

  private createTerrainMaterial(
    discardSpheres: Array<{
      centerView: PlanetarySandboxEngine['hemiDiscardCenterViewNode'];
      radius: PlanetarySandboxEngine['hemiDiscardRadiusNode'];
    }> = [],
  ): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial();
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
      const tempC = float(-18.0).add(solarHeat).add(greenhouseNode).sub(min(float(95.0), altCool)).add(geoHeat);

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

    mat.colorNode = Fn(() => {
      if (discardSpheres.length > 0) {
        let shouldDiscard = length(positionView.sub(discardSpheres[0].centerView))
          .lessThan(discardSpheres[0].radius)
          .and(discardSpheres[0].radius.greaterThan(1e-12));
        for (let i = 1; i < discardSpheres.length; i++) {
          const cond = length(positionView.sub(discardSpheres[i].centerView))
            .lessThan(discardSpheres[i].radius)
            .and(discardSpheres[i].radius.greaterThan(1e-12));
          shouldDiscard = shouldDiscard.or(cond);
        }
        Discard(shouldDiscard);
      }

      const p = positionWorld;
      const radialDist = p.length();
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
        .mul(0.055);

      const base = vertexColor();
      const smoothCol = base.mul(float(0.93).add(strata.mul(0.11)).add(grain));

      // Minecraft-style blocky face border & pixel tile shading using face UV
      const blockUv = uv();
      const edgeDist = min(
        min(blockUv.x, float(1.0).sub(blockUv.x)),
        min(blockUv.y, float(1.0).sub(blockUv.y)),
      );
      const borderMask = smoothstep(0.0, 0.068, edgeDist);
      const pixelStep = sin(blockUv.x.mul(25.1327)).mul(cos(blockUv.y.mul(25.1327))).mul(0.045);
      const blockBody = base.mul(float(1.02).add(pixelStep));
      const blockyEdgeCol = mix(blockBody.mul(0.56), blockBody, borderMask);
      const blockyCol = mix(blockBody, blockyEdgeCol, voxelEdgesNode);

      const materialStyled = mix(smoothCol, blockyCol, isBlockyNode);

      // Thermal & Strata Density Overlays
      const thermalCol = computeThermalColor();
      const isThermal = smoothstep(0.5, 1.0, overlayModeNode).mul(
        float(1.0).sub(smoothstep(1.5, 2.0, overlayModeNode)),
      );
      const isDensity = smoothstep(1.5, 2.0, overlayModeNode);

      const rRatio = radialDist.div(max(planetRadiusNode, 0.05));
      const ringBand = fract(rRatio.mul(10.0));
      const ringLine = float(1.0).sub(smoothstep(0.0, 0.08, ringBand)).mul(0.35);
      const densityCol = mix(color(0x0f172a), color(0x38bdf8), tslClamp(rRatio.sub(0.35), 0.0, 1.0)).add(
        vec3(ringLine),
      );

      let outCol = mix(materialStyled, thermalCol, isThermal);
      outCol = mix(outCol, densityCol, isDensity);
      return outCol.saturate();
    })();

    mat.roughnessNode = matPropsAttr.x;
    mat.metalnessNode = matPropsAttr.y;
    mat.emissiveNode = Fn(() => {
      const crystalGlow = vertexColor().mul(matPropsAttr.z);
      const isThermal = smoothstep(0.5, 1.0, overlayModeNode).mul(
        float(1.0).sub(smoothstep(1.5, 2.0, overlayModeNode)),
      );
      return mix(crystalGlow, computeThermalColor().mul(0.32), isThermal);
    })();

    return mat;
  }

  private setupMaterials(): void {
    this.terrainMaterial = this.createTerrainMaterial([
      { centerView: this.hemiDiscardCenterViewNode, radius: this.hemiDiscardRadiusNode },
      { centerView: this.midOuterDiscardCenterViewNode, radius: this.midOuterDiscardRadiusNode },
      { centerView: this.midDiscardCenterViewNode, radius: this.midDiscardRadiusNode },
      { centerView: this.nativeDiscardCenterViewNode, radius: this.nativeDiscardRadiusNode },
    ]);
    this.highResGlobeMaterial = this.createTerrainMaterial([
      { centerView: this.hemiDiscardCenterViewNode, radius: this.hemiDiscardRadiusNode },
      { centerView: this.midOuterDiscardCenterViewNode, radius: this.midOuterDiscardRadiusNode },
      { centerView: this.midDiscardCenterViewNode, radius: this.midDiscardRadiusNode },
      { centerView: this.nativeDiscardCenterViewNode, radius: this.nativeDiscardRadiusNode },
    ]);
    this.highResHemiMaterial = this.createTerrainMaterial([
      { centerView: this.midOuterDiscardCenterViewNode, radius: this.midOuterDiscardRadiusNode },
      { centerView: this.midDiscardCenterViewNode, radius: this.midDiscardRadiusNode },
      { centerView: this.nativeDiscardCenterViewNode, radius: this.nativeDiscardRadiusNode },
    ]);
    this.highResMidOuterMaterial = this.createTerrainMaterial([
      { centerView: this.midDiscardCenterViewNode, radius: this.midDiscardRadiusNode },
      { centerView: this.nativeDiscardCenterViewNode, radius: this.nativeDiscardRadiusNode },
    ]);
    this.highResMidMaterial = this.createTerrainMaterial([
      { centerView: this.nativeDiscardCenterViewNode, radius: this.nativeDiscardRadiusNode },
    ]);
    this.highResNativeMaterial = this.createTerrainMaterial([]);

    this.waterMaterial = new THREE.MeshPhysicalNodeMaterial();
    this.waterMaterial.colorNode = Fn(() => {
      const p = positionWorld;
      const tAnim = this.simTimeNode;
      const wave1 = sin(p.x.mul(2.4).add(tAnim.mul(2.3)))
        .mul(cos(p.z.mul(2.1).sub(tAnim.mul(1.9))));
      const wave2 = sin(p.y.mul(2.8).sub(tAnim.mul(2.1)))
        .mul(0.5)
        .add(0.5);
      const ripple = wave1.mul(0.5).add(0.5).mul(wave2);
      const deepWater = color(0x0369a1);
      const shallowWater = color(0x22d3ee);
      const viewDir = cameraPosition.sub(p).normalize();
      const fresnel = pow(
        float(1.0).sub(tslClamp(dot(normalWorld, viewDir), 0.0, 1.0)),
        float(2.4),
      );
      const foam = smoothstep(0.78, 0.96, ripple).mul(0.22);
      return mix(deepWater, shallowWater, fresnel.mul(0.75).add(ripple.mul(0.25))).add(
        vec3(foam),
      );
    })();
    this.waterMaterial.roughnessNode = float(0.08);
    this.waterMaterial.metalnessNode = float(0.05);
    this.waterMaterial.clearcoatNode = float(0.92);
    this.waterMaterial.clearcoatRoughnessNode = float(0.06);
    this.waterMaterial.opacityNode = Fn(() => {
      const viewDir = cameraPosition.sub(positionWorld).normalize();
      const fres = pow(
        float(1.0).sub(tslClamp(dot(normalWorld, viewDir), 0.0, 1.0)),
        float(2.2),
      );
      return mix(float(0.76), float(0.95), fres);
    })();
    this.waterMaterial.transparent = true;
    this.waterMaterial.side = THREE.DoubleSide;
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
    this.hemiDiscardRadiusNode.value = 0;
    this.midOuterDiscardRadiusNode.value = 0;
    this.midDiscardRadiusNode.value = 0;
    this.nativeDiscardRadiusNode.value = 0;
    for (const m of this.chunkMeshes) {
      if (m) m.visible = true;
    }
    for (const c of this.planet.sparseChunks.values()) {
      c.dirty = true;
    }
  }

  private updateHighResStreaming(
    hoveredHit: ReturnType<VoxelPlanet['raycastTerrain']> | null,
    budget = 28,
  ): HighResStreamBatch | null {
    void hoveredHit;
    if (!this.planet.isHighResStreaming || !this.highResGroup) {
      if (this.highResMeshes.size > 0) {
        this.clearHighResMeshes();
      }
      return null;
    }

    // Anchor streaming focus to the camera-facing / explorer-facing hemisphere surface
    // (never jump the planet's visible high-res shell to follow cursor hover)
    let fx = 0;
    let fy = 1;
    let fz = 0;
    if (this.config.cameraMode === 'explorer' && (this.phase === 'playing' || this.isGenerating)) {
      const pLen = this.playerPos.length();
      if (pLen > 1e-4) {
        fx = this.playerPos.x / pLen;
        fy = this.playerPos.y / pLen;
        fz = this.playerPos.z / pLen;
      }
    } else if (this.config.cameraMode === 'orbit' && (this.phase === 'playing' || this.isGenerating)) {
      const cosP = Math.cos(this.orbitPitch);
      fx = cosP * Math.cos(this.orbitYaw);
      fy = Math.sin(this.orbitPitch);
      fz = cosP * Math.sin(this.orbitYaw);
    } else if (this.config.cameraMode === 'fps' && (this.phase === 'playing' || this.isGenerating)) {
      const fLen = this.fpsPos.length();
      if (fLen > 1e-4) {
        fx = this.fpsPos.x / fLen;
        fy = this.fpsPos.y / fLen;
        fz = this.fpsPos.z / fLen;
      }
    } else if (this.camera) {
      const cLen = this.camera.position.length();
      if (cLen > 1e-4) {
        fx = this.camera.position.x / cLen;
        fy = this.camera.position.y / cLen;
        fz = this.camera.position.z / cLen;
      }
    }
    const surfR = this.planet.findSurfaceRadiusAlongRay(fx, fy, fz);
    this.lastHighResFocus.set(fx * surfR, fy * surfR, fz * surfR);
    const camDistToFocus = this.camera
      ? this.camera.position.distanceTo(this.lastHighResFocus)
      : this.planet.baseRadius * 2.0;

    const batch = this.planet.streamHighResAround(
      this.lastHighResFocus.x,
      this.lastHighResFocus.y,
      this.lastHighResFocus.z,
      this.config.terrainRenderMode,
      budget,
      camDistToFocus,
    );

    if (!batch.active) {
      if (this.highResMeshes.size > 0) this.clearHighResMeshes();
      return batch;
    }

    // Evict stale meshes outside active window
    for (const [key, mesh] of this.highResMeshes.entries()) {
      if (!batch.desiredKeys.has(key)) {
        this.highResGroup.remove(mesh);
        mesh.geometry.dispose();
        this.highResMeshes.delete(key);
      }
    }

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

      if (existing) {
        existing.geometry.dispose();
        existing.geometry = geo;
        existing.material = targetMat;
        existing.position.set(ox, oy, oz);
      } else {
        const mesh = new THREE.Mesh(geo, targetMat);
        mesh.position.set(ox, oy, oz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.highResGroup.add(mesh);
        this.highResMeshes.set(item.key, mesh);
      }
    }

    const showMacro = !batch.hideMacro;
    for (const m of this.chunkMeshes) {
      if (m) m.visible = showMacro;
    }

    this.hemiDiscardCenterWorld.set(
      batch.hemiCenter[0],
      batch.hemiCenter[1],
      batch.hemiCenter[2],
    );
    this.hemiDiscardRadiusNode.value = batch.hemiDiscardRadius;

    this.midOuterDiscardCenterWorld.set(
      batch.midOuterCenter[0],
      batch.midOuterCenter[1],
      batch.midOuterCenter[2],
    );
    this.midOuterDiscardRadiusNode.value = batch.midOuterDiscardRadius;

    this.midDiscardCenterWorld.set(
      batch.midCenter[0],
      batch.midCenter[1],
      batch.midCenter[2],
    );
    this.midDiscardRadiusNode.value = batch.midDiscardRadius;

    this.nativeDiscardCenterWorld.set(
      batch.nativeCenter[0],
      batch.nativeCenter[1],
      batch.nativeCenter[2],
    );
    this.nativeDiscardRadiusNode.value = batch.nativeDiscardRadius;

    this.syncDiscardViewUniforms();

    let verts = 0;
    for (const mesh of this.highResMeshes.values()) {
      verts += mesh.geometry.getAttribute('position').count;
    }
    this.highResVertices = verts;
    this.highResActiveCount = this.highResMeshes.size;
    return batch;
  }

  private setPlanetRigVisible(visible: boolean): void {
    if (this.atmoMesh) this.atmoMesh.visible = visible;
    if (this.atmoInnerMesh) this.atmoInnerMesh.visible = visible;
    if (this.cloudShellMesh) this.cloudShellMesh.visible = visible;
    if (this.cloudPuffsMesh) this.cloudPuffsMesh.visible = visible;
    if (this.waterMesh) this.waterMesh.visible = visible;
    if (this.splashMesh) this.splashMesh.visible = visible;
    if (this.highResGroup) this.highResGroup.visible = visible;
    if (this.playerGroup) {
      this.playerGroup.visible = visible && this.phase !== 'title';
    }
    if (!visible) {
      for (const m of this.chunkMeshes) {
        if (m) m.visible = false;
      }
      if (this.brushPreview) this.brushPreview.visible = false;
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

  private updateChunksWithLod(budget = 14): void {
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

    if (candidates.length === 0) return;
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
        } else {
          const mesh = new THREE.Mesh(geo, this.terrainMaterial);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
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

    this.splashMesh = new THREE.InstancedMesh(dropGeo, dropMat, MAX_FLUID_PARTICLES);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.count = 0;
    this.scene.add(this.splashMesh);
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

    this.playerGroup.visible = this.phase !== 'title';
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

    const dGeo = new THREE.DodecahedronGeometry(0.18, 0);
    const dMat = new THREE.MeshStandardNodeMaterial();
    dMat.colorNode = color(0x94a3b8);
    dMat.roughnessNode = float(0.85);
    this.debrisMesh = new THREE.InstancedMesh(dGeo, dMat, this.MAX_DEBRIS);
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    this.scene.add(this.debrisMesh);
  }

  private spawnDebrisBurst(
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    count = 8,
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
      this.debrisVel[i3] = (nx * (2.5 + Math.random() * 3.0) + (Math.random() - 0.5) * 4.0) * velScale;
      this.debrisVel[i3 + 1] = (ny * (2.5 + Math.random() * 3.0) + (Math.random() - 0.5) * 4.0) * velScale;
      this.debrisVel[i3 + 2] = (nz * (2.5 + Math.random() * 3.0) + (Math.random() - 0.5) * 4.0) * velScale;
      this.debrisLife[i] = 0.85 + Math.random() * 0.55;
    }
  }

  private updateDebris(dt: number): void {
    const params = this.getGravityParams();
    const scale = this.getPlanetScale();
    let active = 0;
    for (let i = 0; i < this.MAX_DEBRIS; i++) {
      const life = this.debrisLife[i];
      if (life <= 0) continue;
      this.debrisLife[i] = life - dt;
      const i3 = i * 3;
      computeGravityVector(
        this.debrisPos[i3],
        this.debrisPos[i3 + 1],
        this.debrisPos[i3 + 2],
        params,
        this._grav,
      );
      this.debrisVel[i3] += this._grav.x * dt;
      this.debrisVel[i3 + 1] += this._grav.y * dt;
      this.debrisVel[i3 + 2] += this._grav.z * dt;
      this.debrisPos[i3] += this.debrisVel[i3] * dt;
      this.debrisPos[i3 + 1] += this.debrisVel[i3 + 1] * dt;
      this.debrisPos[i3 + 2] += this.debrisVel[i3 + 2] * dt;

      const s = clamp(life, 0.05, 1.0) * scale;
      this._v1.set(this.debrisPos[i3], this.debrisPos[i3 + 1], this.debrisPos[i3 + 2]);
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
  }

  public resetPlayerToSpawn(): void {
    const [sx, sy, sz] = this.planet.spawnPosition;
    this.playerPos.set(sx, sy, sz);
    this.playerVel.set(0, 0, 0);
    this.playerUp.copy(this.playerPos).normalize();
    this.playerFwd.set(0, 0, 1);
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

    const scale = this.getPlanetScale();
    this.camYaw = -0.35;
    this.camPitch = 0.36;
    this.camDistance = 9.0 * scale;
    this._v1.set(1, 0, 0);
    if (Math.abs(this.playerUp.x) > 0.85) this._v1.set(0, 0, 1);
    const tangentE = this._v2.crossVectors(this.playerUp, this._v1).normalize();
    const tangentN = this._v3.crossVectors(tangentE, this.playerUp).normalize();
    const horiz = Math.cos(this.camPitch) * this.camDistance;
    const vert = Math.sin(this.camPitch) * this.camDistance + 2.2 * scale;
    this.camPosSmooth
      .copy(this.playerPos)
      .addScaledVector(this.playerUp, vert)
      .addScaledVector(tangentN, Math.cos(this.camYaw) * horiz)
      .addScaledVector(tangentE, Math.sin(this.camYaw) * horiz);
    this.camLookSmooth.copy(this.playerPos).addScaledVector(this.playerUp, 1.25 * scale);
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

  public cancelGeneration(): void {
    this.generationToken++;
    this.isGenerating = false;
  }

  private async prewarmHighResAsync(
    onProgress: (fraction: number, detail: string) => void,
    shouldAbort: () => boolean,
  ): Promise<boolean> {
    if (!this.planet.isHighResStreaming) return true;
    const maxPasses = 64;
    let sliceStart = performance.now();
    let initialPending = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      if (shouldAbort()) return false;
      const batch = this.updateHighResStreaming(null, 42);
      if (!batch) break;
      if (pass === 0) {
        initialPending = Math.max(1, batch.pendingTotal + batch.rebuiltMeshes.length);
      }
      if (batch.pendingTotal === 0) break;
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

    const emit = (percent: number, stage: string, detail: string) => {
      if (shouldAbort()) return;
      onProgress?.({
        active: true,
        percent: clamp(Math.round(percent), 0, 100),
        stage,
        detail,
        seed: previewSeed,
        radius: previewRadius,
        voxelRadius: previewVoxelRes,
      });
    };

    try {
      emit(2, '初始化地形参数场', '构建 3D 连续噪声与陨坑上下文');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (shouldAbort()) return false;

      const okVoxel = await this.planet.generatePlanetAsync(
        targetSeed,
        (fraction, detail) => {
          emit(4 + fraction * 36, '合成体素密度场', detail);
        },
        shouldAbort,
      );
      if (!okVoxel || shouldAbort()) return false;

      this.rebuildChunkCenters();
      this.syncScaleDependentRig();
      this.resetPlayerToSpawn();

      const okMesh = await this.rebuildAllChunksAsync((fraction, detail) => {
        emit(40 + fraction * 28, '提取分块等值面几何', detail);
      }, shouldAbort);
      if (!okMesh || shouldAbort()) return false;

      const okFluid = await this.fluid.seedInitialLakesAsync(
        this.planet,
        (fraction, detail) => {
          emit(68 + fraction * 16, '注水与静水压平衡', detail);
        },
        shouldAbort,
      );
      if (!okFluid || shouldAbort()) return false;

      emit(85, '合成地表水体网格', '提取平滑水面与流体粒子');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (shouldAbort()) return false;

      this.rebuildWaterMesh();
      this.updateSplashInstances();

      const okHiRes = await this.prewarmHighResAsync((fraction, detail) => {
        emit(86 + fraction * 13, '构建全视角高分辨率表面', detail);
      }, shouldAbort);
      if (!okHiRes || shouldAbort()) return false;

      this.refreshGravityVisualizer();

      this.hasWorld = true;
      this.setPlanetRigVisible(true);
      this.telemetryTimer = 1;
      emit(100, '星球生成完毕', '进入行星表面工作区');
      return true;
    } finally {
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
    this.hasWorld = true;
    this.setPlanetRigVisible(true);
    this.telemetryTimer = 1;
  }

  public regenerateWithSeed(seedConfig: PlanetSeedConfig): void {
    this.resetPlanet(seedConfig);
  }

  public clearWater(): void {
    this.fluid.clear();
    this.updateSplashInstances();
    this.rebuildWaterMesh();
  }

  public getVoxelStats(): VoxelFormatStats {
    return this.planet.getVoxelStats();
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
    this.hasWorld = true;
    this.setPlanetRigVisible(true);
    this.telemetryTimer = 1;
  }

  public setPhase(phase: GamePhase): void {
    this.phase = phase;
    if (this.playerGroup) {
      this.playerGroup.visible = this.hasWorld && phase !== 'title';
    }
    if (phase !== 'playing') {
      this.keys.clear();
      this.isSculpting = false;
      this.isDraggingOrbit = false;
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
          : 0.0;

    this.atmoEnabledNode.value = atmo.enabled ? 1.0 : 0.0;
    this.atmoDensityNode.value = atmo.surfacePressureAtm;
    this.rayleighNode.value = atmo.rayleighStrength;
    this.mieNode.value = atmo.mieHaze;
    this.cloudCoverNode.value = atmo.cloudCover;
    this.windSpeedNode.value = atmo.windSpeed;
    this.scaleHeightNode.value = Math.max(0.02, atmo.scaleHeightRatio);
    this.greenhouseNode.value = computeGreenhouseBoostC(atmo);

    this.solarRatioNode.value = Math.max(0.0, th.solarIrradiance / 1361.0);
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
      Math.max(0, Math.round(clamp(atmo.cloudCover, 0, 1.3) * 64)),
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

      const puffScale = clamp(atmo.cloudCover * 0.75 + 0.35, 0.3, 1.35) * scale;
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

    const spawnR = surfR + 0.85 * scale;
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
    this.syncPlayerTransform();
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

    this.config = {
      ...this.config,
      ...partial,
      atmosphere: partial.atmosphere
        ? { ...this.config.atmosphere, ...partial.atmosphere }
        : this.config.atmosphere,
      thermal: partial.thermal
        ? { ...this.config.thermal, ...partial.thermal }
        : this.config.thermal,
    };
    this.sound.setMuted(this.config.muted);

    if (prevCamMode !== 'fps' && this.config.cameraMode === 'fps') {
      this.syncFpsPoseFromActiveCamera();
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

    this.syncEnvironmentUniforms();

    if (this.config.terrainRenderMode !== prevRenderMode && this.scene) {
      this.rebuildAllChunks();
      this.rebuildWaterMesh();
    } else if (this.config.lodMode !== prevLodMode && this.scene) {
      this.updateChunksWithLod(this.planet.totalChunks);
    }

    const toolColorMap: Record<BrushMode, number> = {
      carve: 0xf97316,
      build: 0x10b981,
      smooth: 0xa78bfa,
      flatten: 0xfacc15,
      water: 0x38bdf8,
    };
    this.brushColorNode.value.setHex(toolColorMap[this.config.tool]);
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
    if (this.phase === 'playing' && this.config.cameraMode === 'explorer') {
      this.jumpQueued = true;
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
      this.sunLight.position.copy(this.sunDirUniform).multiplyScalar(42 * scale);
      this.sunLight.target.position.set(0, 0, 0);
      this.sunOrbMesh.position.copy(this.sunDirUniform).multiplyScalar(115 * scale);
    }
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
    if (this.isDisposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.phase !== 'playing') return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const code = e.code;
    this.keys.add(code);
    if (code === 'Space' && !e.repeat && this.config.cameraMode === 'explorer') {
      this.jumpQueued = true;
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleWindowBlur = (): void => {
    this.keys.clear();
    this.isSculpting = false;
    this.isDraggingOrbit = false;
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
      const minDist = Math.min(2.0 * scale, minBlockSpan);
      const factor = Math.exp(delta * 0.1);
      this.camDistance = clamp(this.camDistance * factor, minDist, 45.0 * scale);
    } else if (this.config.cameraMode === 'orbit') {
      const floorR = this.planet.baseRadius * 0.85;
      const minClearance = Math.min(3.5 * scale, minBlockSpan);
      const curClearance = Math.max(minClearance, this.orbitDistance - floorR);
      const nextClearance = clamp(
        curClearance * Math.exp(delta * 0.11),
        minClearance,
        120.0 * scale,
      );
      this.orbitDistance = floorR + nextClearance;
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

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.phase !== 'playing') return;
    this.updatePointerNDC(e.clientX, e.clientY);
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (e.pointerType === 'touch') {
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size >= 2) {
        this.isSculpting = false;
        this.isDraggingOrbit = false;
        this.prevPinchDist = this.getPinchDistance();
        return;
      }
      if (this.touchEnabled && this.touchActionMode === 'look') {
        this.isDraggingOrbit = true;
        return;
      }
      const hit = this.raycastFromPointer();
      if (hit.hit) {
        this.isSculpting = true;
        this.brushCooldown = 0;
        this.performBrushAction(hit);
      } else {
        this.isDraggingOrbit = true;
      }
      return;
    }

    if (e.button === 2 || e.altKey) {
      this.isDraggingOrbit = true;
      return;
    }

    if (e.button === 0) {
      const hit = this.raycastFromPointer();
      if (hit.hit) {
        this.isSculpting = true;
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

    if (this.isDraggingOrbit) {
      if (this.config.cameraMode === 'explorer') {
        this.camYaw -= dx * 0.0055;
        this.camPitch = clamp(this.camPitch + dy * 0.005, -0.35, 1.32);
      } else if (this.config.cameraMode === 'orbit') {
        this.orbitYaw -= dx * 0.0055;
        this.orbitPitch = clamp(this.orbitPitch + dy * 0.005, -1.35, 1.35);
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
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this.phase !== 'playing') return;
    e.preventDefault();
    this.applyZoomDelta(e.deltaY * 0.012);
  };

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
    const { tool, brushRadius, brushStrength, material } = this.config;
    const scale = this.getPlanetScale();

    if (tool === 'water') {
      this.fluid.emitStream(
        hit.x,
        hit.y,
        hit.z,
        hit.nx,
        hit.ny,
        hit.nz,
        18,
        brushRadius * 0.65,
        scale,
      );
      this.waterMeshDirty = true;
      this.sound.playWater();
      return;
    }

    const offset = tool === 'build' ? brushRadius * 0.25 : 0;
    const bx = hit.x + hit.nx * offset;
    const by = hit.y + hit.ny * offset;
    const bz = hit.z + hit.nz * offset;

    this.planet.applyBrush(
      bx,
      by,
      bz,
      tool,
      brushRadius,
      brushStrength * 0.72,
      material,
    );
    this.updateChunksWithLod(36);
    this.updateHighResStreaming(hit, 48);
    this.waterMeshDirty = true;

    if (tool === 'carve') {
      this.spawnDebrisBurst(bx, by, bz, hit.nx, hit.ny, hit.nz, 6);
      this.sound.playCarve();
    } else {
      this.sound.playBuild();
    }
  }

  private updateExplorerPhysics(dt: number): void {
    const params = this.getGravityParams();
    const scale = this.getPlanetScale();

    this._fwdLike.x = this.playerFwd.x;
    this._fwdLike.y = this.playerFwd.y;
    this._fwdLike.z = this.playerFwd.z;
    parallelTransportTangentFrame(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this._fwdLike,
      this._upLike,
      this._fwdLike,
      this._rightLike,
    );
    this.playerUp.set(this._upLike.x, this._upLike.y, this._upLike.z);
    this.playerFwd.set(this._fwdLike.x, this._fwdLike.y, this._fwdLike.z);
    this.playerRight.set(this._rightLike.x, this._rightLike.y, this._rightLike.z);

    if (this.keys.has('KeyQ')) this.camYaw += 1.9 * dt;
    if (this.keys.has('KeyE')) this.camYaw -= 1.9 * dt;

    let moveF = this.virtualMoveY;
    let moveR = this.virtualMoveX;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveF += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveF -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveR += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveR -= 1;
    moveF = clamp(moveF, -1, 1);
    moveR = clamp(moveR, -1, 1);

    this._v1.copy(this.playerPos).sub(this.camera.position);
    const dotUp = this._v1.dot(this.playerUp);
    this._v1.addScaledVector(this.playerUp, -dotUp);
    if (this._v1.lengthSq() < 1e-5) {
      this._v1.copy(this.playerFwd);
    } else {
      this._v1.normalize();
    }
    this._v2.crossVectors(this._v1, this.playerUp).normalize();

    this._v3.set(0, 0, 0);
    const hasMove = Math.abs(moveF) > 0.02 || Math.abs(moveR) > 0.02;
    if (hasMove) {
      this._v3
        .addScaledVector(this._v1, moveF)
        .addScaledVector(this._v2, moveR);
      const len = this._v3.length();
      if (len > 1) this._v3.divideScalar(len);
      this.playerFwd.lerp(this._v3, 1 - Math.exp(-12 * dt)).normalize();
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
      const jumpSpeed = 7.4 * Math.sqrt(Math.max(0.05, this.config.gravityScale * scale));
      this.playerVel.addScaledVector(this.playerUp, jumpSpeed);
      this.playerGrounded = false;
      this.squashY = 1.24;
      this.sound.playJump();
    }
    this.jumpQueued = false;

    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.virtualUp) {
      const thrust = (EARTH_SURFACE_GRAVITY * this.config.gravityScale + 7.5) * scale * dt;
      this.playerVel.addScaledVector(this.playerUp, thrust);
      this.playerGrounded = false;
    }

    const radialSpeed = this.playerVel.dot(this.playerUp);
    this._v4.copy(this.playerVel).addScaledVector(this.playerUp, -radialSpeed);
    const maxWalkSpeed = 6.2 * scale;
    if (hasMove) {
      this._v4.lerp(
        this._v3.multiplyScalar(maxWalkSpeed),
        1 - Math.exp(-(this.playerGrounded ? 14 : 5) * dt),
      );
      this.walkPhase += (this._v4.length() / Math.max(scale, 0.05)) * dt * 2.2;
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
        this.playerVel.addScaledVector(this._v1, -vn);
        if (!wasGrounded && vn < -2.2 * Math.sqrt(scale)) {
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
    const scale = this.getPlanetScale();
    this.playerGroup.position.copy(this.playerPos);

    this._v1.crossVectors(this.playerFwd, this.playerUp).normalize();
    this._v2.crossVectors(this.playerUp, this._v1).normalize();
    this._m4.makeBasis(this._v1, this.playerUp, this._v2.negate());
    this.playerGroup.quaternion.setFromRotationMatrix(this._m4);

    const invSq = 1 / Math.sqrt(Math.max(0.5, this.squashY));
    this.playerGroup.scale.set(invSq * scale, this.squashY * scale, invSq * scale);

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

    if (this.config.cameraMode === 'fps') {
      this.updateFpsCamera(dt);
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
      this._v1.set(
        this.orbitDistance * cosP * Math.cos(this.orbitYaw),
        this.orbitDistance * Math.sin(this.orbitPitch),
        this.orbitDistance * cosP * Math.sin(this.orbitYaw),
      );
      const damp = 1 - Math.exp(-9 * dt);
      this.camPosSmooth.lerp(this._v1, damp);
      this.camLookSmooth.lerp(this._v2.set(0, 0, 0), damp);
      this.camera.position.copy(this.camPosSmooth);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camLookSmooth);
      return;
    }

    const up = this.playerUp;
    this._v1.set(1, 0, 0);
    if (Math.abs(up.x) > 0.85) this._v1.set(0, 0, 1);
    const tangentE = this._v2.crossVectors(up, this._v1).normalize();
    const tangentN = this._v3.crossVectors(tangentE, up).normalize();

    const horiz = Math.cos(this.camPitch) * this.camDistance;
    const shoulderLift = Math.min(
      2.2 * scale,
      Math.max(this.planet.nativeVoxelSize * 1.5, this.camDistance * 0.25),
    );
    const vert = Math.sin(this.camPitch) * this.camDistance + shoulderLift;

    const desiredPos = this._v4
      .copy(this.playerPos)
      .addScaledVector(up, vert)
      .addScaledVector(tangentN, Math.cos(this.camYaw) * horiz)
      .addScaledVector(tangentE, Math.sin(this.camYaw) * horiz);

    const lookLift = Math.min(
      1.25 * scale,
      Math.max(this.planet.nativeVoxelSize * 2.0, this.camDistance * 0.2),
    );
    const desiredLook = this._v1.copy(this.playerPos).addScaledVector(up, lookLift);

    const damp = 1 - Math.exp(-10 * dt);
    this.camPosSmooth.lerp(desiredPos, damp);
    this.camLookSmooth.lerp(desiredLook, damp);

    this.camera.position.copy(this.camPosSmooth);
    this.camera.up.lerp(up, 1 - Math.exp(-8 * dt)).normalize();
    this.camera.lookAt(this.camLookSmooth);
  }

  private scheduleNextFrame(): void {
    if (this.isDisposed) return;
    if (this.isSoftware) {
      this.timerHandle = window.setTimeout(() => {
        this.frameHandle = requestAnimationFrame(this.tick);
      }, 60);
    } else {
      this.frameHandle = requestAnimationFrame(this.tick);
    }
  }

  private tick = (): void => {
    if (this.isDisposed) return;

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
      this.titleAngle += dt * 0.08;
      if (this.starPoints) {
        this.starPoints.rotation.y = this.titleAngle * 0.12;
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
      this.renderer.render(this.scene, this.camera);
      this.scheduleNextFrame();
      return;
    }

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
      if (simActive && this.config.cameraMode === 'explorer') {
        this.updateExplorerPhysics(dt);
      }

      // Live brush hover preview, voxel probe & sculpting (works even when simulation is paused!)
      if (this.pointerActive) {
        hoveredHit = this.raycastFromPointer();
        if (hoveredHit.hit) {
          this.brushPreview.visible = true;
          this.brushPreview.position.set(hoveredHit.x, hoveredHit.y, hoveredHit.z);
          this.brushPreview.scale.setScalar(this.config.brushRadius);
          if (this.isSculpting) {
            this.brushCooldown -= dt;
            if (this.brushCooldown <= 0) {
              this.performBrushAction(hoveredHit);
              this.brushCooldown = 0.075;
            }
          }
        } else {
          this.brushPreview.visible = false;
        }
      }

      if (simActive) {
        const simT0 = performance.now();
        const gravParams = this.getGravityParams();
        this.fluid.step(dt, this.planet, gravParams, 2);
        this.updateSplashInstances();

        this.waterRebuildCooldown -= dt;
        if (this.waterRebuildCooldown <= 0 || this.waterMeshDirty) {
          if (this.fluid.activeCount > 0 || this.waterMeshDirty) {
            this.rebuildWaterMesh();
          }
          this.waterRebuildCooldown = this.isSoftware ? 0.16 : 0.07;
        }
        this.updateDebris(dt);
        this.simStepMsSmooth = this.simStepMsSmooth * 0.85 + (performance.now() - simT0) * 0.15;
      } else if (this.waterMeshDirty) {
        this.rebuildWaterMesh();
      }

      if (this.config.debugProbeEnabled && hoveredHit && hoveredHit.hit) {
        this.lastProbe = this.planet.probeVoxelCell(hoveredHit.x, hoveredHit.y, hoveredHit.z);
      }
    } else if (this.phase === 'title') {
      if (this.waterMeshDirty) {
        this.rebuildWaterMesh();
      }
    }

    // Update Camera & Dynamic Chunk LOD transitions + High-Res Sparse Streaming
    this.updateCamera(dt);
    if (this.planet.isHighResStreaming) {
      const camR = this.camera.position.length();
      const surfDist = Math.max(
        this.planet.nativeVoxelSize * 0.25,
        Math.abs(camR - this.planet.baseRadius),
      );
      const focusDist = Math.max(
        this.planet.nativeVoxelSize * 0.5,
        this.camera.position.distanceTo(this.lastHighResFocus),
      );
      const targetNear = clamp(
        Math.min(0.15 * scale, surfDist * 0.12, focusDist * 0.08),
        Math.max(1e-9 * scale, this.planet.nativeVoxelSize * 0.25),
        0.15 * scale,
      );
      if (Math.abs(this.camera.near - targetNear) / Math.max(this.camera.near, 1e-10) > 0.15) {
        this.camera.near = targetNear;
        this.camera.updateProjectionMatrix();
      }
    }
    this.updateChunksWithLod(this.isSoftware ? 8 : 14);
    this.updateHighResStreaming(hoveredHit, this.isSoftware ? 16 : 28);
    this.syncDiscardViewUniforms();
    if (this.config.showChunkBounds && this.chunkBoundsDirty) {
      this.refreshChunkBoundsOverlay();
    }

    this.renderer.render(this.scene, this.camera);

    // Throttled telemetry emission (~8Hz)
    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.12) {
      this.telemetryTimer = 0;
      const refPos =
        this.config.cameraMode === 'fps' ? this.fpsPos : this.playerPos;
      const r = refPos.length();
      const params = this.getGravityParams();
      const isWebGPU = Boolean(
        (this.renderer.backend as { isWebGPUBackend?: boolean } | undefined)
          ?.isWebGPUBackend,
      );

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
      );
      const sph = dirToLonLat(refPos.x, refPos.y, refPos.z);

      this.onTelemetry({
        altitude: r - this.planet.baseRadius,
        localGravity: computeGravityMagnitude(r, params),
        escapeVelocity: computeEscapeVelocity(r, params),
        waterParticles: this.fluid.activeCount,
        terrainVertices: this.totalTerrainVertices + this.highResVertices,
        backend: isWebGPU ? 'WebGPU' : 'WebGL2',
        grounded: this.playerGrounded,
        cameraMode: this.config.cameraMode,
        fps: Math.round(this.fpsSmooth),
        frameTimeMs: Number(this.frameTimeSmooth.toFixed(1)),
        simStepMs: Number(this.simStepMsSmooth.toFixed(2)),
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
      });
    }

    this.scheduleNextFrame();
  };

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameHandle);
    clearTimeout(this.timerHandle);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);

    if (this.renderer) {
      const dom = this.renderer.domElement;
      dom.removeEventListener('pointerdown', this.handlePointerDown);
      dom.removeEventListener('wheel', this.handleWheel);
      dom.removeEventListener('contextmenu', this.handleContextMenu);
      dom.remove();
      this.renderer.dispose();
    }
  }
}
