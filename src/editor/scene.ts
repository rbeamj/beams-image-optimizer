export type FrameAspect = 'product' | '1:1' | '4:5' | '4:3' | '16:9' | '2:3';
export type BackdropFit = 'cover' | 'contain';
export type ShadowStyle = 'none' | 'drop' | 'ground';
export type ShadowSettings = { style: ShadowStyle; opacity: number; blur: number; distance: number };
/** `scale` (30-150, default 100) sizes the subject inside the frame; the frame itself keeps its resolution. */
export type SceneSettings = { aspect: FrameAspect; padding: number; offsetX: number; offsetY: number; scale?: number; shadow: ShadowSettings };
export type Size = { width: number; height: number };
export type Box = { left: number; top: number; width: number; height: number };
export type GradientPreset = 'soft' | 'warm' | 'cool' | 'studio' | 'charcoal';
export type ColorStop = { offset: number; color: string };

const DEFAULT: SceneSettings = {
  aspect: '1:1',
  padding: 10,
  offsetX: 0,
  offsetY: 0,
  scale: 100,
  shadow: { style: 'ground', opacity: 35, blur: 50, distance: 20 },
};

const ASPECT_RATIOS: Record<Exclude<FrameAspect, 'product'>, number> = {
  '1:1': 1,
  '4:5': 0.8,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '2:3': 2 / 3,
};

export function defaultScene(): SceneSettings {
  return { ...DEFAULT, shadow: { ...DEFAULT.shadow } };
}

/** Ceil that ignores floating-point noise such as 600.0000000001. */
const ceilPixels = (value: number) => Math.ceil(value - 1e-6);

export function clampScene(settings: SceneSettings): SceneSettings {
  const aspect = settings.aspect in ASPECT_RATIOS || settings.aspect === 'product' ? settings.aspect : '1:1';
  const padding = Number.isFinite(settings.padding) ? Math.min(40, Math.max(0, settings.padding)) : DEFAULT.padding;
  const offsetX = Number.isFinite(settings.offsetX) ? Math.min(100, Math.max(-100, settings.offsetX)) : DEFAULT.offsetX;
  const offsetY = Number.isFinite(settings.offsetY) ? Math.min(100, Math.max(-100, settings.offsetY)) : DEFAULT.offsetY;
  const shadowStyle = settings.shadow.style === 'drop' || settings.shadow.style === 'ground' || settings.shadow.style === 'none'
    ? settings.shadow.style
    : 'none';
  const shadowOpacity = Number.isFinite(settings.shadow.opacity) ? Math.min(100, Math.max(0, settings.shadow.opacity)) : DEFAULT.shadow.opacity;
  const shadowBlur = Number.isFinite(settings.shadow.blur) ? Math.min(100, Math.max(0, settings.shadow.blur)) : DEFAULT.shadow.blur;
  const shadowDistance = Number.isFinite(settings.shadow.distance) ? Math.min(100, Math.max(0, settings.shadow.distance)) : DEFAULT.shadow.distance;
  const scale = Number.isFinite(settings.scale) ? Math.min(150, Math.max(30, settings.scale!)) : 100;
  return {
    aspect,
    padding,
    offsetX,
    offsetY,
    scale,
    shadow: { style: shadowStyle, opacity: shadowOpacity, blur: shadowBlur, distance: shadowDistance },
  };
}

export function aspectRatio(aspect: FrameAspect, product: Size): number {
  if (aspect === 'product') {
    return product.width / product.height;
  }
  return ASPECT_RATIOS[aspect];
}

export function sceneLayout(product: Size, settings: SceneSettings): { frame: Size; product: Box } {
  if (!Number.isFinite(product.width) || !Number.isFinite(product.height) || product.width <= 0 || product.height <= 0) {
    throw new Error('Product size must be positive.');
  }
  const s = clampScene(settings);
  const pad = s.padding / 100;
  const k = 1 - 2 * pad;
  const r = aspectRatio(s.aspect, product);
  const frameWidth = ceilPixels(Math.max(product.width / k, (product.height / k) * r));
  const frameHeight = ceilPixels(frameWidth / r);
  const fx = frameWidth - product.width;
  const fy = frameHeight - product.height;
  return {
    frame: { width: frameWidth, height: frameHeight },
    product: {
      left: fx / 2 + (s.offsetX / 100) * (fx / 2),
      top: fy / 2 + (s.offsetY / 100) * (fy / 2),
      width: product.width,
      height: product.height,
    },
  };
}

