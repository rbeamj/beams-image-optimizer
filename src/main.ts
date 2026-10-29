import { inputIssue, optimizeBatch, optimizeImage, type ImageResult, type OptimizeOptions, type OutputFormat } from './engine';
import { initEditor } from './editor/controller';
import { studioEdge } from './editor/tools';
import { builtInPreset, presetDescription, presetFromLook, templateToPreset, type BatchPreset } from './batch/presets';
import { presetImage, type PresetImageResult } from './batch/run';
import { acknowledgeBgRemoval, BG_REMOVAL_NOTICE, hasAcknowledgedBgRemoval } from './bgremove';
import { deleteProject, getProject, listProjects, putProject, deleteTemplate, listTemplates, putTemplate, getQueue, putQueue } from './storage/idb';
import { toQueueRecord } from './storage/queue';
import type { StoredProject } from './editor/projects';
import { templateValue, templateIdFromValue, type StoredTemplate } from './editor/templates';
import { SamEngine, type SamCandidates } from './ai/sam-engine';
import { InpaintEngine } from './ai/inpaint-engine';
import { combineMatte, type RefineAction, type ClickPoint } from './editor/refine-tools';
import { applyMatteAlpha, canvasToUrl, context, loadImage, matteFromUrl, matteToUrl, pixels, rgbaCanvas, type SubjectLayers } from './editor/subject';
import { composeScene, imageAlphaBounds } from './editor/compose';
import { placeSubject } from './editor/scene';
import './style.css';

type Recipe = { format: OutputFormat; quality: number; maxEdge: number; label: string };
type AiTool = 'refine' | 'cleanup';
type AiToolStage = 'idle' | 'preview' | 'processing';

interface RefineSession {
  key: string;
  baseMatte: Float32Array;
  rgba: Uint8ClampedArray;
  points: ClickPoint[];
  candidates?: SamCandidates;
  pick: number;
  matte?: Float32Array;
  width: number;
  height: number;
}

interface CleanupMask {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  key: string;
  painted: boolean;
}

type Row = {
  file: File;
  result?: ImageResult & { matteReused?: boolean };
  error?: string;
  preview: string;
  recipe?: Recipe;
  preset?: string;
  thumb?: string;
  matte?: { blob: Blob; key: string };
  aiTool?: AiTool;
  aiStage?: AiToolStage;
  aiExpand?: boolean;
  refineSession?: RefineSession;
  cleanupMask?: CleanupMask;
  cleanupPending?: { rgba: Uint8ClampedArray };
  cleanupBusy?: boolean;
};

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = $('#file-input') as HTMLInputElement, queue = $('#queue'), status = $('#status');
const quality = $('#quality') as HTMLInputElement, customEdge = $('#custom-edge') as HTMLInputElement;
const process = $('#process') as HTMLButtonElement, cancel = $('#cancel') as HTMLButtonElement, downloadAll = $('#download-all') as HTMLButtonElement, exportImage = $('#export-image') as HTMLButtonElement;
const presetSelect = $('#batch-preset-select') as HTMLSelectElement, presetHint = $('#batch-preset-hint'), presetAck = $('#batch-ack'), presetAckText = $('#batch-ack-text'), presetAckButton = $('#batch-ack-button') as HTMLButtonElement;
const saveProjectButton = $('#save-project') as HTMLButtonElement, projectNameInput = $('#project-name') as HTMLInputElement, projectList = $('#project-list');
const clearQueueButton = $('#clear-queue') as HTMLButtonElement;
let currentProjectId: string | null = null;
let templateCache: StoredTemplate[] = [];
const rows: Row[] = []; let controller: AbortController | undefined;
const editor = initEditor();
// The Scene panel (and its template controls) is injected by initEditor, so it can only be queried after.
const saveTemplateButton = $('#save-template') as HTMLButtonElement, templateNameInput = $('#template-name') as HTMLInputElement, templateList = $('#template-list');
const quickWorkspace = $('#quick-workspace'), studioWorkspace = $('#studio-workspace');
const quickSettings = $('#quick-settings'), studioExport = document.querySelector<HTMLElement>('[data-editor-panel="export"]')!;
const quickMode = $('#quick-mode') as HTMLButtonElement, studioMode = $('#studio-mode') as HTMLButtonElement;
const controls = $('#controls');

// --- Per-row AI tools (Magic Click refinement, Object Cleanup) ---
const sam = new SamEngine();
const inpaint = new InpaintEngine();

function layerKey(file: File, matteKey?: string) {
  return `${file.name}|${matteKey ?? ''}`;
}

function getRowBaseUrl(row: Row): string {
  return row.result && row.matte ? row.matte.key ? URL.createObjectURL(row.matte.blob) : row.preview : row.preview;
}

async function loadRowRgba(row: Row): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const url = getRowBaseUrl(row);
  const img = await loadImage(url);
  const { ctx } = context(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
  return { rgba: ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data, width: img.naturalWidth, height: img.naturalHeight };
}

