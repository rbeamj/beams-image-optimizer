# Browser-local background removal evaluation

Reviewed October 21, 2026. This is a dependency decision record, not a feature claim.

## Summary

The browser-local background-removal prototype ships U²-Netp (Apache-2.0, ~4.6 MB) as the only exposed model. It is opt-in, fetched separately with `npm run fetch:bg-model`, and never bundled or committed. Inference runs through a replaceable adapter on WASM CPU or WebGPU, with edge cleanup and optional guided-filter refinement, integrated with Studio history/compare/export.

## Decision

- Ship U²-Netp (Apache-2.0, 4.6 MB) as the only exposed model, opt-in, fetched separately (`npm run fetch:bg-model`), never bundled or committed.
- IS-Net rejected: released weights are the "academic version" with no commercial weight grant; DIS5K terms prohibit commercial use.
- BiRefNet_lite not exposed: (1) blocked on ordinary hardware in-browser (fp16 needs shader-f16; fp32 hits WebGPU limits; WASM OOM); (2) weights MIT but trained on DIS5K whose terms prohibit commercial use "even after ... processing" — a residual legal risk to clear with counsel before any adoption. Adapter entry kept for future evaluation.
- Residual risk for U²-Netp: DUTS training-data terms not stated upstream; weights are distributed by the Apache-2.0 project and rehosted by MIT rembg.

## Candidate review

| Model | Code license | Weight license | Training data / terms | Size | Browser result | Decision |
|---|---|---|---|---|---|---|
| U²-Netp | Apache-2.0 | Distributed by Apache-2.0 project; rehosted by MIT rembg | DUTS-TR per U²-Net paper; dataset terms not stated in fetched upstream sources | 4,574,861 bytes | WASM works; WebGPU works | Ship |
| IS-Net / DIS | Apache-2.0 code and evaluation metric | Academic version; no separate weight grant | DIS5K; non-commercial use only; distribution prohibited | Not measured | Not measured | Reject |
| BiRefNet_lite | MIT | MIT (HF front matter and ONNX card) | DIS5K-TR (lite); DIS5K terms prohibit commercial use even after processing | 224,005,088 bytes (fp32); 114,538,221 bytes (fp16) | fp16 WebGPU fails (no shader-f16); fp32 WebGPU fails (storage-buffer limit); fp32 WASM OOM after 18.4 s | Not exposed; adapter kept for future evaluation |
| BRIA RMBG-1.4/2.0 | — | Non-commercial weights; commercial needs agreement | — | — | — | Rejected |
| @imgly/background-removal | AGPL-3.0 | — | — | — | — | Rejected |
| MODNet | Apache-2.0 | Apache-2.0 | Portrait/human-focused | — | Not evaluated as product default | Unsuitable as product default |
| ormbg | Apache-2.0 | Apache-2.0 | Human segmentation datasets | — | Not evaluated | Human-focused |
| InSPyReNet | MIT | Not evaluated | — | — | No ONNX browser artifact in sources | Not evaluated |

## Rejected shortcuts

