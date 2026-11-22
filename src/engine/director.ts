import { computeDetailCameraOptics, transportCameraForwardOnSphere } from './cameraMath';
import { MaterialId } from './voxelPlanet';
import {
  createDefaultDirectorQuality,
  DirectorQualitySettings,
} from './renderQuality';

export type DirectorActionType =
  | 'micro_to_planet'
  | 'planet_to_micro'
  | 'orbit_360'
  | 'spiral_reveal'
  | 'surface_flyover'
  | 'keyframe_path'
  | 'static_hold';

export type DirectorExportFormat = 'webm-vp9' | 'webm-vp8' | 'png-tar';

export type ScreenshotFormat = 'png' | 'webp' | 'jpeg';

export type CubicBezier4 = [number, number, number, number];

export type CameraInterpMode = 'catmull_rom' | 'linear' | 'hold';

export type DirectorWorldEventType =
  | 'volcano'
  | 'nuke'
  | 'crater'
  | 'meteorShower'
  | 'waterFlood'
  | 'drain'
  | 'tractorBurst'
  | 'thermalHotspot'
  | 'terraformMaterial';

export type DirectorLutPreset =
  | 'natural'
  | 'cinema_teal_orange'
  | 'sci_fi_cyan'
  | 'noir_high_contrast'
  | 'solar_amber'
  | 'thermal_falsecolor';

export type DirectorAspectMask = 'none' | '2.39:1' | '16:9' | '9:16';

export type DirectorVisualFilter =
  | 'none'
  | 'constructivism'
  | 'minimalism'
  | 'compound_eye'
  | 'integral'
  | 'halftone';

export type DirectorParamId =
  | 'cloudCoverage'
  | 'cloudAltitudeRatio'
  | 'solarIntensity'
  | 'sunElevationDeg'
  | 'sunAzimuthDeg'
  | 'waterVolume'
  | 'atmoDensity'
  | 'scatterStrength'
  | 'windSpeed'
  | 'tempOffsetC'
  | 'cameraFovDeg'
  | 'cameraRollDeg'
  | 'cameraShakeAmp'
  | 'exposure'
  | 'contrast'
  | 'saturation'
  | 'bloomStrength'
  | 'vignette'
  | 'filmGrain'
  | 'filterIntensity'
  | 'filterScale';

export interface DirectorParamKeyframe {
  id: string;
  timeSec: number;
  value: number;
  easing: CubicBezier4;
}

export type DirectorParamTracksMap = Partial<Record<DirectorParamId, DirectorParamKeyframe[]>>;

export interface DirectorParamMeta {
  id: DirectorParamId;
  label: string;
  unit: string;
  category: 'env' | 'camera' | 'postfx';
  min: number;
  max: number;
  step: number;
  colorHex: string;
}

export const PARAM_TRACK_META: ReadonlyArray<DirectorParamMeta> = [
  { id: 'cloudCoverage', label: '云层覆盖密度', unit: '', category: 'env', min: 0, max: 2.0, step: 0.02, colorHex: '#e2e8f0' },
  { id: 'solarIntensity', label: '太阳光强亮度', unit: '×', category: 'env', min: 0.05, max: 4.5, step: 0.05, colorHex: '#fbbf24' },
  { id: 'waterVolume', label: '全局液态水量', unit: '×', category: 'env', min: 0.0, max: 2.5, step: 0.05, colorHex: '#38bdf8' },
  { id: 'sunElevationDeg', label: '太阳仰角', unit: '°', category: 'env', min: -15, max: 85, step: 1, colorHex: '#f59e0b' },
  { id: 'sunAzimuthDeg', label: '太阳方位角', unit: '°', category: 'env', min: -360, max: 360, step: 2, colorHex: '#fb923c' },
  { id: 'atmoDensity', label: '大气散射密度', unit: 'atm', category: 'env', min: 0, max: 2.5, step: 0.05, colorHex: '#60a5fa' },
  { id: 'scatterStrength', label: '瑞利散射强度', unit: '×', category: 'env', min: 0, max: 3.0, step: 0.05, colorHex: '#818cf8' },
  { id: 'cloudAltitudeRatio', label: '云层高度比', unit: 'R₀', category: 'env', min: 0.04, max: 0.45, step: 0.01, colorHex: '#cbd5e1' },
  { id: 'windSpeed', label: '大气风速倍率', unit: '×', category: 'env', min: 0, max: 5.0, step: 0.1, colorHex: '#2dd4bf' },
  { id: 'tempOffsetC', label: '温度偏移基准', unit: '°C', category: 'env', min: -80, max: 80, step: 1, colorHex: '#f87171' },
  { id: 'cameraFovDeg', label: '镜头视角 FOV', unit: '°', category: 'camera', min: 10, max: 105, step: 0.5, colorHex: '#22d3ee' },
  { id: 'cameraRollDeg', label: '荷兰倾角 Roll', unit: '°', category: 'camera', min: -45, max: 45, step: 0.5, colorHex: '#06b6d4' },
  { id: 'cameraShakeAmp', label: '手持震动强度', unit: '', category: 'camera', min: 0, max: 3.0, step: 0.05, colorHex: '#67e8f9' },
  { id: 'exposure', label: '曝光增益', unit: '', category: 'postfx', min: 0.35, max: 2.5, step: 0.02, colorHex: '#34d399' },
  { id: 'contrast', label: '对比度', unit: '', category: 'postfx', min: 0.5, max: 2.0, step: 0.02, colorHex: '#10b981' },
  { id: 'saturation', label: '色彩饱和度', unit: '', category: 'postfx', min: 0.0, max: 2.2, step: 0.02, colorHex: '#4ade80' },
  { id: 'bloomStrength', label: '辉光 Bloom', unit: '', category: 'postfx', min: 0.0, max: 1.6, step: 0.02, colorHex: '#a3e635' },
  { id: 'vignette', label: '镜头暗角', unit: '', category: 'postfx', min: 0.0, max: 0.9, step: 0.02, colorHex: '#6ee7b7' },
  { id: 'filmGrain', label: '胶片颗粒', unit: '', category: 'postfx', min: 0.0, max: 0.3, step: 0.005, colorHex: '#86efac' },
  { id: 'filterIntensity', label: '视觉滤镜强度', unit: '', category: 'postfx', min: 0.0, max: 1.0, step: 0.02, colorHex: '#c084fc' },
  { id: 'filterScale', label: '视觉滤镜尺度', unit: '×', category: 'postfx', min: 0.25, max: 3.0, step: 0.05, colorHex: '#e879f9' },
];

export const VISUAL_FILTER_META: ReadonlyArray<{
  id: DirectorVisualFilter;
  modeIndex: number;
  label: string;
  shortLabel: string;
  desc: string;
}> = [
  { id: 'none', modeIndex: 0, label: '原始光学 (None)', shortLabel: '原始光学', desc: '关闭风格化滤镜，呈现纯粹物理光学渲染' },
  { id: 'constructivism', modeIndex: 1, label: '构成主义 (Constructivism)', shortLabel: '构成主义', desc: '先锋派几何色块海报色调、斜向结构排线与高反差油墨轮廓' },
  { id: 'minimalism', modeIndex: 2, label: '极简化 (Minimalism)', shortLabel: '极简化', desc: '高净度平滑均色分层、极简建筑留白与纤细地平线轮廓' },
  { id: 'compound_eye', modeIndex: 3, label: '昆虫复眼 (Compound Eye)', shortLabel: '复眼', desc: '六边形微透镜阵列折射、独立小眼视角采样与棱镜色散' },
  { id: 'integral', modeIndex: 4, label: '光学积分 (Integral)', shortLabel: '积分', desc: '帧间时间光积分与方位轨迹累积长曝光拖尾特效' },
  { id: 'halftone', modeIndex: 5, label: '印刷网点 (Halftone)', shortLabel: '网点', desc: '波普网屏网点矩阵与出版级网格色彩分色' },
];

export interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RESOLUTION_PRESETS: ReadonlyArray<ResolutionPreset> = [
  { id: '720p', label: 'HD 720p', width: 1280, height: 720 },
  { id: '1080p', label: 'FHD 1080p', width: 1920, height: 1080 },
  { id: '1440p', label: '2K QHD', width: 2560, height: 1440 },
  { id: '4k', label: '4K UHD', width: 3840, height: 2160 },
  { id: '6k', label: '6K UHD (16:9)', width: 5760, height: 3240 },
  { id: '6k-dci', label: '6K DCI (16:9)', width: 6144, height: 3456 },
  { id: '8k', label: '8K UHD', width: 7680, height: 4320 },
];

