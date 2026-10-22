#!/usr/bin/env node
// Curated real-photo set (no ground truth) for blind visual review. Opaque catalogue PNGs are flattened on white.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const data = new URL('./data/', import.meta.url);
const sources = JSON.parse(await readFile(new URL('sources.json', data), 'utf8'));
const byFile = Object.fromEntries(sources.photos.map(p => [p.file, p]));
const keep = ['bag-1', 'bag-2', 'chain-1', 'chain-2', 'clothing-2', 'jewelry-1', 'jewelry-2', 'perfume-1', 'perfume-2', 'reflective-2', 'shoe-1', 'shoe-2', 'transparent-2', 'watch-2'];
const extra = [
  { id: 'coin-photo', raw: 'File_1_Syrian_Lira_coin_1950_.png', title: 'File:1 Syrian Lira coin (1950).png', license: 'Public domain' },
  { id: 'pocketwatch-photo', raw: 'File_Hunter_pocket_watch.png', title: 'File:Hunter pocket watch.png', license: 'CC BY-SA 4.0' },
  { id: 'gold-pendant-photo', raw: 'File_Shropshire_Sun_Pendant_1.png', title: 'File:Shropshire Sun Pendant 1.png', license: 'CC BY-SA 2.5' },
  { id: 'chain-pendant-photo', raw: 'File_VOLIN_ss17_Pendant_001_1_.png', title: 'File:VOLIN ss17 Pendant 001 (1).png', license: 'CC BY-SA 4.0' },
];
const photos = keep.map(id => { const p = byFile[`photos/${id}.jpg`]; return { id, file: `photos/${id}.jpg`, category: p.category, title: p.title, url: p.url, license: p.license, artist: p.artist }; });
for (const e of extra) {
  const file = `photos/${e.id}.jpg`;
  await sharp(await readFile(new URL(`raw/${e.raw}`, data))).flatten({ background: '#ffffff' }).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toFile(decodeURIComponent(new URL(file, data).pathname.slice(1)));
  photos.push({ id: e.id, file, category: e.id.replace('-photo', ''), title: e.title, license: e.license });
}
await writeFile(new URL('photos.json', data), JSON.stringify(photos, null, 1));
console.log(`photos: ${photos.length}`);