async function loadRowMatte(row: Row, width: number, height: number): Promise<Float32Array | null> {
  if (!row.matte) return null;
  const url = URL.createObjectURL(row.matte.blob);
  try {
    return await matteFromUrl(url, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function syncRowActions(row: Row, index: number) {
  const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
  if (!card) return;
  const refineBtn = card.querySelector<HTMLButtonElement>('[data-refine]');
  const cleanupBtn = card.querySelector<HTMLButtonElement>('[data-cleanup]');
  const acceptBtn = card.querySelector<HTMLButtonElement>('[data-ai-accept]');
  const rejectBtn = card.querySelector<HTMLButtonElement>('[data-ai-reject]');
  const altBtn = card.querySelector<HTMLButtonElement>('[data-ai-alt]');
  const clearBtn = card.querySelector<HTMLButtonElement>('[data-ai-clear]');
  const runBtn = card.querySelector<HTMLButtonElement>('[data-ai-run]');

  const inRefine = row.aiTool === 'refine';
  const inCleanup = row.aiTool === 'cleanup';
  const inPreview = row.aiStage === 'preview';
  const inProcessing = row.aiStage === 'processing';

  if (refineBtn) refineBtn.disabled = inProcessing || (inCleanup && !inPreview);
  if (cleanupBtn) cleanupBtn.disabled = inProcessing || (inRefine && !inPreview);
  if (acceptBtn) acceptBtn.disabled = inProcessing || !inPreview || (inRefine && !row.refineSession?.matte) || (inCleanup && !row.cleanupPending);
  if (rejectBtn) rejectBtn.disabled = inProcessing || !inPreview;
  if (altBtn) altBtn.disabled = inProcessing || !inRefine || !row.refineSession?.candidates || (row.refineSession.candidates.order.length < 2);
  if (clearBtn) clearBtn.disabled = inProcessing || !inCleanup || !row.cleanupMask?.painted;
  if (runBtn) runBtn.disabled = inProcessing || !inCleanup || !row.cleanupMask?.painted;
}

function setRowStatus(row: Row, index: number, text: string) {
  const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
  if (!card) return;
  const statusEl = card.querySelector<HTMLElement>('.tool-status');
  if (statusEl) statusEl.textContent = text;
}

function setRowProgress(row: Row, index: number, loaded?: number, total?: number) {
  const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
  if (!card) return;
  const progressEl = card.querySelector<HTMLDivElement>('.tool-progress > div');
  if (progressEl && total) {
    progressEl.style.width = `${Math.round(100 * (loaded ?? 0) / total)}%`;
  } else if (progressEl) {
    progressEl.style.width = '0%';
  }
}

function showRowProgress(row: Row, index: number, show: boolean) {
  const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
  if (!card) return;
  const progressEl = card.querySelector<HTMLElement>('.tool-progress');
  if (progressEl) progressEl.hidden = !show;
}

function setThumbInteractive(row: Row, index: number, interactive: boolean) {
  const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
  if (!card) return;
  const thumb = card.querySelector<HTMLElement>('.thumb');
  if (thumb) {
    thumb.classList.toggle('interactive', interactive);
    if (interactive) thumb.setAttribute('tabindex', '0');
    else thumb.removeAttribute('tabindex');
  }
}

async function recomposeRowWithNewMatte(row: Row, index: number, matte: Float32Array) {
  const preset = selectedPreset();
  if (!preset) return;
  const runRecipe = effectiveRecipe(preset, recipe());
  const engine = editor.removalEngine();

  const result = await presetImage(row.file, preset, engine, { format: runRecipe.format, quality: runRecipe.quality, maxEdge: runRecipe.maxEdge }, {
    signal: controller?.signal,
    onStage: label => setRowStatus(row, index, label),
    reuse: { blob: await fetch(await matteToUrl(matte, row.result?.width ?? 1024, row.result?.height ?? 1024, u => u)).then(r => r.blob()), key: layerKey(row.file) }
  });
  row.result = result;
  row.recipe = runRecipe;
  row.preset = preset.label;
  row.matte = result.matte;
  refreshResultThumb(row);
  render();
  persistQueue();
}

async function recomposeRowWithNewBase(row: Row, index: number) {
  const preset = selectedPreset();
  if (!preset) return;
  const runRecipe = effectiveRecipe(preset, recipe());
  const engine = editor.removalEngine();

  const result = await presetImage(row.file, preset, engine, { format: runRecipe.format, quality: runRecipe.quality, maxEdge: runRecipe.maxEdge }, {
    signal: controller?.signal,
    onStage: label => setRowStatus(row, index, label),
    reuse: row.matte
  });
  row.result = result;
  row.recipe = runRecipe;
  row.preset = preset.label;
  row.matte = result.matte;
  refreshResultThumb(row);
  render();
  persistQueue();
}

// --- AI Tool handlers ---

async function openRefineTool(row: Row, index: number) {
  if (row.aiTool === 'refine' && row.aiStage === 'preview') return;
  if (row.aiTool === 'cleanup') await closeCleanupTool(row, index, false);

  row.aiTool = 'refine';
  row.aiStage = 'idle';
  row.aiExpand = true;

  const { rgba, width, height } = await loadRowRgba(row);
  const matte = await loadRowMatte(row, width, height) ?? new Float32Array(width * height).fill(0);

  row.refineSession = {
    key: layerKey(row.file, row.matte?.key),
    baseMatte: new Float32Array(matte),
    rgba,
    points: [],
    pick: 0,
    width,
    height,
  };

  setThumbInteractive(row, index, true);
  setRowStatus(row, index, 'Click to bring back or remove areas. Shift+click to exclude.');
  render();
  syncRowActions(row, index);
}

async function refineClick(row: Row, index: number, x: number, y: number, exclude: boolean) {
  if (!row.refineSession || row.aiStage === 'processing') return;
  row.aiStage = 'processing';
  setRowStatus(row, index, 'Analyzing photo…');
  showRowProgress(row, index, true);
  setThumbInteractive(row, index, false);
  syncRowActions(row, index);

  try {
    const { rgba, width, height } = row.refineSession;
    const encodeMs = await sam.encode(row.preview, () => loadImage(row.preview), width, height, (label, l, t) => {
      setRowStatus(row, index, `${label}…${t ? ` ${Math.round(100 * (l ?? 0) / t)}%` : ''}`);
      setRowProgress(row, index, l ?? 0, t);
    });
    showRowProgress(row, index, false);

    row.refineSession.points.push({ x, y, label: exclude ? 0 : 1 });
    setRowStatus(row, index, 'Selecting…');
    row.refineSession.candidates = await sam.decode(row.refineSession.points);
    row.refineSession.pick = 0;
    await showRefineCandidate(row, index);
    setRowStatus(row, index, `Preview: ${row.refineSession.points.length} click${row.refineSession.points.length > 1 ? 's' : ''} (${sam.provider === 'webgpu' ? 'WebGPU' : 'CPU'}). Accept or Reject.`);
  } catch (error) {
    if (row.refineSession) row.refineSession.points.pop();
    setRowStatus(row, index, `${(error as Error).message} Cutout unchanged.`);
  } finally {
    row.aiStage = 'preview';
    showRowProgress(row, index, false);
    setThumbInteractive(row, index, true);
    syncRowActions(row, index);
  }
}

async function showRefineCandidate(row: Row, index: number) {
  if (!row.refineSession?.candidates || !row.refineSession.matte) return;
  const action = ($<HTMLInputElement>('input[name="refine-action"]:checked')?.value as RefineAction) ?? 'keep';
  const c = row.refineSession.candidates;
  const pick = row.refineSession.pick % c.order.length;
  row.refineSession.matte = combineMatte(
    row.refineSession.baseMatte,
    c.mask(c.order[pick]!),
    action,
    c.width,
    Math.max(2, Math.round(Math.max(c.width, c.height) / 300))
  );
  const { width, height } = row.refineSession;
  const previewRgba = applyMatteAlpha(row.refineSession.rgba, row.refineSession.matte);
  const canvas = rgbaCanvas(previewRgba, width, height);
  updateRowThumb(row, index, canvas);
}

function updateRowThumb(row: Row, index: number, canvas: HTMLCanvasElement) {
  const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
  if (!card) return;
  const thumbImg = card.querySelector<HTMLImageElement>('.thumb img');
  if (thumbImg) thumbImg.src = canvas.toDataURL('image/png');
}

async function acceptRefine(row: Row, index: number) {
  if (!row.refineSession?.matte) return;
  row.aiStage = 'processing';
  setRowStatus(row, index, 'Applying refinement…');
  showRowProgress(row, index, true);
  syncRowActions(row, index);

  try {
    const { width, height } = row.refineSession;
    const matteUrl = await matteToUrl(row.refineSession.matte, width, height, u => u);
    const matteBlob = await fetch(matteUrl).then(r => r.blob());
    row.matte = { blob: matteBlob, key: layerKey(row.file, row.matte?.key) };
    const newMatte = row.refineSession.matte;
    row.refineSession = undefined;
    row.aiTool = undefined;
    row.aiStage = 'idle';
    row.aiExpand = false;

    await recomposeRowWithNewMatte(row, index, newMatte);
    setRowStatus(row, index, 'Refinement applied. Click Refine to adjust further.');
  } catch (error) {
    setRowStatus(row, index, `${(error as Error).message} Refinement not applied.`);
  } finally {
    showRowProgress(row, index, false);
    setThumbInteractive(row, index, false);
    render();
    syncRowActions(row, index);
  }
}

function rejectRefine(row: Row, index: number) {
  row.refineSession = undefined;
  row.aiTool = undefined;
  row.aiStage = 'idle';
  row.aiExpand = false;
  setThumbInteractive(row, index, false);
  if (row.thumb) {
    const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
    if (card) {
      const thumbImg = card.querySelector<HTMLImageElement>('.thumb img');
      if (thumbImg) thumbImg.src = row.thumb;
    }
  }
  setRowStatus(row, index, 'Refinement discarded. Click Refine to try again.');
  render();
  syncRowActions(row, index);
}

function altRefine(row: Row, index: number) {
  if (!row.refineSession?.candidates || row.refineSession.candidates.order.length < 2) return;
  row.refineSession.pick++;
  showRefineCandidate(row, index);
  const c = row.refineSession.candidates;
  setRowStatus(row, index, `Showing shape ${row.refineSession.pick % c.order.length + 1} of ${c.order.length}.`);
}

async function openCleanupTool(row: Row, index: number) {
  if (row.aiTool === 'cleanup' && row.aiStage === 'preview') return;
  if (row.aiTool === 'refine') rejectRefine(row, index);

  row.aiTool = 'cleanup';
  row.aiStage = 'idle';
  row.aiExpand = true;

  const { rgba, width, height } = await loadRowRgba(row);
  row.cleanupMask = await ensureCleanupMask(row, width, height);
  row.cleanupPending = undefined;
  row.cleanupBusy = false;

  setThumbInteractive(row, index, true);
  setRowStatus(row, index, 'Paint over objects to remove. Then press Remove.');
  render();
  syncRowActions(row, index);
}

async function ensureCleanupMask(row: Row, width: number, height: number): Promise<CleanupMask> {
  if (row.cleanupMask && row.cleanupMask.key === row.file.name && row.cleanupMask.canvas.width === width && row.cleanupMask.canvas.height === height) {
    return row.cleanupMask;
  }
  const { canvas, ctx } = context(width, height);
  return { canvas, ctx, key: row.file.name, painted: false };
}

function cleanupBrushRadius(row: Row): number {
  const sizeInput = queue.querySelector<HTMLInputElement>('[data-cleanup-size]');
  return (sizeInput ? Number(sizeInput.value) : 36) * Math.max(1, 1) / 2;
}

function cleanupStroke(row: Row, from: { x: number; y: number }, to: { x: number; y: number }) {
  if (!row.cleanupMask) return;
  const erase = (queue.querySelector<HTMLInputElement>('input[name="cleanup-brush"]:checked')?.value === 'erase');
  row.cleanupMask.ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  row.cleanupMask.ctx.strokeStyle = row.cleanupMask.ctx.fillStyle = 'rgb(255, 0, 90)';
  row.cleanupMask.ctx.lineCap = row.cleanupMask.ctx.lineJoin = 'round';
  row.cleanupMask.ctx.lineWidth = cleanupBrushRadius(row) * 2;
  row.cleanupMask.ctx.beginPath();
  row.cleanupMask.ctx.moveTo(from.x, from.y);
  row.cleanupMask.ctx.lineTo(to.x, to.y);
  row.cleanupMask.ctx.stroke();
  if (!erase) row.cleanupMask.painted = true;
  updateCleanupOverlay(row);
  syncRowActions(row, rows.indexOf(row));
}

function cleanupBits(row: Row): Uint8Array {
  if (!row.cleanupMask) return new Uint8Array(0);
  const data = row.cleanupMask.ctx.getImageData(0, 0, row.cleanupMask.canvas.width, row.cleanupMask.canvas.height).data;
  const bits = new Uint8Array(row.cleanupMask.canvas.width * row.cleanupMask.canvas.height);
  for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3]! > 32 ? 1 : 0;
  return bits;
}

function updateCleanupOverlay(row: Row) {
  const index = rows.indexOf(row);
  const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
  if (!card || !row.cleanupMask) return;
  let overlay = card.querySelector<HTMLCanvasElement>('.paint-overlay');
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.className = 'paint-overlay';
    card.querySelector('.thumb')?.appendChild(overlay);
  }
  overlay.width = row.cleanupMask.canvas.width;
  overlay.height = row.cleanupMask.canvas.height;
  const octx = overlay.getContext('2d')!;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  octx.drawImage(row.cleanupMask.canvas, 0, 0);
}

function clearCleanupMask(row: Row) {
  if (row.cleanupMask) {
    row.cleanupMask.ctx.clearRect(0, 0, row.cleanupMask.canvas.width, row.cleanupMask.canvas.height);
    row.cleanupMask.painted = false;
    updateCleanupOverlay(row);
  }
}

async function runCleanup(row: Row, index: number) {
  if (row.cleanupBusy || row.cleanupPending || !row.cleanupMask?.painted) return;
  row.cleanupBusy = true;
  row.aiStage = 'processing';
  setRowStatus(row, index, 'Removing objects…');
  showRowProgress(row, index, true);
  syncRowActions(row, index);

  try {
    const { rgba, width, height } = await loadRowRgba(row);
    const result = await inpaint.inpaint(rgba, cleanupBits(row), width, height, (label, l, t) => {
      setRowStatus(row, index, `${label}…${t ? ` ${Math.round(100 * (l ?? 0) / t)}%` : ''}`);
      setRowProgress(row, index, l ?? 0, t);
    });
    showRowProgress(row, index, false);

    row.cleanupPending = { rgba: result.rgba };
    const canvas = rgbaCanvas(result.rgba, width, height);
    updateRowThumb(row, index, canvas);
    setRowStatus(row, index, `Preview ready (${result.ms} ms, ${result.provider === 'webgpu' ? 'WebGPU' : 'CPU'}). Accept or Reject.`);
    row.aiStage = 'preview';
  } catch (error) {
    setRowStatus(row, index, `${(error as Error).message} Photo unchanged.`);
    row.aiStage = 'idle';
  } finally {
    row.cleanupBusy = false;
    showRowProgress(row, index, false);
    syncRowActions(row, index);
  }
}

async function acceptCleanup(row: Row, index: number) {
  if (!row.cleanupPending) return;
  row.aiStage = 'processing';
  setRowStatus(row, index, 'Applying cleanup…');
  showRowProgress(row, index, true);
  syncRowActions(row, index);

  try {
    const { width, height } = await loadRowRgba(row);
    const baseUrl = await canvasToUrl(rgbaCanvas(row.cleanupPending.rgba as Uint8ClampedArray<ArrayBuffer>, width, height), u => u);
    row.preview = baseUrl;
    row.cleanupPending = undefined;
    row.cleanupMask = undefined;
    row.aiTool = undefined;
    row.aiStage = 'idle';
    row.aiExpand = false;

    await recomposeRowWithNewBase(row, index);
    setRowStatus(row, index, 'Cleanup applied. Click Cleanup to remove more.');
  } catch (error) {
    setRowStatus(row, index, `${(error as Error).message} Cleanup not applied.`);
  } finally {
    showRowProgress(row, index, false);
    setThumbInteractive(row, index, false);
    render();
    syncRowActions(row, index);
  }
}

function rejectCleanup(row: Row, index: number) {
  row.cleanupPending = undefined;
  row.cleanupMask = undefined;
  row.aiTool = undefined;
  row.aiStage = 'idle';
  row.aiExpand = false;
  setThumbInteractive(row, index, false);
  if (row.thumb) {
    const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
    if (card) {
      const thumbImg = card.querySelector<HTMLImageElement>('.thumb img');
      if (thumbImg) thumbImg.src = row.thumb;
    }
  }
  setRowStatus(row, index, 'Cleanup discarded. Adjust paint and press Remove again.');
  render();
  syncRowActions(row, index);
}

function closeCleanupTool(row: Row, index: number, restoreThumb = true) {
  if (row.aiTool !== 'cleanup') return;
  row.cleanupPending = undefined;
  row.cleanupMask = undefined;
  row.aiTool = undefined;
  row.aiStage = 'idle';
  row.aiExpand = false;
  setThumbInteractive(row, index, false);
  if (restoreThumb && row.thumb) {
    const card = queue.querySelector<HTMLElement>(`.image-card:nth-child(${index + 1})`);
    if (card) {
      const thumbImg = card.querySelector<HTMLImageElement>('.thumb img');
      if (thumbImg) thumbImg.src = row.thumb;
    }
  }
}

function closeAllAiTools() {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.aiTool === 'refine') rejectRefine(row, i);
    else if (row.aiTool === 'cleanup') closeCleanupTool(row, i);
  }
}

