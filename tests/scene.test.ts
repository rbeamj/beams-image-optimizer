import { describe, expect, it } from 'vitest';
import {
  alphaBounds,
  visibleProductBox,
  aspectRatio,
  backdropPlacement,
  clampScene,
  customGradient,
  defaultScene,
  dropShadow,
  gradientStops,
  groundShadow,
  linearCoords,
  sceneLayout,
  type SceneSettings,
} from '../src/editor/scene';

describe('defaultScene', () => {
  it('returns the default settings', () => {
    expect(defaultScene()).toEqual({
      aspect: '1:1',
      padding: 10,
      offsetX: 0,
      offsetY: 0,
      shadow: { style: 'ground', opacity: 35, blur: 50, distance: 20 },
    });
  });
});

describe('clampScene', () => {
  it('clamps padding, offsets, and shadow values', () => {
    expect(clampScene({ aspect: '1:1', padding: -5, offsetX: -200, offsetY: 500, shadow: { style: 'drop', opacity: -10, blur: 200, distance: 150 } }))
      .toEqual({
        aspect: '1:1',
        padding: 0,
        offsetX: -100,
        offsetY: 100,
        shadow: { style: 'drop', opacity: 0, blur: 100, distance: 100 },
      });
  });

  it('sanitizes NaN to defaults', () => {
    expect(clampScene({ aspect: 'unknown' as any, padding: NaN, offsetX: NaN, offsetY: NaN, shadow: { style: 'weird' as any, opacity: NaN, blur: NaN, distance: NaN } }))
      .toEqual({
        aspect: '1:1',
        padding: 10,
        offsetX: 0,
        offsetY: 0,
        shadow: { style: 'none', opacity: 35, blur: 50, distance: 20 },
      });
  });

  it('returns a new object', () => {
    const input = { aspect: '4:5' as const, padding: 20, offsetX: 10, offsetY: -10, shadow: { style: 'none' as const, opacity: 50, blur: 60, distance: 70 } };
    const result = clampScene(input);
    expect(result).not.toBe(input);
    expect(result.shadow).not.toBe(input.shadow);
  });
});

describe('aspectRatio', () => {
  it('returns fixed ratios', () => {
    expect(aspectRatio('1:1', { width: 100, height: 200 })).toBe(1);
    expect(aspectRatio('4:5', { width: 100, height: 200 })).toBe(0.8);
    expect(aspectRatio('4:3', { width: 100, height: 200 })).toBeCloseTo(4 / 3);
    expect(aspectRatio('16:9', { width: 100, height: 200 })).toBeCloseTo(16 / 9);
  });

  it('returns product ratio for "product"', () => {
    expect(aspectRatio('product', { width: 800, height: 600 })).toBe(4 / 3);
  });
});

describe('sceneLayout', () => {
  it('square frame with 10% padding for 800x600 product', () => {
    const { frame, product } = sceneLayout({ width: 800, height: 600 }, { aspect: '1:1', padding: 10, offsetX: 0, offsetY: 0, shadow: { style: 'none', opacity: 0, blur: 0, distance: 0 } });
    expect(frame).toEqual({ width: 1000, height: 1000 });
    expect(product).toEqual({ left: 100, top: 200, width: 800, height: 600 });
  });

  it('product aspect keeps ratio', () => {
    const { frame, product } = sceneLayout({ width: 800, height: 600 }, { aspect: 'product', padding: 10, offsetX: 0, offsetY: 0, shadow: { style: 'none', opacity: 0, blur: 0, distance: 0 } });
    expect(frame.width / frame.height).toBeCloseTo(800 / 600);
    expect(product.width).toBe(800);
    expect(product.height).toBe(600);
  });

  it('offsets ±100 touch edges', () => {
    const base: SceneSettings = { aspect: '1:1', padding: 10, offsetX: 0, offsetY: 0, shadow: { style: 'none', opacity: 0, blur: 0, distance: 0 } };
    const right = sceneLayout({ width: 800, height: 600 }, { ...base, offsetX: 100 });
    expect(right.product.left).toBe(200);
    const left = sceneLayout({ width: 800, height: 600 }, { ...base, offsetX: -100 });
    expect(left.product.left).toBe(0);
    const bottom = sceneLayout({ width: 800, height: 600 }, { ...base, offsetY: 100 });
    expect(bottom.product.top).toBe(400);
    const top = sceneLayout({ width: 800, height: 600 }, { ...base, offsetY: -100 });
    expect(top.product.top).toBe(0);
  });

  it('padding 0 with product aspect gives frame == product', () => {
    const { frame, product } = sceneLayout({ width: 800, height: 600 }, { aspect: 'product', padding: 0, offsetX: 0, offsetY: 0, shadow: { style: 'none', opacity: 0, blur: 0, distance: 0 } });
    expect(frame).toEqual({ width: 800, height: 600 });
    expect(product).toEqual({ left: 0, top: 0, width: 800, height: 600 });
  });

  it('throws on zero or negative product size', () => {
    expect(() => sceneLayout({ width: 0, height: 600 }, defaultScene())).toThrow('Product size must be positive.');
    expect(() => sceneLayout({ width: 800, height: -10 }, defaultScene())).toThrow('Product size must be positive.');
    expect(() => sceneLayout({ width: NaN, height: 600 }, defaultScene())).toThrow('Product size must be positive.');
  });
});

