#!/usr/bin/env node
/**
 * MobileSAM "Magic Click" refinement benchmark (Backgroundless-style keep/erase clicks), simulated with the
 * standard oracle-click protocol from interactive segmentation research:
 *   each round, find the largest remaining error region (missed product = keep, leaked background = erase),
 *   click its most interior pixel, segment around the click with MobileSAM, then
 *   keep:  matte = max(matte, sam)   erase: matte = min(matte, 1 - sam).
 * Starting mattes are the existing refined masks in out/masks/<base>/ (no re-inference of base models).
 *   node sam-refine.mjs <baseTag> [maxClicks=3]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { binarize, erode, evaluate } from './metrics.mjs';

const [base, maxArg, mode = 'blind'] = process.argv.slice(2);
// blind: every click is applied (lower bound). gated: a click is kept only if it lowers composite error,
// emulating a user who previews each Magic Click and rejects visibly worse results (optimistic upper bound).
const MAX = Number(maxArg ?? 3), SIZE = 1024;
const here = u => decodeURIComponent(new URL(u, import.meta.url).pathname.slice(1));
const t0 = performance.now();
const encoder = await ort.InferenceSession.create(here('./models/mobilesam-acly-encoder.onnx'), { executionProviders: ['cpu'] });
const decoder = await ort.InferenceSession.create(here('./models/mobilesam-acly-decoder-single.onnx'), { executionProviders: ['cpu'] });
const initMs = performance.now() - t0;

/** Connected components (4-neighbour) of a binary map; returns the largest component as a mask and its size. */
function largestComponent(bin, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  const stack = [];
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || label[s] !== -1) continue;
    let size = 0; label[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % w, y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && bin[j] && label[j] === -1) { label[j] = id; stack.push(j); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = label[i] === best ? 1 : 0;
  return { mask: out, size: bestSize };
}

/** Most interior pixel: erode until the region would vanish, then take any surviving pixel. */
function interiorPoint(mask, w, h) {
  let cur = mask;
  for (let r = 1; r < 200; r++) {
    const next = erode(mask, w, h, r);
    if (!next.some(v => v)) break;
    cur = next;
  }
  const i = cur.findIndex(v => v);
  return { x: i % w, y: Math.floor(i / w) };
}

async function samAt(embeddings, point, w, h) {
  const feeds = {
    image_embeddings: embeddings,
    point_coords: new ort.Tensor('float32', new Float32Array([point.x, point.y, 0, 0]), [1, 2, 2]),
    point_labels: new ort.Tensor('float32', new Float32Array([1, -1]), [1, 2]),
    mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
    orig_im_size: new ort.Tensor('float32', new Float32Array([h, w]), [2]),
  };
  const out = await decoder.run(feeds);
  const logits = out.masks.data;
  const prob = new Float32Array(w * h);
  for (let i = 0; i < prob.length; i++) prob[i] = 1 / (1 + Math.exp(-logits[i]));
  return prob;
}

const set = JSON.parse(await readFile(here('./data/set.json'), 'utf8'));
const results = { base, sam: 'Acly/MobileSAM (mobile_sam_image_encoder + sam_mask_decoder_single)', initMs: Math.round(initMs), items: [] };
for (const entry of set) {
  const rgb = await sharp(here(`./data/${entry.image}`)).removeAlpha().raw().toBuffer();
  const gtBytes = await sharp(here(`./data/${entry.gt}`)).greyscale().raw().toBuffer();
  const gt = Float32Array.from(gtBytes, v => v / 255);
  const shadowBytes = await sharp(here(`./data/${entry.shadow}`)).greyscale().raw().toBuffer();
  const opts = { shadow: Uint8Array.from(shadowBytes, v => (v > 127 ? 1 : 0)), src: rgb, fg: await sharp(here(`./data/${entry.fg}`)).removeAlpha().raw().toBuffer() };
  let matte = Float32Array.from(await sharp(here(`./out/masks/${base}/${entry.id}.refined.png`)).greyscale().raw().toBuffer(), v => v / 255);
  const te = performance.now();
  const embeddings = (await encoder.run({ input_image: new ort.Tensor('float32', Float32Array.from(rgb), [SIZE, SIZE, 3]) })).image_embeddings;
  const encodeMs = performance.now() - te;
  const rounds = [{ clicks: 0, metrics: evaluate(matte, gt, SIZE, SIZE, opts) }];
  const gtBin = binarize(gt);
  for (let k = 1; k <= MAX; k++) {
    const predBin = binarize(matte);
    const fn = new Uint8Array(gt.length), fp = new Uint8Array(gt.length);
    for (let i = 0; i < gt.length; i++) { fn[i] = gtBin[i] && !predBin[i] ? 1 : 0; fp[i] = !gtBin[i] && predBin[i] ? 1 : 0; }
    const a = largestComponent(fn, SIZE, SIZE), b = largestComponent(fp, SIZE, SIZE);
    const keep = a.size >= b.size;
    const region = keep ? a : b;
    if (region.size < 50) break;
    const point = interiorPoint(region.mask, SIZE, SIZE);
    const td = performance.now();
    const sam = await samAt(embeddings, point, SIZE, SIZE);
    const decodeMs = performance.now() - td;
    const candidate = new Float32Array(matte.length);
    for (let i = 0; i < matte.length; i++) candidate[i] = keep ? Math.max(matte[i], sam[i]) : Math.min(matte[i], 1 - sam[i]);
    const metrics = evaluate(candidate, gt, SIZE, SIZE, opts);
    const accepted = mode !== 'gated' || metrics.compositeError < rounds.at(-1).metrics.compositeError;
    if (accepted) matte = candidate;
    rounds.push({ clicks: k, action: keep ? 'keep' : 'erase', accepted, point, regionPx: region.size, decodeMs: Math.round(decodeMs), metrics: accepted ? metrics : rounds.at(-1).metrics });
    if (!accepted && mode === 'gated') break;
  }
  results.items.push({ id: entry.id, category: entry.category, bg: entry.bg, encodeMs: Math.round(encodeMs), rounds });
  process.stdout.write('.');
}
await mkdir(here('./out/sam/'), { recursive: true });
results.mode = mode;
await writeFile(here(`./out/sam/${base}${mode === 'gated' ? '.gated' : ''}.json`), JSON.stringify(results, null, 1));
const mean = (k, key) => { const v = results.items.map(it => (it.rounds.find(r => r.clicks === k) ?? it.rounds.at(-1)).metrics[key]).filter(x => x != null); return (v.reduce((s, x) => s + x, 0) / v.length).toFixed(4); };
console.log(`\n${base}: composite error %`, [0, 1, 2, 3].map(k => `${k} clicks ${(mean(k, 'compositeError') * 100).toFixed(2)}`).join(' | '), '| IoU', [0, 1, 2, 3].map(k => mean(k, 'iou')).join(' / '));
