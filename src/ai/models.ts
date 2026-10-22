/**
 * Registry of every locally run model variant. Files are served from MODEL_BASE (./models/ by default),
 * fetched by `npm run fetch:models`, never committed, and stripped from builds unless allowlisted.
 * Measurements referenced in comments come from experiments/bg-eval (GTX 1080 Ti, no shader-f16).
 */
export type Provider = 'webgpu' | 'wasm';
export type Precision = 'fp16' | 'fp32';
export type ModelFamily = 'birefnet-1024' | 'birefnet-512' | 'u2netp' | 'mobilesam-encoder' | 'mobilesam-decoder' | 'migan';

export type ModelVariant = {
  id: string;
  family: ModelFamily;
  label: string;
  file: string;
  bytes: number;
  provider: Provider;
  precision: Precision;
  /** WebGPU fp16 graphs fail to compile without the shader-f16 feature. */
  requiresF16: boolean;
  /** Bounded suitability gates; undefined = no gate. */
  minDeviceMemoryGB?: number;
  minMaxBufferSizeMB?: number;
  inputSize?: number;
  /** Abort and fall back if a single inference exceeds this. */
  timeoutMs: number;
};

export const MODEL_BASE = './models/';

const birefnet = { inputSize: undefined } as const;
export const MODEL_VARIANTS: ModelVariant[] = [
  // Quality: BiRefNet lite at 1024. Upstream exports cannot run in browsers (WASM OOM, WebGPU storage-buffer limits);
  // these graphs apply the published Split/GatherND rewrite (bit-identical outputs).
  { id: 'birefnet-1024-webgpu-fp16', family: 'birefnet-1024', label: 'Quality 1024 · WebGPU fp16', file: 'birefnet-lite-1024-webgpu-fp16.onnx', bytes: 114834127, provider: 'webgpu', precision: 'fp16', requiresF16: true, minDeviceMemoryGB: 8, minMaxBufferSizeMB: 1024, inputSize: 1024, timeoutMs: 60000 },
  { id: 'birefnet-1024-webgpu-fp32', family: 'birefnet-1024', label: 'Quality 1024 · WebGPU fp32', file: 'birefnet-lite-1024-webgpu-fp32.onnx', bytes: 224300994, provider: 'webgpu', precision: 'fp32', requiresF16: false, minDeviceMemoryGB: 8, minMaxBufferSizeMB: 1024, inputSize: 1024, timeoutMs: 60000 },
  // Fast: BiRefNet lite at 512 (studioludens export). fp16 file doubles as the WASM path (WASM handles fp16 graphs).
  { id: 'birefnet-512-webgpu-fp16', family: 'birefnet-512', label: 'Fast 512 · WebGPU fp16', file: 'birefnet-lite-512-fp16.onnx', bytes: 98484532, provider: 'webgpu', precision: 'fp16', requiresF16: true, minDeviceMemoryGB: 4, inputSize: 512, timeoutMs: 30000 },
  { id: 'birefnet-512-webgpu-fp32', family: 'birefnet-512', label: 'Fast 512 · WebGPU fp32', file: 'birefnet-lite-512.onnx', bytes: 191877254, provider: 'webgpu', precision: 'fp32', requiresF16: false, minDeviceMemoryGB: 4, inputSize: 512, timeoutMs: 30000 },
  { id: 'birefnet-512-wasm-fp16', family: 'birefnet-512', label: 'Fast 512 · CPU (WASM)', file: 'birefnet-lite-512-fp16.onnx', bytes: 98484532, provider: 'wasm', precision: 'fp16', requiresF16: false, minDeviceMemoryGB: 4, inputSize: 512, timeoutMs: 45000 },
  // Last-resort compatibility path (4.6 MB).
  { id: 'u2netp-webgpu', family: 'u2netp', label: 'Basic · WebGPU', file: 'u2netp.onnx', bytes: 4574861, provider: 'webgpu', precision: 'fp32', requiresF16: false, inputSize: 320, timeoutMs: 20000 },
  { id: 'u2netp-wasm', family: 'u2netp', label: 'Basic · CPU (WASM)', file: 'u2netp.onnx', bytes: 4574861, provider: 'wasm', precision: 'fp32', requiresF16: false, inputSize: 320, timeoutMs: 20000 },
  // Optional editing tools.
  { id: 'mobilesam-encoder-webgpu', family: 'mobilesam-encoder', label: 'MobileSAM encoder · WebGPU', file: 'mobilesam-encoder.onnx', bytes: 28157093, provider: 'webgpu', precision: 'fp32', requiresF16: false, timeoutMs: 30000 },
  { id: 'mobilesam-encoder-wasm', family: 'mobilesam-encoder', label: 'MobileSAM encoder · CPU', file: 'mobilesam-encoder.onnx', bytes: 28157093, provider: 'wasm', precision: 'fp32', requiresF16: false, timeoutMs: 30000 },
  { id: 'mobilesam-decoder-wasm', family: 'mobilesam-decoder', label: 'MobileSAM decoder · CPU', file: 'mobilesam-decoder-multi.onnx', bytes: 16496559, provider: 'wasm', precision: 'fp32', requiresF16: false, timeoutMs: 15000 },
  { id: 'migan-webgpu', family: 'migan', label: 'MI-GAN · WebGPU', file: 'migan-pipeline-v2.onnx', bytes: 28079181, provider: 'webgpu', precision: 'fp32', requiresF16: false, timeoutMs: 30000 },
  { id: 'migan-wasm', family: 'migan', label: 'MI-GAN · CPU', file: 'migan-pipeline-v2.onnx', bytes: 28079181, provider: 'wasm', precision: 'fp32', requiresF16: false, timeoutMs: 45000 },
];
void birefnet;

export const variantById = (id: string) => {
  const v = MODEL_VARIANTS.find(m => m.id === id);
  if (!v) throw new Error(`Unknown model variant ${id}`);
  return v;
};
export const variantsOf = (family: ModelFamily) => MODEL_VARIANTS.filter(m => m.family === family);
export const modelUrl = (v: ModelVariant, base = MODEL_BASE) => `${base}${v.file}`;
