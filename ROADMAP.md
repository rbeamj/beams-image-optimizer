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
- The AI opt-in persists per browser (localStorage ack keys), so enabling the tools is one click per browser, not
  per page load — verified by a reload test and guarded by the `npm run smoke` regression suite

### Batch Studio presets (v0.2.0)

- Quick Optimize applies a Studio preset across the queue: AI cutout, then frame/backdrop/shadow composition,
  then the shared export recipes
- Built-ins mirror the Studio scene presets plus Transparent PNG; **My Studio setup** captures the open photo's
  frame, backdrop, shadow, light settings and cutout choice
- Single-photo Studio exports render through the same headless compositor as the batch, at native resolution;
  measured parity is a mean difference of 0.216/255 with 0% of pixels over 2/255 (resampling only)
- The AI notice and opt-in gate are shared with the Studio, and one engine instance keeps a single set of warm
  model sessions for both
- Fixed alongside: three Studio bugs found while verifying the above — the before/after comparison overlay could
  be duplicated on the canvas and leak the original photo into exports; a scene preset clicked while a photo was
  still decoding was silently lost; and small photos (stage scale > 1) exported as empty white frames because the
  old export cropped the display canvas
- `npm run typecheck` and `npm run smoke` (a 23-check browser regression suite over the DevTools protocol, no
  extra dependencies) guard the controller surface, the opt-in persistence, and the fixes above

### Projects, templates, and a durable queue (v0.2.0)

- Projects: save the open Studio photo as a project in this browser (IndexedDB) — subject layers (base
  pixels + cutout matte), the before/after reference, the original file, adjustments, crop, scene and
  backdrop. Reopen from the Export panel after any reload; the reopened export is byte-identical to the
  pre-save export (verified both with and without an AI cutout)
- Templates: save the current look (scene, backdrop, shadow, light settings, cutout choice) under a name;
  apply it to any photo in Photo Studio, or run it across the Quick Optimize queue from the batch preset
  list. Image backdrops persist with their blob
- The Quick Optimize queue survives reloads: imports, results (with their recipe) and failures are kept in
  IndexedDB, failed rows get a Retry button that reprocesses with the current recipe and preset, and a
  Clear button resets the list
- Every stored record (projects, templates, queue rows) is validated on read, so corrupt or version-skewed
  rows can never reach the editor; queue writes are immediate because Blob fields are stored as references
- Undo history is not persisted yet, and templates do not carry crops or per-photo edits (deliberate:
  a template is a look, not a photo)

## Next

Ordered by expected value, not committed for any release:

- Additional marketplace export presets where the framing rules are documented
- Undo history as part of saved projects (a reopen currently starts history fresh)
- A queue-level "apply template" that also works on already-processed rows in one pass

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
