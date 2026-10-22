/**
 * Development-only quality/speed harness. Not imported by the app, so it is not bundled.
 * Run from a dev-server page console:
 *   const b = await import('/src/bgremove/benchmark.ts'); await b.runBenchmark();
 * Inputs: transparent PNGs in public/bench/ (gitignored) composited onto known backdrops, so the
 * original alpha channel is exact ground truth.
 */
import { matteMetrics, type EdgeCleanup, type MatteModelId } from './matte';
import { removeBackground } from './remove';
import { webGpuAvailable, type MatteProvider } from './runtime';

const DEFAULT_IMAGES = ['soda-bottle-pd.png', 'water-bottle-cc0.png', 'worn-shoe-cc0.png', 'shoe-bar-pd.png'];
type Backdrop = 'studio' | 'busy';

async function loadImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function fitWithin(width: number, height: number, edge: number) {
  const k = Math.min(1, edge / Math.max(width, height));
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

function paintBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, kind: Backdrop) {
  if (kind === 'studio') {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, '#f6f6f4'); g.addColorStop(1, '#dcdcd8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, '#7b5e43'); g.addColorStop(.5, '#b99c78'); g.addColorStop(1, '#4f6b5a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 160; i += 1) {
    ctx.fillStyle = `hsla(${Math.floor(rand() * 360)},35%,${30 + rand() * 40}%,.35)`;
    ctx.fillRect(rand() * width, rand() * height, 8 + rand() * width * .15, 4 + rand() * height * .05);
  }
}

export async function prepareCase(file: string, backdrop: Backdrop, maxEdge = 1600) {
  const img = await loadImage(`./bench/${file}`);
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge);
  const fg = document.createElement('canvas'); fg.width = width; fg.height = height;
  const fctx = fg.getContext('2d', { willReadFrequently: true })!;
  fctx.drawImage(img, 0, 0, width, height);
  const alpha = fctx.getImageData(0, 0, width, height).data;
  const truth = new Float32Array(width * height);
  for (let i = 0; i < truth.length; i += 1) truth[i] = alpha[i * 4 + 3]! / 255;
  const composite = document.createElement('canvas'); composite.width = width; composite.height = height;
  const cctx = composite.getContext('2d')!;
  paintBackdrop(cctx, width, height, backdrop);
  cctx.drawImage(fg, 0, 0);
  return { composite, truth, width, height };
}

export type BenchRow = { image: string; backdrop: Backdrop; model: MatteModelId; provider: MatteProvider; cleanup: EdgeCleanup; refine: boolean; size: string; iou: number; mae: number; edgeMae: number; inferenceMs: number; totalMs: number; heapMB?: number; error?: string };

export async function runBenchmark(options: { images?: string[]; models?: MatteModelId[]; providers?: MatteProvider[]; backdrops?: Backdrop[]; cleanup?: EdgeCleanup; refine?: boolean } = {}) {
  const gpu = await webGpuAvailable();
  const providers = (options.providers ?? ['wasm', 'webgpu']).filter(p => p !== 'webgpu' || gpu);
  const rows: BenchRow[] = [];
  const cleanup = options.cleanup ?? 'balanced';
  for (const model of options.models ?? ['u2netp']) {
    for (const provider of providers) {
      for (const image of options.images ?? DEFAULT_IMAGES) {
        for (const backdrop of options.backdrops ?? ['studio', 'busy']) {
          const c = await prepareCase(image, backdrop);
          const base = { image, backdrop, model, provider, cleanup, refine: Boolean(options.refine), size: `${c.width}×${c.height}` };
          try {
            const result = await removeBackground(c.composite, { model, provider, cleanup, refine: options.refine });
            const px = result.canvas.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
            const pred = new Float32Array(c.width * c.height);
            for (let i = 0; i < pred.length; i += 1) pred[i] = px[i * 4 + 3]! / 255;
            const m = matteMetrics(pred, c.truth, c.width, c.height, 3);
            const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
            rows.push({ ...base, iou: m.iou, mae: m.mae, edgeMae: m.edgeMae, inferenceMs: result.inferenceMs, totalMs: result.totalMs, heapMB: heap ? Math.round(heap / 1e6) : undefined });
          } catch (error) {
            rows.push({ ...base, iou: NaN, mae: NaN, edgeMae: NaN, inferenceMs: NaN, totalMs: NaN, error: String((error as Error).message ?? error).slice(0, 200) });
          }
        }
      }
    }
  }
  return { webGpu: gpu, crossOriginIsolated, cores: navigator.hardwareConcurrency, userAgent: navigator.userAgent, rows };
}