export const FPS_PRESETS: ReadonlyArray<number> = [24, 30, 60, 120, 165, 240];

export const EASING_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  bezier: CubicBezier4;
}> = [
  { id: 'linear', label: '线性 Linear', bezier: [0.0, 0.0, 1.0, 1.0] },
  { id: 'ease_in_out', label: '缓入缓出 Sine', bezier: [0.42, 0.0, 0.58, 1.0] },
  { id: 'expo_snap', label: '指数锐进 Expo', bezier: [0.16, 1.0, 0.3, 1.0] },
  { id: 'ease_in_cubic', label: '蓄力推入 CubicIn', bezier: [0.55, 0.055, 0.675, 0.19] },
  { id: 'overshoot', label: '电影过冲 Overshoot', bezier: [0.34, 1.38, 0.64, 1.0] },
];

export const WORLD_EVENT_META: ReadonlyArray<{
  type: DirectorWorldEventType;
  label: string;
  colorHex: string;
  defaultDurationSec: number;
  desc: string;
}> = [
  {
    type: 'volcano',
    label: '火山喷发',
    colorHex: '#f97316',
    defaultDurationSec: 1.5,
    desc: '在指定经纬度抬升火山锥体、喷射熔岩并加热周边大气',
  },
  {
    type: 'nuke',
    label: '核爆冲击',
    colorHex: '#f43f5e',
    defaultDurationSec: 1.2,
    desc: '触发强冲击波、辐射环形坑、高温气化水体与炽热火球',
  },
  {
    type: 'crater',
    label: '陨石撞击坑',
    colorHex: '#eab308',
    defaultDurationSec: 0.6,
    desc: '瞬间形成深层撞击陨石坑与碎屑喷溅环',
  },
  {
    type: 'meteorShower',
    label: '流星雨轰炸',
    colorHex: '#fb923c',
    defaultDurationSec: 2.8,
    desc: '多波次高空陨石俯冲砸向目标半球区域',
  },
  {
    type: 'waterFlood',
    label: '洪水注水',
    colorHex: '#06b6d4',
    defaultDurationSec: 2.0,
    desc: '在选定坐标高流量倾泻体素水粒子形成江河湖泊',
  },
  {
    type: 'drain',
    label: '地陷抽水',
    colorHex: '#38bdf8',
    defaultDurationSec: 1.4,
    desc: '瞬间抽干指定半径内的积水或海洋盆地',
  },
  {
    type: 'tractorBurst',
    label: '引力束扰动',
    colorHex: '#22d3ee',
    defaultDurationSec: 1.8,
    desc: '对目标点附近水域及碎屑施加引力拖拽与抛射脉冲',
  },
  {
    type: 'thermalHotspot',
    label: '地热异常点',
    colorHex: '#ef4444',
    defaultDurationSec: 2.5,
    desc: '激活局地高能热柱，形成对流与热力温度场梯度',
  },
  {
    type: 'terraformMaterial',
    label: '地貌重塑铺层',
    colorHex: '#10b981',
    defaultDurationSec: 1.0,
    desc: '以指定地质材质重塑该区高程或铺设结晶/玄武岩层',
  },
];

export const LUT_PRESET_META: ReadonlyArray<{
  id: DirectorLutPreset;
  label: string;
  desc: string;
}> = [
  { id: 'natural', label: '标准光学 Natural', desc: '忠实呈现物理太阳光谱与地表漫反射色彩' },
  { id: 'cinema_teal_orange', label: '影院青橙 Teal&Orange', desc: '高光暖琥珀与阴影青蓝分离，典型科幻大片风格' },
  { id: 'sci_fi_cyan', label: '深空冷青 Sci-Fi Cyan', desc: '强化大气瑞利冷调、星际寒光与硬朗反差' },
  { id: 'noir_high_contrast', label: '高反差硬核 Noir', desc: '深邃暗部与压缩饱和度，突出几何体素轮廓' },
  { id: 'solar_amber', label: '炽阳鎏金 Solar Amber', desc: '暖金黄昏滤镜，强化夕阳散射与火山熔岩辉光' },
  { id: 'thermal_falsecolor', label: '科学热成像 FalseColor', desc: '实验室光谱映射，放大亮度与热工层视觉对比' },
];

export interface DirectorActionMeta {
  id: DirectorActionType;
  label: string;
  desc: string;
}

export const DIRECTOR_ACTIONS: ReadonlyArray<DirectorActionMeta> = [
  {
    id: 'micro_to_planet',
    label: '从最小体素缩放到星球',
    desc: '对数曲线从 1:1 极微体素表面平滑拉升至全星球太空全景',
  },
  {
    id: 'planet_to_micro',
    label: '星球深空俯冲至最小体素',
    desc: '从太空港视角高速切入，精准定格到最小原生体素方块',
  },
  {
    id: 'orbit_360',
    label: '环绕星球一圈 (360°)',
    desc: '沿平滑球面轨道环绕整颗星球完整巡航旋转并可配俯仰波浪',
  },
  {
    id: 'spiral_reveal',
    label: '螺旋拉升展露全貌',
    desc: '贴近地表低空螺旋切入并同时抬升高度展示火山、海洋与大气',
  },
  {
    id: 'surface_flyover',
    label: '低空大圆贴地掠过',
    desc: '沿行星表面大圆航线贴地滑翔，随地形起伏保持低空安全高度',
  },
  {
    id: 'keyframe_path',
    label: '多机位关键帧串场',
    desc: '根据手动记录的多个相机机位（位置/朝向/FOV）平滑插值运镜',
  },
  {
    id: 'static_hold',
    label: '当前机位定格延时',
    desc: '锁定当前摄像机机位，离线渲染高帧率水流、大气云层与日照变化',
  },
];

export interface DirectorKeyframe {
  id: string;
  label: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  up: [number, number, number];
  fovDeg: number;
}

export interface DirectorCameraKeyframe extends DirectorKeyframe {
  timeSec: number;
  focusDist: number;
  aperture: number;
  rollDeg: number;
  shakeAmp: number;
  shakeFreq: number;
  interpMode: CameraInterpMode;
  easing: CubicBezier4;
}

export interface DirectorEnvKeyframe {
  id: string;
  timeSec: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  solarIntensity?: number;
  atmoDensity: number;
  scatterStrength: number;
  cloudCoverage: number;
  cloudAltitudeRatio: number;
  windSpeed: number;
  tempOffsetC: number;
  waterVolume?: number;
  easing: CubicBezier4;
}

export interface DirectorWorldEvent {
  id: string;
  label: string;
  type: DirectorWorldEventType;
  latDeg: number;
  lonDeg: number;
  triggerTimeSec: number;
  durationSec: number;
  radiusMult: number;
  strength: number;
  materialId: MaterialId;
  enabled: boolean;
}

export interface DirectorPostFxKeyframe {
  id: string;
  timeSec: number;
  lutPreset: DirectorLutPreset;
  lutIntensity: number;
  exposure: number;
  contrast: number;
  saturation: number;
  bloomStrength: number;
  vignette: number;
  filmGrain: number;
  chromaticAberration: number;
  aspectMask: DirectorAspectMask;
  visualFilter?: DirectorVisualFilter;
  filterIntensity?: number;
  filterScale?: number;
  easing: CubicBezier4;
}

export interface DirectorShotPlan {
  action: DirectorActionType;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  format: DirectorExportFormat;
  /** Multiplier on planet nativeVoxelSize for closest zoom distance */
  microStartVoxelMult: number;
  /** Multiplier on planet baseRadius for wide orbital distance */
  planetEndDistMult: number;
  /** Total azimuth sweep in degrees (360 = 1 full orbit, 720 = 2 full orbits) */
  orbitSweepDeg: number;
  /** Orbital inclination / base elevation angle in degrees */
  orbitElevationDeg: number;
  /** Sinusoidal latitude wave amplitude in degrees during orbit */
  orbitWaveDeg: number;
  /** Base perspective FOV in degrees */
  baseFovDeg: number;
  /** Physics/fluid/cloud simulation speed multiplier during render (0 = frozen) */
  simTimeScale: number;
  /** Solar azimuth sweep in degrees over shot duration */
  sunSweepDeg: number;
  /** Hide editor gizmos/crosshair/reticles in captured output */
  cleanFrame: boolean;
  /** Force LOD0 highest voxel sharpness while rendering */
  forceMaxVoxelDetail: boolean;
  /** Offline quality override settings ("trade time for quality") */
  offlineQuality?: DirectorQualitySettings;
  /** User-recorded keyframes for 'keyframe_path' action */
  keyframes: DirectorKeyframe[];
}

