#!/usr/bin/env node
// Downloads every candidate (and variants) into ./models with size + sha256 verification.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MODELS } from './models.mjs';

const dir = new URL('./models/', import.meta.url);
await mkdir(dir, { recursive: true });
const only = process.argv.slice(2);
const jobs = MODELS.flatMap(m => [{ id: m.id, file: m.file, url: m.url, bytes: m.bytes }, ...(m.variants ?? []).map(v => ({ id: m.id, ...v }))])
  .filter(j => !only.length || only.includes(j.id));
const manifest = [];
for (const job of jobs) {
  const target = new URL(job.file, dir);
  const existing = await stat(target).catch(() => undefined);
  if (existing?.size === job.bytes) { console.log(`ok   ${job.file}`); manifest.push({ ...job, status: 'present' }); continue; }
  const started = Date.now();
  try {
    const res = await fetch(job.url, { headers: { 'User-Agent': 'beams-bg-eval/1.0' } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const hash = createHash('sha256');
    const tmp = new URL(`${job.file}.part`, dir);
    await pipeline(Readable.fromWeb(res.body), async function* (src) { for await (const c of src) { hash.update(c); yield c; } }, createWriteStream(tmp));
    const size = (await stat(tmp)).size;
    if (size !== job.bytes) throw new Error(`size ${size} != ${job.bytes}`);
    await rename(tmp, target);
    const sha256 = hash.digest('hex');
    manifest.push({ ...job, status: 'downloaded', sha256, seconds: (Date.now() - started) / 1000 });
    console.log(`done ${job.file} ${size} ${sha256}`);
  } catch (error) {
    manifest.push({ ...job, status: 'failed', error: String(error.message ?? error) });
    console.log(`FAIL ${job.file}: ${error.message ?? error}`);
  }
}
await writeFile(new URL('./out/download-manifest.json', import.meta.url), JSON.stringify(manifest, null, 1)).catch(async () => {
  await mkdir(new URL('./out/', import.meta.url), { recursive: true });
  await writeFile(new URL('./out/download-manifest.json', import.meta.url), JSON.stringify(manifest, null, 1));
});
