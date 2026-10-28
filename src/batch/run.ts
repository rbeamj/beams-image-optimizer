/**
 * Applies one Studio preset to one queue photo: decode → (AI cutout) → headless scene compose → export
 * with the Quick Optimize recipe. The scene graph comes from editor/compose.ts, the cutout from the same
 * adaptive engine the Studio panel uses, so a batch result matches a single Studio export.
 */
import type { RemovalMode } from '../ai/planner';
import type { RemovalEngine } from '../ai/removal-engine';
import { removeAdaptive } from '../bgremove/adaptive';
import { composeScene, imageAlphaBounds } from '../editor/compose';
import { applyMatteAlpha, canvasToUrl, loadImage, matteFromUrl, matteToUrl, pixels, rgbaCanvas } from '../editor/subject';
import { studioEdge } from '../editor/tools';
import { optimizeImage } from '../engine/optimizer';
import type { ImageResult } from '../engine/types';
import { placeSubject } from '../editor/scene';
import { cutoutKey, type BatchPreset, type PresetRecipe } from './presets';

export type { PresetRecipe };
export type StoredMatte = { blob: Blob; key: string };
export type PresetTimings = { decodeMs: number; cutoutMs: number; layoutMs: number; encodeMs: number };
export type PresetImageResult = ImageResult & { presetId: string; presetLabel: string; timings: PresetTimings; matte?: StoredMatte; matteReused?: boolean };

/** Native-resolution frames above this are pre-scaled so composition stays within device canvas budgets. */
const FRAME_PIXEL_CAP = 40e6;

const checkAborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Batch cancelled.', 'AbortError'); };

const canvasBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Your browser could not render this scene.')), 'image/png'));

/** Scales the subject down when the native frame would exceed the canvas cap; visible bounds scale with it. */
function fitWithinCanvasBudget(subject: HTMLImageElement | HTMLCanvasElement, width: number, height: number, visible: { left: number; top: number; width: number; height: number } | undefined, preset: BatchPreset) {
  if (!visible) return { subject, width, height, visible };
  const probe = placeSubject({ width, height }, visible, preset.scene, preset.adjustments.rotation, preset.adjustments.flipX, preset.adjustments.flipY);
  const factor = Math.min(1, Math.sqrt(FRAME_PIXEL_CAP / (probe.frame.width * probe.frame.height)));
  if (factor >= 1) return { subject, width, height, visible };
  const scaled = document.createElement('canvas');
  scaled.width = Math.max(1, Math.round(width * factor));
  scaled.height = Math.max(1, Math.round(height * factor));
  const ctx = scaled.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(subject, 0, 0, scaled.width, scaled.height);
  return {
    subject: scaled,
    width: scaled.width,
    height: scaled.height,
    visible: { left: visible.left * factor, top: visible.top * factor, width: visible.width * factor, height: visible.height * factor },
  };
}

