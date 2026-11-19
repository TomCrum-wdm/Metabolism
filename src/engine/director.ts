import { computeDetailCameraOptics, transportCameraForwardOnSphere } from './cameraMath';

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

export interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RESOLUTION_PRESETS: ReadonlyArray<ResolutionPreset> = [
  { id: '1080p', label: 'FHD 1080p', width: 1920, height: 1080 },
  { id: '1440p', label: '2K QHD', width: 2560, height: 1440 },
  { id: '4k', label: '4K UHD', width: 3840, height: 2160 },
  { id: '6k', label: '6K UHD (16:9)', width: 5760, height: 3240 },
  { id: '6k-dci', label: '6K DCI (16:9)', width: 6144, height: 3456 },
  { id: '8k', label: '8K UHD', width: 7680, height: 4320 },
];

export const FPS_PRESETS: ReadonlyArray<number> = [24, 30, 60, 120, 165, 240];

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
  /** User-recorded keyframes for 'keyframe_path' action */
  keyframes: DirectorKeyframe[];
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
}

export interface DirectorRenderProgress {
  frame: number;
  totalFrames: number;
  percent: number;
  elapsedSec: number;
  etaSec: number;
  actualWidth: number;
  actualHeight: number;
  encoderLabel: string;
  statusText: string;
  previewDataUrl?: string;
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
    keyframes: [],
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
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
    // Log-space progression gives equal visual airtime across micro -> cliff -> continent -> globe
    const desiredDist = dMin * Math.pow(dMax / dMin, s);
    const optics = computeDetailCameraOptics(desiredDist, R0, voxel, baseFov);

    // Gradually blend look target from the exact micro surface block to the planet center (0,0,0)
    const centerBlend = smoothstep01((s - 0.32) / 0.58);
    const lookAt = lerp3(anchor.targetPoint, [0, 0, 0], centerBlend);

    // Subtle dramatic tilt & azimuth rotation during the macroscopic phase so the shot feels alive
    const startTiltRad = 0.34;
    const endElevRad = (clamp(plan.orbitElevationDeg, -75, 75) * Math.PI) / 180;
    const sweepRad = (plan.orbitSweepDeg * 0.35 * Math.PI) / 180 * smoothstep01((s - 0.15) / 0.85);

    const startAzimuth = Math.atan2(targetN[2], targetN[0]);
    const startLat = Math.asin(clamp(targetN[1], -0.999, 0.999));

    // Close-up direction leans slightly backward along tangent away from normal for depth parallax
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

    // Distance from lookAt point along camDir: at micro end use physicalDist, at macro end use dMax from center
    const camDistFromLook = optics.physicalDist + (dMax - optics.physicalDist) * centerBlend;
    const position: [number, number, number] = [
      lookAt[0] + camDir[0] * camDistFromLook,
      lookAt[1] + camDir[1] * camDistFromLook,
      lookAt[2] + camDir[2] * camDistFromLook,
    ];

    // Smoothly transition up-vector from local surface normal tangent frame to planetary north [0, 1, 0]
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

    // Ensure non-degenerate up vs camDir
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

  // 'surface_flyover': Smooth great-circle low-altitude flyover following planetary curvature
  const orbitNormal = normalize3(targetRight[0], targetRight[1], targetRight[2]);
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

  // Sample terrain ahead & below so low flyover clears peaks cleanly
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

  // Keep slight lateral stability using orbitNormal only as reference, up = local gravity normal
  void orbitNormal;
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

export function computePlanFrameCount(plan: DirectorShotPlan): number {
  return Math.max(2, Math.round(clamp(plan.durationSec, 0.25, 120) * clamp(plan.fps, 1, 300)));
}
