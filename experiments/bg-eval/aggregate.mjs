import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const OUT = join(DIR, "out");
const { MODELS } = await import("./models.mjs");

const byId = new Map(MODELS.map((m) => [m.id, m]));

// ---------- helpers ----------
const fmt = (n, d) => (n == null ? "â€”" : n.toFixed(d));
const mean = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const pct = (x) => (x == null ? "â€”" : (x * 100).toFixed(2));
const dec3 = (x) => (x == null ? "â€”" : x.toFixed(3));
const dec4 = (x) => (x == null ? "â€”" : x.toFixed(4));

const modelLabel = (tag, file) => {
  const m = byId.get(tag.split("@")[0]);
  let label = m ? m.label : tag;
  if (tag.includes("@")) {
    const l = file.toLowerCase();
    if (l.includes("fp16")) label += " [fp16]";
    else if (l.includes("int8")) label += " [int8]";
  }
  return label;
};

const downloadMB = (tag, file) => {
  const m = byId.get(tag.split("@")[0]);
  if (!m) return 0;
  const variant = m.variants?.find((v) => v.file === file);
  return (variant ? variant.bytes : m.bytes) / 1048576;
};

// ---------- load native runs ----------
const runs = readdirSync(join(OUT, "native"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(OUT, "native", f), "utf8")))
  .sort((a, b) => {
    const ra = mean(a.items.map((i) => i.refined.compositeError));
    const rb = mean(b.items.map((i) => i.refined.compositeError));
    return ra - rb;
  });

// ---------- load browser results ----------
let browserRows = [];
try {
  browserRows = JSON.parse(readFileSync(join(OUT, "browser-results.json"), "utf8")).rows;
} catch {}

const browserByFile = new Map();
for (const row of browserRows) {
  const [file, provider, ok, modelMB, initMs, timing, wasmHeapMB, outputRange, error] = row;
  if (!browserByFile.has(file)) browserByFile.set(file, []);
  browserByFile.get(file).push({ file, provider, ok, modelMB, initMs, timing, wasmHeapMB, outputRange, error });
};

const steadyMs = (timing) => {
  if (!timing) return null;
  const parts = String(timing).split("/").map(Number).filter(Number.isFinite);
  return parts.length > 1 ? mean(parts.slice(1)) : parts[0] ?? null;
};

const browserCell = (file) => {
  const rows = browserByFile.get(file);
  if (!rows || rows.length === 0) return "â€”";
  const cells = [];
  for (const r of rows) {
    if (!r.ok) {
      cells.push(`FAIL: ${String(r.error ?? "").slice(0, 60)}`);
      continue;
    }
    const steady = steadyMs(r.timing);
    cells.push(`OK ${steady == null ? "?" : steady.toFixed(0)} ms / ${(r.wasmHeapMB ?? 0).toFixed(0)} MB heap`);
  }
  return cells.join(" | ");
};

// ---------- quality table ----------
const qualityRows = runs.map((run) => {
  const items = run.items;
  const raw = {
    iou: mean(items.map((i) => i.raw.iou)),
    mae: mean(items.map((i) => i.raw.mae)),
    edgeMae: mean(items.map((i) => i.raw.edgeMae)),
    boundaryF: mean(items.map((i) => i.raw.boundaryF)),
    compositeError: mean(items.map((i) => i.raw.compositeError)),
    halo: mean(items.map((i) => i.raw.halo)),
    thinRecall: mean(items.map((i) => i.raw.thinRecall)),
    shadowInclusion: mean(items.map((i) => i.raw.shadowInclusion)),
  };
  const refined = {
    iou: mean(items.map((i) => i.refined.iou)),
    mae: mean(items.map((i) => i.refined.mae)),
    edgeMae: mean(items.map((i) => i.refined.edgeMae)),
    boundaryF: mean(items.map((i) => i.refined.boundaryF)),
    compositeError: mean(items.map((i) => i.refined.compositeError)),
    halo: mean(items.map((i) => i.refined.halo)),
    thinRecall: mean(items.map((i) => i.refined.thinRecall)),
    shadowInclusion: mean(items.map((i) => i.refined.shadowInclusion)),
  };
  return { tag: run.tag, file: run.file, raw, refined };
});

const md = [];
md.push("# Background-Removal Benchmark Summary\n");
md.push("## 1. Quality (raw vs refined)\n");
md.push("| Model | Input | Raw IoU | Raw MAE | Raw Edge MAE | Raw Boundary F | Raw Composite Err | Raw Halo | Raw Thin Recall | Raw Shadow Incl | Refined IoU | Refined MAE | Refined Edge MAE | Refined Boundary F | Refined Composite Err | Refined Halo | Refined Thin Recall | Refined Shadow Incl |");
md.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const r of qualityRows) {
  md.push(`| ${modelLabel(r.tag, r.file)} | ${runInput(r)} | ${dec3(r.raw.iou)} | ${dec4(r.raw.mae)} | ${dec4(r.raw.edgeMae)} | ${dec3(r.raw.boundaryF)} | ${pct(r.raw.compositeError)} | ${dec4(r.raw.halo)} | ${dec3(r.raw.thinRecall)} | ${dec4(r.raw.shadowInclusion)} | ${dec3(r.refined.iou)} | ${dec4(r.refined.mae)} | ${dec4(r.refined.edgeMae)} | ${dec3(r.refined.boundaryF)} | ${pct(r.refined.compositeError)} | ${dec4(r.refined.halo)} | ${dec3(r.refined.thinRecall)} | ${dec4(r.refined.shadowInclusion)} |`);
}
md.push("");