export interface DirectorTimelineProject {
  id: string;
  name: string;
  updatedAt: number;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  format: DirectorExportFormat;
  inTimeSec: number;
  outTimeSec: number;
  simTimeScale: number;
  cleanFrame: boolean;
  forceMaxVoxelDetail: boolean;
  checkpointIntervalFrames: number;
  offlineQuality: DirectorQualitySettings;
  cameraTrack: DirectorCameraKeyframe[];
  envTrack: DirectorEnvKeyframe[];
  eventTrack: DirectorWorldEvent[];
  postFxTrack: DirectorPostFxKeyframe[];
  paramTracks?: DirectorParamTracksMap;
}

export interface DirectorSceneAnchor {
  baseRadius: number;
  nativeVoxelSize: number;
  /** Locked surface target point in world space (unit normal * surfR) */
  targetPoint: [number, number, number];
  /** Outward surface normal at targetPoint */
  targetNormal: [number, number, number];
  /** Live camera pose at shot start (used as fallback or for static_hold / orbit seed) */
  currentPos: [number, number, number];
  currentLookAt: [number, number, number];
  currentUp: [number, number, number];
  currentFovDeg: number;
  /** Optional terrain height lookup along a radial unit direction */
  sampleSurfaceRadius?: (dx: number, dy: number, dz: number) => number;
}

export interface DirectorCameraPose {
  position: [number, number, number];
  lookAt: [number, number, number];
  up: [number, number, number];
  fovDeg: number;
  /** World-space focus point used for SVO chunk streaming */
  streamFocus: [number, number, number];
  /** Effective viewing distance passed to SVO chunk streaming */
  streamDist: number;
  /** Relative solar azimuth rotation in degrees */
  sunAzimuthDeltaDeg: number;
  focusDist?: number;
  aperture?: number;
  rollDeg?: number;
}

export interface EvaluatedEnvState {
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  solarIntensity: number;
  atmoDensity: number;
  scatterStrength: number;
  cloudCoverage: number;
  cloudAltitudeRatio: number;
  windSpeed: number;
  tempOffsetC: number;
  waterVolume: number | null;
}

export interface EvaluatedPostFxState {
  lutPreset: DirectorLutPreset;
  lutIntensity: number;
  exposure: number;
  contrast: number;
  saturation: number;
  bloomStrength: number;
  vignette: number;
  filmGrain: number;
  chromaticAberration: number;
  aspectMask: DirectorAspectMask;
  visualFilter: DirectorVisualFilter;
  filterIntensity: number;
  filterScale: number;
}

export interface RgbHistogramBins {
  bins: number;
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
  meanLuma: number;
  alphaMin: number;
  clipHighPct: number;
  clipLowPct: number;
}

export interface DirectorRenderProgress {
  jobId?: string;
  frame: number;
  totalFrames: number;
  completedInRange?: number;
  rangeTotal?: number;
  percent: number;
  elapsedSec: number;
  etaSec: number;
  frameRenderMs?: number;
  actualWidth: number;
  actualHeight: number;
  encoderLabel: string;
  statusText: string;
  previewDataUrl?: string;
  histogram?: RgbHistogramBins;
  meanLuma?: number;
  alphaMin?: number;
  checkpointSaved?: boolean;
}

export function createDefaultDirectorPlan(): DirectorShotPlan {
  return {
    action: 'micro_to_planet',
    width: 5760,
    height: 3240,
    fps: 165,
    durationSec: 6,
    format: 'webm-vp9',
    microStartVoxelMult: 2.0,
    planetEndDistMult: 2.75,
    orbitSweepDeg: 360,
    orbitElevationDeg: 22,
    orbitWaveDeg: 14,
    baseFovDeg: 52,
    simTimeScale: 1.0,
    sunSweepDeg: 35,
    cleanFrame: true,
    forceMaxVoxelDetail: true,
    offlineQuality: createDefaultDirectorQuality(),
    keyframes: [],
  };
}

