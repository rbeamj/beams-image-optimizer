export type CropRect = { width: number; height: number; x: number; y: number };

export function centerCrop(width: number, height: number, ratio: number): CropRect {
  const cropWidth = ratio >= width / height ? width : height * ratio;
  const cropHeight = ratio >= width / height ? width / ratio : height;
  return { width: cropWidth, height: cropHeight, x: (width - cropWidth) / 2, y: (height - cropHeight) / 2 };
}

export function clampOpacity(percent: number) { return Math.min(1, Math.max(.1, percent / 100)); }

export function normalizedAdjustment(value: number) { return Math.min(1, Math.max(-1, value / 100)); }
