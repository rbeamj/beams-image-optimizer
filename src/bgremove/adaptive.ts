import type { RemovalEngine, SegmentResult, SegmentStatus } from '../ai/removal-engine';
import type { RemovalMode } from '../ai/planner';
import { edgeCurve, type EdgeCleanup } from './matte';
import { guidedFilter, luminance, refineRadius } from './refine';
import { MAX_REFINE_PIXELS } from './remove';

export type AdaptiveRemoval = { matte: Float32Array; segment: SegmentResult; totalMs: number };

/**
 * Hardware-adaptive removal: the engine picks and falls back between BiRefNet 1024/512 and U²-Netp; the mask is
 * then refined with the photo's own edges (guided filter, for ≤512-input models where it measurably helps) and the
 * seller's edge setting. Returns a matte only; pixels are applied later as a layer.
 */
export async function removeAdaptive(source: HTMLImageElement | HTMLCanvasElement, rgba: Uint8ClampedArray, width: number, height: number, engine: RemovalEngine, options: { mode: RemovalMode; cleanup: EdgeCleanup; refine: boolean; onStatus?: (status: SegmentStatus) => void }): Promise<AdaptiveRemoval> {
  const started = performance.now();
  const segment = await engine.segment(source, width, height, options.mode, options.onStatus);
  let matte = segment.mask;
  const lowRes = (segment.variant.inputSize ?? 512) <= 512;
  if (options.refine && lowRes && width * height <= MAX_REFINE_PIXELS) {
    options.onStatus?.({ stage: 'infer', label: 'Refining edges' });
    matte = guidedFilter(luminance(rgba, width, height), matte, width, height, refineRadius(width, height, segment.variant.inputSize ?? 512), 1e-4);
  }
  const out = new Float32Array(matte.length);
  for (let i = 0; i < out.length; i++) out[i] = edgeCurve(matte[i]!, options.cleanup);
  return { matte: out, segment, totalMs: Math.round(performance.now() - started) };
}
