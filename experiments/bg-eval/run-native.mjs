#!/usr/bin/env node
/**
 * Native CPU evaluation of ONE model (run once per model in its own process for clean peak-memory numbers):
 *   node run-native.mjs <modelId> [modelFileOverride]
 * Identical pipeline for every model: 1024×1024 inputs, square resize to the model's input size,
 * per-publisher normalisation, bilinear mask upsampling back to 1024×1024.
 * "raw"     = model mask only.
 * "refined" = the production Studio post-process (guided filter + Crisp edge curve), imported read-only.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { evaluate } from './metrics.mjs';
import { MODELS } from './models.mjs';
import { guidedFilter, luminance, refineRadius } from '../../src/bgremove/refine.ts';
import { edgeCurve } from '../../src/bgremove/matte.ts';

const [modelId, fileOverride] = process.argv.slice(2);
const model = MODELS.find(m => m.id === modelId);
if (!model) throw new Error(`unknown model ${modelId}`);
const file = fileOverride ?? model.file;
const tag = fileOverride ? `${model.id}@${fileOverride.replace(/\.onnx$/, '')}` : model.id;
const data = new URL('./data/', import.meta.url);
const outDir = new URL(`./out/masks/${tag}/`, import.meta.url);
await mkdir(outDir, { recursive: true });
const SIZE = 1024;
const path = u => decodeURIComponent(new URL(u, data).pathname.slice(1));

function bilinear(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = new Float32Array(dw * dh), sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
      out[y * dw + x] = (src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx) * (1 - wy) + (src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx) * wy;
    }
  }
  return out;
}

function postprocess(raw) {
  const out = new Float32Array(raw.length);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    let v = Number.isFinite(raw[i]) ? raw[i] : 0;
    if (model.post === 'sigmoid') v = 1 / (1 + Math.exp(-v));
    out[i] = v;
    if (v < min) min = v; if (v > max) max = v;
  }
  if (model.post === 'minmax') { const span = max - min; for (let i = 0; i < out.length; i++) out[i] = span > 1e-6 ? (out[i] - min) / span : 0; }
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, out[i]));
  return out;
}

async function loadRgb(rel, w = SIZE, h = SIZE) {
  return sharp(path(rel)).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
}
async function loadGray(rel) {
  const buf = await sharp(path(rel)).greyscale().raw().toBuffer();
  return buf;
}
async function savePng(alpha, name, W = SIZE, H = SIZE) {
  const bytes = Buffer.alloc(alpha.length);
  for (let i = 0; i < alpha.length; i++) bytes[i] = Math.round(alpha[i] * 255);
  await sharp(bytes, { raw: { width: W, height: H, channels: 1 } }).png().toFile(decodeURIComponent(new URL(name, outDir).pathname.slice(1)));
}

const result = { model: model.id, tag, file, inputSize: model.size, threads: 'ort-node default', items: [], photos: [] };
const t0 = performance.now();
const session = await ort.InferenceSession.create(decodeURIComponent(new URL(`./models/${file}`, import.meta.url).pathname.slice(1)), { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
result.initMs = Math.round(performance.now() - t0);
result.rssAfterInitMB = Math.round(process.memoryUsage().rss / 1e6);
const inputName = session.inputNames[0], outputName = session.outputNames[0];

async function infer(rgbFull, W = SIZE, H = SIZE) {
  const s = model.size;
  const t = performance.now();
  const small = await sharp(rgbFull, { raw: { width: W, height: H, channels: 3 } }).resize(s, s, { fit: 'fill', kernel: 'linear' }).raw().toBuffer();
  const tensor = new Float32Array(3 * s * s);
  for (let i = 0; i < s * s; i++) for (let c = 0; c < 3; c++) tensor[c * s * s + i] = (small[i * 3 + c] / 255 - model.mean[c]) / model.std[c];
  const tPre = performance.now();
  const out = await session.run({ [inputName]: new ort.Tensor('float32', tensor, [1, 3, s, s]) });
  const tInf = performance.now();
  const o = out[outputName];
  const oh = Number(o.dims.at(-2)), ow = Number(o.dims.at(-1));
  const mask = bilinear(postprocess(o.data), ow, oh, W, H);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgbFull[i * 3]; rgba[i * 4 + 1] = rgbFull[i * 3 + 1]; rgba[i * 4 + 2] = rgbFull[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  const tRef = performance.now();
  const guided = guidedFilter(luminance(rgba, W, H), mask, W, H, refineRadius(W, H, s), 1e-4);
  const refined = new Float32Array(guided.length);
  for (let i = 0; i < guided.length; i++) refined[i] = edgeCurve(guided[i], 'crisp');
  const tEnd = performance.now();
  return { mask, refined, timing: { preMs: tPre - t, inferMs: tInf - tPre, postMs: tRef - tInf, refineMs: tEnd - tRef } };
}

const set = JSON.parse(await readFile(new URL('set.json', data), 'utf8'));
for (const entry of set) {
  const rgb = await loadRgb(entry.image);
  const gtBytes = await loadGray(entry.gt);
  const gt = new Float32Array(SIZE * SIZE); for (let i = 0; i < gt.length; i++) gt[i] = gtBytes[i] / 255;
  const shadowBytes = await loadGray(entry.shadow);
  const shadow = new Uint8Array(SIZE * SIZE); for (let i = 0; i < shadow.length; i++) shadow[i] = shadowBytes[i] > 127 ? 1 : 0;
  const fg = await loadRgb(entry.fg);
  const { mask, refined, timing } = await infer(rgb);
  const opts = { shadow, src: rgb, fg };
  result.items.push({ id: entry.id, category: entry.category, bg: entry.bg, timing, raw: evaluate(mask, gt, SIZE, SIZE, opts), refined: evaluate(refined, gt, SIZE, SIZE, opts) });
  await savePng(mask, `${entry.id}.raw.png`);
  await savePng(refined, `${entry.id}.refined.png`);
  process.stdout.write('.');
}

const photos = JSON.parse(await readFile(new URL('photos.json', data), 'utf8').catch(() => '[]'));
for (const photo of photos) {
  const { data: rgb, info } = await sharp(path(photo.file)).removeAlpha().resize(SIZE, SIZE, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const { mask, refined, timing } = await infer(rgb, info.width, info.height);
  result.photos.push({ id: photo.id, width: info.width, height: info.height, timing });
  await savePng(mask, `photo-${photo.id}.raw.png`, info.width, info.height);
  await savePng(refined, `photo-${photo.id}.refined.png`, info.width, info.height);
  process.stdout.write('p');
}

const infers = result.items.map(x => x.timing.inferMs).concat(result.photos.map(x => x.timing.inferMs));
const sorted = infers.slice(1).sort((a, b) => a - b);
result.firstInferMs = Math.round(infers[0] ?? 0);
result.medianInferMs = Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
result.medianRefineMs = Math.round(result.items.map(x => x.timing.refineMs).sort((a, b) => a - b)[Math.floor(result.items.length / 2)] ?? 0);
result.peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
await mkdir(new URL('./out/native/', import.meta.url), { recursive: true });
await writeFile(new URL(`./out/native/${tag}.json`, import.meta.url), JSON.stringify(result, null, 1));
console.log(`\n${tag}: init ${result.initMs} ms, first ${result.firstInferMs} ms, median ${result.medianInferMs} ms, peak RSS ${result.peakRssMB} MB`);
