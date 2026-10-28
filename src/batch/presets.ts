/**
 * Batch Studio presets: the built-in starting points Quick Optimize can apply across a whole queue, plus
 * the adapter that turns the open Photo Studio photo's settings into a preset. Pure data mapping only —
 * the cutout/layout/encode pipeline lives in ./run.ts.
 */
import type { RemovalMode } from '../ai/planner';
import type { EdgeCleanup } from '../bgremove';
import { clampScene, defaultScene, gradientStops, SCENE_PRESETS, type ScenePreset, type SceneSettings } from '../editor/scene';
import { defaultAdjustments, type Adjustments, type Backdrop, type StudioLook } from '../editor/looks';
import type { StoredTemplate } from '../editor/templates';
import type { OutputFormat } from '../engine/types';

/** Export recipe a preset can carry; when set it overrides the shared export settings. */
export type PresetRecipe = { format: OutputFormat; quality: number; maxEdge: number; background?: string };

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
  /** Bundled export settings; absent presets use whatever the operator picked above. */
  recipe?: PresetRecipe;
  /** Live element for an uploaded backdrop captured from the Studio session; never serialized. */
  backdropImage?: HTMLImageElement;
};

export type BuiltInPresetId = 'marketplace' | 'social' | 'banner' | 'catalog' | 'transparent' | 'amazon-white' | 'ebay-white' | 'transparent-max';

const fromScenePreset = (id: ScenePreset): BatchPreset => {
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
  // Combined presets: cutout tier + scene + a bundled export recipe, so the operator can run one
  // option end-to-end and compare it against another. Rules are documented from each marketplace:
  // Amazon — main image on pure white RGB(255,255,255), product filling ~85% of frame (the 7% padding
  //   gives ~86%), at least 1000px longest side with 2000px+ recommended, JPEG preferred
  //   (Amazon Seller Central, "Product image guide").
  // eBay — 500px hard minimum on the longest side, ~1600px recommended, white or neutral
  //   background, JPEG best (eBay, "Photo tips").
  'amazon-white': {
    ...fromScenePreset('marketplace'),
    id: 'amazon-white',
    label: 'Amazon white 2K',
    mode: 'quality',
    cleanup: 'balanced',
    recipe: { format: 'jpeg', quality: .9, maxEdge: 2048 },
  },
  'ebay-white': {
    ...fromScenePreset('marketplace'),
    id: 'ebay-white',
    label: 'eBay white 1600',
    mode: 'quality',
    cleanup: 'balanced',
    recipe: { format: 'jpeg', quality: .9, maxEdge: 1600 },
  },
  'transparent-max': {
    id: 'transparent-max',
    label: 'Transparent PNG · Max',
    cutout: true,
    mode: 'quality',
    cleanup: 'balanced',
    refine: true,
    scene: defaultScene(),
    backdrop: { kind: 'none' },
    adjustments: defaultAdjustments(),
    recipe: { format: 'png', quality: 1, maxEdge: 2048 },
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

/**
 * A saved template as a batch preset. The backdrop of an image template must be given a fresh object URL
 * by the caller (the saved one is dead after a reload) so the batch runner can decode it.
 */
export function templateToPreset(template: StoredTemplate): BatchPreset {
  const data = template.data;
  return {
    id: 'template',
    label: template.name,
    cutout: true,
    mode: data.cutout.mode as RemovalMode,
    cleanup: data.cutout.cleanup as EdgeCleanup,
    refine: data.cutout.refine,
    scene: clampScene(structuredClone(data.scene)),
    backdrop: structuredClone(data.backdrop),
    adjustments: { ...data.adjustments },
  };
}

const backdropLabel = (backdrop: Backdrop) =>
  backdrop.kind === 'color' ? 'solid backdrop' : backdrop.kind === 'gradient' ? 'gradient backdrop' : backdrop.kind === 'image' ? 'image backdrop' : 'no backdrop';

const cutoutLabel = (preset: BatchPreset) =>
  preset.mode === 'quality' ? 'Quality 1024 cutout with balanced edges' : preset.mode === 'fast' ? 'Fast 512 cutout' : 'cutout';

const recipeLabel = (recipe: PresetRecipe) =>
  `${recipe.format.toUpperCase()} · ${Math.round(recipe.quality * 100)}% · ${recipe.maxEdge >= 1024 && recipe.maxEdge % 1024 === 0 ? `${recipe.maxEdge / 1024}K` : `${recipe.maxEdge}px`}`;

export function presetDescription(preset: BatchPreset | undefined): string {
  if (!preset) return 'Optional: cut each photo out, place it on a backdrop, and export with the settings above. Runs on this device.';
  if (preset.recipe) {
    const frame = preset.backdrop.kind === 'none'
      ? 'keeps each photo at its own size'
      : `${preset.scene.aspect} frame, ${backdropLabel(preset.backdrop)}, ${preset.scene.shadow.style === 'none' ? 'no shadow' : `${preset.scene.shadow.style} shadow`}`;
    return `${preset.label}: ${cutoutLabel(preset)}, ${frame}. Exports ${recipeLabel(preset.recipe)} — this preset overrides the export settings above.`;
  }
  if (preset.backdrop.kind === 'none') return `${preset.label}: removes the background and keeps each photo at its own size, with transparency preserved where the format allows.`;
  const shadow = preset.scene.shadow.style === 'none' ? 'no shadow' : `${preset.scene.shadow.style} shadow`;
  return `${preset.label}: cutout, ${preset.scene.aspect} frame, ${backdropLabel(preset.backdrop)}, ${shadow}. Exports with the settings above.`;
}
