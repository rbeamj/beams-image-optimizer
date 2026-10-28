// @ts-nocheck -- the Cache/Response fakes implement only what model-cache.ts uses.
// tests/ai-cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadModelBytes,
  isModelCached,
  evictModel,
  cachedModelUrls,
  MODEL_CACHE,
} from '../src/ai/model-cache';
import {
  deviceSignature,
  profileKey,
  loadProfile,
  recordResult,
  lastSuccessful,
  loadMode,
  saveMode,
} from '../src/ai/device-profile';

// ---------- fakes ----------

class FakeResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Map<string, string>;
  private _body: ArrayBuffer | null;
  constructor(body: ArrayBuffer | null, init: { status?: number; headers?: Record<string, string> } = {}) {
    this.url = '';
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new Map(Object.entries(init.headers ?? {}));
    this._body = body;
  }
  clone(): FakeResponse {
    return new FakeResponse(this._byteLength ? this._body?.slice(0) ?? null : null, {
      status: this.status,
      headers: Object.fromEntries(this.headers),
    });
  }
  get _byteLength(): number {
    return this._body ? this._body.byteLength : 0;
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this._body ?? new ArrayBuffer(0);
  }
  get body() {
    if (!this._body) return null;
    let off = 0;
    return {
      getReader: () => ({
        read: async () => {
          const body = this._body!;
          if (off >= body.byteLength) return { done: true, value: undefined };
          const chunk = new Uint8Array(body.slice(off, off + 4));
          off += chunk.byteLength;
          return { done: false, value: chunk };
        },
      }),
    };
  }
}

class FakeCacheStorage {
  private store = new Map<string, FakeResponse>();
  async open(_name: string): Promise<FakeCacheStorage> {
    return this;
  }
  async match(url: string | Request): Promise<FakeResponse | undefined> {
    const key = typeof url === 'string' ? url : url.url;
    return this.store.get(key);
  }
  async put(url: string | Request, response: FakeResponse): Promise<void> {
    const key = typeof url === 'string' ? url : url.url;
    this.store.set(key, response.clone());
  }
  async delete(url: string | Request): Promise<boolean> {
    const key = typeof url === 'string' ? url : url.url;
    return this.store.delete(key);
  }
  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map((u) => new Request(u));
  }
}

function fakeFetchFactory(bytesMap: Map<string, ArrayBuffer>, statusMap: Map<string, number> = new Map()) {
  return async (input: string | Request, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url;
    const status = statusMap.get(url) ?? 200;
    if (status < 200 || status >= 300) {
      return new FakeResponse(null, { status }) as unknown as Response;
    }
    const body = bytesMap.get(url);
    if (!body) throw new Error(`no fake bytes for ${url}`);
    const res = new FakeResponse(body, {
      headers: { 'Content-Length': String(body.byteLength), 'Content-Type': 'application/octet-stream' },
    });
    return res as unknown as Response;
  };
}

// ---------- tests ----------

describe('model-cache', () => {
  let caches: FakeCacheStorage;
  let fetch: typeof fetch;
  let bytes: Map<string, ArrayBuffer>;
  let statuses: Map<string, number>;

  beforeEach(() => {
    caches = new FakeCacheStorage();
    bytes = new Map();
    statuses = new Map();
    fetch = fakeFetchFactory(bytes, statuses) as typeof fetch;
  });

  it('downloads, caches, and reports progress', async () => {
    const data = new Uint8Array(100);
    for (let i = 0; i < 100; i++) data[i] = i;
    bytes.set('http://localhost/model.bin', data.buffer);

    const progress: [number, number][] = [];
    const result = await loadModelBytes('http://localhost/model.bin', 100, (loaded, total) => progress.push([loaded, total]), {
      caches,
      fetch,
      now: () => 1000,
    });

    expect(result.fromCache).toBe(false);
    expect(result.ms).toBe(0);
    expect(new Uint8Array(result.bytes)).toEqual(data);
    expect(progress[progress.length - 1]).toEqual([100, 100]);

    const cached = await caches.match('http://localhost/model.bin');
    expect(cached).toBeDefined();
    expect(await cached!.arrayBuffer()).toEqual(data.buffer);
  });

  it('second load is from cache', async () => {
    const data = new Uint8Array(50);
    bytes.set('http://localhost/model.bin', data.buffer);

    await loadModelBytes('http://localhost/model.bin', 50, undefined, { caches, fetch });
    const result = await loadModelBytes('http://localhost/model.bin', 50, undefined, { caches, fetch });

    expect(result.fromCache).toBe(true);
    expect(new Uint8Array(result.bytes)).toEqual(data);
  });

  it('wrong length on fetch throws and does not cache', async () => {
    bytes.set('http://localhost/model.bin', new Uint8Array(10).buffer);
    await expect(loadModelBytes('http://localhost/model.bin', 100, undefined, { caches, fetch })).rejects.toThrow(
      /Model file is incomplete or the wrong version/,
    );
    expect(await isModelCached('http://localhost/model.bin', 100, { caches })).toBe(false);
  });

  it('cached wrong length is deleted and refetched', async () => {
    const good = new Uint8Array(100);
    const bad = new Uint8Array(10);
    bytes.set('http://localhost/model.bin', good.buffer);

    // seed cache with wrong length
    const cache = await caches.open(MODEL_CACHE);
    await cache.put('http://localhost/model.bin', new FakeResponse(bad.buffer) as unknown as Response);

    const result = await loadModelBytes('http://localhost/model.bin', 100, undefined, { caches, fetch });
    expect(result.fromCache).toBe(false);
    expect(new Uint8Array(result.bytes)).toEqual(good);
  });

  it('HTTP error throws', async () => {
    statuses.set('http://localhost/model.bin', 404);
    await expect(loadModelBytes('http://localhost/model.bin', 100, undefined, { caches, fetch })).rejects.toThrow(
      /Model download failed: HTTP 404/,
    );
  });

  it('no caches still loads', async () => {
    const data = new Uint8Array(30);
    bytes.set('http://localhost/model.bin', data.buffer);
    const result = await loadModelBytes('http://localhost/model.bin', 30, undefined, { fetch });
    expect(result.fromCache).toBe(false);
    expect(new Uint8Array(result.bytes)).toEqual(data);
  });

  it('isModelCached / evictModel / cachedModelUrls', async () => {
    const data = new Uint8Array(20);
    bytes.set('http://localhost/a.bin', data.buffer);
    bytes.set('http://localhost/b.bin', data.buffer);

    expect(await isModelCached('http://localhost/a.bin', 20, { caches })).toBe(false);
    await loadModelBytes('http://localhost/a.bin', 20, undefined, { caches, fetch });
    expect(await isModelCached('http://localhost/a.bin', 20, { caches })).toBe(true);
    expect(await isModelCached('http://localhost/a.bin', 99, { caches })).toBe(false);

    await loadModelBytes('http://localhost/b.bin', 20, undefined, { caches, fetch });
    expect(await cachedModelUrls({ caches })).toContain('http://localhost/a.bin');
    expect(await cachedModelUrls({ caches })).toContain('http://localhost/b.bin');

    expect(await evictModel('http://localhost/a.bin', { caches })).toBe(true);
    expect(await isModelCached('http://localhost/a.bin', 20, { caches })).toBe(false);
    expect(await evictModel('http://localhost/missing.bin', { caches })).toBe(false);
  });
});

