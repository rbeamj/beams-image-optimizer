# Photo Studio technical assessment

## Tranche 1 architecture

Photo Studio is a browser-local, non-destructive single-image editor. The reusable `src/engine/` optimizer still owns format conversion, quality, resizing, and batch processing. The studio creates an edited browser `File` only when the user exports; the original input is retained locally and never modified.

Fabric.js 7.4.0 supplies the permissively licensed interactive canvas and image-filter pipeline. Application-owned editor helpers remain separate in `src/editor/tools.ts`, where crop geometry and adjustment matrices can be tested without UI code.

## Included in this tranche

- Import directly into Studio or open an existing Quick Optimize item for editing
- Zoom, pan, fit, 100% view, Show original comparison, and undo/redo
- Freeform and common-ratio center crop, straighten, rotate, and flips
- Exposure, brightness, contrast, saturation, temperature, sharpness, grayscale, and sepia
- JPEG, PNG, and WebP export through the existing quality and maximum-long-edge controls
- Browser-local processing, original preservation, and normal Quick Optimize batch behavior

## Deferred by boundary

Text, stickers, shapes, multilayer composition, AI background removal/replacement, generative services, object removal, upscaling, product-photo scenes, shadows, Photo Studio batch edits, cloud storage, accounts, and paid services are deliberately not implemented in Tranche 1.

## Dependency review

| Candidate | License | Decision |
| --- | --- | --- |
| Fabric.js 7.4.0 | MIT | Adopted for the interactive canvas and browser filters; production dependency audit is clean. |
| Cropper.js | MIT | Defer; Fabric crop frame meets the first-tranche need without another dependency. |
| Pica | MIT | Defer; benchmark before adding an alternate downsampler. |
| ONNX Runtime Web | MIT | Defer with AI; model weights and commercial/redistribution terms require a separate review. |
| Transformers.js | Apache-2.0 | Defer with AI; every selected model requires an independent license review. |

No AI model weights, remote processing service, image-upload backend, telemetry, or Beams Vault material is included.
