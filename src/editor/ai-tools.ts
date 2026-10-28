/**
 * Magic Click (MobileSAM cutout refinement) and Object Cleanup (MI-GAN) panels. Both preview their result on the
 * canvas, and only Accept writes a new layer into history; Reject restores the previous view exactly.
 */
import type { Canvas, TPointerEvent } from 'fabric';
import { SamEngine, type SamCandidates } from '../ai/sam-engine';
import { InpaintEngine } from '../ai/inpaint-engine';
import { combineMatte, type ClickPoint, type RefineAction } from './refine-tools';
import { applyMatteAlpha, canvasToUrl, context, loadImage, matteFromUrl, matteToUrl, pixels, rgbaCanvas, type SubjectLayers } from './subject';

export type ToolHost = {
  studio: Canvas;
  layers(): SubjectLayers;
  displayUrl(): string | undefined;
  commit(next: SubjectLayers, comparisonUrl: string): Promise<void>;
  /** Shows an uncommitted result in place of the subject (never recorded in history or exported). */
  preview(pixels: HTMLCanvasElement): void;
  cancelPreview(): void;
  registerUrl(url: string): string;
  toImagePixel(e: TPointerEvent): { x: number; y: number } | null;
  setMaskOverlay(canvas: HTMLCanvasElement | null, visible: boolean): void;
  refreshOverlay(): void;
  blocked(): boolean;
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const percent = (loaded?: number, total?: number) => total ? ` ${Math.round(100 * (loaded ?? 0) / total)}%` : '';

export const REFINE_PANEL = '<div data-editor-panel="refine" hidden><fieldset><legend>Magic Click (refine cutout)</legend><p class="hint">Click the photo to bring an area back or remove it. MobileSAM runs on this device and downloads (~45 MB) the first time you click.</p><div class="edge-grid" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="refine-action" value="keep" checked /> Bring back</label><label><input type="radio" name="refine-action" value="erase" /> Remove</label></div><p class="hint">Add more clicks to grow the selection; Shift+click excludes a spot. Areas you do not select stay exactly as they are.</p><div class="tool-buttons"><button id="refine-alt" type="button" disabled>Try another shape</button><button id="refine-accept" type="button" disabled>Accept</button><button id="refine-reject" type="button" disabled>Reject</button></div><progress id="refine-progress" max="1" hidden></progress><p class="hint" id="refine-status" role="status">Click the photo to start. Without a cutout, Bring back cuts out what you click.</p></fieldset></div>';

export const CLEANUP_PANEL = '<div data-editor-panel="cleanup" hidden><fieldset><legend>Remove objects (MI-GAN)</legend><p class="hint">Paint over a blemish, label or object, then press Remove. Only painted pixels change; the original file is never modified. Downloads ~28 MB on first use.</p><div class="edge-grid" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="cleanup-brush" value="paint" checked /> Paint</label><label><input type="radio" name="cleanup-brush" value="erase" /> Erase paint</label></div><label>Brush size <input id="cleanup-size" type="range" min="4" max="160" value="36" /><output id="cleanup-size-value">36</output></label><div class="tool-buttons"><button id="cleanup-run" type="button" disabled>Remove</button><button id="cleanup-clear" type="button" disabled>Clear paint</button></div><div class="tool-buttons"><button id="cleanup-accept" type="button" disabled>Accept</button><button id="cleanup-reject" type="button" disabled>Reject</button></div><progress id="cleanup-progress" max="1" hidden></progress><p class="hint" id="cleanup-status" role="status">Paint over what you want to remove.</p></fieldset></div>';

export function mountAiTools(host: ToolHost) {
  const sam = new SamEngine();
  const inpaint = new InpaintEngine();
  const refinePanel = $('[data-editor-panel="refine"]');
  const cleanupPanel = $('[data-editor-panel="cleanup"]');
  const active = () => !host.blocked() && host.displayUrl() !== undefined ? (!refinePanel.hidden ? 'refine' : !cleanupPanel.hidden ? 'cleanup' : null) : null;

  // ---- Magic Click ----
  type RefineSession = { key: string; base: Float32Array; rgba: Uint8ClampedArray; points: ClickPoint[]; candidates?: SamCandidates; pick: number; matte?: Float32Array };
  let session: RefineSession | undefined;
  let refineBusy = false;
  const refineStatus = (text: string) => { $('#refine-status').textContent = text; };
  const refineProgress = (loaded?: number, total?: number) => { const p = $<HTMLProgressElement>('#refine-progress'); p.hidden = !total; if (total) p.value = (loaded ?? 0) / total; };
  const refineAction = () => ($<HTMLInputElement>('input[name="refine-action"]:checked').value as RefineAction);
  const syncRefine = () => {
    $<HTMLButtonElement>('#refine-accept').disabled = !session?.matte || refineBusy;
    $<HTMLButtonElement>('#refine-reject').disabled = !session?.points.length || refineBusy;
    $<HTMLButtonElement>('#refine-alt').disabled = !session?.candidates || session.candidates.order.length < 2 || refineBusy;
  };
  const layerKey = (l: SubjectLayers) => `${l.baseUrl}|${l.matteUrl ?? ''}`;
  const showCandidate = async () => {
    if (!session?.candidates) return;
    const c = session.candidates;
    const action = refineAction();
    session.matte = combineMatte(session.base, c.mask(c.order[session.pick % c.order.length]!), action, c.width, Math.max(2, Math.round(Math.max(c.width, c.height) / 300)));
    host.preview(rgbaCanvas(applyMatteAlpha(session.rgba, session.matte), c.width, c.height));
  };
  const endRefine = async (accept: boolean) => {
    if (!session) return;
    const done = session;
    session = undefined;
    if (accept && done.matte) {
      const layers = host.layers();
      const matteUrl = await matteToUrl(done.matte, layers.width, layers.height, host.registerUrl);
      const before = host.displayUrl()!;
      host.cancelPreview();
      await host.commit({ ...layers, matteUrl, refined: (layers.refined ?? 0) + 1 }, before);
      refineStatus('Cutout updated. Undo restores the previous cutout; click again to keep refining.');
    } else {
      host.cancelPreview();
      refineStatus('Change discarded. Your cutout is unchanged.');
    }
    syncRefine();
  };
  const refineClick = async (x: number, y: number, exclude: boolean) => {
    if (refineBusy) return;
    refineBusy = true;
    syncRefine();
    const layers = host.layers();
    try {
      if (!session || session.key !== layerKey(layers)) {
        if (session) host.cancelPreview();
        const base = layers.matteUrl ? await matteFromUrl(layers.matteUrl, layers.width, layers.height) : new Float32Array(layers.width * layers.height).fill(refineAction() === 'keep' ? 0 : 1);
        session = { key: layerKey(layers), base, rgba: (await pixels(layers.baseUrl, layers.width, layers.height)).data, points: [], pick: 0 };
      }
      const t0 = performance.now();
      const encodeMs = await sam.encode(layers.baseUrl, () => loadImage(layers.baseUrl), layers.width, layers.height, (label, l, t) => { refineStatus(`${label}…${percent(l, t)}`); refineProgress(l, t); });
      refineProgress();
      session.points.push({ x, y, label: exclude ? 0 : 1 });
      refineStatus('Selecting…');
      session.candidates = await sam.decode(session.points);
      session.pick = 0;
      await showCandidate();
      refineStatus(`Preview: ${session.points.length} click${session.points.length > 1 ? 's' : ''} (${Math.round(performance.now() - t0)} ms${encodeMs ? `, photo analysed in ${encodeMs} ms` : ''}, ${sam.provider === 'webgpu' ? 'WebGPU' : 'CPU'}). Accept to keep it, Reject to discard.`);
    } catch (error) {
      refineProgress();
      if (session) { session.points.pop(); if (!session.points.length) { session = undefined; host.cancelPreview(); } }
      refineStatus(`${(error as Error).message} Your cutout is unchanged.`);
    } finally {
      refineBusy = false;
      syncRefine();
    }
  };
  $('#refine-alt').addEventListener('click', async () => { if (!session?.candidates || refineBusy) return; session.pick++; await showCandidate(); refineStatus(`Showing shape ${session.pick % session.candidates.order.length + 1} of ${session.candidates.order.length}.`); syncRefine(); });
  $('#refine-accept').addEventListener('click', () => void endRefine(true));
  $('#refine-reject').addEventListener('click', () => void endRefine(false));
  document.querySelectorAll<HTMLInputElement>('input[name="refine-action"]').forEach(input => { input.addEventListener('change', () => { if (session?.candidates && !refineBusy) void showCandidate(); }); });

  // ---- Object cleanup ----
  let mask: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; key: string; painted: boolean } | undefined;
  let painting: { x: number; y: number } | undefined;
  let pending: { rgba: Uint8ClampedArray<ArrayBuffer> } | undefined;
  let cleanupBusy = false;
  const cleanupStatus = (text: string) => { $('#cleanup-status').textContent = text; };
  const cleanupProgress = (loaded?: number, total?: number) => { const p = $<HTMLProgressElement>('#cleanup-progress'); p.hidden = !total; if (total) p.value = (loaded ?? 0) / total; };
  const syncCleanup = () => {
    $<HTMLButtonElement>('#cleanup-run').disabled = cleanupBusy || !!pending || !mask?.painted;
    $<HTMLButtonElement>('#cleanup-clear').disabled = cleanupBusy || !!pending || !mask?.painted;
    $<HTMLButtonElement>('#cleanup-accept').disabled = cleanupBusy || !pending;
    $<HTMLButtonElement>('#cleanup-reject').disabled = cleanupBusy || !pending;
    host.setMaskOverlay(mask?.canvas ?? null, !cleanupPanel.hidden && !pending);
  };
  const ensureMask = () => {
    const layers = host.layers();
    if (mask && mask.key === layers.baseUrl && mask.canvas.width === layers.width && mask.canvas.height === layers.height) return mask;
    const { canvas, ctx } = context(layers.width, layers.height);
    mask = { canvas, ctx, key: layers.baseUrl, painted: false };
    return mask;
  };
  const brushRadius = () => Number($<HTMLInputElement>('#cleanup-size').value) * Math.max(host.layers().width, host.layers().height) / 1024 / 2;
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const m = ensureMask();
    const erase = $<HTMLInputElement>('input[name="cleanup-brush"]:checked').value === 'erase';
    m.ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    m.ctx.strokeStyle = m.ctx.fillStyle = 'rgb(255, 0, 90)';
    m.ctx.lineCap = m.ctx.lineJoin = 'round';
    m.ctx.lineWidth = brushRadius() * 2;
    m.ctx.beginPath(); m.ctx.moveTo(from.x, from.y); m.ctx.lineTo(to.x, to.y); m.ctx.stroke();
    if (!erase) m.painted = true;
    host.refreshOverlay();
  };
  const maskBits = () => {
    const m = ensureMask();
    const data = m.ctx.getImageData(0, 0, m.canvas.width, m.canvas.height).data;
    const bits = new Uint8Array(m.canvas.width * m.canvas.height);
    for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3]! > 32 ? 1 : 0;
    return bits;
  };
  const clearMask = () => { if (mask) { mask.ctx.clearRect(0, 0, mask.canvas.width, mask.canvas.height); mask.painted = false; host.refreshOverlay(); } };
  $('#cleanup-size').addEventListener('input', () => { $('#cleanup-size-value').textContent = $<HTMLInputElement>('#cleanup-size').value; });
  $('#cleanup-clear').addEventListener('click', () => { clearMask(); syncCleanup(); cleanupStatus('Paint cleared.'); });
  $('#cleanup-run').addEventListener('click', async () => {
    if (cleanupBusy || pending || !mask?.painted) return;
    cleanupBusy = true;
    syncCleanup();
    const layers = host.layers();
    try {
      const t0 = performance.now();
      const photo = await pixels(layers.baseUrl, layers.width, layers.height);
      const result = await inpaint.inpaint(photo.data, maskBits(), layers.width, layers.height, (label, l, t) => { cleanupStatus(`${label}…${percent(l, t)}`); cleanupProgress(l, t); });
      cleanupProgress();
      pending = { rgba: result.rgba };
      const matte = layers.matteUrl ? await matteFromUrl(layers.matteUrl, layers.width, layers.height) : null;
      host.preview(rgbaCanvas(matte ? applyMatteAlpha(result.rgba, matte) : result.rgba, layers.width, layers.height));
      cleanupStatus(`Preview ready in ${Math.round(performance.now() - t0)} ms (model ${result.ms} ms, ${result.provider === 'webgpu' ? 'WebGPU' : 'CPU'}). Accept to keep it or Reject to try again.`);
    } catch (error) {
      cleanupProgress();
      cleanupStatus(`${(error as Error).message} Your photo is unchanged.`);
    } finally {
      cleanupBusy = false;
      syncCleanup();
    }
  });
  const endCleanup = async (accept: boolean) => {
    if (!pending) return;
    const done = pending;
    pending = undefined;
    if (accept) {
      const layers = host.layers();
      const baseUrl = await canvasToUrl(rgbaCanvas(done.rgba, layers.width, layers.height), host.registerUrl);
      const before = host.displayUrl()!;
      host.cancelPreview();
      await host.commit({ ...layers, baseUrl, cleaned: (layers.cleaned ?? 0) + 1 }, before);
      clearMask();
      mask = undefined;
      cleanupStatus('Object removed. Undo restores it; paint again for another cleanup.');
    } else {
      host.cancelPreview();
      cleanupStatus('Result discarded. Adjust the paint and press Remove again.');
    }
    syncCleanup();
  };
  $('#cleanup-accept').addEventListener('click', () => void endCleanup(true));
  $('#cleanup-reject').addEventListener('click', () => void endCleanup(false));

  // ---- Canvas input ----
  host.studio.on('mouse:down', (event) => {
    const tool = active();
    const point = tool ? host.toImagePixel(event.e) : null;
    if (!tool || !point) return;
    if (tool === 'refine') void refineClick(point.x, point.y, (event.e as MouseEvent).shiftKey);
    else if (!pending && !cleanupBusy) { painting = point; stroke(point, point); syncCleanup(); }
  });
  host.studio.on('mouse:move', (event) => {
    if (!painting || active() !== 'cleanup') return;
    const point = host.toImagePixel(event.e);
    if (point) { stroke(painting, point); painting = point; }
  });
  host.studio.on('mouse:up', () => { if (painting) { painting = undefined; syncCleanup(); } });
  new MutationObserver(() => {
    const tool = active();
    host.studio.defaultCursor = tool ? 'crosshair' : 'default';
    syncCleanup();
  }).observe(cleanupPanel.parentElement!, { attributes: true, attributeFilter: ['hidden'], subtree: true });

  return {
    /** Called when the editor loads a new photo or restores history: abandon in-flight previews. */
    reset() { session = undefined; pending = undefined; painting = undefined; mask = undefined; syncRefine(); syncCleanup(); refineStatus('Click the photo to start. Without a cutout, Bring back cuts out what you click.'); cleanupStatus('Paint over what you want to remove.'); },
    release() { sam.release(); inpaint.release(); },
  };
}
