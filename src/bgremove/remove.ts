import { applyMatte, maskFromOutput, MATTE_ADAPTERS, toModelTensor, type EdgeCleanup, type MatteModelId } from './matte';
import { guidedFilter, luminance, refineRadius } from './refine';
import { matteSession, matteTensor, type MatteProvider } from './runtime';

export type RemovalOptions = {
  model: MatteModelId;
  provider: MatteProvider;
  cleanup: EdgeCleanup;
  /** Edge-aware upsampling of the low-resolution mask, guided by the full-resolution photo. */
  refine?: boolean;
  /** Folder holding the ONNX files. Default: ./models/ */
  modelBase?: string;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
};

export type RemovalResult = {
  canvas: HTMLCanvasElement;
  /** Model mask scaled to the source size (0..1 alpha per pixel), for comparison and metrics. */
  mask: Float32Array;
  width: number;
  height: number;
  model: MatteModelId;
  provider: MatteProvider;
  inferenceMs: number;
  totalMs: number;
};

export const MAX_REFINE_PIXELS = 16_000_000;

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Background removal cancelled.', 'AbortError');
};

function sizeOf(source: CanvasImageSource) {
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  if (source instanceof HTMLCanvasElement || (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)) return { width: source.width, height: source.height };
  throw new Error('Unsupported image source for background removal.');
}

function context(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas rendering is unavailable.');
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/**
 * Browser-local cutout: the model sees a square resize of the photo, and its mask is scaled back
 * to full resolution and applied as alpha. RGB pixels are copied unchanged.
 */
export async function removeBackground(source: CanvasImageSource, options: RemovalOptions): Promise<RemovalResult> {
  const started = performance.now();
  const adapter = MATTE_ADAPTERS[options.model];
  if (!adapter.providers.includes(options.provider)) throw new Error(`${adapter.label} requires ${adapter.providers.join(' or ').toUpperCase()}.`);
  const { width, height } = sizeOf(source);
  const size = adapter.inputSize;
  throwIfAborted(options.signal);

  options.onProgress?.('Preparing pixels');
  const small = context(size, size);
  small.ctx.drawImage(source, 0, 0, size, size);
  const input = toModelTensor(small.ctx.getImageData(0, 0, size, size).data, size, size, adapter.mean, adapter.std);

  options.onProgress?.(`Loading ${adapter.label}`);
  const session = await matteSession(`${options.modelBase ?? './models/'}${adapter.file}`, options.provider);
  throwIfAborted(options.signal);

  options.onProgress?.(`Segmenting with ${options.provider.toUpperCase()}`);
  const inferStart = performance.now();
  const outputs = await session.run({ [session.inputNames[0]!]: await matteTensor(options.provider, input, size) });
  const inferenceMs = performance.now() - inferStart;
  throwIfAborted(options.signal);
  const raw = outputs[session.outputNames[0]!];
  if (!raw) throw new Error('The segmentation model returned no mask.');
  if (raw.dims.length !== 4 || Number(raw.dims[2]) !== size || Number(raw.dims[3]) !== size) throw new Error(`Unexpected mask shape [${raw.dims.join(', ')}] from ${adapter.label}.`);
  const mask = maskFromOutput(raw.data as Float32Array, adapter.activation, adapter.normalize);

  options.onProgress?.('Applying mask');
  const maskSmall = context(size, size);
  const maskPixels = maskSmall.ctx.createImageData(size, size);
  for (let i = 0; i < mask.length; i += 1) {
    const v = Math.round(mask[i]! * 255);
    maskPixels.data[i * 4] = v; maskPixels.data[i * 4 + 1] = v; maskPixels.data[i * 4 + 2] = v; maskPixels.data[i * 4 + 3] = 255;
  }
  maskSmall.ctx.putImageData(maskPixels, 0, 0);
  const maskFull = context(width, height);
  maskFull.ctx.drawImage(maskSmall.canvas, 0, 0, width, height);
  const maskRgba = maskFull.ctx.getImageData(0, 0, width, height).data;
  let fullMask: Float32Array = new Float32Array(width * height);
  for (let i = 0; i < fullMask.length; i += 1) fullMask[i] = maskRgba[i * 4]! / 255;

  const out = context(width, height);
  out.ctx.drawImage(source, 0, 0);
  const pixels = out.ctx.getImageData(0, 0, width, height);
  // The guided filter keeps ~10 full-size float buffers; skip it on very large photos to avoid OOM.
  if (options.refine && width * height <= MAX_REFINE_PIXELS) {
    options.onProgress?.('Refining edges');
    fullMask = guidedFilter(luminance(pixels.data, width, height), fullMask, width, height, refineRadius(width, height, size), 1e-4);
    for (let i = 0; i < fullMask.length; i += 1) maskRgba[i * 4] = Math.round(fullMask[i]! * 255);
  }
  pixels.data.set(applyMatte(pixels.data, maskRgba, options.cleanup));
  out.ctx.putImageData(pixels, 0, 0);
  return { canvas: out.canvas, mask: fullMask, width, height, model: options.model, provider: options.provider, inferenceMs: Math.round(inferenceMs), totalMs: Math.round(performance.now() - started) };
}
