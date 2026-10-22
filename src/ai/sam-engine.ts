/**
 * MobileSAM click segmentation, lazily loaded in its own worker. The photo is encoded once per layer URL; each
 * click only runs the small decoder. WebGPU is used when it works, otherwise CPU (WASM).
 */
import { detectCapabilities } from './capabilities';
import { loadManifest, wasmAssetBase } from './removal-engine';
import { MODEL_BASE, variantById } from './models';
import { OrtWorkerClient, type LoadInfo, type TensorPayload } from './ort-client';
import { encoderSize, rankCandidates, toEncoderSpace, type ClickPoint } from '../editor/refine-tools';

/** `mask(k)` returns candidate k as probabilities 0..1 at base resolution (computed on first use). */
export type SamCandidates = { mask(k: number): Float32Array; count: number; order: number[]; width: number; height: number; decodeMs: number };

export class SamEngine {
  private client?: OrtWorkerClient;
  private sessions?: { encoder: LoadInfo; decoder: LoadInfo; provider: 'webgpu' | 'wasm' };
  private embedding?: { key: string; payload: TensorPayload; width: number; height: number };

  get provider() { return this.sessions?.provider; }

  release() { this.client?.terminate('Released'); this.client = undefined; this.sessions = undefined; this.embedding = undefined; }

  private async load(onStatus?: (label: string, loaded?: number, total?: number) => void) {
    if (this.sessions) return this.sessions;
    const caps = await detectCapabilities();
    const manifest = await loadManifest();
    const providers: ('webgpu' | 'wasm')[] = caps.webgpu ? ['webgpu', 'wasm'] : ['wasm'];
    let lastError: unknown;
    for (const provider of providers) {
      try {
        this.client = new OrtWorkerClient();
        const encoderVariant = variantById(`mobilesam-encoder-${provider}`);
        const decoderVariant = variantById('mobilesam-decoder-wasm');
        const request = (file: string, bytes: number) => ({ url: new URL(`${MODEL_BASE}${file}`, document.baseURI).href, expectedBytes: manifest?.files[file]?.bytes ?? bytes, provider, wasmPaths: wasmAssetBase(), threads: crossOriginIsolated ? Math.min(4, caps.cores) : 1 });
        const encoder = await this.client.load(request(encoderVariant.file, encoderVariant.bytes), (l, t) => onStatus?.('Loading MobileSAM encoder', l, t), 5 * 60_000);
        const decoder = await this.client.load(request(decoderVariant.file, decoderVariant.bytes), (l, t) => onStatus?.('Loading MobileSAM decoder', l, t), 5 * 60_000);
        this.sessions = { encoder, decoder, provider };
        return this.sessions;
      } catch (error) {
        lastError = error;
        this.client?.terminate();
      }
    }
    throw new Error(`MobileSAM could not start: ${(lastError as Error)?.message ?? lastError}. Run "npm run fetch:models -- --sam" if it is not installed.`);
  }

  /** Encodes the photo layer once; repeated clicks on the same layer reuse the embedding. */
  async encode(key: string, getImage: () => Promise<HTMLImageElement>, width: number, height: number, onStatus?: (label: string, loaded?: number, total?: number) => void) {
    if (this.embedding?.key === key) return 0;
    const sessions = await this.load(onStatus);
    const image = await getImage();
    onStatus?.('Analysing photo for Magic Click');
    const size = encoderSize(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, size.width, size.height);
    const rgba = ctx.getImageData(0, 0, size.width, size.height).data;
    const hwc = new Float32Array(size.width * size.height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) { hwc[j++] = rgba[i]!; hwc[j++] = rgba[i + 1]!; hwc[j++] = rgba[i + 2]!; }
    const run = await this.client!.run(sessions.encoder.sessionId, { [sessions.encoder.inputNames[0]!]: { type: 'float32', data: hwc.buffer, dims: [size.height, size.width, 3] } }, 30000);
    this.embedding = { key, payload: run.outputs[sessions.encoder.outputNames[0]!]!, width, height };
    return run.ms;
  }

  /** Returns candidate selection masks (probabilities 0..1 at base resolution), best predicted first. */
  async decode(points: ClickPoint[]): Promise<SamCandidates> {
    if (!this.sessions || !this.embedding) throw new Error('Encode the photo first.');
    const { width, height } = this.embedding;
    const enc = toEncoderSpace(points, width, height);
    const coords = new Float32Array([...enc.coords, 0, 0]);
    const labels = new Float32Array([...enc.labels, -1]);
    const n = labels.length;
    const embedding = this.embedding.payload;
    const run = await this.client!.run(this.sessions.decoder.sessionId, {
      image_embeddings: { ...embedding, data: embedding.data.slice(0) },
      point_coords: { type: 'float32', data: coords.buffer, dims: [1, n, 2] },
      point_labels: { type: 'float32', data: labels.buffer, dims: [1, n] },
      mask_input: { type: 'float32', data: new Float32Array(256 * 256).buffer, dims: [1, 1, 256, 256] },
      has_mask_input: { type: 'float32', data: new Float32Array([0]).buffer, dims: [1] },
      orig_im_size: { type: 'float32', data: new Float32Array([height, width]).buffer, dims: [2] },
    }, 15000);
    const masks = run.outputs.masks!;
    const iou = new Float32Array(run.outputs.iou_predictions!.data);
    const count = masks.dims[1]!;
    const plane = width * height;
    const logits = new Float32Array(masks.data);
    const cache = new Map<number, Float32Array>();
    const mask = (k: number) => {
      let prob = cache.get(k);
      if (!prob) {
        prob = new Float32Array(plane);
        for (let i = 0; i < plane; i++) prob[i] = 1 / (1 + Math.exp(-logits[k * plane + i]!));
        cache.set(k, prob);
      }
      return prob;
    };
    return { mask, count, order: rankCandidates(iou), width, height, decodeMs: run.ms };
  }
}
