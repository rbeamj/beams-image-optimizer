// src/ai/model-cache.ts

export type CacheDeps = { caches?: CacheStorage; fetch?: typeof fetch; now?: () => number };

export const MODEL_CACHE = 'beams-models-v1';

function baseUrl(url: string): string {
  try {
    return new URL(url, globalThis.location?.href ?? 'http://localhost/').href;
  } catch {
    return url;
  }
}

function nowMs(deps: CacheDeps | undefined): number {
  return (deps?.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now())))();
}

async function readBody(reader: ReadableStreamDefaultReader<Uint8Array>, total: number, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

export async function loadModelBytes(
  url: string,
  expectedBytes: number,
  onProgress?: (loaded: number, total: number) => void,
  deps: CacheDeps = {},
  /** When set, a network download must match this digest before it is cached or used. */
  expectedSha256?: string,
): Promise<{ bytes: ArrayBuffer; fromCache: boolean; ms: number }> {
  const key = baseUrl(url);
  const start = nowMs(deps);
  const caches = deps.caches ?? (typeof globalThis.caches !== 'undefined' ? globalThis.caches : undefined);
  const fetchFn = deps.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined);

  if (caches) {
    try {
      const cache = await caches.open(MODEL_CACHE);
      const cached = await cache.match(key);
      if (cached) {
        const len = Number(cached.headers.get('Content-Length') ?? '-1');
        if (len === expectedBytes) {
          const ab = await cached.arrayBuffer();
          const ms = nowMs(deps) - start;
          onProgress?.(expectedBytes, expectedBytes);
          return { bytes: ab, fromCache: true, ms };
        }
        await cache.delete(key);
      }
    } catch {
      // ignore cache read errors, fall through to fetch
    }
  }

  if (!fetchFn) throw new Error('fetch is not available');
  const res = await fetchFn(key);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);

  const total = Number(res.headers.get('Content-Length') ?? expectedBytes);
  let bytes: ArrayBuffer;
  if (res.body) {
    const reader = res.body.getReader();
    bytes = await readBody(reader, total, onProgress);
  } else {
    const ab = await res.arrayBuffer();
    bytes = ab;
    onProgress?.(ab.byteLength, total);
  }

  const got = bytes.byteLength;
  if (got !== expectedBytes) {
    throw new Error(`Model file is incomplete or the wrong version (${got} bytes, expected ${expectedBytes})`);
  }
  if (expectedSha256 && globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== expectedSha256) throw new Error('Model download failed its integrity check (unexpected file contents)');
  }

  if (caches) {
    try {
      const cache = await caches.open(MODEL_CACHE);
      await cache.put(key, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(got) } }));
    } catch {
      // ignore quota/write errors
    }
  }

  return { bytes, fromCache: false, ms: nowMs(deps) - start };
}

export async function isModelCached(url: string, expectedBytes: number, deps: CacheDeps = {}): Promise<boolean> {
  const key = baseUrl(url);
  const caches = deps.caches ?? (typeof globalThis.caches !== 'undefined' ? globalThis.caches : undefined);
  if (!caches) return false;
  try {
    const cache = await caches.open(MODEL_CACHE);
    const cached = await cache.match(key);
    if (!cached) return false;
    const len = Number(cached.headers.get('Content-Length') ?? '-1');
    return len === expectedBytes;
  } catch {
    return false;
  }
}

export async function evictModel(url: string, deps: CacheDeps = {}): Promise<boolean> {
  const key = baseUrl(url);
  const caches = deps.caches ?? (typeof globalThis.caches !== 'undefined' ? globalThis.caches : undefined);
  if (!caches) return false;
  try {
    const cache = await caches.open(MODEL_CACHE);
    return await cache.delete(key);
  } catch {
    return false;
  }
}

export async function cachedModelUrls(deps: CacheDeps = {}): Promise<string[]> {
  const caches = deps.caches ?? (typeof globalThis.caches !== 'undefined' ? globalThis.caches : undefined);
  if (!caches) return [];
  try {
    const cache = await caches.open(MODEL_CACHE);
    const keys = await cache.keys();
    return keys.map((r) => r.url);
  } catch {
    return [];
  }
}