export function createDefaultDirectorProject(
  anchor?: Partial<DirectorSceneAnchor>,
  seedTag?: number,
): DirectorTimelineProject {
  const R = anchor?.baseRadius ?? 13;
  const startPos: [number, number, number] = anchor?.currentPos ?? [R * 1.4, R * 1.15, R * 1.8];
  const startLook: [number, number, number] = anchor?.currentLookAt ?? [0, 0, 0];
  const startUp: [number, number, number] = anchor?.currentUp ?? [0, 1, 0];
  const startFov = anchor?.currentFovDeg ?? 52;
  const durationSec = 8;

  return {
    id: `proj_${Date.now().toString(36)}`,
    name: seedTag ? `行星 #${seedTag} 主剪辑工程` : 'TerraSphere 主时间轴工程',
    updatedAt: Date.now(),
    durationSec,
    fps: 60,
    width: 1920,
    height: 1080,
    format: 'webm-vp9',
    inTimeSec: 0,
    outTimeSec: durationSec,
    simTimeScale: 1.0,
    cleanFrame: true,
    forceMaxVoxelDetail: true,
    checkpointIntervalFrames: 24,
    offlineQuality: createDefaultDirectorQuality(),
    cameraTrack: [
      {
        id: 'cam_kf_0',
        label: '起始机位',
        timeSec: 0,
        position: [...startPos],
        lookAt: [...startLook],
        up: [...startUp],
        fovDeg: startFov,
        focusDist: Math.max(1, Math.hypot(startPos[0] - startLook[0], startPos[1] - startLook[1], startPos[2] - startLook[2])),
        aperture: 2.8,
        rollDeg: 0,
        shakeAmp: 0,
        shakeFreq: 4,
        interpMode: 'catmull_rom',
        easing: [0.42, 0, 0.58, 1],
      },
      {
        id: 'cam_kf_end',
        label: '全景落幅',
        timeSec: durationSec,
        position: [-startPos[2] * 1.15, startPos[1] * 1.18, startPos[0] * 1.15],
        lookAt: [0, 0, 0],
        up: [0, 1, 0],
        fovDeg: 48,
        focusDist: R * 2.5,
        aperture: 4.0,
        rollDeg: 0,
        shakeAmp: 0,
        shakeFreq: 4,
        interpMode: 'catmull_rom',
        easing: [0.42, 0, 0.58, 1],
      },
    ],
    envTrack: [
      {
        id: 'env_kf_0',
        timeSec: 0,
        sunElevationDeg: 28,
        sunAzimuthDeg: 28,
        solarIntensity: 1.0,
        atmoDensity: 1.0,
        scatterStrength: 1.0,
        cloudCoverage: 0.48,
        cloudAltitudeRatio: 0.16,
        windSpeed: 1.0,
        tempOffsetC: 0,
        easing: [0.0, 0.0, 1.0, 1.0],
      },
      {
        id: 'env_kf_end',
        timeSec: durationSec,
        sunElevationDeg: 18,
        sunAzimuthDeg: 78,
        solarIntensity: 1.0,
        atmoDensity: 1.05,
        scatterStrength: 1.1,
        cloudCoverage: 0.55,
        cloudAltitudeRatio: 0.16,
        windSpeed: 1.15,
        tempOffsetC: 0,
        easing: [0.42, 0.0, 0.58, 1.0],
      },
    ],
    eventTrack: [],
    postFxTrack: [
      {
        id: 'pfx_kf_0',
        timeSec: 0,
        lutPreset: 'natural',
        lutIntensity: 0.85,
        exposure: 1.12,
        contrast: 1.04,
        saturation: 1.05,
        bloomStrength: 0.34,
        vignette: 0.18,
        filmGrain: 0.02,
        chromaticAberration: 0.0,
        aspectMask: 'none',
        visualFilter: 'none',
        filterIntensity: 0.85,
        filterScale: 1.0,
        easing: [0.42, 0.0, 0.58, 1.0],
      },
    ],
    paramTracks: {},
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function smootherstep01(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  if (len < 1e-8) return [0, 1, 0];
  return [x / len, y / len, z / len];
}

function cross3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lerp3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function catmullRomScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function catmullRom3(
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    catmullRomScalar(p0[0], p1[0], p2[0], p3[0], t),
    catmullRomScalar(p0[1], p1[1], p2[1], p3[1], t),
    catmullRomScalar(p0[2], p1[2], p2[2], p3[2], t),
  ];
}

function sphericalDir(latRad: number, lonRad: number): [number, number, number] {
  const cosL = Math.cos(latRad);
  return [cosL * Math.cos(lonRad), Math.sin(latRad), cosL * Math.sin(lonRad)];
}

function rotateAroundAxis3(
  v: readonly [number, number, number],
  axis: readonly [number, number, number],
  angleRad: number,
): [number, number, number] {
  if (Math.abs(angleRad) < 1e-6) return [v[0], v[1], v[2]];
  const k = normalize3(axis[0], axis[1], axis[2]);
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const kDotV = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const kCrossV = cross3(k, v);
  return normalize3(
    v[0] * cosA + kCrossV[0] * sinA + k[0] * kDotV * (1 - cosA),
    v[1] * cosA + kCrossV[1] * sinA + k[1] * kDotV * (1 - cosA),
    v[2] * cosA + kCrossV[2] * sinA + k[2] * kDotV * (1 - cosA),
  );
}

/**
 * Evaluates a standard cubic-bezier(x1, y1, x2, y2) timing function for normalized x in [0, 1].
 * Supports overshoot control points where y1/y2 may exceed [0, 1].
 */
export function evaluateCubicBezierEasing(
  bezier: CubicBezier4 | undefined,
  tRaw: number,
): number {
  const xTarget = clamp(tRaw, 0, 1);
  if (xTarget <= 0) return 0;
  if (xTarget >= 1) return 1;
  const [x1r, y1, x2r, y2] = bezier ?? [0.42, 0, 0.58, 1];
  const x1 = clamp(x1r, 0, 1);
  const x2 = clamp(x2r, 0, 1);
  if (Math.abs(x1 - y1) < 1e-4 && Math.abs(x2 - y2) < 1e-4) {
    return xTarget;
  }

  const sampleCurveX = (u: number) => {
    const inv = 1 - u;
    return 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
  };
  const sampleCurveDerivX = (u: number) => {
    const inv = 1 - u;
    return 3 * inv * inv * x1 + 6 * inv * u * (x2 - x1) + 3 * u * u * (1 - x2);
  };
  const sampleCurveY = (u: number) => {
    const inv = 1 - u;
    return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
  };

  let u = xTarget;
  for (let i = 0; i < 6; i++) {
    const err = sampleCurveX(u) - xTarget;
    if (Math.abs(err) < 1e-6) break;
    const dx = sampleCurveDerivX(u);
    if (Math.abs(dx) < 1e-6) break;
    u = clamp(u - err / dx, 0, 1);
  }
  // Fallback bisection if Newton stalled
  let lo = 0;
  let hi = 1;
  let errCheck = sampleCurveX(u) - xTarget;
  if (Math.abs(errCheck) > 1e-4) {
    u = xTarget;
    for (let i = 0; i < 16; i++) {
      const xv = sampleCurveX(u);
      errCheck = xv - xTarget;
      if (Math.abs(errCheck) < 1e-5) break;
      if (xv < xTarget) lo = u;
      else hi = u;
      u = 0.5 * (lo + hi);
    }
  }
  return sampleCurveY(u);
}

/**
 * Evaluates exact camera pose and SVO streaming parameters for normalized timeline progress u in [0, 1].
 */
export function evaluateDirectorPose(
  plan: DirectorShotPlan,
  uRaw: number,
  anchor: DirectorSceneAnchor,
): DirectorCameraPose {
  const u = clamp(uRaw, 0, 1);
  const R0 = Math.max(anchor.baseRadius, 0.05);
  const voxel = Math.max(anchor.nativeVoxelSize, 1e-8);
  const baseFov = clamp(plan.baseFovDeg || 52, 18, 110);
  const sunAzimuthDeltaDeg = plan.sunSweepDeg * u;

  const targetN = normalize3(
    anchor.targetNormal[0],
    anchor.targetNormal[1],
    anchor.targetNormal[2],
  );
  const basisAtTarget = transportCameraForwardOnSphere(targetN, [0, 0, -1], 0);
  const targetRight = basisAtTarget.right;

  if (plan.action === 'static_hold') {
    const dist = Math.hypot(
      anchor.currentPos[0] - anchor.currentLookAt[0],
      anchor.currentPos[1] - anchor.currentLookAt[1],
      anchor.currentPos[2] - anchor.currentLookAt[2],
    );
    return {
      position: [...anchor.currentPos],
      lookAt: [...anchor.currentLookAt],
      up: normalize3(anchor.currentUp[0], anchor.currentUp[1], anchor.currentUp[2]),
      fovDeg: clamp(anchor.currentFovDeg || baseFov, 3, 115),
      streamFocus: [...anchor.targetPoint],
      streamDist: Math.max(voxel, dist),
      sunAzimuthDeltaDeg,
    };
  }

  if (plan.action === 'keyframe_path' && plan.keyframes.length >= 2) {
    const kfs = plan.keyframes;
    const segCount = kfs.length - 1;
    const scaled = smootherstep01(u) * segCount;
    const idx = Math.min(segCount - 1, Math.floor(scaled));
    const localT = clamp(scaled - idx, 0, 1);
    const k0 = kfs[Math.max(0, idx - 1)];
    const k1 = kfs[idx];
    const k2 = kfs[Math.min(kfs.length - 1, idx + 1)];
    const k3 = kfs[Math.min(kfs.length - 1, idx + 2)];

    const pos = catmullRom3(k0.position, k1.position, k2.position, k3.position, localT);
    const look = catmullRom3(k0.lookAt, k1.lookAt, k2.lookAt, k3.lookAt, localT);
    const upRaw = catmullRom3(k0.up, k1.up, k2.up, k3.up, localT);
    const fov = clamp(
      catmullRomScalar(k0.fovDeg, k1.fovDeg, k2.fovDeg, k3.fovDeg, localT),
      3,
      115,
    );
    const focusDir = normalize3(look[0], look[1], look[2]);
    const surfR = anchor.sampleSurfaceRadius
      ? anchor.sampleSurfaceRadius(focusDir[0], focusDir[1], focusDir[2])
      : R0;
    const distToTarget = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
    return {
      position: pos,
      lookAt: look,
      up: normalize3(upRaw[0], upRaw[1], upRaw[2]),
      fovDeg: fov,
      streamFocus: [focusDir[0] * surfR, focusDir[1] * surfR, focusDir[2] * surfR],
      streamDist: Math.max(voxel, distToTarget),
      sunAzimuthDeltaDeg,
    };
  }

  if (plan.action === 'micro_to_planet' || plan.action === 'planet_to_micro') {
    const s = plan.action === 'micro_to_planet' ? smootherstep01(u) : 1 - smootherstep01(u);
    const dMin = clamp(
      voxel * Math.max(plan.microStartVoxelMult, 0.8),
      voxel * 0.65,
      R0 * 0.25,
    );
    const dMax = Math.max(R0 * clamp(plan.planetEndDistMult, 1.35, 7.0), dMin * 4);
    const desiredDist = dMin * Math.pow(dMax / dMin, s);
    const optics = computeDetailCameraOptics(desiredDist, R0, voxel, baseFov);

    const centerBlend = smoothstep01((s - 0.32) / 0.58);
    const lookAt = lerp3(anchor.targetPoint, [0, 0, 0], centerBlend);

    const startTiltRad = 0.34;
    const endElevRad = (clamp(plan.orbitElevationDeg, -75, 75) * Math.PI) / 180;
    const sweepRad = (plan.orbitSweepDeg * 0.35 * Math.PI) / 180 * smoothstep01((s - 0.15) / 0.85);

    const startAzimuth = Math.atan2(targetN[2], targetN[0]);
    const startLat = Math.asin(clamp(targetN[1], -0.999, 0.999));

    const microViewDir = normalize3(
      targetN[0] * Math.cos(startTiltRad) - basisAtTarget.forward[0] * Math.sin(startTiltRad),
      targetN[1] * Math.cos(startTiltRad) - basisAtTarget.forward[1] * Math.sin(startTiltRad),
      targetN[2] * Math.cos(startTiltRad) - basisAtTarget.forward[2] * Math.sin(startTiltRad),
    );

    const macroLat = startLat + (endElevRad - startLat) * centerBlend;
    const macroDir = sphericalDir(macroLat, startAzimuth + sweepRad);
    const camDir = normalize3(
      microViewDir[0] + (macroDir[0] - microViewDir[0]) * centerBlend,
      microViewDir[1] + (macroDir[1] - microViewDir[1]) * centerBlend,
      microViewDir[2] + (macroDir[2] - microViewDir[2]) * centerBlend,
    );

    const camDistFromLook = optics.physicalDist + (dMax - optics.physicalDist) * centerBlend;
    const position: [number, number, number] = [
      lookAt[0] + camDir[0] * camDistFromLook,
      lookAt[1] + camDir[1] * camDistFromLook,
      lookAt[2] + camDir[2] * camDistFromLook,
    ];

    const microUp = normalize3(
      basisAtTarget.forward[0] * Math.cos(startTiltRad) + targetN[0] * Math.sin(startTiltRad),
      basisAtTarget.forward[1] * Math.cos(startTiltRad) + targetN[1] * Math.sin(startTiltRad),
      basisAtTarget.forward[2] * Math.cos(startTiltRad) + targetN[2] * Math.sin(startTiltRad),
    );
    const up = normalize3(
      microUp[0] + (0 - microUp[0]) * centerBlend,
      microUp[1] + (1 - microUp[1]) * centerBlend,
      microUp[2] + (0 - microUp[2]) * centerBlend,
    );

    const dotUpDir = Math.abs(up[0] * camDir[0] + up[1] * camDir[1] + up[2] * camDir[2]);
    const safeUp: [number, number, number] =
      dotUpDir > 0.985 ? targetRight : up;

    return {
      position,
      lookAt,
      up: safeUp,
      fovDeg: optics.fovDeg,
      streamFocus: [...anchor.targetPoint],
      streamDist: desiredDist,
      sunAzimuthDeltaDeg,
    };
  }

  if (plan.action === 'orbit_360' || plan.action === 'spiral_reveal') {
    const startAz = Math.atan2(targetN[2], targetN[0]);
    const totalSweepRad = ((plan.orbitSweepDeg || 360) * Math.PI) / 180;
    const theta = startAz + totalSweepRad * u;

    const baseElevRad = (clamp(plan.orbitElevationDeg, -75, 75) * Math.PI) / 180;
    const waveRad = (clamp(plan.orbitWaveDeg, 0, 55) * Math.PI) / 180;
    const latRad = clamp(
      plan.action === 'spiral_reveal'
        ? (-0.15 + 0.65 * smootherstep01(u)) + Math.sin(u * Math.PI * 2) * waveRad * 0.4
        : baseElevRad + Math.sin(u * Math.PI * 2) * waveRad,
      -1.32,
      1.32,
    );

    const dist =
      plan.action === 'spiral_reveal'
        ? R0 * (1.24 + (clamp(plan.planetEndDistMult, 1.4, 7.0) - 1.24) * smootherstep01(u))
        : R0 * clamp(plan.planetEndDistMult, 1.25, 7.0);

    const dir = sphericalDir(latRad, theta);
    const surfR = anchor.sampleSurfaceRadius
      ? anchor.sampleSurfaceRadius(dir[0], dir[1], dir[2])
      : R0;
    const position: [number, number, number] = [dir[0] * dist, dir[1] * dist, dir[2] * dist];
    const focus: [number, number, number] = [dir[0] * surfR, dir[1] * surfR, dir[2] * surfR];

    return {
      position,
      lookAt: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: baseFov,
      streamFocus: focus,
      streamDist: Math.max(voxel * 2, dist - surfR),
      sunAzimuthDeltaDeg,
    };
  }

  const tangentFwd = basisAtTarget.forward;
  const arcRad = ((clamp(plan.orbitSweepDeg || 160, 15, 720)) * Math.PI) / 180 * u;
  const cosA = Math.cos(arcRad);
  const sinA = Math.sin(arcRad);

  const curDir = normalize3(
    targetN[0] * cosA + tangentFwd[0] * sinA,
    targetN[1] * cosA + tangentFwd[1] * sinA,
    targetN[2] * cosA + tangentFwd[2] * sinA,
  );
  const curFwd = normalize3(
    tangentFwd[0] * cosA - targetN[0] * sinA,
    tangentFwd[1] * cosA - targetN[1] * sinA,
    tangentFwd[2] * cosA - targetN[2] * sinA,
  );

  const surfHere = anchor.sampleSurfaceRadius
    ? anchor.sampleSurfaceRadius(curDir[0], curDir[1], curDir[2])
    : R0;
  const lookDir = normalize3(
    curDir[0] * 0.92 + curFwd[0] * 0.39,
    curDir[1] * 0.92 + curFwd[1] * 0.39,
    curDir[2] * 0.92 + curFwd[2] * 0.39,
  );
  const surfAhead = anchor.sampleSurfaceRadius
    ? anchor.sampleSurfaceRadius(lookDir[0], lookDir[1], lookDir[2])
    : R0;

  const alt = R0 * clamp(plan.planetEndDistMult - 1.0, 0.14, 1.5);
  const camR = Math.max(surfHere, surfAhead) + alt;
  const position: [number, number, number] = [
    curDir[0] * camR,
    curDir[1] * camR,
    curDir[2] * camR,
  ];
  const lookAt: [number, number, number] = [
    lookDir[0] * (surfAhead + alt * 0.15),
    lookDir[1] * (surfAhead + alt * 0.15),
    lookDir[2] * (surfAhead + alt * 0.15),
  ];

  return {
    position,
    lookAt,
    up: curDir,
    fovDeg: clamp(baseFov + 8, 35, 110),
    streamFocus: [lookDir[0] * surfAhead, lookDir[1] * surfAhead, lookDir[2] * surfAhead],
    streamDist: Math.max(voxel * 4, alt * 1.4),
    sunAzimuthDeltaDeg,
  };
}

/**
 * Evaluates the Camera & Lens keyframe track at absolute time `timeSec`.
 */
export function evaluateCameraTrackPose(
  rawTrack: ReadonlyArray<DirectorCameraKeyframe>,
  timeSec: number,
  anchor: DirectorSceneAnchor,
): DirectorCameraPose {
  const R0 = Math.max(anchor.baseRadius, 0.05);
  const voxel = Math.max(anchor.nativeVoxelSize, 1e-8);
  if (rawTrack.length === 0) {
    return {
      position: [...anchor.currentPos],
      lookAt: [...anchor.currentLookAt],
      up: normalize3(anchor.currentUp[0], anchor.currentUp[1], anchor.currentUp[2]),
      fovDeg: clamp(anchor.currentFovDeg || 52, 3, 115),
      streamFocus: [...anchor.targetPoint],
      streamDist: Math.max(
        voxel,
        Math.hypot(
          anchor.currentPos[0] - anchor.currentLookAt[0],
          anchor.currentPos[1] - anchor.currentLookAt[1],
          anchor.currentPos[2] - anchor.currentLookAt[2],
        ),
      ),
      sunAzimuthDeltaDeg: 0,
      focusDist: R0,
      aperture: 2.8,
      rollDeg: 0,
    };
  }

  const kfs = [...rawTrack].sort((a, b) => a.timeSec - b.timeSec);
  const applyModifiers = (
    kfPos: [number, number, number],
    kfLook: [number, number, number],
    kfUp: [number, number, number],
    fovDeg: number,
    focusDist: number,
    aperture: number,
    rollDeg: number,
    shakeAmp: number,
    shakeFreq: number,
  ): DirectorCameraPose => {
    const viewFwd = normalize3(
      kfLook[0] - kfPos[0],
      kfLook[1] - kfPos[1],
      kfLook[2] - kfPos[2],
    );
    let pos = kfPos;
    let look = kfLook;

    if (shakeAmp > 1e-4) {
      const f = Math.max(0.5, shakeFreq);
      const disp = shakeAmp * R0 * 0.015;
      const sx = Math.sin(timeSec * f * 6.283 + 1.1) * disp;
      const sy = Math.cos(timeSec * f * 8.17 + 2.4) * disp * 0.75;
      const sz = Math.sin(timeSec * f * 5.13 + 4.2) * disp;
      pos = [pos[0] + sx, pos[1] + sy, pos[2] + sz];
      look = [look[0] + sx * 0.35, look[1] + sy * 0.35, look[2] + sz * 0.35];
    }

    const rolledUp = rotateAroundAxis3(
      normalize3(kfUp[0], kfUp[1], kfUp[2]),
      viewFwd,
      (rollDeg * Math.PI) / 180,
    );
    const focusDir = normalize3(look[0], look[1], look[2]);
    const surfR = anchor.sampleSurfaceRadius
      ? anchor.sampleSurfaceRadius(focusDir[0], focusDir[1], focusDir[2])
      : R0;
    const dist = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
    return {
      position: pos,
      lookAt: look,
      up: rolledUp,
      fovDeg: clamp(fovDeg, 3, 115),
      streamFocus: [focusDir[0] * surfR, focusDir[1] * surfR, focusDir[2] * surfR],
      streamDist: Math.max(voxel, dist),
      sunAzimuthDeltaDeg: 0,
      focusDist,
      aperture,
      rollDeg,
    };
  };

  if (kfs.length === 1 || timeSec <= kfs[0].timeSec) {
    const k = kfs[0];
    return applyModifiers(
      [...k.position],
      [...k.lookAt],
      [...k.up],
      k.fovDeg,
      k.focusDist,
      k.aperture,
      k.rollDeg,
      k.shakeAmp,
      k.shakeFreq,
    );
  }
  const last = kfs[kfs.length - 1];
  if (timeSec >= last.timeSec) {
    return applyModifiers(
      [...last.position],
      [...last.lookAt],
      [...last.up],
      last.fovDeg,
      last.focusDist,
      last.aperture,
      last.rollDeg,
      last.shakeAmp,
      last.shakeFreq,
    );
  }

  let idx = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (timeSec >= kfs[i].timeSec && timeSec <= kfs[i + 1].timeSec) {
      idx = i;
      break;
    }
  }
  const k1 = kfs[idx];
  const k2 = kfs[idx + 1];
  const span = Math.max(1e-5, k2.timeSec - k1.timeSec);
  const rawLocalT = clamp((timeSec - k1.timeSec) / span, 0, 1);

  if (k1.interpMode === 'hold') {
    return applyModifiers(
      [...k1.position],
      [...k1.lookAt],
      [...k1.up],
      k1.fovDeg,
      k1.focusDist,
      k1.aperture,
      k1.rollDeg,
      k1.shakeAmp,
      k1.shakeFreq,
    );
  }

  const easedT = evaluateCubicBezierEasing(k1.easing, rawLocalT);
  const k0 = kfs[Math.max(0, idx - 1)];
  const k3 = kfs[Math.min(kfs.length - 1, idx + 2)];

  const pos =
    k1.interpMode === 'linear'
      ? lerp3(k1.position, k2.position, easedT)
      : catmullRom3(k0.position, k1.position, k2.position, k3.position, easedT);
  const look =
    k1.interpMode === 'linear'
      ? lerp3(k1.lookAt, k2.lookAt, easedT)
      : catmullRom3(k0.lookAt, k1.lookAt, k2.lookAt, k3.lookAt, easedT);
  const up =
    k1.interpMode === 'linear'
      ? lerp3(k1.up, k2.up, easedT)
      : catmullRom3(k0.up, k1.up, k2.up, k3.up, easedT);
  const fov =
    k1.interpMode === 'linear'
      ? lerp(k1.fovDeg, k2.fovDeg, easedT)
      : catmullRomScalar(k0.fovDeg, k1.fovDeg, k2.fovDeg, k3.fovDeg, easedT);

  return applyModifiers(
    pos,
    look,
    up,
    fov,
    lerp(k1.focusDist, k2.focusDist, easedT),
    lerp(k1.aperture, k2.aperture, easedT),
    lerp(k1.rollDeg, k2.rollDeg, easedT),
    lerp(k1.shakeAmp, k2.shakeAmp, easedT),
    lerp(k1.shakeFreq, k2.shakeFreq, easedT),
  );
}

