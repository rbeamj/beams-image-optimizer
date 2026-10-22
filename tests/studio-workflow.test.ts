import { describe, expect, it } from 'vitest';
import { STUDIO_MAX_EDGE, studioEdge } from '../src/editor/tools';
import { clampScene, placeSubject, SCENE_PRESETS } from '../src/editor/scene';

describe('studio export ceiling', () => {
  it('caps Original and larger recipes at 2K and leaves smaller ones alone', () => {
    expect(STUDIO_MAX_EDGE).toBe(2048);
    expect(studioEdge(0)).toBe(2048);
    expect(studioEdge(4096)).toBe(2048);
    expect(studioEdge(3072)).toBe(2048);
    expect(studioEdge(2048)).toBe(2048);
    expect(studioEdge(1200)).toBe(1200);
  });
});

describe('scene presets', () => {
  it('are already within the clamped ranges', () => {
    for (const preset of Object.values(SCENE_PRESETS)) expect(clampScene(preset.scene)).toEqual(preset.scene);
  });

  it('keep the subject inside the frame at default size', () => {
    for (const preset of Object.values(SCENE_PRESETS)) {
      const p = placeSubject({ width: 1200, height: 900 }, { left: 100, top: 50, width: 900, height: 800 }, preset.scene);
      expect(p.subject.left).toBeGreaterThanOrEqual(0);
      expect(p.subject.top).toBeGreaterThanOrEqual(0);
      expect(p.subject.left + p.subject.width).toBeLessThanOrEqual(p.frame.width + 1e-6);
      expect(p.subject.top + p.subject.height).toBeLessThanOrEqual(p.frame.height + 1e-6);
    }
  });
});
