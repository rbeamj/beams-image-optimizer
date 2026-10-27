# Photo Studio technical assessment

> **Status: Tranche 1 record, extended by v0.1.2.** The architecture below (reusable engine plus Fabric.js canvas) still
> describes the app. The "deferred" list has been overtaken by events: AI cutout, click refinement, inpainting,
> upscaling and the scene editor shipped in v0.1.2. Current state: [STATUS.md](../STATUS.md).

## Tranche 1 architecture

Photo Studio is a browser-local, non-destructive single-image editor. The reusable `src/engine/` optimizer still owns format conversion, quality, resizing, and batch processing. The studio creates an edited browser `File` only when the user exports; the original input is retained locally and never modified.

Fabric.js 7.4.0 supplies the permissively licensed interactive canvas and image-filter pipeline. Application-owned editor helpers remain separate in `src/editor/tools.ts`, where crop geometry and adjustment matrices can be tested without UI code.

## Included in Tranche 1 (shipped in v0.1.1)

- Import directly into Studio or open an existing Quick Optimize item for editing
- Zoom, pan, fit, 100% view, Show original comparison, and undo/redo
- Freeform and common-ratio center crop, straighten, rotate, and flips
- Exposure, brightness, contrast, saturation, temperature, sharpness, grayscale, and sepia
- JPEG, PNG, and WebP export through the existing quality and maximum-long-edge controls
- Browser-local processing, original preservation, and normal Quick Optimize batch behavior

## Deferred by the Tranche 1 boundary, and where it stands now

- **Shipped in v0.1.2:** AI background removal/replacement, object removal and inpainting, upscaling, product-photo
  scenes, and shadows.
- **Still not implemented:** text, stickers, shapes, multilayer composition, Photo Studio batch edits, cloud storage,
  and accounts.
- **Out of scope by design:** generative services and paid services.

Each remaining item still requires its own product, technical, license, and privacy review before implementation.

## Dependency review

| Candidate | License | Decision |
| --- | --- | --- |
| Fabric.js 7.4.0 | MIT | Adopted for the interactive canvas and browser filters; production dependency audit is clean. |
| Cropper.js | MIT | Defer; Fabric crop frame meets the first-tranche need without another dependency. |
| Pica | MIT | Defer; benchmark before adding an alternate downsampler. |
| ONNX Runtime Web | MIT | Adopted for the AI tools in v0.1.2; model weights and their licenses are reviewed separately in [model-licensing.md](model-licensing.md). |
| Transformers.js | Apache-2.0 | Not adopted; ONNX Runtime Web plus explicit per-model graphs was preferred, and every model still requires an independent license review. |

No AI model weights are committed or bundled, and there is no remote processing service, image-upload backend,
telemetry, or Beams Vault material.
