// tests/ai-ort-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OrtWorkerClient,
  classifyError,
  type TensorPayload,
  type LoadRequest,
  type LoadInfo,
} from '../src/ai/ort-client';

// ---------------------------------------------------------------------------
// FakeWorker
// ---------------------------------------------------------------------------

class FakeWorker {
  posted: Array<{ message: unknown; transferables: ArrayBuffer[] }> = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  terminated = false;

  postMessage(message: unknown, transferables?: ArrayBuffer[]): void {
    this.posted.push({ message, transferables: transferables ?? [] });
  }

  terminate(): void {
    this.terminated = true;
  }

  dispatch(data: unknown): void {
    this.onmessage?.({ data });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(type: TensorPayload['type'], length: number, dims: number[]): TensorPayload {
  let data: ArrayBuffer;
  switch (type) {
    case 'float32':
      data = new Float32Array(length).buffer;
      break;
    case 'uint8':
      data = new Uint8Array(length).buffer;
      break;
    case 'int64':
      data = new BigInt64Array(length).buffer;
      break;
  }
  return { type, data, dims };
}

function makeLoadRequest(): LoadRequest {
  return {
    url: 'https://example.com/model.onnx',
    expectedBytes: 1000,
    provider: 'wasm',
    wasmPaths: '/wasm/',
    threads: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('oom', () => {
    expect(classifyError('bad_alloc')).toBe('oom');
    expect(classifyError('out of memory')).toBe('oom');
    expect(classifyError('OOM')).toBe('oom');
    expect(classifyError('Aborted()')).toBe('oom');
    expect(classifyError('memory access out of bounds')).toBe('oom');
    expect(classifyError('table index is out of bounds')).toBe('oom');
  });

  it('unsupported', () => {
    expect(classifyError('requires f16')).toBe('unsupported');
    expect(classifyError('not support')).toBe('unsupported');
    expect(classifyError('no available backend')).toBe('unsupported');
    expect(classifyError("Can't create a session")).toBe('unsupported');
    expect(classifyError('WebGPU failure')).toBe('unsupported');
    expect(classifyError('GPU error')).toBe('unsupported');
  });

  it('download', () => {
    expect(classifyError('download failed')).toBe('download');
    expect(classifyError('HTTP 404')).toBe('download');
    expect(classifyError('incomplete body')).toBe('download');
  });

  it('other', () => {
    expect(classifyError('something else')).toBe('other');
  });
});

describe('OrtWorkerClient', () => {
  let factory: ReturnType<typeof vi.fn>;
  let worker: FakeWorker;
  let client: OrtWorkerClient;

  beforeEach(() => {
    factory = vi.fn(() => {
      worker = new FakeWorker();
      return worker;
    });
    client = new OrtWorkerClient(factory as unknown as () => Worker);
  });

  afterEach(() => {
    client.terminate();
    vi.restoreAllMocks();
  });

  it('load resolves with info and forwards progress', async () => {
    const onProgress = vi.fn();
    const promise = client.load(makeLoadRequest(), onProgress);

    worker.dispatch({
      kind: 'progress',
      reqId: 1,
      loaded: 500,
      total: 1000,
    });
    expect(onProgress).toHaveBeenCalledWith(500, 1000);

    const loadInfo: LoadInfo = {
      sessionId: 's1',
      fromCache: false,
      downloadMs: 120,
      initMs: 80,
      inputNames: ['input'],
      outputNames: ['output'],
      wasmHeapMB: 10.5,
    };
    worker.dispatch({ kind: 'ok', reqId: 1, result: loadInfo });

    const result = await promise;
    expect(result).toEqual(loadInfo);
    expect(worker.posted[0].message).toMatchObject({ kind: 'load', reqId: 1 });
  });

  it('run resolves with outputs', async () => {
    const sessionId = 's1';
    const feed = makePayload('float32', 4, [2, 2]);
    const output = makePayload('float32', 4, [2, 2]);

    const promise = client.run(sessionId, { input: feed }, 5000);
    expect(worker.posted[0].transferables).toContain(feed.data);

    worker.dispatch({ kind: 'ok', reqId: 1, result: { outputs: { output }, ms: 10, wasmHeapMB: null } });

    const result = await promise;
    expect(result.ms).toBe(10);
    expect(result.outputs.output.data.byteLength).toBe(output.data.byteLength);
  });

  it('worker error message becomes OrtWorkerError with classified kind', async () => {
    const promise = client.load(makeLoadRequest());
    worker.dispatch({ kind: 'error', reqId: 1, message: 'bad_alloc', errorKind: 'oom' });

    await expect(promise).rejects.toMatchObject({
      name: 'OrtWorkerError',
      kind: 'oom',
      message: 'bad_alloc',
    });
  });

  it('timeout terminates worker and rejects', async () => {
    vi.useFakeTimers();
    const promise = client.load(makeLoadRequest(), undefined, 1000);

    vi.advanceTimersByTime(1000);

    await expect(promise).rejects.toMatchObject({
      kind: 'timeout',
      message: 'Timed out after 1000 ms',
    });
    expect(worker.terminated).toBe(true);
    expect(client.alive).toBe(false);

    vi.useRealTimers();
  });

  it('terminate rejects pending and next call creates a new worker', async () => {
    const promise = client.load(makeLoadRequest());

    client.terminate();

    await expect(promise).rejects.toMatchObject({
      kind: 'other',
      message: 'Worker terminated',
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.alive).toBe(false);

    // Next call should create a fresh worker
    const next = client.load(makeLoadRequest());
    expect(factory).toHaveBeenCalledTimes(2);
    expect(client.alive).toBe(true);

    worker.dispatch({ kind: 'ok', reqId: 2, result: { sessionId: 's1', fromCache: false, downloadMs: 1, initMs: 1, inputNames: [], outputNames: [], wasmHeapMB: null } });
    await expect(next).resolves.toBeDefined();
  });

  it('onerror rejects all pending and terminates', async () => {
    const p1 = client.load(makeLoadRequest());
    const p2 = client.run('s1', { input: makePayload('float32', 1, [1]) }, 5000);

    // @ts-expect-error the fake worker fires a plain object, not a real ErrorEvent
    worker.onerror?.({ message: 'boom' } as ErrorEvent);

    await expect(p1).rejects.toMatchObject({ kind: 'other', message: 'boom' });
    await expect(p2).rejects.toMatchObject({ kind: 'other', message: 'boom' });
    expect(worker.terminated).toBe(true);
  });
});