export type ScenePreset = 'marketplace' | 'social' | 'banner' | 'catalog';
export type PresetBackdrop = { kind: 'color'; color: string } | { kind: 'gradient'; preset: GradientPreset };

/** One-click starting points; every value stays editable afterwards. */
export const SCENE_PRESETS: Record<ScenePreset, { label: string; scene: SceneSettings; backdrop: PresetBackdrop }> = {
  marketplace: { label: 'Marketplace white 1:1', backdrop: { kind: 'color', color: '#ffffff' }, scene: { aspect: '1:1', padding: 7, offsetX: 0, offsetY: 0, scale: 100, shadow: { style: 'ground', opacity: 28, blur: 60, distance: 10 } } },
  social: { label: 'Social 4:5', backdrop: { kind: 'gradient', preset: 'soft' }, scene: { aspect: '4:5', padding: 12, offsetX: 0, offsetY: 10, scale: 100, shadow: { style: 'ground', opacity: 35, blur: 50, distance: 20 } } },
  banner: { label: 'Banner 16:9', backdrop: { kind: 'gradient', preset: 'studio' }, scene: { aspect: '16:9', padding: 12, offsetX: -60, offsetY: 0, scale: 100, shadow: { style: 'drop', opacity: 30, blur: 60, distance: 30 } } },
  catalog: { label: 'Catalog 4:3', backdrop: { kind: 'gradient', preset: 'warm' }, scene: { aspect: '4:3', padding: 10, offsetX: 0, offsetY: 0, scale: 100, shadow: { style: 'ground', opacity: 40, blur: 40, distance: 15 } } },
};

export type SubjectPlacement = {
  frame: Size;
  /** Where the image centre goes, in frame pixels. */
  center: { x: number; y: number };
  /** Multiplier on the image's native size. */
  zoom: number;
  /** Axis-aligned box of the visible (rotated) subject in frame pixels; drives shadows. */
  subject: Box;
};

/**
 * Lays out the visible subject (not the transparent margin around a cutout) inside the frame, accounting for
 * rotation and flips. `crop` is the image size after cropping; `visible` is the opaque area in crop coordinates.
 */
export function placeSubject(crop: Size, visible: Box | undefined, settings: SceneSettings, rotationDeg = 0, flipX = false, flipY = false): SubjectPlacement {
  const s = clampScene(settings);
  const v = visible && visible.width > 0 && visible.height > 0 ? visible : { left: 0, top: 0, width: crop.width, height: crop.height };
  const t = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  const rw = v.width * Math.abs(cos) + v.height * Math.abs(sin);
  const rh = v.width * Math.abs(sin) + v.height * Math.abs(cos);
  const layout = sceneLayout({ width: rw, height: rh }, s);
  const zoom = s.scale! / 100;
  const bw = rw * zoom, bh = rh * zoom;
  const fx = layout.frame.width - bw, fy = layout.frame.height - bh;
  const subject = { left: fx / 2 + (s.offsetX / 100) * (fx / 2), top: fy / 2 + (s.offsetY / 100) * (fy / 2), width: bw, height: bh };
  // Offset of the visible centre from the image centre, flipped then rotated like the rendered image.
  let dx = v.left + v.width / 2 - crop.width / 2, dy = v.top + v.height / 2 - crop.height / 2;
  if (flipX) dx = -dx;
  if (flipY) dy = -dy;
  const ox = (dx * cos - dy * sin) * zoom, oy = (dx * sin + dy * cos) * zoom;
  return { frame: layout.frame, center: { x: subject.left + bw / 2 - ox, y: subject.top + bh / 2 - oy }, zoom, subject };
}

