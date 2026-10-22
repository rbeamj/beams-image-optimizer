// Dev-only QA helpers for the running app (served by the Vite dev server; never imported by the app).
export async function loadPhoto(path) {
  const blob = await (await fetch(path)).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], path.split('/').pop(), { type: blob.type || 'image/jpeg' }));
  const input = document.querySelector('#file-input');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1500));
  localStorage.setItem('beams-bg-removal-ack-v1', '1');
  localStorage.setItem('beams-enhance-license-ack-v1', '1');
}

export async function waitFor(selector, pattern, timeoutMs = 300000) {
  const el = document.querySelector(selector);
  const t0 = performance.now();
  while (!pattern.test(el.textContent) && performance.now() - t0 < timeoutMs) await new Promise(r => setTimeout(r, 250));
  return { text: el.textContent, ms: Math.round(performance.now() - t0) };
}

export function openPanel(name) {
  document.querySelectorAll('[data-editor-panel]').forEach(p => { p.hidden = p.dataset.editorPanel !== name; });
}

/** Mouse events in fractions of the canvas box (Fabric listens to mousedown on the upper canvas, the rest on document). */
export function canvasStroke(points, extra = {}) {
  const up = document.querySelector('.upper-canvas');
  const r = up.getBoundingClientRect();
  const at = ([fx, fy], buttons) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, bubbles: true, button: 0, buttons, ...extra });
  up.dispatchEvent(new MouseEvent('mousedown', at(points[0], 1)));
  for (const p of points.slice(1)) up.dispatchEvent(new MouseEvent('mousemove', at(p, 1)));
  document.dispatchEvent(new MouseEvent('mouseup', at(points.at(-1), 0)));
}

/** Pixels that differ between two same-size image URLs, and their bounding box. */
export async function diff(urlA, urlB) {
  const load = async u => { const i = new Image(); i.src = u; await i.decode(); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
  const [a, b] = await Promise.all([load(urlA), load(urlB)]);
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: [a.width, a.height, b.width, b.height] };
  let changed = 0, x0 = a.width, y0 = a.height, x1 = -1, y1 = -1;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3]) continue;
    changed++; const p = i / 4, x = p % a.width, y = Math.floor(p / a.width);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { width: a.width, height: a.height, changed, box: changed ? [x0, y0, x1, y1] : null };
}

export async function cachedModels() {
  return (await (await caches.open('beams-models-v1')).keys()).map(k => k.url.split('/').pop());
}

export function profile() {
  return Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('beams-ai-profile')).map(([k, v]) => [k.slice(22), JSON.parse(v)]));
}