const RESULT_THUMB_EDGE = 96;
function refreshResultThumb(row: Row) {
  if (!row.result) return;
  createImageBitmap(row.result.blob).then(bmp => {
    const scale = Math.min(1, RESULT_THUMB_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    row.thumb = canvas.toDataURL('image/png');
    render();
  }).catch(() => {});
}

function recipe(): Recipe {
  const edge = selected('edge').value;
  const maxEdge = edge === 'custom' ? Math.max(1, Number(customEdge.value) || 1) : Number(edge);
  const label = edge === '0' ? 'Original' : edge === 'custom' ? `${maxEdge}px` : `${Number(edge) / 1024}K`;
  return { format: selected('format').value as OutputFormat, quality: Number(quality.value) / 100, maxEdge, label };
}
function options(): OptimizeOptions { const r = recipe(); return { format: r.format, quality: r.quality, maxEdge: r.maxEdge, signal: controller?.signal }; }
function currentLabel() { const r = recipe(); return `${r.format.toUpperCase()} · ${Math.round(r.quality * 100)}% · ${r.label}`; }

/** A combined preset's bundled recipe replaces the shared export settings for that run. */
function effectiveRecipe(preset: BatchPreset | undefined, active: Recipe): Recipe {
  if (!preset?.recipe) return active;
  const { format, quality, maxEdge } = preset.recipe;
  const label = maxEdge >= 1024 && maxEdge % 1024 === 0 ? `${maxEdge / 1024}K` : `${maxEdge}px`;
  return { format, quality, maxEdge, label };
}

const bytes = (n: number) => n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#039;' }[c]!));
const selected = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!;

function updateControls() {
  const r = recipe();
  $('#quality-value').textContent = `${Math.round(r.quality * 100)}%`;
  $('#current-recipe').textContent = currentLabel();
  exportImage.textContent = `Export ${r.format.toUpperCase()} · ${r.label}`;
  $('#custom-edge-wrap').hidden = selected('edge').value !== 'custom';
  $('#format-note').textContent = r.format === 'jpeg' ? 'JPEG fills transparent pixels with white.' : `${r.format.toUpperCase()} preserves transparency where the browser supports it.`;
}
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

function renderStats() {
  const completed = rows.filter(row => row.result);
  const el = $('#batch-stats');
  el.hidden = !completed.length;
  if (!completed.length) return;
  const original = completed.reduce((sum, row) => sum + row.result!.sourceBytes, 0);
  const output = completed.reduce((sum, row) => sum + row.result!.outputBytes, 0);
  const saving = Math.round((1 - output / original) * 100);
  el.innerHTML = `<div><small>Processed</small><strong>${completed.length} / ${rows.length}</strong></div><div><small>Original total</small><strong>${bytes(original)}</strong></div><div><small>Optimized total</small><strong>${bytes(output)}</strong></div><div><small>Saved</small><strong>${saving >= 0 ? `${saving}%` : '—'}</strong></div>`;
}

function render() {
  queue.innerHTML = rows.map((row, i) => {
    const result = row.result;
    const delta = result ? Math.round((1 - result.outputBytes / result.sourceBytes) * 100) : 0;
    const hasMatte = !!row.matte;
    const inRefine = row.aiTool === 'refine' && row.aiExpand;
    const inCleanup = row.aiTool === 'cleanup' && row.aiExpand;
    const inPreview = row.aiStage === 'preview';
    const inProcessing = row.aiStage === 'processing';

    let aiPanelHtml = '';
    if (row.aiExpand && (inRefine || inCleanup)) {
      if (inRefine) {
        aiPanelHtml = `
<div class="ai-tool-panel">
  <header>
    <h4>Magic Click — Refine Cutout</h4>
    <div class="mode-switch">
      <label><input type="radio" name="refine-action" value="keep" ${!row.refineSession || row.refineSession.points.every(p => p.label === 1) ? 'checked' : ''} /> Bring back</label>
      <label><input type="radio" name="refine-action" value="erase" ${row.refineSession && row.refineSession.points.some(p => p.label === 0) ? 'checked' : ''} /> Remove</label>
    </div>
  </header>
  <p class="tool-status">${inPreview ? 'Click Accept to keep, Reject to discard, or click again to refine.' : 'Click the photo to add or remove areas.'}</p>
  <div class="tool-progress" hidden><div></div></div>
  <div class="tool-actions">
    ${inPreview ? `<button class="primary" data-ai-accept>Accept</button><button data-ai-reject>Reject</button>` : ''}
    ${row.refineSession?.candidates && row.refineSession.candidates.order.length > 1 ? `<button data-ai-alt>Try another</button>` : ''}
  </div>
</div>`;
      } else if (inCleanup) {
        aiPanelHtml = `
<div class="ai-tool-panel">
  <header>
    <h4>Remove Objects — MI-GAN</h4>
  </header>
  <div class="mode-switch">
    <label><input type="radio" name="cleanup-brush" value="paint" checked /> Paint</label>
    <label><input type="radio" name="cleanup-brush" value="erase" /> Erase paint</label>
  </div>
  <div class="brush-size">Brush size <input type="range" min="4" max="160" value="36" data-cleanup-size /><output data-cleanup-size-value>36</output></div>
  <p class="tool-status">${inPreview ? 'Click Accept to keep, Reject to discard, or paint more.' : 'Paint over objects to remove. Then press Remove.'}</p>
  <div class="tool-progress" hidden><div></div></div>
  <div class="tool-actions">
    <button data-ai-run ${!row.cleanupMask?.painted ? 'disabled' : ''}>Remove</button>
    <button data-ai-clear ${!row.cleanupMask?.painted ? 'disabled' : ''}>Clear paint</button>
    ${inPreview ? `<button class="primary" data-ai-accept>Accept</button><button data-ai-reject>Reject</button>` : ''}
  </div>
</div>`;
      }
    }

    return `<article class="image-card ${result ? 'done' : ''} ${row.aiExpand ? 'expanded' : ''}">
<div class="thumb ${(inRefine || inCleanup) && !inPreview ? 'interactive' : ''}"><img src="${row.thumb ?? row.preview}" alt="${row.thumb ? 'Processed result for' : 'Preview of'} ${escapeHtml(row.file.name)}" />${result ? `<span>${result.width}×${result.height}</span>` : ''}</div>
<div class="image-info"><strong title="${escapeHtml(row.file.name)}">${escapeHtml(row.file.name)}</strong><p>${bytes(row.file.size)}${result ? ` <i>→</i> ${bytes(result.outputBytes)} <b>${delta >= 0 ? `${delta}% smaller` : `${Math.abs(delta)}% larger`}</b>` : ''}</p><small>${result ? `${row.recipe ? `Processed with ${escapeHtml(row.recipe.format.toUpperCase())} · ${Math.round(row.recipe.quality * 100)}% · ${escapeHtml(row.recipe.label)}` : 'Processed in an earlier session'}${row.preset ? ` · ${escapeHtml(row.preset)}` : ''}${result.matteReused ? ' · cutout reused' : ''}` : row.error || `Ready · current recipe: ${currentLabel()}`}</small></div>
<div class="card-actions"><button class="download" data-edit="${i}">Edit</button>${result ? `<button class="download" data-reprocess="${i}" title="Re-run this photo with the current recipe and preset">Reprocess</button><button class="download" data-download="${i}">Download</button>` : ''}${row.error ? `<button class="download" data-retry="${i}">Retry</button>` : !result ? `<button class="download" data-reprocess="${i}" title="Process just this photo with the current recipe and preset">Process</button>` : ''}<button class="download" data-copy="${i}" title="Duplicate this photo so you can compare two presets">Copy</button><button class="download" data-remove="${i}" title="Remove from queue" aria-label="Remove ${escapeHtml(row.file.name)} from the queue">✕</button>${hasMatte ? `<button class="download" data-refine="${i}" title="Refine the cutout with Magic Click">Refine</button><button class="download" data-cleanup="${i}" title="Remove objects with MI-GAN">Cleanup</button>` : ''}</div>
${aiPanelHtml}
</article>`;
  }).join('');
  $('#image-count').textContent = String(rows.length);
  process.disabled = !rows.length || (controller !== undefined);
  cancel.disabled = controller === undefined;
  downloadAll.disabled = !rows.some(r => r.result);
  clearQueueButton.disabled = !rows.length;
  renderStats();
  for (let i = 0; i < rows.length; i++) syncRowActions(rows[i], i);
}

function add(files: FileList | File[]) {
  const candidates = Array.from(files);
  const allowed = candidates.filter(file => !inputIssue(file));
  const rejected = candidates.map(inputIssue).find(Boolean);
  if (allowed.length && !rows.length) editor.load(allowed[0]);
  if (allowed.length) { exportImage.disabled = false; saveProjectButton.disabled = false; saveTemplateButton.disabled = false; }
  currentProjectId = null;
  allowed.forEach(file => { rows.push({ file, preview: URL.createObjectURL(file) }); });
  persistQueue();
  status.textContent = allowed.length ? `${rows.length} image${rows.length === 1 ? '' : 's'} queued. Current recipe: ${currentLabel()}.` : rejected || 'Choose JPEG, PNG, or WebP images.';
  render();
}

function persistQueue() {
  putQueue(toQueueRecord(rows)).catch(error => console.error('The queue could not be saved:', error));
}

async function restoreQueue() {
  const record = await getQueue();
  if (!record?.rows.length) return;
  for (const row of record.rows) {
    const file = new File([row.file], row.fileName, { type: row.fileType });
    rows.push({ file, preview: URL.createObjectURL(file), preset: row.preset ?? undefined, recipe: row.recipe ? { ...row.recipe } : undefined, error: row.error ?? undefined, result: row.result ? { ...row.result } : undefined, matte: row.matte ? { ...row.matte } : undefined });
  }
  editor.load(rows[0].file);
  exportImage.disabled = false;
  saveProjectButton.disabled = false;
  saveTemplateButton.disabled = false;
  currentProjectId = null;
  render();
  rows.forEach(row => { if (row.result) refreshResultThumb(row); });
  status.textContent = `Queue restored from this browser: ${rows.length} image${rows.length === 1 ? '' : 's'}, outcomes preserved. Originals are never modified.`;
}

async function exportEdited() {
  if (editor.pendingPreview()) { status.textContent = 'Accept or reject the AI preview before exporting.'; return; }
  const edited = await editor.exportFile();
  if (!edited) { status.textContent = 'Choose an image to export first.'; return; }
  exportImage.disabled = true;
  const activeRecipe = recipe();
  const maxEdge = studioEdge(activeRecipe.maxEdge);
  try {
    const result = await optimizeImage(edited, { format: activeRecipe.format, quality: activeRecipe.quality, maxEdge });
    download(result.blob, result.filename);
    status.textContent = `Exported ${result.filename}: ${result.width}×${result.height} · ${bytes(result.outputBytes)} with ${activeRecipe.format.toUpperCase()} · ${Math.round(activeRecipe.quality * 100)}% · ${maxEdge !== activeRecipe.maxEdge ? `2200 (Studio limit)` : activeRecipe.label}.`;
  } catch {
    status.textContent = 'The edited image could not be exported.';
  } finally {
    exportImage.disabled = false;
  }
}

function selectedPreset(): BatchPreset | undefined {
  const value = presetSelect.value;
  if (value === 'none') return undefined;
  if (value === 'current') { const look = editor.captureLook(); return look ? presetFromLook(look) : undefined; }
  const templateId = templateIdFromValue(value);
  if (templateId) {
    const stored = templateCache.find(template => template.id === templateId);
    if (!stored) return undefined;
    const preset = templateToPreset(stored);
    if (preset.backdrop.kind === 'image' && stored.data.backdropImage) preset.backdrop = { kind: 'image', url: URL.createObjectURL(stored.data.backdropImage), fit: preset.backdrop.fit };
    return preset;
  }
  return builtInPreset(value);
}

function syncPresetUi() {
  const preset = selectedPreset();
  const gate = !!preset?.cutout && !hasAcknowledgedBgRemoval();
  presetAck.hidden = !gate;
  if (gate) presetAckText.textContent = BG_REMOVAL_NOTICE;
  presetHint.textContent = presetDescription(preset);
  process.textContent = preset?.cutout ? 'Cut out & export batch' : 'Export batch';
}

async function runOptimizeBatch(activeRecipe: Recipe) {
  status.textContent = `Optimizing ${rows.length} images with ${currentLabel()}…`;
  render();
  await optimizeBatch(rows.map(row => row.file), options(), event => {
    const row = rows[event.index];
    if (event.result) { row.result = event.result; row.recipe = activeRecipe; row.preset = undefined; row.error = undefined; refreshResultThumb(row); }
    if (event.error) row.error = event.error.name === 'AbortError' ? 'Cancelled' : event.error.message;
    status.textContent = `Processed ${event.completed} of ${event.total}: ${event.filename}`;
    persistQueue();
    render();
  }).catch(error => { status.textContent = (error as DOMException).name === 'AbortError' ? 'Processing cancelled. Completed images are available below.' : 'Some images could not be processed.'; });
  if (rows.some(row => row.result)) status.textContent = `Batch complete. These images used ${activeRecipe.format.toUpperCase()} · ${Math.round(activeRecipe.quality * 100)}% · ${activeRecipe.label}; current controls may differ.`;
  persistQueue();
}

async function runPresetBatch(preset: BatchPreset, activeRecipe: Recipe, signal: AbortSignal) {
  const runRecipe = effectiveRecipe(preset, activeRecipe);
  const edge = studioEdge(runRecipe.maxEdge);
  const started = performance.now();
  const engine = editor.removalEngine();
  let done = 0;
  status.textContent = `${preset.label}: preparing ${rows.length} image${rows.length === 1 ? '' : 's'}…`;
  render();
  for (let index = 0; index < rows.length; index += 1) {
    if (signal.aborted) break;
    const row = rows[index]; row.error = undefined;
    const prefix = `${index + 1} of ${rows.length}: ${row.file.name}`;
    status.textContent = `${prefix} — cutting out…`;
    try {
      const result = await presetImage(row.file, preset, engine, { format: runRecipe.format, quality: runRecipe.quality, maxEdge: runRecipe.maxEdge }, { signal, onStage: label => { status.textContent = `${prefix} — ${label}…`; }, reuse: row.matte });
      row.result = result; row.recipe = runRecipe; row.preset = preset.label; row.matte = result.matte ?? row.matte; refreshResultThumb(row); done += 1;
    } catch (error) {
      row.error = (error as DOMException).name === 'AbortError' ? 'Cancelled' : (error as Error).message;
      if ((error as DOMException).name === 'AbortError') break;
    }
    render();
    persistQueue();
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  status.textContent = signal.aborted
    ? `${preset.label}: cancelled after ${done} of ${rows.length}. Finished images are ready below.`
    : `Batch complete with ${preset.label}: ${done} of ${rows.length} exported · ${runRecipe.format.toUpperCase()} · ${Math.round(runRecipe.quality * 100)}% · ${edge !== runRecipe.maxEdge ? '2200 (Studio limit)' : runRecipe.label} · ${seconds} s. Original files are untouched.`;
}

async function run() {
  if (controller) return;
  const preset = selectedPreset();
  if (preset?.cutout && !hasAcknowledgedBgRemoval()) { status.textContent = 'Enable optional AI background removal first (below), or choose a preset without a cutout.'; presetAck.hidden = false; presetAckButton.focus(); return; }
  const activeRecipe = recipe();
  controller = new AbortController(); process.disabled = true; cancel.disabled = false;
  if (preset) await runPresetBatch(preset, activeRecipe, controller.signal); else await runOptimizeBatch(activeRecipe);
  controller = undefined; cancel.disabled = true; render();
}

async function runOne(row: Row) {
  if (controller) return;
  const preset = selectedPreset();
  if (preset?.cutout && !hasAcknowledgedBgRemoval()) { status.textContent = 'Enable optional AI background removal first (below), or choose a preset without a cutout.'; presetAck.hidden = false; presetAckButton.focus(); return; }
  const runRecipe = effectiveRecipe(preset, recipe());
  controller = new AbortController(); process.disabled = true; clearQueueButton.disabled = true; cancel.disabled = false; render();
  try {
    const result = preset
      ? await presetImage(row.file, preset, editor.removalEngine(), { format: runRecipe.format, quality: runRecipe.quality, maxEdge: runRecipe.maxEdge }, { signal: controller.signal, onStage: label => { status.textContent = `${row.file.name} — ${label}…`; }, reuse: row.matte })
      : await optimizeImage(row.file, options());
    row.result = result; row.recipe = runRecipe; row.preset = preset ? preset.label : undefined; row.error = undefined;
    if (preset) row.matte = (result as PresetImageResult).matte ?? row.matte;
    refreshResultThumb(row);
    status.textContent = `Reprocessed ${row.file.name}: ${result.width}×${result.height} · ${bytes(result.outputBytes)}.`;
  } catch (error) {
    row.error = (error as DOMException).name === 'AbortError' ? 'Cancelled' : (error as Error).message;
    status.textContent = `${row.file.name}: ${row.error}`;
  }
  controller = undefined; cancel.disabled = true; persistQueue(); render();
}

function applyPreset(name: string) {
  const recipes: Record<string, [OutputFormat, number, string]> = { smallest: ['webp', 58, '1024'], balanced: ['webp', 82, '2048'], high: ['png', 100, '4096'], product: ['webp', 85, '1024'], custom: [recipe().format, Math.round(recipe().quality * 100), 'custom'] };
  const [format, q, edge] = recipes[name];
  document.querySelector<HTMLInputElement>(`input[name="format"][value="${format}"]`)!.checked = true;
  quality.value = String(q);
  document.querySelector<HTMLInputElement>(`input[name="edge"][value="${edge}"]`)!.checked = true;
  updateControls(); render();
}

function showPanel(name: string) {
  document.querySelectorAll<HTMLElement>('[data-editor-panel]').forEach(panel => { panel.hidden = panel.dataset.editorPanel !== name; });
  document.querySelectorAll<HTMLButtonElement>('[data-panel-tab]').forEach(button => { button.classList.toggle('active', button.dataset.panelTab === name); });
}

function showExperience(name: 'quick' | 'studio') {
  const quick = name === 'quick';
  quickWorkspace.hidden = !quick;
  studioWorkspace.hidden = quick;
  quickMode.classList.toggle('active', quick);
  studioMode.classList.toggle('active', !quick);
  if (quick) { quickSettings.append(controls); }
  else { studioExport.append(controls, exportImage); showPanel('background'); }
}

input.addEventListener('change', () => { if (input.files) add(input.files); input.value = ''; });
[$('#drop-zone'), $('#quick-drop-zone')].forEach(zone => {
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('dragging'); if (event.dataTransfer?.files) add(event.dataTransfer.files); });
  zone.addEventListener('click', event => { if (!(event.target as HTMLElement).matches('input')) input.click(); });
  zone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') input.click(); });
});

