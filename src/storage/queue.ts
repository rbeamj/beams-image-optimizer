/**
 * The Quick Optimize queue as a persistable record: the imported files plus each row's outcome, so a
 * reload (or a crash mid-batch) does not lose the list. Pure data, validation and mapping only;
 * IndexedDB lives in src/storage/idb.ts, the UI wiring in src/main.ts.
 */
import type { OutputFormat } from '../engine/types';
import type { ImageResult } from '../engine/types';

export type QueuedResult = {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceBytes: number;
  outputBytes: number;
  format: OutputFormat;
};

export type QueuedRecipe = { format: OutputFormat; quality: number; maxEdge: number; label: string };

export type QueuedRowRecord = {
  file: Blob;
  fileName: string;
  fileType: string;
  /** Preset label this row was last processed with, if any. */
  preset?: string | null;
  /** Export recipe that produced the stored result, so the row can render it again after a restore. */
  recipe?: QueuedRecipe | null;
  error?: string | null;
  result?: QueuedResult | null;
};

export type QueueRecord = { id: typeof QUEUE_RECORD_ID; rows: QueuedRowRecord[] };

export const QUEUE_RECORD_ID = 'queue';

/** Extracts the persistable subset of an ImageResult (blobs survive structured clone; URLs do not). */
export function queuedResult(result: ImageResult): QueuedResult {
  return {
    blob: result.blob,
    filename: result.filename,
    width: result.width,
    height: result.height,
    sourceWidth: result.sourceWidth,
    sourceHeight: result.sourceHeight,
    sourceBytes: result.sourceBytes,
    outputBytes: result.outputBytes,
    format: result.format,
  };
}

/** Maps UI rows (file + optional outcome) onto the persistable record. */
export function toQueueRecord(rows: { file: File; preset?: string; error?: string; result?: ImageResult; recipe?: QueuedRecipe }[]): QueueRecord {
  return {
    id: QUEUE_RECORD_ID,
    rows: rows.map(row => ({
      file: row.file,
      fileName: row.file.name,
      fileType: row.file.type,
      preset: row.preset ?? null,
      recipe: row.recipe ? { ...row.recipe } : null,
      error: row.error ?? null,
      result: row.result ? queuedResult(row.result) : null,
    })),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBlob = (value: unknown) => value instanceof Blob;

/** Guards queue reads from IndexedDB; a row without a readable file cannot be restored. */
export function isQueueRecord(value: unknown): value is QueueRecord {
  if (!isObject(value) || value.id !== QUEUE_RECORD_ID || !Array.isArray(value.rows)) return false;
  for (const row of value.rows) {
    if (!isObject(row)) return false;
    if (!isBlob(row.file) || typeof row.fileName !== 'string' || typeof row.fileType !== 'string') return false;
    if (row.preset !== null && row.preset !== undefined && typeof row.preset !== 'string') return false;
    if (row.error !== null && row.error !== undefined && typeof row.error !== 'string') return false;
    const result = row.result;
    if (result !== null && result !== undefined) {
      if (!isObject(result) || !isBlob(result.blob)) return false;
      if (typeof result.filename !== 'string') return false;
      for (const key of ['width', 'height', 'sourceWidth', 'sourceHeight', 'sourceBytes', 'outputBytes'] as const) {
        if (!isNumber(result[key])) return false;
      }
      if (typeof result.format !== 'string') return false;
    }
    const recipe = row.recipe;
    if (recipe !== null && recipe !== undefined) {
      if (!isObject(recipe) || typeof recipe.format !== 'string' || typeof recipe.label !== 'string') return false;
      if (!isNumber(recipe.quality) || !isNumber(recipe.maxEdge)) return false;
    }
  }
  return true;
}
