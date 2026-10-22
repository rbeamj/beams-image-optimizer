export type MatteModelId = 'u2netp' | 'birefnet-lite';
export type EdgeCleanup = 'soft' | 'balanced' | 'crisp';
export type MatteAdapter = {
  id: MatteModelId;
  label: string;
  file: string;
  bytes: number;
  inputSize: number;
  mean: [number, number, number];
  std: [number, number, number];
  activation: 'none' | 'sigmoid';
  normalize: 'minmax' | 'none';
  license: string;
  trainingData: string;
  /** Execution providers this model is allowed to use; BiRefNet needs far more memory than wasm32 can address. */
  providers: ('wasm' | 'webgpu')[];
};

export const MATTE_ADAPTERS: Record<MatteModelId, MatteAdapter> = {
  u2netp: {
    id: 'u2netp',
    label: 'Fast (U²-Netp, 4.6 MB)',
    file: 'u2netp.onnx',
    bytes: 4574861,
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    activation: 'none',
    normalize: 'minmax',
    license: 'Apache-2.0 (xuebinqin/U-2-Net)',
    trainingData: 'DUTS-TR (per the U²-Net paper; dataset terms not stated upstream)',
    providers: ['wasm', 'webgpu'],
  },
  'birefnet-lite': {
    id: 'birefnet-lite',
    label: 'Detailed (BiRefNet lite, 115 MB)',
    file: 'birefnet-lite-fp16.onnx',
    bytes: 114538221,
    inputSize: 1024,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    activation: 'sigmoid',
    normalize: 'none',
    license: 'MIT (ZhengPeng7/BiRefNet; onnx-community conversion)',
    trainingData: 'DIS5K-TR (DIS5K terms: non-commercial research use)',
    providers: ['webgpu'],
  },
};

export function toModelTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mean: readonly number[],
  std: readonly number[],
): Float32Array {
  const n = width * height;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    const base = i * 4;
    out[i] = (rgba[base] / 255 - mean[0]) / std[0];
    out[n + i] = (rgba[base + 1] / 255 - mean[1]) / std[1];
    out[2 * n + i] = (rgba[base + 2] / 255 - mean[2]) / std[2];
  }
  return out;
}

export function maskFromOutput(
  output: Float32Array,
  activation: 'none' | 'sigmoid',
  normalize: 'minmax' | 'none',
): Float32Array {
  const n = output.length;
  const out = new Float32Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) {
    let v = output[i];
    if (!Number.isFinite(v)) v = 0;
    if (activation === 'sigmoid') v = 1 / (1 + Math.exp(-v));
    out[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (normalize === 'minmax') {
    const span = max - min;
    if (span < 1e-6) {
      return new Float32Array(n);
    }
    for (let i = 0; i < n; i += 1) {
      let v = (out[i] - min) / span;
      if (!Number.isFinite(v)) v = 0;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  } else {
    for (let i = 0; i < n; i += 1) {
      let v = out[i];
      if (!Number.isFinite(v)) v = 0;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

export const CLEANUP_RANGES: Record<EdgeCleanup, [number, number]> = {
  soft: [0, 1],
  balanced: [0.08, 0.92],
  crisp: [0.2, 0.8],
};

export function edgeCurve(value: number, cleanup: EdgeCleanup): number {
  const [lo, hi] = CLEANUP_RANGES[cleanup];
  const v = (value - lo) / (hi - lo);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function applyMatte(
  rgba: Uint8ClampedArray,
  maskRgba: Uint8ClampedArray,
  cleanup: EdgeCleanup,
): Uint8ClampedArray {
  if (rgba.length !== maskRgba.length) {
    throw new Error('Mask size does not match image.');
  }
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i + 2];
    const alpha = Math.round(rgba[i + 3] * edgeCurve(maskRgba[i] / 255, cleanup));
    out[i + 3] = alpha < 0 ? 0 : alpha > 255 ? 255 : alpha;
  }
  return out;
}

export function matteMetrics(
  pred: Float32Array,
  truth: Float32Array,
  width: number,
  height: number,
  edgeRadius = 3,
): { iou: number; mae: number; edgeMae: number; edgePixels: number } {
  const n = width * height;
  if (pred.length !== n || truth.length !== n) {
    throw new Error('Matte sizes do not match.');
  }

  const binPred = new Uint8Array(n);
  const binTruth = new Uint8Array(n);
  let inter = 0;
  let union = 0;
  let maeSum = 0;
  for (let i = 0; i < n; i += 1) {
    const p = pred[i] >= 0.5 ? 1 : 0;
    const t = truth[i] >= 0.5 ? 1 : 0;
    binPred[i] = p;
    binTruth[i] = t;
    if (p && t) inter += 1;
    if (p || t) union += 1;
    maeSum += Math.abs(pred[i] - truth[i]);
  }
  const iou = union === 0 ? 1 : inter / union;
  const mae = maeSum / n;

  const edge = new Uint8Array(n);
  let edgeCount = 0;
  let edgeSum = 0;
  const r = edgeRadius;
  for (let y = 0; y < height; y += 1) {
    const y0 = y - r < 0 ? 0 : y - r;
    const y1 = y + r >= height ? height - 1 : y + r;
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      let inBand = truth[p] > 0.02 && truth[p] < 0.98;
      if (!inBand) {
        const x0 = x - r < 0 ? 0 : x - r;
        const x1 = x + r >= width ? width - 1 : x + r;
        const t = binTruth[p];
        for (let yy = y0; yy <= y1 && !inBand; yy += 1) {
          const row = yy * width;
          for (let xx = x0; xx <= x1; xx += 1) {
            if (binTruth[row + xx] !== t) {
              inBand = true;
              break;
            }
          }
        }
      }
      if (inBand) {
        edge[p] = 1;
        edgeCount += 1;
        edgeSum += Math.abs(pred[p] - truth[p]);
      }
    }
  }
  const edgeMae = edgeCount === 0 ? 0 : edgeSum / edgeCount;

  return {
    iou: Math.round(iou * 10000) / 10000,
    mae: Math.round(mae * 10000) / 10000,
    edgeMae: Math.round(edgeMae * 10000) / 10000,
    edgePixels: edgeCount,
  };
}
