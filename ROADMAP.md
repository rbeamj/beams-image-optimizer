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
- Undo history travels with a project: the ten most recent snapshots and a blob pool for every URL they
  reference, so undo/redo works immediately after a reopen (pinned byte-identical by the smoke suite)
- Templates: save the current look (scene, backdrop, shadow, light settings, cutout choice) under a name;
  apply it to any photo in Photo Studio, or run it across the Quick Optimize queue from the batch preset
  list. Image backdrops persist with their blob. Re-running a preset over the queue reprocesses
  already-done rows in one pass (verified in the AI QA suite)
- Combined presets bundle a cutout tier, a scene and their own export recipe (overriding the shared
  settings): Amazon white 2K (Quality 1024, balanced edges, pure-white square, JPEG 90% 2048 — rules from
  Amazon Seller Central: pure white RGB 255, ~85% frame fill, 2000px+ recommended, JPEG) and eBay white 1600
  (eBay photo guidance: ~1600px longest side, white/neutral, JPEG). Verified end-to-end in the AI QA suite:
  a 2048×2048 JPEG with the recipe reported and applied
- Per-row comparison actions: Copy duplicates a queue photo, Process/Reprocess re-runs one row with the
  current recipe and preset, Remove drops a row, and card thumbnails show the processed result — so an
  operator can run two presets over copies of the same photo and keep the one they like
- The Quick Optimize queue survives reloads: imports, results (with their recipe) and failures are kept in
  IndexedDB, failed rows get a Retry button that reprocesses with the current recipe and preset, and a
  Clear button resets the list
- Every stored record (projects, templates, queue rows, history stacks) is validated on read, so corrupt or
  version-skewed rows can never reach the editor; queue writes are immediate because Blob fields are
  stored as references
- History beyond ten steps is not persisted, templates do not carry crops or per-photo edits (deliberate:
  a template is a look, not a photo)

### Marketplace presets, matte reuse, and lint (v0.2.x, dev)

- Three more combined marketplace presets with rules verified from each marketplace's own guidance:
  Shopify white 2K (2048×2048 recommended square, Shopify image-size guidelines), Etsy white 2K (listing
  photos of at least 2000 px for zoom, Etsy Help), Walmart white 2200 (pure white RGB 255 required for the
  main image, 1500×1500 zoom minimum; ships exactly at Walmart's recommended 2200×2200 — the Studio export
  ceiling was raised to 2200 to match it). The marketplace presets are grouped in their own section of
  the batch preset dropdown
- Stored-matte reuse: the first cutout of a photo is quantized through the same PNG chain the Studio
  composites from, stored with the queue row alongside a fingerprint of its cutout settings
  (mode:cleanup:refine:size), and reused by later runs whose settings match — a queue re-run of the same
  preset, or a preset comparison on a copied row with identical cutout settings, skips the 8–11 s model
  run entirely and survives reloads (the matte persists with the queue record). Rows whose cutout
  settings differ (for example crisp vs balanced edges) still get a fresh, honest cutout, and cards note
  `cutout reused` when it happened
- Biome lint (`npm run lint`, MIT/Apache-2.0, no TypeScript peer constraint since the project builds with
  TypeScript 7): recommended rules with zero errors across src, tests and scripts; non-null assertions
  stay allowed as the codebase's idiom; a wholesale reformat was deliberately not done and the formatter
  stays off. `npm run lint` gates the Pages build job

### Undo correctness (v0.2.0)

- Undo/redo never reverted Light/Color/Transform adjustments: `restore()` rebuilt the canvas and scene but
  left the current adjustment values in place, and immediately re-applied them over the restored image.
  Snapshots now restore the look too
- Undo/redo also re-measured the subject from the just-restored image, which read one sampling step
  smaller and silently shrank the frame after any undo/redo (surfaced as a batch/export parity
  regression). Snapshots now carry their captured layout bounds; restore never re-measures
- Both are pinned by `npm run smoke` (in-session undo reverts, redo is byte-identical; the same after a
  project reopen) and by the AI QA suite (undo across a real cutout)

## Next

Ordered by expected value, not committed for any release:

- Per-photo AI tools (Magic Click refinement, Cleanup) in the batch queue, with manual control
- More marketplace presets where the framing rules are documented
- Persist more undo history per project (currently capped at ten snapshots) if storage profiling allows

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
