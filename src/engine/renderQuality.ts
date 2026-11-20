export type RenderQualityPreset =
  | 'performance'
  | 'balanced'
  | 'high'
  | 'cinematic'
  | 'offline_raytraced';

export type RayTracingMode = 'off' | 'ssr' | 'ssgi_ssr';
export type ShadowQualityLevel = 'standard' | 'high' | 'ultra';
export type OfflineAccumSamples = 1 | 2 | 4 | 8;
export type OfflineQualityOverride = 'inherit' | 'cinematic' | 'offline_raytraced';

export interface RenderQualityConfig {
  preset: RenderQualityPreset;
  /** Triplanar micro-normals, blocky bevel normals, crystal/ice clearcoat, animated wave normals */
  pbrEnhanced: boolean;
  /** Sub-voxel parallax protrusion relief strength (0.0 .. 2.0) */
  pbrReliefDepth: number;
  /** Screen-space ray-traced reflections & global illumination */
  rayTracingMode: RayTracingMode;
  /** Ray-march richness multiplier in [0.35, 1.0] */
  raySteps: number;
  /** Ground-truth ambient occlusion (GTAO / integrated SSGI AO) */
  aoEnabled: boolean;
  /** Screen-space ray-marched height-exponential volumetric fog & light shafts */
  volumetricFog: boolean;
  /** Ray-marching iteration count for volumetric fog & spherical scattering (6..48) */
  volumetricSteps: number;
  /** Physical spherical Rayleigh + Mie + Ozone atmospheric scattering */
  atmoScattering: boolean;
  /** Shadow map resolution tier & tight dynamic frustum focusing */
  shadowQuality: ShadowQualityLevel;
  /** Screen-space ray-marched micro crevice contact shadows toward sun */
  contactShadows: boolean;
  /** Selective HDR luminance bloom */
  bloomEnabled: boolean;
  /** Multi-sample subpixel Halton jitter accumulation count for offline captures */
  offlineAccumSamples: OfflineAccumSamples;
}

export interface RenderQualityPresetMeta {
  id: RenderQualityPreset;
  label: string;
  shortLabel: string;
  desc: string;
}

export const RENDER_QUALITY_PRESETS: ReadonlyArray<RenderQualityPresetMeta> = [
  {
    id: 'performance',
    label: '流畅性能',
    shortLabel: '性能',
    desc: '关闭屏幕空间光追与体积步进，优先保障极限体素雕刻帧率',
  },
  {
    id: 'balanced',
    label: '均衡标准',
    shortLabel: '均衡',
    desc: '开启 PBR 微法线与基础大气散射，适合核显与笔记本流畅创作',
  },
  {
    id: 'high',
    label: '高画质 (推荐)',
    shortLabel: '高画质',
    desc: 'PBR 物理材质 + 光追 SSR 反射 + 体积雾大气散射 + 高精动态阴影 + HDR 泛光',
  },
  {
    id: 'cinematic',
    label: '光追影视级',
    shortLabel: '光追影视',
    desc: '全开 PBR + 光追 SSGI 全局光照 & SSR 反射 + GTAO + 体积雾散射 + 极限阴影与接触阴影',
  },
  {
    id: 'offline_raytraced',
    label: '极限路径累积 (离线)',
    shortLabel: '极限离线',
    desc: '最高光追步数 + 40 步球面散射体 + 8K 动态阴影 + 4× 亚像素抖动累积去噪',
  },
];

