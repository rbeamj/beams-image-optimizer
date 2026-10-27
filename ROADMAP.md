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
- Hardware-adaptive precision: fp16 WebGPU when the GPU exposes `shader-f16`, an fp32 graph patch on older GPUs,
  CPU/WASM as the last resort — verified on both a Pascal GPU (fp32 only) and Intel gen-12lp (fp16, ~1.9× faster
  than fp32)

### Batch Studio presets (v0.2.0)

- Quick Optimize applies a Studio preset across the queue: AI cutout, then frame/backdrop/shadow composition,
  then the shared export recipes
- Built-ins mirror the Studio scene presets plus Transparent PNG; **My Studio setup** captures the open photo's
  frame, backdrop, shadow, light settings and cutout choice
- Batch output is composed headlessly from the same scene graph and filter chain as the Studio export; measured
  parity on the test rig is a mean difference of 0.96/255 per channel (resampling noise only)
- The AI notice and opt-in gate are shared with the Studio, and one engine instance keeps a single set of warm
  model sessions for both
- Fixed with it: a Studio export bug where the before/after comparison overlay could be duplicated on the canvas
  and leak the original photo into exported files

## Next

Ordered by expected value, not committed for any release:

- A persisted AI opt-in so enabling the tools is one click instead of once per page load
- Project save/load in the browser, plus reusable product templates
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
