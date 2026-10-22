export function boxMean(
  src: Float32Array,
  width: number,
  height: number,
  r: number,
): Float32Array {
  const n = width * height;
  if (src.length !== n) {
    throw new Error('boxMean input length must equal width * height.');
  }
  const out = new Float32Array(n);
  if (r < 1) {
    for (let i = 0; i < n; i += 1) out[i] = src[i];
    return out;
  }

  // Summed-area table (Float64 for accumulation precision).
  const sat = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const satRow = (y + 1) * (width + 1);
    const satRowPrev = y * (width + 1);
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += src[row + x];
      sat[satRow + x + 1] = sat[satRowPrev + x + 1] + rowSum;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const y0 = y - r < 0 ? 0 : y - r;
    const y1 = y + r >= height ? height - 1 : y + r;
    const sy0 = y0 * (width + 1);
    const sy1 = (y1 + 1) * (width + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = x - r < 0 ? 0 : x - r;
      const x1 = x + r >= width ? width - 1 : x + r;
      const sx0 = x0;
      const sx1 = x1 + 1;
      const sum =
        sat[sy1 + sx1] - sat[sy1 + sx0] - sat[sy0 + sx1] + sat[sy0 + sx0];
      const count = (y1 - y0 + 1) * (x1 - x0 + 1);
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

export function luminance(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const n = width * height;
  if (rgba.length < n * 4) {
    throw new Error('RGBA input length must be at least width * height * 4.');
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const base = i * 4;
    out[i] = (0.299 * rgba[base] + 0.587 * rgba[base + 1] + 0.114 * rgba[base + 2]) / 255;
  }
  return out;
}

export function guidedFilter(
  guide: Float32Array,
  src: Float32Array,
  width: number,
  height: number,
  r: number,
  eps: number,
): Float32Array {
  const n = width * height;
  if (guide.length !== n || src.length !== n) {
    throw new Error('Guided filter inputs must match the image size.');
  }
  const out = new Float32Array(n);
  if (r < 1) {
    for (let i = 0; i < n; i += 1) {
      let v = src[i];
      if (!Number.isFinite(v)) v = 0;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    return out;
  }

  const meanI = boxMean(guide, width, height, r);
  const meanP = boxMean(src, width, height, r);

  const corrI = new Float32Array(n);
  const corrIP = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    corrI[i] = guide[i] * guide[i];
    corrIP[i] = guide[i] * src[i];
  }
  const meanCorrI = boxMean(corrI, width, height, r);
  const meanCorrIP = boxMean(corrIP, width, height, r);

  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const varI = meanCorrI[i] - meanI[i] * meanI[i];
    const covIP = meanCorrIP[i] - meanI[i] * meanP[i];
    a[i] = covIP / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }

  const meanA = boxMean(a, width, height, r);
  const meanB = boxMean(b, width, height, r);
  for (let i = 0; i < n; i += 1) {
    let v = meanA[i] * guide[i] + meanB[i];
    if (!Number.isFinite(v)) v = 0;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

export function refineRadius(
  width: number,
  height: number,
  inputSize: number,
): number {
  return Math.min(16, Math.max(2, Math.round((Math.max(width, height) / inputSize) * 1.5)));
}