document.querySelectorAll<HTMLInputElement>('input[name="format"], input[name="edge"], #quality, #custom-edge').forEach(control => { control.addEventListener('input', () => { updateControls(); render(); }); });
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => { button.addEventListener('click', () => applyPreset(button.dataset.preset!)); });
document.querySelectorAll<HTMLButtonElement>('[data-panel-tab]').forEach(button => { button.addEventListener('click', () => showPanel(button.dataset.panelTab!)); });
quickMode.addEventListener('click', () => showExperience('quick'));
studioMode.addEventListener('click', () => showExperience('studio'));
exportImage.addEventListener('click', exportEdited);
process.addEventListener('click', run);
cancel.addEventListener('click', () => controller?.abort());
presetSelect.addEventListener('change', () => { if (presetSelect.value === 'current' && !editor.hasPhoto()) { presetSelect.value = 'none'; status.textContent = 'Open a photo in Photo Studio first; its setup can then be applied to the queue.'; } syncPresetUi(); render(); });
presetAckButton.addEventListener('click', () => { acknowledgeBgRemoval(); editor.refreshGates(); syncPresetUi(); status.textContent = 'AI background removal is enabled for this browser. Press "Cut out & export batch" to run it on the queue.'; });

queue.addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const editIndex = Number(target.dataset.edit);
  if (!Number.isNaN(editIndex) && rows[editIndex]) { editor.load(rows[editIndex].file); exportImage.disabled = false; saveProjectButton.disabled = false; saveTemplateButton.disabled = false; currentProjectId = null; showExperience('studio'); showPanel('adjust'); status.textContent = `Editing ${rows[editIndex].file.name}.`; return; }
  const retryIndex = Number(target.closest<HTMLElement>('[data-retry]')?.dataset.retry);
  if (!Number.isNaN(retryIndex) && rows[retryIndex]) { void runOne(rows[retryIndex]); return; }
  const reprocessIndex = Number(target.closest<HTMLElement>('[data-reprocess]')?.dataset.reprocess);
  if (!Number.isNaN(reprocessIndex) && rows[reprocessIndex]) { if (controller) { status.textContent = 'A batch is running — cancel it or wait before reprocessing a single photo.'; return; } void runOne(rows[reprocessIndex]); return; }
  const copyIndex = Number(target.closest<HTMLElement>('[data-copy]')?.dataset.copy);
  if (!Number.isNaN(copyIndex) && rows[copyIndex]) { if (controller) { status.textContent = 'A batch is running — cancel it or wait before copying a photo.'; return; } const source = rows[copyIndex]; rows.splice(copyIndex + 1, 0, { file: source.file, preview: URL.createObjectURL(source.file), matte: source.matte }); persistQueue(); render(); status.textContent = `Copied ${source.file.name}. Process each copy with a different preset to compare them side by side.`; return; }
  const removeIndex = Number(target.closest<HTMLElement>('[data-remove]')?.dataset.remove);
  if (!Number.isNaN(removeIndex) && rows[removeIndex]) { if (controller) { status.textContent = 'A batch is running — cancel it or wait before removing a photo.'; return; } URL.revokeObjectURL(rows[removeIndex].preview); rows.splice(removeIndex, 1); persistQueue(); render(); status.textContent = 'Removed from the queue. Original files are untouched.'; return; }
  const index = Number(target.dataset.download);
  if (!Number.isNaN(index) && rows[index]?.result) download(rows[index].result!.blob, rows[index].result!.filename);

  const refineIndex = Number(target.dataset.refine);
  if (!Number.isNaN(refineIndex) && rows[refineIndex]) { void openRefineTool(rows[refineIndex], refineIndex); return; }
  const cleanupIndex = Number(target.dataset.cleanup);
  if (!Number.isNaN(cleanupIndex) && rows[cleanupIndex]) { void openCleanupTool(rows[cleanupIndex], cleanupIndex); return; }
  const acceptIndex = Number(target.closest<HTMLElement>('[data-ai-accept]')?.dataset.aiAccept ?? target.dataset.aiAccept);
  if (!Number.isNaN(acceptIndex) && rows[acceptIndex]) { const row = rows[acceptIndex]; if (row.aiTool === 'refine') void acceptRefine(row, acceptIndex); else if (row.aiTool === 'cleanup') void acceptCleanup(row, acceptIndex); return; }
  const rejectIndex = Number(target.closest<HTMLElement>('[data-ai-reject]')?.dataset.aiReject ?? target.dataset.aiReject);
  if (!Number.isNaN(rejectIndex) && rows[rejectIndex]) { const row = rows[rejectIndex]; if (row.aiTool === 'refine') rejectRefine(row, rejectIndex); else if (row.aiTool === 'cleanup') rejectCleanup(row, rejectIndex); return; }
  const altIndex = Number(target.closest<HTMLElement>('[data-ai-alt]')?.dataset.aiAlt ?? target.dataset.aiAlt);
  if (!Number.isNaN(altIndex) && rows[altIndex]) { altRefine(rows[altIndex], altIndex); return; }
  const clearIndex = Number(target.closest<HTMLElement>('[data-ai-clear]')?.dataset.aiClear ?? target.dataset.aiClear);
  if (!Number.isNaN(clearIndex) && rows[clearIndex]) { clearCleanupMask(rows[clearIndex]); setRowStatus(rows[clearIndex], clearIndex, 'Paint cleared.'); syncRowActions(rows[clearIndex], clearIndex); return; }
  const runIndex = Number(target.closest<HTMLElement>('[data-ai-run]')?.dataset.aiRun ?? target.dataset.aiRun);
  if (!Number.isNaN(runIndex) && rows[runIndex]) { void runCleanup(rows[runIndex], runIndex); return; }

  // Refine click on thumbnail
  const card = target.closest('.image-card') as HTMLElement | null;
  if (card && target.closest('.thumb.interactive')) {
    const editBtn = card.querySelector('[data-edit]') as HTMLElement | null;
    const index = Number(editBtn?.dataset.edit);
    if (!Number.isNaN(index) && rows[index]?.aiTool === 'refine' && rows[index].aiStage === 'idle') {
      const thumb = card.querySelector('.thumb')!;
      const rect = thumb.getBoundingClientRect();
      const clientX = (event as MouseEvent).clientX;
      const clientY = (event as MouseEvent).clientY;
      const scaleX = rows[index].refineSession?.width ?? 1 / (rect.width || 1);
      const scaleY = rows[index].refineSession?.height ?? 1 / (rect.height || 1);
      const x = Math.round((clientX - rect.left) * scaleX);
      const y = Math.round((clientY - rect.top) * scaleY);
      void refineClick(rows[index], index, x, y, (event as MouseEvent).shiftKey);
      return;
    }
    // Cleanup paint
    if (!Number.isNaN(index) && rows[index]?.aiTool === 'cleanup' && rows[index].aiStage === 'idle' && !rows[index].cleanupPending) {
      const thumb = card.querySelector('.thumb')!;
      const rect = thumb.getBoundingClientRect();
      const clientX = (event as MouseEvent).clientX;
      const clientY = (event as MouseEvent).clientY;
      const scaleX = rows[index].cleanupMask?.canvas.width ?? 1 / (rect.width || 1);
      const scaleY = rows[index].cleanupMask?.canvas.height ?? 1 / (rect.height || 1);
      const x = Math.round((clientX - rect.left) * scaleX);
      const y = Math.round((clientY - rect.top) * scaleY);
      if (!(rows[index].cleanupMask?.painted)) rows[index].cleanupMask = rows[index].cleanupMask ?? { canvas: document.createElement('canvas'), ctx: document.createElement('canvas').getContext('2d')!, key: '', painted: false };
      cleanupStroke(rows[index], { x, y }, { x, y });
      return;
    }
  }
});

