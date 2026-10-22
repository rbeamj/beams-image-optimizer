/** Pure helpers for click refinement (MobileSAM) and brush masks (MI-GAN). */

export type ClickPoint = { x: number; y: number; label: 0 | 1 };
export type RefineAction = 'keep' | 'erase';

/**
 * Soft selection from SAM probabilities: 0 below 0.3, 1 above 0.7, linear in between. Low-confidence pixels
 * (including the whole image away from the clicked object) are therefore left exactly as they were.
 */
export function selectionWeight(probability: number) {
  return Math.min(1, Math.max(0, (probability - 0.3) / 0.4));
}

/**
 * keep: raise the matte to the selection; erase: lower it. Pixels outside the selection are untouched. Erasing
 * grows the selection by `growPx` (needs `width`) so the soft fringe of a removed part does not linger as a halo.
 */
export function combineMatte(matte: Float32Array, probabilities: Float32Array, action: RefineAction, width = 0, growPx = 0): Float32Array {
  if (matte.length !== probabilities.length) throw new Error('Selection size does not match the matte.');
  const weights = new Float32Array(matte.length);
  for (let i = 0; i < matte.length; i++) weights[i] = selectionWeight(probabilities[i]!);
  if (action === 'erase' && growPx > 0 && width > 0) {
    const core = new Uint8Array(matte.length);
    for (let i = 0; i < core.length; i++) core[i] = weights[i]! >= 0.5 ? 1 : 0;
    const grown = blendWeights(core, width, matte.length / width, growPx * 2);
    for (let i = 0; i < weights.length; i++) weights[i] = Math.max(weights[i]!, grown[i]!);
  }
  const out = new Float32Array(matte.length);
  for (let i = 0; i < matte.length; i++) out[i] = action === 'keep' ? Math.max(matte[i]!, weights[i]!) : Math.min(matte[i]!, 1 - weights[i]!);
  return out;
}

/** Maps a point in base-image pixels into MobileSAM encoder coordinates (longest side 1024). */
export function toEncoderSpace(points: ClickPoint[], width: number, height: number, longest = 1024) {
  const scale = longest / Math.max(width, height);
  return { scale, coords: points.flatMap(p => [p.x * scale, p.y * scale]), labels: points.map(p => p.label) };
}

/** Encoder input size preserving aspect ratio (MobileSAM pads to 1024 internally). */
export function encoderSize(width: number, height: number, longest = 1024) {
  const scale = longest / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type Rect = { x: number; y: number; width: number; height: number };

/** Bounding box of mask pixels > 0, or null when the mask is empty. */
export function maskBounds(mask: Uint8Array, width: number, height: number): Rect | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Square context window for inpainting: the mask box plus generous surrounding context (the box is at most
 * half the window), at least `minSide`, shifted to stay inside the image and shrunk only if the image is smaller.
 */
export function cleanupWindow(box: Rect, width: number, height: number, minSide = 256): Rect {
  const side = Math.min(Math.max(width, height), Math.max(minSide, Math.ceil(Math.max(box.width, box.height) * 2)));
  const w = Math.min(side, width), h = Math.min(side, height);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), width - w));
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), height - h));
  return { x, y, width: w, height: h };
}

/** Grows a binary mask by `radius` pixels (square structuring element) and returns blend weights 0..1 with a soft rim. */
export function blendWeights(mask: Uint8Array, width: number, height: number, radius: number): Float32Array {
  const dist = new Float32Array(mask.length).fill(Infinity);
  for (let i = 0; i < mask.length; i++) if (mask[i]) dist[i] = 0;
  // Two-pass chamfer distance transform.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x > 0) dist[i] = Math.min(dist[i]!, dist[i - 1]! + 1);
    if (y > 0) dist[i] = Math.min(dist[i]!, dist[i - width]! + 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x < width - 1) dist[i] = Math.min(dist[i]!, dist[i + 1]! + 1);
    if (y < height - 1) dist[i] = Math.min(dist[i]!, dist[i + width]! + 1);
  }
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = dist[i]! <= radius / 2 ? 1 : dist[i]! >= radius ? 0 : 1 - (dist[i]! - radius / 2) / (radius / 2);
  return out;
}

/** Blends `filled` into `base` (both RGBA) by `weights`; pixels with weight 0 are copied unchanged. */
export function blendInto(base: Uint8ClampedArray, filled: Uint8ClampedArray, weights: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(base.length);
  out.set(base);
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    if (w <= 0) continue;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(base[i * 4 + c]! * (1 - w) + filled[i * 4 + c]! * w);
  }
  return out;
}

/** Index order of SAM candidate masks by predicted IoU (best first). */
export function rankCandidates(iou: ArrayLike<number>) {
  return Array.from({ length: iou.length }, (_, i) => i).sort((a, b) => iou[b]! - iou[a]!);
}
