import { Canvas, FabricImage, filters, Point, Rect } from 'fabric';
import { centerCrop, normalizedAdjustment, sharpenMatrix, SnapshotHistory, temperatureMatrix, type CropRect } from './tools';

type Adjustments = {
  exposure: number; brightness: number; contrast: number; saturation: number;
  temperature: number; sharpness: number; rotation: number; flipX: boolean; flipY: boolean;
  preset: 'none' | 'grayscale' | 'sepia';
};
type Snapshot = { canvas: unknown; adjustments: Adjustments; crop: CropRect };
const defaults = (): Adjustments => ({ exposure: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0, rotation: 0, flipX: false, flipY: false, preset: 'none' });

export function initEditor() {
  const element = document.querySelector<HTMLCanvasElement>('#editor-canvas')!;
  const stage = document.querySelector<HTMLElement>('#editor-stage')!;
  const empty = document.querySelector<HTMLElement>('#editor-empty')!;
  const title = document.querySelector<HTMLElement>('#editor-file')!;
  const compare = document.querySelector<HTMLInputElement>('#compare')!;
  const studio = new Canvas(element, { selection: false, preserveObjectStacking: true });
  const adjustments = defaults();
  let image: FabricImage | undefined;
  let originalFile: File | undefined;
  let objectUrl = '';
  let original = { width: 0, height: 0 };
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
  };
  const resize = () => {
    studio.setDimensions({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) });
    if (image) centerImage();
    studio.requestRenderAll();
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
  const remember = () => {
    if (restoring || cropFrame) return;
    history.push({ canvas: studio.toJSON(), adjustments: { ...adjustments }, crop: { ...crop } });
    updateHistory();
  };
  const applyAdjustments = () => {
    if (!image) return;
    if (compare.checked) {
      image.set({ angle: 0, flipX: false, flipY: false });
      image.filters = [];
    } else {
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
    }
    image.applyFilters();
    studio.requestRenderAll();
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
    await studio.loadFromJSON(snapshot.canvas as never);
    image = studio.getObjects()[0] as FabricImage | undefined;
    Object.assign(adjustments, snapshot.adjustments);
    crop = { ...snapshot.crop };
    restoring = false;
    sync();
    applyAdjustments();
    updateHistory();
  };
  const load = async (file: File) => {
    originalFile = file;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    studio.clear();
    image = await FabricImage.fromURL(objectUrl);
    original = { width: image.width!, height: image.height! };
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
  compare.addEventListener('change', applyAdjustments);
  document.querySelector('#undo')!.addEventListener('click', () => void restore(history.undo()));
  document.querySelector('#redo')!.addEventListener('click', () => void restore(history.redo()));
  document.querySelector('#reset-editor')!.addEventListener('click', () => { if (originalFile) void load(originalFile); });
  document.querySelector('#reset-light')!.addEventListener('click', () => resetGroup(['exposure', 'brightness', 'contrast']));
  document.querySelector('#reset-color')!.addEventListener('click', () => resetGroup(['saturation', 'temperature', 'sharpness', 'preset']));
  document.querySelector('#reset-transform')!.addEventListener('click', () => resetGroup(['rotation', 'flipX', 'flipY']));
  document.querySelector('#rotate-left')!.addEventListener('click', () => { adjustments.rotation = Math.max(-180, adjustments.rotation - 90); sync(); commit(); });
  document.querySelector('#rotate-right')!.addEventListener('click', () => { adjustments.rotation = Math.min(180, adjustments.rotation + 90); sync(); commit(); });
  document.querySelector('#fit')!.addEventListener('click', () => { if (image) { centerImage(); studio.setZoom(1); studio.requestRenderAll(); } });
  document.querySelector('#actual')!.addEventListener('click', () => { if (image) { image.set({ scaleX: 1, scaleY: 1 }); studio.requestRenderAll(); } });
  document.querySelector('#start-crop')!.addEventListener('click', () => startCrop());
  document.querySelectorAll<HTMLButtonElement>('[data-crop]').forEach((button) => button.addEventListener('click', () => startCrop(Number(button.dataset.crop))));
  document.querySelector('#apply-crop')!.addEventListener('click', applyCrop);
  document.querySelector('#cancel-crop')!.addEventListener('click', clearCropFrame);
  document.querySelector('#reset-crop')!.addEventListener('click', resetCrop);
  studio.on('mouse:wheel', (event) => { const wheel = event.e as WheelEvent; wheel.preventDefault(); const next = Math.min(4, Math.max(.2, studio.getZoom() * (wheel.deltaY < 0 ? 1.1 : .9))); studio.zoomToPoint(new Point(wheel.offsetX, wheel.offsetY), next); document.querySelector('#zoom-value')!.textContent = `${Math.round(next * 100)}%`; });
  document.addEventListener('keydown', (event) => { if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return; if (event.key.toLowerCase() === 'z') { event.preventDefault(); void restore(event.shiftKey ? history.redo() : history.undo()); } if (event.key.toLowerCase() === 'y') { event.preventDefault(); void restore(history.redo()); } });

  return {
    load(file: File) { void load(file); },
    async exportFile() {
      if (!image) return undefined;
      const wasComparing = compare.checked;
      compare.checked = false;
      applyAdjustments();
      const width = image.getScaledWidth();
      const height = image.getScaledHeight();
      const dataUrl = studio.toDataURL({ format: 'png', left: image.left! - width / 2, top: image.top! - height / 2, width, height, multiplier: crop.width / width });
      compare.checked = wasComparing;
      applyAdjustments();
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], `${title.textContent || 'image'}-edited.png`, { type: 'image/png' });
    },
    dispose() { if (objectUrl) URL.revokeObjectURL(objectUrl); studio.dispose(); }
  };
}
