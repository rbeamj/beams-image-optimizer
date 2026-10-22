#!/usr/bin/env node
/**
 * Collects evaluation images from Wikimedia Commons (free licenses only), with attribution metadata.
 *   cutouts/   PNGs with real alpha (ground truth), by product category
 *   photos/    real marketplace-style JPEG photos (no ground truth; blind visual review)
 *   backdrops/ JPEG scenes used as complex backgrounds for composites
 * Nothing here is committed; see data/sources.json for licenses and authors.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import sharp from 'sharp';

const UA = 'beams-bg-eval/1.0 (local model evaluation; https://github.com/rbeamj/beams-image-optimizer)';
const root = new URL('./data/', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CUTOUTS = {
  coin: ['coin obverse transparent background', 'euro coin png transparent'],
  jewelry: ['ring jewelry transparent background', 'necklace transparent background', 'earrings transparent background'],
  watch: ['wristwatch transparent background', 'watch transparent background'],
  shoe: ['sneaker transparent background', 'shoe transparent background', 'boot transparent background'],
  clothing: ['t-shirt transparent background', 'dress transparent background', 'jacket transparent background'],
  electronics: ['headphones transparent background', 'camera transparent background', 'smartphone transparent background'],
  reflective: ['chrome transparent background', 'kettle transparent background', 'trumpet transparent background'],
  transparent: ['glass transparent background', 'wine glass transparent background', 'bottle glass transparent background'],
  holes: ['bicycle transparent background', 'chair transparent background', 'basket transparent background'],
};
const PHOTOS = {
  watch: 'wristwatch on table', jewelry: 'ring jewelry photograph', chain: 'gold chain necklace photograph', coin: 'coin on table',
  shoe: 'sneakers on floor', clothing: 'shirt on hanger', electronics: 'headphones on desk', camera: 'camera on table',
  reflective: 'stainless steel kettle', transparent: 'wine glass on table', bag: 'handbag product', perfume: 'perfume bottle',
};
const BACKDROPS = ['wooden table texture', 'cluttered desk', 'kitchen counter', 'garden foliage'];

async function api(params) {
  const url = `https://commons.wikimedia.org/w/api.php?format=json&${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const text = await res.text();
    if (res.ok && text.startsWith('{')) { await sleep(1200); return JSON.parse(text); }
    await sleep(4000 * (attempt + 1));
  }
  throw new Error('Commons API unavailable');
}

async function search(query, mime, limit = 12) {
  const json = await api({ action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: String(limit), gsrsearch: `filemime:${mime} ${query}`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist|UsageTerms', iiurlwidth: '1600' });
  return Object.values(json.query?.pages ?? {}).map(p => ({ title: p.title, ...p.imageinfo?.[0] })).filter(p => p.mime === mime);
}

async function download(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) { await sleep(1500); return Buffer.from(await res.arrayBuffer()); }
    await sleep(5000 * (attempt + 1));
  }
  throw new Error(`download failed ${url}`);
}

const strip = s => String(s ?? '').replace(/<[^>]+>/g, '').trim();
const meta = (p, extra) => ({ title: p.title, url: p.url, license: strip(p.extmetadata?.LicenseShortName?.value), artist: strip(p.extmetadata?.Artist?.value), width: p.width, height: p.height, ...extra });

/** Ground-truth suitability: real alpha, both object and background present, photographic (many colours). */
async function cutoutQuality(buffer) {
  const img = sharp(buffer).ensureAlpha().resize(256, 256, { fit: 'inside' });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let transparent = 0, opaque = 0, partial = 0;
  const colours = new Set();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 10) transparent += 1; else if (a > 245) opaque += 1; else partial += 1;
    if (a > 245) colours.add(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
  }
  const n = info.width * info.height;
  return { transparent: transparent / n, opaque: opaque / n, partial: partial / n, colours: colours.size };
}

await mkdir(new URL('cutouts/', root), { recursive: true });
await mkdir(new URL('photos/', root), { recursive: true });
await mkdir(new URL('backdrops/', root), { recursive: true });
const manifest = JSON.parse(await readFile(new URL('sources.json', root), 'utf8').catch(() => '{"cutouts":[],"photos":[],"backdrops":[]}'));
const seen = new Set([...manifest.cutouts, ...manifest.photos, ...manifest.backdrops].map(x => x.title));

for (const [category, queries] of Object.entries(CUTOUTS)) {
  let kept = manifest.cutouts.filter(c => c.category === category).length;
  for (const query of queries) {
    if (kept >= 3) break;
    const results = (await search(query, 'image/png')).filter(p => !seen.has(p.title) && Math.min(p.width, p.height) >= 400 && p.size < 25e6);
    for (const p of results) {
      if (kept >= 3) break;
      seen.add(p.title);
      try {
        const buf = await download(p.thumburl && p.width > 1600 ? p.thumburl : p.url);
        const q = await cutoutQuality(buf);
        const ok = q.transparent > 0.12 && q.transparent < 0.9 && q.opaque > 0.08 && q.colours > 600;
        console.log(`${ok ? 'keep' : 'skip'} cutout/${category} ${p.title} t=${q.transparent.toFixed(2)} o=${q.opaque.toFixed(2)} p=${q.partial.toFixed(3)} c=${q.colours}`);
        if (!ok) continue;
        const file = `cutouts/${category}-${kept + 1}.png`;
        await writeFile(new URL(file, root), buf);
        manifest.cutouts.push(meta(p, { category, file, alphaStats: q }));
        kept += 1;
      } catch (e) { console.log(`err ${p.title}: ${e.message}`); }
    }
  }
}

for (const [category, query] of Object.entries(PHOTOS)) {
  if (manifest.photos.some(x => x.category === category)) continue;
  const results = (await search(query, 'image/jpeg', 10)).filter(p => !seen.has(p.title) && Math.min(p.width, p.height) >= 700);
  let kept = 0;
  for (const p of results.slice(0, 6)) {
    if (kept >= 2) break;
    seen.add(p.title);
    try {
      const buf = await download(p.thumburl ?? p.url);
      const file = `photos/${category}-${kept + 1}.jpg`;
      await writeFile(new URL(file, root), await sharp(buf).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer());
      manifest.photos.push(meta(p, { category, file }));
      kept += 1;
      console.log(`keep photo/${category} ${p.title}`);
    } catch (e) { console.log(`err ${p.title}: ${e.message}`); }
  }
}

for (const query of BACKDROPS) {
  if (manifest.backdrops.some(x => x.query === query)) continue;
  const p = (await search(query, 'image/jpeg', 8)).find(x => !seen.has(x.title) && Math.min(x.width, x.height) >= 1000);
  if (!p) continue;
  seen.add(p.title);
  const buf = await download(p.thumburl ?? p.url);
  const file = `backdrops/${query.replace(/\W+/g, '-')}.jpg`;
  await writeFile(new URL(file, root), await sharp(buf).rotate().resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 92 }).toBuffer());
  manifest.backdrops.push(meta(p, { query, file }));
  console.log(`keep backdrop ${p.title}`);
}

await writeFile(new URL('sources.json', root), JSON.stringify(manifest, null, 1));
console.log(`cutouts=${manifest.cutouts.length} photos=${manifest.photos.length} backdrops=${manifest.backdrops.length}`);