/**
 * Evaluates the Sun, Atmosphere & Cloud keyframe track at `timeSec`.
 */
export function evaluateEnvironmentTrack(
  rawTrack: ReadonlyArray<DirectorEnvKeyframe>,
  timeSec: number,
  fallback?: Partial<EvaluatedEnvState>,
): EvaluatedEnvState {
  const base: EvaluatedEnvState = {
    sunElevationDeg: fallback?.sunElevationDeg ?? 28,
    sunAzimuthDeg: fallback?.sunAzimuthDeg ?? 28,
    solarIntensity: fallback?.solarIntensity ?? 1.0,
    atmoDensity: fallback?.atmoDensity ?? 1.0,
    scatterStrength: fallback?.scatterStrength ?? 1.0,
    cloudCoverage: fallback?.cloudCoverage ?? 0.48,
    cloudAltitudeRatio: fallback?.cloudAltitudeRatio ?? 0.16,
    windSpeed: fallback?.windSpeed ?? 1.0,
    tempOffsetC: fallback?.tempOffsetC ?? 0,
    waterVolume: fallback?.waterVolume ?? null,
  };
  if (rawTrack.length === 0) return base;
  const kfs = [...rawTrack].sort((a, b) => a.timeSec - b.timeSec);
  if (kfs.length === 1 || timeSec <= kfs[0].timeSec) {
    const k = kfs[0];
    return {
      sunElevationDeg: k.sunElevationDeg,
      sunAzimuthDeg: k.sunAzimuthDeg,
      solarIntensity: k.solarIntensity ?? base.solarIntensity,
      atmoDensity: k.atmoDensity,
      scatterStrength: k.scatterStrength,
      cloudCoverage: clamp(k.cloudCoverage, 0, 2.0),
      cloudAltitudeRatio: k.cloudAltitudeRatio,
      windSpeed: k.windSpeed,
      tempOffsetC: k.tempOffsetC,
      waterVolume: k.waterVolume !== undefined ? k.waterVolume : base.waterVolume,
    };
  }
  const last = kfs[kfs.length - 1];
  if (timeSec >= last.timeSec) {
    return {
      sunElevationDeg: last.sunElevationDeg,
      sunAzimuthDeg: last.sunAzimuthDeg,
      solarIntensity: last.solarIntensity ?? base.solarIntensity,
      atmoDensity: last.atmoDensity,
      scatterStrength: last.scatterStrength,
      cloudCoverage: clamp(last.cloudCoverage, 0, 2.0),
      cloudAltitudeRatio: last.cloudAltitudeRatio,
      windSpeed: last.windSpeed,
      tempOffsetC: last.tempOffsetC,
      waterVolume: last.waterVolume !== undefined ? last.waterVolume : base.waterVolume,
    };
  }

  let idx = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (timeSec >= kfs[i].timeSec && timeSec <= kfs[i + 1].timeSec) {
      idx = i;
      break;
    }
  }
  const a = kfs[idx];
  const b = kfs[idx + 1];
  const span = Math.max(1e-5, b.timeSec - a.timeSec);
  const t = evaluateCubicBezierEasing(a.easing, (timeSec - a.timeSec) / span);
  const wA = a.waterVolume;
  const wB = b.waterVolume;
  const evalWater =
    wA !== undefined && wB !== undefined
      ? clamp(lerp(wA, wB, t), 0, 2.5)
      : wA !== undefined
        ? wA
        : wB !== undefined
          ? wB
          : base.waterVolume;

  return {
    sunElevationDeg: lerp(a.sunElevationDeg, b.sunElevationDeg, t),
    sunAzimuthDeg: lerp(a.sunAzimuthDeg, b.sunAzimuthDeg, t),
    solarIntensity: clamp(lerp(a.solarIntensity ?? base.solarIntensity, b.solarIntensity ?? base.solarIntensity, t), 0.05, 4.5),
    atmoDensity: Math.max(0, lerp(a.atmoDensity, b.atmoDensity, t)),
    scatterStrength: Math.max(0, lerp(a.scatterStrength, b.scatterStrength, t)),
    cloudCoverage: clamp(lerp(a.cloudCoverage, b.cloudCoverage, t), 0, 2.0),
    cloudAltitudeRatio: clamp(lerp(a.cloudAltitudeRatio, b.cloudAltitudeRatio, t), 0.04, 0.45),
    windSpeed: clamp(lerp(a.windSpeed, b.windSpeed, t), 0, 5),
    tempOffsetC: lerp(a.tempOffsetC, b.tempOffsetC, t),
    waterVolume: evalWater,
  };
}

