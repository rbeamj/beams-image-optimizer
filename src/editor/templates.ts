/**
 * Reusable look templates: the frame, backdrop, shadow and light settings of a photo, saved with a name
 * and applicable to any photo — in Photo Studio, or across the Quick Optimize queue via the batch preset
 * list. Pure data and validation; IndexedDB lives in src/storage/idb.ts, capture/apply in the controller.
 */
import type { Adjustments, Backdrop, CutoutChoice } from './looks';
import type { SceneSettings } from './scene';

export type StoredTemplateData = {
  scene: SceneSettings;
  backdrop: Backdrop;
  /** Uploaded backdrop image, when the template's backdrop is a photo. */
  backdropImage: Blob | null;
  adjustments: Adjustments;
  cutout: CutoutChoice;
};

export type StoredTemplate = { id: string; name: string; createdAt: number; updatedAt: number; data: StoredTemplateData };

export type TemplateMeta = { id: string; name: string; createdAt: number; updatedAt: number; backdropKind: string; hasBackdropImage: boolean };

/** Light projection for list views — no blobs leave the database. */
export function templateMeta(template: StoredTemplate): TemplateMeta {
  return {
    id: template.id, name: template.name, createdAt: template.createdAt, updatedAt: template.updatedAt,
    backdropKind: template.data.backdrop.kind, hasBackdropImage: !!template.data.backdropImage,
  };
}

/** Batch preset <option> values for saved templates, e.g. `template:b1c2…`. */
export const TEMPLATE_VALUE_PREFIX = 'template:';

export function templateValue(id: string): string {
  return TEMPLATE_VALUE_PREFIX + id;
}

export function templateIdFromValue(value: string): string | undefined {
  return value.startsWith(TEMPLATE_VALUE_PREFIX) ? value.slice(TEMPLATE_VALUE_PREFIX.length) : undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBlob = (value: unknown) => value instanceof Blob;

/** Guards every template read from IndexedDB; an image backdrop is only valid with its image blob. */
export function isStoredTemplate(value: unknown): value is StoredTemplate {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (!isNumber(value.createdAt) || !isNumber(value.updatedAt)) return false;
  const data = value.data;
  if (!isObject(data)) return false;
  const scene = data.scene;
  if (!isObject(scene) || !isObject(scene.shadow) || typeof scene.aspect !== 'string' || typeof scene.shadow.style !== 'string') return false;
  const backdrop = data.backdrop;
  if (!isObject(backdrop) || typeof backdrop.kind !== 'string') return false;
  if (backdrop.kind === 'image' && !isBlob(data.backdropImage)) return false;
  if (data.backdropImage !== null && !isBlob(data.backdropImage)) return false;
  const cutout = data.cutout;
  if (!isObject(cutout) || typeof cutout.mode !== 'string' || typeof cutout.cleanup !== 'string' || typeof cutout.refine !== 'boolean') return false;
  const adjustments = data.adjustments;
  if (!isObject(adjustments)) return false;
  for (const key of ['exposure', 'brightness', 'contrast', 'saturation', 'temperature', 'sharpness', 'rotation'] as const) {
    if (!isNumber(adjustments[key])) return false;
  }
  if (typeof adjustments.flipX !== 'boolean' || typeof adjustments.flipY !== 'boolean') return false;
  if (typeof adjustments.preset !== 'string') return false;
  return true;
}
