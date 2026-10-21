import { describe, expect, it } from 'vitest';
import { centerCrop, clampOpacity, comparisonClip, normalizedAdjustment, sharpenMatrix, SnapshotHistory, temperatureMatrix } from '../src/editor/tools';

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
  it('keeps temperature and sharpness adjustments bounded and predictable', () => {
    expect(temperatureMatrix(100)[0]).toBeCloseTo(1.12);
    expect(temperatureMatrix(100)[12]).toBeCloseTo(.88);
    expect(sharpenMatrix(100)).toEqual([0, -.35, 0, -.35, 2.4, -.35, 0, -.35, 0]);
  });
  it('creates a bounded, centered split clip for before-and-after comparison', () => {
    expect(comparisonClip(2000, 1000, 50)).toEqual({ width: 1000, height: 1000, left: -500, top: 0 });
    expect(comparisonClip(2000, 1000, 0).width).toBe(100);
    expect(comparisonClip(2000, 1000, 100).width).toBe(1900);
  });
  it('undos, redoes, and discards an abandoned editing branch', () => {
    const history = new SnapshotHistory<number>();
    history.push(1); history.push(2); history.push(3);
    expect(history.undo()).toBe(2);
    expect(history.redo()).toBe(3);
    history.undo(); history.push(4);
    expect(history.current()).toBe(4);
    expect(history.canRedo()).toBe(false);
  });
});