export function backdropPlacement(image: Size, frame: Size, fit: BackdropFit): Box {
  const scale = fit === 'cover'
    ? Math.max(frame.width / image.width, frame.height / image.height)
    : Math.min(frame.width / image.width, frame.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    left: (frame.width - width) / 2,
    top: (frame.height - height) / 2,
    width,
    height,
  };
}

export function gradientStops(preset: GradientPreset): ColorStop[] {
  const presets: Record<GradientPreset, ColorStop[]> = {
    soft: [
      { offset: 0, color: '#f8f3eb' },
      { offset: 0.55, color: '#d9e7df' },
      { offset: 1, color: '#b7ccc2' },
    ],
    warm: [
      { offset: 0, color: '#fff4df' },
      { offset: 0.55, color: '#edc38b' },
      { offset: 1, color: '#9d6049' },
    ],
    cool: [
      { offset: 0, color: '#edf8f9' },
      { offset: 0.52, color: '#9cc6cf' },
      { offset: 1, color: '#456b7d' },
    ],
    studio: [
      { offset: 0, color: '#ffffff' },
      { offset: 0.6, color: '#f1f2f2' },
      { offset: 1, color: '#d9dcdd' },
    ],
    charcoal: [
      { offset: 0, color: '#4a4f52' },
      { offset: 0.6, color: '#2b2f31' },
      { offset: 1, color: '#16191a' },
    ],
  };
  return presets[preset];
}

export function customGradient(from: string, to: string): ColorStop[] {
  const hex = /^#[0-9a-f]{6}$/i;
  return [
    { offset: 0, color: hex.test(from) ? from : '#ffffff' },
    { offset: 1, color: hex.test(to) ? to : '#d9dcdd' },
  ];
}

export function linearCoords(angleDeg: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * 0.5;
  const dy = Math.sin(rad) * 0.5;
  return {
    x1: round4(0.5 - dx),
    y1: round4(0.5 - dy),
    x2: round4(0.5 + dx),
    y2: round4(0.5 + dy),
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function dropShadow(shadow: ShadowSettings, product: Size): { color: string; blur: number; offsetX: number; offsetY: number } | undefined {
  if (shadow.style !== 'drop') return undefined;
  const m = Math.max(product.width, product.height);
  const blur = round2((shadow.blur / 100) * 0.06 * m);
  const offsetY = round2((shadow.distance / 100) * 0.04 * m);
  const opacity = round2(shadow.opacity / 100);
  return {
    color: `rgba(0,0,0,${opacity.toFixed(2)})`,
    blur,
    offsetX: 0,
    offsetY,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Bounding box of pixels whose alpha exceeds `threshold`; undefined when every pixel is transparent. */
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 16): Box | undefined {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? undefined : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Visible-object box inside the laid-out product box, given opaque bounds and crop in source pixels. */
export function visibleProductBox(productBox: Box, crop: Box, opaque?: Box): Box {
  if (!opaque) return productBox;
  const left = Math.max(opaque.left, crop.left), top = Math.max(opaque.top, crop.top);
  const right = Math.min(opaque.left + opaque.width, crop.left + crop.width), bottom = Math.min(opaque.top + opaque.height, crop.top + crop.height);
  if (right <= left || bottom <= top) return productBox;
  return { left: productBox.left + left - crop.left, top: productBox.top + top - crop.top, width: right - left, height: bottom - top };
}

export function groundShadow(shadow: ShadowSettings, productBox: Box): { cx: number; cy: number; rx: number; ry: number; opacity: number; softness: number } | undefined {
  if (shadow.style !== 'ground') return undefined;
  const cx = round2(productBox.left + productBox.width / 2);
  const cy = round2(productBox.top + productBox.height - productBox.height * 0.015 + (shadow.distance / 100) * productBox.height * 0.04);
  const rx = round2(productBox.width * (0.36 + 0.14 * (shadow.blur / 100)));
  const ry = round2(Math.max(2, productBox.height * (0.035 + 0.045 * (shadow.blur / 100))));
  const opacity = round2(shadow.opacity / 100);
  const softness = round2(0.35 + 0.55 * (shadow.blur / 100));
  return { cx, cy, rx, ry, opacity, softness };
}
