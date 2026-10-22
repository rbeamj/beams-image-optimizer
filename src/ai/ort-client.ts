/**
 * Main-thread handle for one ONNX Runtime worker. Each tool (background removal, MobileSAM, MI-GAN) gets its
 * own client so an out-of-memory or hung model can be terminated without touching the editor or other tools;
 * terminating the worker is also how model memory is released.
 */
export type TensorPayload = { type: 'float32' | 'uint8' | 'int64'; data: ArrayBuffer; dims: number[] };
export type LoadRequest = { url: string; expectedBytes: number; provider: 'webgpu' | 'wasm'; wasmPaths: string; threads: number; sha256?: string; patchUrl?: string };
export type LoadInfo = { sessionId: string; fromCache: boolean; downloadMs: number; initMs: number; inputNames: string[]; outputNames: string[]; wasmHeapMB: number | null };
export type RunInfo = { outputs: Record<string, TensorPayload>; ms: number; wasmHeapMB: number | null };
export type ErrorKind = 'oom' | 'unsupported' | 'timeout' | 'download' | 'other';

export class OrtWorkerError extends Error {
  constructor(message: string, readonly kind: ErrorKind) {
    super(message);
    this.name = 'OrtWorkerError';
  }
}

export function classifyError(message: string): ErrorKind {
  if (/bad_alloc|out of memory|\bOOM\b|Aborted\(|memory access out of bounds|table index is out of bounds|allocation failed/i.test(message)) return 'oom';
  if (/requires f16|not support|no available backend|Can't create a session|WebGPU|\bGPU\b|device (was )?lost/i.test(message)) return 'unsupported';
  if (/download|HTTP|incomplete|Failed to fetch|NetworkError|Load failed/i.test(message)) return 'download';
  return 'other';
}

export type WorkerRequest =
  | { kind: 'load'; reqId: number; request: LoadRequest }
  | { kind: 'run'; reqId: number; sessionId: string; feeds: Record<string, TensorPayload> }
  | { kind: 'release'; reqId: number; sessionId: string };
export type WorkerResponse =
  | { kind: 'progress'; reqId: number; loaded: number; total: number }
  | { kind: 'ok'; reqId: number; result: unknown }
  | { kind: 'error'; reqId: number; message: string; errorKind: ErrorKind };

type Outgoing = WorkerRequest extends infer R ? (R extends unknown ? Omit<R, 'reqId'> : never) : never;
type Pending = { resolve: (value: unknown) => void; reject: (error: OrtWorkerError) => void; onProgress?: (loaded: number, total: number) => void; timer?: ReturnType<typeof setTimeout> };

const defaultWorker = () => new Worker(new URL('./ort-worker.ts', import.meta.url), { type: 'module' });

export class OrtWorkerClient {
  private worker: Worker | undefined;
  private pending = new Map<number, Pending>();
  private nextId = 0;

  constructor(private readonly createWorker: () => Worker = defaultWorker) {}

  get alive() { return this.worker !== undefined; }

  load(request: LoadRequest, onProgress?: (loaded: number, total: number) => void, timeoutMs?: number) {
    return this.send<LoadInfo>({ kind: 'load', request }, [], timeoutMs, onProgress);
  }

  run(sessionId: string, feeds: Record<string, TensorPayload>, timeoutMs: number) {
    return this.send<RunInfo>({ kind: 'run', sessionId, feeds }, Object.values(feeds).map(f => f.data), timeoutMs);
  }

  async release(sessionId: string) {
    if (!this.worker) return;
    await this.send<void>({ kind: 'release', sessionId }, [], 10000).catch(() => undefined);
  }

  /** Kills the worker (freeing all its memory) and rejects in-flight requests. The next call starts a new worker. */
  terminate(reason = 'Worker terminated', kind: ErrorKind = 'other') {
    this.worker?.terminate();
    this.worker = undefined;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) { clearTimeout(p.timer); p.reject(new OrtWorkerError(reason, kind)); }
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
    worker.onerror = (event: ErrorEvent) => {
      const message = event.message || 'The model worker crashed';
      this.terminate(message, classifyError(message));
    };
    this.worker = worker;
    return worker;
  }

  private send<T>(message: Outgoing, transfer: ArrayBuffer[], timeoutMs?: number, onProgress?: (loaded: number, total: number) => void): Promise<T> {
    const worker = this.ensureWorker();
    const reqId = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = { resolve: resolve as (value: unknown) => void, reject, onProgress };
      if (timeoutMs && timeoutMs > 0) {
        pending.timer = setTimeout(() => this.terminate(`Timed out after ${timeoutMs} ms`, 'timeout'), timeoutMs);
      }
      this.pending.set(reqId, pending);
      worker.postMessage({ ...message, reqId } as WorkerRequest, transfer);
    });
  }

  private receive(message: WorkerResponse) {
    const pending = this.pending.get(message.reqId);
    if (!pending) return;
    if (message.kind === 'progress') { pending.onProgress?.(message.loaded, message.total); return; }
    clearTimeout(pending.timer);
    this.pending.delete(message.reqId);
    if (message.kind === 'ok') pending.resolve(message.result);
    else pending.reject(new OrtWorkerError(message.message, message.errorKind));
  }
}
