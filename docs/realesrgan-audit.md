# Real-ESRGAN audit (Photo Studio prototype)

Audit date: 2026-10-21. Scope: optional local AI enhance/upscale for marketplace listing photographs.

## Official repository

| Item | Finding |
| --- | --- |
| Source | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) |
| Code license | **BSD-3-Clause** (Copyright 2021, Xintao Wang) |
| Compact model | `realesr-general-x4v3` — SRVGGNetCompact, 4×, low memory/time |
| Official weights | [v0.2.5.0 release asset](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth) |
| Official pth sha256 | `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292` |

## Weight redistribution

Official release assets ship in the same repository without a separate weight-only license file. Community practice (Upscayl, OpenModelDB, and similar redistributors) treats the BSD-3-Clause terms as covering the released weights: retain copyright/license text; do not use the author's name for endorsement.

**Residual risk (documented, not forced):** Real-ESRGAN training uses DF2K+OST. DIV2K (part of DF2K) historically restricts dataset use to academic research. Whether that restriction flows through to released weights is an open legal question that the author has not answered. This prototype proceeds under BSD-3-Clause attribution for the released weights and records the training-data question as residual risk for product counsel.

GFPGAN / StyleGAN-derived face enhancers are **out of scope** (known non-commercial weight components).

## ONNX export used by this prototype

| Item | Finding |
| --- | --- |
| Artifact | `realesr-general-x4v3.onnx` (4,866,417 bytes) |
| Provenance | Mechanical ONNX export of the official pth (opset 17, NCHW RGB float32 `[0,1]`, dynamic H/W) |
| Reference host | [CoderViking/realesr-general-x4v3-onnx](https://huggingface.co/CoderViking/realesr-general-x4v3-onnx) (HF card license: `bsd-3-clause`) |
| Graph ops | Add, Constant, Conv, DepthToSpace, PRelu, Resize — runs on ORT Web WASM and WebGPU EPs |

Weights are **not** committed to git. Operators fetch them with `npm run fetch:model` into `public/models/` (gitignored). The app loads the model only after an explicit opt-in.

## Runtimes evaluated

| Runtime | License | Fit | Decision |
| --- | --- | --- | --- |
| ONNX Runtime Web | MIT | Browser-local WASM CPU; no dedicated GPU required. WebGPU/JSEP entry deferred (~28 MB wasm vs ~14 MB) | **Selected (wasm entry)** |
| Transformers.js | Apache-2.0 | Extra abstraction; still needs verified weights | Deferred |
| PyTorch / BasicSR | BSD-style / Apache-2.0 | Desktop Python, not the static browser app | Out of scope |
| realesrgan-ncnn-vulkan | BSD family | Native GPU binaries; not embeddable in a static web app | Out of scope |
| Cloud / paid APIs | — | Violates local-first goals | Rejected |

## Product constraints

- Optional only: no automatic AI pass on import or export.
- Inference is local after assets load; pixels stay in the browser.
- The imported original file is never modified; enhance is a Studio history step that undo reverts.
- Longest-edge target 1024 or 2048, aspect preserved (input pre-scaled so 4× lands on target).
- Comparison shows a plain canvas resize to the same size versus the AI result.
- Export uses the shared recipe.