queue.addEventListener('mousemove', event => {
  const card = (event.target as HTMLElement).closest('.image-card') as HTMLElement | null;
  if (!card) return;
  const editBtn = card.querySelector('[data-edit]') as HTMLElement | null;
  const index = Number(editBtn?.dataset.edit);
  if (Number.isNaN(index) || !rows[index]) return;
  if (rows[index].aiTool === 'cleanup' && rows[index].aiStage === 'idle' && !rows[index].cleanupPending && rows[index].cleanupMask) {
    const thumb = card.querySelector('.thumb')!;
    const rect = thumb.getBoundingClientRect();
    const clientX = (event as MouseEvent).clientX;
    const clientY = (event as MouseEvent).clientY;
    const scaleX = rows[index].cleanupMask.canvas.width / (rect.width || 1);
    const scaleY = rows[index].cleanupMask.canvas.height / (rect.height || 1);
    const x = Math.round((clientX - rect.left) * scaleX);
    const y = Math.round((clientY - rect.top) * scaleY);
    cleanupStroke(rows[index], { x: rows[index].cleanupMask.canvas.width / 2, y: rows[index].cleanupMask.canvas.height / 2 }, { x, y }); // simplified - needs proper last point tracking
  }
});

queue.addEventListener('mouseup', () => {
  // Cleanup painting ends on mouseup anywhere
});

