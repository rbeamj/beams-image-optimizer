#!/usr/bin/env node
/**
 * Native CPU timing for the optional background-removal models (onnxruntime-node).
 * Browser WASM/WebGPU timings and cutout quality come from the in-browser harness
 * (src/bgremove/benchmark.ts); see docs/background-removal-evaluation.md.
 */
import { existsSync } from 'node:fs';
import { cpus, platform, totalmem } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ort = createRequire(import.meta.url)('onnxruntime-node');
const models = [
  { file: 'u2netp.onnx', size: 320 },
  { file: 'birefnet-lite.onnx', size: 1024 },
  { file: 'birefnet-lite-fp16.onnx', size: 1024 },
];

console.log(`Host: ${platform()} · ${cpus()[0]?.model} · ${cpus().length} logical cores · ${(totalmem() / 1e9).toFixed(1)} GB RAM`);
console.log('| Model | Input | Output | Load ms | First run ms | Median of 3 ms | RSS after |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const model of models) {
  const path = join(root, 'public', 'models', model.file);
  if (!existsSync(path)) { console.log(`| ${model.file} | missing | | | | | |`); continue; }
  try {
    const t0 = performance.now();
    const session = await ort.InferenceSession.create(path, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
    const loadMs = performance.now() - t0;
    const inMeta = session.inputMetadata?.[0];
    const outMeta = session.outputMetadata?.[0];
    const type = inMeta?.type ?? 'float32';
    const n = 3 * model.size * model.size;
    const data = type === 'float16' ? new Uint16Array(n).fill(0x3800) : new Float32Array(n).fill(0.5);
    const feeds = { [session.inputNames[0]]: new ort.Tensor(type, data, [1, 3, model.size, model.size]) };
    const runs = [];
    let out;
    for (let i = 0; i < 4; i += 1) {
      const s = performance.now();
      const result = await session.run(feeds);
      runs.push(performance.now() - s);
      out = result[session.outputNames[0]];
    }
    const steady = runs.slice(1).sort((a, b) => a - b)[1];
    console.log(`| ${model.file} | ${session.inputNames[0]} ${type} [${inMeta?.shape?.join(',') ?? '?'}] | ${session.outputNames[0]} ${out.type} [${out.dims.join(',')}] (${session.outputNames.length} outputs; meta ${outMeta?.type ?? '?'}) | ${loadMs.toFixed(0)} | ${runs[0].toFixed(0)} | ${steady.toFixed(0)} | ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB |`);
    await session.release?.();
  } catch (error) {
    console.log(`| ${model.file} | error: ${String(error.message ?? error).slice(0, 160)} | | | | | |`);
  }
}
