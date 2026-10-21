export type CropRect = { width: number; height: number; x: number; y: number };

export function centerCrop(width: number, height: number, ratio: number): CropRect {
  const cropWidth = ratio >= width / height ? width : height * ratio;
  const cropHeight = ratio >= width / height ? width / ratio : height;
  return { width: cropWidth, height: cropHeight, x: (width - cropWidth) / 2, y: (height - cropHeight) / 2 };
}

export function clampOpacity(percent: number) { return Math.min(1, Math.max(.1, percent / 100)); }

export function normalizedAdjustment(value: number) { return Math.min(1, Math.max(-1, value / 100)); }

export function temperatureMatrix(value: number) {
  const shift = normalizedAdjustment(value) * .12;
  return [1 + shift, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1 - shift, 0, 0, 0, 0, 0, 1, 0];
}

export function sharpenMatrix(value: number) {
  const amount = Math.min(.35, Math.max(0, value / 100 * .35));
  return [0, -amount, 0, -amount, 1 + amount * 4, -amount, 0, -amount, 0];
}

export class SnapshotHistory<T> {
  private entries: T[] = [];
  private index = -1;
  push(entry: T) { this.entries = this.entries.slice(0, this.index + 1); this.entries.push(entry); this.index = this.entries.length - 1; return entry; }
  undo() { if (this.index > 0) this.index -= 1; return this.current(); }
  redo() { if (this.index < this.entries.length - 1) this.index += 1; return this.current(); }
  current() { return this.entries[this.index]; }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index >= 0 && this.index < this.entries.length - 1; }
  reset() { this.entries = []; this.index = -1; }
}
