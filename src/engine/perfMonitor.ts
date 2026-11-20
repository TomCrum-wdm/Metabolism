export type GraphicsBackendKind = 'WebGPU' | 'WebGL2';

export type DowngradeSeverity = 'none' | 'warn' | 'critical';

export type GpuTimestampSource =
  | 'WebGPU timestamp-query'
  | 'WebGL2 EXT_disjoint_timer_query'
  | '不可用 (仅CPU提交计时)';

export interface BackendDiagnosticInfo {
  backend: GraphicsBackendKind;
  navigatorGpuAvailable: boolean;
  webgpuAttempted: boolean;
  isDowngraded: boolean;
  downgradeSeverity: DowngradeSeverity;
  downgradeReason: string;
  adapterLabel: string;
  adapterVendor: string;
  adapterArchitecture: string;
  isCompatibilityMode: boolean;
  isSoftwareRenderer: boolean;
  gpuTimestampSupported: boolean;
  gpuTimestampSource: GpuTimestampSource;
  maxTextureDim: number;
}

export interface BackendClassificationInput {
  isWebGPUBackend: boolean;
  navigatorGpuAvailable: boolean;
  webgpuAttempted?: boolean;
  isCompatibilityMode?: boolean;
  isSoftwareRenderer?: boolean;
  gpuTimestampSupported?: boolean;
  adapterLabel?: string;
  adapterVendor?: string;
  adapterArchitecture?: string;
  fallbackProbeReason?: string;
  maxTextureDim?: number;
}

export function isSoftwareAdapterString(label: string): boolean {
  if (!label) return false;
  return /swiftshader|llvmpipe|softpipe|microsoft basic render|warp|software/i.test(label);
}

export function classifyBackendDiagnostic(
  input: BackendClassificationInput,
): BackendDiagnosticInfo {
  const backend: GraphicsBackendKind = input.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  const adapterLabel = (input.adapterLabel || '').trim() || (backend === 'WebGPU' ? 'WebGPU Adapter' : 'WebGL2 Context');
  const adapterVendor = (input.adapterVendor || '').trim() || '未知厂商';
  const adapterArchitecture = (input.adapterArchitecture || '').trim() || '-';
  const isCompatibilityMode = Boolean(input.isCompatibilityMode);
  const isSoftwareRenderer =
    Boolean(input.isSoftwareRenderer) || isSoftwareAdapterString(adapterLabel);
  const gpuTimestampSupported = Boolean(input.gpuTimestampSupported);
  const maxTextureDim = input.maxTextureDim && input.maxTextureDim > 0 ? input.maxTextureDim : 8192;

  const gpuTimestampSource: GpuTimestampSource = gpuTimestampSupported
    ? backend === 'WebGPU'
      ? 'WebGPU timestamp-query'
      : 'WebGL2 EXT_disjoint_timer_query'
    : '不可用 (仅CPU提交计时)';

  if (backend === 'WebGPU') {
    if (isSoftwareRenderer) {
      return {
        backend,
        navigatorGpuAvailable: input.navigatorGpuAvailable,
        webgpuAttempted: input.webgpuAttempted ?? true,
        isDowngraded: false,
        downgradeSeverity: 'warn',
        downgradeReason:
          '当前运行在 WebGPU 软光栅/回退适配器上，硬件 GPU 不可用，高分辨率体素渲染性能受限。',
        adapterLabel,
        adapterVendor,
        adapterArchitecture,
        isCompatibilityMode,
        isSoftwareRenderer: true,
        gpuTimestampSupported,
        gpuTimestampSource,
        maxTextureDim,
      };
    }

    if (isCompatibilityMode) {
      return {
        backend,
        navigatorGpuAvailable: input.navigatorGpuAvailable,
        webgpuAttempted: input.webgpuAttempted ?? true,
        isDowngraded: false,
        downgradeSeverity: 'warn',
        downgradeReason:
          '当前 WebGPU 处于兼容性限制模式 (compatibilityMode)，多重采样(MSAA)等特性已自动降级。',
        adapterLabel,
        adapterVendor,
        adapterArchitecture,
        isCompatibilityMode: true,
        isSoftwareRenderer: false,
        gpuTimestampSupported,
        gpuTimestampSource,
        maxTextureDim,
      };
    }

    return {
      backend,
      navigatorGpuAvailable: input.navigatorGpuAvailable,
      webgpuAttempted: input.webgpuAttempted ?? true,
      isDowngraded: false,
      downgradeSeverity: 'none',
      downgradeReason: '',
      adapterLabel,
      adapterVendor,
      adapterArchitecture,
      isCompatibilityMode: false,
      isSoftwareRenderer: false,
      gpuTimestampSupported,
      gpuTimestampSource,
      maxTextureDim,
    };
  }

  // WebGL2 Fallback path: always marked as downgraded!
  let baseReason = (input.fallbackProbeReason || '').trim();
  if (!baseReason) {
    baseReason = !input.navigatorGpuAvailable
      ? '浏览器或当前上下文未开放 WebGPU 接口 (navigator.gpu 缺失)，已自动降级为 WebGL2 兼容渲染后端。'
      : 'WebGPU 硬件适配器请求或设备初始化失败，已自动降级为 WebGL2 渲染后端。';
  }

  const downgradeReason = isSoftwareRenderer
    ? `${baseReason} 同时检测到软件光栅器 (${adapterLabel})，帧率与体素吞吐将显著降低。`
    : `${baseReason} 高分辨率体素流式吞吐与计算管线性能可能低于原生 WebGPU。`;

  return {
    backend: 'WebGL2',
    navigatorGpuAvailable: input.navigatorGpuAvailable,
    webgpuAttempted: input.webgpuAttempted ?? true,
    isDowngraded: true,
    downgradeSeverity: isSoftwareRenderer ? 'critical' : 'warn',
    downgradeReason,
    adapterLabel,
    adapterVendor,
    adapterArchitecture,
    isCompatibilityMode: false,
    isSoftwareRenderer,
    gpuTimestampSupported,
    gpuTimestampSource,
    maxTextureDim,
  };
}

