# Verified facts for the report (measured or checked by Cursor; do NOT change numbers; do not add facts)

## Method (identical for all models)
- Ground truth: 16 Wikimedia Commons cutouts with real alpha (PD/CC0/CC BY/CC BY-SA; not committed): coins 3, shoes 3, electronics 4 (phones, Super-8 camera, handheld game), reflective 2 (trumpet, silver coins), transparent-category 3 (bottles; their alpha is opaque inside, so no true translucency ground truth), holes 1 (vented bike helmet). Each placed at 1024Ã—1024 (object â‰¤78% of frame) on a studio gradient AND on a real busy photo, both with a synthetic soft contact shadow â†’ 32 composites.
- Not covered by ground truth (no usable transparent cutouts exist on Commons): jewelry, watches, chains, clothing â†’ covered by blind visual review only.
- Real photos for blind review: 18 Commons product photos (chains Ã—3 incl. a silver pendant on a thin chain, rings, ring+bracelet on a hand, wrist watch on a desk scene, gold pocket watch, gold pendant, coin pair, 2 sneakers, robe on hanger, 2 handbags in busy shop scenes, 2 perfume bottles, wine glass, steel kettle), longest edge 1024.
- Pipeline: square resize to each model's input, publisher normalisation, bilinear mask upsampling to 1024. "Raw" = model mask. "Refined" = our production Studio post-process (guided filter + Crisp edge curve), imported read-only.
- Metrics: IoU, MAE, edge MAE (3 px band), boundary F (2 px), thin-structure recall, hole leak, halo (1â€“6 px ring), product loss, shadow inclusion, composite error on white (mean |prediction composite âˆ’ ground-truth composite| / 255 inside the object neighbourhood; the closest proxy for what a buyer sees).
- Native host: Windows 11, i7-13700K (24 threads), 51 GB RAM, onnxruntime-node 1.30 CPU. Browser: Cursor embedded Chromium 148, WebGPU adapter WITHOUT shader-f16, maxStorageBuffersPerShaderStage 16, cross-origin isolated, onnxruntime-web 1.30, WASM 4 threads.
- Blind visual review: panels shuffled per sheet with a stored key; one reviewer (Cursor), blind to model identity only; no NVIDIA vision review was possible because the nvai wrapper cannot attach images.

## Quality on ground truth (mean of 32 composites; refined composite error %, rawâ†’refined)
| Model | Input | Download | Raw comp. err % | Refined comp. err % | Refined IoU | Refined edge MAE | Thin recall | Halo | Shadow incl. | Studio / busy comp. err % |
| BiRefNet HR matting | 2048 | 1048 MB | 1.65 | 1.46 | 0.915 | 0.140 | 0.409 | 0.048 | 0.105 | 1.35 / 1.57 |
| BiRefNet general | 1024 | 928 MB | 1.47 | 1.48 | 0.918 | 0.120 | 0.590 | 0.071 | 0.114 | 0.70 / 2.26 |
| BiRefNet lite | 1024 | 214 MB (fp32) | 1.50 | 1.52 | 0.903 | 0.123 | 0.562 | 0.086 | 0.154 | 0.65 / 2.39 |
| BiRefNet lite 1024 WebGPU graph (Backgroundless, fp16) | 1024 | 110 MB | 1.50 | 1.52 | 0.903 | 0.123 | 0.562 | 0.086 | 0.154 | identical |
| BEN2 base | 1024 | 213 MB | 1.98 | 1.76 | 0.896 | 0.165 | 0.281 | 0.080 | 0.153 | 1.01 / 2.51 |
| BiRefNet lite 512 (studioludens export) | 512 | 183 MB fp32 / 94 MB fp16 | 1.90 | 1.79 | 0.897 | 0.165 | 0.494 | 0.118 | 0.142 | 0.76 / 2.83 |
| RMBG-1.4 (non-commercial reference) | 1024 | 168 MB | 2.02 | 2.02 | 0.847 | 0.164 | 0.548 | 0.177 | 0.279 | 0.68 / 3.35 |
| IS-Net general | 1024 | 170 MB | 2.49 | 2.39 | 0.871 | 0.161 | 0.613 | 0.152 | 0.211 | 0.67 / 4.11 |
| UÂ²-Netp (current) | 320 | 4.4 MB | 2.93 | 2.59 | 0.889 | 0.214 | 0.620 | 0.158 | 0.131 | 0.81 / 4.36 |
| UÂ²-Net | 320 | 168 MB | 3.14 | 2.96 | 0.895 | 0.209 | 0.573 | 0.140 | 0.089 | 0.86 / 5.06 |
| silueta | 320 | 42 MB | 3.74 | 3.34 | 0.887 | 0.253 | 0.358 | 0.123 | 0.086 | 1.29 / 5.40 |
- Backgroundless's patched 1024 graph vs onnx-community fp32 BiRefNet lite 1024 on our 32 inputs: mean mask difference 0.00003, max 100/255 (fp16 rounding at isolated pixels) â†’ same quality.
- Refinement (guided filter) helps 320/512-input models (UÂ²-Netp 2.93â†’2.59, silueta 3.74â†’3.34, lite-512 1.90â†’1.79) and does nothing or slightly worse for 1024+ models.
- Universal failure: trumpet held in front of two children on a busy scene (every model â‰ˆ0.14 IoU; models segment the people).
- On studio backgrounds every model except silueta and BEN2 is â‰¤0.86% composite error; the differences are on busy scenes.