/**
 * Evaluates the Post-Processing & Color Grading track at `timeSec`.
 */
export function evaluatePostFxTrack(
  rawTrack: ReadonlyArray<DirectorPostFxKeyframe>,
  timeSec: number,
): EvaluatedPostFxState {
  const defaults: EvaluatedPostFxState = {
    lutPreset: 'natural',
    lutIntensity: 0.85,
    exposure: 1.12,
    contrast: 1.0,
    saturation: 1.0,
    bloomStrength: 0.34,
    vignette: 0.16,
    filmGrain: 0.0,
    chromaticAberration: 0.0,
    aspectMask: 'none',
    visualFilter: 'none',
    filterIntensity: 0.85,
    filterScale: 1.0,
  };
  if (rawTrack.length === 0) return defaults;
  const kfs = [...rawTrack].sort((a, b) => a.timeSec - b.timeSec);
  if (kfs.length === 1 || timeSec <= kfs[0].timeSec) {
    const k = kfs[0];
    return {
      lutPreset: k.lutPreset,
      lutIntensity: k.lutIntensity,
      exposure: k.exposure,
      contrast: k.contrast,
      saturation: k.saturation,
      bloomStrength: k.bloomStrength,
      vignette: k.vignette,
      filmGrain: k.filmGrain,
      chromaticAberration: k.chromaticAberration,
      aspectMask: k.aspectMask,
      visualFilter: k.visualFilter ?? 'none',
      filterIntensity: k.filterIntensity ?? 0.85,
      filterScale: k.filterScale ?? 1.0,
    };
  }
  const last = kfs[kfs.length - 1];
  if (timeSec >= last.timeSec) {
    return {
      lutPreset: last.lutPreset,
      lutIntensity: last.lutIntensity,
      exposure: last.exposure,
      contrast: last.contrast,
      saturation: last.saturation,
      bloomStrength: last.bloomStrength,
      vignette: last.vignette,
      filmGrain: last.filmGrain,
      chromaticAberration: last.chromaticAberration,
      aspectMask: last.aspectMask,
      visualFilter: last.visualFilter ?? 'none',
      filterIntensity: last.filterIntensity ?? 0.85,
      filterScale: last.filterScale ?? 1.0,
    };
  }

  let idx = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (timeSec >= kfs[i].timeSec && timeSec <= kfs[i + 1].timeSec) {
      idx = i;
      break;
    }
  }
  const a = kfs[idx];
  const b = kfs[idx + 1];
  const span = Math.max(1e-5, b.timeSec - a.timeSec);
  const t = evaluateCubicBezierEasing(a.easing, (timeSec - a.timeSec) / span);
  return {
    lutPreset: t > 0.5 ? b.lutPreset : a.lutPreset,
    lutIntensity: clamp(lerp(a.lutIntensity, b.lutIntensity, t), 0, 1.5),
    exposure: clamp(lerp(a.exposure, b.exposure, t), 0.2, 3.0),
    contrast: clamp(lerp(a.contrast, b.contrast, t), 0.5, 2.0),
    saturation: clamp(lerp(a.saturation, b.saturation, t), 0.0, 2.2),
    bloomStrength: clamp(lerp(a.bloomStrength, b.bloomStrength, t), 0.0, 1.8),
    vignette: clamp(lerp(a.vignette, b.vignette, t), 0.0, 0.95),
    filmGrain: clamp(lerp(a.filmGrain, b.filmGrain, t), 0.0, 0.35),
    chromaticAberration: clamp(lerp(a.chromaticAberration, b.chromaticAberration, t), 0.0, 1.0),
    aspectMask: t > 0.5 ? b.aspectMask : a.aspectMask,
    visualFilter: t > 0.5 ? (b.visualFilter ?? 'none') : (a.visualFilter ?? 'none'),
    filterIntensity: clamp(lerp(a.filterIntensity ?? 0.85, b.filterIntensity ?? 0.85, t), 0.0, 1.0),
    filterScale: clamp(lerp(a.filterScale ?? 1.0, b.filterScale ?? 1.0, t), 0.25, 3.0),
  };
}