export interface PerfHistorySample {
  frameMs: number;
  gpuMs: number | null;
  cpuTickMs: number;
  simMs: number;
  meshMs: number;
  renderSubmitMs: number;
}

export interface PerformanceMetricsSnapshot {
  fps: number;
  fps1PercentLow: number;
  fpsInstant: number;
  frameTimeMs: number;
  cpuTickMs: number;
  simStepMs: number;
  meshBuildMs: number;
  renderSubmitMs: number;
  gpuTimeMs: number | null;
  gpuTimeLastMs: number | null;
  gpuTimeP95Ms: number | null;
  frameTimeP95Ms: number;
  drawCalls: number;
  renderPasses: number;
  triangles: number;
  points: number;
  lines: number;
  geometriesCount: number;
  texturesCount: number;
  renderTargetsCount: number;
  gpuMemoryBytes: number;
  jsHeapUsedMb: number | null;
  jsHeapLimitMb: number | null;
  pixelRatio: number;
  canvasWidth: number;
  canvasHeight: number;
  history: PerfHistorySample[];
  backendInfo: BackendDiagnosticInfo;
}

export function createDefaultBackendDiagnostic(): BackendDiagnosticInfo {
  return classifyBackendDiagnostic({
    isWebGPUBackend: true,
    navigatorGpuAvailable: true,
    gpuTimestampSupported: false,
    adapterLabel: '正在检测图形后端...',
  });
}

