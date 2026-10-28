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
import './style.css';

type Recipe = { format: OutputFormat; quality: number; maxEdge: number; label: string };
type Row = { file: File; result?: ImageResult & { matteReused?: boolean }; error?: string; preview: string; recipe?: Recipe; preset?: string; thumb?: string; matte?: { blob: Blob; key: string } };
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
const bytes = (n: number) => n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!));
const selected = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!;
function recipe(): Recipe { const edge = selected('edge').value; const maxEdge = edge === 'custom' ? Math.max(1, Number(customEdge.value) || 1) : Number(edge); const label = edge === '0' ? 'Original' : edge === 'custom' ? `${maxEdge}px` : `${Number(edge) / 1024}K`; return { format: selected('format').value as OutputFormat, quality: Number(quality.value) / 100, maxEdge, label }; }
function options(): OptimizeOptions { const r = recipe(); return { format: r.format, quality: r.quality, maxEdge: r.maxEdge, signal: controller?.signal }; }
function currentLabel() { const r = recipe(); return `${r.format.toUpperCase()} · ${Math.round(r.quality * 100)}% · ${r.label}`; }

/** A combined preset's bundled recipe replaces the shared export settings for that run. */
function effectiveRecipe(preset: BatchPreset | undefined, active: Recipe): Recipe {
  if (!preset?.recipe) return active;
  const { format, quality, maxEdge } = preset.recipe;
  const label = maxEdge >= 1024 && maxEdge % 1024 === 0 ? `${maxEdge / 1024}K` : `${maxEdge}px`;
  return { format, quality, maxEdge, label };
}

const RESULT_THUMB_EDGE = 96;
/** Small data-URL thumbnail of the processed result, so cards show the output for preset comparison. */
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
function updateControls() { const r = recipe(); $('#quality-value').textContent = `${Math.round(r.quality * 100)}%`; $('#current-recipe').textContent = currentLabel(); exportImage.textContent = `Export ${r.format.toUpperCase()} · ${r.label}`; $('#custom-edge-wrap').hidden = selected('edge').value !== 'custom'; $('#format-note').textContent = r.format === 'jpeg' ? 'JPEG fills transparent pixels with white.' : `${r.format.toUpperCase()} preserves transparency where the browser supports it.`; }
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function renderStats() { const completed = rows.filter(row => row.result); const el = $('#batch-stats'); el.hidden = !completed.length; if (!completed.length) return; const original = completed.reduce((sum, row) => sum + row.result!.sourceBytes, 0), output = completed.reduce((sum, row) => sum + row.result!.outputBytes, 0); const saving = Math.round((1 - output / original) * 100); el.innerHTML = `<div><small>Processed</small><strong>${completed.length} / ${rows.length}</strong></div><div><small>Original total</small><strong>${bytes(original)}</strong></div><div><small>Optimized total</small><strong>${bytes(output)}</strong></div><div><small>Saved</small><strong>${saving >= 0 ? `${saving}%` : '—'}</strong></div>`; }
function render() { queue.innerHTML = rows.map((row, i) => { const result = row.result; const delta = result ? Math.round((1 - result.outputBytes / result.sourceBytes) * 100) : 0; return `<article class="image-card ${result ? 'done' : ''}"><div class="thumb"><img src="${row.thumb ?? row.preview}" alt="${row.thumb ? 'Processed result for' : 'Preview of'} ${escapeHtml(row.file.name)}" />${result ? `<span>${result.width}×${result.height}</span>` : ''}</div><div class="image-info"><strong title="${escapeHtml(row.file.name)}">${escapeHtml(row.file.name)}</strong><p>${bytes(row.file.size)}${result ? ` <i>→</i> ${bytes(result.outputBytes)} <b>${delta >= 0 ? `${delta}% smaller` : `${Math.abs(delta)}% larger`}</b>` : ''}</p><small>${result ? `${row.recipe ? `Processed with ${escapeHtml(row.recipe.format.toUpperCase())} · ${Math.round(row.recipe.quality * 100)}% · ${escapeHtml(row.recipe.label)}` : 'Processed in an earlier session'}${row.preset ? ` · ${escapeHtml(row.preset)}` : ''}${result.matteReused ? ' · cutout reused' : ''}` : row.error || `Ready · current recipe: ${currentLabel()}`}</small></div><div class="card-actions"><button class="download" data-edit="${i}">Edit</button>${result ? `<button class="download" data-reprocess="${i}" title="Re-run this photo with the current recipe and preset">Reprocess</button><button class="download" data-download="${i}">Download</button>` : ''}${row.error ? `<button class="download" data-retry="${i}">Retry</button>` : !result ? `<button class="download" data-reprocess="${i}" title="Process just this photo with the current recipe and preset">Process</button>` : ''}<button class="download" data-copy="${i}" title="Duplicate this photo so you can compare two presets">Copy</button><button class="download" data-remove="${i}" title="Remove from queue" aria-label="Remove ${escapeHtml(row.file.name)} from the queue">✕</button></div></article>`; }).join(''); $('#image-count').textContent = String(rows.length); process.disabled = !rows.length || !!controller; clearQueueButton.disabled = !rows.length || !!controller; downloadAll.disabled = !rows.some(row => row.result); renderStats(); }
function add(files: FileList | File[]) { const candidates = Array.from(files); const allowed = candidates.filter(file => !inputIssue(file)); const rejected = candidates.map(inputIssue).find(Boolean); if (allowed.length && !rows.length) editor.load(allowed[0]); if (allowed.length) { exportImage.disabled = false; saveProjectButton.disabled = false; saveTemplateButton.disabled = false; } currentProjectId = null; allowed.forEach(file => { rows.push({ file, preview: URL.createObjectURL(file) }); }); persistQueue(); status.textContent = allowed.length ? `${rows.length} image${rows.length === 1 ? '' : 's'} queued. Current recipe: ${currentLabel()}.` : rejected || 'Choose JPEG, PNG, or WebP images.'; render(); }

