#!/usr/bin/env node
/**
 * Builds the ground-truth evaluation set: each curated cutout is placed at an identical 1024×1024 size
 * on (a) a studio gradient and (b) a real busy photo, both with a synthetic soft contact shadow.
 * Writes data/set/<id>__<bg>.png (input), <id>.gt.png (alpha), <id>.fg.png (RGB), <id>.shadow.png, and data/set.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const SIZE = 1024;
const data = new URL('./data/', import.meta.url);
const gtList = JSON.parse(await readFile(new URL('gt.json', data), 'utf8'));
const backdrops = JSON.parse(await readFile(new URL('sources.json', data), 'utf8')).backdrops;
await mkdir(new URL('set/', data), { recursive: true });

async function placedObject(file) {
  const { data: px, info } = await sharp(await readFile(new URL(file, data))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (px[(y * info.width + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const crop = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const k = Math.min((SIZE * 0.78) / crop.width, (SIZE * 0.78) / crop.height);
  const w = Math.round(crop.width * k), h = Math.round(crop.height * k);
  const obj = await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).extract(crop).resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer();
  const left = Math.round((SIZE - w) / 2), top = Math.round((SIZE - h) / 2 - SIZE * 0.03);
  const fg = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: obj, raw: { width: w, height: h, channels: 4 }, left, top }]).raw().toBuffer();
  return { fg, box: { left, top, w, h } };
}

async function shadowMap(box) {
  const rx = box.w * 0.42, ry = Math.max(6, box.h * 0.05), cx = box.left + box.w / 2, cy = box.top + box.h - box.h * 0.01;
  const svg = `<svg width="${SIZE}" height="${SIZE}"><rect width="100%" height="100%" fill="black"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/></svg>`;
  const { data: blurred, info } = await sharp(Buffer.from(svg)).blur(Math.max(2, ry * 0.7)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const s = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < s.length; i++) s[i] = blurred[i * info.channels] / 255 * 0.45;
  return s;
}

async function background(kind, index) {
  if (kind === 'studio') {
    const svg = `<svg width="${SIZE}" height="${SIZE}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f5f2"/><stop offset="1" stop-color="#d9d6d0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    return sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
  }
  const b = backdrops[index % backdrops.length];
  return sharp(await readFile(new URL(b.file, data))).resize(SIZE, SIZE, { fit: 'cover' }).removeAlpha().raw().toBuffer();
}

const set = [];
for (const [index, item] of gtList.entries()) {
  const { fg, box } = await placedObject(item.file);
  const shadow = await shadowMap(box);
  const alpha = Buffer.alloc(SIZE * SIZE), rgb = Buffer.alloc(SIZE * SIZE * 3), shadowMask = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    alpha[i] = fg[i * 4 + 3];
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = fg[i * 4 + c];
    shadowMask[i] = shadow[i] > 0.08 ? 255 : 0;
  }
  const raw1 = { raw: { width: SIZE, height: SIZE, channels: 1 } }, raw3 = { raw: { width: SIZE, height: SIZE, channels: 3 } };
  await sharp(alpha, raw1).png().toFile(new URL(`set/${item.id}.gt.png`, data).pathname.slice(1));
  await sharp(rgb, raw3).png().toFile(new URL(`set/${item.id}.fg.png`, data).pathname.slice(1));
  await sharp(shadowMask, raw1).png().toFile(new URL(`set/${item.id}.shadow.png`, data).pathname.slice(1));
  for (const bg of ['studio', 'scene']) {
    const base = await background(bg, index);
    const out = Buffer.alloc(SIZE * SIZE * 3);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const a = alpha[i] / 255, s = shadow[i];
      for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(a * rgb[i * 3 + c] + (1 - a) * base[i * 3 + c] * (1 - s));
    }
    const image = `set/${item.id}__${bg}.png`;
    await sharp(out, raw3).png().toFile(new URL(image, data).pathname.slice(1));
    set.push({ id: `${item.id}__${bg}`, item: item.id, category: item.category, bg, image, gt: `set/${item.id}.gt.png`, fg: `set/${item.id}.fg.png`, shadow: `set/${item.id}.shadow.png`, partialAlpha: item.partialAlpha });
  }
  console.log(`built ${item.id}`);
}
await writeFile(new URL('set.json', data), JSON.stringify(set, null, 1));
console.log(`set entries: ${set.length}`);
