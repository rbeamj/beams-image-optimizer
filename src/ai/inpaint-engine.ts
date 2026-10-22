/**
 * MI-GAN object removal, lazily loaded in its own worker. The painted area is cut out with surrounding context,
 * filled at 512×512 and blended back only inside a slightly grown, feathered copy of the painted mask, so every
 * other pixel of the photo stays byte-identical.
 */
import { detectCapabilities } from './capabilities';
import { loadManifest, wasmAssetBase } from './removal-engine';
import { MODEL_BASE, variantById } from './models';
import { OrtWorkerClient, type LoadInfo } from './ort-client';
import { blendInto, blendWeights, cleanupWindow, maskBounds } from '../editor/refine-tools';

const SIZE = 512;

export type InpaintResult = { rgba: Uint8ClampedArray<ArrayBuffer>; ms: number; provider: 'webgpu' | 'wasm'; window: { x: number; y: number; width: number; height: number } };

export class InpaintEngine {
  private client?: OrtWorkerClient;
  private session?: LoadInfo & { provider: 'webgpu' | 'wasm' };

  release() { this.client?.terminate('Released'); this.client = undefined; this.session = undefined; }

  private async load(onStatus?: (label: string, loaded?: number, total?: number) => void) {
    if (this.session) return this.session;
    const caps = await detectCapabilities();
    const manifest = await loadManifest();
    let lastError: unknown;
    for (const provider of (caps.webgpu ? ['webgpu', 'wasm'] : ['wasm']) as ('webgpu' | 'wasm')[]) {
      try {
        const variant = variantById(`migan-${provider}`);
        this.client = new OrtWorkerClient();
        const info = await this.client.load({ url: new URL(`${MODEL_BASE}${variant.file}`, document.baseURI).href, expectedBytes: manifest?.files[variant.file]?.bytes ?? variant.bytes, provider, wasmPaths: wasmAssetBase(), threads: crossOriginIsolated ? Math.min(4, caps.cores) : 1 }, (l, t) => onStatus?.('Downloading MI-GAN', l, t), 5 * 60_000);
        this.session = { ...info, provider };
        return this.session;
      } catch (error) {
        lastError = error;
        this.client?.terminate();
      }
    }
    throw new Error(`Object removal could not start: ${(lastError as Error)?.message ?? lastError}. Run "npm run fetch:models -- --migan" if it is not installed.`);
  }

  /** `rgba` is the full photo, `mask` marks pixels to remove (non-zero). Returns the full photo with only the masked area changed. */
  async inpaint(rgba: Uint8ClampedArray, mask: Uint8Array, width: number, height: number, onStatus?: (label: string, loaded?: number, total?: number) => void): Promise<InpaintResult> {
    const box = maskBounds(mask, width, height);
    if (!box) throw new Error('Paint over the object you want to remove first.');
    const session = await this.load(onStatus);
    onStatus?.('Removing object');
    const win = cleanupWindow(box, width, height);
    // Crop the window and resize it to the model size.
    const src = document.createElement('canvas');
    src.width = width; src.height = height;
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const work = document.createElement('canvas');
    work.width = SIZE; work.height = SIZE;
    const wctx = work.getContext('2d', { willReadFrequently: true })!;
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(src, win.x, win.y, win.width, win.height, 0, 0, SIZE, SIZE);
    const crop = wctx.getImageData(0, 0, SIZE, SIZE).data;
    // Nearest-neighbour mask resize with one pixel of growth so the hole fully covers the painted object.
    const plane = SIZE * SIZE;
    const image = new Uint8Array(3 * plane), known = new Uint8Array(plane);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      let hole = false;
      for (let dy = -1; dy <= 1 && !hole; dy++) for (let dx = -1; dx <= 1 && !hole; dx++) {
        const sx = Math.min(win.width - 1, Math.max(0, Math.floor((x + dx + 0.5) * win.width / SIZE)));
        const sy = Math.min(win.height - 1, Math.max(0, Math.floor((y + dy + 0.5) * win.height / SIZE)));
        hole = mask[(win.y + sy) * width + win.x + sx]! > 0;
      }
      const i = y * SIZE + x;
      known[i] = hole ? 0 : 255;
      for (let c = 0; c < 3; c++) image[c * plane + i] = crop[i * 4 + c]!;
    }
    const run = await this.client!.run(session.sessionId, {
      image: { type: 'uint8', data: image.buffer, dims: [1, 3, SIZE, SIZE] },
      mask: { type: 'uint8', data: known.buffer, dims: [1, 1, SIZE, SIZE] },
    }, 30000);
    const result = new Uint8Array(run.outputs[session.outputNames[0]!]!.data);
    const filled = new ImageData(SIZE, SIZE);
    for (let i = 0; i < plane; i++) { for (let c = 0; c < 3; c++) filled.data[i * 4 + c] = result[c * plane + i]!; filled.data[i * 4 + 3] = 255; }
    wctx.putImageData(filled, 0, 0);
    // Scale the filled window back and blend it inside the feathered mask only.
    const back = document.createElement('canvas');
    back.width = win.width; back.height = win.height;
    const bctx = back.getContext('2d', { willReadFrequently: true })!;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(work, 0, 0, win.width, win.height);
    const filledWin = bctx.getImageData(0, 0, win.width, win.height).data;
    const winMask = new Uint8Array(win.width * win.height);
    for (let y = 0; y < win.height; y++) for (let x = 0; x < win.width; x++) winMask[y * win.width + x] = mask[(win.y + y) * width + win.x + x]!;
    const weights = blendWeights(winMask, win.width, win.height, Math.max(2, Math.round(Math.max(win.width, win.height) / 256)));
    const baseWin = new Uint8ClampedArray(win.width * win.height * 4);
    for (let y = 0; y < win.height; y++) baseWin.set(rgba.subarray(((win.y + y) * width + win.x) * 4, ((win.y + y) * width + win.x + win.width) * 4), y * win.width * 4);
    const blended = blendInto(baseWin, filledWin, weights);
    const out = new Uint8ClampedArray(rgba.length);
    out.set(rgba);
    for (let y = 0; y < win.height; y++) out.set(blended.subarray(y * win.width * 4, (y + 1) * win.width * 4), ((win.y + y) * width + win.x) * 4);
    return { rgba: out, ms: run.ms, provider: session.provider, window: win };
  }
}
