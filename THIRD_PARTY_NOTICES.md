# Third-party dependency review

Review date: 2026-10-21. The production bundle uses Fabric.js 7.4.0 (MIT) for its interactive Photo Studio canvas. Fabric.js is used only in the browser and adds no service, telemetry, image upload, or AI model. Development and build dependencies are locked in `package-lock.json`.

## Fabric.js 7.4.0

- Source: https://github.com/fabricjs/fabric.js
- License: MIT. The license text was verified against the upstream repository and installed package metadata.
- Security: `npm audit --omit=dev` reported zero vulnerabilities after selecting the patched 7.4.0 release. Earlier Fabric 6.x candidates were rejected because of published SVG serialization advisories.
- Distribution: Fabric.js is bundled into the static browser application. Its optional Node-canvas packages are not used by the browser build.

## Preferred licenses found

The installed dependency tree includes MIT, Apache-2.0, BSD-3-Clause, and ISC packages. These are compatible with the project’s preferred license policy. Their license texts remain available in installed package metadata and registry distributions.

## MPL-2.0 review

Vite resolves the optional build-tool packages `lightningcss` and platform-specific `lightningcss-win32-x64-msvc`, both MPL-2.0. They are development/build dependencies, not an application runtime dependency, and inspection of the generated bundle finds no shipped `lightningcss` code. MPL-2.0 is file-level copyleft: if project-owned MPL-covered files are modified and distributed, their source must be made available under MPL-2.0. This project does not modify or distribute those package files. No additional attribution is required for the application’s MIT source, beyond retaining package notices when redistributing those packages themselves.

## ONNX Runtime Web (optional AI features)

`onnxruntime-web` 1.30.0 (MIT, https://github.com/microsoft/onnxruntime) is lazy-loaded only when the operator runs an opt-in AI tool. Its WASM assets are copied into `public/ort/` at build time. `onnxruntime-node` (MIT) is a development dependency used only by benchmark scripts.

## Real-ESRGAN `realesr-general-x4v3` (optional, not bundled)

- Source: https://github.com/xinntao/Real-ESRGAN — BSD-3-Clause, Copyright (c) 2021, Xintao Wang.
- Weights are fetched by `npm run fetch:model` into `public/models/` and are not committed. Anyone redistributing them must retain the BSD-3-Clause notice, conditions, and disclaimer, and must not use the authors' names to endorse derived products.
- Residual risk: the training data includes DIV2K, whose academic-use terms may not clearly flow through to released weights. See `docs/realesrgan-audit.md`.

## U²-Netp background-removal model (optional, not bundled)

- Source: https://github.com/xuebinqin/U-2-Net — Apache-2.0. The ONNX file (`u2netp.onnx`, 4,574,861 bytes) is downloaded from the MIT-licensed rembg project's release assets by `npm run fetch:bg-model` and is not committed.
- Residual risk: upstream does not state terms for the DUTS training data. See `docs/background-removal-evaluation.md`.
- IS-Net and BiRefNet weights are not used by the app: IS-Net's released weights are an academic version, and both were trained on DIS5K, whose terms prohibit commercial use. BiRefNet files can be fetched with `-- --detailed` for benchmarking only.

No model weights are committed to this repository. Each local-AI addition requires a separate review of source, weight, commercial-use, and redistribution terms.
