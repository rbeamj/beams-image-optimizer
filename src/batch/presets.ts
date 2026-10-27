/**
 * Batch Studio presets: the built-in starting points Quick Optimize can apply across a whole queue, plus
 * the adapter that turns the open Photo Studio photo's settings into a preset. Pure data mapping only —
 * the cutout/layout/encode pipeline lives in ./run.ts.
 */
import type { RemovalMode } from '../ai/planner';
import type { EdgeCleanup } from '../bgremove';
import { clampScene, defaultScene, gradientStops, SCENE_PRESETS, type SceneSettings } from '../editor/scene';
import { defaultAdjustments, type Adjustments, type Backdrop, type StudioLook } from '../editor/looks';

export type BatchPreset = {
  id: string;
  label: string;
  /** Run AI background removal on every photo before layout. */
  cutout: boolean;
  mode: RemovalMode;
  cleanup: EdgeCleanup;
  refine: boolean;
  scene: SceneSettings;
  backdrop: Backdrop;
  adjustments: Adjustments;
  /** Live element for an uploaded backdrop captured from the Studio session; never serialized. */
  backdropImage?: HTMLImageElement;
};

export type BuiltInPresetId = 'marketplace' | 'social' | 'banner' | 'catalog' | 'transparent';

const fromScenePreset = (id: Exclude<BuiltInPresetId, 'transparent'>): BatchPreset => {
  const source = SCENE_PRESETS[id];
  return {
    id,
    label: source.label,
    cutout: true,
    mode: 'auto',
    cleanup: 'crisp',
    refine: true,
    scene: clampScene(source.scene),
    backdrop: source.backdrop.kind === 'color'
      ? { kind: 'color', color: source.backdrop.color }
      : { kind: 'gradient', stops: gradientStops(source.backdrop.preset), angle: 90 },
    adjustments: defaultAdjustments(),
  };
};

/** The scene presets mirror the editor's one-click buttons; Transparent PNG skips the frame entirely. */
export const BATCH_PRESETS: Record<BuiltInPresetId, BatchPreset> = {
  marketplace: fromScenePreset('marketplace'),
  social: fromScenePreset('social'),
  banner: fromScenePreset('banner'),
  catalog: fromScenePreset('catalog'),
  transparent: {
    id: 'transparent',
    label: 'Transparent PNG',
    cutout: true,
    mode: 'auto',
    cleanup: 'crisp',
    refine: true,
    scene: defaultScene(),
    backdrop: { kind: 'none' },
    adjustments: defaultAdjustments(),
  },
};

export function builtInPreset(id: string): BatchPreset | undefined {
  return Object.prototype.hasOwnProperty.call(BATCH_PRESETS, id) ? BATCH_PRESETS[id as BuiltInPresetId] : undefined;
}

/** Turns the open Studio photo's frame, backdrop, shadow, light settings and cutout choice into a preset. */
export function presetFromLook(look: StudioLook, label = 'My Studio setup'): BatchPreset {
  return {
    id: 'current',
    label,
    cutout: true,
    mode: look.cutout.mode,
    cleanup: look.cutout.cleanup,
    refine: look.cutout.refine,
    scene: clampScene(look.scene),
    backdrop: structuredClone(look.backdrop),
    adjustments: { ...look.adjustments },
    backdropImage: look.backdropImage,
  };
}

const backdropLabel = (backdrop: Backdrop) =>
  backdrop.kind === 'color' ? 'solid backdrop' : backdrop.kind === 'gradient' ? 'gradient backdrop' : backdrop.kind === 'image' ? 'image backdrop' : 'no backdrop';

export function presetDescription(preset: BatchPreset | undefined): string {
  if (!preset) return 'Optional: cut each photo out, place it on a backdrop, and export with the settings above. Runs on this device.';
  if (preset.backdrop.kind === 'none') return `${preset.label}: removes the background and keeps each photo at its own size, with transparency preserved where the format allows.`;
  const shadow = preset.scene.shadow.style === 'none' ? 'no shadow' : `${preset.scene.shadow.style} shadow`;
  return `${preset.label}: cutout, ${preset.scene.aspect} frame, ${backdropLabel(preset.backdrop)}, ${shadow}. Exports with the settings above.`;
}
