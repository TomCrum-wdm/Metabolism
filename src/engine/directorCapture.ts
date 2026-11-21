import { DirectorAspectMask, RgbHistogramBins } from './director';

/**
 * Pure utilities for deterministic Director Mode offline simulation substepping,
 * GPU RenderTarget RGBA readback normalization, 32-bin RGB histogram telemetry,
 * aspect-ratio matte framing, and checkpoint resume frame alignment.
 */

export interface OfflineSubstepSchedule {
  subSteps: number;
  subDt: number;
}

/**
 * Splits a frame's simulation delta `simDt` into stable physics substeps so no
 * simulation time is ever clamped/dropped even at low FPS (e.g. 24 FPS) or fast time scales.
 */
export function computeOfflineSubsteps(
  simDt: number,
  maxSubStepSec = 0.02,
): OfflineSubstepSchedule {
  if (!Number.isFinite(simDt) || simDt <= 0) {
    return { subSteps: 0, subDt: 0 };
  }
  const safeMax = Math.max(1e-4, maxSubStepSec);
  const subSteps = Math.max(1, Math.min(240, Math.ceil(simDt / safeMax)));
  return {
    subSteps,
    subDt: simDt / subSteps,
  };
}

/**
 * Normalizes GPU readback RGBA pixel data into top-down row order and enforces opaque alpha (255)
 * so WebCodecs VideoEncoder / 2D Canvas encoders never emit transparent-black or YUV green frames.
 */
export function normalizeReadbackRgbaToTopDown(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  flipY: boolean,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const rowBytes = width * 4;
  const totalBytes = rowBytes * height;
  const dst =
    out && out.length === totalBytes ? out : new Uint8ClampedArray(totalBytes);

  if (pixels.length < totalBytes) {
    return dst;
  }

  for (let y = 0; y < height; y++) {
    const srcY = flipY ? height - 1 - y : y;
    const srcOff = srcY * rowBytes;
    const dstOff = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 4) {
      dst[dstOff + x] = pixels[srcOff + x];
      dst[dstOff + x + 1] = pixels[srcOff + x + 1];
      dst[dstOff + x + 2] = pixels[srcOff + x + 2];
      dst[dstOff + x + 3] = 255;
    }
  }

  return dst;
}

export interface RgbaFrameStats {
  nonZeroRgbSamples: number;
  meanLuma: number;
  alphaMin: number;
  sampleCount: number;
}

/**
 * Samples an RGBA top-down buffer to verify non-empty image content and full opacity.
 */
export function analyzeRgbaFrameLuma(
  rgba: Uint8Array | Uint8ClampedArray,
  pixelStride = 64,
): RgbaFrameStats {
  const totalPixels = Math.floor(rgba.length / 4);
  if (totalPixels <= 0) {
    return { nonZeroRgbSamples: 0, meanLuma: 0, alphaMin: 0, sampleCount: 0 };
  }
  const step = Math.max(1, Math.floor(pixelStride));
  let nonZeroRgbSamples = 0;
  let lumaSum = 0;
  let alphaMin = 255;
  let sampleCount = 0;

  for (let p = 0; p < totalPixels; p += step) {
    const o = p * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const a = rgba[o + 3];
    if (r > 0 || g > 0 || b > 0) nonZeroRgbSamples++;
    if (a < alphaMin) alphaMin = a;
    lumaSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sampleCount++;
  }

  return {
    nonZeroRgbSamples,
    meanLuma: sampleCount > 0 ? lumaSum / sampleCount : 0,
    alphaMin,
    sampleCount,
  };
}

/**
 * Computes normalized 32-bin (or custom N-bin) RGB & Luma distributions for live waveform/histogram inspection.
 */
