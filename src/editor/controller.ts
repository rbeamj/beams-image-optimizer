import { Canvas, Ellipse, FabricImage, type FabricObject, Gradient, Point, Rect, Shadow, util } from 'fabric';
import { CLEANUP_PANEL, mountAiTools, REFINE_PANEL } from './ai-tools';
import { centerCrop, comparisonClip, SnapshotHistory, type CropRect } from './tools';
import { alphaBounds, backdropPlacement, clampScene, visibleProductBox, type Box, customGradient, defaultScene, dropShadow, gradientStops, groundShadow, SCENE_PRESETS, type ScenePreset, linearCoords, placeSubject, type BackdropFit, type FrameAspect, type GradientPreset, type SceneSettings, type ShadowStyle } from './scene';
import { adjustmentFilters } from './filters';
import { defaultAdjustments, type Adjustments, type Backdrop, type StudioLook } from './looks';
import { acknowledgeBgRemoval, BG_REMOVAL_NOTICE, hasAcknowledgedBgRemoval, type EdgeCleanup } from '../bgremove';
import { removeAdaptive } from '../bgremove/adaptive';
import { acknowledgeEnhanceLicense, enhanceImage, ENHANCE_LICENSE_SUMMARY, hasAcknowledgedEnhanceLicense, resizeBaseline, type EnhanceTargetEdge } from '../enhance';
import { inputIssue } from '../engine/input';
import { RemovalEngine } from '../ai/removal-engine';
import { loadMode, saveMode } from '../ai/device-profile';
import type { RemovalMode } from '../ai/planner';
import { canvasToUrl, compositeUrl, loadImage, matteFromUrl, matteToUrl, pixels, type SubjectLayers } from './subject';

type Snapshot = { canvas: unknown; adjustments: Adjustments; crop: CropRect; original: { width: number; height: number }; comparisonUrl: string; scene: SceneSettings; backdrop: Backdrop; layers: SubjectLayers };

