/**
 * Headless scene compositor: builds the same frame / backdrop / shadow / subject graph the Photo Studio
 * canvas builds (see layoutSceneObjects in controller.ts) but on a detached StaticCanvas at native frame
 * resolution, so Quick Optimize can apply a Studio preset across a whole queue without touching the live
 * editor. Keep the object construction here in sync with the editor's version.
 */
import { Ellipse, FabricImage, Gradient, Rect, Shadow, StaticCanvas } from 'fabric';
import { adjustmentFilters } from './filters';
import type { Adjustments, Backdrop } from './looks';
import { alphaBounds, backdropPlacement, dropShadow, groundShadow, linearCoords, placeSubject, visibleProductBox, type Box, type SceneSettings } from './scene';

export type ComposeInput = {
  subject: HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  /** Opaque area of the subject in source pixels (a cutout's alpha bounds); defaults to the whole photo. */
  visible?: Box;
  scene: SceneSettings;
  backdrop: Backdrop;
  adjustments: Adjustments;
  /** Decoded backdrop image for uploaded backdrops. */
  backdropImage?: HTMLImageElement;
};

export type Composed = { canvas: HTMLCanvasElement; frame: { width: number; height: number } | undefined };

const staticCanvas = (width: number, height: number) => new StaticCanvas(undefined, { width, height, enableRetinaScaling: false, renderOnAddRemove: false });

const subjectImage = (input: ComposeInput) => {
  const image = new FabricImage(input.subject, { selectable: false, evented: false });
  image.filters = adjustmentFilters(input.adjustments) as never;
  image.applyFilters();
  return image;
};

const finish = (canvas: StaticCanvas, frame: { width: number; height: number } | undefined): Composed => {
  canvas.renderAll();
  const rendered = canvas.toCanvasElement(1);
  canvas.dispose();
  return { canvas: rendered, frame };
};

export function composeScene(input: ComposeInput): Composed {
  const { width, height } = input;
  if (!(width > 0) || !(height > 0)) throw new Error('The photo has no pixels to render.');
  const image = subjectImage(input);
  if (input.backdrop.kind === 'none') {
    const canvas = staticCanvas(width, height);
    image.set({ originX: 'left', originY: 'top', left: 0, top: 0 });
    canvas.add(image);
    return finish(canvas, undefined);
  }
  const visibleBox = visibleProductBox({ left: 0, top: 0, width, height }, { left: 0, top: 0, width, height }, input.visible);
  const L = placeSubject({ width, height }, visibleBox, input.scene, input.adjustments.rotation, input.adjustments.flipX, input.adjustments.flipY);
  const canvas = staticCanvas(L.frame.width, L.frame.height);
  let fill: string | Gradient<'linear'> = '#ffffff';
  if (input.backdrop.kind === 'color') fill = input.backdrop.color;
  else if (input.backdrop.kind === 'gradient') fill = new Gradient({ type: 'linear', gradientUnits: 'percentage', coords: linearCoords(input.backdrop.angle), colorStops: input.backdrop.stops });
  canvas.add(new Rect({ selectable: false, evented: false, originX: 'left', originY: 'top', left: 0, top: 0, width: L.frame.width, height: L.frame.height, fill } as never));
  if (input.backdrop.kind === 'image' && input.backdropImage) {
    const el = input.backdropImage;
    const box = backdropPlacement({ width: el.naturalWidth, height: el.naturalHeight }, L.frame, input.backdrop.fit);
    canvas.add(new FabricImage(el, { selectable: false, evented: false, originX: 'left', originY: 'top', left: box.left, top: box.top, scaleX: box.width / el.naturalWidth, scaleY: box.height / el.naturalHeight } as never));
  }
  const g = groundShadow(input.scene.shadow, L.subject);
  if (g) {
    canvas.add(new Ellipse({ selectable: false, evented: false, originX: 'center', originY: 'center', left: g.cx, top: g.cy, rx: g.rx, ry: g.ry, fill: new Gradient({ type: 'radial', gradientUnits: 'percentage', coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 }, colorStops: [{ offset: 0, color: `rgba(0,0,0,${g.opacity})` }, { offset: Math.max(0, 1 - g.softness), color: `rgba(0,0,0,${(g.opacity * 0.8).toFixed(3)})` }, { offset: 1, color: 'rgba(0,0,0,0)' }] }) } as never));
  }
  const d = dropShadow(input.scene.shadow, { width: L.subject.width / L.zoom, height: L.subject.height / L.zoom });
  if (d) image.shadow = new Shadow({ color: d.color, blur: d.blur, offsetX: d.offsetX, offsetY: d.offsetY });
  image.set({ originX: 'center', originY: 'center', left: L.center.x, top: L.center.y, scaleX: L.zoom, scaleY: L.zoom, angle: input.adjustments.rotation, flipX: input.adjustments.flipX, flipY: input.adjustments.flipY, clipPath: new Rect({ left: 0, top: 0, width: L.frame.width, height: L.frame.height, originX: 'left', originY: 'top', absolutePositioned: true }) });
  canvas.add(image);
  return finish(canvas, L.frame);
}

/** Opaque bounds of a source image sampled at ≤256 px, matching the Studio's live measurement. */
export function imageAlphaBounds(source: HTMLCanvasElement | HTMLImageElement): Box | undefined {
  const width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
  const height = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
  if (!(width > 0) || !(height > 0)) return undefined;
  const k = Math.min(1, 256 / Math.max(width, height));
  const probe = document.createElement('canvas');
  probe.width = Math.max(1, Math.round(width * k));
  probe.height = Math.max(1, Math.round(height * k));
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, probe.width, probe.height);
  const box = alphaBounds(ctx.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height);
  return box ? { left: box.left / k, top: box.top / k, width: box.width / k, height: box.height / k } : undefined;
}