// ---------- per-category refined composite error ----------
const categories = [...new Set(runs.flatMap((r) => r.items.map((i) => i.category)))].sort();
md.push("## 2. Refined Composite Error Ã—100 by Category\n");
md.push("| Model | " + categories.concat(["studio", "scene"]).join(" | ") + " |");
md.push("|---|" + categories.concat(["studio", "scene"]).map(() => "---:").join("|") + "|");
for (const run of runs) {
  const row = [modelLabel(run.tag, run.file)];
  for (const cat of categories) {
    const vals = run.items.filter((i) => i.category === cat).map((i) => i.refined.compositeError);
    row.push(pct(mean(vals)));
  }
  for (const bg of ["studio", "scene"]) {
    const vals = run.items.filter((i) => i.bg === bg).map((i) => i.refined.compositeError);
    row.push(pct(mean(vals)));
  }
  md.push("| " + row.join(" | ") + " |");
}
md.push("");

// ---------- worst-case ----------
md.push("## 3. Worst-Case Items\n");
md.push("| Model | Worst Refined Composite Err Ã—100 | Item | Min Refined IoU | Item |");
md.push("|---|---:|---|---:|---|");
for (const run of runs) {
  const worst = [...run.items].sort((a, b) => b.refined.compositeError - a.refined.compositeError)[0];
  const minIou = [...run.items].sort((a, b) => a.refined.iou - b.refined.iou)[0];
  md.push(`| ${modelLabel(run.tag, run.file)} | ${pct(worst.refined.compositeError)} | ${worst.id} | ${dec3(minIou.refined.iou)} | ${minIou.id} |`);
}
md.push("");

// ---------- resources ----------
md.push("## 4. Resources\n");
md.push("| Model | Download MB | Init ms | First Infer ms | Median Infer ms | Median Refine ms | Peak RSS MB | WASM | WebGPU |");
md.push("|---|---:|---:|---:|---:|---:|---:|---|---|");
for (const run of runs) {
  const rows = browserByFile.get(run.file) || [];
  const wasmRow = rows.find((r) => r.provider === "wasm:4") || rows.find((r) => r.provider.startsWith("wasm"));
  const webgpuRow = rows.find((r) => r.provider.startsWith("webgpu"));
  md.push(`| ${modelLabel(run.tag, run.file)} | ${downloadMB(run.tag, run.file).toFixed(1)} | ${run.initMs} | ${run.firstInferMs} | ${run.medianInferMs} | ${run.medianRefineMs} | ${run.peakRssMB} | ${browserCell(run.file).split(" | ")[0] ?? "â€”"} | ${webgpuRow ? browserCellForProvider(webgpuRow) : "â€”"} |`);
}
md.push("");

// ---------- rankings ----------
md.push("## 5. Rankings\n");
md.push("### (a) Quality (refined composite error, lower better)\n");
qualityRows.forEach((r, i) => md.push(`${i + 1}. ${modelLabel(r.tag, r.file)} â€” ${pct(r.refined.compositeError)}`));
md.push("");

const eff = qualityRows.map((r) => {
  const run = runs.find((x) => x.tag === r.tag);
  const mb = downloadMB(r.tag, r.file);
  const score = r.refined.compositeError * 100 * Math.log2(mb + 1) * Math.log2(run.medianInferMs + 1);
  return { tag: r.tag, score };
}).sort((a, b) => a.score - b.score);
md.push("### (b) Efficiency (quality Ã— log2(MB+1) Ã— log2(ms+1), lower better)\n");
eff.forEach((r, i) => md.push(`${i + 1}. ${modelLabel(r.tag, runs.find((x) => x.tag === r.tag).file)} â€” ${r.score.toFixed(2)}`));
md.push("");

const viable = qualityRows.filter((r) => {
  const rows = browserByFile.get(r.file) || [];
  return rows.some((x) => x.ok);
});
md.push("### (c) Browser-viable (at least one OK provider), ranked by refined composite error\n");
viable.forEach((r, i) => md.push(`${i + 1}. ${modelLabel(r.tag, r.file)} â€” ${pct(r.refined.compositeError)}`));
md.push("");

const markdown = md.join("\n");
writeFileSync(join(OUT, "summary.md"), markdown);

const summary = {
  quality: qualityRows.map((r) => ({ tag: r.tag, file: r.file, raw: r.raw, refined: r.refined })),
  rankings: {
    quality: qualityRows.map((r) => ({ tag: r.tag, compositeError: r.refined.compositeError })),
    efficiency: eff.map((r) => ({ tag: r.tag, score: r.score })),
    browserViable: viable.map((r) => ({ tag: r.tag, compositeError: r.refined.compositeError })),
  },
};
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

console.log(markdown);

// ---------- local helpers used above ----------
function runInput(run) {
  const r = runs.find((x) => x.tag === run.tag);
  return r ? r.inputSize : "â€”";
}
function browserCellForProvider(row) {
  if (!row.ok) return `FAIL: ${String(row.error ?? "").slice(0, 60)}`;
  const steady = steadyMs(row.timing);
  return `OK ${steady == null ? "?" : steady.toFixed(0)} ms / ${(row.wasmHeapMB ?? 0).toFixed(0)} MB heap`;
}
