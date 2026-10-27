/**
 * The editable "look" of a Studio photo: the tone/colour adjustments, the frame/backdrop, and the cutout choice.
 * Kept free of fabric and DOM imports so presets can be reasoned about (and tested) outside the browser.
 */
import type { EdgeCleanup } from '../bgremove';
import type { RemovalMode } from '../ai/planner';
import type { BackdropFit, ColorStop, SceneSettings } from './scene';

export type Adjustments = {
  exposure: number; brightness: number; contrast: number; saturation: number;
  temperature: number; sharpness: number; rotation: number; flipX: boolean; flipY: boolean;
  preset: 'none' | 'grayscale' | 'sepia';
};

export type Backdrop =
  | { kind: 'none' }
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; stops: ColorStop[]; angle: number }
  | { kind: 'image'; url: string; fit: BackdropFit };

export type CutoutChoice = { mode: RemovalMode; cleanup: EdgeCleanup; refine: boolean };

/** Everything a batch preset needs from the open Studio photo. */
export type StudioLook = {
  scene: SceneSettings;
  backdrop: Backdrop;
  adjustments: Adjustments;
  cutout: CutoutChoice;
  /** Live element for an uploaded backdrop, so a batch can reuse it without re-reading the file. */
  backdropImage?: HTMLImageElement;
};

export const defaultAdjustments = (): Adjustments => ({
  exposure: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0,
  rotation: 0, flipX: false, flipY: false, preset: 'none',
});
