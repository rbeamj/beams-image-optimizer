# Photo Studio Tranche 1 boundaries

> **Status: completed, then superseded.** Tranche 1 shipped in v0.1.1. The AI, object-removal, upscaling and product-scene
> items listed below as deferred were delivered in v0.1.2 after their own reviews
> ([model licensing](model-licensing.md), [background-removal evaluation](background-removal-evaluation.md),
> [Real-ESRGAN audit](realesrgan-audit.md)). This file is kept as the record of the original Tranche 1 agreement; the
> current state lives in [STATUS.md](../STATUS.md) and [ROADMAP.md](../ROADMAP.md).

## Completion target

Deliver a browser-local, non-destructive, single-image editing experience while keeping Quick Optimize intact.

## Included

- Studio import and opening an item from the Quick Optimize queue
- Zoom, pan, fit, 100% view, original comparison, undo/redo, and resets
- Freeform and common-ratio crop, straighten, rotate, flip, and aspect-ratio-preserving output resize
- Brightness, exposure, contrast, saturation, temperature, sharpness, grayscale, and sepia
- JPEG, PNG, and WebP export through the existing optimizer controls, including statistics

## Deferred at the time, and what happened since

| Deferred capability | Status |
| --- | --- |
| AI background removal/replacement | Shipped in v0.1.2 as Cutout (opt-in, on-device) |
| Object removal and inpainting | Shipped in v0.1.2 as Cleanup (MI-GAN) |
| Upscaling | Shipped in v0.1.2 as Enhance (Real-ESRGAN) |
| Product-photo scenes and automatic shadows | Shipped in v0.1.2 as Scene |
| Generative AI | Still not implemented, and out of scope by design (no off-device processing) |
| Text, stickers, shapes, multilayer composition, masking, and selective editing | Still not implemented |
| Studio batch edits | Still not implemented |
| Cloud storage, accounts, and paid services | Still not implemented, and out of scope by design |

The original rule still applies to every remaining item: each capability requires its own product, technical, license,
and privacy review before implementation.
