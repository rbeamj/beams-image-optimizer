import type { InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import { DEFAULT_MODEL_URL, type EnhanceExecutionProvider } from './types';

type OrtModule = typeof import('onnxruntime-web/wasm');

let ortPromise: Promise<OrtModule> | undefined;
let sessionPromise: Promise<{ session: InferenceSession; provider: EnhanceExecutionProvider }> | undefined;
let activeModelUrl: string | undefined;

function wasmAssetBase() {
  if (typeof document !== 'undefined') return new URL('ort/', document.baseURI).href;
  const base = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : './';
  return base.endsWith('/') ? `${base}ort/` : `${base}/ort/`;
}

async function loadOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    // WASM-only entry keeps the optional enhance chunk off the WebGPU/JSEP 28MB asset.
    ortPromise = import('onnxruntime-web/wasm').then(ort => {
      ort.env.wasm.wasmPaths = wasmAssetBase();
      // Multi-thread WASM needs cross-origin isolation. Default to one thread so
      // GitHub Pages / plain static hosts keep working without COOP/COEP headers.
      const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
      const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
      ort.env.wasm.numThreads = isolated ? Math.min(4, cores) : 1;
      return ort;
    });
  }
  return ortPromise;
}

export async function getEnhanceSession(modelUrl = DEFAULT_MODEL_URL) {
  if (sessionPromise && activeModelUrl === modelUrl) return sessionPromise;
  activeModelUrl = modelUrl;
  sessionPromise = (async () => {
    const ort = await loadOrt();
    const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { session, provider: 'wasm' as EnhanceExecutionProvider };
  })();
  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = undefined;
    activeModelUrl = undefined;
    throw error;
  }
}

export async function createInputTensor(data: Float32Array, width: number, height: number): Promise<Tensor> {
  const ort = await loadOrt();
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

/** Test hook: drop the cached session so a different model URL can load. */
export function resetEnhanceRuntime() {
  sessionPromise = undefined;
  activeModelUrl = undefined;
}
