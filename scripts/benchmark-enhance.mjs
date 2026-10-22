#!/usr/bin/env node
/**
 * CPU timing harness for realesr-general-x4v3 via onnxruntime-node.
 * Browser WASM timings are reported by the Studio Enhance panel after opt-in.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = join(root, 'public', 'models', 'realesr-general-x4v3.onnx');
const outPath = join(root, 'docs', 'realesrgan-benchmark.md');
const require = createRequire(import.meta.url);

const modelInputLongEdge = target => Math.ceil(target / 4);
function dims(w, h, edge) {
  if (Math.max(w, h) <= edge) return { width: w, height: h };
  const scale = edge / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
function estimatePeakBytes(w, h) {
  return (w * h * 3 + w * 4 * h * 4 * 3) * 4 + (w * h * 4 + w * 4 * h * 4 * 4) + 5_000_000 + 8_000_000;
}

const cases = [
  { label: 'listing-1k-from-800x600', sourceW: 800, sourceH: 600, target: 1024 },
  { label: 'listing-2k-from-1600x1200', sourceW: 1600, sourceH: 1200, target: 2048 },
  { label: 'phone-1k-from-4032x3024', sourceW: 4032, sourceH: 3024, target: 1024 },
];

const lines = [
  '# Real-ESRGAN prototype benchmarks',
  '',
  `Generated: ${new Date().toISOString()}`,
  `Host: ${platform()} · ${cpus()[0]?.model ?? 'unknown CPU'} · ${cpus().length} logical cores · ${(totalmem() / 1e9).toFixed(1)} GB RAM`,
  '',
];

if (!existsSync(modelPath)) {
  lines.push('Model missing. Run `npm run fetch:model` then re-run `npm run bench:enhance`.', '');
  writeFileSync(outPath, lines.join('\n'));
  console.error('Model missing; wrote placeholder report.');
  process.exit(0);
}

const modelBytes = readFileSync(modelPath);
lines.push('## Model', '', '| Field | Value |', '| --- | --- |', '| File | `public/models/realesr-general-x4v3.onnx` |', `| Bytes | ${modelBytes.length} |`, `| sha256 | \`${createHash('sha256').update(modelBytes).digest('hex')}\` |`, '');
lines.push('## Planning estimates', '', '| Case | Model input | Output | Peak working set (estimate) |', '| --- | --- | --- | --- |');
for (const c of cases) {
  const input = dims(c.sourceW, c.sourceH, modelInputLongEdge(c.target));
  const out = dims(input.width * 4, input.height * 4, c.target);
  lines.push(`| ${c.label} | ${input.width}×${input.height} | ${out.width}×${out.height} | ${(estimatePeakBytes(input.width, input.height) / 1e6).toFixed(1)} MB |`);
}
lines.push('');

let ort;
try { ort = require('onnxruntime-node'); } catch { ort = null; }
if (!ort) {
  lines.push('`onnxruntime-node` is unavailable; CPU timings skipped.', '');
  writeFileSync(outPath, lines.join('\n'));
  console.log(lines.join('\n'));
  process.exit(0);
}

const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
lines.push('## CPU inference (`onnxruntime-node`, measured)', '', '| Case | Input | Output | Elapsed ms | RSS after run |', '| --- | --- | --- | --- | --- |');
for (const c of cases) {
  const input = dims(c.sourceW, c.sourceH, modelInputLongEdge(c.target));
  const floats = new Float32Array(3 * input.width * input.height).fill(0.45);
  const tensor = new ort.Tensor('float32', floats, [1, 3, input.height, input.width]);
  const t0 = performance.now();
  const result = await session.run({ [session.inputNames[0]]: tensor });
  const elapsed = performance.now() - t0;
  const out = result[session.outputNames[0]];
  lines.push(`| ${c.label} | ${input.width}×${input.height} | ${out.dims[3]}×${out.dims[2]} | ${elapsed.toFixed(0)} | ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB |`);
}
lines.push('', 'Browser WASM is typically slower than native CPU; the Studio Enhance status line reports in-browser elapsed time.', '');
writeFileSync(outPath, lines.join('\n'));
console.log(lines.join('\n'));
