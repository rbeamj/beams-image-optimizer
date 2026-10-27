# Photo Studio AI performance

Measured 2026-10-22 in the running app (`npm run dev`) in the Chromium-based Cursor browser on Windows 11, NVIDIA GTX 1080 Ti (Pascal, **no `shader-f16`**), 2048 MB WebGPU max buffer, 32 GB+ device memory, 24 cores. Test photo: `shoe-2.jpg`, 1536×1010. Models served locally from `public/models/` (so "download" times are local-disk reads). Times come from the app's own status messages; "wall" includes UI work and 250 ms polling. Integrated-GPU fp16 numbers are in [fp16 on integrated graphics](#fp16-on-integrated-graphics-intel-uhd-770).

## In-app timings

| Step | Path chosen by Auto | Condition | Total | Model only |
| --- | --- | --- | --- | --- |
| Cutout | Quality 1024 · WebGPU fp32 | first ever (download + cache) | 7.5 s | 2.6 s (download 0.8 s) |
| Cutout | Quality 1024 · WebGPU fp32 | cached file, new page (session compile) | 6.5–7.6 s | 2.6–3.2 s |
| Cutout | Quality 1024 · WebGPU fp32 | warm (same page) | 2.3 s | 2.1 s |
| Cutout | Fast 512 · WebGPU fp32 | cached, new session | 6.5 s | 2.7 s |
| Cutout | Fast 512 · WebGPU fp32 | warm | 2.5 s | 2.0 s |
| Cutout fallback | 1024 simulated OOM → Fast 512 | `?ai-fail=birefnet-1024-webgpu-fp32` | 5.2 s | 2.1 s |
| Magic Click | MobileSAM · WebGPU | first click (load + encode 141–221 ms) | 1.0–1.2 s | — |
| Magic Click | MobileSAM · WebGPU | each further click | 0.29 s | decoder ~40 ms |
| Magic Click | alternative shape | — | 0.16 s | none |
| Cleanup | MI-GAN · WebGPU | first run (load) | 1.05 s | 0.27 s |
| Cleanup | MI-GAN · WebGPU | warm | 0.39 s | 0.16 s |
| Enhance | Real-ESRGAN · WASM | 1536 px photo → 1024 | 4.0 s | — |
| Enhance | Real-ESRGAN · WASM | → 2048 | 16.1 s | — |
| Enhance | repeat on same layer | — | 0 s (no reprocessing) | — |

Before the preview rework (canvas overlay instead of PNG round-trips), warm Magic Click previews took ~2.4 s and cleanup previews ~2.7 s.

Most of a new-page cutout's extra ~4 s is WebGPU session creation (shader compilation) for the 1024/512 fp32 graphs; it is paid once per page. The engine keeps the session alive until a different model is needed or a failure occurs.

## Production build (models from Hugging Face)

`npm run build` + `vite preview`, empty browser cache, same machine and photo, on a fast connection:

| Step | Result |
| --- | --- |
| Cutout, Auto → Quality 1024 fp32 (224 MB original + 0.5 MB graph patch) | 9.7 s total, download 3.2 s, model 2.8 s; checksums verified |
| Cutout, Fast 512 fp32 (192 MB) | 9.3 s, download 2.8 s |
| Cutout with GPU paths failing (simulated) → Fast 512 CPU fp16 (98 MB) | 12.7 s, model 7.6 s (single-threaded: static hosting is not cross-origin isolated) |
| Cutout with all BiRefNet paths failing (simulated) → U²-Netp WebGPU (4.6 MB) | 1.3 s |
| Magic Click first click (encoder 28 MB + decoder 16 MB) | 2.6 s |
| Cleanup first run (MI-GAN 28 MB) | 1.8 s |
| Enhance 2048 first run (Real-ESRGAN 4.9 MB) | 15.6 s |
| Cutout after reload (cached original, patch re-applied) | 6.5 s, no download |
| BiRefNet 1024 fp16 (115 MB) | downloads with CORS and matches its checksum; not runnable on this GPU |

## fp16 on integrated graphics (Intel UHD 770)

Measured 2026-10-27 in the same app (`npm run dev`) driven in the installed Chrome 156 through the DevTools protocol
(headless, throwaway profile, models served from `public/models/`). GPU: **Intel UHD Graphics 770** (`intel` /
`gen-12lp`, **`shader-f16` yes**, 2048 MB WebGPU max buffer, 32 GB+ device memory). Test photo:
`public/bench/worn-shoe-cc0.png`, 2178×1788 (3.6 MB). The photo is larger than the 1536×1010 baseline above, so totals
are not directly comparable; model-only times are (the model input is a fixed square resize).

| Step | Path chosen | Condition | Total | Model only |
| --- | --- | --- | --- | --- |
| Cutout | Quality 1024 · WebGPU **fp16** | first run (file + session compile) | 17.2 s | 10.3 s (load 0.65 s) |
| Cutout | Quality 1024 · WebGPU **fp16** | warm (same page) | 7.9 s | 7.7 s |
| Cutout | Fast 512 · WebGPU **fp16** | first run | 10.5 s | 4.0 s (load 0.50 s) |
| Cutout | Fast 512 · WebGPU **fp16** | warm | 4.0 s | 3.6 s |
| Cutout | Quality 1024 · WebGPU fp32 (fp16 forced to fail) | first run | 22.3 s | 14.9 s (load 1.5 s) |
| Magic Click | MobileSAM · WebGPU (fp32 only) | first click (encode 3.0 s) | 5.8 s | — |
| Magic Click | MobileSAM · WebGPU | second click | 0.26 s | decoder ~0.26 s |
| Cleanup | MI-GAN · WebGPU (fp32 only) | first run | 3.4 s | 1.8 s |
| Cleanup | MI-GAN · WebGPU | second run | 1.1 s | 1.0 s |

