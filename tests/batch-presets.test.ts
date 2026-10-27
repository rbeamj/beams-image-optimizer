import { describe, expect, it } from 'vitest';
import { builtInPreset, BATCH_PRESETS, presetDescription, presetFromLook } from '../src/batch/presets';
import { defaultScene, gradientStops, placeSubject, SCENE_PRESETS } from '../src/editor/scene';
import { defaultAdjustments, type StudioLook } from '../src/editor/looks';

const look: StudioLook = {
  scene: defaultScene(),
  backdrop: { kind: 'gradient', stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }], angle: 45 },
  adjustments: defaultAdjustments(),
  cutout: { mode: 'quality', cleanup: 'soft', refine: false },
};

describe('built-in batch presets', () => {
  it('have unique ids, labels, and cutout enabled', () => {
    const presets = Object.values(BATCH_PRESETS);
    expect(new Set(presets.map(p => p.id)).size).toBe(presets.length);
    for (const preset of presets) {
      expect(preset.label).toBeTruthy();
      expect(preset.cutout).toBe(true);
    }
  });

  it('mirror the Studio scene presets for frame, shadow, and backdrop', () => {
    for (const id of ['marketplace', 'social', 'banner', 'catalog'] as const) {
      const preset = BATCH_PRESETS[id];
      const source = SCENE_PRESETS[id];
      expect(preset.label).toBe(source.label);
      expect(preset.scene).toEqual(source.scene);
      expect(preset.backdrop).toEqual(source.backdrop.kind === 'color'
        ? { kind: 'color', color: source.backdrop.color }
        : { kind: 'gradient', stops: gradientStops(source.backdrop.preset), angle: 90 });
    }
  });

  it('keep the subject inside the frame at every built-in scene', () => {
    for (const preset of Object.values(BATCH_PRESETS)) {
      const p = placeSubject({ width: 1200, height: 900 }, { left: 100, top: 50, width: 900, height: 800 }, preset.scene);
      expect(p.subject.left).toBeGreaterThanOrEqual(0);
      expect(p.subject.top).toBeGreaterThanOrEqual(0);
      expect(p.subject.left + p.subject.width).toBeLessThanOrEqual(p.frame.width + 1e-6);
      expect(p.subject.top + p.subject.height).toBeLessThanOrEqual(p.frame.height + 1e-6);
    }
  });

  it('expose Transparent PNG without a frame or backdrop', () => {
    const transparent = BATCH_PRESETS.transparent;
    expect(transparent.backdrop).toEqual({ kind: 'none' });
    expect(transparent.scene.aspect).toBe('1:1');
  });
});

describe('builtInPreset', () => {
  it('resolves known ids and refuses everything else', () => {
    expect(builtInPreset('marketplace')?.id).toBe('marketplace');
    expect(builtInPreset('none')).toBeUndefined();
    expect(builtInPreset('current')).toBeUndefined();
    expect(builtInPreset('toString')).toBeUndefined();
    expect(builtInPreset('constructor')).toBeUndefined();
  });
});

describe('presetFromLook', () => {
  it('carries the cutout choice and a copy of the adjustments', () => {
    const preset = presetFromLook(look);
    expect(preset.id).toBe('current');
    expect(preset.cutout).toBe(true);
    expect(preset.mode).toBe('quality');
    expect(preset.cleanup).toBe('soft');
    expect(preset.refine).toBe(false);
    expect(preset.adjustments).toEqual(defaultAdjustments());
  });

  it('clamps an out-of-range scene instead of trusting the Studio state', () => {
    const preset = presetFromLook({ ...look, scene: { ...defaultScene(), padding: 90, scale: 300, offsetX: 500 } });
    expect(preset.scene.padding).toBe(40);
    expect(preset.scene.scale).toBe(150);
    expect(preset.scene.offsetX).toBe(100);
  });

  it('decouples the preset from later edits to the captured look', () => {
    const captured = structuredClone(look);
    const preset = presetFromLook(captured);
    if (captured.backdrop.kind === 'gradient') captured.backdrop.stops[0]!.color = '#ff0000';
    if (captured.backdrop.kind === 'gradient') captured.backdrop.angle = 999;
    expect(preset.backdrop).toEqual(look.backdrop);
  });
});

describe('presetDescription', () => {
  it('describes the do-nothing default', () => {
    expect(presetDescription(undefined)).toMatch(/Optional/i);
  });

  it('names frame, backdrop, and shadow for a framed preset', () => {
    const marketplace = builtInPreset('marketplace')!;
    expect(presetDescription(marketplace)).toContain('1:1 frame');
    expect(presetDescription(marketplace)).toContain('solid backdrop');
    expect(presetDescription(marketplace)).toContain('ground shadow');
  });

  it('explains transparency for the cutout-only preset', () => {
    expect(presetDescription(builtInPreset('transparent')!)).toMatch(/transparen/i);
  });
});
