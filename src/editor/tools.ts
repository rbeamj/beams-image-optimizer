export type CropRect = { width: number; height: number; x: number; y: number };

export function centerCrop(width: number, height: number, ratio: number): CropRect {
  const cropWidth = ratio >= width / height ? width : height * ratio;
  const cropHeight = ratio >= width / height ? width / ratio : height;
  return { width: cropWidth, height: cropHeight, x: (width - cropWidth) / 2, y: (height - cropHeight) / 2 };
}

/** Photo Studio exports are capped at 2K; "Original" (0) and larger recipes are clamped to it. */
export const STUDIO_MAX_EDGE = 2048;
export function studioEdge(maxEdge: number) { return maxEdge > 0 ? Math.min(maxEdge, STUDIO_MAX_EDGE) : STUDIO_MAX_EDGE; }

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

/** Returns the object-relative clip geometry for the original side of a split comparison. */
export function comparisonClip(width: number, height: number, position: number) {
  const fraction = Math.min(.95, Math.max(.05, position / 100));
  return { width: width * fraction, height, left: width * (fraction - 1) / 2, top: 0 };
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
  /** A copy of the whole stack plus the cursor, for persisting undo history with a saved project. */
  stack(): { entries: T[]; index: number } { return { entries: this.entries.slice(), index: this.index }; }
  /** Replaces the whole stack (e.g. when a saved project is reopened); the cursor is clamped into range. */
  load(entries: T[], index: number) {
    this.entries = entries.slice();
    this.index = entries.length ? Math.max(0, Math.min(entries.length - 1, Math.round(index))) : -1;
    return this.current();
  }
}
