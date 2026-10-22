/**
 * Hardware-adaptive background segmentation. Plans an ordered list of model variants for the device and mode,
 * runs each in its own worker, and falls back to the next on any load, memory, timeout or inference failure.
 * The seller's image is only read, never modified, so a failed attempt cannot lose edits.
 */
import { detectCapabilities, type DeviceCaps } from './capabilities';
import { deviceSignature, loadProfile, recordResult } from './device-profile';
import { MODEL_BASE, modelUrl, resolveModel, variantById, type ModelVariant } from './models';
import { OrtWorkerClient, OrtWorkerError, type LoadInfo } from './ort-client';
import { describeMode, planRemoval, type RemovalMode } from './planner';
import { maskFromOutput, toModelTensor } from '../bgremove/matte';

export type Manifest = { files: Record<string, { bytes: number }> } | null;
export type SegmentStatus = { stage: 'download' | 'init' | 'infer' | 'fallback'; label: string; loaded?: number; total?: number };
export type SegmentResult = {
  mask: Float32Array; width: number; height: number;
  variant: ModelVariant;
  timings: { downloadMs: number; initMs: number; inferMs: number; fromCache: boolean; wasmHeapMB: number | null };
  fallbacks: { variantId: string; reason: string }[];
  notes: string[];
};

const IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] } as const;

export const wasmAssetBase = () => new URL('ort/', document.baseURI).href;

export async function loadManifest(base = MODEL_BASE): Promise<Manifest> {
  try {
    const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    return res.ok ? await res.json() as Manifest : null;
  } catch { return null; }
}

/** Square-resizes the source to the model input and returns NCHW float32 with ImageNet normalisation. */
function modelInput(source: CanvasImageSource, size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size, size);
  return toModelTensor(ctx.getImageData(0, 0, size, size).data, size, size, IMAGENET.mean, IMAGENET.std);
}

/** Bilinear upsampling of the model mask to the source size via canvas (matches the benchmark pipeline). */
function upsampleMask(mask: Float32Array, size: number, width: number, height: number) {
  const small = document.createElement('canvas');
  small.width = size; small.height = size;
  const sctx = small.getContext('2d')!;
  const px = sctx.createImageData(size, size);
  for (let i = 0; i < mask.length; i++) { const v = Math.round(mask[i]! * 255); px.data[i * 4] = v; px.data[i * 4 + 1] = v; px.data[i * 4 + 2] = v; px.data[i * 4 + 3] = 255; }
  sctx.putImageData(px, 0, 0);
  const full = document.createElement('canvas');
  full.width = width; full.height = height;
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(small, 0, 0, width, height);
  const data = fctx.getImageData(0, 0, width, height).data;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4]! / 255;
  return out;
}

export class RemovalEngine {
  private caps?: Promise<DeviceCaps>;
  private manifest?: Promise<Manifest>;
  private client?: OrtWorkerClient;
  private loaded?: { variantId: string; info: LoadInfo };

  constructor(private readonly options: { modelBase?: string; createClient?: () => OrtWorkerClient } = {}) {}

  capabilities() { return (this.caps ??= detectCapabilities()); }
  installed() { return (this.manifest ??= loadManifest(this.options.modelBase)); }

  async signature() { return deviceSignature(await this.capabilities()); }

  async describe(mode: RemovalMode) {
    const caps = await this.capabilities();
    return describeMode(caps, mode, loadProfile(deviceSignature(caps)));
  }

  /** Frees model memory (terminates the worker). The next segment() reloads from the persistent cache. */
  release() {
    this.client?.terminate('Released');
    this.client = undefined;
    this.loaded = undefined;
  }

  async segment(source: CanvasImageSource, width: number, height: number, mode: RemovalMode, onStatus?: (status: SegmentStatus) => void): Promise<SegmentResult> {
    const caps = await this.capabilities();
    const signature = deviceSignature(caps);
    const plan = planRemoval(caps, mode, loadProfile(signature));
    const manifest = await this.installed();
    const fallbacks = [...plan.unavailable];
    for (const id of plan.attempts) {
      const variant = variantById(id);
      const resolved = resolveModel(variant.file, manifest, document.baseURI);
      const expectedBytes = resolved.bytes;
      try {
        // QA hook: ?ai-fail=<variantId>[,<variantId>] simulates an out-of-memory failure to exercise fallback.
        const simulated = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('ai-fail')?.split(',') ?? [] : [];
        if (simulated.includes(id)) throw new OrtWorkerError('Simulated out-of-memory failure (ai-fail)', 'oom');
        if (this.loaded?.variantId !== id) {
          this.release();
          this.client = this.options.createClient?.() ?? new OrtWorkerClient();
          onStatus?.({ stage: 'download', label: `Loading ${variant.label}`, loaded: 0, total: expectedBytes });
          const info = await this.client.load(
            { url: resolved.url, expectedBytes, sha256: resolved.sha256, patchUrl: resolved.patchUrl, provider: variant.provider, wasmPaths: wasmAssetBase(), threads: crossOriginIsolated ? Math.min(4, caps.cores) : 1 },
            (loaded, total) => onStatus?.({ stage: 'download', label: `Loading ${variant.label}`, loaded, total }),
            10 * 60_000,
          );
          this.loaded = { variantId: id, info };
        }
        const size = variant.inputSize ?? 512;
        onStatus?.({ stage: 'infer', label: `Removing background with ${variant.label}` });
        const input = modelInput(source, size);
        const run = await this.client!.run(this.loaded.info.sessionId, { [this.loaded.info.inputNames[0]!]: { type: 'float32', data: input.buffer as ArrayBuffer, dims: [1, 3, size, size] } }, variant.timeoutMs);
        const output = run.outputs[this.loaded.info.outputNames[0]!];
        if (!output || output.dims.at(-1) !== size) throw new OrtWorkerError(`Unexpected output from ${variant.label}`, 'other');
        const small = maskFromOutput(new Float32Array(output.data), variant.family === 'u2netp' ? 'none' : 'sigmoid', variant.family === 'u2netp' ? 'minmax' : 'none');
        recordResult(signature, id, { ok: true, ms: run.ms });
        const info = this.loaded.info;
        return {
          mask: upsampleMask(small, size, width, height), width, height, variant,
          timings: { downloadMs: info.downloadMs, initMs: info.initMs, inferMs: run.ms, fromCache: info.fromCache, wasmHeapMB: run.wasmHeapMB ?? info.wasmHeapMB },
          fallbacks, notes: plan.notes,
        };
      } catch (error) {
        const kind = error instanceof OrtWorkerError ? error.kind : 'other';
        const reason = `${kind}: ${String((error as Error).message).slice(0, 160)}`;
        // Missing files are an install problem, not a device limitation; do not mark the device.
        if (kind !== 'download') recordResult(signature, id, { ok: false, reason });
        fallbacks.push({ variantId: id, reason });
        this.release();
        onStatus?.({ stage: 'fallback', label: `${variant.label} failed (${kind}); trying a lighter option` });
      }
    }
    throw new Error(plan.notes[0] ?? `No background-removal model could run on this device${fallbacks.every(f => /download/.test(f.reason)) ? ' because the model could not be downloaded; check your connection and try again' : ''}. Details: ${fallbacks.map(f => `${f.variantId}: ${f.reason}`).join('; ')}`);
  }
}

export const modelUrlFor = (id: string) => modelUrl(variantById(id));
