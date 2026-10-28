import { describe, expect, it } from 'vitest';
import { isStoredTemplate, templateIdFromValue, templateMeta, templateValue, type StoredTemplate } from '../src/editor/templates';
import { templateToPreset as toPreset } from '../src/batch/presets';
import { defaultScene } from '../src/editor/scene';
import { defaultAdjustments } from '../src/editor/looks';

const template = (over: Partial<StoredTemplate> = {}): StoredTemplate => ({
  id: 't1', name: 'Marketplace look', createdAt: 1, updatedAt: 2,
  data: {
    scene: defaultScene(),
    backdrop: { kind: 'color', color: '#ffffff' },
    backdropImage: null,
    adjustments: defaultAdjustments(),
    cutout: { mode: 'quality', cleanup: 'soft', refine: false },
  },
  ...over,
});

describe('isStoredTemplate', () => {
  it('accepts a complete template', () => {
    expect(isStoredTemplate(template())).toBe(true);
  });

  it('accepts an image backdrop only with its image blob', () => {
    const backdrop = { kind: 'image' as const, url: 'blob:old', fit: 'cover' as const };
    expect(isStoredTemplate(template({ data: { ...template().data, backdrop, backdropImage: null } }))).toBe(false);
    expect(isStoredTemplate(template({ data: { ...template().data, backdrop, backdropImage: new Blob(['bg']) } }))).toBe(true);
  });

  it('rejects malformed look sections and identity', () => {
    expect(isStoredTemplate(template({ name: 5 as unknown as string }))).toBe(false);
    expect(isStoredTemplate(template({ data: { ...template().data, backdrop: { kind: 2 } as never } }))).toBe(false);
    expect(isStoredTemplate(template({ data: { ...template().data, cutout: { mode: 'auto', cleanup: 'crisp', refine: 'yes' as unknown as boolean } } }))).toBe(false);
    expect(isStoredTemplate(template({ data: { ...template().data, adjustments: { ...defaultAdjustments(), exposure: 'bright' as unknown as number } } }))).toBe(false);
    expect(isStoredTemplate(template({ data: { ...template().data, scene: { ...defaultScene(), aspect: 7 as never } } }))).toBe(false);
  });
});

describe('templateMeta', () => {
  it('projects list views without blobs', () => {
    expect(templateMeta(template({ id: 'x', name: 'Soft look', updatedAt: 9 }))).toEqual({ id: 'x', name: 'Soft look', createdAt: 1, updatedAt: 9, backdropKind: 'color', hasBackdropImage: false });
  });
});

describe('select value helpers', () => {
  it('round-trips template ids through option values', () => {
    expect(templateValue('abc')).toBe('template:abc');
    expect(templateIdFromValue('template:abc')).toBe('abc');
  });

  it('leaves non-template values alone', () => {
    expect(templateIdFromValue('marketplace')).toBeUndefined();
    expect(templateIdFromValue('current')).toBeUndefined();
    expect(templateIdFromValue('none')).toBeUndefined();
  });
});

describe('templateToPreset', () => {
  it('maps the stored look into a batch preset', () => {
    const preset = toPreset(template({ name: 'Studio soft' }));
    expect(preset.id).toBe('template');
    expect(preset.label).toBe('Studio soft');
    expect(preset.cutout).toBe(true);
    expect(preset.mode).toBe('quality');
    expect(preset.cleanup).toBe('soft');
    expect(preset.refine).toBe(false);
    expect(preset.backdrop).toEqual({ kind: 'color', color: '#ffffff' });
    expect(preset.backdropImage).toBeUndefined();
  });

  it('clamps the scene and decouples the preset from later template edits', () => {
    const source = template({ data: { ...template().data, backdrop: { kind: 'gradient', stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }], angle: 90 }, scene: { ...defaultScene(), padding: 90, scale: 300 } } });
    const preset = toPreset(source);
    expect(preset.scene.padding).toBe(40);
    expect(preset.scene.scale).toBe(150);
    if (source.data.backdrop.kind === 'gradient') source.data.backdrop.angle = 999;
    expect(preset.backdrop).toEqual({ kind: 'gradient', stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }], angle: 90 });
  });
});
