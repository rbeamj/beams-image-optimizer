#!/usr/bin/env node
/**
 * Downloads the compact realesr-general-x4v3 ONNX weights into public/models/.
 * Weights are gitignored; run before local AI Enhance demos or browser benchmarks.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'public', 'models', 'realesr-general-x4v3.onnx');

const MODEL_URL = process.env.REALESRGAN_ONNX_URL
  || 'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx';

await mkdir(dirname(outFile), { recursive: true });
process.stdout.write(`Fetching ${MODEL_URL}\n`);
const response = await fetch(MODEL_URL);
if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
const buffer = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(buffer).digest('hex');
await writeFile(outFile, buffer);
process.stdout.write(`Wrote ${outFile} (${buffer.length} bytes, sha256=${sha256})\n`);
