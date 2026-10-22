#!/usr/bin/env node
// Builds data/gt/ from an explicit, title-curated list of Commons cutouts with real alpha.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const UA = 'beams-bg-eval/1.0 (local model evaluation)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CURATED = {
  coin: ['1909-S VDB Lincoln cent obverse transparent background.png', 'Eugenius coin (transparent).png', 'Two 20kr gold coins.png', '1 Syrian Lira coin (1950).png'],
  jewelry: ['VOLIN ss17 Pendant 001 (1).png', 'Shropshire Sun Pendant 1.png', 'Star Carr pendant 1.png'],
  watch: ['Pocket Watch for Young Men with Engraved Nickel Case.png', 'Hunter pocket watch.png', 'New Haven Nickel-Plated Dollar Pocket Watch.png'],
  shoe: ['Shoe bar.png', 'Merrell Vapor Glove 3 shoes.png', 'Worn Shoe.png', 'Creepers shoes Transparent.png'],
  clothing: ['T-shirt mockup.png', 'T-shirt.png', '1860s festive clothing, Tuscany (transparent).png'],
  electronics: ['Iphone 4G-3 des screen.png', 'Canon 310XL Super 8 camera (transparent background).png', 'News camera (with transparent background).png', 'Blackberry-Q10-transparent.png', 'Game-and-watch-ball.png'],
  reflective: ['Trumpet 1.png', 'Gas or Oil Stove Kettle Plated Tinware AL 2244.png', 'Coins of the Italian Republic (500 Lire) silver (Caravels).png'],
  transparent: ['CocaColaBottle background free.png', 'Coca Cola glass bottle transparent.png', 'Cold drinking water bottle transparent.png', 'Utah Teapot - Glass.png'],
  holes: ['Bicycle Helmet 0085 Transparent.png', 'The Atayal bamboo and rattan backpack.png', 'Backpack with non flexible composite straps.png'],
};

async function info(titles) {
  const params = new URLSearchParams({ format: 'json', action: 'query', titles: titles.map(t => `File:${t}`).join('|'), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist', iiurlwidth: '1600' });
  for (let a = 0; a < 4; a += 1) {
    const text = await (await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA } })).text();
    if (text.startsWith('{')) { await sleep(1500); return Object.values(JSON.parse(text).query.pages); }
    await sleep(6000 * (a + 1));
  }
  throw new Error('api');
}
async function download(url, title) {
  const cache = new URL(`./data/raw/${title.replace(/[^\w.-]+/g, '_')}`, import.meta.url);
  try { return await readFile(cache); } catch {}
  for (let a = 0; a < 2; a += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) { const buf = Buffer.from(await res.arrayBuffer()); await writeFile(cache, buf); await sleep(2500); return buf; }
    await sleep(5000);
  }
  return undefined;
}
const strip = s => String(s ?? '').replace(/<[^>]+>/g, '').trim();

await mkdir(new URL('./data/gt/', import.meta.url), { recursive: true });
await mkdir(new URL('./data/raw/', import.meta.url), { recursive: true });
const kept = [];
for (const [category, titles] of Object.entries(CURATED)) {
  const pages = await info(titles);
  let n = 0;
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) { console.log(`missing ${p.title}`); continue; }
    const buf = await download(ii.width > 1600 && ii.thumburl ? ii.thumburl : ii.url, p.title);
    if (!buf) { console.log(`fail ${category} ${p.title} (rate limited)`); continue; }
    const { data, info: meta } = await sharp(buf).ensureAlpha().resize(256, 256, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    let t = 0, o = 0, part = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i] < 10) t++; else if (data[i] > 245) o++; else part++; }
    const px = meta.width * meta.height;
    const ok = t / px > 0.08 && o / px > 0.05;
    console.log(`${ok ? 'keep' : 'skip'} ${category} ${p.title} t=${(t / px).toFixed(2)} o=${(o / px).toFixed(2)} partial=${(part / px).toFixed(3)} ${strip(ii.extmetadata?.LicenseShortName?.value)}`);
    if (!ok) continue;
    n += 1;
    const file = `gt/${category}-${n}.png`;
    await writeFile(new URL(`./data/${file}`, import.meta.url), buf);
    kept.push({ id: `${category}-${n}`, category, file, title: p.title, url: ii.descriptionurl ?? ii.url, license: strip(ii.extmetadata?.LicenseShortName?.value), artist: strip(ii.extmetadata?.Artist?.value), partialAlpha: +(part / px).toFixed(3) });
  }
}
await writeFile(new URL('./data/gt.json', import.meta.url), JSON.stringify(kept, null, 1));
console.log(`kept ${kept.length}`);

