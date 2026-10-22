import { describe, expect, it } from 'vitest';
import { enhanceOutputSize, estimatePeakBytes, modelInputLongEdge, modelInputSize } from '../src/enhance/sizing';
import { nchwToRgba, rgbaToNchw } from '../src/enhance/tensor';
import { acknowledgeEnhanceLicense, ENHANCE_LICENSE_ACK_KEY, hasAcknowledgedEnhanceLicense } from '../src/enhance/license';

describe('enhance sizing', () => {
  it('targets 256px network input for 1024 output', () => {
    expect(modelInputLongEdge(1024)).toBe(256);
    expect(modelInputSize(800, 600, 1024)).toEqual({ width: 256, height: 192 });
  });

  it('targets 512px network input for 2048 output', () => {
    expect(modelInputLongEdge(2048)).toBe(512);
    expect(modelInputSize(4032, 3024, 2048)).toEqual({ width: 512, height: 384 });
  });

  it('clamps 4× output to the requested longest edge', () => {
    expect(enhanceOutputSize(256, 192, 1024)).toEqual({ width: 1024, height: 768 });
    expect(enhanceOutputSize(512, 384, 2048)).toEqual({ width: 2048, height: 1536 });
  });

  it('estimates a bounded peak working set for listing sizes', () => {
    const oneK = estimatePeakBytes(256, 192);
    const twoK = estimatePeakBytes(512, 384);
    expect(oneK).toBeLessThan(40_000_000);
    expect(twoK).toBeGreaterThan(oneK);
    expect(twoK).toBeLessThan(120_000_000);
  });
});

describe('tensor round-trip', () => {
  it('converts RGBA to NCHW and back without channel swap', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const nchw = rgbaToNchw(rgba, 2, 1);
    const expected = Float32Array.from([10 / 255, 40 / 255, 20 / 255, 50 / 255, 30 / 255, 60 / 255]);
    expect([...nchw]).toEqual([...expected]);
    expect([...nchwToRgba(nchw, 2, 1)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });
});

describe('enhance license gate', () => {
  it('requires explicit acknowledgment before enabling', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    expect(hasAcknowledgedEnhanceLicense(storage)).toBe(false);
    acknowledgeEnhanceLicense(storage);
    expect(store.get(ENHANCE_LICENSE_ACK_KEY)).toBe('1');
    expect(hasAcknowledgedEnhanceLicense(storage)).toBe(true);
  });
});