export function computeRgbHistogram(
  rgba: Uint8Array | Uint8ClampedArray,
  bins = 32,
  pixelStride = 48,
): RgbHistogramBins {
  const nBins = Math.max(8, Math.min(128, Math.round(bins)));
  const rArr = new Array<number>(nBins).fill(0);
  const gArr = new Array<number>(nBins).fill(0);
  const bArr = new Array<number>(nBins).fill(0);
  const lArr = new Array<number>(nBins).fill(0);

  const totalPixels = Math.floor(rgba.length / 4);
  if (totalPixels <= 0) {
    return {
      bins: nBins,
      r: rArr,
      g: gArr,
      b: bArr,
      luma: lArr,
      meanLuma: 0,
      alphaMin: 0,
      clipHighPct: 0,
      clipLowPct: 0,
    };
  }

  const step = Math.max(1, Math.floor(pixelStride));
  let count = 0;
  let lumaSum = 0;
  let alphaMin = 255;
  let clipHigh = 0;
  let clipLow = 0;

  for (let p = 0; p < totalPixels; p += step) {
    const o = p * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const a = rgba[o + 3];
    if (a < alphaMin) alphaMin = a;

    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumaSum += luma;
    if (luma >= 250) clipHigh++;
    if (luma <= 4) clipLow++;

    const br = Math.min(nBins - 1, Math.floor((r / 256) * nBins));
    const bg = Math.min(nBins - 1, Math.floor((g / 256) * nBins));
    const bb = Math.min(nBins - 1, Math.floor((b / 256) * nBins));
    const bl = Math.min(nBins - 1, Math.floor((Math.min(255, luma) / 256) * nBins));

    rArr[br]++;
    gArr[bg]++;
    bArr[bb]++;
    lArr[bl]++;
    count++;
  }

  let peak = 1;
  for (let i = 0; i < nBins; i++) {
    if (rArr[i] > peak) peak = rArr[i];
    if (gArr[i] > peak) peak = gArr[i];
    if (bArr[i] > peak) peak = bArr[i];
    if (lArr[i] > peak) peak = lArr[i];
  }
  for (let i = 0; i < nBins; i++) {
    rArr[i] = Number((rArr[i] / peak).toFixed(4));
    gArr[i] = Number((gArr[i] / peak).toFixed(4));
    bArr[i] = Number((bArr[i] / peak).toFixed(4));
    lArr[i] = Number((lArr[i] / peak).toFixed(4));
  }

  return {
    bins: nBins,
    r: rArr,
    g: gArr,
    b: bArr,
    luma: lArr,
    meanLuma: count > 0 ? lumaSum / count : 0,
    alphaMin,
    clipHighPct: count > 0 ? Number(((clipHigh / count) * 100).toFixed(1)) : 0,
    clipLowPct: count > 0 ? Number(((clipLow / count) * 100).toFixed(1)) : 0,
  };
}

/**
 * Draws cinema letterbox / pillarbox bars directly onto a rendered 2D canvas frame when aspectMask !== 'none'.
 */
export function applyAspectMatteToCanvas2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  aspectMask: DirectorAspectMask,
): void {
  if (aspectMask === 'none' || width <= 0 || height <= 0) return;
  const targetRatio =
    aspectMask === '2.39:1'
      ? 2.39
      : aspectMask === '16:9'
        ? 16 / 9
        : 9 / 16;
  const curRatio = width / height;
  ctx.save();
  ctx.fillStyle = '#000000';
  if (curRatio < targetRatio - 0.01) {
    // Letterbox top & bottom
    const activeH = Math.round(width / targetRatio);
    const barH = Math.max(0, Math.floor((height - activeH) / 2));
    if (barH > 0) {
      ctx.fillRect(0, 0, width, barH);
      ctx.fillRect(0, height - barH, width, barH);
    }
  } else if (curRatio > targetRatio + 0.01) {
    // Pillarbox left & right (e.g. 9:16 vertical short framing)
    const activeW = Math.round(height * targetRatio);
    const barW = Math.max(0, Math.floor((width - activeW) / 2));
    if (barW > 0) {
      ctx.fillRect(0, 0, barW, height);
      ctx.fillRect(width - barW, 0, barW, height);
    }
  }
  ctx.restore();
}

/**
 * Aligns checkpoint resumption to the latest clean SimulationCheckpoint at or before completedFrames.
 * For WebM VP8/VP9, GOP delta frames depend on the prior keyframe so resuming starts on a saved keyframe boundary.
 */
export function computeCheckpointResumeStartFrame(params: {
  startFrame: number;
  endFrame: number;
  latestCheckpointFrame: number | null;
}): number {
  const { startFrame, endFrame, latestCheckpointFrame } = params;
  if (latestCheckpointFrame === null || latestCheckpointFrame < startFrame) {
    return startFrame;
  }
  return Math.max(startFrame, Math.min(endFrame + 1, latestCheckpointFrame));
}

/**
 * Uploads top-down RGBA bytes into an opaque 2D canvas and optionally resamples
 * into a different-resolution destination 2D canvas.
 */
export function blitRgbaTopDownToCanvas2D(
  rgbaTopDown: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  srcCanvas: HTMLCanvasElement,
  srcCtx: CanvasRenderingContext2D,
  dstCanvas?: HTMLCanvasElement,
  dstCtx?: CanvasRenderingContext2D | null,
  cachedImageData?: ImageData | null,
): ImageData {
  if (srcCanvas.width !== srcW || srcCanvas.height !== srcH) {
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
  }
  const imgData =
    cachedImageData && cachedImageData.width === srcW && cachedImageData.height === srcH
      ? cachedImageData
      : srcCtx.createImageData(srcW, srcH);
  imgData.data.set(rgbaTopDown);
  srcCtx.putImageData(imgData, 0, 0);

  if (dstCanvas && dstCtx && (dstCanvas !== srcCanvas || dstCanvas.width !== srcW || dstCanvas.height !== srcH)) {
    dstCtx.fillStyle = '#040711';
    dstCtx.fillRect(0, 0, dstCanvas.width, dstCanvas.height);
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.imageSmoothingQuality = 'high';
    dstCtx.drawImage(srcCanvas, 0, 0, dstCanvas.width, dstCanvas.height);
  }
  return imgData;
}
