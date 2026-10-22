#!/usr/bin/env node
/**
 * Downloads optional background-removal ONNX weights into public/models/ (gitignored).
 *   npm run fetch:bg-model              -> u2netp (4.6 MB, default "Fast" model)
 *   npm run fetch:bg-model -- --detailed -> also BiRefNet_lite fp16 + fp32 (~340 MB, "Detailed" model)
 * See docs/background-removal-evaluation.md before redistributing any weights.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models');

const models = [
  { file: 'u2netp.onnx', url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx', bytes: 4574861, detailed: false },
  { file: 'birefnet-lite-fp16.onnx', url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx', bytes: 114538221, detailed: true },
  { file: 'birefnet-lite.onnx', url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx', bytes: 224005088, detailed: true },
];

const wantDetailed = process.argv.includes('--detailed');
await mkdir(outDir, { recursive: true });
for (const model of models.filter(m => wantDetailed || !m.detailed)) {
  const target = join(outDir, model.file);
  const existing = await stat(target).catch(() => undefined);
  if (existing?.size === model.bytes) { process.stdout.write(`ok   ${model.file} (already present)\n`); continue; }
  process.stdout.write(`get  ${model.url}\n`);
  const response = await fetch(model.url);
  if (!response.ok || !response.body) throw new Error(`${model.file}: HTTP ${response.status}`);
  const hash = createHash('sha256');
  const tmp = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), async function* (source) { for await (const chunk of source) { hash.update(chunk); yield chunk; } }, createWriteStream(tmp));
  const size = (await stat(tmp)).size;
  if (size !== model.bytes) throw new Error(`${model.file}: expected ${model.bytes} bytes, got ${size}`);
  await rename(tmp, target);
  process.stdout.write(`done ${model.file} ${size} bytes sha256=${hash.digest('hex')}\n`);
}
