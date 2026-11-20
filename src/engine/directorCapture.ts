/**
 * Pure utilities for deterministic Director Mode offline simulation substepping
 * and GPU RenderTarget RGBA readback normalization (WebGPU top-down & WebGL2 bottom-up).
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
