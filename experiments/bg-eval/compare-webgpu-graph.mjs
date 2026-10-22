import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
const set = JSON.parse(await readFile('data/set.json', 'utf8'));
let sum = 0, max = 0, n = 0;
for (const e of set) {
  const a = await sharp(`out/masks/birefnet-lite-1024/${e.id}.raw.png`).greyscale().raw().toBuffer();
  const b = await sharp(`out/masks/birefnet-lite-1024-webgpu/${e.id}.raw.png`).greyscale().raw().toBuffer();
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; n++; }
}
console.log(`mask diff vs onnx-community fp32 lite-1024: mean ${(sum / n / 255).toFixed(5)}, max ${max}/255 over ${set.length} images`);
