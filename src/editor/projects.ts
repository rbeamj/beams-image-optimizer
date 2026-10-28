/**
 * Saved Studio projects: everything needed to reopen a photo exactly where you left it — the subject
 * layers as blobs (base pixels + cutout matte), the before/after reference, the original file, and the
 * look (adjustments, crop, scene, backdrop). Pure data and validation only; IndexedDB lives in
 * src/storage/idb.ts, capture/restore live in the editor controller.
 */
import type { RemovalMode } from '../ai/planner';
import type { SceneSettings } from './scene';
import type { Adjustments, Backdrop } from './looks';
import type { CropRect } from './tools';
import type { Snapshot } from './controller';

export type StoredRemoval = { variantId: string; label: string; mode: RemovalMode };
export type StoredSize = { width: number; height: number };
/** One pooled blob plus the dead object URL it replaces, so a snapshot can be re-enlivened after a reload. */
export type StoredPoolEntry = { url: string; blob: Blob };
/** The undo stack that travels with a project: snapshots plus the blob pool their URLs reference. */
export type StoredHistory = { snapshots: Snapshot[]; cursor: number; pool: StoredPoolEntry[] };

export type StoredProjectData = {
  fileName: string;
  fileType: string;
  /** The untouched input file, kept so before/after and "clear enhance" keep working after a reopen. */
  file: Blob;
  /** Current subject pixels (original, enhanced, or inpainted). */
  base: Blob;
  /** Cutout matte as a grayscale PNG, when the photo has one. */
  matte: Blob | null;
  /** Pixels shown by the before/after slider at save time. */
  comparison: Blob;
  /** Uploaded backdrop image, when the scene uses one. */
  backdropImage: Blob | null;
  width: number;
  height: number;
  /** Element size before any enhance, so the Enhance panel's clear state restores correctly. */
  pristine: StoredSize;
  removal: StoredRemoval | null;
  enhancedTo: number | null;
  refined: number;
  cleaned: number;
  adjustments: Adjustments;
  crop: CropRect;
  scene: SceneSettings;
  backdrop: Backdrop;
  /** Undo history (most recent snapshots); absent or null on records saved before this existed. */
  history?: StoredHistory | null;
};

export type StoredProject = { id: string; name: string; createdAt: number; updatedAt: number; data: StoredProjectData };

export type ProjectMeta = {
  id: string; name: string; createdAt: number; updatedAt: number;
  fileName: string; width: number; height: number; hasMatte: boolean; hasBackdropImage: boolean; backdropKind: string;
};

/** Light projection for list views — no blobs leave the database. */
export function projectMeta(project: StoredProject): ProjectMeta {
  return {
    id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt,
    fileName: project.data.fileName, width: project.data.width, height: project.data.height,
    hasMatte: !!project.data.matte, hasBackdropImage: !!project.data.backdropImage,
    backdropKind: project.data.backdrop.kind,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPositive = (value: unknown) => isNumber(value) && value > 0;
const isBlob = (value: unknown) => value instanceof Blob;

/**
 * Guards every read from IndexedDB: a record written by another version (or anything corrupt) must never
 * reach the editor. An image backdrop is only valid with its image blob. The scene check is deliberately
 * shallow — applyProject clamps it — but dimensions must be positive or the project cannot render.
 */
export function isStoredProject(value: unknown): value is StoredProject {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (!isNumber(value.createdAt) || !isNumber(value.updatedAt)) return false;
  const data = value.data;
  if (!isObject(data)) return false;
  if (typeof data.fileName !== 'string' || typeof data.fileType !== 'string') return false;
  if (!isBlob(data.file) || !isBlob(data.base) || !isBlob(data.comparison)) return false;
  if (data.matte !== null && !isBlob(data.matte)) return false;
  if (data.backdropImage !== null && !isBlob(data.backdropImage)) return false;
  if (!isPositive(data.width) || !isPositive(data.height)) return false;
  for (const key of ['refined', 'cleaned'] as const) if (!isNumber(data[key])) return false;
  if (data.enhancedTo !== null && !isNumber(data.enhancedTo)) return false;
  const pristine = data.pristine;
  if (!isObject(pristine) || !isPositive(pristine.width) || !isPositive(pristine.height)) return false;
  const crop = data.crop;
  if (!isObject(crop) || !isNumber(crop.x) || !isNumber(crop.y) || !isPositive(crop.width) || !isPositive(crop.height)) return false;
  const scene = data.scene;
  if (!isObject(scene) || !isObject(scene.shadow) || typeof scene.aspect !== 'string' || typeof scene.shadow.style !== 'string') return false;
  const backdrop = data.backdrop;
  if (!isObject(backdrop) || typeof backdrop.kind !== 'string') return false;
  if (backdrop.kind === 'image' && !isBlob(data.backdropImage)) return false;
  const adjustments = data.adjustments;
  if (!isObject(adjustments)) return false;
  for (const key of ['exposure', 'brightness', 'contrast', 'saturation', 'temperature', 'sharpness', 'rotation'] as const) {
    if (!isNumber(adjustments[key])) return false;
  }
  if (typeof adjustments.flipX !== 'boolean' || typeof adjustments.flipY !== 'boolean') return false;
  if (typeof adjustments.preset !== 'string') return false;
  const history = data.history;
  if (history !== null && history !== undefined) {
    if (!isObject(history) || !Array.isArray(history.snapshots) || !Array.isArray(history.pool) || !isNumber(history.cursor)) return false;
    if (history.snapshots.length && (history.cursor < 0 || history.cursor >= history.snapshots.length)) return false;
    for (const entry of history.pool) if (!isObject(entry) || typeof entry.url !== 'string' || !isBlob(entry.blob)) return false;
    for (const snapshot of history.snapshots) {
      if (!isObject(snapshot)) return false;
      if (!isObject(snapshot.canvas) || !isObject(snapshot.layers) || !isObject(snapshot.adjustments) || !isObject(snapshot.scene) || !isObject(snapshot.backdrop)) return false;
      if (typeof snapshot.comparisonUrl !== 'string' || typeof snapshot.layers.baseUrl !== 'string') return false;
      if (!isNumber(snapshot.layers.width) || !isNumber(snapshot.layers.height)) return false;
      if (snapshot.layers.matteUrl !== null && snapshot.layers.matteUrl !== undefined && typeof snapshot.layers.matteUrl !== 'string') return false;
      if (snapshot.opaque !== null && snapshot.opaque !== undefined && !isObject(snapshot.opaque)) return false;
    }
  }
  return true;
}
