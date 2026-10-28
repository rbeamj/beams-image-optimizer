#!/usr/bin/env node
// Browser smoke test for the Studio controller surface — the part `npm test` (pure logic) cannot reach.
//
// It drives the running app in a real headless Chrome over the DevTools protocol, with no extra
// npm dependencies, and guards the regressions this project has actually hit:
//   - the AI opt-in must persist across reloads (localStorage ack keys)
//   - the before/after comparison overlay must stay a single canvas reference (v0.2.0 fix:
//     fabric's bringObjectToFront() re-adds removed objects and used to duplicate it)
//   - Studio exports must not contain the comparison overlay (byte-identical with compare on/off)
//   - adjustments must reach the export through the shared filter chain
//   - Studio projects must survive a reload and reopen byte-identically
//   - look templates must save, apply to a different photo, and appear in the batch preset list
//   - the Quick Optimize queue must survive reloads with outcomes intact, and failed rows must retry
// plus the basics: boot without console errors, Quick Optimize end to end, all Studio panels,
// scene preset layout, and the batch preset gate.
//
// Requirements: `npm run dev` already serving http://localhost:5173 and a local Chrome
// (set CHROME_PATH if the default Windows location does not match). Run with `npm run smoke`.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.SMOKE_CDP_PORT || 9390);
const APP = process.env.SMOKE_URL || 'http://localhost:5173/';
const CHROME = process.env.CHROME_PATH
  ?? ['C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

if (!CHROME) {
  console.error('Chrome was not found. Set CHROME_PATH to your chrome.exe (or equivalent) and retry.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function devServerUp() {
  try { const res = await fetch(APP, { redirect: 'manual' }); return res.ok || res.status === 304; } catch { return false; }
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('websocket error ' + String(e.message || e))));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        this.consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });
  }
  static async connect(url) { const c = new CDP(url); await c.ready; return c; }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 60000);
    });
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error('Page error: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    return res.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

const HELPERS = `
  window.__s = {
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    waitFor: async (fn, timeout = 30000, step = 100) => {
      const t0 = performance.now();
      while (performance.now() - t0 < timeout) { const v = fn(); if (v) return v; await window.__s.sleep(step); }
      throw new Error('timeout');
    },
    gates: () => ({
      bgAckVisible: !document.querySelector('#bgr-ack').hidden,
      enhanceAckVisible: !document.querySelector('#enhance-ack').hidden,
      bgStatus: document.querySelector('#bgr-status').textContent,
      keys: {
        bg: localStorage.getItem('beams-bg-removal-ack-v1'),
        enhance: localStorage.getItem('beams-enhance-license-ack-v1'),
      },
    }),
    ackBoth: () => { document.querySelector('#ack-bgr').click(); document.querySelector('#ack-enhance').click(); },
    photo: async (size) => {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2); ctx.fill();
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      return new File([blob], 'smoke-photo.png', { type: 'image/png' });
    },
    addPhoto: async (file) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('#file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await window.__s.waitFor(() => document.querySelectorAll('#queue .image-card').length === 1, 30000);
    },
    processQueue: () => {
      document.querySelector('#process').click();
      return window.__s.waitFor(() => {
        const t = document.querySelector('#status').textContent || '';
        return /Batch complete/.test(t) ? t : null;
      }, 60000, 100);
    },
    card: () => ({
      done: document.querySelector('#queue .image-card').classList.contains('done'),
      dims: document.querySelector('#queue .image-card .thumb span')?.textContent ?? null,
      detail: document.querySelector('#queue .image-card small').textContent,
      row: window.__batch && window.__batch.rows()[0],
    }),    editFirst: async () => {
      document.querySelector('#queue .image-card [data-edit]').click();
      await window.__s.waitFor(() => !document.querySelector('#studio-workspace').hidden, 30000);
      return document.querySelector('#editor-file').textContent;
    },
    panels: () => [...document.querySelectorAll('[data-editor-panel]')].map(el => el.dataset.editorPanel),
    scenePreset: async (id) => {
      document.querySelector('[data-scene-preset="' + id + '"]').click();
      await window.__s.sleep(250);
    },
    /** Clicks Edit and a scene preset in the same task, so the preset lands while the decode is in flight. */
    presetDuringLoad: async (id) => {
      document.querySelector('#queue .image-card [data-edit]').click();
      document.querySelector('[data-scene-preset="' + id + '"]').click();
      await window.__s.waitFor(() => typeof window.__studio.frame() === 'object', 15000);
      return { title: document.querySelector('#editor-file').textContent, frame: window.__studio.frame() };
    },
    objects: () => window.__studio.objects(),
    frame: () => window.__studio.frame(),
    comparisonOverlays: () => window.__studio.objects().filter(o => o.type === 'image' && !o.isImage && o.clip),
    mainImage: () => window.__studio.objects().find(o => o.isImage),
    setCompare: async (on) => {
      const box = document.querySelector('#compare');
      box.checked = on;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await window.__s.sleep(300);
    },
    setExposure: async (value) => {
      const slider = document.querySelector('#edit-exposure');
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      await window.__s.sleep(400);
    },
    exportBytes: async () => {
      const file = await window.__studio.exportFile();
      if (!file) return null;
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const centre = Array.from(ctx.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data);
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { len: bytes.length, bytes: Array.from(bytes), centre, dims: bmp.width + 'x' + bmp.height };
    },
    selectPreset: (id) => {
      const sel = document.querySelector('#batch-preset-select');
      sel.value = id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { gateVisible: !document.querySelector('#batch-ack').hidden, label: document.querySelector('#process').textContent };
    },
    saveProject: (name) => {
      document.querySelector('#project-name').value = name;
      document.querySelector('#save-project').click();
      return window.__s.waitFor(() => {
        const t = document.querySelector('#status').textContent || '';
        return /Saved|could not be saved/.test(t) ? t : null;
      }, 20000);
    },
    projectRows: () => [...document.querySelectorAll('#project-list li')].map(li => ({
      name: li.querySelector('strong')?.textContent ?? '',
      hasOpen: !!li.querySelector('[data-open-project]'),
      hasDelete: !!li.querySelector('[data-delete-project]'),
    })),
    openProject: async (index) => {
      document.querySelectorAll('#project-list [data-open-project]')[index]?.click();
      await window.__s.waitFor(() => document.querySelector('#editor-file').textContent === 'smoke-photo.png'
        && typeof window.__studio.frame() === 'object'
        && document.querySelector('#edit-exposure-value').textContent === '+40', 25000);
      return {
        title: document.querySelector('#editor-file').textContent,
        exposure: document.querySelector('#edit-exposure-value').textContent,
        frame: !!window.__studio.frame(),
      };
    },
    saveTemplate: (name) => {
      document.querySelector('#template-name').value = name;
      document.querySelector('#save-template').click();
      return window.__s.waitFor(() => {
        const t = document.querySelector('#status').textContent || '';
        return /Saved template|could not be saved/.test(t) ? t : null;
      }, 20000);
    },
    templateRows: () => [...document.querySelectorAll('#template-list li')].map(li => ({
      name: li.querySelector('strong')?.textContent ?? '',
      hasApply: !!li.querySelector('[data-apply-template]'),
      hasDelete: !!li.querySelector('[data-delete-template]'),
    })),
    applyTemplateToFreshPhoto: async (index, size) => {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#2c3e50'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2); ctx.fill();
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'fresh-48.png', { type: 'image/png' }));
      const input = document.querySelector('#file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const state = () => ({ title: document.querySelector('#editor-file').textContent, frame: !!window.__studio.frame(), exposure: document.querySelector('#edit-exposure-value').textContent, scene: window.__studio.scene(), status: document.querySelector('#status').textContent, cards: [...document.querySelectorAll('#queue .image-card strong')].map(e => e.textContent), rows: window.__batch.rows().map(r => r.name) });
      try {
        await window.__s.waitFor(() => [...document.querySelectorAll('#queue .image-card strong')].some(e => e.textContent === 'fresh-48.png'), 30000);
      } catch (error) {
        return { failed: true, stage: 'add', reason: String(error), at: state() };
      }
      [...document.querySelectorAll('#queue .image-card [data-edit]')].pop().click();
      try {
        await window.__s.waitFor(() => document.querySelector('#editor-file').textContent === 'fresh-48.png', 30000);
      } catch (error) {
        return { failed: true, stage: 'edit', reason: String(error), at: state() };
      }
      document.querySelectorAll('#template-list [data-apply-template]')[index]?.click();
      try {
        await window.__s.waitFor(() => typeof window.__studio.frame() === 'object' && document.querySelector('#edit-exposure-value').textContent === '+40', 20000);
      } catch (error) {
        return { failed: true, stage: 'apply', reason: String(error), at: state() };
      }
      return { failed: false, ...state() };
    },
    templateBatchOption: () => document.querySelector('#template-options option[value^="template:"]')?.value ?? null,
    queueCards: () => [...document.querySelectorAll('#queue .image-card')].map(card => ({
      name: card.querySelector('strong').textContent,
      done: card.classList.contains('done'),
      download: !!card.querySelector('[data-download]'),
      retry: !!card.querySelector('[data-retry]'),
      error: card.classList.contains('done') ? null : card.querySelector('small').textContent,
    })),
    addQueuePhotos: async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#16a085'; ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'good-64.png', { type: 'image/png' }));
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])], 'broken.png', { type: 'image/png' }));
      const input = document.querySelector('#file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await window.__s.waitFor(() => [...document.querySelectorAll('#queue .image-card strong')].some(e => e.textContent === 'broken.png'), 30000);
      return { names: [...document.querySelectorAll('#queue .image-card strong')].map(e => e.textContent) };
    },
    retryRow: async (name) => {
      const cards = [...document.querySelectorAll('#queue .image-card')];
      const index = cards.findIndex(card => card.querySelector('strong').textContent === name);
      if (index < 0) return 'row not found';
      cards[index].querySelector('[data-retry]')?.click();
      return window.__s.waitFor(() => /Reprocessed|broken\.png:/.test(document.querySelector('#status').textContent || '') ? document.querySelector('#status').textContent : null, 30000, 100);
    },
    clearQueue: () => { document.querySelector('#clear-queue').click(); return document.querySelector('#status').textContent; },
  };
  'smoke-helpers-ready'
`;

const bytesEqual = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

async function main() {
  if (!(await devServerUp())) {
    console.error(`The dev server is not serving ${APP}. Start it first with: npm run dev`);
    process.exit(1);
  }
  const started = Date.now();
  const profile = mkdtempSync(path.join(tmpdir(), 'beams-smoke-'));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-background-networking', '--mute-audio',
    ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    for (let i = 0; i < 150; i++) {
      try { const res = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (res.ok) break; } catch {}
      await sleep(200);
    }
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    cdp = await CDP.connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    const prep = async () => {
      await cdp.send('Page.navigate', { url: APP });
      await sleep(1000);
      await cdp.evaluate(HELPERS);
      await cdp.evaluate(`window.__s.waitFor(() => typeof window.__studio === 'object' && typeof window.__batch === 'object', 30000)`);
    };

    // 1 — boot
    await prep();
    check('boot: app ready with dev hooks', true);
    check('boot: process label', (await cdp.evaluate(`document.querySelector('#process').textContent`)) === 'Export batch');

    // 2 — fresh-profile gates
    const fresh = await cdp.evaluate(`window.__s.gates()`);
    check('gates: fresh profile shows both AI gates', fresh.bgAckVisible && fresh.enhanceAckVisible);

    // 3 — opt-in persists across a reload
    await cdp.evaluate(`window.__s.ackBoth()`);
    await sleep(300);
    const acked = await cdp.evaluate(`window.__s.gates()`);
    check('opt-in: both keys written', acked.keys.bg === '1' && acked.keys.enhance === '1');
    await prep();
    const reloaded = await cdp.evaluate(`window.__s.gates()`);
    check('opt-in: gates stay hidden after reload', !reloaded.bgAckVisible && !reloaded.enhanceAckVisible, `status: "${reloaded.bgStatus}"`);
    check('opt-in: keys survive reload', reloaded.keys.bg === '1' && reloaded.keys.enhance === '1');
    const batchGate = await cdp.evaluate(`window.__s.selectPreset('marketplace')`);
    check('opt-in: batch preset gate stays closed', !batchGate.gateVisible, `label: "${batchGate.label}"`);
    await cdp.evaluate(`window.__s.selectPreset('none')`);

    // 4 — Quick Optimize end to end (no AI needed)
    await cdp.evaluate(`window.__s.photo(64).then(f => window.__s.addPhoto(f))`);
    const status = await cdp.evaluate(`window.__s.processQueue()`);
    check('quick: batch completes', /Batch complete/.test(status), status);
    const card = await cdp.evaluate(`window.__s.card()`);
    check('quick: result rendered', card.done && card.dims === '64×64', `${card.dims} — ${card.detail}`);
    check('quick: output bytes recorded', card.row?.result?.bytes > 0, `${card.row?.result?.bytes} bytes`);

    // 5 — Studio: panels
    const title = await cdp.evaluate(`window.__s.editFirst()`);
    check('studio: photo loaded for editing', title === 'smoke-photo.png', title);
    const panels = await cdp.evaluate(`window.__s.panels()`);
    const expected = ['background', 'refine', 'cleanup', 'enhance', 'scene', 'adjust', 'color', 'transform', 'crop', 'export'];
    check('studio: all 10 panels present', panels.length === expected.length && expected.every(p => panels.includes(p)), panels.join(','));

    // 6 — a scene preset clicked while the photo is still decoding must survive the load (race fix)
    const race = await cdp.evaluate(`window.__s.presetDuringLoad('marketplace')`);
    check('scene: preset clicked mid-decode applies to the photo', race.title === 'smoke-photo.png' && !!race.frame, race.frame ? 'framed' : 'no frame');
    const objects = await cdp.evaluate(`window.__s.objects()`);
    check('scene: frame, shadow and subject rendered', objects.some(o => o.type === 'rect') && objects.some(o => o.type === 'ellipse') && objects.some(o => o.isImage));

    // 7 — comparison overlay stays a single, aligned reference (v0.2.0 regression guard)
    let overlays = await cdp.evaluate(`window.__s.comparisonOverlays()`);
    check('overlay: exactly one comparison overlay', overlays.length === 1, `${overlays.length} found`);
    await cdp.evaluate(`window.__s.scenePreset('social')`);
    overlays = await cdp.evaluate(`window.__s.comparisonOverlays()`);
    const main = await cdp.evaluate(`window.__s.mainImage()`);
    check('overlay: still one after relayout', overlays.length === 1, `${overlays.length} found`);
    check('overlay: repositioned with the subject', overlays.length === 1 && main && overlays[0].left === main.left && overlays[0].top === main.top && overlays[0].scaleX === main.scaleX);

    // 8 — exports must contain the subject (small photos used to export as empty white frames)
    //     and must not contain the comparison overlay
    const withCompare = await cdp.evaluate(`window.__s.exportBytes()`);
    await cdp.evaluate(`window.__s.setCompare(false)`);
    const withoutCompare = await cdp.evaluate(`window.__s.exportBytes()`);
    check('export: subject present (centre pixel is not the frame)', (withCompare?.centre?.[0] ?? 255) < 247 || (withCompare?.centre?.[1] ?? 255) < 247, `centre: ${JSON.stringify(withCompare?.centre)} @ ${withCompare?.dims}`);
    check('export: byte-identical with compare on/off', bytesEqual(withCompare?.bytes, withoutCompare?.bytes), `${withCompare?.len} vs ${withoutCompare?.len} bytes`);
    check('export: png has content', (withCompare?.len ?? 0) > 100);

    // 9 — adjustments reach the export through the shared filter chain
    const displayBefore = await cdp.evaluate(`document.querySelector('#editor-canvas').toDataURL('image/png').length`);
    await cdp.evaluate(`window.__s.setExposure(40)`);
    const displayAfter = await cdp.evaluate(`document.querySelector('#editor-canvas').toDataURL('image/png').length`);
    const exposed = await cdp.evaluate(`window.__s.exportBytes()`);
    check('adjust: exposure changes the display', displayBefore !== displayAfter, `${displayBefore} vs ${displayAfter}`);
    check('adjust: exposure changes the export', !bytesEqual(withCompare?.bytes, exposed?.bytes) && (exposed?.len ?? 0) > 100, `${withCompare?.len} vs ${exposed?.len} bytes`);

    // 10 — projects: save, survive a reload, reopen, and reproduce the export byte-for-byte
    const savedStatus = await cdp.evaluate(`window.__s.saveProject('smoke-project')`);
    check('project: saved', /Saved/.test(savedStatus ?? ''), savedStatus);
    const rowsAfterSave = await cdp.evaluate(`window.__s.projectRows()`);
    check('project: listed with open/delete', rowsAfterSave.length === 1 && rowsAfterSave[0].name === 'smoke-project' && rowsAfterSave[0].hasOpen && rowsAfterSave[0].hasDelete, JSON.stringify(rowsAfterSave));
    await prep();
    const rowsAfterReload = await cdp.evaluate(`window.__s.projectRows()`);
    check('project: survives a reload', rowsAfterReload.length === 1 && rowsAfterReload[0].name === 'smoke-project', JSON.stringify(rowsAfterReload));
    const reopenedState = await cdp.evaluate(`window.__s.openProject(0)`);
    check('project: reopen restores photo, look and scene', reopenedState.title === 'smoke-photo.png' && !!reopenedState.frame && reopenedState.exposure === '+40', JSON.stringify(reopenedState));
    const reopened = await cdp.evaluate(`window.__s.exportBytes()`);
    check('project: export byte-identical after reopen', bytesEqual(exposed?.bytes, reopened?.bytes), `${exposed?.len} vs ${reopened?.len} bytes`);

    // 11 — templates: save the current look, apply it to a different photo, offer it to the queue
    const templateSaved = await cdp.evaluate(`window.__s.saveTemplate('smoke-look')`);
    check('template: saved', /Saved template/.test(templateSaved ?? ''), templateSaved);
    const templateRows = await cdp.evaluate(`window.__s.templateRows()`);
    check('template: listed with apply/delete', templateRows.length === 1 && templateRows[0].name === 'smoke-look' && templateRows[0].hasApply && templateRows[0].hasDelete, JSON.stringify(templateRows));
    const applied = await cdp.evaluate(`window.__s.applyTemplateToFreshPhoto(0, 48)`);
    check('template: applies to another photo', applied.title === 'fresh-48.png' && !!applied.frame && applied.exposure === '+40', JSON.stringify(applied));
    const batchOption = await cdp.evaluate(`window.__s.templateBatchOption()`);
    check('template: appears in the batch preset list', typeof batchOption === 'string' && batchOption.startsWith('template:'), String(batchOption));

    // 12 — the queue itself survives reloads, keeps outcomes, and failed rows can retry
    const added = await cdp.evaluate(`window.__s.addQueuePhotos()`);
    check('queue: good and broken photos added', added.names.includes('good-64.png') && added.names.includes('broken.png'), JSON.stringify(added.names));
    const runStatus = await cdp.evaluate(`window.__s.processQueue()`);
    check('queue: batch completes', /Batch complete/.test(runStatus), runStatus);
    let cards = await cdp.evaluate(`window.__s.queueCards()`);
    const good = cards.find(c => c.name === 'good-64.png');
    const broken = cards.find(c => c.name === 'broken.png');
    check('queue: good row processed', !!good?.done, good?.error ?? good?.name);
    check('queue: broken row failed with a retry button', !broken?.done && !!broken?.retry && /decode|could not/i.test(broken?.error ?? ''), JSON.stringify(broken));
    const retried = await cdp.evaluate(`window.__s.retryRow('broken.png')`);
    cards = await cdp.evaluate(`window.__s.queueCards()`);
    const brokenAfterRetry = cards.find(c => c.name === 'broken.png');
    check('queue: retry runs and reports the failure again', /broken\.png/.test(retried ?? '') && !!brokenAfterRetry?.retry, `${retried} | ${brokenAfterRetry?.error}`);
    await prep();
    const restoreState = await cdp.evaluate(`(async () => {
      for (let i = 0; i < 200; i++) {
        if (document.querySelectorAll('#queue .image-card').length >= 3) return { ok: true, status: document.querySelector('#status').textContent };
        await new Promise(r => setTimeout(r, 100));
      }
      return { ok: false, status: document.querySelector('#status').textContent, rows: window.__batch.rows().map(r => r.name), cards: [...document.querySelectorAll('#queue .image-card strong')].map(e => e.textContent) };
    })()`);
    check('queue: restored after reload', restoreState.ok, JSON.stringify(restoreState));
    const restored = await cdp.evaluate(`window.__s.queueCards()`);
    const restoredGood = restored.find(c => c.name === 'good-64.png');
    const restoredBroken = restored.find(c => c.name === 'broken.png');
    check('queue: restored after reload', restored.length >= 3 && !!restoredGood && !!restoredBroken, restored.map(c => c.name).join(','));
    check('queue: outcomes preserved on restore', !!restoredGood?.done && !!restoredGood?.download && !!restoredBroken?.retry, JSON.stringify({ good: restoredGood, broken: restoredBroken }));
    const cleared = await cdp.evaluate(`window.__s.clearQueue()`);
    check('queue: cleared', (await cdp.evaluate(`window.__s.queueCards()`)).length === 0, String(cleared));

    // 10 — console
    check('console: no errors across the whole run', cdp.consoleErrors.length === 0, cdp.consoleErrors.slice(0, 3).join(' | '));

    const failed = results.filter(r => !r.ok);
    console.log(`\nSmoke: ${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    cdp.close();
    chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
    process.exit(failed.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    try { cdp?.close(); } catch {}
    chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
    process.exit(1);
  }
}

main();