export function buildRenderQualityConfig(
  preset: RenderQualityPreset,
  isSoftwareRenderer = false,
): RenderQualityConfig {
  if (isSoftwareRenderer && preset !== 'offline_raytraced' && preset !== 'cinematic') {
    if (preset === 'balanced' || preset === 'high') {
      return {
        preset: 'performance',
        pbrEnhanced: true,
        pbrReliefDepth: 0.45,
        rayTracingMode: 'off',
        raySteps: 0.35,
        aoEnabled: false,
        volumetricFog: false,
        volumetricSteps: 8,
        atmoScattering: false,
        shadowQuality: 'standard',
        contactShadows: false,
        bloomEnabled: false,
        offlineAccumSamples: 1,
      };
    }
  }

  switch (preset) {
    case 'performance':
      return {
        preset: 'performance',
        pbrEnhanced: false,
        pbrReliefDepth: 0.0,
        rayTracingMode: 'off',
        raySteps: 0.35,
        aoEnabled: false,
        volumetricFog: false,
        volumetricSteps: 6,
        atmoScattering: false,
        shadowQuality: 'standard',
        contactShadows: false,
        bloomEnabled: false,
        offlineAccumSamples: 1,
      };
    case 'balanced':
      return {
        preset: 'balanced',
        pbrEnhanced: true,
        pbrReliefDepth: 0.9,
        rayTracingMode: 'off',
        raySteps: 0.5,
        aoEnabled: false,
        volumetricFog: false,
        volumetricSteps: 10,
        atmoScattering: true,
        shadowQuality: 'standard',
        contactShadows: false,
        bloomEnabled: true,
        offlineAccumSamples: 1,
      };
    case 'high':
      return {
        preset: 'high',
        pbrEnhanced: true,
        pbrReliefDepth: 1.15,
        rayTracingMode: 'ssr',
        raySteps: 0.65,
        aoEnabled: true,
        volumetricFog: true,
        volumetricSteps: 14,
        atmoScattering: true,
        shadowQuality: 'high',
        contactShadows: false,
        bloomEnabled: true,
        offlineAccumSamples: 1,
      };
    case 'cinematic':
      return {
        preset: 'cinematic',
        pbrEnhanced: true,
        pbrReliefDepth: 1.35,
        rayTracingMode: 'ssgi_ssr',
        raySteps: 0.85,
        aoEnabled: true,
        volumetricFog: true,
        volumetricSteps: 22,
        atmoScattering: true,
        shadowQuality: 'ultra',
        contactShadows: true,
        bloomEnabled: true,
        offlineAccumSamples: 2,
      };
    case 'offline_raytraced':
      return {
        preset: 'offline_raytraced',
        pbrEnhanced: true,
        pbrReliefDepth: 1.5,
        rayTracingMode: 'ssgi_ssr',
        raySteps: 1.0,
        aoEnabled: true,
        volumetricFog: true,
        volumetricSteps: 40,
        atmoScattering: true,
        shadowQuality: 'ultra',
        contactShadows: true,
        bloomEnabled: true,
        offlineAccumSamples: 4,
      };
  }
}

export const DEFAULT_RENDER_QUALITY: RenderQualityConfig =
  buildRenderQualityConfig('high');

export interface DirectorQualitySettings {
  overrideMode: OfflineQualityOverride;
  accumSamples: OfflineAccumSamples;
  rayTracing: boolean;
  volumetrics: boolean;
  shadowQuality: ShadowQualityLevel;
  pbrEnhanced: boolean;
}

export function createDefaultDirectorQuality(): DirectorQualitySettings {
  return {
    overrideMode: 'cinematic',
    accumSamples: 2,
    rayTracing: true,
    volumetrics: true,
    shadowQuality: 'ultra',
    pbrEnhanced: true,
  };
}

/**
 * Resolves the effective RenderQualityConfig for offline screenshots and Director video renders,
 * letting the user trade offline render time for cinema-grade ray-traced lighting, shadows, and SSAA.
 */
export function resolveDirectorOfflineQuality(
  liveQuality: RenderQualityConfig,
  overrideSettings?: Partial<DirectorQualitySettings> | null,
): RenderQualityConfig {
  if (!overrideSettings || overrideSettings.overrideMode === 'inherit') {
    return {
      ...liveQuality,
      offlineAccumSamples:
        overrideSettings?.accumSamples ?? liveQuality.offlineAccumSamples ?? 1,
    };
  }

  const basePreset: RenderQualityPreset =
    overrideSettings.overrideMode === 'offline_raytraced'
      ? 'offline_raytraced'
      : 'cinematic';
  const base = buildRenderQualityConfig(basePreset, false);

  const rtEnabled = overrideSettings.rayTracing ?? true;
  const volEnabled = overrideSettings.volumetrics ?? true;

  return {
    ...base,
    pbrEnhanced: overrideSettings.pbrEnhanced ?? true,
    pbrReliefDepth: Math.max(base.pbrReliefDepth, liveQuality.pbrReliefDepth ?? base.pbrReliefDepth),
    rayTracingMode: rtEnabled ? 'ssgi_ssr' : 'off',
    aoEnabled: rtEnabled || base.aoEnabled,
    volumetricFog: volEnabled,
    atmoScattering: volEnabled,
    shadowQuality: overrideSettings.shadowQuality ?? base.shadowQuality,
    contactShadows:
      (overrideSettings.shadowQuality ?? base.shadowQuality) === 'ultra',
    offlineAccumSamples: overrideSettings.accumSamples ?? base.offlineAccumSamples,
  };
}

/**
 * Computes hardware-safe power-of-two directional shadow map dimension.
 */
