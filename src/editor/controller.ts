import { Canvas, Circle, FabricImage, filters, IText, Point, Rect, type FabricObject } from 'fabric';
import { centerCrop, clampOpacity, normalizedAdjustment } from './tools';

type StudioObject = FabricObject & { name?: string; isBackground?: boolean };
type Adjustments = { exposure: number; contrast: number; saturation: number; hue: number; rotation: number; flipX: boolean; flipY: boolean };
const defaults = (): Adjustments => ({ exposure: 0, contrast: 0, saturation: 0, hue: 0, rotation: 0, flipX: false, flipY: false });

export function initEditor() {
  const element = document.querySelector<HTMLCanvasElement>('#editor-canvas')!;
  const stage = document.querySelector<HTMLElement>('#editor-stage')!;
  const empty = document.querySelector<HTMLElement>('#editor-empty')!;
  const title = document.querySelector<HTMLElement>('#editor-file')!;
  const comparison = document.querySelector<HTMLInputElement>('#compare')!;
  const studio = new Canvas(element, { preserveObjectStacking: true, selection: true });
  const adjustments = defaults();
  let image: FabricImage | undefined;
  let originalFile: File | undefined;
  let source = { width: 0, height: 0 };
  let objectUrl = '';
  let snapshots: string[] = [];
  let cursor = -1;
  let restoring = false;

  const controlIds: Record<keyof Pick<Adjustments, 'exposure' | 'contrast' | 'saturation' | 'hue' | 'rotation'>, string> = {
    exposure: 'edit-exposure', contrast: 'edit-contrast', saturation: 'edit-saturation', hue: 'edit-hue', rotation: 'edit-rotation'
  };
  const setOutput = (id: string, value: number, suffix = '') => {
    const output = document.querySelector<HTMLOutputElement>(`#${id}-value`);
    if (output) output.textContent = `${value > 0 ? '+' : ''}${Math.round(value)}${suffix}`;
  };
  const resize = () => {
    studio.setDimensions({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) });
    if (image && !image.left && !image.top) centerImage();
    studio.requestRenderAll();
  };
  const background = () => studio.getObjects().find((item) => (item as StudioObject).isBackground) as FabricImage | undefined;
  const centerImage = () => {
    if (!image) return;
    const scale = Math.min((studio.width! - 48) / image.width!, (studio.height! - 48) / image.height!);
    image.set({ left: studio.width! / 2, top: studio.height! / 2, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale });
  };
  const current = () => studio.getActiveObject() as StudioObject | undefined;
  const updateLayers = () => {
    const list = document.querySelector<HTMLElement>('#layer-list')!;
    list.innerHTML = studio.getObjects().slice().reverse().map((item, reverseIndex) => {
      const object = item as StudioObject;
      const index = studio.getObjects().length - 1 - reverseIndex;
      return `<button type="button" data-layer="${index}" class="${studio.getActiveObject() === item ? 'active' : ''}">${object.name || (object.isBackground ? 'Photo' : 'Layer')}</button>`;
    }).join('') || '<span class="hint">No layers yet.</span>';
    const opacity = document.querySelector<HTMLInputElement>('#object-opacity')!;
    const opacityOutput = document.querySelector<HTMLOutputElement>('#object-opacity-value')!;
    const selected = current();
    opacity.disabled = !selected || !!selected.isBackground;
    opacity.value = String(Math.round((selected?.opacity ?? 1) * 100));
    opacityOutput.textContent = `${opacity.value}%`;
  };
  const updateHistoryButtons = () => {
    document.querySelector<HTMLButtonElement>('#undo')!.disabled = cursor <= 0;
    document.querySelector<HTMLButtonElement>('#redo')!.disabled = cursor >= snapshots.length - 1;
  };
  const remember = () => {
    if (restoring) return;
    snapshots = snapshots.slice(0, cursor + 1);
    snapshots.push(JSON.stringify(studio.toJSON()));
    cursor = snapshots.length - 1;
    updateHistoryButtons();
    updateLayers();
  };
  const restore = async (at: number) => {
    if (at < 0 || at >= snapshots.length) return;
    restoring = true;
    await studio.loadFromJSON(JSON.parse(snapshots[at]));
    image = background();
    cursor = at;
    restoring = false;
    studio.requestRenderAll();
    updateHistoryButtons();
    updateLayers();
  };
  const applyAdjustments = () => {
    if (!image) return;
    image.set({ angle: adjustments.rotation, flipX: adjustments.flipX, flipY: adjustments.flipY });
    image.filters = comparison.checked ? [] : [
      new filters.Brightness({ brightness: normalizedAdjustment(adjustments.exposure) }),
      new filters.Contrast({ contrast: normalizedAdjustment(adjustments.contrast) }),
      new filters.Saturation({ saturation: normalizedAdjustment(adjustments.saturation) }),
      new filters.HueRotation({ rotation: normalizedAdjustment(adjustments.hue) })
    ];
    image.applyFilters();
    studio.requestRenderAll();
  };
  const commitAdjustments = () => { applyAdjustments(); remember(); };
  const addObject = (object: StudioObject) => {
    studio.add(object);
    studio.setActiveObject(object);
    studio.requestRenderAll();
    remember();
  };
  const setCrop = (ratio?: number) => {
    if (!image || !source.width || !source.height) return;
    if (!ratio) {
      image.set({ cropX: 0, cropY: 0, width: source.width, height: source.height });
    } else {
      const crop = centerCrop(source.width, source.height, ratio);
      image.set({ cropX: crop.x, cropY: crop.y, width: crop.width, height: crop.height });
    }
    centerImage();
    studio.requestRenderAll();
    remember();
  };
  const load = async (file: File) => {
    originalFile = file;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    studio.clear();
    image = await FabricImage.fromURL(objectUrl);
    source = { width: image.width!, height: image.height! };
    image.set({ isBackground: true, name: 'Photo', selectable: false, evented: false, originX: 'center', originY: 'center' } as Partial<StudioObject>);
    centerImage();
    studio.add(image);
    title.textContent = file.name;
    empty.hidden = true;
    element.hidden = false;
    Object.assign(adjustments, defaults());
    Object.entries(controlIds).forEach(([key, id]) => {
      const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = '0';
      setOutput(id, 0);
    });
    document.querySelector<HTMLInputElement>('#flip-x')!.checked = false;
    document.querySelector<HTMLInputElement>('#flip-y')!.checked = false;
    snapshots = [];
    cursor = -1;
    applyAdjustments();
    remember();
  };

  resize();
  new ResizeObserver(resize).observe(stage);
  (Object.entries(controlIds) as [keyof typeof controlIds, string][]).forEach(([key, id]) => {
    const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
    input.addEventListener('input', () => { adjustments[key] = Number(input.value); setOutput(id, adjustments[key]); applyAdjustments(); });
    input.addEventListener('change', commitAdjustments);
  });
  document.querySelector<HTMLInputElement>('#flip-x')!.addEventListener('change', (event) => { adjustments.flipX = (event.target as HTMLInputElement).checked; commitAdjustments(); });
  document.querySelector<HTMLInputElement>('#flip-y')!.addEventListener('change', (event) => { adjustments.flipY = (event.target as HTMLInputElement).checked; commitAdjustments(); });
  comparison.addEventListener('change', applyAdjustments);
  document.querySelector('#undo')!.addEventListener('click', () => void restore(cursor - 1));
  document.querySelector('#redo')!.addEventListener('click', () => void restore(cursor + 1));
  document.querySelector('#reset-editor')!.addEventListener('click', () => { if (!originalFile) return; void load(originalFile); });
  document.querySelector('#fit')!.addEventListener('click', () => { if (!image) return; centerImage(); studio.requestRenderAll(); });
  document.querySelector('#actual')!.addEventListener('click', () => { if (!image) return; image.set({ scaleX: 1, scaleY: 1 }); studio.requestRenderAll(); });
  document.querySelector('#add-text')!.addEventListener('click', () => addObject(new IText('Double-click to edit', { left: studio.width! / 2, top: studio.height! / 2, originX: 'center', originY: 'center', fill: '#ffffff', fontSize: 34, name: 'Text' } as never) as StudioObject));
  document.querySelector('#add-rectangle')!.addEventListener('click', () => addObject(new Rect({ left: studio.width! / 2, top: studio.height! / 2, originX: 'center', originY: 'center', width: 180, height: 120, fill: '#f0a53e99', stroke: '#ffffff', strokeWidth: 2, name: 'Rectangle' } as never) as StudioObject));
  document.querySelector('#add-circle')!.addEventListener('click', () => addObject(new Circle({ left: studio.width! / 2, top: studio.height! / 2, originX: 'center', originY: 'center', radius: 70, fill: '#3c8f89aa', stroke: '#ffffff', strokeWidth: 2, name: 'Circle' } as never) as StudioObject));
  document.querySelector<HTMLInputElement>('#object-opacity')!.addEventListener('input', (event) => { const selected = current(); if (!selected || selected.isBackground) return; selected.set({ opacity: clampOpacity(Number((event.target as HTMLInputElement).value)) }); studio.requestRenderAll(); updateLayers(); });
  document.querySelector<HTMLInputElement>('#object-opacity')!.addEventListener('change', remember);
  document.querySelector('#bring-forward')!.addEventListener('click', () => { const selected = current(); if (!selected || selected.isBackground) return; studio.bringObjectForward(selected); remember(); });
  document.querySelector('#send-backward')!.addEventListener('click', () => { const selected = current(); if (!selected || selected.isBackground) return; studio.sendObjectBackwards(selected); remember(); });
  document.querySelector('#delete-layer')!.addEventListener('click', () => { const selected = current(); if (!selected || selected.isBackground) return; studio.remove(selected); remember(); });
  document.querySelectorAll<HTMLButtonElement>('[data-crop]').forEach((button) => button.addEventListener('click', () => setCrop(Number(button.dataset.crop))));
  document.querySelector('#reset-crop')!.addEventListener('click', () => setCrop());
  document.querySelector('#layer-list')!.addEventListener('click', (event) => { const index = Number((event.target as HTMLElement).dataset.layer); const item = studio.getObjects()[index]; if (item) { studio.setActiveObject(item); studio.requestRenderAll(); updateLayers(); } });
  studio.on('object:modified', remember);
  studio.on('selection:created', updateLayers);
  studio.on('selection:updated', updateLayers);
  studio.on('selection:cleared', updateLayers);
  studio.on('mouse:wheel', (event) => { const wheel = event.e as WheelEvent; wheel.preventDefault(); const point = new Point(wheel.offsetX, wheel.offsetY); const next = Math.min(4, Math.max(.2, studio.getZoom() * (wheel.deltaY < 0 ? 1.1 : .9))); studio.zoomToPoint(point, next); document.querySelector('#zoom-value')!.textContent = `${Math.round(next * 100)}%`; });
  document.addEventListener('keydown', (event) => { if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement) return; if (event.key.toLowerCase() === 'z') { event.preventDefault(); void restore(event.shiftKey ? cursor + 1 : cursor - 1); } if (event.key.toLowerCase() === 'y') { event.preventDefault(); void restore(cursor + 1); } });

  return {
    load(file: File) { void load(file); },
    async exportFile() {
      if (!image) return undefined;
      const width = image.getScaledWidth();
      const height = image.getScaledHeight();
      const dataUrl = studio.toDataURL({ format: 'png', left: image.left! - width / 2, top: image.top! - height / 2, width, height, multiplier: source.width / width });
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], `${title.textContent || 'image'}-edited.png`, { type: 'image/png' });
    }
  };
}
