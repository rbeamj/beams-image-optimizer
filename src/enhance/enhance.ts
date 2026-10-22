import { createInputTensor, getEnhanceSession } from './runtime';
import { enhanceOutputSize, estimatePeakBytes, modelInputSize } from './sizing';
import { nchwToRgba, rgbaToNchw } from './tensor';
import { DEFAULT_MODEL_URL, type EnhanceOptions, type EnhanceResult } from './types';

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Enhancement cancelled.', 'AbortError');
};

function drawToSize(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas rendering is unavailable.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return { canvas, ctx };
}

export function sourceSize(source: CanvasImageSource) {
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return { width: source.width, height: source.height };
  if (source instanceof HTMLCanvasElement) return { width: source.width, height: source.height };
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) return { width: source.width, height: source.height };
  throw new Error('Unsupported image source for enhancement.');
}

/** Plain high-quality canvas resize to the same output size, for a fair AI-versus-resize comparison. */
export function resizeBaseline(source: CanvasImageSource, width: number, height: number) {
  return drawToSize(source, width, height).canvas;
}

/**
 * Optional local Real-ESRGAN pass. Pre-scales so 4× output matches the chosen longest edge,
 * then lightly downscales if the network overshoots by a pixel or two.
 */
export async function enhanceImage(source: CanvasImageSource, options: EnhanceOptions): Promise<EnhanceResult> {
  throwIfAborted(options.signal);
  const started = performance.now();
  const { width: sourceWidth, height: sourceHeight } = sourceSize(source);
  const input = modelInputSize(sourceWidth, sourceHeight, options.targetEdge);
  options.onProgress?.(0.05, 'Preparing pixels');
  const prepared = drawToSize(source, input.width, input.height);
  const rgba = prepared.ctx.getImageData(0, 0, input.width, input.height).data;
  const nchw = rgbaToNchw(rgba, input.width, input.height);
  throwIfAborted(options.signal);
  options.onProgress?.(0.2, 'Loading model');
  const { session, provider } = await getEnhanceSession(options.modelUrl ?? DEFAULT_MODEL_URL);
  throwIfAborted(options.signal);
  options.onProgress?.(0.35, `Running ${provider.toUpperCase()}`);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error('Real-ESRGAN model I/O names are missing.');
  const tensor = await createInputTensor(nchw, input.width, input.height);
  const outputs = await session.run({ [inputName]: tensor });
  throwIfAborted(options.signal);
  options.onProgress?.(0.85, 'Encoding result');
  const output = outputs[outputName];
  if (!output) throw new Error('Real-ESRGAN produced no output tensor.');
  const outHeight = Number(output.dims[2]);
  const outWidth = Number(output.dims[3]);
  const outRgba = nchwToRgba(output.data as Float32Array, outWidth, outHeight);
  const raw = document.createElement('canvas');
  raw.width = outWidth;
  raw.height = outHeight;
  const rawCtx = raw.getContext('2d');
  if (!rawCtx) throw new Error('Canvas rendering is unavailable.');
  rawCtx.putImageData(new ImageData(outRgba, outWidth, outHeight), 0, 0);
  const finalSize = enhanceOutputSize(input.width, input.height, options.targetEdge);
  const final = finalSize.width === outWidth && finalSize.height === outHeight ? raw : drawToSize(raw, finalSize.width, finalSize.height).canvas;
  options.onProgress?.(1, 'Done');
  return {
    canvas: final,
    width: final.width,
    height: final.height,
    sourceWidth,
    sourceHeight,
    modelInputWidth: input.width,
    modelInputHeight: input.height,
    provider,
    elapsedMs: Math.round(performance.now() - started),
    peakBytesEstimate: estimatePeakBytes(input.width, input.height),
  };
}
