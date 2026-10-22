import { Canvas, Ellipse, FabricImage, type FabricObject, filters, Gradient, Point, Rect, Shadow } from 'fabric';
import { centerCrop, comparisonClip, normalizedAdjustment, sharpenMatrix, SnapshotHistory, temperatureMatrix, type CropRect } from './tools';
import { alphaBounds, backdropPlacement, clampScene, visibleProductBox, type Box, customGradient, defaultScene, dropShadow, gradientStops, groundShadow, linearCoords, sceneLayout, type BackdropFit, type ColorStop, type FrameAspect, type GradientPreset, type SceneSettings, type ShadowStyle } from './scene';
import { acknowledgeBgRemoval, BG_REMOVAL_NOTICE, hasAcknowledgedBgRemoval, removeBackground, webGpuAvailable, type EdgeCleanup, type MatteProvider } from '../bgremove';
import { acknowledgeEnhanceLicense, enhanceImage, ENHANCE_LICENSE_SUMMARY, hasAcknowledgedEnhanceLicense, resizeBaseline, type EnhanceTargetEdge } from '../enhance';
import { inputIssue } from '../engine/input';

type Adjustments = {
  exposure: number; brightness: number; contrast: number; saturation: number;
  temperature: number; sharpness: number; rotation: number; flipX: boolean; flipY: boolean;
  preset: 'none' | 'grayscale' | 'sepia';
};
type Backdrop =
  | { kind: 'none' }
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; stops: ColorStop[]; angle: number }
  | { kind: 'image'; url: string; fit: BackdropFit };
type Snapshot = { canvas: unknown; adjustments: Adjustments; crop: CropRect; original: { width: number; height: number }; comparisonUrl: string; scene: SceneSettings; backdrop: Backdrop };
const defaults = (): Adjustments => ({ exposure: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0, rotation: 0, flipX: false, flipY: false, preset: 'none' });