- `@imgly/background-removal` is AGPL-3.0, which is not compatible with this project's MIT distribution goal. [Upstream license](https://github.com/imgly/background-removal-js)
- BRIA RMBG weights are distributed under non-commercial terms or require a commercial agreement, so they cannot be bundled here as an MIT-friendly default. [Model card](https://huggingface.co/briaai/RMBG-2.0)

## Benchmarks

### Host

Windows 11 (win32 10.0.26200), Intel Core i7-13700K (24 logical cores), 51.2 GB RAM. Browser for in-browser runs: Cursor embedded Chromium 148 (WebGPU adapter available, no `shader-f16` feature, not cross-origin isolated → ORT WASM ran single-threaded). Node 24.19 + onnxruntime-node 1.30 for native CPU runs.

### Native CPU (onnxruntime-node, CPU EP, synthetic input, scripts/benchmark-bg-removal.mjs)

| Model | Input | Load ms | First run ms | Steady run ms | Process RSS after |
|---|---|---|---|---|---|
| u2netp.onnx | 320×320 | 155 | 213 | 89 | 602 MB |
| birefnet-lite.onnx (fp32) | 1024×1024 | 3,702 | 5,116 | 4,882 | 12,471 MB |
| birefnet-lite-fp16.onnx | 1024×1024 | 5,361 | 5,310 | 6,593 | 14,330 MB |

### In-browser compatibility (Cursor Chromium 148)

- u2netp WASM: works. u2netp WebGPU: works.
- BiRefNet_lite fp16 WebGPU: session creation fails — "Program Transpose requires f16 but the device does not support it" (no `shader-f16`).
- BiRefNet_lite fp32 WebGPU: session loads, first run fails — "ShaderVariableHelper ... AddVariableImpl ... numbers_storage" (shader storage-buffer limit).
- BiRefNet_lite fp32 WASM: first run fails — "std::bad_alloc" after 18.4 s (wasm32 4 GB address space).

### Cutout quality

Ground truth = alpha channel of 4 public-domain/CC0 Wikimedia Commons PNG cutouts, longest edge ≤1600, composited onto a plain "studio" gradient and a "busy" textured backdrop; metrics on final alpha; edge band radius 3 px. Images are not committed.

Per-case IoU / MAE / edge-MAE, u2netp, cleanup "balanced", no refinement (identical on WASM and WebGPU):

| Case | IoU | MAE | edge-MAE |
|---|---|---|---|
| soda bottle 475×1600 studio | 0.9954 | 0.0069 | 0.1607 |
| soda bottle busy | 0.9938 | 0.0070 | 0.1715 |
| clear water bottle 499×1600 studio | 0.9908 | 0.0073 | 0.1829 |
| clear water bottle busy | 0.9896 | 0.0084 | 0.1666 |
| worn shoe 1600×1313 studio | 0.9078 | 0.0456 | 0.3969 |
| worn shoe busy | 0.9069 | 0.0460 | 0.3969 |
| shoe (bar) 928×936 studio | 0.9826 | 0.0089 | 0.1458 |
| shoe (bar) busy | 0.9640 | 0.0149 | 0.2060 |

Settings comparison (mean over the 8 cases): edge-MAE / MAE

| Setting | edge-MAE | MAE |
|---|---|---|
| refine off, balanced | 0.2284 | 0.0181 |
| refine off, crisp | 0.2250 | 0.0176 |
| refine on, balanced | 0.2253 | 0.0187 |
| refine on, crisp (shipped default) | 0.2186 | 0.0176 |

Studio-backdrop cases only: edge-MAE 0.2216 (off, balanced) → 0.1890 (on, crisp), about 15% lower. Busy-backdrop cases: 0.2353 → 0.2483 (about 5.5% worse), so the UI hints to disable refinement for busy scenes.

### Timing and memory

Timing (u2netp, model inference / end-to-end incl. resize+mask+alpha, ms): WASM single-thread 885–1,249 / 964–1,613; WebGPU warm 61–71 / 97–184 (first WebGPU run 840 / 1,729 incl. shader compile). Guided-filter refinement adds roughly 90–250 ms (end-to-end minus model time) on WASM-path canvases up to 1600 px. Studio end-to-end (928×936 JPEG, WebGPU, refine on): 570 ms total, 124 ms model.

JS heap (performance.memory.usedJSHeapSize) after runs: 43–140 MB; WASM linear memory is not included in that figure and was not separately measurable without cross-origin isolation.

## Residual risks and gaps

- DUTS training-data terms not stated upstream for U²-Netp.
- BiRefNet_lite weights are MIT but trained on DIS5K, whose terms prohibit commercial use "even after ... processing" — residual legal risk to clear with counsel before any adoption.
- WASM runs single-threaded without cross-origin isolation (COOP/COEP).
- WASM linear memory was not separately measurable without cross-origin isolation.
- The worn shoe is the weakest case (IoU about 0.91, edge-MAE about 0.40); the cause was not analyzed per pixel.
- Mask is 320 px, so fine detail (laces, hair) is limited.
- Refinement hurts on busy backgrounds (edge-MAE about 5.5% worse).

## How to reproduce

- `npm run fetch:bg-model` (`-- --detailed` for BiRefNet files).
- `npm run bench:bg`.
- In-browser harness: `await (await import('/src/bgremove/benchmark.ts')).runBenchmark()` with images placed in `public/bench/`.