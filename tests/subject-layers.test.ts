import { describe, expect, it } from 'vitest';
import { applyMatteAlpha } from '../src/editor/subject';

describe('subject layers', () => {
  it('applies the matte as alpha without touching RGB', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]);
    const out = applyMatteAlpha(rgba, new Float32Array([0.5, 1]));
    expect([...out]).toEqual([10, 20, 30, 128, 40, 50, 60, 128]);
    expect([...rgba]).toEqual([10, 20, 30, 255, 40, 50, 60, 128]);
  });

  it('clamps matte values and rejects size mismatches', () => {
    expect([...applyMatteAlpha(new Uint8ClampedArray([1, 2, 3, 200]), new Float32Array([1.7]))]).toEqual([1, 2, 3, 200]);
    expect([...applyMatteAlpha(new Uint8ClampedArray([1, 2, 3, 200]), new Float32Array([-0.2]))]).toEqual([1, 2, 3, 0]);
    expect(() => applyMatteAlpha(new Uint8ClampedArray(8), new Float32Array(1))).toThrow('Matte size');
  });
});