Findings:

- **fp16 works and is the planner's first choice.** Auto resolved to `Quality 1024 · WebGPU fp16`, and all three
  cutout runs completed with no console errors or exceptions.
- **fp16 is ~1.9× faster than fp32 on the same GPU**: 7.7 s vs 14.9 s model-only for Quality 1024. Both precisions
  run here (the fp32 graph patch still applies), so this is a direct comparison.
- **fp16 output matches fp32.** Comparing the two 1024 mattes pixel-by-pixel (downsampled to 512 wide, 215,040
  samples): mean absolute difference **0.014/255**, max **18/255**, and only **0.13 %** of pixels differ by more than
  2/255 — confined to anti-aliased edges. No semantic differences.
- **Warm cost is the honest number.** The first run of each model pays WebGPU session creation (~5–7 s on this iGPU);
  the second photo is 7.9 s (Quality) or 4.0 s (Fast).
- **The iGPU is still the slower device overall.** The GTX 1080 Ti needs 2.1 s model-only for fp32 Quality 1024
  versus 7.7 s here in fp16, so on a desktop with a discrete GPU the discrete path remains the better default. The
  integrated GPU is what makes Quality viable on machines that have no discrete GPU at all.
- MobileSAM, MI-GAN and Real-ESRGAN ship fp32-only, so their numbers are identical with or without `shader-f16`.

## Batch Studio presets on integrated graphics (Intel UHD 770)

Measured 2026-10-27 in the running app (`npm run dev`), driven over the DevTools protocol in headless Chrome 156
on the same Intel UHD 770 (`shader-f16`) as the fp16 section, using photos from `public/bench/`. Pipeline per
photo: decode → AI cutout (Auto → Quality 1024 fp16) → headless scene composition → shared-recipe export.

| Photo | Preset / recipe | Cutout | Layout | Encode | Output |
| --- | --- | --- | --- | --- | --- |
| soda-bottle-pd.png | Marketplace white 1:1 · WebP 85% · 1K | 13.1 s (first in session) | 20 ms | 181 ms | 1024×1024, 16 KB |
| water-bottle-cc0.png | Marketplace white 1:1 · WebP 85% · 1K | 7.8 s (warm) | 61 ms | 888 ms | 1024×1024, 8.8 KB |
| worn-shoe-cc0.png | Marketplace white 1:1 · PNG 100% · 1K | 7.4 s (warm) | 58 ms | 671 ms | 1024×1024, 1.0 MB |

Two photos export in 22.4 s wall. The dominant cost is the per-photo cutout — composition stays under 70 ms —
so batch throughput follows model warm-up, exactly like single-photo Studio runs. "My Studio setup", Transparent
PNG, and mid-batch cancel were exercised in the same pass with zero console errors.

**Parity with a single Studio export**: the same photo cut out and framed in Photo Studio, exported through the
Studio export button, and compared pixel-by-pixel with the batch output (both normalized to 1024 px) gives a mean
per-channel difference of **0.96/255**, max 61/255, 2.4 % of pixels above 8/255 — consistent with two independent
resampling chains rendering the same scene graph. Before the comparison-overlay export-leak fix, the same
comparison showed 34.85/255 mean with 38.9 % of pixels above 8/255, because the "before" photo was being rendered
over the left half of Studio exports.

## Memory

- JS heap during the full workflow stayed between 25 and 82 MB (`performance.memory`).
- WASM heap (from the workers, measured in `experiments/bg-eval`): BiRefNet 1024 fp32 on WebGPU ~654 MB; BiRefNet 512 fp32 on WASM ~2.2 GB; U²-Netp WASM ~210 MB. BiRefNet 1024 on WASM exceeds the 4 GB WebAssembly heap (`std::bad_alloc`), so the planner never offers it.
- GPU memory is not observable from the page.

## Comparison with the benchmark (`experiments/bg-eval/REPORT.md`)

| Model | Composite error (refined, 32 GT composites) | Browser path here |
| --- | --- | --- |
| BiRefNet lite 1024 | 1.52% (0 blind-review failures) | Quality: WebGPU fp16 or fp32 rewrite |
| BiRefNet lite 512 | 1.79% (4 failures) | Fast: WebGPU fp16/fp32, WASM fp16 |
| U²-Netp | 2.59% (4 failures) | last resort, WebGPU or WASM |
| + MobileSAM accepted clicks on lite 1024 | 1.01% (≈ −33%) | Magic Click with preview/accept |

The app uses the same graphs and pre/post-processing as the benchmark harness (ImageNet-normalised square resize, sigmoid for BiRefNet; guided-filter edge refinement only for ≤512 inputs), so quality matches the benchmark rows above. Magic Click is gated by Accept because the benchmark showed blindly applied clicks can make results worse.

## Not measured here

- **fp16 on Pascal** (the GPU above) remains impossible: no `shader-f16`, so the planner correctly stays on the fp32 graph patch. fp16 is now measured on Intel gen-12lp (section above); Apple Silicon and AMD `shader-f16` hardware are still unmeasured. The planner gates every fp16 variant on a successful `shader-f16` feature check, buffer limits and device memory, and falls back automatically on failure.
- **WASM-only devices**: BiRefNet 512 fp16 on WASM measured 2.5 s steady in the benchmark harness (2.0 s fp32); MobileSAM encoder ~1.5 s; MI-GAN ~0.8 s.
- Mobile devices and Safari/Firefox WebGPU implementations.
