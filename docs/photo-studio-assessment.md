# Photo Studio technical assessment

## Existing baseline

The alpha already provides a clean browser-only optimizer engine, orientation-aware decode, bounded resize, JPEG/PNG/WebP export, file validation, sequential batch processing, cancellation boundaries, and a responsive static UI. The engine is independent of the UI and remains the export owner for the optimizer flow.

## Tranche 1 decision

Use browser Canvas APIs for the editor foundation. They are already required by the optimizer, have no added network/model/download cost, and are sufficient for a single-image, non-destructive transform and adjustment stack. The editor state is pure TypeScript and rendering is isolated from UI state, so a later object/layer adapter can replace or extend the renderer without changing the optimizer.

Tranche 1 includes image import, canvas fit/actual-size zoom, wheel zoom and drag pan, original/edited comparison, non-destructive brightness/contrast/saturation/rotation/flip state, undo/redo/reset, keyboard shortcuts, and edited-PNG export. Crop, text, shapes, and multi-layer composition begin in later tranches.

## Dependency evaluation

| Candidate | License | Decision | Rationale |
| --- | --- | --- | --- |
| Fabric.js | MIT | Defer to Tranche 3 | Strong object, transform, serialization, and SVG support; suitable for text, overlays, and layers. |
| Konva | MIT | Defer to Tranche 3 | Strong layer, transform, and interaction model; compare bundle/performance against Fabric when composition begins. |
| Cropper.js | MIT | Defer to Tranche 2 | Purpose-built crop UI, but crop is outside the editor-foundation scope. |
| Pica | MIT | Defer | Consider if high-quality downsampling benchmarks beat current browser canvas on representative product images. |
| ONNX Runtime Web | MIT | Defer to Tranche 4/5 | Browser inference is feasible, but models, WASM assets, model-weight license, download size, CPU performance, and edge quality require a separate review. |
| Transformers.js | Apache-2.0 | Defer to Tranche 5 | Runtime is permissive, but every selected model’s weights and commercial redistribution terms must be separately verified. |

No new dependency is adopted in Tranche 1. GPL/AGPL components are excluded. No model weights are included.

## Compatibility and performance

Modern browsers with Canvas 2D, Blob, and image decoding are required. Canvas filter support is used for previews; export rendering uses the same browser Canvas 2D path. Large images consume decoded pixel memory, so the existing 50 MB input limit remains and future work should add decoded-dimension limits, OffscreenCanvas/worker evaluation, and representative CPU/integrated-GPU benchmarks before local AI is considered.

## Remaining milestones

1. Core editing: crop, straighten, resize, and additional adjustment controls.
2. Composition: text, shapes, overlays, layers, alignment, templates.
3. Product photo: locally evaluated background removal, replacement, shadows, marketplace presets.
4. Advanced enhancements: opt-in models only after model-weight, performance, and visual-quality benchmarks.
