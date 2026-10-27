import { inputIssue, optimizeBatch, optimizeImage, type ImageResult, type OptimizeOptions, type OutputFormat } from './engine';
import { initEditor } from './editor/controller';
import { studioEdge } from './editor/tools';
import { builtInPreset, presetDescription, presetFromLook, type BatchPreset } from './batch/presets';
import { presetImage } from './batch/run';
import { acknowledgeBgRemoval, BG_REMOVAL_NOTICE, hasAcknowledgedBgRemoval } from './bgremove';
import { deleteProject, getProject, listProjects, putProject } from './storage/idb';
import type { StoredProject } from './editor/projects';
import './style.css';

type Recipe = { format: OutputFormat; quality: number; maxEdge: number; label: string };
type Row = { file: File; result?: ImageResult; error?: string; preview: string; recipe?: Recipe; preset?: string };
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = $('#file-input') as HTMLInputElement, queue = $('#queue'), status = $('#status');
const quality = $('#quality') as HTMLInputElement, customEdge = $('#custom-edge') as HTMLInputElement;
const process = $('#process') as HTMLButtonElement, cancel = $('#cancel') as HTMLButtonElement, downloadAll = $('#download-all') as HTMLButtonElement, exportImage = $('#export-image') as HTMLButtonElement;
const presetSelect = $('#batch-preset-select') as HTMLSelectElement, presetHint = $('#batch-preset-hint'), presetAck = $('#batch-ack'), presetAckText = $('#batch-ack-text'), presetAckButton = $('#batch-ack-button') as HTMLButtonElement;
const saveProjectButton = $('#save-project') as HTMLButtonElement, projectNameInput = $('#project-name') as HTMLInputElement, projectList = $('#project-list');
let currentProjectId: string | null = null;
const rows: Row[] = []; let controller: AbortController | undefined;
const editor = initEditor();
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
function updateControls() { const r = recipe(); $('#quality-value').textContent = `${Math.round(r.quality * 100)}%`; $('#current-recipe').textContent = currentLabel(); exportImage.textContent = `Export ${r.format.toUpperCase()} · ${r.label}`; $('#custom-edge-wrap').hidden = selected('edge').value !== 'custom'; $('#format-note').textContent = r.format === 'jpeg' ? 'JPEG fills transparent pixels with white.' : `${r.format.toUpperCase()} preserves transparency where the browser supports it.`; }
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function renderStats() { const completed = rows.filter(row => row.result); const el = $('#batch-stats'); el.hidden = !completed.length; if (!completed.length) return; const original = completed.reduce((sum, row) => sum + row.result!.sourceBytes, 0), output = completed.reduce((sum, row) => sum + row.result!.outputBytes, 0); const saving = Math.round((1 - output / original) * 100); el.innerHTML = `<div><small>Processed</small><strong>${completed.length} / ${rows.length}</strong></div><div><small>Original total</small><strong>${bytes(original)}</strong></div><div><small>Optimized total</small><strong>${bytes(output)}</strong></div><div><small>Saved</small><strong>${saving >= 0 ? `${saving}%` : '—'}</strong></div>`; }
function render() { queue.innerHTML = rows.map((row, i) => { const result = row.result; const delta = result ? Math.round((1 - result.outputBytes / result.sourceBytes) * 100) : 0; return `<article class="image-card ${result ? 'done' : ''}"><div class="thumb"><img src="${row.preview}" alt="Preview of ${escapeHtml(row.file.name)}" />${result ? `<span>${result.width}×${result.height}</span>` : ''}</div><div class="image-info"><strong title="${escapeHtml(row.file.name)}">${escapeHtml(row.file.name)}</strong><p>${bytes(row.file.size)}${result ? ` <i>→</i> ${bytes(result.outputBytes)} <b>${delta >= 0 ? `${delta}% smaller` : `${Math.abs(delta)}% larger`}</b>` : ''}</p><small>${result ? `Processed with ${escapeHtml(row.recipe!.format.toUpperCase())} · ${Math.round(row.recipe!.quality * 100)}% · ${escapeHtml(row.recipe!.label)}${row.preset ? ` · ${escapeHtml(row.preset)}` : ''}` : row.error || `Ready · current recipe: ${currentLabel()}`}</small></div><div class="card-actions"><button class="download" data-edit="${i}">Edit</button>${result ? `<button class="download" data-download="${i}">Download</button>` : '<span class="queued">Queued</span>'}</div></article>`; }).join(''); $('#image-count').textContent = String(rows.length); process.disabled = !rows.length || !!controller; downloadAll.disabled = !rows.some(row => row.result); renderStats(); }
function add(files: FileList | File[]) { const candidates = Array.from(files); const allowed = candidates.filter(file => !inputIssue(file)); const rejected = candidates.map(inputIssue).find(Boolean); if (allowed.length && !rows.length) editor.load(allowed[0]); if (allowed.length) { exportImage.disabled = false; saveProjectButton.disabled = false; } currentProjectId = null; allowed.forEach(file => rows.push({ file, preview: URL.createObjectURL(file) })); status.textContent = allowed.length ? `${rows.length} image${rows.length === 1 ? '' : 's'} queued. Current recipe: ${currentLabel()}.` : rejected || 'Choose JPEG, PNG, or WebP images.'; render(); }
async function exportEdited() { if (editor.pendingPreview()) { status.textContent = 'Accept or reject the AI preview before exporting.'; return; } const edited = await editor.exportFile(); if (!edited) { status.textContent = 'Choose an image to export first.'; return; } exportImage.disabled = true; const activeRecipe = recipe(); const maxEdge = studioEdge(activeRecipe.maxEdge); try { const result = await optimizeImage(edited, { format: activeRecipe.format, quality: activeRecipe.quality, maxEdge }); download(result.blob, result.filename); status.textContent = `Exported ${result.filename}: ${result.width}×${result.height} · ${bytes(result.outputBytes)} with ${activeRecipe.format.toUpperCase()} · ${Math.round(activeRecipe.quality * 100)}% · ${maxEdge !== activeRecipe.maxEdge ? `2K (Studio limit)` : activeRecipe.label}.`; } catch { status.textContent = 'The edited image could not be exported.'; } finally { exportImage.disabled = false; } }
function selectedPreset(): BatchPreset | undefined {
  if (presetSelect.value === 'none') return undefined;
  if (presetSelect.value === 'current') { const look = editor.captureLook(); return look ? presetFromLook(look) : undefined; }
  return builtInPreset(presetSelect.value);
}
function syncPresetUi() { const preset = selectedPreset(); const gate = !!preset?.cutout && !hasAcknowledgedBgRemoval(); presetAck.hidden = !gate; if (gate) presetAckText.textContent = BG_REMOVAL_NOTICE; presetHint.textContent = presetDescription(preset); process.textContent = preset?.cutout ? 'Cut out & export batch' : 'Export batch'; }
async function runOptimizeBatch(activeRecipe: Recipe) { status.textContent = `Optimizing ${rows.length} images with ${currentLabel()}…`; render(); await optimizeBatch(rows.map(row => row.file), options(), event => { const row = rows[event.index]; if (event.result) { row.result = event.result; row.recipe = activeRecipe; } if (event.error) row.error = event.error.name === 'AbortError' ? 'Cancelled' : event.error.message; status.textContent = `Processed ${event.completed} of ${event.total}: ${event.filename}`; render(); }).catch(error => { status.textContent = (error as DOMException).name === 'AbortError' ? 'Processing cancelled. Completed images are available below.' : 'Some images could not be processed.'; }); if (rows.some(row => row.result)) status.textContent = `Batch complete. These images used ${activeRecipe.format.toUpperCase()} · ${Math.round(activeRecipe.quality * 100)}% · ${activeRecipe.label}; current controls may differ.`; }
async function runPresetBatch(preset: BatchPreset, activeRecipe: Recipe, signal: AbortSignal) {
  const edge = studioEdge(activeRecipe.maxEdge); const started = performance.now(); const engine = editor.removalEngine(); let done = 0;
  status.textContent = `${preset.label}: preparing ${rows.length} image${rows.length === 1 ? '' : 's'}…`; render();
  for (let index = 0; index < rows.length; index += 1) {
    if (signal.aborted) break;
    const row = rows[index]; row.error = undefined;
    const prefix = `${index + 1} of ${rows.length}: ${row.file.name}`;
    status.textContent = `${prefix} — cutting out…`;
    try {
      const result = await presetImage(row.file, preset, engine, { format: activeRecipe.format, quality: activeRecipe.quality, maxEdge: activeRecipe.maxEdge }, { signal, onStage: label => { status.textContent = `${prefix} — ${label}…`; } });
      row.result = result; row.recipe = activeRecipe; row.preset = preset.label; done += 1;
    } catch (error) {
      row.error = (error as DOMException).name === 'AbortError' ? 'Cancelled' : (error as Error).message;
      if ((error as DOMException).name === 'AbortError') break;
    }
    render();
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  status.textContent = signal.aborted
    ? `${preset.label}: cancelled after ${done} of ${rows.length}. Finished images are ready below.`
    : `Batch complete with ${preset.label}: ${done} of ${rows.length} exported · ${activeRecipe.format.toUpperCase()} · ${Math.round(activeRecipe.quality * 100)}% · ${edge !== activeRecipe.maxEdge ? '2K (Studio limit)' : activeRecipe.label} · ${seconds} s. Original files are untouched.`;
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
function applyPreset(name: string) { const recipes: Record<string, [OutputFormat, number, string]> = { smallest: ['webp', 58, '1024'], balanced: ['webp', 82, '2048'], high: ['png', 100, '4096'], product: ['webp', 85, '1024'], custom: [recipe().format, Math.round(recipe().quality * 100), 'custom'] }; const [format, q, edge] = recipes[name]; document.querySelector<HTMLInputElement>(`input[name="format"][value="${format}"]`)!.checked = true; quality.value = String(q); document.querySelector<HTMLInputElement>(`input[name="edge"][value="${edge}"]`)!.checked = true; updateControls(); render(); }
function showPanel(name: string) { document.querySelectorAll<HTMLElement>('[data-editor-panel]').forEach(panel => panel.hidden = panel.dataset.editorPanel !== name); document.querySelectorAll<HTMLButtonElement>('[data-panel-tab]').forEach(button => button.classList.toggle('active', button.dataset.panelTab === name)); }
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
document.querySelectorAll<HTMLInputElement>('input[name="format"], input[name="edge"], #quality, #custom-edge').forEach(control => control.addEventListener('input', () => { updateControls(); render(); })); document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.preset!))); document.querySelectorAll<HTMLButtonElement>('[data-panel-tab]').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.panelTab!))); quickMode.addEventListener('click', () => showExperience('quick')); studioMode.addEventListener('click', () => showExperience('studio')); exportImage.addEventListener('click', exportEdited); process.addEventListener('click', run); cancel.addEventListener('click', () => controller?.abort()); presetSelect.addEventListener('change', () => { if (presetSelect.value === 'current' && !editor.hasPhoto()) { presetSelect.value = 'none'; status.textContent = 'Open a photo in Photo Studio first; its setup can then be applied to the queue.'; } syncPresetUi(); render(); }); presetAckButton.addEventListener('click', () => { acknowledgeBgRemoval(); editor.refreshGates(); syncPresetUi(); status.textContent = 'AI background removal is enabled for this browser. Press “Cut out & export batch” to run it on the queue.'; }); queue.addEventListener('click', event => { const target = event.target as HTMLElement; const editIndex = Number(target.dataset.edit); if (!Number.isNaN(editIndex) && rows[editIndex]) { editor.load(rows[editIndex].file); exportImage.disabled = false; saveProjectButton.disabled = false; currentProjectId = null; showExperience('studio'); showPanel('adjust'); status.textContent = `Editing ${rows[editIndex].file.name}.`; return; } const index = Number(target.dataset.download); if (!Number.isNaN(index) && rows[index]?.result) download(rows[index].result!.blob, rows[index].result!.filename); }); downloadAll.addEventListener('click', () => rows.forEach(row => row.result && download(row.result.blob, row.result.filename))); $('#theme-toggle').addEventListener('click', () => { const light = document.body.classList.toggle('light'); $('#theme-toggle').setAttribute('aria-label', light ? 'Switch to dark appearance' : 'Switch to light appearance'); }); async function refreshProjects() {
  const projects = await listProjects();
  projectList.innerHTML = projects.length ? projects.map(project => `<li><div><strong title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</strong><small>${escapeHtml(project.fileName)} · ${project.width}×${project.height}${project.hasMatte ? ' · cutout' : ''} · ${new Date(project.updatedAt).toLocaleDateString()}</small></div><div class="tool-buttons"><button type="button" data-open-project="${project.id}">Open</button><button type="button" data-delete-project="${project.id}">Delete</button></div></li>`).join('') : '<li class="hint">No saved projects yet.</li>';
}
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
if (import.meta.env.DEV) Object.assign(window, { __batch: { rows: () => rows.map(row => ({ name: row.file.name, preset: row.preset ?? null, error: row.error ?? null, result: row.result && { width: row.result.width, height: row.result.height, bytes: row.result.outputBytes, format: row.result.format, type: row.result.blob.type, timings: (row.result as { timings?: unknown }).timings ?? null } })), file: async (index: number) => { const blob = rows[index]?.result?.blob; if (!blob) return null; const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return { type: blob.type, base64: btoa(binary) }; } } }); updateControls(); syncPresetUi(); showExperience('quick'); void refreshProjects();
