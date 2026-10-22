// Browser compatibility + timing harness. One model per page load: window.benchModel({ file, provider, size, mean, std, threads, image }).
const ortBase = `${location.origin}/@fs/E:/Beams-Image-Optimizer/node_modules/onnxruntime-web/dist/`;

// WASM linear memory only grows, so its final size is the peak. Capture every Memory ORT creates or exports.
const memories = new Set();
const NativeMemory = WebAssembly.Memory;
WebAssembly.Memory = function (descriptor) { const m = new NativeMemory(descriptor); memories.add(m); return m; };
WebAssembly.Memory.prototype = NativeMemory.prototype;
for (const name of ['instantiate', 'instantiateStreaming']) {
  const original = WebAssembly[name];
  WebAssembly[name] = async (...args) => {
    const out = await original.apply(WebAssembly, args);
    const exportsObj = (out.instance ?? out).exports;
    for (const value of Object.values(exportsObj ?? {})) if (value instanceof NativeMemory) memories.add(value);
    return out;
  };
}
const wasmHeapMB = () => memories.size ? Math.round(Math.max(...[...memories].map(m => m.buffer.byteLength)) / 1048576) : null;

async function memoryBytes() {
  try { if (crossOriginIsolated && performance.measureUserAgentSpecificMemory) return (await performance.measureUserAgentSpecificMemory()).bytes; } catch {}
  return null;
}

async function inputTensor(ort, image, size, mean, std) {
  const img = new Image();
  img.src = image;
  await img.decode();
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const data = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) data[c * size * size + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  return new ort.Tensor('float32', data, [1, 3, size, size]);
}

/** MobileSAM (encoder + click decoder) and MI-GAN (uint8 inpainting pipeline) need their own feeds. */
async function benchCustom({ kind, provider, threads = 4, runs = 3 }) {
  const result = { kind, provider, threads, crossOriginIsolated };
  try {
    const ort = provider === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
    ort.env.wasm.wasmPaths = ortBase;
    ort.env.wasm.numThreads = threads;
    const load = async file => { const b = await (await fetch(`./models/${file}`)).arrayBuffer(); const t = performance.now(); const s = await ort.InferenceSession.create(b, { executionProviders: [provider], graphOptimizationLevel: 'all' }); return { s, ms: Math.round(performance.now() - t), mb: +(b.byteLength / 1048576).toFixed(1) }; };
    const timeRuns = async (session, feeds) => { const out = []; let last; for (let i = 0; i < runs; i++) { const t = performance.now(); last = await session.run(feeds); const first = last[session.outputNames[0]]; if (first.location === 'gpu-buffer') await first.getData(); out.push(Math.round(performance.now() - t)); } return { ms: out, last }; };
    if (kind === 'mobilesam') {
      const enc = await load('mobilesam-acly-encoder.onnx'), dec = await load('mobilesam-acly-decoder-single.onnx');
      result.modelMB = +(enc.mb + dec.mb).toFixed(1); result.initMs = enc.ms + dec.ms;
      const img = new Float32Array(1024 * 1024 * 3).fill(128);
      const e = await timeRuns(enc.s, { input_image: new ort.Tensor('float32', img, [1024, 1024, 3]) });
      result.encoderMs = e.ms;
      const emb = e.last.image_embeddings;
      const embCpu = emb.location === 'gpu-buffer' ? new ort.Tensor('float32', await emb.getData(), emb.dims) : emb;
      const d = await timeRuns(dec.s, { image_embeddings: embCpu, point_coords: new ort.Tensor('float32', new Float32Array([512, 512, 0, 0]), [1, 2, 2]), point_labels: new ort.Tensor('float32', new Float32Array([1, -1]), [1, 2]), mask_input: new ort.Tensor('float32', new Float32Array(65536), [1, 1, 256, 256]), has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]), orig_im_size: new ort.Tensor('float32', new Float32Array([1024, 1024]), [2]) });
      result.decoderMs = d.ms;
    } else if (kind === 'migan') {
      const m = await load('migan-pipeline-v2.onnx');
      result.modelMB = m.mb; result.initMs = m.ms;
      const S = 512, img = new Uint8Array(3 * S * S).fill(120), mask = new Uint8Array(S * S).fill(255);
      for (let y = 180; y < 330; y++) for (let x = 180; x < 330; x++) mask[y * S + x] = 0;
      result.runMs = (await timeRuns(m.s, { image: new ort.Tensor('uint8', img, [1, 3, S, S]), mask: new ort.Tensor('uint8', mask, [1, 1, S, S]) })).ms;
    }
    result.ok = true;
  } catch (error) { result.ok = false; result.error = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 300); }
  result.wasmHeapMB = wasmHeapMB();
  return result;
}

window.benchModel = async config => config.kind ? benchCustom(config) : benchSegmentation(config);
const benchSegmentation = async ({ file, provider, size, mean, std, threads = 4, image = './data/photos/shoe-2.jpg', runs = 3 }) => {
  const result = { file, provider, threads, size, crossOriginIsolated, webgpu: 'gpu' in navigator };
  const mem0 = await memoryBytes();
  try {
    const ort = provider === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
    ort.env.wasm.wasmPaths = ortBase;
    ort.env.wasm.numThreads = threads;
    if (provider === 'webgpu') {
      const adapter = await navigator.gpu?.requestAdapter();
      result.gpuFeatures = adapter ? [...adapter.features].filter(f => /f16|subgroups|timestamp/.test(f)) : 'no adapter';
      result.maxStorageBuffersPerShaderStage = adapter?.limits?.maxStorageBuffersPerShaderStage;
      result.maxBufferSizeMB = adapter ? Math.round(adapter.limits.maxBufferSize / 1048576) : null;
    }
    let t = performance.now();
    const bytes = await (await fetch(`./models/${file}`)).arrayBuffer();
    result.fetchMs = Math.round(performance.now() - t);
    result.modelMB = +(bytes.byteLength / 1048576).toFixed(1);
    t = performance.now();
    const session = await ort.InferenceSession.create(bytes, { executionProviders: [provider], graphOptimizationLevel: 'all' });
    result.initMs = Math.round(performance.now() - t);
    const input = await inputTensor(ort, image, size, mean, std);
    result.runMs = [];
    for (let i = 0; i < runs; i++) {
      t = performance.now();
      const out = await session.run({ [session.inputNames[0]]: input });
      const o = out[session.outputNames[0]];
      const values = o.location === 'gpu-buffer' ? await o.getData() : o.data;
      result.runMs.push(Math.round(performance.now() - t));
      if (i === 0) { let min = Infinity, max = -Infinity, nan = 0; for (const v of values) { if (!Number.isFinite(v)) nan++; else { if (v < min) min = v; if (v > max) max = v; } } result.output = { dims: o.dims, min: +min.toFixed(3), max: +max.toFixed(3), nonFinite: nan }; }
    }
    result.ok = true;
    result.peakMemMB = (await memoryBytes()) != null ? Math.round(((await memoryBytes()) - (mem0 ?? 0)) / 1048576) : null;
    await session.release();
  } catch (error) {
    result.ok = false;
    result.error = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 300);
  }
  result.jsHeapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  result.wasmHeapMB = wasmHeapMB();
  document.querySelector('#status').textContent = JSON.stringify(result);
  return result;
};

// Iframe mode: runner.html loads browser.html?cfg=<json> per run so each run gets a fresh JS/WASM heap.
const cfg = new URLSearchParams(location.search).get('cfg');
if (cfg) window.benchModel(JSON.parse(cfg)).then(result => parent.postMessage({ benchResult: result }, location.origin));
