# Photo Studio AI performance

Measured 2026-10-22 in the running app (`npm run dev`) in the Chromium-based Cursor browser on Windows 11, NVIDIA GTX 1080 Ti (Pascal, **no `shader-f16`**), 2048 MB WebGPU max buffer, 32 GB+ device memory, 24 cores. Test photo: `shoe-2.jpg`, 1536×1010. Models served locally from `public/models/` (so "download" times are local-disk reads). Times come from the app's own status messages; "wall" includes UI work and 250 ms polling.

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

- **fp16 WebGPU paths** (`shader-f16` hardware such as Apple Silicon and recent NVIDIA/AMD/Intel GPUs) could not run on this Pascal GPU. The planner gates them on a successful `shader-f16` feature check, buffer limits and device memory, and falls back automatically on failure; the Backgroundless reference reports near-instant results on an M2.
- **WASM-only devices**: BiRefNet 512 fp16 on WASM measured 2.5 s steady in the benchmark harness (2.0 s fp32); MobileSAM encoder ~1.5 s; MI-GAN ~0.8 s.
- Real Chrome/Edge builds and mobile devices.
