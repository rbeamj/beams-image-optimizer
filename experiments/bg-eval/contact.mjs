#!/usr/bin/env node
// node contact.mjs <out.jpg> <cell px> <file...>  — labelled thumbnail grid for quick human review.
import sharp from 'sharp';
const [out, cellArg, ...files] = process.argv.slice(2);
const cell = Number(cellArg) || 220, cols = Math.min(6, files.length), rows = Math.ceil(files.length / cols);
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const tiles = await Promise.all(files.map(async (f, i) => {
  const img = await sharp(f).flatten({ background: '#ff00ff' }).resize(cell, cell - 18, { fit: 'contain', background: '#ff00ff' }).toBuffer();
  const label = Buffer.from(`<svg width="${cell}" height="18"><rect width="100%" height="100%" fill="#111"/><text x="4" y="13" font-size="11" fill="#fff" font-family="Arial">${esc(String(i + 1) + ' ' + f.split(/[\\/]/).pop().slice(0, 34))}</text></svg>`);
  return [{ input: img, left: (i % cols) * cell, top: Math.floor(i / cols) * cell }, { input: label, left: (i % cols) * cell, top: Math.floor(i / cols) * cell + cell - 18 }];
}));
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#222' } }).composite(tiles.flat()).jpeg({ quality: 82 }).toFile(out);
console.log(out);