downloadAll.addEventListener('click', () => rows.forEach(row => { if (row.result) download(row.result.blob, row.result.filename); }));
$('#theme-toggle').addEventListener('click', () => { const light = document.body.classList.toggle('light'); $('#theme-toggle').setAttribute('aria-label', light ? 'Switch to dark appearance' : 'Switch to light appearance'); });

async function refreshProjects() {
  const projects = await listProjects();
  projectList.innerHTML = projects.length ? projects.map(project => `<li><div><strong title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</strong><small>${escapeHtml(project.fileName)} · ${project.width}×${project.height}${project.hasMatte ? ' · cutout' : ''} · ${new Date(project.updatedAt).toLocaleDateString()}</small></div><div class="tool-buttons"><button type="button" data-open-project="${project.id}">Open</button><button type="button" data-delete-project="${project.id}">Delete</button></div></li>`).join('') : '<li class="hint">No saved projects yet.</li>';
}

const backdropKindLabel = (kind: string) => kind === 'image' ? 'image backdrop' : kind === 'gradient' ? 'gradient backdrop' : kind === 'color' ? 'solid backdrop' : 'transparent';

async function refreshTemplates() {
  templateCache = await listTemplates();
  templateList.innerHTML = templateCache.length ? templateCache.map(template => `<li><div><strong title="${escapeHtml(template.name)}">${escapeHtml(template.name)}</strong><small>${backdropKindLabel(template.data.backdrop.kind)} · ${new Date(template.updatedAt).toLocaleDateString()}</small></div><div class="tool-buttons"><button type="button" data-apply-template="${template.id}">Apply</button><button type="button" data-delete-template="${template.id}">Delete</button></div></li>`).join('') : '<li class="hint">No saved templates yet.</li>';
  const group = document.querySelector<HTMLOptGroupElement>('#template-options')!;
  group.innerHTML = templateCache.length ? templateCache.map(template => `<option value="${templateValue(template.id)}">${escapeHtml(template.name)}</option>`).join('') : '<option value="none" disabled>No saved templates yet</option>';
}

