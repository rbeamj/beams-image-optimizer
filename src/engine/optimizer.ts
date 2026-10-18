import { dimensionsWithinEdge, mimeFor, outputFilename, qualityNumber } from './math';
import type { ImageResult, OptimizeOptions, ProgressEvent } from './types';
import { runBatch } from './batch';

const throwIfAborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Optimization cancelled.', 'AbortError'); };
async function decode(file: File) {
  if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(file);
  try { const image = await new Promise<HTMLImageElement>((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error(`Unable to decode ${file.name}.`)); el.src = url; }); return image; } finally { URL.revokeObjectURL(url); }
}
function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) { return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Your browser could not encode this image format.')), type, quality)); }
export async function optimizeImage(file: File, options: OptimizeOptions): Promise<ImageResult> {
  throwIfAborted(options.signal);
  const source = await decode(file); throwIfAborted(options.signal);
  const sourceWidth = source instanceof ImageBitmap ? source.width : source.naturalWidth;
  const sourceHeight = source instanceof ImageBitmap ? source.height : source.naturalHeight;
  const { width, height } = dimensionsWithinEdge(sourceWidth, sourceHeight, options.maxEdge);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas rendering is unavailable.');
  if (options.format === 'jpeg') { context.fillStyle = options.background || '#ffffff'; context.fillRect(0, 0, width, height); }
  context.drawImage(source, 0, 0, width, height); if (source instanceof ImageBitmap) source.close();
  throwIfAborted(options.signal);
  const blob = await canvasBlob(canvas, mimeFor(options.format), qualityNumber(options.quality)); throwIfAborted(options.signal);
  return { blob, filename: outputFilename(file.name, options.format), sourceBytes: file.size, outputBytes: blob.size, sourceWidth, sourceHeight, width, height, format: options.format };
}
export async function optimizeBatch(files: File[], options: OptimizeOptions, onProgress?: (event: ProgressEvent) => void) {
  return runBatch(files, file => optimizeImage(file, options), onProgress) as Promise<ImageResult[]>;
}