/**
 * Evaluates a single-parameter keyframe channel independently with per-keyframe Cubic-Bezier easing.
 */
export function evaluateParameterTrack(
  rawKfs: ReadonlyArray<DirectorParamKeyframe> | undefined,
  timeSec: number,
  fallbackValue: number,
  minVal = -Infinity,
  maxVal = Infinity,
): number {
  if (!rawKfs || rawKfs.length === 0) {
    return clamp(fallbackValue, minVal, maxVal);
  }
  const kfs = [...rawKfs].sort((a, b) => a.timeSec - b.timeSec);
  if (kfs.length === 1 || timeSec <= kfs[0].timeSec) {
    return clamp(kfs[0].value, minVal, maxVal);
  }
  const last = kfs[kfs.length - 1];
  if (timeSec >= last.timeSec) {
    return clamp(last.value, minVal, maxVal);
  }
  let idx = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (timeSec >= kfs[i].timeSec && timeSec <= kfs[i + 1].timeSec) {
      idx = i;
      break;
    }
  }
  const a = kfs[idx];
  const b = kfs[idx + 1];
  const span = Math.max(1e-5, b.timeSec - a.timeSec);
  const eased = evaluateCubicBezierEasing(a.easing, (timeSec - a.timeSec) / span);
  return clamp(lerp(a.value, b.value, eased), minVal, maxVal);
}