saveTemplateButton.addEventListener('click', async () => {
  const data = await editor.captureTemplate();
  if (!data) { status.textContent = 'Choose an image to save a look from first.'; return; }
  const now = Date.now();
  const template: StoredTemplate = { id: crypto.randomUUID(), name: templateNameInput.value.trim() || `My look ${new Date(now).toLocaleDateString()}`, createdAt: now, updatedAt: now, data };
  try {
    await putTemplate(template);
    await refreshTemplates();
    status.textContent = `Saved template "${template.name}". Apply it to any photo here, or pick it in Quick Optimize's batch preset list.`;
  } catch (error) {
    status.textContent = `The template could not be saved: ${(error as Error).message}`;
  }
});

templateList.addEventListener('click', async event => {
  const target = event.target as HTMLElement;
  const applyId = target.closest<HTMLElement>('[data-apply-template]')?.dataset.applyTemplate;
  if (applyId) {
    const stored = templateCache.find(template => template.id === applyId);
    if (!stored) { status.textContent = 'That template is no longer saved.'; return; }
    if (editor.pendingPreview()) { status.textContent = 'Accept or reject the AI preview before applying a template.'; return; }
    const applied = await editor.applyTemplate(stored.data);
    status.textContent = applied ? `Applied "${stored.name}" to ${document.querySelector('#editor-file')?.textContent ?? 'the photo'}.` : 'Choose an image to apply a template first.';
    return;
  }
  const deleteId = target.closest<HTMLElement>('[data-delete-template]')?.dataset.deleteTemplate;
  if (deleteId) {
    await deleteTemplate(deleteId);
    if (presetSelect.value === templateValue(deleteId)) { presetSelect.value = 'none'; syncPresetUi(); render(); }
    await refreshTemplates();
    status.textContent = 'Template deleted.';
  }
});

