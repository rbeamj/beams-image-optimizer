#!/usr/bin/env node
// Runs every model (and listed variants) sequentially, each in its own process, so peak RSS is per model.
import { spawnSync } from 'node:child_process';
import { MODELS } from './models.mjs';

const only = process.argv.slice(2);
// 1024 fp16 files are browser-only experiments (they fail in-browser); native quality matches fp32.
const runs = MODELS.flatMap(m => [[m.id], ...(m.variants ?? []).filter(v => !/1024-fp16/.test(v.file)).map(v => [m.id, v.file])]).filter(([id]) => !only.length || only.includes(id));
for (const args of runs) {
  const started = Date.now();
  const r = spawnSync(process.execPath, ['run-native.mjs', ...args], { cwd: new URL('.', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64e6 });
  const tail = (r.stdout || '').trim().split('\n').at(-1);
  const err = (r.stderr || '').split('\n').filter(l => l && !/W:onnxruntime|constant_folding|ExperimentalWarning|--trace-warnings/.test(l)).slice(-3).join(' | ');
  console.log(`${args.join(' ')} [${Math.round((Date.now() - started) / 1000)} s] exit=${r.status} ${tail ?? ''} ${r.status ? err : ''}`);
}
