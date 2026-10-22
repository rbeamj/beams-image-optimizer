import { Canvas, FabricImage, filters, Point, Rect } from 'fabric';
import { centerCrop, comparisonClip, normalizedAdjustment, sharpenMatrix, SnapshotHistory, temperatureMatrix, type CropRect } from './tools';
import { acknowledgeEnhanceLicense, enhanceImage, ENHANCE_LICENSE_SUMMARY, hasAcknowledgedEnhanceLicense, resizeBaseline, type EnhanceTargetEdge } from '../enhance';

type Adjustments = {
  exposure: number; brightness: number; contrast: number; saturation: number;
  temperature: number; sharpness: number; rotation: number; flipX: boolean; flipY: boolean;
  preset: 'none' | 'grayscale' | 'sepia';
};
type Snapshot = { canvas: unknown; adjustments: Adjustments; crop: CropRect; original: { width: number; height: number }; comparisonUrl: string };
const defaults = (): Adjustments => ({ exposure: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0, rotation: 0, flipX: false, flipY: false, preset: 'none' });

export function initEditor() {
  const panelTabs = document.querySelector<HTMLElement>('.editor-panel .panel-tabs')!;
  panelTabs.insertAdjacentHTML('beforeend', '<button data-panel-tab="background" type="button">Background</button><button data-panel-tab="enhance" type="button">Enhance</button>');
  document.querySelector<HTMLElement>('[data-editor-panel="export"]')!.insertAdjacentHTML('beforebegin', '<div data-editor-panel="background" hidden><fieldset><legend>Product background</legend><p class="hint">Use a solid background with images that already have transparent pixels. Your original remains unchanged.</p><label>Color <input id="background-color" type="color" value="#ffffff" /></label><div class="tool-buttons"><button id="apply-background" type="button">Apply color</button><button id="clear-background" type="button">Transparent</button></div><p class="hint">Automatic background removal is not included until a browser-local model passes license and performance review.</p></fieldset></div><div data-editor-panel="enhance" hidden><fieldset><legend>AI Enhance</legend><p class="hint" id="enhance-license-text"></p><div id="enhance-ack"><button id="ack-enhance" type="button">Enable optional AI Enhance</button></div><div id="enhance-controls" hidden><div class="edge-grid" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="enhance-edge" value="1024" checked />1024px</label><label><input type="radio" name="enhance-edge" value="2048" />2048px</label></div><div class="tool-buttons"><button id="run-enhance" type="button">Run local enhance</button><button id="clear-enhance" type="button" disabled>Use original pixels</button></div></div><p class="hint">Never runs automatically. Compare shows a standard resize versus the AI result.</p><p id="enhance-status" class="hint" role="status">AI Enhance is off until you opt in.</p></fieldset></div>');
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
  let background: Rect | undefined;
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
  const centerImage = () => {
    if (!image) return;
    const scale = Math.min((studio.width! - 48) / image.width!, (studio.height! - 48) / image.height!);
    image.set({ left: studio.width! / 2, top: studio.height! / 2, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale });
    syncBackground();
  };
  const resize = () => {
    studio.setDimensions({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) });
    if (image) centerImage();
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
  };
  const updateHistory = () => {
    document.querySelector<HTMLButtonElement>('#undo')!.disabled = !history.canUndo();
    document.querySelector<HTMLButtonElement>('#redo')!.disabled = !history.canRedo();
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
  const syncBackground = () => {
    if (!background || !image) return;
    background.set({ left: image.left, top: image.top, originX: 'center', originY: 'center', width: image.width, height: image.height, scaleX: image.scaleX, scaleY: image.scaleY, angle: image.angle });
    studio.sendObjectToBack(background);
  };
  const applyBackground = (fill: string) => {
    if (!image) return;
    if (!background) {
      background = new Rect({ selectable: false, evented: false, originX: 'center', originY: 'center', fill });
      studio.add(background);
    }
    background.set({ fill, visible: true });
    syncBackground();
    studio.requestRenderAll();
    remember();
  };
  const clearBackground = () => {
    if (!background) return;
    background.set({ visible: false });
    studio.requestRenderAll();
    remember();
  };
  const remember = () => {
    if (restoring || cropFrame) return;
    if (comparisonImage) studio.remove(comparisonImage);
    history.push({ canvas: studio.toJSON(), adjustments: { ...adjustments }, crop: { ...crop }, original: { ...original }, comparisonUrl });
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
    syncBackground();
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
    centerImage();
    commit();
  };
  const resetCrop = () => {
    if (!image) return;
    clearCropFrame();
    crop = { x: 0, y: 0, width: original.width, height: original.height };
    image.set({ cropX: 0, cropY: 0, width: original.width, height: original.height });
    centerImage();
    commit();
  };
  const restore = async (snapshot?: Snapshot) => {
    if (!snapshot) return;
    restoring = true;
    comparisonImage = undefined;
    await studio.loadFromJSON(snapshot.canvas as never);
    image = studio.getObjects().find(object => object.type === 'image') as FabricImage | undefined;
    background = studio.getObjects().find(object => object.type === 'rect') as Rect | undefined;
    Object.assign(adjustments, snapshot.adjustments);
    crop = { ...snapshot.crop };
    original = { ...snapshot.original };
    comparisonUrl = snapshot.comparisonUrl;
    restoring = false;
    sync();
    applyAdjustments();
    updateHistory();
    updateClearEnhance();
  };
  const load = async (file: File) => {
    for (const url of generatedUrls) URL.revokeObjectURL(url);
    generatedUrls.length = 0;
    originalFile = file;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    comparisonUrl = objectUrl;
    studio.clear();
    background = undefined;
    image = await FabricImage.fromURL(objectUrl);
    original = { width: image.width!, height: image.height! };
    pristine = { ...original };
    crop = { x: 0, y: 0, width: original.width, height: original.height };
    image.set({ selectable: false, evented: false, originX: 'center', originY: 'center' });
    studio.add(image);
    centerImage();
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
  document.querySelector('#apply-background')!.addEventListener('click', () => applyBackground(document.querySelector<HTMLInputElement>('#background-color')!.value));
  document.querySelector('#clear-background')!.addEventListener('click', clearBackground);
  syncEnhanceGate();
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
  document.querySelector('#fit')!.addEventListener('click', () => { if (image) { centerImage(); studio.setZoom(1); studio.requestRenderAll(); void updateComparison(); } });
  document.querySelector('#actual')!.addEventListener('click', () => { if (image) { image.set({ scaleX: 1, scaleY: 1 }); studio.requestRenderAll(); void updateComparison(); } });
  document.querySelector('#start-crop')!.addEventListener('click', () => startCrop());
  document.querySelectorAll<HTMLButtonElement>('[data-crop]').forEach((button) => button.addEventListener('click', () => startCrop(Number(button.dataset.crop))));
  document.querySelector('#apply-crop')!.addEventListener('click', applyCrop);
  document.querySelector('#cancel-crop')!.addEventListener('click', clearCropFrame);
  document.querySelector('#reset-crop')!.addEventListener('click', resetCrop);
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
    if (comparisonImage) studio.remove(comparisonImage);
    comparisonImage = undefined;
    comparisonUrl = nextComparisonUrl;
    centerImage();
    commit();
  };

  return {
    load(file: File) { void load(file); },
    async exportFile() {
      if (!image) return undefined;
      const overlay = comparisonImage;
      if (overlay) studio.remove(overlay);
      const width = image.getScaledWidth();
      const height = image.getScaledHeight();
      const dataUrl = studio.toDataURL({ format: 'png', left: image.left! - width / 2, top: image.top! - height / 2, width, height, multiplier: crop.width / width });
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
