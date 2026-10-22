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

export async function cachedModels() {
  return (await (await caches.open('beams-models-v1')).keys()).map(k => k.url.split('/').pop());
}

export function profile() {
  return Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('beams-ai-profile')).map(([k, v]) => [k.slice(22), JSON.parse(v)]));
}
