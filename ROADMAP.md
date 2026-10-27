# Roadmap

This roadmap is directional, not a promise or a delivery schedule. Beams Image Optimizer remains browser-local by
default and keeps its processing engine reusable independently of the interface. For a dated record of what is
actually shipped and verified, see [STATUS.md](STATUS.md).

## Shipped

### Quick Optimize

- Format conversion, compression, resizing, quality controls, recipes, batch processing, and downloads
- Clear per-result settings and byte statistics
- A dedicated, simple workspace for quick import, recipe selection, batch export, and download

### Photo Studio (v0.1.1 – v0.1.2)

- Non-destructive browser canvas: zoom, pan, rotate, flip, freeform and common-ratio crop, straighten, undo/redo,
  before/after comparison, and local export
- Adjustments for exposure, brightness, contrast, saturation, temperature, sharpness, grayscale, and sepia
- A six-step product-photo workflow:
  1. Cutout — hardware-adaptive background removal (BiRefNet lite 1024/512, U²-Netp fallback)
  2. Refine — MobileSAM click refinement with preview and accept/reject
  3. Cleanup — MI-GAN object removal restricted to the painted area
  4. Enhance — optional Real-ESRGAN upscale to 1024 or 2048 px
  5. Scene — transparent, solid, gradient, or uploaded backdrops; marketplace/social/banner/catalog presets; frame
     ratio, padding, position, subject size, rotation, and shadows
  6. Export — shared recipes, rendered from the same scene as the preview
- On-demand model downloads from each publisher, checksum-verified and cached; no weights bundled or committed
- The original input is preserved and every step is undoable

## Next

Ordered by expected value, not committed for any release:

- Batch application of Studio presets and templates across the Quick Optimize queue
- A persisted AI opt-in so enabling the tools is one click instead of once per page load
- Project save/load in the browser, plus reusable product templates
- Verify the fp16 WebGPU paths on `shader-f16` hardware and record the numbers in
  [photo-studio-performance.md](docs/photo-studio-performance.md)
- A `typecheck` script and an automated browser smoke test for the Studio controller
- Additional marketplace export presets where the framing rules are documented

## Longer term

- Text, shapes, stickers, overlays, and multilayer composition
- Additional export formats where browser support makes them practical (for example AVIF or JPEG XL)
- Higher-detail cutouts (hair, laces, glass) once a model with clear terms runs within ordinary-hardware browser limits
- Manually controlled shadows and more advanced selective editing

## Deliberately out of scope

- Cloud processing, accounts, image uploads, telemetry, and paid services
- Generative scene or AI services that require sending image bytes off-device
- Bundling model weights in the default build

## Constraints that shape these decisions

- Browser-local by default; the original file is never modified
- AI features are opt-in, run on the user's device, and fetch weights separately with checksum verification
- Code and released weights must stay MIT, Apache-2.0, or BSD-3-Clause; training-dataset terms are recorded separately
  in [model-licensing.md](docs/model-licensing.md)
