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

const HF = 'https://huggingface.co';
export type ModelSource = { url: string; bytes: number; sha256: string; patch?: string };

/**
 * Published upstream copies (pinned revisions, CORS-enabled), downloaded on first use when the deployment does not
 * host the file itself. The fp32 BiRefNet 1024 graph is the onnx-community export plus a structure-only graph patch
 * shipped with the app (public/patches/), applied in the browser; it contains no weights.
 */
export const MODEL_SOURCES: Record<string, ModelSource> = {
  'birefnet-lite-1024-webgpu-fp16.onnx': { url: `${HF}/jiabins0303/birefnet-lite-1024-webgpu/resolve/1ad01cef0f4101a285c5a3e0bd7f15597d93403f/onnx/model_fp16.onnx`, bytes: 114834127, sha256: '4059896039dfccb0f15b9080ff06d11d90e499449bb045e797055eb8901cf5f4' },
  'birefnet-lite-1024-webgpu-fp32.onnx': { url: `${HF}/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model.onnx`, bytes: 224005088, sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333', patch: 'patches/birefnet-lite-1024-webgpu-fp32.json' },
  'birefnet-lite-512-fp16.onnx': { url: `${HF}/studioludens/birefnet-lite-512/resolve/962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model_fp16.onnx`, bytes: 98484532, sha256: 'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516' },
  'birefnet-lite-512.onnx': { url: `${HF}/studioludens/birefnet-lite-512/resolve/962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model.onnx`, bytes: 191877254, sha256: '1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2' },
  'u2netp.onnx': { url: `${HF}/BritishWerewolf/U-2-Netp/resolve/7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8/onnx/model.onnx`, bytes: 4574861, sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8' },
  'mobilesam-encoder.onnx': { url: `${HF}/Acly/MobileSAM/resolve/0d3b403339b4674a82493d5e97964dd78089ddc8/mobile_sam_image_encoder.onnx`, bytes: 28157093, sha256: '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749' },
  'mobilesam-decoder-multi.onnx': { url: `${HF}/Acly/MobileSAM/resolve/0d3b403339b4674a82493d5e97964dd78089ddc8/sam_mask_decoder_multi.onnx`, bytes: 16496559, sha256: '8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe' },
  'migan-pipeline-v2.onnx': { url: `${HF}/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx`, bytes: 28079181, sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b' },
  'realesr-general-x4v3.onnx': { url: `${HF}/CoderViking/realesr-general-x4v3-onnx/resolve/c6a971706797c7502945a2b4c4274fce4900d4ab/realesr-general-x4v3.onnx`, bytes: 4866417, sha256: '1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112' },
};

export type ResolvedModel = { url: string; bytes: number; sha256?: string; patchUrl?: string; hosted: boolean };

/**
 * Where to load a model file from: the deployment's own models/ folder when its manifest lists the file (development
 * after `npm run fetch:models`, or self-hosting), otherwise the pinned upstream source.
 */
export function resolveModel(file: string, manifest: { files: Record<string, { bytes: number }> } | null, baseURI: string): ResolvedModel {
  const hosted = manifest?.files[file];
  if (hosted) return { url: new URL(`${MODEL_BASE}${file}`, baseURI).href, bytes: hosted.bytes, hosted: true };
  const source = MODEL_SOURCES[file];
  if (!source) throw new Error(`No download source for ${file}`);
  return { url: source.url, bytes: source.bytes, sha256: source.sha256, patchUrl: source.patch ? new URL(source.patch, baseURI).href : undefined, hosted: false };
}

export const variantById = (id: string) => {
  const v = MODEL_VARIANTS.find(m => m.id === id);
  if (!v) throw new Error(`Unknown model variant ${id}`);
  return v;
};
export const variantsOf = (family: ModelFamily) => MODEL_VARIANTS.filter(m => m.family === family);
export const modelUrl = (v: ModelVariant, base = MODEL_BASE) => `${base}${v.file}`;
