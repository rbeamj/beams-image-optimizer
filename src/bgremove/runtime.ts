import type { InferenceSession, Tensor } from 'onnxruntime-web/wasm';

export type MatteProvider = 'wasm' | 'webgpu';
type OrtModule = typeof import('onnxruntime-web/wasm');

const ortModules = new Map<MatteProvider, Promise<OrtModule>>();
const sessions = new Map<string, Promise<InferenceSession>>();

function configure(ort: OrtModule) {
  ort.env.wasm.wasmPaths = new URL('ort/', document.baseURI).href;
  // Threads need cross-origin isolation; static hosts without COOP/COEP fall back to one thread.
  ort.env.wasm.numThreads = crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  return ort;
}

/** The WebGPU build needs a separate ~26 MB wasm, so it is only fetched when that provider is requested. */
function loadOrt(provider: MatteProvider): Promise<OrtModule> {
  let pending = ortModules.get(provider);
  if (!pending) {
    pending = (provider === 'webgpu' ? import('onnxruntime-web/webgpu') : import('onnxruntime-web/wasm')).then(configure);
    ortModules.set(provider, pending);
  }
  return pending;
}

export async function webGpuAvailable() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try { return Boolean(await gpu.requestAdapter()); } catch { return false; }
}

export async function matteSession(url: string, provider: MatteProvider) {
  const key = `${provider}|${url}`;
  let pending = sessions.get(key);
  if (!pending) {
    pending = loadOrt(provider).then(ort => ort.InferenceSession.create(url, { executionProviders: [provider], graphOptimizationLevel: 'all' }));
    sessions.set(key, pending);
    pending.catch(() => sessions.delete(key));
  }
  return pending;
}

export async function matteTensor(provider: MatteProvider, data: Float32Array, size: number): Promise<Tensor> {
  const ort = await loadOrt(provider);
  return new ort.Tensor('float32', data, [1, 3, size, size]);
}

export async function releaseMatteSessions() {
  const pending = [...sessions.values()];
  sessions.clear();
  await Promise.all(pending.map(p => p.then(s => s.release()).catch(() => undefined)));
}
