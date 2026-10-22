# Model licensing — Photo Studio AI

Audit date: 2026-10-21. All inference runs locally in the browser. **No model weights are committed or bundled**: `.onnx` files are gitignored, `npm run build` strips them from `dist/` (unless an operator lists files in `BEAMS_INCLUDE_MODELS`), and `npm run fetch:models` downloads them for local use. Every AI feature is opt-in and never runs automatically.

This is an engineering record, not legal advice.

## Models the app can use

| Feature | Model file(s) | Download source (`scripts/fetch-models.mjs`) | Code license | Weights license | Training data | Commercial status |
| --- | --- | --- | --- | --- | --- | --- |
| Cutout (Quality) | `birefnet-lite-1024-webgpu-fp16.onnx`; `birefnet-lite-1024-webgpu-fp32.onnx` (built locally from `onnx-community/BiRefNet_lite-ONNX` with the jiabins0303 graph-rewrite scripts; numerically identical) | `huggingface.co/jiabins0303/birefnet-lite-1024-webgpu`, `huggingface.co/onnx-community/BiRefNet_lite-ONNX` | MIT (BiRefNet) | MIT | DIS5K-TR, DIS-TEs, DUTS-TR_TE, HRSOD, UHRSD, HRS10K, TR-P3M-10k, TR-humans | **Blocked** by DIS5K / DUTS terms |
| Cutout (Fast) | `birefnet-lite-512-fp16.onnx`, `birefnet-lite-512.onnx` | `huggingface.co/studioludens/birefnet-lite-512` | MIT | MIT | as above | **Blocked** by DIS5K / DUTS terms |
| Cutout (last resort) | `u2netp.onnx` | `github.com/danielgatis/rembg` release `v0.0.0` | Apache-2.0 | rehosted by rembg (MIT) | DUTS-TR (per paper) | **Unclear**: DUTS "All rights reserved" |
| Refine (Magic Click) | `mobilesam-encoder.onnx`, `mobilesam-decoder-multi.onnx` | `huggingface.co/Acly/MobileSAM` | Apache-2.0 (MobileSAM) | Apache-2.0 (upstream); Acly ONNX repo tagged MIT | Distilled on 1% of SA-1B | **Blocked** by SA-1B terms |
| Cleanup | `migan-pipeline-v2.onnx` | `huggingface.co/andraniksargsyan/migan` | MIT | MIT (`LICENSE-WEIGHTS`, © 2024 Picsart AI Research) | Places2 | **Blocked** by Places2 terms |
| Enhance | `realesr-general-x4v3.onnx` | `huggingface.co/CoderViking/realesr-general-x4v3-onnx` (export of the official v0.2.5.0 weights) | BSD-3-Clause | BSD-3-Clause (by community practice; no separate weight license) | DF2K (DIV2K + Flickr2K) + OST | **Residual risk**: DIV2K academic-use terms |

Runtime dependency: ONNX Runtime Web (MIT), served from `public/ort/` and copied from `node_modules` at build time.

## Training-data terms (verbatim)

- **DIS5K** (`experiments/bg-eval/FACTS.md`): "non-commercial use in research or educational purpose … commercial use of this dataset is prohibited even after copying, editing, processing". Affects every BiRefNet variant.
- **DUTS** (`experiments/bg-eval/FACTS.md`): "All rights reserved by the original authors". Affects U²-Netp and BiRefNet.
- **SA-1B** (`experiments/bg-eval/FACTS.md`): "Intended Use Cases: Research purposes only". Affects MobileSAM.
- **Places2** (`experiments/bg-eval/FACTS.md`): "use the data only for non-commercial research and educational purposes … You will NOT distribute the above images". Affects MI-GAN.
- **DIV2K** (`docs/realesrgan-audit.md`): "DIV2K (part of DF2K) historically restricts dataset use to academic research. Whether that restriction flows through to released weights is an open legal question that the author has not answered."

No model evaluated in `experiments/bg-eval/REPORT.md` was found to be training-data clean.

## What ships and what users download

- **Ships (repository and default build):** application code, ONNX Runtime Web assets and the opt-in notices. No weights; the build-time model manifest is filtered to the allowlist, so a default build lists none.
- **Downloaded on first use:** only the model a feature needs, from the deployment's own `models/` folder, cached in the browser's Cache Storage (`beams-models-v1`). For local development those files come from the sources above via `npm run fetch:models`.

## Decisions needed before a commercial release

- Whether hosting or serving weights trained on DIS5K, DUTS, SA-1B or Places2 is acceptable for a commercial product, given the dataset terms above.
- Whether DIV2K's academic-use terms affect the Real-ESRGAN weights.
- If any of these are unacceptable: which features to ship without AI (the scene editor, adjustments and export do not depend on any model), or which replacement models with commercially clean training data to evaluate.
- Owner sign-off on attribution text (BiRefNet, MobileSAM, MI-GAN, Real-ESRGAN, U²-Netp, ONNX Runtime) for any hosted build.

## How this was verified

- `experiments/bg-eval/FACTS.md` and `experiments/bg-eval/REPORT.md`: licenses, model cards and verbatim dataset terms collected during the model evaluation.
- `docs/realesrgan-audit.md`: Real-ESRGAN code, weight and training-data review.
- `scripts/fetch-models.mjs` and `src/ai/models.ts`: the exact files and sources the app uses.
- `vite.config.ts`: build-time stripping of `.onnx` files and manifest filtering.
