import { describe, expect, it } from 'vitest';
import {
  MATTE_ADAPTERS,
  toModelTensor,
  maskFromOutput,
  CLEANUP_RANGES,
  edgeCurve,
  applyMatte,
  matteMetrics,
} from '../src/bgremove/matte';

describe('MATTE_ADAPTERS', () => {
  it('u2netp values', () => {
    const a = MATTE_ADAPTERS.u2netp;
    expect(a.inputSize).toBe(320);
    expect(a.activation).toBe('none');
    expect(a.normalize).toBe('minmax');
    expect(a.bytes).toBe(4574861);
    expect(a.label).toBe('Fast (U²-Netp, 4.6 MB)');
    expect(a.file).toBe('u2netp.onnx');
    expect(a.mean).toEqual([0.485, 0.456, 0.406]);
    expect(a.std).toEqual([0.229, 0.224, 0.225]);
    expect(a.license).toBe('Apache-2.0 (xuebinqin/U-2-Net)');
    expect(a.trainingData).toBe('DUTS-TR (per the U²-Net paper; dataset terms not stated upstream)');
  });

  it('birefnet-lite values', () => {
    const a = MATTE_ADAPTERS['birefnet-lite'];
    expect(a.inputSize).toBe(1024);
    expect(a.activation).toBe('sigmoid');
    expect(a.normalize).toBe('none');
    expect(a.bytes).toBe(114538221);
    expect(a.label).toBe('Detailed (BiRefNet lite, 115 MB)');
    expect(a.file).toBe('birefnet-lite-fp16.onnx');
    expect(a.mean).toEqual([0.485, 0.456, 0.406]);
    expect(a.std).toEqual([0.229, 0.224, 0.225]);
    expect(a.license).toBe('MIT (ZhengPeng7/BiRefNet; onnx-community conversion)');
    expect(a.trainingData).toBe('DIS5K-TR (DIS5K terms: non-commercial research use)');
  });
});

describe('toModelTensor', () => {
  it('2×1 image NCHW layout and normalization', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 240, 245, 250, 128]);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const out = toModelTensor(rgba, 2, 1, mean, std);
    expect(out.length).toBe(6);
    expect(out[0]).toBeCloseTo((10 / 255 - 0.485) / 0.229);
    expect(out[1]).toBeCloseTo((240 / 255 - 0.485) / 0.229);
    expect(out[2]).toBeCloseTo((20 / 255 - 0.456) / 0.224);
    expect(out[3]).toBeCloseTo((245 / 255 - 0.456) / 0.224);
    expect(out[4]).toBeCloseTo((30 / 255 - 0.406) / 0.225);
    expect(out[5]).toBeCloseTo((250 / 255 - 0.406) / 0.225);
  });
});

describe('maskFromOutput', () => {
  it('sigmoid: 0 → 0.5', () => {
    const out = maskFromOutput(new Float32Array([0]), 'sigmoid', 'none');
    expect(out[0]).toBeCloseTo(0.5);
  });

  it('minmax scales to 0..1', () => {
    const out = maskFromOutput(new Float32Array([-1, 0, 1]), 'none', 'minmax');
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(1);
  });

  it('flat input returns zeros', () => {
    const out = maskFromOutput(new Float32Array([5, 5, 5]), 'none', 'minmax');
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('NaN becomes 0', () => {
    const out = maskFromOutput(new Float32Array([NaN, -Infinity, Infinity]), 'none', 'none');
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('clamps to [0,1]', () => {
    const out = maskFromOutput(new Float32Array([-5, 2]), 'none', 'none');
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
  });
});

describe('CLEANUP_RANGES', () => {
  it('has expected ranges', () => {
    expect(CLEANUP_RANGES.soft).toEqual([0, 1]);
    expect(CLEANUP_RANGES.balanced).toEqual([0.08, 0.92]);
    expect(CLEANUP_RANGES.crisp).toEqual([0.2, 0.8]);
  });
});

describe('edgeCurve', () => {
  it('balanced boundaries', () => {
    expect(edgeCurve(0.08, 'balanced')).toBe(0);
    expect(edgeCurve(0.92, 'balanced')).toBe(1);
    expect(edgeCurve(0.5, 'balanced')).toBeCloseTo(0.5);
  });

  it('clamps outside [0,1]', () => {
    expect(edgeCurve(-1, 'soft')).toBe(0);
    expect(edgeCurve(2, 'soft')).toBe(1);
  });
});

describe('applyMatte', () => {
  it('keeps RGB unchanged', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]);
    const mask = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 0]);
    const out = applyMatte(rgba, mask, 'soft');
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(20);
    expect(out[2]).toBe(30);
    expect(out[4]).toBe(40);
    expect(out[5]).toBe(50);
    expect(out[6]).toBe(60);
  });

  it('full mask preserves existing alpha', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 128]);
    const mask = new Uint8ClampedArray([255, 0, 0, 0]);
    const out = applyMatte(rgba, mask, 'soft');
    expect(out[3]).toBe(128);
  });

  it('zero mask zeroes alpha', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
    const mask = new Uint8ClampedArray([0, 0, 0, 0]);
    const out = applyMatte(rgba, mask, 'soft');
    expect(out[3]).toBe(0);
  });

  it('throws on size mismatch', () => {
    expect(() => applyMatte(new Uint8ClampedArray(4), new Uint8ClampedArray(8), 'soft')).toThrow(
      'Mask size does not match image.',
    );
  });
});

describe('matteMetrics', () => {
  it('identical masks → iou 1, mae 0, edgeMae 0', () => {
    const pred = new Float32Array([1, 1, 0, 0]);
    const truth = new Float32Array([1, 1, 0, 0]);
    const m = matteMetrics(pred, truth, 2, 2);
    expect(m.iou).toBe(1);
    expect(m.mae).toBe(0);
    expect(m.edgeMae).toBe(0);
    // Every pixel of a 2×2 split mask lies within radius 3 of the boundary.
    expect(m.edgePixels).toBe(4);
  });

  it('4×4 truth square vs shifted prediction', () => {
    const width = 4;
    const height = 4;
    const truth = new Float32Array(16);
    const pred = new Float32Array(16);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        truth[i] = x >= 1 && x <= 2 && y >= 1 && y <= 2 ? 1 : 0;
        pred[i] = x >= 0 && x <= 1 && y >= 1 && y <= 2 ? 1 : 0;
      }
    }
    const m = matteMetrics(pred, truth, 4, 4, 3);
    // Pred adds (0,1),(0,2) and misses (2,1),(2,2): 4 wrong pixels, 2 shared, union 6.
    expect(m.iou).toBeCloseTo(2 / 6, 4);
    expect(m.mae).toBe(0.25);
    expect(m.edgePixels).toBe(16);
    expect(m.edgeMae).toBe(0.25);
    const narrow = matteMetrics(pred, truth, 4, 4, 0);
    expect(narrow.edgePixels).toBe(0);
  });

  it('empty union → iou 1', () => {
    const pred = new Float32Array([0, 0, 0, 0]);
    const truth = new Float32Array([0, 0, 0, 0]);
    const m = matteMetrics(pred, truth, 2, 2);
    expect(m.iou).toBe(1);
  });

  it('size mismatch throws', () => {
    expect(() => matteMetrics(new Float32Array([1]), new Float32Array([1, 0]), 1, 2)).toThrow(
      'Matte sizes do not match.',
    );
  });
});
