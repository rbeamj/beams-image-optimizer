/// <reference lib="webworker" />
/** Module worker hosting ONNX Runtime sessions for one tool. See ort-client.ts for the protocol. */
import type { InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import { loadModelBytes } from './model-cache';
import { applyGraphPatch, sha256Hex, type GraphPatch } from './onnx-splice';
import { classifyError, type LoadInfo, type LoadRequest, type RunInfo, type TensorPayload, type WorkerRequest, type WorkerResponse } from './ort-client';

type Ort = typeof import('onnxruntime-web/wasm');
const scope = self as unknown as DedicatedWorkerGlobalScope;
const modules = new Map<string, Promise<Ort>>();
const sessions = new Map<string, { session: InferenceSession; ort: Ort }>();
let counter = 0;

// WASM linear memory only grows, so its current size is the peak; collect every Memory ORT creates or exports.
const memories = new Set<WebAssembly.Memory>();
const NativeMemory = WebAssembly.Memory;
const PatchedMemory = function (this: unknown, descriptor: WebAssembly.MemoryDescriptor) {
  const memory = new NativeMemory(descriptor);
  memories.add(memory);
  return memory;
} as unknown as typeof WebAssembly.Memory;
PatchedMemory.prototype = NativeMemory.prototype;
WebAssembly.Memory = PatchedMemory;
const nativeInstantiate = WebAssembly.instantiate.bind(WebAssembly) as (...args: unknown[]) => Promise<unknown>;
(WebAssembly as unknown as { instantiate: unknown }).instantiate = async (...args: unknown[]) => {
  const result = await nativeInstantiate(...args) as { instance?: WebAssembly.Instance; exports?: WebAssembly.Exports };
  const exports = result.instance?.exports ?? result.exports ?? {};
  for (const value of Object.values(exports)) if (value instanceof NativeMemory) memories.add(value);
  return result;
};
const heapMB = () => memories.size ? Math.round(Math.max(...[...memories].map(m => m.buffer.byteLength)) / 1048576) : null;

function loadOrt(request: LoadRequest) {
  let pending = modules.get(request.provider);
  if (!pending) {
    pending = (request.provider === 'webgpu' ? import('onnxruntime-web/webgpu') : import('onnxruntime-web/wasm')).then(ort => {
      ort.env.wasm.wasmPaths = request.wasmPaths;
      ort.env.wasm.numThreads = request.threads;
      return ort as Ort;
    });
    modules.set(request.provider, pending);
  }
  return pending;
}

function toTensor(ort: Ort, payload: TensorPayload): Tensor {
  if (payload.type === 'uint8') return new ort.Tensor('uint8', new Uint8Array(payload.data), payload.dims);
  if (payload.type === 'int64') return new ort.Tensor('int64', new BigInt64Array(payload.data), payload.dims);
  return new ort.Tensor('float32', new Float32Array(payload.data), payload.dims);
}

async function fromTensor(tensor: Tensor): Promise<TensorPayload> {
  const data = (tensor.location === 'gpu-buffer' ? await tensor.getData() : tensor.data) as Float32Array | Uint8Array | BigInt64Array;
  const copy = data.slice().buffer as ArrayBuffer;
  const type = tensor.type === 'uint8' ? 'uint8' : tensor.type === 'int64' ? 'int64' : 'float32';
  return { type, data: copy, dims: [...tensor.dims] };
}

async function handle(message: WorkerRequest): Promise<{ result: unknown; transfer?: ArrayBuffer[] }> {
  if (message.kind === 'load') {
    const { request } = message;
    const ort = await loadOrt(request);
    const download = await loadModelBytes(request.url, request.expectedBytes, (loaded, total) => {
      scope.postMessage({ kind: 'progress', reqId: message.reqId, loaded, total } satisfies WorkerResponse);
    }, {}, request.sha256);
    let model: Uint8Array<ArrayBuffer> = new Uint8Array(download.bytes);
    if (request.patchUrl) {
      const res = await fetch(request.patchUrl);
      if (!res.ok) throw new Error(`Model download failed: graph patch HTTP ${res.status}`);
      const patch = await res.json() as GraphPatch;
      model = applyGraphPatch(model, patch);
      if (await sha256Hex(model) !== patch.result.sha256) throw new Error('Model download failed its integrity check (patched graph)');
    }
    const t0 = performance.now();
    const session = await ort.InferenceSession.create(model, { executionProviders: [request.provider], graphOptimizationLevel: 'all' });
    const sessionId = `s${++counter}`;
    sessions.set(sessionId, { session, ort });
    const info: LoadInfo = { sessionId, fromCache: download.fromCache, downloadMs: Math.round(download.ms), initMs: Math.round(performance.now() - t0), inputNames: [...session.inputNames], outputNames: [...session.outputNames], wasmHeapMB: heapMB() };
    return { result: info };
  }
  if (message.kind === 'run') {
    const entry = sessions.get(message.sessionId);
    if (!entry) throw new Error('Model session is not loaded');
    const feeds: Record<string, Tensor> = {};
    for (const [name, payload] of Object.entries(message.feeds)) feeds[name] = toTensor(entry.ort, payload);
    const t0 = performance.now();
    const outputs = await entry.session.run(feeds);
    const ms = performance.now() - t0;
    const result: RunInfo = { outputs: {}, ms: Math.round(ms), wasmHeapMB: heapMB() };
    for (const [name, tensor] of Object.entries(outputs)) result.outputs[name] = await fromTensor(tensor);
    return { result, transfer: Object.values(result.outputs).map(o => o.data) };
  }
  const entry = sessions.get(message.sessionId);
  sessions.delete(message.sessionId);
  await entry?.session.release();
  return { result: undefined };
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    const { result, transfer } = await handle(message);
    scope.postMessage({ kind: 'ok', reqId: message.reqId, result } satisfies WorkerResponse, transfer ?? []);
  } catch (error) {
    const text = String((error as Error)?.message ?? error);
    scope.postMessage({ kind: 'error', reqId: message.reqId, message: text, errorKind: classifyError(text) } satisfies WorkerResponse);
  }
};