clearQueueButton.addEventListener('click', () => { rows.forEach(row => { URL.revokeObjectURL(row.preview); }); rows.length = 0; persistQueue(); render(); status.textContent = 'Queue cleared. Add images to begin.'; });

saveProjectButton.addEventListener('click', async () => {
  if (editor.pendingPreview()) { status.textContent = 'Accept or reject the AI preview before saving.'; return; }
  const data = await editor.captureProject();
  if (!data) { status.textContent = 'Choose an image to save first.'; return; }
  const now = Date.now();
  let createdAt = now;
  if (currentProjectId) { const existing = await getProject(currentProjectId); if (existing) createdAt = existing.createdAt; }
  const project: StoredProject = { id: currentProjectId ?? crypto.randomUUID(), name: projectNameInput.value.trim() || data.fileName, createdAt, updatedAt: now, data };
  try {
    await putProject(project);
    currentProjectId = project.id;
    status.textContent = `Saved "${project.name}" in this browser. Reopen it from the list below, even after a reload.`;
    await refreshProjects();
  } catch (error) {
    status.textContent = `The project could not be saved: ${(error as Error).message}`;
  }
});

projectList.addEventListener('click', async event => {
  const target = event.target as HTMLElement;
  const openId = target.closest<HTMLElement>('[data-open-project]')?.dataset.openProject;
  if (openId) {
    const stored = await getProject(openId);
    if (!stored) { status.textContent = 'That project could not be read in this browser.'; return; }
    if (editor.pendingPreview()) { status.textContent = 'Accept or reject the AI preview before opening another project.'; return; }
    const opened = await editor.applyProject(stored.data);
    if (!opened) { status.textContent = 'That project could not be opened.'; return; }
    currentProjectId = stored.id;
    projectNameInput.value = stored.name;
    exportImage.disabled = false;
    saveProjectButton.disabled = false;
    saveTemplateButton.disabled = false;
    showExperience('studio');
    showPanel('export');
    status.textContent = `Opened "${stored.name}" — cutout, edits and scene restored exactly as saved.`;
    return;
  }
  const deleteId = target.closest<HTMLElement>('[data-delete-project]')?.dataset.deleteProject;
  if (deleteId) {
    await deleteProject(deleteId);
    if (currentProjectId === deleteId) currentProjectId = null;
    status.textContent = 'Project deleted from this browser.';
    await refreshProjects();
  }
});

if (import.meta.env.DEV) Object.assign(window, { __batch: { rows: () => rows.map(row => ({ name: row.file.name, preset: row.preset ?? null, error: row.error ?? null, result: row.result && { width: row.result.width, height: row.result.height, bytes: row.result.outputBytes, format: row.result.format, type: row.result.blob.type, timings: (row.result as { timings?: unknown }).timings ?? null, matteReused: (row.result as { matteReused?: boolean }).matteReused === true } })), file: async (index: number) => { const blob = rows[index]?.result?.blob; if (!blob) return null; const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return { type: blob.type, base64: btoa(binary) }; } } });

updateControls(); syncPresetUi(); showExperience('quick');
restoreQueue().catch(error => { status.textContent = `The saved queue could not be restored: ${(error as Error).message}`; });
refreshProjects().catch(() => {});
refreshTemplates().catch(() => {});