export function resolveShadowMapSize(
  shadowQuality: ShadowQualityLevel,
  maxGpuTexDim = 8192,
  isSoftware = false,
): number {
  const safeMax = Math.max(512, Math.min(8192, maxGpuTexDim || 8192));
  if (isSoftware) {
    return Math.min(safeMax, shadowQuality === 'ultra' ? 2048 : 1024);
  }
  let target = 2048;
  if (shadowQuality === 'standard') target = 1024;
  else if (shadowQuality === 'high') target = 2048;
  else if (shadowQuality === 'ultra') target = 4096;

  // Snap to highest power of two <= min(target, safeMax)
  const capped = Math.min(target, safeMax);
  let pow2 = 512;
  while (pow2 * 2 <= capped) {
    pow2 *= 2;
  }
  return pow2;
}

export interface ShadowFrustumSolution {
  halfSpan: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  near: number;
  far: number;
}

/**
 * Dynamically tightens the directional shadow camera frustum toward the camera's focus region
 * when zoomed in close to voxel details (preserving planet-wide coverage when orbiting).
 */
export function computeTightShadowFrustum(
  planetRadius: number,
  nativeVoxelSize: number,
  focusX: number,
  focusY: number,
  focusZ: number,
  viewDistance: number,
  shadowQuality: ShadowQualityLevel,
): ShadowFrustumSolution {
  const scale = Math.max(planetRadius / 13.0, 0.005);
  const fullHalfSpan = 21.5 * scale;
  const fullNear = Math.max(0.1, 2 * scale);
  const fullFar = Math.max(30, 88 * scale);

  if (shadowQuality === 'standard') {
    return {
      halfSpan: fullHalfSpan,
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      near: fullNear,
      far: fullFar,
    };
  }

  // Tight focus when viewer is close relative to planet radius
  const closeRatio = Math.min(1, Math.max(0, viewDistance / Math.max(1e-4, planetRadius * 0.85)));
  const minSpan = Math.max(nativeVoxelSize * 48, 0.9 * scale);
  const halfSpan = Math.min(
    fullHalfSpan,
    Math.max(minSpan, viewDistance * 1.15 * (0.45 + 0.55 * closeRatio)),
  );

  // Blend shadow target toward planetary center as view pulls out
  const focusWeight = 1 - Math.pow(closeRatio, 1.35);
  return {
    halfSpan,
    centerX: focusX * focusWeight,
    centerY: focusY * focusWeight,
    centerZ: focusZ * focusWeight,
    near: fullNear,
    far: fullFar,
  };
}

/**
 * Van der Corput / Halton low-discrepancy radical inverse in base `base`.
 */
export function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = Math.max(0, Math.floor(index));
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

/**
 * Returns deterministic subpixel jitter offsets (in pixels, centered in [-0.5, 0.5])
 * for multi-sample offline super-sampling accumulation via camera.setViewOffset().
 */
export function computeSubpixelJitterOffset(
  sampleIndex: number,
  totalSamples: number,
): { offsetX: number; offsetY: number } {
  if (totalSamples <= 1) {
    return { offsetX: 0, offsetY: 0 };
  }
  const idx = sampleIndex + 1;
  return {
    offsetX: halton(idx, 2) - 0.5,
    offsetY: halton(idx, 3) - 0.5,
  };
}

export function createRgbaAccumulator(pixelCount: number): Float32Array {
  return new Float32Array(Math.max(0, pixelCount) * 4);
}

export function accumulateRgbaSample(
  accumulator: Float32Array,
  sampleRgba: Uint8Array | Uint8ClampedArray,
): void {
  const len = Math.min(accumulator.length, sampleRgba.length);
  for (let i = 0; i < len; i += 4) {
    accumulator[i] += sampleRgba[i];
    accumulator[i + 1] += sampleRgba[i + 1];
    accumulator[i + 2] += sampleRgba[i + 2];
    accumulator[i + 3] += 255;
  }
}

export function finalizeAccumulatedRgba(
  accumulator: Float32Array,
  sampleCount: number,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const len = accumulator.length;
  const dst = out && out.length === len ? out : new Uint8ClampedArray(len);
  const inv = 1 / Math.max(1, sampleCount);
  for (let i = 0; i < len; i += 4) {
    dst[i] = Math.min(255, Math.max(0, Math.round(accumulator[i] * inv)));
    dst[i + 1] = Math.min(255, Math.max(0, Math.round(accumulator[i + 1] * inv)));
    dst[i + 2] = Math.min(255, Math.max(0, Math.round(accumulator[i + 2] * inv)));
    dst[i + 3] = 255;
  }
  return dst;
}
