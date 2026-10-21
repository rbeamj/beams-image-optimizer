import { describe, expect, it } from 'vitest';
import { centerCrop, clampOpacity, normalizedAdjustment } from '../src/editor/tools';

describe('studio tool helpers', () => {
  it('creates a centered square crop without enlarging the source', () => {
    expect(centerCrop(2400, 1600, 1)).toEqual({ width: 1600, height: 1600, x: 400, y: 0 });
  });
  it('creates a centered portrait crop', () => {
    expect(centerCrop(1600, 2400, .8)).toEqual({ width: 1600, height: 2000, x: 0, y: 200 });
  });
  it('clamps opacity and normalized color adjustments to safe ranges', () => {
    expect(clampOpacity(0)).toBe(.1);
    expect(clampOpacity(150)).toBe(1);
    expect(normalizedAdjustment(-200)).toBe(-1);
    expect(normalizedAdjustment(35)).toBe(.35);
  });
});
