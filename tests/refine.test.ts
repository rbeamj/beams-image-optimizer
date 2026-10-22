import { describe, it, expect } from 'vitest';
import {
  boxMean,
  luminance,
  guidedFilter,
  refineRadius,
} from '../src/bgremove/refine';

describe('boxMean', () => {
  it('computes window means on a 3x3 grid (r=1)', () => {
    const src = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const out = boxMean(src, 3, 3, 1);
    // center pixel: mean of all 9 values = 5
    expect(out[4]).toBeCloseTo(5, 4);
    // corner (0,0): window covers (0,0),(0,1),(1,0),(1,1) -> 1,2,4,5 -> 3
    expect(out[0]).toBeCloseTo(3, 4);
    // corner (2,2): window covers 5,6,8,9 -> 7
    expect(out[8]).toBeCloseTo(7, 4);
  });

  it('r=0 returns a copy of the input', () => {
    const src = new Float32Array([0.1, 0.5, 0.9]);
    const out = boxMean(src, 3, 1, 0);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });

  it('large r equals the global mean everywhere', () => {
    const src = new Float32Array([1, 2, 3, 4]);
    const out = boxMean(src, 2, 2, 100);
    const expected = (1 + 2 + 3 + 4) / 4;
    for (let i = 0; i < 4; i += 1) expect(out[i]).toBeCloseTo(expected, 6);
  });

  it('throws on size mismatch', () => {
    expect(() => boxMean(new Float32Array([1, 2, 3]), 2, 2, 1)).toThrow();
  });
});

describe('luminance', () => {
  it('pure white = 1, black = 0', () => {
    const white = new Uint8ClampedArray([255, 255, 255, 255]);
    const black = new Uint8ClampedArray([0, 0, 0, 255]);
    expect(luminance(white, 1, 1)[0]).toBeCloseTo(1, 6);
    expect(luminance(black, 1, 1)[0]).toBeCloseTo(0, 6);
  });

  it('pure red = 0.299', () => {
    const red = new Uint8ClampedArray([255, 0, 0, 255]);
    expect(luminance(red, 1, 1)[0]).toBeCloseTo(0.299, 6);
  });
});

describe('guidedFilter', () => {
  it('constant guide returns boxMean(src) clamped', () => {
    // 3x3 image, constant guide (zero variance), src = ramp 0..8/8
    const width = 3;
    const height = 3;
    const guide = new Float32Array(9).fill(0.5);
    const src = new Float32Array([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]);
    const out = guidedFilter(guide, src, width, height, 1, 1e-4);
    const meanSrc = boxMean(src, width, height, 1);
    // center pixel: mean of all 9 src values = 0.5
    expect(out[4]).toBeCloseTo(meanSrc[4], 4);
    expect(out[4]).toBeCloseTo(0.5, 4);
    // all outputs should be clamped to [0,1]
    for (let i = 0; i < 9; i += 1) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(1);
    }
  });

  it('src == guide with tiny eps is approximately identity', () => {
    const width = 8;
    const height = 4;
    const n = width * height;
    const guide = new Float32Array(n);
    const src = new Float32Array(n);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const v = x < width / 2 ? 0 : 1;
        const i = y * width + x;
        guide[i] = v;
        src[i] = v;
      }
    }
    const out = guidedFilter(guide, src, width, height, 2, 1e-6);
    for (let i = 0; i < n; i += 1) {
      expect(out[i]).toBeCloseTo(src[i], 3); // within 1e-3
    }
  });

  it('edge snapping: blurred mask is pulled toward the guide step', () => {
    const width = 10;
    const height = 4;
    const n = width * height;
    const guide = new Float32Array(n);
    const src = new Float32Array(n);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        guide[i] = x >= 5 ? 1 : 0; // sharp step at x = 5
        // blurred/shifted ramp from x=3 to x=7
        src[i] = x <= 3 ? 0 : x >= 7 ? 1 : (x - 3) / 4;
      }
    }
    const out = guidedFilter(guide, src, width, height, 2, 1e-4);

    // Pixels on either side of the guide's step move toward the guide (0 left, 1 right).
    expect(out[4]!).toBeLessThan(src[4]!);
    expect(out[5]!).toBeGreaterThan(src[5]!);
    expect(n).toBe(40);
  });

  it('size mismatch throws', () => {
    expect(() =>
      guidedFilter(new Float32Array([0, 1]), new Float32Array([0, 1, 2]), 2, 1, 1, 1e-4),
    ).toThrow('Guided filter inputs must match the image size.');
  });

  it('r<0 returns a clamped copy of src', () => {
    const src = new Float32Array([-0.5, 0.5, 1.5]);
    const out = guidedFilter(src, src, 3, 1, 0, 1e-4);
    expect(out).toEqual(new Float32Array([0, 0.5, 1]));
    expect(out).not.toBe(src);
  });
});

describe('refineRadius', () => {
  it('clamps to [2, 16]', () => {
    expect(refineRadius(1600, 1200, 320)).toBe(8);
    expect(refineRadius(320, 200, 320)).toBe(2);
    expect(refineRadius(8000, 100, 320)).toBe(16);
  });
});