## Blind visual review (18 real photos; failures = clearly unusable cutout of the product)
- BiRefNet general 1024: 0 clear failures; top pick on chains/necklace (holes cleared inside links), rings plaque, ring+bracelet (isolated jewelry only).
- BiRefNet lite 1024: 0 clear failures; top picks on silver chain pendant, ring+bracelet, rings plaque; second on the watch scene.
- IS-Net: ~1 partial (thin chain); best on the wrist-watch desk scene.
- RMBG-1.4 (reference): 2 (kept railing behind the hand; kept laptop clutter).
- BEN2: ~3â€“4 (laptop clutter, handbag close-up, noisy chain, plaque remnants).
- BiRefNet lite 512: 4 (empty matte on ring+bracelet, laptop clutter on watch scene, handbag close-up, missing chunk of steel kettle); best on silver pendant chain and handbag-in-display.
- UÂ²-Netp: 4 (kept the rings' display plaque, partial handbag close-up, ghosted handbag display, dropped perfume atomiser hose and bulb).
- UÂ²-Net, silueta: ~5 each (lost thin chains, filled enclosed holes in chains, kept plaque, lost the watch).
- BiRefNet HR matting: ~8 (punched holes/transparency into a gold pocket watch, a coin, both perfume bottles, the wine glass; lost rings; no handbag) â†’ matting model treats reflective metal and glass as translucent. Best on ground truth but least reliable on real product photos.
- Plain-background catalogue shots (gold pendant, sneakers, robe, coin, kettle) separate almost no one except HR matting/BiRefNet lite 512 failures above.

## Native resources (onnxruntime-node CPU, 24 threads)
| Model | Init ms | Median infer ms | Peak RSS |
| UÂ²-Netp | 82 | 56 | 818 MB |
| silueta | 147 | 250 | 892 MB |
| UÂ²-Net | 310 | 126 | 1.15 GB |
| IS-Net | 299 | 337 | 1.82 GB |
| RMBG-1.4 | 352 | 347 | 1.80 GB (int8: 684 ms, 1.70 GB, worse quality 2.05%) |
| BiRefNet lite 512 | 1,429 | 751 | 3.47 GB (fp16 805 ms) |
| BiRefNet lite 1024 WebGPU graph | 3,717 | 2,842 | 8.73 GB |
| BiRefNet lite 1024 | 2,542 | 3,048 | 12.1 GB |
| BEN2 | 2,133 | 3,979 | 7.35 GB |
| BiRefNet general 1024 | 4,256 | 5,640 | 13.2 GB |
| BiRefNet HR matting 2048 | 3,608 | 24,077 | 27.5 GB |

## Browser compatibility (steady-state run ms, WASM linear heap)
- Work on both WASM and WebGPU: UÂ²-Netp (WASM 347 ms / 210 MB; WebGPU 62 ms / 23 MB), silueta (620 / 1,176 ms â€” WebGPU slower), UÂ²-Net (860 / 110 ms), IS-Net (2,229 / 256 ms), RMBG-1.4 (2,173 / 169 ms), RMBG-1.4 int8 (1,774 / 2,649 ms), BiRefNet lite 512 fp32 (WASM 1,983 ms with 2.2 GB heap; WebGPU 1,404 ms).
- BiRefNet lite 512 fp16: WASM OK 2,526 ms; WebGPU FAIL (needs shader-f16).
- BEN2: WASM OK but 25.9 s and 3.86 GB heap; WebGPU FAIL (session creation: transformer_memcpy provider type).
- BiRefNet lite 1024 (onnx-community fp32/fp16), BiRefNet general 1024 (fp32/fp16), BiRefNet HR matting: all FAIL â€” WASM std::bad_alloc; WebGPU fp32 storage-buffer error; fp16 needs shader-f16; HR matting "table index out of bounds".
- Backgroundless patched BiRefNet lite 1024 (fp16 only): WebGPU FAIL on this adapter (needs shader-f16); WASM FAIL (std::bad_alloc, 3.6 GB heap). It therefore only runs on adapters exposing shader-f16 â€” not tested here.
- MobileSAM (Acly ONNX: 28 MB encoder + 16.5 MB single-mask decoder = 42.6 MB): WASM encoder ~1.4â€“1.6 s, decoder ~75 ms; WebGPU encoder 95 ms warm (838 first), decoder ~40 ms warm.
- MI-GAN pipeline v2 (26.8 MB, 512Ã—512): WASM ~0.8 s; WebGPU 151 ms warm (867 first).

## MobileSAM refinement (Magic Click emulation, oracle clicks on our 32 ground-truth composites, starting from our refined masks)
- Wiring check: a single positive click on the product's interior gave IoU 0.90â€“0.99 on most items; ambiguity failures on multi-part products (one of two coins 0.56; bottle label instead of bottle ~0.18; mean 0.63).
- Blind application of up to 3 clicks made results WORSE (UÂ²-Netp 2.59â†’8.13%, lite-512 1.79â†’9.59%, lite-1024 1.52â†’6.04%) because single-mask SAM often returns the wrong part.
- With accept/reject (a click is kept only if it improves â€” emulating Backgroundless's preview/accept step; optimistic upper bound): UÂ²-Netp 2.59â†’1.98â†’1.84â†’1.71% (22/32 images improved); BiRefNet lite 512 1.79â†’1.41â†’1.31â†’1.24% (18/32); BiRefNet lite 1024 1.52â†’1.16â†’1.05â†’1.01% (12/32). About one accepted click per image on average.
- Native CPU cost: encoder ~200 ms per image, decoder ~34 ms per click.

## MI-GAN cleanup (8 hole tests on 4 real background photos, 6% and 15% hole area, 512Ã—512)
- Pixels outside the hole unchanged (mean change â‰¤ 0.00003) â†’ original-integrity friendly.
- Pixel metrics favour a naive smooth fill (e.g. kitchen 6%: MI-GAN PSNR 14.4 vs smooth 18.2), but visually MI-GAN reconstructs texture seamlessly (wood-grain example) while smooth fill leaves grey blurs â€” pixel error is the wrong metric for inpainting; perceptual evaluation needed.
- ~210â€“270 ms per 512Â² on native CPU.

## Licenses (verified against source files)
- BiRefNet (all variants incl. studioludens 512 export and jiabins 1024 WebGPU graph): code + weights MIT. Training sets per BiRefNet model zoo: general/lite = DIS5K-TR, DIS-TEs, DUTS-TR_TE, HRSOD, UHRSD, HRS10K, TR-P3M-10k, TR-humans; matting = P3M-10k, TR-humans, AM-2k, AIM-500, Human-2k, Distinctions-646, HIM2K, PPM-100. DIS5K terms: "non-commercial use in research or educational purpose â€¦ commercial use of this dataset is prohibited even after copying, editing, processing". DUTS page: "All rights reserved by the original authors". Distinctions-646: academic-research access by email. P3M-10k and AM-2k link dataset agreements labelled "(MIT License)" (agreement text not fetched).
- UÂ²-Netp/UÂ²-Net/silueta: code Apache-2.0; weights rehosted by rembg (MIT); training DUTS-TR (per paper) â€” DUTS "All rights reserved".
- IS-Net: code Apache-2.0; released weights described as "the academic version"; DIS5K terms above â†’ reject.
- BEN2: base weights MIT; trained on "DIS5k and our 22K proprietary segmentation dataset"; full model commercial-only.
- RMBG-1.4: "source-available model for non-commercial use"; commercial needs BRIA agreement. RMBG-2.0 gated (not downloaded).
- MobileSAM: code Apache-2.0; weights ship in the Apache-2.0 repo (weights/mobile_sam.pt); Acly ONNX repo tagged MIT; distilled on 1% of SA-1B; SA-1B page: "Intended Use Cases: Research purposes only"; SAM model Apache-2.0.
- MI-GAN: code MIT; LICENSE-WEIGHTS MIT (Â© 2024 Picsart AI Research); Hugging Face ONNX pipeline (andraniksargsyan/migan) LICENSE MIT; trained on Places2 (and FFHQ for the face model); Places2 terms: "use the data only for non-commercial research and educational purposes â€¦ You will NOT distribute the above images".
- Backgroundless publishes all of the above on its licenses page and says "All of it is permissively licensed"; it does not discuss training-data terms. Its pricing page shows a paid Pro tier ($29.99 one-time sale price); core tools free.
- PhotoCraft / LightCraft: dual MIT OR Apache-2.0 (LICENSE-APACHE + LICENSE-MIT; GitHub reports Apache-2.0); ArtCraft names/logos trademark-restricted; repos created 2026-09-30 with 70.7k / 14.2k stars (very young, unusually high stars); alpha.
  - PhotoCraft crates: affinity, algo, automation, cms, codecs, color, compose, doc, engine, format, geom, gpu, heif, io, ipp, ops, paint, plugins, psd, raster, raw, tablet, testkit, text, ui-egui, vector. Web build: ~23.9 MiB WASM (10.9 MiB gzipped), WebGPU or WebGL2. Bundles libfacedetection weights (BSD-3-Clause).
  - LightCraft crates incl. inpaint (PatchMatch + Poisson membrane fill, ported from PhotoCraft, no dependencies except rayon on non-wasm32 â†’ WASM-compatible single-threaded), segment (SAM 3 via candle; native only; SAM 3 under Meta "SAM License", non-OSI), denoise (RawNIND weights GPL-3.0, opt-in), codecs/heif/tiff/meta/raw. Web build ~13.5 MB WASM (~3.1 MB brotli), WebGL2.
- Competitors (Playyy article + Hostinger listicle): Playyy, Pixelcut, Canva, PicWish, Fotor, Picsart, Remove.bg (closing Dec 1 2026 per article), Claid, Flair AI, Pebblely, Snapshot, Fibbl, CreatorKit, Photoroom. All cloud/account-based (processing location not stated); none independently testable without accounts and uploads, which we did not do. Quality claims in both articles have no method or data. Recurring seller workflows: marketplace white-background presets with framing rules, batch processing, shadows, brand kits, AI scene generation (cloud generative), mobile capture, APIs.

## Decision summary (Cursor's recommendations â€” keep as written)
ADOPT (after license sign-off): keep UÂ²-Netp as the zero-config default; keep guided-filter refinement only for â‰¤512-input models; adopt a Backgroundless-style two-tier design (fast default + high-quality tier) and an accept/reject preview for every AI edit (original stays untouched).
ADAPT: MobileSAM click refinement as an opt-in "fix this area" tool with preview/accept â€” largest measured gain per MB (42.6 MB, âˆ’34% composite error with â‰¤3 accepted clicks) â€” use the multi-mask decoder to reduce wrong-part picks. Marketplace presets (white background + framing rules) into our deterministic scene system.
BENCHMARK FURTHER: (1) Backgroundless BiRefNet lite 1024 WebGPU graph on shader-f16 hardware (real Chrome/Edge on common GPUs) â€” best browser-plausible quality (1.52% vs 1.79% for lite-512, 0 blind failures) if the f16 install base is large enough; (2) BiRefNet lite 512 fp32 memory on 8 GB laptops (2.2 GB WASM heap); (3) MI-GAN vs LightCraft PatchMatch inpaint (license-clean, no weights) with perceptual/human evaluation; (4) PhotoCraft cms/codecs crates as optional WASM modules (colour management, AVIF/JXL export) â€” size and API check; (5) human multi-reviewer blind study.
REJECT: IS-Net (academic weights), RMBG-1.4/2.0 (non-commercial), BEN2 (26 s / 3.9 GB WASM, WebGPU fails, proprietary training data), BiRefNet HR matting for products (holes in metal/glass, 1 GB), BiRefNet general 1024 in-browser (928 MB; fails on WASM and WebGPU here), UÂ²-Net and silueta (no better than UÂ²-Netp, larger), PhotoCraft/LightCraft as app replacements, cloud competitors' APIs/generative scenes (break browser-first and original-integrity goals), SAM 3 (Meta SAM License, native only).
CROSS-CUTTING BLOCKER: every candidate with better quality than UÂ²-Netp (BiRefNet family, MobileSAM, MI-GAN) has permissively licensed code and weights but training data under non-commercial / research-only / all-rights-reserved terms (DIS5K, SA-1B, Places2, DUTS). UÂ²-Netp itself (DUTS) is in the same class. This needs a counsel decision before any weights ship; no model in this study is training-data clean.

