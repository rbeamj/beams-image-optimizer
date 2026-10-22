/** Convert RGBA ImageData into NCHW RGB float32 in [0, 1]. */
export function rgbaToNchw(data: Uint8ClampedArray | Uint8Array, width: number, height: number) {
  const out = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i += 1) {
    const o = i * 4;
    out[i] = data[o]! / 255;
    out[plane + i] = data[o + 1]! / 255;
    out[plane * 2 + i] = data[o + 2]! / 255;
  }
  return out;
}

/** Convert NCHW RGB float32 to RGBA bytes (clamped). Alpha is opaque. */
export function nchwToRgba(tensor: Float32Array, width: number, height: number) {
  const out = new Uint8ClampedArray(width * height * 4);
  const plane = width * height;
  for (let i = 0; i < plane; i += 1) {
    const o = i * 4;
    out[o] = clampByte(tensor[i]! * 255);
    out[o + 1] = clampByte(tensor[plane + i]! * 255);
    out[o + 2] = clampByte(tensor[plane * 2 + i]! * 255);
    out[o + 3] = 255;
  }
  return out;
}

function clampByte(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return value | 0;
}
