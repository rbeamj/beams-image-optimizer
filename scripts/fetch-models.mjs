#!/usr/bin/env node
/**
 * Installs optional local AI models into public/models/ (gitignored, stripped from builds unless allowlisted)
 * and writes public/models/manifest.json so the editor knows what is installed without trial downloads.
 *
 *   npm run fetch:models -- --fast        BiRefNet lite 512 (fp16 + fp32) and U²-Netp
 *   npm run fetch:models -- --quality     BiRefNet lite 1024 WebGPU graphs (fp16 download + fp32 local build)
 *   npm run fetch:models -- --sam         MobileSAM encoder + multi-mask decoder
 *   npm run fetch:models -- --migan       MI-GAN inpainting pipeline
 *   npm run fetch:models -- --enhance     Real-ESRGAN realesr-general-x4v3
 *   npm run fetch:models -- --all [--from <dir>]   (--from copies matching files from a local folder first)
 *
 * The fp32 1024 graph is produced locally by applying the published, MIT-licensed Split/GatherND rewrite
 * (jiabins0303/birefnet-lite-1024-webgpu scripts) to onnx-community/BiRefNet_lite-ONNX. It needs `uv`
 * (preferred) or a Python with the `onnx` and `numpy` packages. See docs/model-licensing.md before hosting.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models');
const HF = 'https://huggingface.co';
const REMBG = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0';

const GROUPS = {
  fast: [
    { file: 'birefnet-lite-512-fp16.onnx', url: `${HF}/studioludens/birefnet-lite-512/resolve/main/onnx/model_fp16.onnx`, bytes: 98484532 },
    { file: 'birefnet-lite-512.onnx', url: `${HF}/studioludens/birefnet-lite-512/resolve/main/onnx/model.onnx`, bytes: 191877254 },
    { file: 'u2netp.onnx', url: `${REMBG}/u2netp.onnx`, bytes: 4574861 },
  ],
  quality: [
    { file: 'birefnet-lite-1024-webgpu-fp16.onnx', url: `${HF}/jiabins0303/birefnet-lite-1024-webgpu/resolve/main/onnx/model_fp16.onnx`, bytes: 114834127 },
    { file: 'birefnet-lite-1024-webgpu-fp32.onnx', build: 'webgpu-fp32' },
  ],
  sam: [
    { file: 'mobilesam-encoder.onnx', url: `${HF}/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx`, bytes: 28157093 },
    { file: 'mobilesam-decoder-multi.onnx', url: `${HF}/Acly/MobileSAM/resolve/main/sam_mask_decoder_multi.onnx`, bytes: 16496559 },
  ],
  migan: [
    { file: 'migan-pipeline-v2.onnx', url: `${HF}/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx`, bytes: 28079181 },
  ],
  enhance: [
    { file: 'realesr-general-x4v3.onnx', url: `${HF}/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx`, bytes: 4866417 },
  ],
};

const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const fromDir = fromIndex >= 0 ? args[fromIndex + 1] : undefined;
const wanted = args.includes('--all') ? Object.keys(GROUPS) : Object.keys(GROUPS).filter(g => args.includes(`--${g}`));
if (!wanted.length) {
  console.log('Choose at least one of --fast --quality --sam --migan --enhance --all');
  process.exit(1);
}

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const size = async path => (await stat(path).catch(() => undefined))?.size;

async function download(url, target, bytes) {
  const res = await fetch(url, { headers: { 'User-Agent': 'beams-image-optimizer/fetch-models' } });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const tmp = `${target}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const got = await size(tmp);
  if (bytes && got !== bytes) throw new Error(`${url}: expected ${bytes} bytes, got ${got}`);
  await rename(tmp, target);
}

function python(script, scriptArgs) {
  const uv = spawnSync('uv', ['run', '--python', '3.12', '--with', 'onnx', '--with', 'numpy', 'python', script, ...scriptArgs], { stdio: 'inherit' });
  if (uv.status === 0) return;
  const py = spawnSync(process.env.PYTHON ?? 'python', [script, ...scriptArgs], { stdio: 'inherit' });
  if (py.status !== 0) throw new Error(`Patch step failed (${script}). Install uv, or a Python with onnx + numpy (set PYTHON).`);
}

async function buildWebgpuFp32(target) {
  const work = join(outDir, '.work');
  await mkdir(work, { recursive: true });
  const base = join(work, 'birefnet-lite-1024.onnx');
  if ((await size(base)) !== 224005088) await download(`${HF}/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx`, base, 224005088);
  for (const script of ['patch_split.py', 'patch_deform.py']) {
    const path = join(work, script);
    if (!existsSync(path)) await download(`${HF}/jiabins0303/birefnet-lite-1024-webgpu/raw/main/scripts/${script}`, path);
  }
  const step1 = join(work, 'step1.onnx');
  python(join(work, 'patch_split.py'), [base, step1]);
  python(join(work, 'patch_deform.py'), [step1, target]);
  await rm(step1, { force: true });
}

await mkdir(outDir, { recursive: true });
const manifestPath = join(outDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{"files":{}}'));
for (const group of wanted) {
  for (const item of GROUPS[group]) {
    const target = join(outDir, item.file);
    const have = await size(target);
    if (item.bytes && have === item.bytes) {
      console.log(`ok    ${item.file}`);
    } else if (fromDir && item.bytes && (await size(join(fromDir, item.file))) === item.bytes) {
      await copyFile(join(fromDir, item.file), target);
      console.log(`copy  ${item.file} (from ${fromDir})`);
    } else if (item.build && fromDir && existsSync(join(fromDir, item.file))) {
      await copyFile(join(fromDir, item.file), target);
      console.log(`copy  ${item.file} (prebuilt, from ${fromDir})`);
    } else if (item.build) {
      if (have && manifest.files[item.file]?.bytes === have) console.log(`ok    ${item.file} (built earlier)`);
      else { console.log(`build ${item.file}`); await buildWebgpuFp32(target); }
    } else {
      console.log(`get   ${item.file}`);
      await download(item.url, target, item.bytes);
    }
    manifest.files[item.file] = { bytes: await size(target), sha256: await sha256(target), source: item.url ?? 'local build (see docs/model-licensing.md)' };
  }
}
manifest.updated = new Date().toISOString();
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifestPath}`);