/** Queue persistence: written immediately on every change. Blob fields are stored as references,
 *  so a write is cheap; debouncing here proved unsafe — a burst of row updates could starve the
 *  timer until a reload killed the pending write and lost the whole batch. */
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
async function exportEdited() { if (editor.pendingPreview()) { status.textContent = 'Accept or reject the AI preview before exporting.'; return; } const edited = await editor.exportFile(); if (!edited) { status.textContent = 'Choose an image to export first.'; return; } exportImage.disabled = true; const activeRecipe = recipe(); const maxEdge = studioEdge(activeRecipe.maxEdge); try { const result = await optimizeImage(edited, { format: activeRecipe.format, quality: activeRecipe.quality, maxEdge }); download(result.blob, result.filename); status.textContent = `Exported ${result.filename}: ${result.width}×${result.height} · ${bytes(result.outputBytes)} with ${activeRecipe.format.toUpperCase()} · ${Math.round(activeRecipe.quality * 100)}% · ${maxEdge !== activeRecipe.maxEdge ? `2200 (Studio limit)` : activeRecipe.label}.`; } catch { status.textContent = 'The edited image could not be exported.'; } finally { exportImage.disabled = false; } }
function selectedPreset(): BatchPreset | undefined {
  const value = presetSelect.value;
  if (value === 'none') return undefined;
  if (value === 'current') { const look = editor.captureLook(); return look ? presetFromLook(look) : undefined; }
  const templateId = templateIdFromValue(value);
  if (templateId) {
    const stored = templateCache.find(template => template.id === templateId);
    if (!stored) return undefined;
    const preset = templateToPreset(stored);
    // The saved backdrop URL died with the previous page; give the blob a fresh one the runner can decode.
    if (preset.backdrop.kind === 'image' && stored.data.backdropImage) preset.backdrop = { kind: 'image', url: URL.createObjectURL(stored.data.backdropImage), fit: preset.backdrop.fit };
    return preset;
  }
  return builtInPreset(value);
}
function syncPresetUi() { const preset = selectedPreset(); const gate = !!preset?.cutout && !hasAcknowledgedBgRemoval(); presetAck.hidden = !gate; if (gate) presetAckText.textContent = BG_REMOVAL_NOTICE; presetHint.textContent = presetDescription(preset); process.textContent = preset?.cutout ? 'Cut out & export batch' : 'Export batch'; }
async function runOptimizeBatch(activeRecipe: Recipe) { status.textContent = `Optimizing ${rows.length} images with ${currentLabel()}…`; render(); await optimizeBatch(rows.map(row => row.file), options(), event => { const row = rows[event.index]; if (event.result) { row.result = event.result; row.recipe = activeRecipe; row.preset = undefined; row.error = undefined; refreshResultThumb(row); } if (event.error) row.error = event.error.name === 'AbortError' ? 'Cancelled' : event.error.message; status.textContent = `Processed ${event.completed} of ${event.total}: ${event.filename}`; persistQueue(); render(); }).catch(error => { status.textContent = (error as DOMException).name === 'AbortError' ? 'Processing cancelled. Completed images are available below.' : 'Some images could not be processed.'; }); if (rows.some(row => row.result)) status.textContent = `Batch complete. These images used ${activeRecipe.format.toUpperCase()} · ${Math.round(activeRecipe.quality * 100)}% · ${activeRecipe.label}; current controls may differ.`; persistQueue(); }
async function runPresetBatch(preset: BatchPreset, activeRecipe: Recipe, signal: AbortSignal) {
  const runRecipe = effectiveRecipe(preset, activeRecipe);
  const edge = studioEdge(runRecipe.maxEdge); const started = performance.now(); const engine = editor.removalEngine(); let done = 0;
  status.textContent = `${preset.label}: preparing ${rows.length} image${rows.length === 1 ? '' : 's'}…`; render();
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

/** Reprocesses a single row (Retry / Reprocess / Process) with the current recipe and preset. */
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
function applyPreset(name: string) { const recipes: Record<string, [OutputFormat, number, string]> = { smallest: ['webp', 58, '1024'], balanced: ['webp', 82, '2048'], high: ['png', 100, '4096'], product: ['webp', 85, '1024'], custom: [recipe().format, Math.round(recipe().quality * 100), 'custom'] }; const [format, q, edge] = recipes[name]; document.querySelector<HTMLInputElement>(`input[name="format"][value="${format}"]`)!.checked = true; quality.value = String(q); document.querySelector<HTMLInputElement>(`input[name="edge"][value="${edge}"]`)!.checked = true; updateControls(); render(); }
function showPanel(name: string) { document.querySelectorAll<HTMLElement>('[data-editor-panel]').forEach(panel => { panel.hidden = panel.dataset.editorPanel !== name; }); document.querySelectorAll<HTMLButtonElement>('[data-panel-tab]').forEach(button => { button.classList.toggle('active', button.dataset.panelTab === name); }); }
function showExperience(name: 'quick' | 'studio') {
  const quick = name === 'quick';
  quickWorkspace.hidden = !quick;
  studioWorkspace.hidden = quick;
  quickMode.classList.toggle('active', quick);
  studioMode.classList.toggle('active', !quick);
  if (quick) {
    quickSettings.append(controls);
  } else {
    studioExport.append(controls, exportImage);
    showPanel('background');
  }
}
input.addEventListener('change', () => { if (input.files) add(input.files); input.value = ''; });
[$('#drop-zone'), $('#quick-drop-zone')].forEach(zone => { zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragging'); }); zone.addEventListener('dragleave', () => zone.classList.remove('dragging')); zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('dragging'); if (event.dataTransfer?.files) add(event.dataTransfer.files); }); zone.addEventListener('click', event => { if (!(event.target as HTMLElement).matches('input')) input.click(); }); zone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') input.click(); }); });
document.querySelectorAll<HTMLInputElement>('input[name="format"], input[name="edge"], #quality, #custom-edge').forEach(control => { control.addEventListener('input', () => { updateControls(); render(); }); }); document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => { button.addEventListener('click', () => applyPreset(button.dataset.preset!)); }); document.querySelectorAll<HTMLButtonElement>('[data-panel-tab]').forEach(button => { button.addEventListener('click', () => showPanel(button.dataset.panelTab!)); }); quickMode.addEventListener('click', () => showExperience('quick')); studioMode.addEventListener('click', () => showExperience('studio')); exportImage.addEventListener('click', exportEdited); process.addEventListener('click', run); cancel.addEventListener('click', () => controller?.abort()); presetSelect.addEventListener('change', () => { if (presetSelect.value === 'current' && !editor.hasPhoto()) { presetSelect.value = 'none'; status.textContent = 'Open a photo in Photo Studio first; its setup can then be applied to the queue.'; } syncPresetUi(); render(); }); presetAckButton.addEventListener('click', () => { acknowledgeBgRemoval(); editor.refreshGates(); syncPresetUi(); status.textContent = 'AI background removal is enabled for this browser. Press “Cut out & export batch” to run it on the queue.'; }); queue.addEventListener('click', event => { const target = event.target as HTMLElement; const editIndex = Number(target.dataset.edit); if (!Number.isNaN(editIndex) && rows[editIndex]) { editor.load(rows[editIndex].file); exportImage.disabled = false; saveProjectButton.disabled = false; saveTemplateButton.disabled = false; currentProjectId = null; showExperience('studio'); showPanel('adjust'); status.textContent = `Editing ${rows[editIndex].file.name}.`; return; } const retryIndex = Number(target.closest<HTMLElement>('[data-retry]')?.dataset.retry); if (!Number.isNaN(retryIndex) && rows[retryIndex]) { void runOne(rows[retryIndex]); return; } const reprocessIndex = Number(target.closest<HTMLElement>('[data-reprocess]')?.dataset.reprocess); if (!Number.isNaN(reprocessIndex) && rows[reprocessIndex]) { if (controller) { status.textContent = 'A batch is running — cancel it or wait before reprocessing a single photo.'; return; } void runOne(rows[reprocessIndex]); return; } const copyIndex = Number(target.closest<HTMLElement>('[data-copy]')?.dataset.copy); if (!Number.isNaN(copyIndex) && rows[copyIndex]) { if (controller) { status.textContent = 'A batch is running — cancel it or wait before copying a photo.'; return; } const source = rows[copyIndex]; rows.splice(copyIndex + 1, 0, { file: source.file, preview: URL.createObjectURL(source.file), matte: source.matte }); persistQueue(); render(); status.textContent = `Copied ${source.file.name}. Process each copy with a different preset to compare them side by side.`; return; } const removeIndex = Number(target.closest<HTMLElement>('[data-remove]')?.dataset.remove); if (!Number.isNaN(removeIndex) && rows[removeIndex]) { if (controller) { status.textContent = 'A batch is running — cancel it or wait before removing a photo.'; return; } URL.revokeObjectURL(rows[removeIndex].preview); rows.splice(removeIndex, 1); persistQueue(); render(); status.textContent = 'Removed from the queue. Original files are untouched.'; return; } const index = Number(target.dataset.download); if (!Number.isNaN(index) && rows[index]?.result) download(rows[index].result!.blob, rows[index].result!.filename); }); downloadAll.addEventListener('click', () => rows.forEach(row => { if (row.result) download(row.result.blob, row.result.filename); })); $('#theme-toggle').addEventListener('click', () => { const light = document.body.classList.toggle('light'); $('#theme-toggle').setAttribute('aria-label', light ? 'Switch to dark appearance' : 'Switch to light appearance'); }); async function refreshProjects() {
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
if (import.meta.env.DEV) Object.assign(window, { __batch: { rows: () => rows.map(row => ({ name: row.file.name, preset: row.preset ?? null, error: row.error ?? null, result: row.result && { width: row.result.width, height: row.result.height, bytes: row.result.outputBytes, format: row.result.format, type: row.result.blob.type, timings: (row.result as { timings?: unknown }).timings ?? null, matteReused: (row.result as { matteReused?: boolean }).matteReused === true } })), file: async (index: number) => { const blob = rows[index]?.result?.blob; if (!blob) return null; const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return { type: blob.type, base64: btoa(binary) }; } } }); updateControls(); syncPresetUi(); showExperience('quick');
restoreQueue().catch(error => { status.textContent = `The saved queue could not be restored: ${(error as Error).message}`; });
refreshProjects().catch(() => {});
refreshTemplates().catch(() => {});