export function initEditor() {
  const panelTabs = document.querySelector<HTMLElement>('.editor-panel .panel-tabs')!;
  const steps: [panel: string, label: string, step?: number][] = [['background', 'Cutout', 1], ['refine', 'Refine', 2], ['cleanup', 'Cleanup', 3], ['enhance', 'Enhance', 4], ['scene', 'Scene', 5], ['adjust', 'Light'], ['color', 'Color'], ['transform', 'Transform'], ['crop', 'Crop'], ['export', 'Export', 6]];
  const navHtml = steps.map(([panel, label, step]) => `<button data-panel-tab="${panel}" type="button"${step ? ` title="Step ${step}: ${label}"` : ''}>${step ? `<span class="step-no" aria-hidden="true">${step}</span>` : ''}${label}</button>`).join('');
  panelTabs.className = 'panel-tabs workflow-tabs';
  panelTabs.innerHTML = navHtml;
  document.querySelector<HTMLElement>('.tool-rail')!.innerHTML = navHtml;
  document.querySelector<HTMLElement>('[data-editor-panel="export"]')!.insertAdjacentHTML('beforebegin', REFINE_PANEL + CLEANUP_PANEL);
  document.querySelector<HTMLElement>('[data-editor-panel="export"]')!.insertAdjacentHTML('beforebegin', '<div data-editor-panel="background" hidden><fieldset><legend>Remove background (AI)</legend><p class="hint" id="bgr-notice"></p><div id="bgr-ack"><button id="ack-bgr" type="button">Enable optional AI background removal</button></div><div id="bgr-controls" hidden><label>Edges <select id="bgr-cleanup"><option value="crisp" selected>Crisp</option><option value="balanced">Balanced</option><option value="soft">Soft</option></select></label><label><input id="bgr-refine" type="checkbox" checked /> Refine edges with photo detail</label><p class="hint">Refinement helps on plain backgrounds; turn it off for busy scenes.</p><label>Model <select id="bgr-mode"><option value="auto" selected>Auto (Recommended)</option><option value="fast">Fast (512)</option><option value="quality">Quality (1024)</option></select></label><p class="hint" id="bgr-mode-info">Checking this device…</p><progress id="bgr-progress" max="1" value="0" hidden></progress><div class="tool-buttons"><button id="run-bgr" type="button">Remove background</button></div></div><p id="bgr-status" class="hint" role="status">AI background removal is off until you opt in.</p></fieldset><p class="hint">Next: Refine fixes the cutout with clicks, Cleanup removes objects, Scene places the product on a backdrop.</p></div><div data-editor-panel="scene" hidden><fieldset><legend>Quick presets</legend><div class="tool-buttons"><button data-scene-preset="marketplace" type="button">Marketplace white 1:1</button><button data-scene-preset="social" type="button">Social 4:5</button><button data-scene-preset="banner" type="button">Banner 16:9</button><button data-scene-preset="catalog" type="button">Catalog 4:3</button></div><p class="hint">Presets set the frame, backdrop and shadow; fine-tune anything below. Works best after Cutout.</p></fieldset><fieldset><legend>Backdrop</legend><div class="tool-buttons"><button id="backdrop-none" type="button">Transparent</button></div><label>Solid color <input id="backdrop-color" type="color" value="#ffffff" /></label><div class="tool-buttons"><button id="apply-backdrop-color" type="button">Use color</button></div><p class="hint">Studio gradients</p><div class="tool-buttons"><button data-gradient="studio" type="button">Studio white</button><button data-gradient="soft" type="button">Soft</button><button data-gradient="warm" type="button">Warm</button><button data-gradient="cool" type="button">Cool</button><button data-gradient="charcoal" type="button">Charcoal</button></div><label>From <input id="gradient-from" type="color" value="#ffffff" /></label><label>To <input id="gradient-to" type="color" value="#d9dcdd" /></label><label>Angle <output id="gradient-angle-value">90°</output><input id="gradient-angle" type="range" min="0" max="360" value="90" /></label><div class="tool-buttons"><button id="apply-custom-gradient" type="button">Use custom gradient</button></div><label>Background photo <input id="backdrop-file" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>Fit <select id="backdrop-fit"><option value="cover">Fill frame</option><option value="contain">Fit inside</option></select></label><p id="background-status" class="hint" role="status"></p></fieldset><fieldset><legend>Layout</legend><label>Frame <select id="scene-aspect"><option value="1:1">Square 1:1</option><option value="4:5">Portrait 4:5</option><option value="4:3">Landscape 4:3</option><option value="16:9">Wide 16:9</option><option value="product">Match product</option></select></label><label>Padding <output id="scene-padding-value">10%</output><input id="scene-padding" type="range" min="0" max="40" value="10" /></label><label>Horizontal position <output id="scene-offset-x-value">0</output><input id="scene-offset-x" type="range" min="-100" max="100" value="0" /></label><label>Vertical position <output id="scene-offset-y-value">0</output><input id="scene-offset-y" type="range" min="-100" max="100" value="0" /></label><label>Subject size <output id="scene-scale-value">100%</output><input id="scene-scale" type="range" min="30" max="150" value="100" /></label><label>Subject rotation <output id="scene-rotation-value">0°</output><input id="scene-rotation" type="range" min="-180" max="180" value="0" /></label><div class="tool-buttons"><button id="scene-center" type="button">Center product</button></div></fieldset><fieldset><legend>Shadow</legend><label>Style <select id="shadow-style"><option value="none">None</option><option value="ground">Ground contact</option><option value="drop">Drop shadow</option></select></label><label>Opacity <output id="shadow-opacity-value">35%</output><input id="shadow-opacity" type="range" min="0" max="100" value="35" /></label><label>Softness <output id="shadow-blur-value">50</output><input id="shadow-blur" type="range" min="0" max="100" value="50" /></label><label>Distance <output id="shadow-distance-value">20</output><input id="shadow-distance" type="range" min="0" max="100" value="20" /></label></fieldset><p class="hint">Layout never resamples the product pixels. Shadows look most natural on transparent cutouts. Your original file is unchanged.</p></div><div data-editor-panel="enhance" hidden><fieldset><legend>AI Enhance</legend><p class="hint" id="enhance-license-text"></p><div id="enhance-ack"><button id="ack-enhance" type="button">Enable optional AI Enhance</button></div><div id="enhance-controls" hidden><div class="edge-grid" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="enhance-edge" value="1024" checked />1024px</label><label><input type="radio" name="enhance-edge" value="2048" />2048px</label></div><div class="tool-buttons"><button id="run-enhance" type="button">Run local enhance</button><button id="clear-enhance" type="button" disabled>Use original pixels</button></div></div><p class="hint">Never runs automatically. Compare shows a standard resize versus the AI result.</p><p id="enhance-status" class="hint" role="status">AI Enhance is off until you opt in.</p></fieldset></div>');
  const element = document.querySelector<HTMLCanvasElement>('#editor-canvas')!;
  const stage = document.querySelector<HTMLElement>('#editor-stage')!;
  const empty = document.querySelector<HTMLElement>('#editor-empty')!;
  const title = document.querySelector<HTMLElement>('#editor-file')!;
  const compare = document.querySelector<HTMLInputElement>('#compare')!;
  const comparePosition = document.querySelector<HTMLInputElement>('#compare-position')!;
  const comparePositionWrap = document.querySelector<HTMLElement>('#compare-position-wrap')!;
  const studio = new Canvas(element, { selection: false, preserveObjectStacking: true });
  const adjustments = defaultAdjustments();
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
  let layers: SubjectLayers = { baseUrl: '', width: 0, height: 0, matteUrl: null };
  const removalEngine = new RemovalEngine();
  /** Enhancement results keyed by source layer + target, so repeating a request reuses the earlier output. */
  const enhanceCache = new Map<string, { baseUrl: string; baselineUrl: string; width: number; height: number }>();
  const registerUrl = (url: string) => { generatedUrls.push(url); return url; };
  let crop: CropRect = { width: 0, height: 0, x: 0, y: 0 };
  let cropFrame: Rect | undefined;
  let maskOverlay: FabricImage | undefined;
  let maskVisible = false;
  /** Uncommitted tool result drawn in place of the subject; the committed image stays underneath, hidden. */
  let previewOverlay: FabricImage | undefined;
  const placement = (from: FabricImage) => ({ left: from.left, top: from.top, originX: from.originX, originY: from.originY, scaleX: from.scaleX, scaleY: from.scaleY, angle: from.angle, flipX: from.flipX, flipY: from.flipY, cropX: from.cropX, cropY: from.cropY, width: from.width, height: from.height, selectable: false, evented: false });
  /**
   * Canvas bookkeeping for overlays. fabric's add() never de-duplicates, and bringObjectToFront()
   * silently re-adds an object that was removed from the canvas — so a remove/add dance around a
   * layout pass can leave the same overlay referenced twice, after which remove() only ever clears
   * one reference and the extra one leaks into exports. All overlay membership goes through these.
   */
  const onCanvas = <T extends object>(obj: T | undefined): obj is T => !!obj && (studio.getObjects() as object[]).includes(obj);
  const detachFromCanvas = <T extends object>(obj: T | undefined) => { while (obj && (studio.getObjects() as object[]).includes(obj)) studio.remove(obj as never); };
  const attachToCanvas = <T extends object>(obj: T | undefined) => { if (obj && !(studio.getObjects() as object[]).includes(obj)) studio.add(obj as never); };
  const syncPreviewOverlay = () => {
    if (!previewOverlay || !image) return;
    previewOverlay.set({ ...placement(image), shadow: image.shadow, clipPath: image.clipPath });
    if (previewOverlay.filters !== image.filters) { previewOverlay.filters = image.filters; previewOverlay.applyFilters(); }
    if (!studio.getObjects().includes(previewOverlay)) studio.insertAt(studio.getObjects().indexOf(image) + 1, previewOverlay);
    image.visible = false;
    studio.requestRenderAll();
  };
  const clearPreview = () => {
    if (!previewOverlay) return;
    studio.remove(previewOverlay);
    previewOverlay = undefined;
    if (image) image.visible = true;
    studio.requestRenderAll();
  };
  const syncMaskOverlay = () => {
    if (!maskOverlay) return;
    if (!image || !maskVisible) { detachFromCanvas(maskOverlay); studio.requestRenderAll(); return; }
    if (!studio.getObjects().includes(maskOverlay)) studio.add(maskOverlay);
    maskOverlay.set({ ...placement(image), opacity: 0.5, objectCaching: false });
    maskOverlay.dirty = true;
    studio.bringObjectToFront(maskOverlay);
    studio.requestRenderAll();
  };
  /** Marks workflow steps that have been applied to the current photo. */
  const updateSteps = () => {
    const done: Record<string, boolean> = { background: !!layers.matteUrl, refine: !!layers.refined, cleanup: !!layers.cleaned, enhance: !!layers.enhancedTo, scene: backdrop.kind !== 'none' };
    document.querySelectorAll<HTMLButtonElement>('[data-panel-tab]').forEach((button) => button.classList.toggle('done', !!done[button.dataset.panelTab!]));
  };
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
  const layoutScene = () => { layoutSceneObjects(); syncPreviewOverlay(); syncMaskOverlay(); };
  const layoutSceneObjects = () => {
    sceneObjects.forEach((obj) => studio.remove(obj));
    sceneObjects = [];
    frameBox = undefined;
    if (image) image.shadow = null;
    if (!image) return;
    const P = { width: crop.width, height: crop.height };
    if (backdrop.kind === 'none') {
      const scale = Math.min((studio.width! - 48) / image.width!, (studio.height! - 48) / image.height!);
      image.set({ left: studio.width! / 2, top: studio.height! / 2, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale, clipPath: undefined });
      studio.requestRenderAll();
      return;
    }
    const visibleBox = visibleProductBox({ left: 0, top: 0, width: P.width, height: P.height }, { left: crop.x, top: crop.y, width: crop.width, height: crop.height }, opaqueBounds);
    const L = placeSubject(P, visibleBox, scene, adjustments.rotation, adjustments.flipX, adjustments.flipY);
    const s = Math.min((studio.width! - 48) / L.frame.width, (studio.height! - 48) / L.frame.height);
    const frameLeft = (studio.width! - L.frame.width * s) / 2;
    const frameTop = (studio.height! - L.frame.height * s) / 2;
    frameBox = { left: frameLeft, top: frameTop, width: L.frame.width * s, height: L.frame.height * s, scale: s };
    image.set({
      originX: 'center', originY: 'center', scaleX: s * L.zoom, scaleY: s * L.zoom,
      left: frameLeft + L.center.x * s,
      top: frameTop + L.center.y * s,
      clipPath: new Rect({ left: frameLeft, top: frameTop, width: L.frame.width * s, height: L.frame.height * s, originX: 'left', originY: 'top', absolutePositioned: true }),
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
    const g = groundShadow(scene.shadow, L.subject);
    if (g) {
      const ellipse = new Ellipse({ selectable: false, evented: false, originX: 'center', originY: 'center', left: frameLeft + g.cx * s, top: frameTop + g.cy * s, rx: g.rx * s, ry: g.ry * s, fill: new Gradient({ type: 'radial', gradientUnits: 'percentage', coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 }, colorStops: [{ offset: 0, color: `rgba(0,0,0,${g.opacity})` }, { offset: Math.max(0, 1 - g.softness), color: `rgba(0,0,0,${(g.opacity * 0.8).toFixed(3)})` }, { offset: 1, color: 'rgba(0,0,0,0)' }] }) } as never);
      studio.insertAt(z, ellipse);
      sceneObjects.push(ellipse);
    }
    const d = dropShadow(scene.shadow, { width: L.subject.width / L.zoom, height: L.subject.height / L.zoom });
    if (d) image.shadow = new Shadow({ color: d.color, blur: d.blur, offsetX: d.offsetX, offsetY: d.offsetY });
    if (onCanvas(comparisonImage)) studio.bringObjectToFront(comparisonImage);
    if (onCanvas(cropFrame)) studio.bringObjectToFront(cropFrame);
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
    const sc = document.querySelector<HTMLInputElement>('#scene-scale')!;
    if (sc.value !== String(scene.scale ?? 100)) sc.value = String(scene.scale ?? 100);
    document.querySelector<HTMLOutputElement>('#scene-scale-value')!.textContent = `${scene.scale ?? 100}%`;
    const rot = document.querySelector<HTMLInputElement>('#scene-rotation')!;
    if (rot.value !== String(adjustments.rotation)) rot.value = String(adjustments.rotation);
    document.querySelector<HTMLOutputElement>('#scene-rotation-value')!.textContent = `${adjustments.rotation}°`;
    updateSteps();
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
    document.querySelector<HTMLElement>('#bgr-status')!.textContent = ready ? 'Ready. Models download once on first use and are cached on this device.' : 'AI background removal is off until you opt in.';
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
    detachFromCanvas(comparisonImage);
    sceneObjects.forEach((obj) => studio.remove(obj));
    detachFromCanvas(maskOverlay);
    if (previewOverlay) { detachFromCanvas(previewOverlay); if (image) image.visible = true; }
    history.push({ canvas: studio.toJSON(), adjustments: { ...adjustments }, crop: { ...crop }, original: { ...original }, comparisonUrl, scene: structuredClone(scene), backdrop: structuredClone(backdrop), layers: { ...layers } });
    layoutScene();
    attachToCanvas(comparisonImage);
    if (onCanvas(comparisonImage)) studio.bringObjectToFront(comparisonImage);
    // Scene, backdrop and crop handlers run remember() without applyAdjustments(); keep the
    // before/after overlay aligned with the relaid-out image instead of leaving it where it was.
    void updateComparison();
    updateHistory();
    updateSteps();
  };
  const updateComparison = async () => {
    comparePositionWrap.hidden = !compare.checked;
    if (!image || !compare.checked) {
      detachFromCanvas(comparisonImage);
      comparisonImage = undefined;
      studio.requestRenderAll();
      return;
    }
    if (!comparisonImage) {
      const currentUrl = comparisonUrl;
      const overlay = await FabricImage.fromURL(currentUrl);
      if (!compare.checked || currentUrl !== comparisonUrl || !image) return;
      // Overlapping refreshes may both load; only the first becomes the overlay.
      if (!comparisonImage) {
        comparisonImage = overlay;
        attachToCanvas(comparisonImage);
      }
    }
    attachToCanvas(comparisonImage);
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
    if (onCanvas(cropFrame)) studio.bringObjectToFront(cropFrame);
    studio.requestRenderAll();
  };
  const applyAdjustments = () => {
    if (!image) return;
    image.set({ angle: adjustments.rotation, flipX: adjustments.flipX, flipY: adjustments.flipY });
    image.filters = adjustmentFilters(adjustments) as never;
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
    const base = defaultAdjustments();
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
    previewOverlay = undefined;
    aiTools.reset();
    await studio.loadFromJSON(snapshot.canvas as never);
    image = studio.getObjects().find(object => object.type === 'image') as FabricImage | undefined;
    scene = structuredClone(snapshot.scene);
    backdrop = structuredClone(snapshot.backdrop);
    sceneObjects = [];
    crop = { ...snapshot.crop };
    original = { ...snapshot.original };
    comparisonUrl = snapshot.comparisonUrl;
    layers = { ...snapshot.layers };
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
    previewOverlay = undefined;
    comparisonImage = undefined;
    aiTools.reset();
    studio.clear();
    image = await FabricImage.fromURL(objectUrl);
    original = { width: image.width!, height: image.height! };
    pristine = { ...original };
    layers = { baseUrl: objectUrl, width: original.width, height: original.height, matteUrl: null };
    enhanceCache.clear();
    measureOpaqueBounds();
    crop = { x: 0, y: 0, width: original.width, height: original.height };
    scene = defaultScene();
    backdrop = { kind: 'none' };
    sceneObjects = [];
    frameBox = undefined;
    image.set({ selectable: false, evented: false, originX: 'center', originY: 'center' });
    studio.add(image);
    layoutScene();
    Object.assign(adjustments, defaultAdjustments());
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
  const modeSelect = document.querySelector<HTMLSelectElement>('#bgr-mode')!;
  modeSelect.value = loadMode();
  const describeRemovalMode = async () => {
    const caps = await removalEngine.capabilities();
    const gpu = caps.webgpu ? `WebGPU ${caps.webgpu.vendor || 'GPU'} · 16-bit shaders ${caps.webgpu.f16 ? 'yes' : 'no'} · ${caps.webgpu.maxBufferSizeMB} MB buffers` : 'No WebGPU (CPU/WASM only)';
    const mem = caps.deviceMemoryGB ? ` · ${caps.deviceMemoryGB} GB+ memory` : '';
    const described = await removalEngine.describe(modeSelect.value as RemovalMode);
    document.querySelector('#bgr-mode-info')!.textContent = `${described.message} Device: ${gpu}${mem}.`;
  };
  modeSelect.addEventListener('change', () => { saveMode(modeSelect.value as RemovalMode); void describeRemovalMode(); });
  void describeRemovalMode();
  document.querySelector('#run-bgr')!.addEventListener('click', async () => {
    if (!image || removing) return;
    removing = true;
    const button = document.querySelector<HTMLButtonElement>('#run-bgr')!;
    const status = document.querySelector<HTMLElement>('#bgr-status')!;
    const progress = document.querySelector<HTMLProgressElement>('#bgr-progress')!;
    button.disabled = true;
    const cleanup = document.querySelector<HTMLSelectElement>('#bgr-cleanup')!.value as EdgeCleanup;
    const refine = document.querySelector<HTMLInputElement>('#bgr-refine')!.checked;
    const previousUrl = image.getSrc();
    const snapshotLayers = { ...layers };
    try {
      const baseImage = await loadImage(snapshotLayers.baseUrl);
      const rgba = (await pixels(snapshotLayers.baseUrl, snapshotLayers.width, snapshotLayers.height)).data;
      const result = await removeAdaptive(baseImage, rgba, snapshotLayers.width, snapshotLayers.height, removalEngine, {
        mode: modeSelect.value as RemovalMode, cleanup, refine,
        onStatus: s => {
          status.textContent = s.label;
          progress.hidden = s.stage !== 'download';
          if (s.total) progress.value = (s.loaded ?? 0) / s.total;
        },
      });
      const matteUrl = await matteToUrl(result.matte, snapshotLayers.width, snapshotLayers.height, registerUrl);
      const variant = result.segment.variant;
      await applyLayers({ ...snapshotLayers, matteUrl, removal: { variantId: variant.id, label: variant.label, mode: modeSelect.value as RemovalMode } }, previousUrl);
      const t = result.segment.timings;
      const fellBack = result.segment.fallbacks.filter(f => !/not installed|WebGPU is not available|shader-f16|disabled on mobile|recommended|buffer limit/.test(f.reason));
      status.textContent = `Background removed with ${variant.label} in ${result.totalMs} ms (model ${t.inferMs} ms${t.fromCache ? ', cached' : `, downloaded in ${t.downloadMs} ms`}).${fellBack.length ? ` Fell back after: ${fellBack.map(f => f.reason.split(':')[0]).join(', ')}.` : ''} Undo restores it.${backdrop.kind === 'none' ? ' Pick a backdrop below, or export PNG/WebP to keep transparency.' : ''}`;
      void describeRemovalMode();
    } catch (error) {
      status.textContent = `${(error as Error).message} Your photo and edits are unchanged.`;
    } finally {
      progress.hidden = true;
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
    const alreadyLarge = Math.max(layers.width, layers.height) >= target;
    if ((layers.enhancedTo && layers.enhancedTo >= target) || alreadyLarge) {
      status.textContent = layers.enhancedTo && layers.enhancedTo >= target
        ? `This photo is already enhanced to ${layers.enhancedTo}px, so nothing was reprocessed. Use original pixels (or Undo) to start over.`
        : `This photo is already ${layers.width}×${layers.height}; Enhance only upscales photos smaller than ${target}px, so nothing was changed.`;
      enhancing = false;
      runButton.disabled = false;
      updateClearEnhance();
      return;
    }
    try {
      // Enhance the current photo layer (keeps earlier cleanup); identical requests reuse the cached result.
      const key = `${layers.baseUrl}|${target}`;
      let cached = enhanceCache.get(key);
      let message = 'Reused the earlier enhancement of this photo (no reprocessing).';
      if (!cached) {
        const baseImage = await loadImage(layers.baseUrl);
        const result = await enhanceImage(baseImage, { targetEdge: target, onProgress: (_f, label) => { status.textContent = label; } });
        const baseline = resizeBaseline(baseImage, result.width, result.height);
        cached = { baseUrl: await canvasToUrl(result.canvas, registerUrl), baselineUrl: await canvasToUrl(baseline, registerUrl), width: result.width, height: result.height };
        enhanceCache.set(key, cached);
        message = `Enhanced to ${result.width}×${result.height} with ${result.provider.toUpperCase()} in ${result.elapsedMs} ms (≈${(result.peakBytesEstimate / 1_048_576).toFixed(1)} MB working set).`;
      }
      // An existing cutout follows the photo: its matte is resampled to the new size instead of re-running removal.
      const matteUrl = layers.matteUrl ? await matteToUrl(await matteFromUrl(layers.matteUrl, cached.width, cached.height), cached.width, cached.height, registerUrl) : null;
      const comparison = matteUrl ? await compositeUrl({ ...layers, baseUrl: cached.baselineUrl, width: cached.width, height: cached.height, matteUrl }, registerUrl) : cached.baselineUrl;
      await applyLayers({ ...layers, baseUrl: cached.baseUrl, width: cached.width, height: cached.height, matteUrl, enhancedTo: target }, comparison);
      status.textContent = `${message} Before / after compares a standard resize with the AI result. Undo restores the previous step; the original file is untouched.`;
      updateClearEnhance();
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError' ? 'Enhancement cancelled.' : (error as Error).message;
      status.textContent = `${message} Your photo is unchanged. If the model could not be downloaded, check your connection and try again.`;
    } finally {
      enhancing = false;
      runButton.disabled = false;
      clearButton.disabled = false;
      updateClearEnhance();
    }
  });
  document.querySelector('#clear-enhance')!.addEventListener('click', async () => {
    if (!image) return;
    // Original photo pixels; an existing cutout is kept (resampled), object cleanups are dropped.
    const matteUrl = layers.matteUrl ? await matteToUrl(await matteFromUrl(layers.matteUrl, pristine.width, pristine.height), pristine.width, pristine.height, registerUrl) : null;
    await applyLayers({ baseUrl: objectUrl, width: pristine.width, height: pristine.height, matteUrl, removal: layers.removal, refined: layers.refined }, image.getSrc());
    setEnhanceStatus('Restored the original photo pixels (cutout kept; undo brings back the previous edits).');
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
  document.querySelector('#scene-scale')!.addEventListener('input', (event) => { scene = clampScene({ ...scene, scale: Number((event.target as HTMLInputElement).value) }); document.querySelector<HTMLOutputElement>('#scene-scale-value')!.textContent = `${scene.scale}%`; layoutScene(); });
  document.querySelector('#scene-scale')!.addEventListener('change', () => remember());
  document.querySelector('#scene-rotation')!.addEventListener('input', (event) => { adjustments.rotation = Number((event.target as HTMLInputElement).value); sync(); queuePreview(); });
  document.querySelector('#scene-rotation')!.addEventListener('change', commit);
  document.querySelectorAll<HTMLButtonElement>('[data-scene-preset]').forEach((button) => button.addEventListener('click', () => {
    const preset = SCENE_PRESETS[button.dataset.scenePreset as ScenePreset];
    scene = clampScene(structuredClone(preset.scene));
    backdrop = preset.backdrop.kind === 'color' ? { kind: 'color', color: preset.backdrop.color } : { kind: 'gradient', stops: gradientStops(preset.backdrop.preset), angle: 90 };
    layoutScene();
    remember();
    syncSceneControls();
    setBackgroundStatus(`${preset.label} applied.${layers.matteUrl ? '' : ' Remove the background first for a clean product shot.'}`);
  }));
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

  const applyLayers = async (next: SubjectLayers, nextComparisonUrl: string) => {
    if (previewOverlay) { clearPreview(); aiTools.reset(); }
    const url = await compositeUrl(next, registerUrl);
    layers = next;
    await swapImage(url, nextComparisonUrl);
  };
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
    if (comparisonImage) detachFromCanvas(comparisonImage);
    comparisonImage = undefined;
    comparisonUrl = nextComparisonUrl;
    layoutScene();
    commit();
  };
  const aiTools = mountAiTools({
    studio,
    layers: () => layers,
    displayUrl: () => image?.getSrc(),
    commit: (next, comparison) => applyLayers(next, comparison),
    preview: (pixels) => {
      if (!image) return;
      if (previewOverlay) previewOverlay.setElement(pixels);
      else previewOverlay = new FabricImage(pixels);
      previewOverlay.filters = [];
      syncPreviewOverlay();
    },
    cancelPreview: clearPreview,
    registerUrl,
    toImagePixel: (e) => {
      if (!image) return null;
      const local = util.transformPoint(studio.getScenePoint(e), util.invertTransform(image.calcTransformMatrix()));
      const x = local.x + image.width / 2 + (image.cropX ?? 0);
      const y = local.y + image.height / 2 + (image.cropY ?? 0);
      if (x < crop.x || y < crop.y || x >= crop.x + crop.width || y >= crop.y + crop.height) return null;
      return { x: x * layers.width / original.width, y: y * layers.height / original.height };
    },
    setMaskOverlay: (canvas, visible) => {
      if (maskOverlay && maskOverlay.getElement() !== canvas) { detachFromCanvas(maskOverlay); maskOverlay = undefined; }
      if (canvas && !maskOverlay) maskOverlay = new FabricImage(canvas);
      maskVisible = visible;
      syncMaskOverlay();
    },
    refreshOverlay: () => syncMaskOverlay(),
    blocked: () => !!cropFrame || removing || enhancing,
  });
  if (import.meta.env.DEV) Object.assign(window, { __studio: { layers: () => ({ ...layers }), src: () => image?.getSrc(), scene: () => structuredClone(scene), objects: () => studio.getObjects().map(o => ({ type: o.type, isImage: o === image, visible: o.visible, opacity: o.opacity, left: Math.round(o.left ?? 0), top: Math.round(o.top ?? 0), scaleX: o.scaleX, width: o.width, height: o.height, clip: !!o.clipPath, cacheKey: (o as FabricImage).cacheKey })), refilter: (withFilters = true) => { if (!image) return; if (!withFilters) image.filters = []; image.applyFilters(); studio.requestRenderAll(); } } });

  const api = {
    load(file: File) { void load(file); },
    /** True while a Magic Click or cleanup preview awaits Accept/Reject. */
    pendingPreview: () => previewOverlay !== undefined,
    hasPhoto: () => !!image,
    /** One shared engine: the batch runner reuses the Studio's warm model sessions instead of doubling GPU memory. */
    removalEngine: () => removalEngine,
    refreshGates: () => { syncBgrGate(); syncEnhanceGate(); },
    /** Snapshot of the open photo's frame, backdrop, shadow, light settings and cutout choice, for batch presets. */
    captureLook(): StudioLook | undefined {
      if (!image) return undefined;
      return {
        scene: structuredClone(scene),
        backdrop: structuredClone(backdrop),
        adjustments: { ...adjustments },
        cutout: {
          mode: modeSelect.value as RemovalMode,
          cleanup: document.querySelector<HTMLSelectElement>('#bgr-cleanup')!.value as EdgeCleanup,
          refine: document.querySelector<HTMLInputElement>('#bgr-refine')!.checked,
        },
        backdropImage: backdrop.kind === 'image' ? backdropImages.get(backdrop.url) : undefined,
      };
    },
    async exportFile() {
      if (!image) return undefined;
      // Hide the compare/mask overlays instead of detaching them: a duplicated overlay reference
      // (see onCanvas/detachFromCanvas) would otherwise leak the "before" photo into the export.
      const overlays = [comparisonImage, maskOverlay].filter((obj): obj is FabricImage => !!obj);
      const wasVisible = overlays.map((obj) => obj.visible);
      overlays.forEach((obj) => { obj.visible = false; });
      let dataUrl: string;
      if (frameBox) {
        dataUrl = studio.toDataURL({ format: 'png', left: frameBox.left, top: frameBox.top, width: frameBox.width, height: frameBox.height, multiplier: 1 / frameBox.scale });
      } else {
        const width = image.getScaledWidth();
        const height = image.getScaledHeight();
        dataUrl = studio.toDataURL({ format: 'png', left: image.left! - width / 2, top: image.top! - height / 2, width, height, multiplier: crop.width / width });
      }
      overlays.forEach((obj, i) => { obj.visible = wasVisible[i] ?? true; });
      studio.requestRenderAll();
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], `${title.textContent || 'image'}-edited.png`, { type: 'image/png' });
    },
    dispose() { if (objectUrl) URL.revokeObjectURL(objectUrl); for (const url of generatedUrls) URL.revokeObjectURL(url); generatedUrls.length = 0; aiTools.release(); removalEngine.release(); studio.dispose(); }
  };
  if (import.meta.env.DEV) Object.assign((window as unknown as { __studio: object }).__studio, { exportFile: api.exportFile, frame: () => frameBox && { ...frameBox } });
  return api;
}
