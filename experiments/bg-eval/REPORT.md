# Background-Removal Evaluation Report

## Summary

- **Best-quality model:** BiRefNet HR matting (2048 input) has the best ground-truth metrics (refined composite error 1.46%, IoU 0.915) but is the least reliable on real product photos (~8 blind failures; punches holes into metal/glass).
- **Best production-ready quality:** BiRefNet general 1024 and BiRefNet lite 1024 (refined composite error 1.48% / 1.52%, zero clear failures in the blind review). Neither runs in this browser; the lite model's weights do run through Backgroundless's patched graph on WebGPU adapters with shader-f16.
- **Best browser-viable quality on this hardware:** BiRefNet lite 512 (1.79%, WebGPU 1.4 s, WASM 2.0 s with a 2.2 GB heap; 4 blind failures). U²-Netp (4.4 MB, WASM 347 ms / WebGPU 62 ms, 2.59%) remains the best zero-configuration default.
- **Backgroundless stack:** BiRefNet lite 1024 WebGPU graph (fp16) matches onnx-community BiRefNet lite 1024 exactly (mean mask difference 0.00003) and has 0 blind failures, but requires shader-f16 and fails on the tested adapter/WASM. Its patched graph is not usable here.
- **MobileSAM:** Blind clicks made results worse (e.g. U²-Netp 2.59% → 8.13%). With accept/reject gating (an optimistic emulation of Backgroundless's preview step), up to three clicks cut composite error by about one third for every base model (U²-Netp 2.59% → 1.71%, BiRefNet lite 512 1.79% → 1.24%, BiRefNet lite 1024 1.52% → 1.01%), with about one accepted click per image. Cost: encoder ~200 ms, decoder ~34 ms per click on native CPU.
- **MI-GAN:** Pixels outside the hole are unchanged (mean change ≤ 0.00003), but pixel metrics favour naive smooth fill; visual texture reconstruction is better. Perceptual evaluation is needed. ~210–270 ms per 512² on native CPU.
- **Cross-cutting licensing blocker:** Every candidate with better quality than U²-Netp (BiRefNet family, MobileSAM, MI-GAN) has permissively licensed code and weights but training data under non-commercial / research-only / all-rights-reserved terms (DIS5K, SA-1B, Places2, DUTS). U²-Netp itself (DUTS) is in the same class. Counsel decision required before any weights ship; no model in this study is training-data clean.
- **Bottom-line recommendation:** Adopt U²-Netp as default with guided-filter refinement for ≤512-input models; adopt a two-tier design (fast default + high-quality tier) with accept/reject preview for every AI edit; nothing ships until license sign-off.

## Method

### Ground truth set
- 16 Wikimedia Commons cutouts with real alpha (PD/CC0/CC BY/CC BY-SA; not committed):
  - Coins: 3
  - Shoes: 3
  - Electronics: 4 (phones, Super-8 camera, handheld game)
  - Reflective: 2 (trumpet, silver coins)
  - Transparent-category: 3 (bottles; their alpha is opaque inside, so no true translucency ground truth)
  - Holes: 1 (vented bike helmet)
- Each placed at 1024×1024 (object ≤78% of frame) on:
  - A studio gradient
  - A real busy photo
- Both with a synthetic soft contact shadow → 32 composites total.

### Gaps in ground truth
- Not covered (no usable transparent cutouts exist on Commons): jewelry, watches, chains, clothing → covered by blind visual review only.

### Real-photo blind review set
- 18 Commons product photos, longest edge 1024:
  - Chains ×3 (incl. a silver pendant on a thin chain)
  - Rings
  - Ring + bracelet on a hand
  - Wrist watch on a desk scene
  - Gold pocket watch
  - Gold pendant
  - Coin pair
  - 2 sneakers
  - Robe on hanger
  - 2 handbags in busy shop scenes
  - 2 perfume bottles
  - Wine glass
  - Steel kettle

### Pipeline (identical for all models)
- Square resize to each model's input, publisher normalisation, bilinear mask upsampling to 1024.
- "Raw" = model mask.
- "Refined" = production Studio post-process (guided filter + Crisp edge curve), imported read-only.

### Metrics
- IoU, MAE, edge MAE (3 px band), boundary F (2 px), thin-structure recall, hole leak, halo (1–6 px ring), product loss, shadow inclusion.
- Composite error on white: mean |prediction composite − ground-truth composite| / 255 inside the object neighbourhood; the closest proxy for what a buyer sees.

### Hardware and browser
- Native host: Windows 11, i7-13700K (24 threads), 51 GB RAM, onnxruntime-node 1.30 CPU.
- Browser: Cursor embedded Chromium 148, WebGPU adapter WITHOUT shader-f16, maxStorageBuffersPerShaderStage 16, cross-origin isolated, onnxruntime-web 1.30, WASM 4 threads.

### Blind review limitations
- Panels shuffled per sheet with a stored key; one reviewer (Cursor), blind to model identity only.
- No NVIDIA vision review was possible because the nvai wrapper cannot attach images.

## Quality Results

### Ground truth (mean of 32 composites; refined composite error %, raw → refined)

| Model | Input | Download | Raw comp. err % | Refined comp. err % | Refined IoU | Refined edge MAE | Thin recall | Halo | Shadow incl. | Studio / busy comp. err % |
|---|---|---|---|---|---|---|---|---|---|---|
| BiRefNet HR matting | 2048 | 1048 MB | 1.65 | 1.46 | 0.915 | 0.140 | 0.409 | 0.048 | 0.105 | 1.35 / 1.57 |
| BiRefNet general | 1024 | 928 MB | 1.47 | 1.48 | 0.918 | 0.120 | 0.590 | 0.071 | 0.114 | 0.70 / 2.26 |
| BiRefNet lite | 1024 | 214 MB (fp32) | 1.50 | 1.52 | 0.903 | 0.123 | 0.562 | 0.086 | 0.154 | 0.65 / 2.39 |
| BiRefNet lite 1024 WebGPU graph (Backgroundless, fp16) | 1024 | 110 MB | 1.50 | 1.52 | 0.903 | 0.123 | 0.562 | 0.086 | 0.154 | identical |
| BEN2 base | 1024 | 213 MB | 1.98 | 1.76 | 0.896 | 0.165 | 0.281 | 0.080 | 0.153 | 1.01 / 2.51 |
| BiRefNet lite 512 (studioludens export) | 512 | 183 MB fp32 / 94 MB fp16 | 1.90 | 1.79 | 0.897 | 0.165 | 0.494 | 0.118 | 0.142 | 0.76 / 2.83 |
| RMBG-1.4 (non-commercial reference) | 1024 | 168 MB | 2.02 | 2.02 | 0.847 | 0.164 | 0.548 | 0.177 | 0.279 | 0.68 / 3.35 |
| IS-Net general | 1024 | 170 MB | 2.49 | 2.39 | 0.871 | 0.161 | 0.613 | 0.152 | 0.211 | 0.67 / 4.11 |
| U²-Netp (current) | 320 | 4.4 MB | 2.93 | 2.59 | 0.889 | 0.214 | 0.620 | 0.158 | 0.131 | 0.81 / 4.36 |
| U²-Net | 320 | 168 MB | 3.14 | 2.96 | 0.895 | 0.209 | 0.573 | 0.140 | 0.089 | 0.86 / 5.06 |
| silueta | 320 | 42 MB | 3.74 | 3.34 | 0.887 | 0.253 | 0.358 | 0.123 | 0.086 | 1.29 / 5.40 |

### Refinement effect
- Refinement (guided filter) helps 320/512-input models:
  - U²-Netp: 2.93 → 2.59
  - silueta: 3.74 → 3.34
  - lite-512: 1.90 → 1.79
- Refinement does nothing or slightly worse for 1024+ models.

### Studio vs busy
- On studio backgrounds every model except silueta (1.29%), BEN2 (1.01%) and BiRefNet HR matting (1.35%) is ≤0.86% composite error; the large differences are on busy scenes (1.57%–5.40%).

### Universal failure
- Trumpet held in front of two children on a busy scene: every model ≈0.14 IoU; models segment the people.

## Rankings

| Rank | Ground-truth quality (refined composite error) | Blind visual reliability (18 real photos) | Resource efficiency (error × log2 MB × log2 ms, native) | Runs in this browser today |
|---|---|---|---|---|
| 1 | BiRefNet HR matting 2048 — 1.46% | BiRefNet general 1024 (0 failures) | U²-Netp | BiRefNet lite 512 fp32 — 1.79% |
| 2 | BiRefNet general 1024 — 1.48% | BiRefNet lite 1024 (0) | RMBG-1.4 int8 (non-commercial) | BEN2 — 1.76% (WASM only, 26 s) |
| 3 | BiRefNet lite 1024 / Backgroundless graph — 1.52% | IS-Net (~1) | BiRefNet lite 512 fp16 | RMBG-1.4 — 2.02% (non-commercial) |
| 4 | BEN2 — 1.76% | RMBG-1.4 (2, non-commercial) | Backgroundless BiRefNet lite 1024 graph | IS-Net — 2.39% (academic weights) |
| 5 | BiRefNet lite 512 — 1.79% | BEN2 (~3–4) | RMBG-1.4 | U²-Netp — 2.59% |
| 6 | RMBG-1.4 — 2.02% | BiRefNet lite 512 (4), U²-Netp (4) | BiRefNet lite 512 fp32 | U²-Net — 2.96% |
| 7 | IS-Net — 2.39% | U²-Net, silueta (~5) | BiRefNet lite 1024 | silueta — 3.34% |
| 8 | U²-Netp — 2.59% | BiRefNet HR matting (~8) | silueta, IS-Net, U²-Net, BEN2, BiRefNet general, HR matting | — |

No model reaches "PhotoRoom quality" by our evidence because PhotoRoom itself could not be measured (cloud-only; no uploads were made). The closest browser-local path is BiRefNet lite 1024 (via the patched WebGPU graph on f16-capable GPUs) plus accept/reject MobileSAM clicks: 1.01% composite error on our ground truth, versus 2.59% for today's U²-Netp default.

## Blind Visual Review

18 real photos; failures = clearly unusable cutout of the product.

- **BiRefNet general 1024:** 0 clear failures; top pick on chains/necklace (holes cleared inside links), rings plaque, ring+bracelet (isolated jewelry only).
- **BiRefNet lite 1024:** 0 clear failures; top picks on silver chain pendant, ring+bracelet, rings plaque; second on the watch scene.
- **IS-Net:** ~1 partial (thin chain); best on the wrist-watch desk scene.
- **RMBG-1.4 (reference):** 2 (kept railing behind the hand; kept laptop clutter).
- **BEN2:** ~3–4 (laptop clutter, handbag close-up, noisy chain, plaque remnants).
- **BiRefNet lite 512:** 4 (empty matte on ring+bracelet, laptop clutter on watch scene, handbag close-up, missing chunk of steel kettle); best on silver pendant chain and handbag-in-display.
- **U²-Netp:** 4 (kept the rings' display plaque, partial handbag close-up, ghosted handbag display, dropped perfume atomiser hose and bulb).
- **U²-Net, silueta:** ~5 each (lost thin chains, filled enclosed holes in chains, kept plaque, lost the watch).
- **BiRefNet HR matting:** ~8 (punched holes/transparency into a gold pocket watch, a coin, both perfume bottles, the wine glass; lost rings; no handbag) → matting model treats reflective metal and glass as translucent. Best on ground truth but least reliable on real product photos.
- Plain-background catalogue shots (gold pendant, sneakers, robe, coin, kettle) separate almost no one except HR matting/BiRefNet lite 512 failures above.

### HR-matting paradox
BiRefNet HR matting has the best ground-truth metrics but ~8 blind failures on real product photos because it treats reflective metal and glass as translucent, punching holes into them.

## Resources and Browser Compatibility

### Native resources (onnxruntime-node CPU, 24 threads)

| Model | Init ms | Median infer ms | Peak RSS |
|---|---|---|---|
| U²-Netp | 82 | 56 | 818 MB |
| silueta | 147 | 250 | 892 MB |
| U²-Net | 310 | 126 | 1.15 GB |
| IS-Net | 299 | 337 | 1.82 GB |
| RMBG-1.4 | 352 | 347 | 1.80 GB (int8: 684 ms, 1.70 GB, worse quality 2.05%) |
| BiRefNet lite 512 | 1,429 | 751 | 3.47 GB (fp16 805 ms) |
| BiRefNet lite 1024 WebGPU graph | 3,717 | 2,842 | 8.73 GB |
| BiRefNet lite 1024 | 2,542 | 3,048 | 12.1 GB |
| BEN2 | 2,133 | 3,979 | 7.35 GB |
| BiRefNet general 1024 | 4,256 | 5,640 | 13.2 GB |
| BiRefNet HR matting 2048 | 3,608 | 24,077 | 27.5 GB |

### Browser compatibility (steady-state run ms, WASM linear heap)

**Work on both WASM and WebGPU:**
- U²-Netp: WASM 347 ms / 210 MB; WebGPU 62 ms / 23 MB
- silueta: 620 / 1,176 ms — WebGPU slower
- U²-Net: 860 / 110 ms
- IS-Net: 2,229 / 256 ms
- RMBG-1.4: 2,173 / 169 ms
- RMBG-1.4 int8: 1,774 / 2,649 ms
- BiRefNet lite 512 fp32: WASM 1,983 ms with 2.2 GB heap; WebGPU 1,404 ms

**Failures / limitations:**
- BiRefNet lite 512 fp16: WASM OK 2,526 ms; WebGPU FAIL (needs shader-f16).
- BEN2: WASM OK but 25.9 s and 3.86 GB heap; WebGPU FAIL (session creation: transformer_memcpy provider type).
- BiRefNet lite 1024 (onnx-community fp32/fp16), BiRefNet general 1024 (fp32/fp16), BiRefNet HR matting: all FAIL — WASM std::bad_alloc; WebGPU fp32 storage-buffer error; fp16 needs shader-f16; HR matting "table index out of bounds".
- Backgroundless patched BiRefNet lite 1024 (fp16 only): WebGPU FAIL on this adapter (needs shader-f16); WASM FAIL (std::bad_alloc, 3.6 GB heap). It therefore only runs on adapters exposing shader-f16 — not tested here.

### Why things fail
- WASM: std::bad_alloc (4 GB linear heap effectively caps large models).
- WebGPU: fp32 storage-buffer error; fp16 requires shader-f16 which the tested adapter does not expose.

## Backgroundless Architecture Assessment

### BiRefNet lite 512 + patched 1024 WebGPU graph
- Backgroundless's patched 1024 graph vs onnx-community fp32 BiRefNet lite 1024 on our 32 inputs: mean mask difference 0.00003, max 100/255 (fp16 rounding at isolated pixels) → same quality.
- Backgroundless publishes all of the above on its licenses page and says "All of it is permissively licensed"; it does not discuss training-data terms.
- Its pricing page shows a paid Pro tier ($29.99 one-time sale price); core tools free.
- The patched BiRefNet lite 1024 WebGPU graph (fp16 only) fails on this adapter (needs shader-f16) and on WASM (std::bad_alloc, 3.6 GB heap). It only runs on adapters exposing shader-f16 — not tested here.

### MobileSAM refinement (Magic Click emulation)
- MobileSAM (Acly ONNX: 28 MB encoder + 16.5 MB single-mask decoder = 42.6 MB): WASM encoder ~1.4–1.6 s, decoder ~75 ms; WebGPU encoder 95 ms warm (838 first), decoder ~40 ms warm.
- Wiring check: a single positive click on the product's interior gave IoU 0.90–0.99 on most items; ambiguity failures on multi-part products (one of two coins 0.56; bottle label instead of bottle ~0.18; mean 0.63).
- Blind application of up to 3 clicks made results WORSE (U²-Netp 2.59 → 8.13%, lite-512 1.79 → 9.59%, lite-1024 1.52 → 6.04%) because single-mask SAM often returns the wrong part.
- With accept/reject (a click is kept only if it improves — emulating Backgroundless's preview/accept step; optimistic upper bound):
  - U²-Netp: 2.59 → 1.98 → 1.84 → 1.71% (22/32 images improved)
  - BiRefNet lite 512: 1.79 → 1.41 → 1.31 → 1.24% (18/32)
  - BiRefNet lite 1024: 1.52 → 1.16 → 1.05 → 1.01% (12/32)
- About one accepted click per image on average.
- Native CPU cost: encoder ~200 ms per image, decoder ~34 ms per click.

### MI-GAN cleanup
- MI-GAN pipeline v2 (26.8 MB, 512×512): WASM ~0.8 s; WebGPU 151 ms warm (867 first).
- 8 hole tests on 4 real background photos, 6% and 15% hole area, 512×512.
- Pixels outside the hole unchanged (mean change ≤ 0.00003) → original-integrity friendly.
- Pixel metrics favour a naive smooth fill (e.g. kitchen 6%: MI-GAN PSNR 14.4 vs smooth 18.2), but visually MI-GAN reconstructs texture seamlessly (wood-grain example) while smooth fill leaves grey blurs — pixel error is the wrong metric for inpainting; perceptual evaluation needed.
- ~210–270 ms per 512² on native CPU.

### Vendor claim vs verified
- Backgroundless says "All of it is permissively licensed" on its licenses page but does not discuss training-data terms. We verified training-data terms independently (see License audit).

## PhotoCraft and LightCraft Component Review

- PhotoCraft / LightCraft: dual MIT OR Apache-2.0 (LICENSE-APACHE + LICENSE-MIT; GitHub reports Apache-2.0); ArtCraft names/logos trademark-restricted; repos created 2026-09-30 with 70.7k / 14.2k stars (very young, unusually high stars); alpha.
- PhotoCraft crates: affinity, algo, automation, cms, codecs, color, compose, doc, engine, format, geom, gpu, heif, io, ipp, ops, paint, plugins, psd, raster, raw, tablet, testkit, text, ui-egui, vector.
  - Web build: ~23.9 MiB WASM (10.9 MiB gzipped), WebGPU or WebGL2.
  - Bundles libfacedetection weights (BSD-3-Clause).
- LightCraft crates incl. inpaint (PatchMatch + Poisson membrane fill, ported from PhotoCraft, no dependencies except rayon on non-wasm32 → WASM-compatible single-threaded), segment (SAM 3 via candle; native only; SAM 3 under Meta "SAM License", non-OSI), denoise (RawNIND weights GPL-3.0, opt-in), codecs/heif/tiff/meta/raw.
  - Web build ~13.5 MB WASM (~3.1 MB brotli), WebGL2.
- Assessment: PhotoCraft cms/codecs crates as optional WASM modules (colour management, AVIF/JXL export) — size and API check needed. LightCraft inpaint is license-clean and has no weights; worth benchmarking against MI-GAN with perceptual/human evaluation. LightCraft segment (SAM 3) is native only and non-OSI licensed; RawNIND denoise is GPL-3.0 opt-in.

## Competitor Workflows (Playyy article + Hostinger listicle)

- Competitors: Playyy, Pixelcut, Canva, PicWish, Fotor, Picsart, Remove.bg (closing Dec 1 2026 per article), Claid, Flair AI, Pebblely, Snapshot, Fibbl, CreatorKit, Photoroom.
- All cloud/account-based (processing location not stated); none independently testable without accounts and uploads, which we did not do.
- Quality claims in both articles have no method or data.
- Recurring seller workflows worth matching in a browser-first, original-preserving editor:
  - Marketplace white-background presets with framing rules
  - Batch processing
  - Shadows
  - Brand kits
  - AI scene generation (cloud generative)
  - Mobile capture
  - APIs
- We could not test these because they require accounts and uploads; cloud generative scenes break browser-first and original-integrity goals.

## License and Redistribution Audit

| Component | Code | Weights | Training data / terms | Redistribution obligations | Verdict |
|---|---|---|---|---|---|
| BiRefNet (all variants incl. studioludens 512 export and jiabins 1024 WebGPU graph) | MIT | MIT | general/lite = DIS5K-TR, DIS-TEs, DUTS-TR_TE, HRSOD, UHRSD, HRS10K, TR-P3M-10k, TR-humans; matting = P3M-10k, TR-humans, AM-2k, AIM-500, Human-2k, Distinctions-646, HIM2K, PPM-100. DIS5K: non-commercial research/educational; commercial prohibited even after copying/editing/processing. DUTS: All rights reserved. Distinctions-646: academic-research access by email. P3M-10k and AM-2k: agreement text labelled "(MIT License)" not fetched. | Training-data restrictions may apply; counsel review needed | Reject for shipping pending counsel |
| U²-Netp / U²-Net / silueta | Apache-2.0 | Rehosted by rembg (MIT) | DUTS-TR (per paper); DUTS "All rights reserved" | Training-data restrictions may apply | Same class as BiRefNet; not training-data clean |
| IS-Net | Apache-2.0 | "Academic version" released weights | DIS5K terms above | Reject | Reject |
| BEN2 | — | Base weights MIT | Trained on "DIS5k and our 22K proprietary segmentation dataset"; full model commercial-only | Proprietary training data | Reject |
| RMBG-1.4 | — | — | "Source-available model for non-commercial use"; commercial needs BRIA agreement. RMBG-2.0 gated (not downloaded). | Non-commercial | Reject |
| MobileSAM | Apache-2.0 | Ship in Apache-2.0 repo (weights/mobile_sam.pt); Acly ONNX repo tagged MIT | Distilled on 1% of SA-1B; SA-1B: research purposes only | Research-only training data | Reject for shipping pending counsel |
| MI-GAN | MIT | MIT (LICENSE-WEIGHTS, © 2024 Picsart AI Research); HF ONNX pipeline MIT | Places2 (and FFHQ for face model); Places2: non-commercial research/educational only, no distribution | Non-commercial training data | Reject for shipping pending counsel |
| PhotoCraft | Dual MIT OR Apache-2.0 | Bundles libfacedetection weights (BSD-3-Clause) | — | MIT/Apache-2.0 code; BSD-3-Clause weights | Optional WASM module candidate; size/API check |
| LightCraft | Dual MIT OR Apache-2.0 | Inpaint has no weights; segment uses SAM 3 (Meta SAM License, non-OSI, native only); denoise RawNIND weights GPL-3.0 opt-in | — | SAM 3 non-OSI; RawNIND GPL-3.0 | Inpaint crate license-clean; segment/denoise restricted |
| Backgroundless (published stack) | — | — | Says "All of it is permissively licensed"; does not discuss training-data terms | — | Does not resolve training-data blocker |

Cross-cutting blocker: every candidate with better quality than U²-Netp (BiRefNet family, MobileSAM, MI-GAN) has permissively licensed code and weights but training data under non-commercial / research-only / all-rights-reserved terms (DIS5K, SA-1B, Places2, DUTS). U²-Netp itself (DUTS) is in the same class. This needs a counsel decision before any weights ship; no model in this study is training-data clean.

## Recommendations

| Category | Models / items | Action |
|---|---|---|
| Adopt | U²-Netp as zero-config default; guided-filter refinement only for ≤512-input models; two-tier design (fast default + high-quality tier); accept/reject preview for every AI edit (original stays untouched) | Adopt after license sign-off |
| Adapt | MobileSAM click refinement as opt-in "fix this area" tool with preview/accept; use multi-mask decoder to reduce wrong-part picks; marketplace presets (white background + framing rules) into deterministic scene system | Adapt |
| Benchmark further | (1) Backgroundless BiRefNet lite 1024 WebGPU graph on shader-f16 hardware; (2) BiRefNet lite 512 fp32 memory on 8 GB laptops; (3) MI-GAN vs LightCraft PatchMatch inpaint with perceptual/human evaluation; (4) PhotoCraft cms/codecs crates as optional WASM modules; (5) human multi-reviewer blind study | Benchmark further |
| Reject | IS-Net (academic weights); RMBG-1.4/2.0 (non-commercial); BEN2 (26 s / 3.9 GB WASM, WebGPU fails, proprietary training data); BiRefNet HR matting for products (holes in metal/glass, 1 GB); BiRefNet general 1024 in-browser (928 MB; fails on WASM and WebGPU); U²-Net and silueta (no better than U²-Netp, larger); PhotoCraft/LightCraft as app replacements; cloud competitors' APIs/generative scenes; SAM 3 (Meta SAM License, native only) | Reject |

**Cross-cutting blocker:** Nothing ships until approved. Every candidate with better quality than U²-Netp has permissively licensed code and weights but training data under non-commercial / research-only / all-rights-reserved terms. U²-Netp itself (DUTS) is in the same class. Counsel decision required before any weights ship; no model in this study is training-data clean.

## Representative visual outputs (local, not committed)

Image licenses (CC BY / CC BY-SA) prevent committing derived images; regenerate them with the scripts below.

- `out/sheets/refined-<photo>.jpg`: blind sheets (original + 10 models over a white/charcoal split). Model letters per sheet are in `out/blind-key-refined.json`. Most informative: `chain-2` (holes inside chain links; C = BiRefNet general 1024 best, D/E = U²-Net/silueta keep the black background inside), `jewelry-2` (G/J = BiRefNet lite 1024/general isolate ring and bracelet; F = BiRefNet lite 512 returns an empty matte), `perfume-2` and `transparent-2` (D/A = HR matting turns glass transparent), `jewelry-1` (E = U²-Netp keeps the display plaque).
- `out/visuals/migan-example.jpg`: hole mask, smooth-fill baseline, MI-GAN fill on a wood texture.
- `out/masks/<model>/`: raw and refined masks for every composite and photo.

## Reproduce

Scripts in `experiments/bg-eval/`:
- `fetch-models.mjs`
- `collect-data.mjs` + `curate.mjs` + `select-photos.mjs`
- `prepare-set.mjs`
- `run-all.mjs` / `run-native.mjs`
- `sam-refine.mjs` [blind\|gated]
- `migan-test.mjs`
- `aggregate.mjs`
- `make-sheets.mjs`
- Browser harness: `vite.config.mjs` + `runner.html` + `browser.mjs`

Data, models and outputs are gitignored and never committed.