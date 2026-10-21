# Browser-local background removal evaluation

Reviewed October 21, 2026. This is a dependency decision record, not a feature claim.

## Decision

Do not add automatic background removal to the current MIT application yet. The product instead supports a non-destructive solid background for images that already contain transparency.

## Rejected shortcuts

- `@imgly/background-removal` is AGPL-3.0, which is not compatible with this project's MIT distribution goal. [Upstream license](https://github.com/imgly/background-removal-js)
- BRIA RMBG weights are distributed under non-commercial terms or require a commercial agreement, so they cannot be bundled here as an MIT-friendly default. [Model card](https://huggingface.co/briaai/RMBG-2.0)

## Candidate implementation path

Use a separately lazy-loaded browser capability built on [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/tree/main/js/web), whose code is MIT licensed. A model must separately pass all of the following before adoption:

1. Its weights permit commercial use and redistribution.
2. Its license is compatible with this project's MIT distribution.
3. It performs acceptably on ordinary computers using browser WASM/WebGL/WebGPU fallbacks.
4. It has a repeatable product-photo evaluation set, including transparent edges, reflective products, and fine detail.

MODNet's upstream project states Apache-2.0 terms for its code, models, and demos, but it is portrait-focused and is therefore not suitable as the default product-photo model. [MODNet license statement](https://github.com/ZHKKKe/MODNet#license)

No model weights, remote AI services, telemetry, account system, or image-upload backend are included in this milestone.
