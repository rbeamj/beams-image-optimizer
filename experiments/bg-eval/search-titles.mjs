// Lists Commons PNG/JPEG titles for many queries (no downloads) so ground truth can be curated by title.
const UA = 'beams-bg-eval/1.0 (local model evaluation)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [mime = 'image/png', ...queries] = process.argv.slice(2);
for (const q of queries) {
  const params = new URLSearchParams({ format: 'json', action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '15', gsrsearch: `filemime:${mime} ${q}`, prop: 'imageinfo', iiprop: 'size|extmetadata', iiextmetadatafilter: 'LicenseShortName' });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  if (!text.startsWith('{')) { console.log(`## ${q}: rate limited`); await sleep(8000); continue; }
  const pages = Object.values(JSON.parse(text).query?.pages ?? {});
  console.log(`## ${q}`);
  for (const p of pages) { const i = p.imageinfo?.[0]; if (i && Math.min(i.width, i.height) >= 500) console.log(`  ${i.width}x${i.height} ${i.extmetadata?.LicenseShortName?.value ?? '?'} | ${p.title.replace('File:', '')}`); }
  await sleep(1500);
}