describe('backdropPlacement', () => {
  it('cover scales to fill and centers (may overflow)', () => {
    const box = backdropPlacement({ width: 2000, height: 1000 }, { width: 1000, height: 1000 }, 'cover');
    expect(box.width).toBe(2000);
    expect(box.height).toBe(1000);
    expect(box.left).toBe(-500);
    expect(box.top).toBe(0);
  });

  it('contain scales to fit inside', () => {
    const box = backdropPlacement({ width: 2000, height: 1000 }, { width: 1000, height: 1000 }, 'contain');
    expect(box.width).toBe(1000);
    expect(box.height).toBe(500);
    expect(box.left).toBe(0);
    expect(box.top).toBe(250);
  });
});

describe('gradientStops', () => {
  it('returns exact stops for soft', () => {
    expect(gradientStops('soft')).toEqual([
      { offset: 0, color: '#f8f3eb' },
      { offset: 0.55, color: '#d9e7df' },
      { offset: 1, color: '#b7ccc2' },
    ]);
  });

  it('returns exact stops for charcoal', () => {
    expect(gradientStops('charcoal')).toEqual([
      { offset: 0, color: '#4a4f52' },
      { offset: 0.6, color: '#2b2f31' },
      { offset: 1, color: '#16191a' },
    ]);
  });
});

describe('customGradient', () => {
  it('returns valid stops', () => {
    expect(customGradient('#ff0000', '#0000ff')).toEqual([
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ]);
  });

  it('falls back on invalid colors', () => {
    expect(customGradient('not-a-color', '#123456')).toEqual([
      { offset: 0, color: '#ffffff' },
      { offset: 1, color: '#123456' },
    ]);
    expect(customGradient('#abcdef', 'also-invalid')).toEqual([
      { offset: 0, color: '#abcdef' },
      { offset: 1, color: '#d9dcdd' },
    ]);
  });
});

describe('linearCoords', () => {
  it('0° is left-to-right through center', () => {
    expect(linearCoords(0)).toEqual({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
  });

  it('90° is top-to-bottom through center', () => {
    expect(linearCoords(90)).toEqual({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
  });

  it('rounds to 4 decimals', () => {
    expect(linearCoords(45)).toEqual({ x1: 0.1464, y1: 0.1464, x2: 0.8536, y2: 0.8536 });
  });
});

describe('dropShadow', () => {
  it('returns undefined unless style is drop', () => {
    expect(dropShadow({ style: 'none', opacity: 50, blur: 50, distance: 20 }, { width: 100, height: 100 })).toBeUndefined();
    expect(dropShadow({ style: 'ground', opacity: 50, blur: 50, distance: 20 }, { width: 100, height: 100 })).toBeUndefined();
  });

  it('computes drop shadow values', () => {
    const result = dropShadow({ style: 'drop', opacity: 50, blur: 50, distance: 25 }, { width: 1000, height: 800 });
    expect(result).toEqual({
      color: 'rgba(0,0,0,0.50)',
      blur: 30,
      offsetX: 0,
      offsetY: 10,
    });
  });
});

describe('alphaBounds and visibleProductBox', () => {
  const rgba = (w: number, h: number, opaque: [number, number][]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    opaque.forEach(([x, y]) => { data[(y * w + x) * 4 + 3] = 255; });
    return data;
  };

  it('finds the opaque bounding box and ignores faint alpha', () => {
    const data = rgba(5, 4, [[1, 1], [3, 2]]);
    data[(0 * 5 + 0) * 4 + 3] = 10;
    expect(alphaBounds(data, 5, 4)).toEqual({ left: 1, top: 1, width: 3, height: 2 });
  });

  it('returns undefined for a fully transparent image', () => {
    expect(alphaBounds(rgba(3, 3, []), 3, 3)).toBeUndefined();
  });

  it('maps opaque bounds through the crop into the laid-out product box', () => {
    const box = visibleProductBox({ left: 100, top: 50, width: 600, height: 800 }, { left: 0, top: 0, width: 600, height: 800 }, { left: 170, top: 40, width: 260, height: 720 });
    expect(box).toEqual({ left: 270, top: 90, width: 260, height: 720 });
  });

  it('clips opaque bounds to the crop and falls back when they do not overlap', () => {
    const product = { left: 0, top: 0, width: 300, height: 300 };
    expect(visibleProductBox(product, { left: 100, top: 100, width: 300, height: 300 }, { left: 50, top: 150, width: 200, height: 100 })).toEqual({ left: 0, top: 50, width: 150, height: 100 });
    expect(visibleProductBox(product, { left: 0, top: 0, width: 300, height: 300 }, { left: 400, top: 400, width: 10, height: 10 })).toBe(product);
  });
});

describe('groundShadow', () => {
  it('returns undefined unless style is ground', () => {
    expect(groundShadow({ style: 'none', opacity: 50, blur: 50, distance: 20 }, { left: 0, top: 0, width: 100, height: 100 })).toBeUndefined();
    expect(groundShadow({ style: 'drop', opacity: 50, blur: 50, distance: 20 }, { left: 0, top: 0, width: 100, height: 100 })).toBeUndefined();
  });

  it('computes ground shadow values', () => {
    const result = groundShadow({ style: 'ground', opacity: 40, blur: 50, distance: 25 }, { left: 100, top: 200, width: 400, height: 300 });
    // cy = 200 + 300 - 4.5 + 3; rx = 400 * 0.43; ry = 300 * 0.0575; softness = round2(0.625)
    expect(result).toEqual({ cx: 300, cy: 498.5, rx: 172, ry: 17.25, opacity: 0.4, softness: 0.63 });
  });

  it('clamps ry to minimum 2', () => {
    const result = groundShadow({ style: 'ground', opacity: 10, blur: 0, distance: 0 }, { left: 0, top: 0, width: 10, height: 10 });
    expect(result!.ry).toBe(2);
  });
});