describe('device-profile', () => {
  it('deviceSignature gpu', () => {
    expect(
      deviceSignature({
        webgpu: { f16: true, vendor: 'NVIDIA', architecture: 'Ampere', maxBufferSizeMB: 128 },
        deviceMemoryGB: 8,
        cores: 8,
      }),
    ).toBe('gpu:NVIDIA/Ampere/f16:1/buf:128|mem:8|cores:8');
  });

  it('deviceSignature none', () => {
    expect(deviceSignature({ webgpu: null, deviceMemoryGB: null, cores: 4 })).toBe(
      'gpu:none|mem:?|cores:4',
    );
  });

  it('profileKey', () => {
    expect(profileKey('abc')).toBe('beams-ai-profile-v1:abc');
  });

  it('record/load round trip', () => {
    const store: Record<string, string> = {};
    const fake: Storage = {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    } as unknown as Storage;

    const sig = deviceSignature({ webgpu: null, deviceMemoryGB: null, cores: 2 });
    const p1 = recordResult(sig, 'v1', { ok: true, ms: 10 }, fake, 1000);
    expect(p1.variants['v1']).toEqual({ ok: true, ms: 10, reason: undefined, at: 1000 });

    const p2 = loadProfile(sig, fake);
    expect(p2.variants['v1']).toEqual({ ok: true, ms: 10, reason: undefined, at: 1000 });

    recordResult(sig, 'v1', { ok: false, reason: 'oom' }, fake, 2000);
    expect(loadProfile(sig, fake).variants['v1']).toEqual({ ok: false, reason: 'oom', ms: undefined, at: 2000 });
  });

  it('corrupt storage yields empty profile', () => {
    const store: Record<string, string> = {};
    const fake: Storage = {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    } as unknown as Storage;

    store[profileKey('sig')] = '{not json';
    expect(loadProfile('sig', fake)).toEqual({ variants: {} });
  });

  it('lastSuccessful with family filter', () => {
    const profile = {
      variants: {
        'fast-a': { ok: true, ms: 5, at: 100 },
        'fast-b': { ok: true, ms: 3, at: 200 },
        'quality-a': { ok: true, ms: 50, at: 150 },
        'bad': { ok: false, ms: 1, at: 300 },
      },
    };
    expect(lastSuccessful(profile)).toBe('fast-b');
    expect(lastSuccessful(profile, 'fast')).toBe('fast-b');
    expect(lastSuccessful(profile, 'quality')).toBe('quality-a');
    expect(lastSuccessful(profile, 'slow')).toBeNull();
  });

  it('mode load/save/default/invalid', () => {
    const store: Record<string, string> = {};
    const fake: Storage = {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    } as unknown as Storage;

    expect(loadMode(fake)).toBe('auto');
    saveMode('quality', fake);
    expect(loadMode(fake)).toBe('quality');

    store['beams-ai-removal-mode'] = 'nope';
    expect(loadMode(fake)).toBe('auto');
  });
});