export function createDefaultPerfSnapshot(): PerformanceMetricsSnapshot {
  return {
    fps: 60,
    fps1PercentLow: 60,
    fpsInstant: 60,
    frameTimeMs: 16.6,
    cpuTickMs: 2.0,
    simStepMs: 0.4,
    meshBuildMs: 0.5,
    renderSubmitMs: 0.8,
    gpuTimeMs: null,
    gpuTimeLastMs: null,
    gpuTimeP95Ms: null,
    frameTimeP95Ms: 16.6,
    drawCalls: 0,
    renderPasses: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometriesCount: 0,
    texturesCount: 0,
    renderTargetsCount: 0,
    gpuMemoryBytes: 0,
    jsHeapUsedMb: null,
    jsHeapLimitMb: null,
    pixelRatio: 1,
    canvasWidth: 1280,
    canvasHeight: 720,
    history: [],
    backendInfo: createDefaultBackendDiagnostic(),
  };
}

function computePercentile(values: readonly number[], p: number, roundMode: 'round' | 'ceil' = 'round'): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rawIdx = p * (sorted.length - 1);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, roundMode === 'ceil' ? Math.ceil(rawIdx) : Math.round(rawIdx)),
  );
  return sorted[idx];
}

export class RollingPerfTracker {
  private readonly capacity: number;
  private readonly frameRing: PerfHistorySample[] = [];
  private head = 0;

  private fpsSmooth = 60;
  private fpsInstant = 60;
  private frameTimeSmooth = 16.6;
  private cpuTickSmooth = 0;
  private simStepSmooth = 0;
  private meshBuildSmooth = 0;
  private renderSubmitSmooth = 0;

  private gpuTimeSmooth: number | null = null;
  private gpuTimeLast: number | null = null;

  constructor(capacity = 60) {
    this.capacity = Math.max(8, capacity);
  }

  public reset(): void {
    this.frameRing.length = 0;
    this.head = 0;
    this.fpsSmooth = 60;
    this.fpsInstant = 60;
    this.frameTimeSmooth = 16.6;
    this.cpuTickSmooth = 0;
    this.simStepSmooth = 0;
    this.meshBuildSmooth = 0;
    this.renderSubmitSmooth = 0;
    this.gpuTimeSmooth = null;
    this.gpuTimeLast = null;
  }

  public recordGpuTime(gpuMs: number): void {
    if (!Number.isFinite(gpuMs) || gpuMs < 0) return;
    // Clamp absurd outliers (> 5000ms after tab-hide resume)
    const clamped = Math.min(5000, gpuMs);
    this.gpuTimeLast = clamped;
    this.gpuTimeSmooth =
      this.gpuTimeSmooth === null ? clamped : this.gpuTimeSmooth * 0.85 + clamped * 0.15;
  }