export function upsertParamKeyframe(
  existing: ReadonlyArray<DirectorParamKeyframe> | undefined,
  timeSec: number,
  value: number,
  easing: CubicBezier4 = [0.42, 0.0, 0.58, 1.0],
): DirectorParamKeyframe[] {
  const list = [...(existing ?? [])];
  const nearIdx = list.findIndex((k) => Math.abs(k.timeSec - timeSec) < 0.04);
  if (nearIdx >= 0) {
    list[nearIdx] = { ...list[nearIdx], value, easing };
  } else {
    list.push({
      id: `pk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timeSec: Number(Math.max(0, timeSec).toFixed(3)),
      value,
      easing,
    });
  }
  return list.sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * Evaluates full synchronized NLE state (Camera + Env + PostFX), overlaying any active per-parameter channels.
 */
export function evaluateFullTimelineAtTime(
  project: DirectorTimelineProject,
  anchor: DirectorSceneAnchor,
  timeSec: number,
  envFallback?: Partial<EvaluatedEnvState>,
): {
  pose: DirectorCameraPose;
  env: EvaluatedEnvState;
  pfx: EvaluatedPostFxState;
} {
  const pose = evaluateCameraTrackPose(project.cameraTrack, timeSec, anchor);
  const env = evaluateEnvironmentTrack(project.envTrack, timeSec, envFallback);
  const pfx = evaluatePostFxTrack(project.postFxTrack, timeSec);
  const pt = project.paramTracks;
  if (!pt) {
    return { pose, env, pfx };
  }

  const evalParam = (id: DirectorParamId, curVal: number): number => {
    const kfs = pt[id];
    if (!kfs || kfs.length === 0) return curVal;
    const meta = PARAM_TRACK_META.find((m) => m.id === id);
    return evaluateParameterTrack(
      kfs,
      timeSec,
      curVal,
      meta?.min ?? -Infinity,
      meta?.max ?? Infinity,
    );
  };

  // Overlay per-parameter Environment channels
  env.cloudCoverage = evalParam('cloudCoverage', env.cloudCoverage);
  env.cloudAltitudeRatio = evalParam('cloudAltitudeRatio', env.cloudAltitudeRatio);
  env.solarIntensity = evalParam('solarIntensity', env.solarIntensity);
  env.sunElevationDeg = evalParam('sunElevationDeg', env.sunElevationDeg);
  env.sunAzimuthDeg = evalParam('sunAzimuthDeg', env.sunAzimuthDeg);
  env.atmoDensity = evalParam('atmoDensity', env.atmoDensity);
  env.scatterStrength = evalParam('scatterStrength', env.scatterStrength);
  env.windSpeed = evalParam('windSpeed', env.windSpeed);
  env.tempOffsetC = evalParam('tempOffsetC', env.tempOffsetC);
  if (pt.waterVolume && pt.waterVolume.length > 0) {
    env.waterVolume = evalParam('waterVolume', env.waterVolume ?? 1.0);
  }

  // Overlay per-parameter Camera optical overrides (FOV & Roll)
  if (pt.cameraFovDeg && pt.cameraFovDeg.length > 0) {
    pose.fovDeg = evalParam('cameraFovDeg', pose.fovDeg);
  }
  if (pt.cameraRollDeg && pt.cameraRollDeg.length > 0) {
    const newRoll = evalParam('cameraRollDeg', pose.rollDeg ?? 0);
    const deltaRoll = newRoll - (pose.rollDeg ?? 0);
    if (Math.abs(deltaRoll) > 1e-4) {
      const fwd = normalize3(
        pose.lookAt[0] - pose.position[0],
        pose.lookAt[1] - pose.position[1],
        pose.lookAt[2] - pose.position[2],
      );
      pose.up = rotateAroundAxis3(pose.up, fwd, (deltaRoll * Math.PI) / 180);
    }
    pose.rollDeg = newRoll;
  }

  // Overlay per-parameter Post-FX & Visual Filter channels
  pfx.exposure = evalParam('exposure', pfx.exposure);
  pfx.contrast = evalParam('contrast', pfx.contrast);
  pfx.saturation = evalParam('saturation', pfx.saturation);
  pfx.bloomStrength = evalParam('bloomStrength', pfx.bloomStrength);
  pfx.vignette = evalParam('vignette', pfx.vignette);
  pfx.filmGrain = evalParam('filmGrain', pfx.filmGrain);
  pfx.filterIntensity = evalParam('filterIntensity', pfx.filterIntensity);
  pfx.filterScale = evalParam('filterScale', pfx.filterScale);

  return { pose, env, pfx };
}

export interface LutGradingCoefficients {
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  saturationScale: number;
  contrastScale: number;
}

export function getLutColorMatrixParams(preset: DirectorLutPreset): LutGradingCoefficients {
  switch (preset) {
    case 'cinema_teal_orange':
      return {
        shadowTint: [0.84, 1.04, 1.16],
        highlightTint: [1.14, 1.01, 0.86],
        saturationScale: 1.08,
        contrastScale: 1.1,
      };
    case 'sci_fi_cyan':
      return {
        shadowTint: [0.82, 0.98, 1.18],
        highlightTint: [0.92, 1.06, 1.15],
        saturationScale: 0.92,
        contrastScale: 1.08,
      };
    case 'noir_high_contrast':
      return {
        shadowTint: [0.92, 0.93, 0.98],
        highlightTint: [1.05, 1.03, 0.99],
        saturationScale: 0.28,
        contrastScale: 1.28,
      };
    case 'solar_amber':
      return {
        shadowTint: [1.05, 0.93, 0.82],
        highlightTint: [1.18, 1.06, 0.82],
        saturationScale: 1.16,
        contrastScale: 1.06,
      };
    case 'thermal_falsecolor':
      return {
        shadowTint: [0.68, 0.78, 1.35],
        highlightTint: [1.32, 0.88, 0.62],
        saturationScale: 1.45,
        contrastScale: 1.18,
      };
    case 'natural':
    default:
      return {
        shadowTint: [1.0, 1.0, 1.0],
        highlightTint: [1.0, 1.0, 1.0],
        saturationScale: 1.0,
        contrastScale: 1.0,
      };
  }
}

/**
 * Bakes any procedural shot action (micro-to-planet, 360 orbit, spiral, flyover, etc.)
 * into editable NLE keyframes on a DirectorTimelineProject so users can tweak every node & easing curve.
 */
export function bakeShotActionIntoProject(
  project: DirectorTimelineProject,
  action: DirectorActionType,
  plan: DirectorShotPlan,
  anchor: DirectorSceneAnchor,
  currentEnv: EvaluatedEnvState,
  sampleCount = 9,
): DirectorTimelineProject {
  const count = clamp(Math.round(sampleCount), 3, 24);
  const dur = Math.max(0.5, plan.durationSec);
  const cameraTrack: DirectorCameraKeyframe[] = [];

  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    const pose = evaluateDirectorPose(plan, u, anchor);
    const dist = Math.hypot(
      pose.position[0] - pose.lookAt[0],
      pose.position[1] - pose.lookAt[1],
      pose.position[2] - pose.lookAt[2],
    );
    cameraTrack.push({
      id: `baked_cam_${i}_${Date.now().toString(36).slice(-3)}`,
      label:
        i === 0
          ? '起点'
          : i === count - 1
            ? '终景'
            : `${DIRECTOR_ACTIONS.find((a) => a.id === action)?.label.slice(0, 4) ?? '节点'} #${i + 1}`,
      timeSec: Number((u * dur).toFixed(3)),
      position: pose.position,
      lookAt: pose.lookAt,
      up: pose.up,
      fovDeg: Number(pose.fovDeg.toFixed(2)),
      focusDist: Number(Math.max(0.1, dist).toFixed(3)),
      aperture: 2.8,
      rollDeg: 0,
      shakeAmp: 0,
      shakeFreq: 4,
      interpMode: 'catmull_rom',
      easing: [0.0, 0.0, 1.0, 1.0],
    });
  }

  const envTrack: DirectorEnvKeyframe[] = [
    {
      id: `baked_env_0_${Date.now().toString(36).slice(-3)}`,
      timeSec: 0,
      sunElevationDeg: currentEnv.sunElevationDeg,
      sunAzimuthDeg: currentEnv.sunAzimuthDeg,
      atmoDensity: currentEnv.atmoDensity,
      scatterStrength: currentEnv.scatterStrength,
      cloudCoverage: currentEnv.cloudCoverage,
      cloudAltitudeRatio: currentEnv.cloudAltitudeRatio,
      windSpeed: currentEnv.windSpeed,
      tempOffsetC: currentEnv.tempOffsetC,
      easing: [0.42, 0.0, 0.58, 1.0],
    },
    {
      id: `baked_env_1_${Date.now().toString(36).slice(-3)}`,
      timeSec: dur,
      sunElevationDeg: currentEnv.sunElevationDeg,
      sunAzimuthDeg: currentEnv.sunAzimuthDeg + plan.sunSweepDeg,
      atmoDensity: currentEnv.atmoDensity,
      scatterStrength: currentEnv.scatterStrength,
      cloudCoverage: currentEnv.cloudCoverage,
      cloudAltitudeRatio: currentEnv.cloudAltitudeRatio,
      windSpeed: currentEnv.windSpeed,
      tempOffsetC: currentEnv.tempOffsetC,
      easing: [0.42, 0.0, 0.58, 1.0],
    },
  ];

  return {
    ...project,
    updatedAt: Date.now(),
    durationSec: dur,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    format: plan.format,
    inTimeSec: 0,
    outTimeSec: dur,
    simTimeScale: plan.simTimeScale,
    cleanFrame: plan.cleanFrame,
    forceMaxVoxelDetail: plan.forceMaxVoxelDetail,
    offlineQuality: plan.offlineQuality ?? project.offlineQuality,
    cameraTrack,
    envTrack,
  };
}

export function formatSmpteTimecode(timeSec: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps));
  const safeT = Math.max(0, timeSec);
  const totalFrames = Math.floor(safeT * safeFps + 1e-6);
  const ff = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const padF = safeFps >= 100 ? String(ff).padStart(3, '0') : pad2(ff);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${padF}`;
}

export function computePlanFrameCount(plan: Pick<DirectorShotPlan, 'durationSec' | 'fps'>): number {
  return Math.max(2, Math.round(clamp(plan.durationSec, 0.25, 300) * clamp(plan.fps, 1, 300)));
}

export function computeProjectFrameRange(project: DirectorTimelineProject): {
  totalFrames: number;
  startFrame: number;
  endFrame: number;
  fps: number;
} {
  const fps = clamp(Math.round(project.fps), 1, 300);
  const totalFrames = Math.max(2, Math.round(clamp(project.durationSec, 0.25, 300) * fps));
  const inTime = clamp(project.inTimeSec, 0, project.durationSec);
  const outTime = clamp(project.outTimeSec, inTime + 1 / fps, project.durationSec);
  const startFrame = clamp(Math.floor(inTime * fps + 1e-6), 0, totalFrames - 2);
  const endFrame = clamp(Math.min(totalFrames - 1, Math.round(outTime * fps) - 1), startFrame + 1, totalFrames - 1);
  return { totalFrames, startFrame, endFrame, fps };
}

export function serializeDirectorProjectJson(project: DirectorTimelineProject): string {
  return JSON.stringify(
    {
      schema: 'terrasphere-director-project-v2',
      project,
    },
    null,
    2,
  );
}

export function parseDirectorProjectJson(raw: string): DirectorTimelineProject | null {
  try {
    const parsed = JSON.parse(raw) as {
      schema?: string;
      project?: Partial<DirectorTimelineProject>;
    };
    const p = parsed?.project ?? (parsed as unknown as Partial<DirectorTimelineProject>);
    if (!p || !Array.isArray(p.cameraTrack) || !Array.isArray(p.envTrack)) {
      return null;
    }
    const base = createDefaultDirectorProject();
    return {
      ...base,
      ...p,
      id: p.id || `proj_${Date.now().toString(36)}`,
      name: p.name || '导入导演工程',
      updatedAt: Date.now(),
      durationSec: clamp(Number(p.durationSec) || 8, 0.5, 300),
      fps: clamp(Math.round(Number(p.fps) || 60), 1, 300),
      width: clamp(Math.round(Number(p.width) || 1920), 64, 8192),
      height: clamp(Math.round(Number(p.height) || 1080), 64, 8192),
      inTimeSec: clamp(Number(p.inTimeSec) || 0, 0, Number(p.durationSec) || 8),
      outTimeSec: clamp(Number(p.outTimeSec) || Number(p.durationSec) || 8, 0.25, 300),
      checkpointIntervalFrames: clamp(Math.round(Number(p.checkpointIntervalFrames) || 24), 4, 240),
      offlineQuality: p.offlineQuality ?? base.offlineQuality,
      cameraTrack: p.cameraTrack,
      envTrack: p.envTrack,
      eventTrack: Array.isArray(p.eventTrack) ? p.eventTrack : [],
      postFxTrack: Array.isArray(p.postFxTrack) && p.postFxTrack.length > 0 ? p.postFxTrack : base.postFxTrack,
      paramTracks: p.paramTracks && typeof p.paramTracks === 'object' ? p.paramTracks : {},
    };
  } catch {
    return null;
  }
}