export function initEditor() {
  const panelTabs = document.querySelector<HTMLElement>('.editor-panel .panel-tabs')!;
  panelTabs.insertAdjacentHTML('beforeend', '<button data-panel-tab="background" type="button">Background</button><button data-panel-tab="enhance" type="button">Enhance</button>');
  document.querySelector<HTMLElement>('[data-editor-panel="export"]')!.insertAdjacentHTML('beforebegin', '<div data-editor-panel="background" hidden><fieldset><legend>Remove background (AI)</legend><p class="hint" id="bgr-notice"></p><div id="bgr-ack"><button id="ack-bgr" type="button">Enable optional AI background removal</button></div><div id="bgr-controls" hidden><label>Edges <select id="bgr-cleanup"><option value="crisp" selected>Crisp</option><option value="balanced">Balanced</option><option value="soft">Soft</option></select></label><label><input id="bgr-refine" type="checkbox" checked /> Refine edges with photo detail</label><p class="hint">Refinement helps on plain backgrounds; turn it off for busy scenes.</p><label>Processor <select id="bgr-provider"><option value="auto" selected>Auto (GPU when available)</option><option value="wasm">CPU (WASM)</option><option value="webgpu">GPU (WebGPU)</option></select></label><div class="tool-buttons"><button id="run-bgr" type="button">Remove background</button></div></div><p id="bgr-status" class="hint" role="status">AI background removal is off until you opt in.</p></fieldset><fieldset><legend>Backdrop</legend><div class="tool-buttons"><button id="backdrop-none" type="button">Transparent</button></div><label>Solid color <input id="backdrop-color" type="color" value="#ffffff" /></label><div class="tool-buttons"><button id="apply-backdrop-color" type="button">Use color</button></div><p class="hint">Studio gradients</p><div class="tool-buttons"><button data-gradient="studio" type="button">Studio white</button><button data-gradient="soft" type="button">Soft</button><button data-gradient="warm" type="button">Warm</button><button data-gradient="cool" type="button">Cool</button><button data-gradient="charcoal" type="button">Charcoal</button></div><label>From <input id="gradient-from" type="color" value="#ffffff" /></label><label>To <input id="gradient-to" type="color" value="#d9dcdd" /></label><label>Angle <output id="gradient-angle-value">90°</output><input id="gradient-angle" type="range" min="0" max="360" value="90" /></label><div class="tool-buttons"><button id="apply-custom-gradient" type="button">Use custom gradient</button></div><label>Background photo <input id="backdrop-file" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>Fit <select id="backdrop-fit"><option value="cover">Fill frame</option><option value="contain">Fit inside</option></select></label><p id="background-status" class="hint" role="status"></p></fieldset><fieldset><legend>Layout</legend><label>Frame <select id="scene-aspect"><option value="1:1">Square 1:1</option><option value="4:5">Portrait 4:5</option><option value="4:3">Landscape 4:3</option><option value="16:9">Wide 16:9</option><option value="product">Match product</option></select></label><label>Padding <output id="scene-padding-value">10%</output><input id="scene-padding" type="range" min="0" max="40" value="10" /></label><label>Horizontal position <output id="scene-offset-x-value">0</output><input id="scene-offset-x" type="range" min="-100" max="100" value="0" /></label><label>Vertical position <output id="scene-offset-y-value">0</output><input id="scene-offset-y" type="range" min="-100" max="100" value="0" /></label><div class="tool-buttons"><button id="scene-center" type="button">Center product</button></div></fieldset><fieldset><legend>Shadow</legend><label>Style <select id="shadow-style"><option value="none">None</option><option value="ground">Ground contact</option><option value="drop">Drop shadow</option></select></label><label>Opacity <output id="shadow-opacity-value">35%</output><input id="shadow-opacity" type="range" min="0" max="100" value="35" /></label><label>Softness <output id="shadow-blur-value">50</output><input id="shadow-blur" type="range" min="0" max="100" value="50" /></label><label>Distance <output id="shadow-distance-value">20</output><input id="shadow-distance" type="range" min="0" max="100" value="20" /></label></fieldset><p class="hint">Layout never resamples the product pixels. Shadows look most natural on transparent cutouts. Your original file is unchanged.</p></div><div data-editor-panel="enhance" hidden><fieldset><legend>AI Enhance</legend><p class="hint" id="enhance-license-text"></p><div id="enhance-ack"><button id="ack-enhance" type="button">Enable optional AI Enhance</button></div><div id="enhance-controls" hidden><div class="edge-grid" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="enhance-edge" value="1024" checked />1024px</label><label><input type="radio" name="enhance-edge" value="2048" />2048px</label></div><div class="tool-buttons"><button id="run-enhance" type="button">Run local enhance</button><button id="clear-enhance" type="button" disabled>Use original pixels</button></div></div><p class="hint">Never runs automatically. Compare shows a standard resize versus the AI result.</p><p id="enhance-status" class="hint" role="status">AI Enhance is off until you opt in.</p></fieldset></div>');
  const element = document.querySelector<HTMLCanvasElement>('#editor-canvas')!;
  const stage = document.querySelector<HTMLElement>('#editor-stage')!;
  const empty = document.querySelector<HTMLElement>('#editor-empty')!;
  const title = document.querySelector<HTMLElement>('#editor-file')!;
  const compare = document.querySelector<HTMLInputElement>('#compare')!;
  const comparePosition = document.querySelector<HTMLInputElement>('#compare-position')!;
  const comparePositionWrap = document.querySelector<HTMLElement>('#compare-position-wrap')!;
  const studio = new Canvas(element, { selection: false, preserveObjectStacking: true });
  const adjustments = defaults();
  let image: FabricImage | undefined;
  let scene = defaultScene();
  let backdrop: Backdrop = { kind: 'none' };
  const backdropImages = new Map<string, HTMLImageElement>();
  let sceneObjects: FabricObject[] = [];
  let frameBox: { left: number; top: number; width: number; height: number; scale: number } | undefined;
  let opaqueBounds: Box | undefined;
  let comparisonImage: FabricImage | undefined;
  let originalFile: File | undefined;
  let objectUrl = '';
  let comparisonUrl = '';
  let original = { width: 0, height: 0 };
  let pristine = { width: 0, height: 0 };
  const generatedUrls: string[] = [];
  let enhancing = false;
  let crop: CropRect = { width: 0, height: 0, x: 0, y: 0 };
  let cropFrame: Rect | undefined;
  const history = new SnapshotHistory<Snapshot>();
  let restoring = false;
  let previewFrame: number | undefined;

  const ids: Record<keyof Pick<Adjustments, 'exposure' | 'brightness' | 'contrast' | 'saturation' | 'temperature' | 'sharpness' | 'rotation'>, string> = {
    exposure: 'edit-exposure', brightness: 'edit-brightness', contrast: 'edit-contrast', saturation: 'edit-saturation', temperature: 'edit-temperature', sharpness: 'edit-sharpness', rotation: 'edit-rotation'
  };
  const setOutput = (id: string, value: number) => {
    const out = document.querySelector<HTMLOutputElement>(`#${id}-value`);
    if (out) out.textContent = `${value > 0 ? '+' : ''}${Math.round(value)}`;
  };
  /** Opaque-pixel bounds of the product in source pixels, sampled at ≤256px for speed. */
  const measureOpaqueBounds = () => {
    opaqueBounds = undefined;
    const el = image?.getElement() as CanvasImageSource | undefined;
    if (!el || !original.width || !original.height) return;
    const k = Math.min(1, 256 / Math.max(original.width, original.height));
    const probe = document.createElement('canvas');
    probe.width = Math.max(1, Math.round(original.width * k));
    probe.height = Math.max(1, Math.round(original.height * k));
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(el, 0, 0, probe.width, probe.height);
    const box = alphaBounds(ctx.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height);
    if (box) opaqueBounds = { left: box.left / k, top: box.top / k, width: box.width / k, height: box.height / k };
  };
  const layoutScene = () => {
    sceneObjects.forEach((obj) => studio.remove(obj));
    sceneObjects = [];
    frameBox = undefined;
    if (image) image.shadow = null;
    if (!image) return;
    const P = { width: crop.width, height: crop.height };
    if (backdrop.kind === 'none') {
      const scale = Math.min((studio.width! - 48) / image.width!, (studio.height! - 48) / image.height!);
      image.set({ left: studio.width! / 2, top: studio.height! / 2, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale });
      studio.requestRenderAll();
      return;
    }
    const L = sceneLayout(P, scene);
    const s = Math.min((studio.width! - 48) / L.frame.width, (studio.height! - 48) / L.frame.height);
    const frameLeft = (studio.width! - L.frame.width * s) / 2;
    const frameTop = (studio.height! - L.frame.height * s) / 2;
    frameBox = { left: frameLeft, top: frameTop, width: L.frame.width * s, height: L.frame.height * s, scale: s };
    image.set({
      originX: 'center', originY: 'center', scaleX: s, scaleY: s,
      left: frameLeft + (L.product.left + P.width / 2) * s,
      top: frameTop + (L.product.top + P.height / 2) * s,
    });
    let fill: string | Gradient<'linear'> = '#ffffff';
    if (backdrop.kind === 'color') fill = backdrop.color;
    else if (backdrop.kind === 'gradient') fill = new Gradient({ type: 'linear', gradientUnits: 'percentage', coords: linearCoords(backdrop.angle), colorStops: backdrop.stops });
    const frame = new Rect({ selectable: false, evented: false, originX: 'left', originY: 'top', left: frameLeft, top: frameTop, width: L.frame.width, height: L.frame.height, scaleX: s, scaleY: s, fill } as never);
    studio.insertAt(0, frame);
    sceneObjects.push(frame);
    let z = 1;
    if (backdrop.kind === 'image') {
      const el = backdropImages.get(backdrop.url);
      if (el) {
        const box = backdropPlacement({ width: el.naturalWidth, height: el.naturalHeight }, L.frame, backdrop.fit);
        const img = new FabricImage(el, { selectable: false, evented: false, originX: 'left', originY: 'top', left: frameLeft + box.left * s, top: frameTop + box.top * s, scaleX: box.width / el.naturalWidth * s, scaleY: box.height / el.naturalHeight * s, clipPath: new Rect({ left: frameLeft, top: frameTop, width: L.frame.width * s, height: L.frame.height * s, originX: 'left', originY: 'top', absolutePositioned: true }) } as never);
        studio.insertAt(z++, img);
        sceneObjects.push(img);
      }
    }
    const g = groundShadow(scene.shadow, visibleProductBox(L.product, { left: crop.x, top: crop.y, width: crop.width, height: crop.height }, opaqueBounds));
    if (g) {
      const ellipse = new Ellipse({ selectable: false, evented: false, originX: 'center', originY: 'center', left: frameLeft + g.cx * s, top: frameTop + g.cy * s, rx: g.rx * s, ry: g.ry * s, fill: new Gradient({ type: 'radial', gradientUnits: 'percentage', coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 }, colorStops: [{ offset: 0, color: `rgba(0,0,0,${g.opacity})` }, { offset: Math.max(0, 1 - g.softness), color: `rgba(0,0,0,${(g.opacity * 0.8).toFixed(3)})` }, { offset: 1, color: 'rgba(0,0,0,0)' }] }) } as never);
      studio.insertAt(z, ellipse);
      sceneObjects.push(ellipse);
    }
    const d = dropShadow(scene.shadow, P);
    if (d) image.shadow = new Shadow({ color: d.color, blur: d.blur, offsetX: d.offsetX, offsetY: d.offsetY });
    if (comparisonImage) studio.bringObjectToFront(comparisonImage);
    if (cropFrame) studio.bringObjectToFront(cropFrame);
    studio.requestRenderAll();
  };
  const resize = () => {
    studio.setDimensions({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) });
    if (image) layoutScene();
    studio.requestRenderAll();
    void updateComparison();
  };
  const sync = () => {
    (Object.entries(ids) as [keyof typeof ids, string][]).forEach(([key, id]) => {
      const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = String(adjustments[key]);
      setOutput(id, adjustments[key]);
    });
    document.querySelector<HTMLInputElement>('#flip-x')!.checked = adjustments.flipX;
    document.querySelector<HTMLInputElement>('#flip-y')!.checked = adjustments.flipY;
    document.querySelector<HTMLSelectElement>('#filter-preset')!.value = adjustments.preset;
    syncSceneControls();
  };
  const syncSceneControls = () => {
    const aspect = document.querySelector<HTMLSelectElement>('#scene-aspect')!;
    if (aspect.value !== scene.aspect) aspect.value = scene.aspect;
    const pad = document.querySelector<HTMLInputElement>('#scene-padding')!;
    if (pad.value !== String(scene.padding)) pad.value = String(scene.padding);
    document.querySelector<HTMLOutputElement>('#scene-padding-value')!.textContent = `${scene.padding}%`;
    const ox = document.querySelector<HTMLInputElement>('#scene-offset-x')!;
    if (ox.value !== String(scene.offsetX)) ox.value = String(scene.offsetX);
    document.querySelector<HTMLOutputElement>('#scene-offset-x-value')!.textContent = String(scene.offsetX);
    const oy = document.querySelector<HTMLInputElement>('#scene-offset-y')!;
    if (oy.value !== String(scene.offsetY)) oy.value = String(scene.offsetY);
    document.querySelector<HTMLOutputElement>('#scene-offset-y-value')!.textContent = String(scene.offsetY);
    const style = document.querySelector<HTMLSelectElement>('#shadow-style')!;
    if (style.value !== scene.shadow.style) style.value = scene.shadow.style;
    const op = document.querySelector<HTMLInputElement>('#shadow-opacity')!;
    if (op.value !== String(scene.shadow.opacity)) op.value = String(scene.shadow.opacity);
    document.querySelector<HTMLOutputElement>('#shadow-opacity-value')!.textContent = `${scene.shadow.opacity}%`;
    const bl = document.querySelector<HTMLInputElement>('#shadow-blur')!;
    if (bl.value !== String(scene.shadow.blur)) bl.value = String(scene.shadow.blur);
    document.querySelector<HTMLOutputElement>('#shadow-blur-value')!.textContent = String(scene.shadow.blur);
    const di = document.querySelector<HTMLInputElement>('#shadow-distance')!;
    if (di.value !== String(scene.shadow.distance)) di.value = String(scene.shadow.distance);
    document.querySelector<HTMLOutputElement>('#shadow-distance-value')!.textContent = String(scene.shadow.distance);
    const color = document.querySelector<HTMLInputElement>('#backdrop-color')!;
    if (backdrop.kind === 'color' && color.value !== backdrop.color) color.value = backdrop.color;
    const fit = document.querySelector<HTMLSelectElement>('#backdrop-fit')!;
    if (backdrop.kind === 'image' && fit.value !== backdrop.fit) fit.value = backdrop.fit;
    const status = document.querySelector<HTMLElement>('#background-status')!;
    if (backdrop.kind === 'none') status.textContent = 'Choose a backdrop to see layout and shadow.';
    else status.textContent = '';
  };
  const updateHistory = () => {
    document.querySelector<HTMLButtonElement>('#undo')!.disabled = !history.canUndo();
    document.querySelector<HTMLButtonElement>('#redo')!.disabled = !history.canRedo();
  };
  const syncBgrGate = () => {
    const ready = hasAcknowledgedBgRemoval();
    document.querySelector<HTMLElement>('#bgr-notice')!.textContent = BG_REMOVAL_NOTICE;
    document.querySelector<HTMLElement>('#bgr-ack')!.hidden = ready;
    document.querySelector<HTMLElement>('#bgr-controls')!.hidden = !ready;
    document.querySelector<HTMLElement>('#bgr-status')!.textContent = ready ? 'Ready. Uses U²-Netp (4.6 MB) after npm run fetch:bg-model.' : 'AI background removal is off until you opt in.';
  };
  const syncEnhanceGate = () => {
    const ack = document.querySelector<HTMLElement>('#enhance-ack')!;
    const controls = document.querySelector<HTMLElement>('#enhance-controls')!;
    const licenseText = document.querySelector<HTMLElement>('#enhance-license-text')!;
    licenseText.textContent = ENHANCE_LICENSE_SUMMARY;
    if (hasAcknowledgedEnhanceLicense()) {
      ack.hidden = true;
      controls.hidden = false;
    } else {
      ack.hidden = false;
      controls.hidden = true;
    }
  };
  const setEnhanceStatus = (text: string) => {
    const status = document.querySelector<HTMLElement>('#enhance-status')!;
    status.textContent = text;
  };
  const setBackgroundStatus = (text: string) => {
    const status = document.querySelector<HTMLElement>('#background-status')!;
    status.textContent = text;
  };
  const updateClearEnhance = () => {
    const button = document.querySelector<HTMLButtonElement>('#clear-enhance')!;
    button.disabled = original.width === pristine.width && original.height === pristine.height;
  };
  const canvasUrl = (canvas: HTMLCanvasElement): Promise<string> => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Canvas encoding failed.'));
      const url = URL.createObjectURL(blob);
      generatedUrls.push(url);
      resolve(url);
    }, 'image/png');
  });
  const remember = () => {
    if (restoring || cropFrame) return;
    if (comparisonImage) studio.remove(comparisonImage);
    sceneObjects.forEach((obj) => studio.remove(obj));
    history.push({ canvas: studio.toJSON(), adjustments: { ...adjustments }, crop: { ...crop }, original: { ...original }, comparisonUrl, scene: structuredClone(scene), backdrop: structuredClone(backdrop) });
    layoutScene();
    if (comparisonImage) {
      studio.add(comparisonImage);
      studio.bringObjectToFront(comparisonImage);
    }
    updateHistory();
  };
  const updateComparison = async () => {
    comparePositionWrap.hidden = !compare.checked;
    if (!image || !compare.checked) {
      if (comparisonImage) studio.remove(comparisonImage);
      comparisonImage = undefined;
      studio.requestRenderAll();
      return;
    }
    if (!comparisonImage) {
      const currentUrl = comparisonUrl;
      const overlay = await FabricImage.fromURL(currentUrl);
      if (!compare.checked || currentUrl !== comparisonUrl || !image) return;
      comparisonImage = overlay;
      studio.add(comparisonImage);
    }
    const clip = comparisonClip(image.width!, image.height!, Number(comparePosition.value));
    comparisonImage.set({
      left: image.left, top: image.top, originX: image.originX, originY: image.originY,
      scaleX: image.scaleX, scaleY: image.scaleY, angle: image.angle, flipX: image.flipX, flipY: image.flipY,
      cropX: image.cropX, cropY: image.cropY, width: image.width, height: image.height,
      selectable: false, evented: false,
      clipPath: new Rect({ ...clip, originX: 'center', originY: 'center', absolutePositioned: false })
    });
    comparisonImage.filters = [];
    comparisonImage.applyFilters();
    studio.bringObjectToFront(comparisonImage);
    if (cropFrame) studio.bringObjectToFront(cropFrame);
    studio.requestRenderAll();
  };
  const applyAdjustments = () => {
    if (!image) return;
    image.set({ angle: adjustments.rotation, flipX: adjustments.flipX, flipY: adjustments.flipY });
    const list: object[] = [
      new filters.Brightness({ brightness: normalizedAdjustment(adjustments.exposure) }),
      new filters.Brightness({ brightness: normalizedAdjustment(adjustments.brightness) }),
      new filters.Contrast({ contrast: normalizedAdjustment(adjustments.contrast) }),
      new filters.Saturation({ saturation: normalizedAdjustment(adjustments.saturation) }),
      new filters.ColorMatrix({ matrix: temperatureMatrix(adjustments.temperature) })
    ];
    if (adjustments.sharpness) list.push(new filters.Convolute({ matrix: sharpenMatrix(adjustments.sharpness) }));
    if (adjustments.preset === 'grayscale') list.push(new filters.Grayscale());
    if (adjustments.preset === 'sepia') list.push(new filters.Sepia());
    image.filters = list as never;
    image.applyFilters();
    layoutScene();
    studio.requestRenderAll();
    void updateComparison();
  };
  const queuePreview = () => {
    if (previewFrame) cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(() => { previewFrame = undefined; applyAdjustments(); });
  };
  const commit = () => { applyAdjustments(); remember(); };
  const resetGroup = (keys: (keyof Adjustments)[]) => {
    const base = defaults();
    keys.forEach((key) => { adjustments[key] = base[key] as never; });
    sync();
    commit();
  };
  const clearCropFrame = () => {
    if (cropFrame) studio.remove(cropFrame);
    cropFrame = undefined;
    studio.requestRenderAll();
  };
  const startCrop = (ratio?: number) => {
    if (!image) return;
    clearCropFrame();
    const bounds = image.getBoundingRect();
    const target = ratio ? centerCrop(bounds.width, bounds.height, ratio) : { x: bounds.width * .12, y: bounds.height * .12, width: bounds.width * .76, height: bounds.height * .76 };
    cropFrame = new Rect({ left: bounds.left + target.x, top: bounds.top + target.y, width: target.width, height: target.height, fill: '#ffffff16', stroke: '#f0a53e', strokeWidth: 2, strokeDashArray: [8, 6], lockRotation: true, transparentCorners: false, cornerColor: '#f0a53e', name: 'Crop frame' } as never);
    studio.add(cropFrame);
    studio.bringObjectToFront(cropFrame);
    studio.setActiveObject(cropFrame);
    studio.requestRenderAll();
  };
  const applyCrop = () => {
    if (!image || !cropFrame) return;
    const bounds = image.getBoundingRect();
    const frame = cropFrame.getBoundingRect();
    const left = Math.max(bounds.left, frame.left);
    const top = Math.max(bounds.top, frame.top);
    const right = Math.min(bounds.left + bounds.width, frame.left + frame.width);
    const bottom = Math.min(bounds.top + bounds.height, frame.top + frame.height);
    if (right <= left || bottom <= top) return;
    const displayed = { x: (left - bounds.left) / bounds.width, y: (top - bounds.top) / bounds.height, width: (right - left) / bounds.width, height: (bottom - top) / bounds.height };
    crop = { x: crop.x + crop.width * displayed.x, y: crop.y + crop.height * displayed.y, width: crop.width * displayed.width, height: crop.height * displayed.height };
    clearCropFrame();
    image.set({ cropX: crop.x, cropY: crop.y, width: crop.width, height: crop.height });
    layoutScene();
    commit();
  };
  const resetCrop = () => {
    if (!image) return;
    clearCropFrame();
    crop = { x: 0, y: 0, width: original.width, height: original.height };
    image.set({ cropX: 0, cropY: 0, width: original.width, height: original.height });
    layoutScene();
    commit();
  };
  const restore = async (snapshot?: Snapshot) => {
    if (!snapshot) return;
    restoring = true;
    comparisonImage = undefined;
    await studio.loadFromJSON(snapshot.canvas as never);
    image = studio.getObjects().find(object => object.type === 'image') as FabricImage | undefined;
    scene = structuredClone(snapshot.scene);
    backdrop = structuredClone(snapshot.backdrop);
    sceneObjects = [];
    crop = { ...snapshot.crop };
    original = { ...snapshot.original };
    comparisonUrl = snapshot.comparisonUrl;
    measureOpaqueBounds();
    restoring = false;
    sync();
    applyAdjustments();
    updateHistory();
    updateClearEnhance();
  };
  const load = async (file: File) => {
    for (const url of generatedUrls) URL.revokeObjectURL(url);
    generatedUrls.length = 0;
    backdropImages.clear();
    originalFile = file;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    comparisonUrl = objectUrl;
    studio.clear();
    image = await FabricImage.fromURL(objectUrl);
    original = { width: image.width!, height: image.height! };
    pristine = { ...original };
    measureOpaqueBounds();
    crop = { x: 0, y: 0, width: original.width, height: original.height };
    scene = defaultScene();
    backdrop = { kind: 'none' };
    sceneObjects = [];
    frameBox = undefined;
    image.set({ selectable: false, evented: false, originX: 'center', originY: 'center' });
    studio.add(image);
    layoutScene();
    Object.assign(adjustments, defaults());
    history.reset();
    title.textContent = file.name;
    empty.hidden = true;
    element.hidden = false;
    sync();
    applyAdjustments();
    remember();
    updateClearEnhance();
  };

  resize();
  new ResizeObserver(resize).observe(stage);
  (Object.entries(ids) as [keyof typeof ids, string][]).forEach(([key, id]) => {
    const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
    input.addEventListener('input', () => { adjustments[key] = Number(input.value); setOutput(id, adjustments[key]); queuePreview(); });
    input.addEventListener('change', commit);
  });
  document.querySelector<HTMLInputElement>('#flip-x')!.addEventListener('change', (event) => { adjustments.flipX = (event.target as HTMLInputElement).checked; commit(); });
  document.querySelector<HTMLInputElement>('#flip-y')!.addEventListener('change', (event) => { adjustments.flipY = (event.target as HTMLInputElement).checked; commit(); });
  document.querySelector<HTMLSelectElement>('#filter-preset')!.addEventListener('change', (event) => { adjustments.preset = (event.target as HTMLSelectElement).value as Adjustments['preset']; commit(); });
  document.querySelector('#backdrop-none')!.addEventListener('click', () => { backdrop = { kind: 'none' }; layoutScene(); remember(); syncSceneControls(); });
  document.querySelector('#apply-backdrop-color')!.addEventListener('click', () => { backdrop = { kind: 'color', color: document.querySelector<HTMLInputElement>('#backdrop-color')!.value }; layoutScene(); remember(); syncSceneControls(); });
  document.querySelectorAll<HTMLButtonElement>('[data-gradient]').forEach((button) => button.addEventListener('click', () => { backdrop = { kind: 'gradient', stops: gradientStops(button.dataset.gradient as GradientPreset), angle: 90 }; layoutScene(); remember(); syncSceneControls(); }));
  document.querySelector('#apply-custom-gradient')!.addEventListener('click', () => {
    const from = document.querySelector<HTMLInputElement>('#gradient-from')!.value;
    const to = document.querySelector<HTMLInputElement>('#gradient-to')!.value;
    const angle = Number(document.querySelector<HTMLInputElement>('#gradient-angle')!.value);
    backdrop = { kind: 'gradient', stops: customGradient(from, to), angle };
    layoutScene();
    remember();
    syncSceneControls();
  });
  document.querySelector<HTMLInputElement>('#gradient-angle')!.addEventListener('input', (event) => {
    document.querySelector<HTMLOutputElement>('#gradient-angle-value')!.textContent = `${(event.target as HTMLInputElement).value}°`;
  });
  document.querySelector<HTMLInputElement>('#backdrop-file')!.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const issue = inputIssue(file);
    if (issue) { setBackgroundStatus(issue); return; }
    setBackgroundStatus('');
    const url = URL.createObjectURL(file);
    generatedUrls.push(url);
    const el = new Image();
    el.src = url;
    try { await el.decode(); } catch { setBackgroundStatus('This background photo could not be decoded.'); return; }
    backdropImages.set(url, el);
    backdrop = { kind: 'image', url, fit: (document.querySelector<HTMLSelectElement>('#backdrop-fit')!.value as BackdropFit) };
    layoutScene();
    remember();
    syncSceneControls();
    (event.target as HTMLInputElement).value = '';
  });
  document.querySelector<HTMLSelectElement>('#backdrop-fit')!.addEventListener('change', (event) => {
    if (backdrop.kind === 'image') backdrop.fit = (event.target as HTMLSelectElement).value as BackdropFit;
    layoutScene();
    remember();
    syncSceneControls();
  });
  syncEnhanceGate();
  syncBgrGate();
  let removing = false;
  document.querySelector('#ack-bgr')!.addEventListener('click', () => { acknowledgeBgRemoval(); syncBgrGate(); });
  document.querySelector('#run-bgr')!.addEventListener('click', async () => {
    if (!image || removing) return;
    removing = true;
    const button = document.querySelector<HTMLButtonElement>('#run-bgr')!;
    const status = document.querySelector<HTMLElement>('#bgr-status')!;
    button.disabled = true;
    const choice = document.querySelector<HTMLSelectElement>('#bgr-provider')!.value as MatteProvider | 'auto';
    const auto = choice === 'auto';
    const first: MatteProvider = auto ? (await webGpuAvailable() ? 'webgpu' : 'wasm') : choice;
    const cleanup = document.querySelector<HTMLSelectElement>('#bgr-cleanup')!.value as EdgeCleanup;
    const refine = document.querySelector<HTMLInputElement>('#bgr-refine')!.checked;
    const el = image.getElement() as HTMLImageElement | HTMLCanvasElement;
    const previousUrl = image.getSrc();
    const run = (provider: MatteProvider) => removeBackground(el, { model: 'u2netp', provider, cleanup, refine, onProgress: label => { status.textContent = label; } });
    try {
      let fellBack = false;
      const result = await run(first).catch(error => {
        if (!auto || first !== 'webgpu') throw error;
        fellBack = true;
        return run('wasm');
      });
      await swapImage(await canvasUrl(result.canvas), previousUrl);
      status.textContent = `Background removed with U²-Netp on ${result.provider.toUpperCase()}${fellBack ? ' (WebGPU failed, used CPU)' : ''} in ${result.totalMs} ms (model ${result.inferenceMs} ms). Use Before / after to compare; Undo restores it.${backdrop.kind === 'none' ? ' Pick a backdrop below, or export PNG/WebP to keep transparency.' : ''}`;
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError' ? 'Background removal cancelled.' : (error as Error).message;
      status.textContent = `${message} Run "npm run fetch:bg-model" if the model file is missing.`;
    } finally {
      button.disabled = false;
      removing = false;
    }
  });
  document.querySelector('#ack-enhance')!.addEventListener('click', () => {
    acknowledgeEnhanceLicense();
    syncEnhanceGate();
    setEnhanceStatus('Ready. Enhance runs on the WASM CPU backend in this browser.');
  });
  document.querySelector('#run-enhance')!.addEventListener('click', async () => {
    if (!image || !originalFile || enhancing) return;
    enhancing = true;
    const runButton = document.querySelector<HTMLButtonElement>('#run-enhance')!;
    const clearButton = document.querySelector<HTMLButtonElement>('#clear-enhance')!;
    runButton.disabled = true;
    clearButton.disabled = true;
    const status = document.querySelector<HTMLElement>('#enhance-status')!;
    const edgeInput = document.querySelector<HTMLInputElement>('input[name="enhance-edge"]:checked')!;
    const target = Number(edgeInput.value) as EnhanceTargetEdge;
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(originalFile, { imageOrientation: 'from-image' });
      const result = await enhanceImage(bitmap, { targetEdge: target, onProgress: (_f, label) => { status.textContent = label; } });
      const baseline = resizeBaseline(bitmap, result.width, result.height);
      const enhancedUrl = await canvasUrl(result.canvas);
      const baselineUrl = await canvasUrl(baseline);
      await swapImage(enhancedUrl, baselineUrl);
      status.textContent = `Enhanced to ${result.width}×${result.height} with ${result.provider.toUpperCase()} in ${result.elapsedMs} ms (≈${(result.peakBytesEstimate / 1_048_576).toFixed(1)} MB working set). Undo restores the previous step; the original file is untouched.`;
      updateClearEnhance();
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError' ? 'Enhancement cancelled.' : (error as Error).message;
      status.textContent = `${message} Run "npm run fetch:model" if the model file is missing.`;
    } finally {
      bitmap?.close();
      enhancing = false;
      runButton.disabled = false;
      clearButton.disabled = false;
      updateClearEnhance();
    }
  });
  document.querySelector('#clear-enhance')!.addEventListener('click', async () => {
    if (!image) return;
    await swapImage(objectUrl, objectUrl);
    setEnhanceStatus('Restored original pixels.');
    updateClearEnhance();
  });
  compare.addEventListener('change', () => void updateComparison());
  comparePosition.addEventListener('input', () => void updateComparison());
  document.querySelector('#undo')!.addEventListener('click', () => void restore(history.undo()));
  document.querySelector('#redo')!.addEventListener('click', () => void restore(history.redo()));
  document.querySelector('#reset-editor')!.addEventListener('click', () => { if (originalFile) void load(originalFile); });
  document.querySelector('#reset-light')!.addEventListener('click', () => resetGroup(['exposure', 'brightness', 'contrast']));
  document.querySelector('#reset-color')!.addEventListener('click', () => resetGroup(['saturation', 'temperature', 'sharpness', 'preset']));
  document.querySelector('#reset-transform')!.addEventListener('click', () => resetGroup(['rotation', 'flipX', 'flipY']));
  document.querySelector('#rotate-left')!.addEventListener('click', () => { adjustments.rotation = Math.max(-180, adjustments.rotation - 90); sync(); commit(); });
  document.querySelector('#rotate-right')!.addEventListener('click', () => { adjustments.rotation = Math.min(180, adjustments.rotation + 90); sync(); commit(); });
  document.querySelector('#fit')!.addEventListener('click', () => { if (image) { layoutScene(); studio.setZoom(1); studio.requestRenderAll(); void updateComparison(); } });
  document.querySelector('#actual')!.addEventListener('click', () => { if (image) { image.set({ scaleX: 1, scaleY: 1 }); studio.requestRenderAll(); void updateComparison(); } });
  document.querySelector('#start-crop')!.addEventListener('click', () => startCrop());
  document.querySelectorAll<HTMLButtonElement>('[data-crop]').forEach((button) => button.addEventListener('click', () => startCrop(Number(button.dataset.crop))));
  document.querySelector('#apply-crop')!.addEventListener('click', applyCrop);
  document.querySelector('#cancel-crop')!.addEventListener('click', clearCropFrame);
  document.querySelector('#reset-crop')!.addEventListener('click', resetCrop);
  document.querySelector('#scene-aspect')!.addEventListener('change', (event) => { scene = clampScene({ ...scene, aspect: (event.target as HTMLSelectElement).value as FrameAspect }); layoutScene(); remember(); syncSceneControls(); });
  document.querySelector('#scene-padding')!.addEventListener('input', (event) => { scene = clampScene({ ...scene, padding: Number((event.target as HTMLInputElement).value) }); document.querySelector<HTMLOutputElement>('#scene-padding-value')!.textContent = `${scene.padding}%`; layoutScene(); });
  document.querySelector('#scene-padding')!.addEventListener('change', () => remember());
  document.querySelector('#scene-offset-x')!.addEventListener('input', (event) => { scene = clampScene({ ...scene, offsetX: Number((event.target as HTMLInputElement).value) }); document.querySelector<HTMLOutputElement>('#scene-offset-x-value')!.textContent = String(scene.offsetX); layoutScene(); });
  document.querySelector('#scene-offset-x')!.addEventListener('change', () => remember());
  document.querySelector('#scene-offset-y')!.addEventListener('input', (event) => { scene = clampScene({ ...scene, offsetY: Number((event.target as HTMLInputElement).value) }); document.querySelector<HTMLOutputElement>('#scene-offset-y-value')!.textContent = String(scene.offsetY); layoutScene(); });
  document.querySelector('#scene-offset-y')!.addEventListener('change', () => remember());
  document.querySelector('#scene-center')!.addEventListener('click', () => { scene = clampScene({ ...scene, offsetX: 0, offsetY: 0 }); syncSceneControls(); layoutScene(); remember(); });
  document.querySelector('#shadow-style')!.addEventListener('change', (event) => { scene = clampScene({ ...scene, shadow: { ...scene.shadow, style: (event.target as HTMLSelectElement).value as ShadowStyle } }); layoutScene(); remember(); syncSceneControls(); });
  document.querySelector('#shadow-opacity')!.addEventListener('input', (event) => { scene = clampScene({ ...scene, shadow: { ...scene.shadow, opacity: Number((event.target as HTMLInputElement).value) } }); document.querySelector<HTMLOutputElement>('#shadow-opacity-value')!.textContent = `${scene.shadow.opacity}%`; layoutScene(); });
  document.querySelector('#shadow-opacity')!.addEventListener('change', () => remember());
  document.querySelector('#shadow-blur')!.addEventListener('input', (event) => { scene = clampScene({ ...scene, shadow: { ...scene.shadow, blur: Number((event.target as HTMLInputElement).value) } }); document.querySelector<HTMLOutputElement>('#shadow-blur-value')!.textContent = String(scene.shadow.blur); layoutScene(); });
  document.querySelector('#shadow-blur')!.addEventListener('change', () => remember());
  document.querySelector('#shadow-distance')!.addEventListener('input', (event) => { scene = clampScene({ ...scene, shadow: { ...scene.shadow, distance: Number((event.target as HTMLInputElement).value) } }); document.querySelector<HTMLOutputElement>('#shadow-distance-value')!.textContent = String(scene.shadow.distance); layoutScene(); });
  document.querySelector('#shadow-distance')!.addEventListener('change', () => remember());
  studio.on('mouse:wheel', (event) => { const wheel = event.e as WheelEvent; wheel.preventDefault(); const next = Math.min(4, Math.max(.2, studio.getZoom() * (wheel.deltaY < 0 ? 1.1 : .9))); studio.zoomToPoint(new Point(wheel.offsetX, wheel.offsetY), next); document.querySelector('#zoom-value')!.textContent = `${Math.round(next * 100)}%`; });
  document.addEventListener('keydown', (event) => { if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return; if (event.key.toLowerCase() === 'z') { event.preventDefault(); void restore(event.shiftKey ? history.redo() : history.undo()); } if (event.key.toLowerCase() === 'y') { event.preventDefault(); void restore(history.redo()); } });

  const swapImage = async (url: string, nextComparisonUrl: string) => {
    if (!image) return;
    const next = await FabricImage.fromURL(url);
    const fx = next.width / original.width;
    const fy = next.height / original.height;
    crop = { x: crop.x * fx, y: crop.y * fy, width: crop.width * fx, height: crop.height * fy };
    original = { width: next.width, height: next.height };
    next.set({ selectable: false, evented: false, originX: 'center', originY: 'center', cropX: crop.x, cropY: crop.y, width: crop.width, height: crop.height });
    const index = studio.getObjects().indexOf(image);
    studio.remove(image);
    studio.insertAt(index, next);
    image = next;
    measureOpaqueBounds();
    if (comparisonImage) studio.remove(comparisonImage);
    comparisonImage = undefined;
    comparisonUrl = nextComparisonUrl;
    layoutScene();
    commit();
  };

  return {
    load(file: File) { void load(file); },
    async exportFile() {
      if (!image) return undefined;
      const overlay = comparisonImage;
      if (overlay) studio.remove(overlay);
      let dataUrl: string;
      if (frameBox) {
        dataUrl = studio.toDataURL({ format: 'png', left: frameBox.left, top: frameBox.top, width: frameBox.width, height: frameBox.height, multiplier: 1 / frameBox.scale });
      } else {
        const width = image.getScaledWidth();
        const height = image.getScaledHeight();
        dataUrl = studio.toDataURL({ format: 'png', left: image.left! - width / 2, top: image.top! - height / 2, width, height, multiplier: crop.width / width });
      }
      if (overlay) {
        studio.add(overlay);
        comparisonImage = overlay;
        void updateComparison();
      }
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], `${title.textContent || 'image'}-edited.png`, { type: 'image/png' });
    },
    dispose() { if (objectUrl) URL.revokeObjectURL(objectUrl); for (const url of generatedUrls) URL.revokeObjectURL(url); generatedUrls.length = 0; studio.dispose(); }
  };
}