  public recordCpuFrame(input: {
    frameIntervalMs: number;
    cpuTickMs: number;
    simStepMs: number;
    meshBuildMs: number;
    renderSubmitMs: number;
  }): void {
    const safeFrameMs =
      Number.isFinite(input.frameIntervalMs) && input.frameIntervalMs > 0
        ? Math.min(1000, input.frameIntervalMs)
        : 16.6;
    const instFps = Math.min(1000, 1000 / Math.max(0.5, safeFrameMs));

    this.fpsInstant = instFps;
    this.fpsSmooth = this.fpsSmooth * 0.88 + instFps * 0.12;
    this.frameTimeSmooth = this.frameTimeSmooth * 0.88 + safeFrameMs * 0.12;
    this.cpuTickSmooth = this.cpuTickSmooth * 0.85 + Math.max(0, input.cpuTickMs) * 0.15;
    this.simStepSmooth = this.simStepSmooth * 0.85 + Math.max(0, input.simStepMs) * 0.15;
    this.meshBuildSmooth = this.meshBuildSmooth * 0.85 + Math.max(0, input.meshBuildMs) * 0.15;
    this.renderSubmitSmooth =
      this.renderSubmitSmooth * 0.85 + Math.max(0, input.renderSubmitMs) * 0.15;

    const sample: PerfHistorySample = {
      frameMs: Number(safeFrameMs.toFixed(2)),
      gpuMs: this.gpuTimeLast !== null ? Number(this.gpuTimeLast.toFixed(2)) : null,
      cpuTickMs: Number(Math.max(0, input.cpuTickMs).toFixed(2)),
      simMs: Number(Math.max(0, input.simStepMs).toFixed(2)),
      meshMs: Number(Math.max(0, input.meshBuildMs).toFixed(2)),
      renderSubmitMs: Number(Math.max(0, input.renderSubmitMs).toFixed(2)),
    };

    if (this.frameRing.length < this.capacity) {
      this.frameRing.push(sample);
    } else {
      this.frameRing[this.head] = sample;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  public getOrderedHistory(): PerfHistorySample[] {
    if (this.frameRing.length < this.capacity) {
      return this.frameRing.slice();
    }
    const out: PerfHistorySample[] = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      out[i] = this.frameRing[(this.head + i) % this.capacity];
    }
    return out;
  }

  public buildSnapshot(meta: {
    backendInfo: BackendDiagnosticInfo;
    drawCalls: number;
    renderPasses: number;
    triangles: number;
    points: number;
    lines: number;
    geometriesCount: number;
    texturesCount: number;
    renderTargetsCount: number;
    gpuMemoryBytes: number;
    jsHeapUsedMb: number | null;
    jsHeapLimitMb: number | null;
    pixelRatio: number;
    canvasWidth: number;
    canvasHeight: number;
  }): PerformanceMetricsSnapshot {
    const history = this.getOrderedHistory();
    const frameTimes: number[] = [];
    const gpuTimes: number[] = [];
    for (let i = 0; i < history.length; i++) {
      frameTimes.push(history[i].frameMs);
      const g = history[i].gpuMs;
      if (g !== null) gpuTimes.push(g);
    }

    const frameTimeP95Ms =
      frameTimes.length > 0 ? computePercentile(frameTimes, 0.95, 'ceil') : this.frameTimeSmooth;
    const worstFrameMs =
      frameTimes.length > 0 ? computePercentile(frameTimes, 0.99, 'ceil') : this.frameTimeSmooth;
    const fpsAvg = Math.round(this.fpsSmooth);
    const fps1PercentLow = Math.min(
      fpsAvg,
      Math.max(1, Math.round(1000 / Math.max(0.5, worstFrameMs))),
    );
    const gpuTimeP95Ms =
      gpuTimes.length > 0 ? Number(computePercentile(gpuTimes, 0.95, 'ceil').toFixed(2)) : null;

    return {
      fps: fpsAvg,
      fps1PercentLow,
      fpsInstant: Math.round(this.fpsInstant),
      frameTimeMs: Number(this.frameTimeSmooth.toFixed(1)),
      cpuTickMs: Number(this.cpuTickSmooth.toFixed(2)),
      simStepMs: Number(this.simStepSmooth.toFixed(2)),
      meshBuildMs: Number(this.meshBuildSmooth.toFixed(2)),
      renderSubmitMs: Number(this.renderSubmitSmooth.toFixed(2)),
      gpuTimeMs: this.gpuTimeSmooth !== null ? Number(this.gpuTimeSmooth.toFixed(2)) : null,
      gpuTimeLastMs: this.gpuTimeLast !== null ? Number(this.gpuTimeLast.toFixed(2)) : null,
      gpuTimeP95Ms,
      frameTimeP95Ms: Number(frameTimeP95Ms.toFixed(1)),
      drawCalls: meta.drawCalls,
      renderPasses: meta.renderPasses,
      triangles: meta.triangles,
      points: meta.points,
      lines: meta.lines,
      geometriesCount: meta.geometriesCount,
      texturesCount: meta.texturesCount,
      renderTargetsCount: meta.renderTargetsCount,
      gpuMemoryBytes: meta.gpuMemoryBytes,
      jsHeapUsedMb: meta.jsHeapUsedMb,
      jsHeapLimitMb: meta.jsHeapLimitMb,
      pixelRatio: meta.pixelRatio,
      canvasWidth: meta.canvasWidth,
      canvasHeight: meta.canvasHeight,
      history,
      backendInfo: meta.backendInfo,
    };
  }
}
