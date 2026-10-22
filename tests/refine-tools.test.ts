import { describe, expect, it } from 'vitest';
import {
  selectionWeight,
  combineMatte,
  toEncoderSpace,
  encoderSize,
  rankCandidates,
  maskBounds,
  cleanupWindow,
  blendWeights,
  blendInto,
} from '../src/editor/refine-tools';

describe('selectionWeight', () => {
  it('clamps below 0.3 to 0 and above 0.7 to 1, with 0.5 at 0.5', () => {
    expect(selectionWeight(0.3)).toBe(0);
    expect(selectionWeight(0.2)).toBe(0);
    expect(selectionWeight(0.7)).toBeCloseTo(1, 9);
    expect(selectionWeight(0.9)).toBe(1);
    expect(selectionWeight(0.5)).toBe(0.5);
    expect(selectionWeight(0.45)).toBeCloseTo(0.375, 9);
  });
});

describe('combineMatte', () => {
  it('keep raises matte where probability is high and leaves low-prob pixels exactly unchanged', () => {
    const matte = new Float32Array([0.1, 0.5, 0.9]);
    const probs = new Float32Array([0.2, 0.5, 0.8]);
    const out = combineMatte(matte, probs, 'keep');
    expect(out[0]).toBe(matte[0]); // prob <= 0.3 -> weight 0 -> exactly unchanged
    expect(out[1]).toBe(0.5);
    expect(out[2]).toBe(1);
  });

  it('erase lowers matte where selected and leaves unselected pixels exactly unchanged when growPx = 0', () => {
    const matte = new Float32Array([0.2, 0.8, 1.0]);
    const probs = new Float32Array([0.2, 0.8, 1.0]);
    const out = combineMatte(matte, probs, 'erase');
    expect(out[0]).toBe(matte[0]); // exactly unchanged
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('erase with growPx fully erases within growPx, feathers to 2*growPx, leaves far pixels exactly 1', () => {
    const width = 9;
    const n = width * width;
    const matte = new Float32Array(n).fill(1);
    const probs = new Float32Array(n).fill(0);
    const center = 4 * width + 4;
    probs[center] = 1;
    const out = combineMatte(matte, probs, 'erase', width, 2);
    expect(out[center]).toBe(0);
    for (const nb of [center - 1, center + 1, center - width, center + width, center + 2]) expect(out[nb]).toBe(0);
    expect(out[center + 3]).toBeCloseTo(0.5, 6);
    expect(out[center + width * 3]).toBeCloseTo(0.5, 6);
    expect(out[0]).toBe(1);
    expect(out[n - 1]).toBe(1);
  });

  it('throws when matte and probabilities lengths differ', () => {
    expect(() => combineMatte(new Float32Array([0.5]), new Float32Array([0.5, 0.5]), 'keep')).toThrow();
  });
});

describe('toEncoderSpace', () => {
  it('scales 2048x1024 to longest side 1024', () => {
    const { scale, coords, labels } = toEncoderSpace(
      [{ x: 100, y: 200, label: 1 }, { x: 500, y: 50, label: 0 }],
      2048,
      1024
    );
    expect(scale).toBe(0.5);
    expect(coords).toEqual([50, 100, 250, 25]);
    expect(labels).toEqual([1, 0]);
  });
});

describe('encoderSize', () => {
  it('preserves aspect ratio with longest side 1024', () => {
    expect(encoderSize(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(encoderSize(300, 600)).toEqual({ width: 512, height: 1024 });
  });
});

describe('rankCandidates', () => {
  it('orders indices by descending IoU', () => {
    expect(rankCandidates([0.2, 0.9, 0.5])).toEqual([1, 2, 0]);
  });
});

describe('maskBounds', () => {
  it('returns null for an empty mask', () => {
    expect(maskBounds(new Uint8Array(9), 3, 3)).toBeNull();
  });

  it('returns exact bounding box for set pixels', () => {
    const mask = new Uint8Array(25);
    mask[1 * 5 + 1] = 1;
    mask[2 * 5 + 3] = 1;
    expect(maskBounds(mask, 5, 5)).toEqual({ x: 1, y: 1, width: 3, height: 2 });
  });
});

describe('cleanupWindow', () => {
  it('stays inside the image, contains the box, and respects minSide when possible', () => {
    const box = { x: 10, y: 10, width: 20, height: 20 };
    const win = cleanupWindow(box, 512, 512, 256);
    expect(win.x).toBeGreaterThanOrEqual(0);
    expect(win.y).toBeGreaterThanOrEqual(0);
    expect(win.x + win.width).toBeLessThanOrEqual(512);
    expect(win.y + win.height).toBeLessThanOrEqual(512);
    expect(win.x).toBeLessThanOrEqual(box.x);
    expect(win.y).toBeLessThanOrEqual(box.y);
    expect(win.x + win.width).toBeGreaterThanOrEqual(box.x + box.width);
    expect(win.y + win.height).toBeGreaterThanOrEqual(box.y + box.height);
    expect(Math.min(win.width, win.height)).toBeGreaterThanOrEqual(256);
  });

  it('shrinks to the image when the image is smaller than minSide', () => {
    const win = cleanupWindow({ x: 10, y: 10, width: 20, height: 20 }, 100, 80, 256);
    expect(win.width).toBe(100);
    expect(win.height).toBe(80);
    expect(win.x).toBe(0);
    expect(win.y).toBe(0);
  });
});

describe('blendWeights', () => {
  it('is 1 on mask pixels, 0 beyond radius, and within [0, 1]', () => {
    const mask = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0]);
    const w = blendWeights(mask, 8, 1, 4);
    expect(w[1]).toBe(1);
    expect(w[3]).toBe(1);
    expect(w[4]).toBeCloseTo(0.5, 6);
    expect(w[5]).toBe(0);
    expect(w[7]).toBe(0);
    for (const v of w) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of w) expect(v).toBeLessThanOrEqual(1);
  });
});

describe('blendInto', () => {
  it('copies unchanged where weight is 0, copies RGB (not alpha) where weight is 1, and does not mutate inputs', () => {
    const base = new Uint8ClampedArray([10, 20, 30, 255, 100, 100, 100, 100]);
    const filled = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 0]);
    const weights = new Float32Array([0, 1]);
    const out = blendInto(base, filled, weights);
    expect(out[0]).toBe(10);
    expect(out[3]).toBe(255);
    expect(out[4]).toBe(255);
    expect(out[5]).toBe(0);
    expect(out[6]).toBe(0);
    expect(out[7]).toBe(100); // alpha kept from base
    expect(base[4]).toBe(100);
    expect([...filled]).toEqual([255, 0, 0, 0, 255, 0, 0, 0]);
  });
});
