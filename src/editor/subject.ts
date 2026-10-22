/**
 * Layered subject model: the photo pixels (`baseUrl`) and an optional alpha matte (`matteUrl`) are kept separate,
 * so removal, refinement, cleanup and enhancement can each be revisited without losing the others. The displayed
 * product is always composite(base, matte). Original file pixels are never modified.
 */
import type { RemovalMode } from '../ai/planner';

export type SubjectLayers = {
  baseUrl: string;
  width: number;
  height: number;
  matteUrl: string | null;
  removal?: { variantId: string; label: string; mode: RemovalMode };
  enhancedTo?: number;
  /** Accepted Magic Click and object-cleanup edits on this layer stack. */
  refined?: number;
  cleaned?: number;
};

export type UrlRegistry = (url: string) => string;

/** Multiplies existing alpha by the matte (0..1). RGB is copied unchanged, so product pixels are preserved. */
export function applyMatteAlpha(rgba: Uint8ClampedArray, matte: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  if (matte.length * 4 !== rgba.length) throw new Error('Matte size does not match image.');
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  for (let i = 0; i < matte.length; i++) out[i * 4 + 3] = Math.round(rgba[i * 4 + 3]! * Math.min(1, Math.max(0, matte[i]!)));
  return out;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image layer.'));
    img.src = url;
  });
}

export function context(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas rendering is unavailable.');
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** In-memory canvas holding RGBA pixels (no encoding), for fast previews. */
export function rgbaCanvas(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
  const { canvas, ctx } = context(width, height);
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

export function canvasToUrl(canvas: HTMLCanvasElement, register: UrlRegistry): Promise<string> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(register(URL.createObjectURL(blob))) : reject(new Error('Could not encode layer.')), 'image/png'));
}

export async function pixels(url: string, width: number, height: number) {
  const { ctx } = context(width, height);
  ctx.drawImage(await loadImage(url), 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export async function matteToUrl(matte: Float32Array, width: number, height: number, register: UrlRegistry) {
  const { canvas, ctx } = context(width, height);
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < matte.length; i++) { const v = Math.round(Math.min(1, Math.max(0, matte[i]!)) * 255); img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return canvasToUrl(canvas, register);
}

/** Reads a matte layer, resampling (bilinear) when the base was resized, e.g. after enhancement. */
export async function matteFromUrl(url: string, width: number, height: number) {
  const data = (await pixels(url, width, height)).data;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4]! / 255;
  return out;
}

export async function compositeUrl(layers: SubjectLayers, register: UrlRegistry) {
  if (!layers.matteUrl) return layers.baseUrl;
  const base = await pixels(layers.baseUrl, layers.width, layers.height);
  const matte = await matteFromUrl(layers.matteUrl, layers.width, layers.height);
  const { canvas, ctx } = context(layers.width, layers.height);
  ctx.putImageData(new ImageData(applyMatteAlpha(base.data, matte), layers.width, layers.height), 0, 0);
  return canvasToUrl(canvas, register);
}
