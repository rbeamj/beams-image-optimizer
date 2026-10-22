#!/usr/bin/env node
/** Copies the ORT Web WASM assets needed for local inference into public/ort/. */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(root, 'public', 'ort');

// The WASM build (~14 MB) serves CPU inference. The asyncify build (~26 MB) is only fetched when
// a user opts into WebGPU background removal.
const files = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs'];

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const file of files) {
  await cp(join(src, file), join(dest, file));
  process.stdout.write(`copied ${file}\n`);
}