export async function presetImage(file: File, preset: BatchPreset, engine: RemovalEngine, recipe: PresetRecipe, options: { signal?: AbortSignal; onStage?: (label: string) => void; reuse?: StoredMatte } = {}): Promise<PresetImageResult> {
  checkAborted(options.signal);
  const started = performance.now();
  const url = URL.createObjectURL(file);
  const stagedUrls: string[] = [];
  try {
    const photo = await loadImage(url);
    let width = photo.naturalWidth, height = photo.naturalHeight;
    if (!(width > 0) || !(height > 0)) throw new Error('This image could not be decoded.');
    const decodedMs = performance.now() - started;
    let subject: HTMLImageElement | HTMLCanvasElement = photo;
    let visible: { left: number; top: number; width: number; height: number } | undefined;
    let cutoutMs = 0;
    let storedMatte: { blob: Blob; key: string } | undefined;
    let matteReused = false;
    if (preset.cutout) {
      const key = cutoutKey(preset, width, height);
      const rgba = (await pixels(url, width, height)).data;
      let matte: Float32Array | undefined;
      // A matte stored by an earlier run of the same cutout settings on this photo can be reused as-is,
      // skipping the 8-11 s model run. It is the same quantized PNG the Studio composites from, so a
      // reused composite matches a fresh one.
      if (options.reuse && options.reuse.key === key) {
        const reuseUrl = URL.createObjectURL(options.reuse.blob);
        try {
          matte = await matteFromUrl(reuseUrl, width, height);
          storedMatte = { blob: options.reuse.blob, key };
          matteReused = true;
          options.onStage?.('reusing the stored cutout');
        } catch {
          matte = undefined; // corrupt stored matte: fall through to a fresh cutout
        } finally {
          URL.revokeObjectURL(reuseUrl);
        }
      }
      if (!matte) {
        const cutoutStarted = performance.now();
        checkAborted(options.signal);
        const removal = await removeAdaptive(photo, rgba, width, height, engine, {
          mode: preset.mode as RemovalMode,
          cleanup: preset.cleanup,
          refine: preset.refine,
          onStatus: status => options.onStage?.(status.label),
        });
        cutoutMs = performance.now() - cutoutStarted;
        // Quantize through the same PNG chain the Studio uses, and keep the PNG so later runs of the
        // same cutout settings can reuse it instead of re-running the model.
        const mattePngUrl = await matteToUrl(removal.matte, width, height, staged => { stagedUrls.push(staged); return staged; });
        matte = await matteFromUrl(mattePngUrl, width, height);
        storedMatte = { blob: await fetch(mattePngUrl).then(response => response.blob()), key };
      }
      // Mirror the Studio's layer chain (composite → PNG → decoded image) before measuring bounds or
      // composing: canvas sources and decoded images downscale differently, and the editor lays out
      // from the decoded image. Skipping this shifts the frame by a sample pixel and breaks parity.
      const matted = rgbaCanvas(applyMatteAlpha(rgba, matte), width, height);
      const mattedUrl = await canvasToUrl(matted, staged => { stagedUrls.push(staged); return staged; });
      subject = await loadImage(mattedUrl);
      visible = imageAlphaBounds(subject);
      checkAborted(options.signal);
    }
    if (preset.backdrop.kind !== 'none') {
      const fitted = fitWithinCanvasBudget(subject, width, height, visible, preset);
      subject = fitted.subject; width = fitted.width; height = fitted.height; visible = fitted.visible;
    }
    options.onStage?.('placing on the backdrop');
    const layoutStarted = performance.now();
    const backdropImage = preset.backdropImage ?? (preset.backdrop.kind === 'image' ? await loadImage(preset.backdrop.url) : undefined);
    const composed = composeScene({ subject, width, height, visible, scene: preset.scene, backdrop: preset.backdrop, adjustments: preset.adjustments, backdropImage });
    const layoutMs = performance.now() - layoutStarted;
    const encodedStarted = performance.now();
    const staged = new File([await canvasBlob(composed.canvas)], file.name, { type: 'image/png' });
    const encoded = await optimizeImage(staged, { format: recipe.format, quality: recipe.quality, maxEdge: studioEdge(recipe.maxEdge), background: recipe.background, signal: options.signal });
    return {
      ...encoded,
      // Savings stay honest: compare the output against the photo the user gave us, not the intermediate PNG.
      sourceBytes: file.size,
      sourceWidth: photo.naturalWidth,
      sourceHeight: photo.naturalHeight,
      presetId: preset.id,
      presetLabel: preset.label,
      matte: storedMatte,
      matteReused,
      timings: {
        decodeMs: Math.round(decodedMs),
        cutoutMs: Math.round(cutoutMs),
        layoutMs: Math.round(layoutMs),
        encodeMs: Math.round(performance.now() - encodedStarted),
      },
    };
  } finally {
    for (const staged of stagedUrls) URL.revokeObjectURL(staged);
    URL.revokeObjectURL(url);
  }
}
