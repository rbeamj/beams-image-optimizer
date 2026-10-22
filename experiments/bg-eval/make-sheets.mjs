#!/usr/bin/env node
/**
 * Blind visual sheets: for each real photo, the original plus every model's refined cutout, shown over a
 * split white/charcoal background (reveals light and dark halos). Panel letters are shuffled per sheet;
 * the key is written separately to out/blind-key.json and is not printed.
 *   node make-sheets.mjs [raw|refined]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { MODELS } from './models.mjs';

const variant = process.argv[2] ?? 'refined';
const CELL = 250;
const data = new URL('./data/', import.meta.url);
const out = new URL('./out/', import.meta.url);
const p = u => decodeURIComponent(u.pathname.slice(1));
await mkdir(new URL('sheets/', out), { recursive: true });
const photos = JSON.parse(await readFile(new URL('photos.json', data), 'utf8'));
// The Backgroundless WebGPU graph produces masks identical to birefnet-lite-1024 (mean diff 3e-5), so it is not shown twice.
const tags = MODELS.map(m => m.id).filter(id => id !== 'birefnet-lite-1024-webgpu');
let seed = 20261021;
const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
const key = {};

async function panel(rgbFile, maskFile, w, h) {
  const rgb = await sharp(rgbFile).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const alpha = await sharp(maskFile).greyscale().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = alpha[i] / 255, bg = x < w / 2 ? 255 : 34;
    for (let c = 0; c < 3; c++) px[i * 3 + c] = Math.round(a * rgb[i * 3 + c] + (1 - a) * bg);
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).resize(CELL, CELL - 22, { fit: 'contain', background: '#808080' }).png().toBuffer();
}
const label = text => Buffer.from(`<svg width="${CELL}" height="22"><rect width="100%" height="100%" fill="#000"/><text x="6" y="16" font-size="15" font-family="Arial" font-weight="bold" fill="#fff">${text}</text></svg>`);

for (const photo of photos) {
  const meta = await sharp(p(new URL(photo.file, data))).metadata();
  const k = Math.min(1, 1024 / Math.max(meta.width, meta.height));
  const w = Math.round(meta.width * k), h = Math.round(meta.height * k);
  const order = tags.map(t => [rand(), t]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  key[photo.id] = {};
  const cells = [{ img: await sharp(p(new URL(photo.file, data))).resize(CELL, CELL - 22, { fit: 'contain', background: '#808080' }).png().toBuffer(), text: 'ORIGINAL' }];
  for (const [i, tag] of order.entries()) {
    const letter = String.fromCharCode(65 + i);
    key[photo.id][letter] = tag;
    try { cells.push({ img: await panel(p(new URL(photo.file, data)), p(new URL(`masks/${tag}/photo-${photo.id}.${variant}.png`, out)), w, h), text: letter }); }
    catch { cells.push({ img: await sharp({ create: { width: CELL, height: CELL - 22, channels: 3, background: '#400' } }).png().toBuffer(), text: `${letter} (no output)` }); }
  }
  const cols = 4, rows = Math.ceil(cells.length / cols);
  const composites = cells.flatMap((c, i) => [{ input: c.img, left: (i % cols) * CELL, top: Math.floor(i / cols) * CELL }, { input: label(c.text), left: (i % cols) * CELL, top: Math.floor(i / cols) * CELL + CELL - 22 }]);
  await sharp({ create: { width: cols * CELL, height: rows * CELL, channels: 3, background: '#555' } }).composite(composites).jpeg({ quality: 85 }).toFile(p(new URL(`sheets/${variant}-${photo.id}.jpg`, out)));
}
await writeFile(new URL(`blind-key-${variant}.json`, out), JSON.stringify(key, null, 1));
console.log(`sheets: ${photos.length} (${variant}); key written, not printed`);
