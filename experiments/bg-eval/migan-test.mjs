#!/usr/bin/env node
/**
 * MI-GAN cleanup (inpainting) check on real background photos: irregular holes are cut from 512×512 crops,
 * filled by MI-GAN (andraniksargsyan/migan pipeline v2) and by a naive smooth fill baseline, and compared
 * with the original pixels inside the hole (MAE, PSNR). Also verifies pixels outside the hole are untouched.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import ort from 'onnxruntime-node';
import sharp from 'sharp';

const here = u => decodeURIComponent(new URL(u, import.meta.url).pathname.slice(1));
const S = 512;
const t0 = performance.now();
const session = await ort.InferenceSession.create(here('./models/migan-pipeline-v2.onnx'), { executionProviders: ['cpu'] });
const initMs = performance.now() - t0;

function holeMask(seed, coverage) {
  let s = seed; const rand = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
  const hole = new Uint8Array(S * S);
  let filled = 0;
  while (filled / (S * S) < coverage) {
    const cx = 80 + rand() * (S - 160), cy = 80 + rand() * (S - 160), rx = 20 + rand() * 60, ry = 20 + rand() * 60;
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(S, cy + ry); y++) for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(S, cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && !hole[y * S + x]) { hole[y * S + x] = 1; filled++; }
    }
  }
  return hole;
}

/** Baseline: iterative 4-neighbour averaging from the hole border (a cheap "smooth fill"). */
function smoothFill(rgb, hole) {
  const out = Float32Array.from(rgb);
  for (let iter = 0; iter < 400; iter++) for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x; if (!hole[i]) continue;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = (out[(i - 1) * 3 + c] + out[(i + 1) * 3 + c] + out[(i - S) * 3 + c] + out[(i + S) * 3 + c]) / 4;
  }
  return out;
}

async function migan(rgb, hole, holeValue) {
  const img = new Uint8Array(3 * S * S), mask = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) { for (let c = 0; c < 3; c++) img[c * S * S + i] = rgb[i * 3 + c]; mask[i] = hole[i] ? holeValue : 255 - holeValue; }
  const t = performance.now();
  const out = await session.run({ image: new ort.Tensor('uint8', img, [1, 3, S, S]), mask: new ort.Tensor('uint8', mask, [1, 1, S, S]) });
  const ms = performance.now() - t;
  const r = out.result.data, res = new Float32Array(S * S * 3);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) res[i * 3 + c] = r[c * S * S + i];
  return { res, ms };
}

function score(orig, filled, hole) {
  let inErr = 0, inN = 0, outErr = 0, se = 0;
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) {
    const d = Math.abs(orig[i * 3 + c] - filled[i * 3 + c]);
    if (hole[i]) { inErr += d; se += d * d; inN++; } else outErr += d;
  }
  return { holeMae: +(inErr / inN / 255).toFixed(4), holePsnr: +(10 * Math.log10(255 ** 2 / (se / inN))).toFixed(2), outsideChanged: +(outErr / (S * S * 3 - inN) / 255).toFixed(5) };
}

const sources = JSON.parse(await readFile(here('./data/sources.json'), 'utf8')).backdrops.map(b => b.file);
const rows = [];
let convention;
for (const [bi, file] of sources.entries()) {
  const meta = await sharp(here(`./data/${file}`)).metadata();
  const rgb = await sharp(here(`./data/${file}`)).extract({ left: Math.floor((meta.width - Math.min(meta.width, meta.height)) / 2), top: Math.floor((meta.height - Math.min(meta.width, meta.height)) / 2), width: Math.min(meta.width, meta.height), height: Math.min(meta.width, meta.height) }).resize(S, S).removeAlpha().raw().toBuffer();
  for (const coverage of [0.06, 0.15]) {
    const hole = holeMask(1000 + bi * 7 + Math.round(coverage * 100), coverage);
    if (!convention) {
      const a = score(rgb, (await migan(rgb, hole, 255)).res, hole), b = score(rgb, (await migan(rgb, hole, 0)).res, hole);
      convention = a.outsideChanged < b.outsideChanged ? 255 : 0;
      console.log(`mask convention: hole=${convention} (outside change ${a.outsideChanged} vs ${b.outsideChanged})`);
    }
    const m = await migan(rgb, hole, convention);
    const base = smoothFill(rgb, hole);
    rows.push({ image: file, coverage, migan: { ...score(rgb, m.res, hole), ms: Math.round(m.ms) }, smoothFill: score(rgb, base, hole) });
    if (bi === 0 && coverage === 0.15) {
      const vis = Buffer.alloc(S * S * 3 * 3);
      const put = (arr, off) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let c = 0; c < 3; c++) vis[(y * S * 3 + off * S + x) * 3 + c] = Math.round(arr[(y * S + x) * 3 + c]); };
      const holed = Float32Array.from(rgb); for (let i = 0; i < S * S; i++) if (hole[i]) { holed[i * 3] = 255; holed[i * 3 + 1] = 0; holed[i * 3 + 2] = 255; }
      put(holed, 0); put(base, 1); put(m.res, 2);
      await mkdir(here('./out/visuals/'), { recursive: true });
      await sharp(vis, { raw: { width: S * 3, height: S, channels: 3 } }).jpeg({ quality: 88 }).toFile(here('./out/visuals/migan-example.jpg'));
    }
  }
}
await writeFile(here('./out/migan-results.json'), JSON.stringify({ initMs: Math.round(initMs), convention, rows }, null, 1));
for (const r of rows) console.log(`${r.image.split('/').pop()} ${r.coverage * 100}% | MI-GAN MAE ${r.migan.holeMae} PSNR ${r.migan.holePsnr} outside ${r.migan.outsideChanged} ${r.migan.ms} ms | smooth MAE ${r.smoothFill.holeMae} PSNR ${r.smoothFill.holePsnr}`);
