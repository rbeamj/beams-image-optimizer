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
- Open question: the weights have no weight-specific license file; they are release assets of the BSD-3-Clause repository. Training-data notes are in `docs/realesrgan-audit.md` and `docs/model-licensing.md`.

## Photo Studio AI models (optional, not bundled)

The app can use these models after an opt-in; none are committed or included in a default build (`npm run fetch:models` downloads them for local use):

- **BiRefNet lite 512 / 1024** — https://github.com/ZhengPeng7/BiRefNet, MIT. ONNX exports from `studioludens/birefnet-lite-512`, `jiabins0303/birefnet-lite-1024-webgpu` and `onnx-community/BiRefNet_lite-ONNX` (Hugging Face). Code and weights MIT.
- **U²-Netp** — https://github.com/xuebinqin/U-2-Net, Apache-2.0; ONNX file from the MIT-licensed rembg release assets.
- **MobileSAM** — https://github.com/ChaoningZhang/MobileSAM, Apache-2.0; ONNX export from `Acly/MobileSAM` (Hugging Face, tagged MIT); retain the upstream Apache-2.0 notice.
- **MI-GAN** — https://github.com/Picsart-AI-Research/MI-GAN, MIT (code and weights, © 2024 Picsart AI Research); ONNX pipeline from `andraniksargsyan/migan` (Hugging Face, MIT).

Anyone hosting these weights must retain the upstream license notices. Training-dataset terms are separate from these weight licenses; see `docs/model-licensing.md` for the license table, dataset terms and open questions.

No model weights are committed to this repository. Each local-AI addition requires a separate review of source, weight, commercial-use, and redistribution terms.
