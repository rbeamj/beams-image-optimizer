import type { OutputFormat } from './types';

export function dimensionsWithinEdge(width: number, height: number, maxEdge = 0) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('Image dimensions must be positive.');
  if (!maxEdge || Math.max(width, height) <= maxEdge) return { width, height };
  const scale = maxEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function mimeFor(format: OutputFormat) { return format === 'jpeg' ? 'image/jpeg' : `image/${format}`; }
export function extensionFor(format: OutputFormat) { return format === 'jpeg' ? 'jpg' : format; }
export function outputFilename(name: string, format: OutputFormat) {
  const stem = (name.replace(/\.[^.]*$/, '') || 'image').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'image';
  return `${stem}-optimized.${extensionFor(format)}`;
}
export function qualityNumber(quality = .82) { return Math.min(1, Math.max(.1, quality)); }
