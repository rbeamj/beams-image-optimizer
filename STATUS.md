# Status snapshot

Durable record of where the project actually is, so a new session can resume without chat history.
Update this file at the end of any working session; keep it factual and dated.

**Last verified: 2026-10-28** (v0.2.0: batch presets, projects with undo history, templates, durable queue, one shared export renderer; five Studio bugs fixed; 45-check smoke gates CI; dev + AI QA green).

## Version and remotes

| Item | Value |
| --- | --- |
| Version | `0.2.0` (`package.json`) |
| Local `main` | `039ea74` — *Fix two long-standing undo bugs; persist undo history with projects* |
| GitHub `main` | `039ea74` (in sync) |
| Other branches | `feature/photo-studio-core-tools` (`ad869aa`), `feature/photo-studio-foundation` (`5af4df4`) — both merged, safe to delete |
| Hosted site | https://rbeamj.github.io/beams-image-optimizer/ — Pages run **#14, success** (build + **smoke 45/45 in CI** + deploy all green), serves `index-TBjCRGZI.js` (398.91 kB, gzip 124.42 kB), byte-identical to a fresh local `npm run build` |
| Open issues / PRs | none |

The two dev-only QA hooks (`window.__studio.objects()/refilter()`, `window.__batch.rows()/file()`, `?ai-fail=`) do not affect the shipped build.

## Verified health (2026-10-27)

| Check | Result |
| --- | --- |
| `npm test` | 23 files, **220 tests passed** (~0.4 s) |
| `npm run build` | passes; `dist/` ≈ 399 kB JS + 195 kB ORT worker, gzip 124 kB + 24 kB |
| `npm run dev` | boots clean; app loads with **no console errors** |
| Studio UI | all 10 panels present: Cutout, Refine, Cleanup, Enhance, Scene, Light, Color, Transform, Crop, Export |
| fp16 WebGPU | **verified** 2026-10-27 on Intel UHD 770 (`gen-12lp`, `shader-f16`); Quality 1024 fp16 7.7 s warm, ~1.9× faster than fp32, matte matches fp32 (mean Δ 0.014/255) |
| Batch Studio presets | **verified** 2026-10-27 in real Chrome over CDP (same iGPU): consent gate, 5 presets, cancel mid-batch, transparency, "My Studio setup", **0 console errors**; parity vs Studio export mean Δ 0.216/255, 0% of pixels over 2/255 (same renderer) |
| Projects | **verified** 2026-10-27 over CDP with a real fp16 cutout: save → reload → reopen restores matte, removal metadata, scene and look; export **byte-identical** (3,507,939 bytes both sides). 2026-10-28: **undo history travels with the project** — undo works right after a reopen, redo is byte-identical |
| Templates | **verified** 2026-10-27 via `npm run smoke`: save from a tuned photo → apply to a *different* photo (frame, exposure and scene all carried over) → appears in the batch preset list with a working `template:` value |
| Durable queue | **verified** 2026-10-27 via `npm run smoke`: imports, results and a decode-failed row survive a reload; Retry reprocesses and reports; Clear resets. Immediate writes (no debounce) after the starvation bug was found by the probe harness |
| Undo correctness | **verified** 2026-10-28: two long-standing bugs fixed — `restore()` never reverted Light/Color/Transform adjustments, and it re-measured the subject from the unsettled restored image (one sampling step smaller — the cause of a parity regression the AI QA suite caught). Parity re-measured at mean Δ 0.216/255, 0 % over 2/255; undo across a real cutout reverts the scene while keeping the matte |
| `npm run smoke` | **verified** 2026-10-28: **45/45** browser checks in ~10 s (boot, opt-in persistence, quick optimize, 10 panels, mid-decode preset race, overlay single-reference, export purity, adjustments, in-session undo/redo byte-identity, project round-trip + history, templates, queue persistence/retry/clear, 0 console errors) |

## What is actually built

**Quick Optimize** — batch import, JPEG/PNG/WebP in and out, orientation-aware resize (Original → 4K + custom),
quality control, 5 recipes, queue/cancel/download-all, before-after preview, per-result recipe and byte stats.
Since v0.2.0 an optional **Studio preset** applies to every queued photo: AI cutout plus frame/backdrop/shadow
composition, exported with the shared recipes. Built-ins (Marketplace white 1:1, Social 4:5, Banner 16:9,
Catalog 4:3, Transparent PNG) mirror the Studio scene buttons; **My Studio setup** captures whatever frame,
backdrop, shadow, light settings and cutout choice the open Studio photo has. The batch pipeline
(`src/batch/`) reuses the same adaptive removal engine (one shared warm session set), the same scene math
(`src/editor/scene.ts`), and the headless fabric compositor (`src/editor/compose.ts`) that also renders
single-photo Studio exports since this session, so a batch export and a Studio export are the same
renderer by construction (measured mean Δ 0.216/255, resampling only). Originals are never
modified; savings compare against the user's input file, not the intermediate PNG.

**Photo Studio** — browser-local, non-destructive, six-step workflow:

1. Cutout — BiRefNet lite 1024 (Quality) / 512 (Fast) / U²-Netp fallback, hardware-adaptive Auto planner with
   per-device memory of failures and timings.
2. Refine — MobileSAM "Magic Click", multi-mask alternatives, preview + Accept/Reject.
3. Cleanup — MI-GAN inpaint, painted-area only, Accept/Reject.
4. Enhance — Real-ESRGAN `realesr-general-x4v3`, 1024/2048 targets, compared against a plain resize.
5. Scene — transparent/solid/gradient/uploaded backdrop, marketplace/social/banner/catalog presets, frame ratio,
   padding, position, subject size, rotation, ground-contact and drop shadows.
6. Export — shared recipes, capped at 2048 px, rendered from the same scene as the preview.

Light/Color/Transform/Crop work at any step; undo/redo, before-after, zoom/pan, crop/straighten/flip throughout.
Subject stays layered (photo pixels + matte) so cutout/cleanup/enhance can be redone without losing scene settings.
Since v0.2.0 the **Projects** section of the Export panel saves that whole layered state (base + matte blobs,
before/after reference, original file, adjustments, crop, scene, backdrop) into IndexedDB and reopens it exactly
as saved — verified byte-identical, with and without a cutout. Since 2026-10-28 the ten most recent undo
snapshots travel with the project (with a blob pool for every URL they reference), so undo/redo works
immediately after a reopen. The **Templates**
section of the Scene panel saves the current look under a name (scene, backdrop with its image blob, shadow,
light settings, cutout choice) and applies it to any photo; saved templates also appear in Quick Optimize's
batch preset list and run across the queue through the same batch pipeline. In Quick Optimize, the queue itself
persists: imports, processed results (with their recipe) and failures survive reloads in IndexedDB, failed rows
can be retried with the current recipe and preset, and Clear resets the list. Queue writes are immediate —
Blob fields are stored as references, so writes are cheap.

Measured on a GTX 1080 Ti (Pascal, no `shader-f16`), 2048 MB WebGPU buffer:
cutout warm 2.3 s (Quality 1024 fp32), cold page 6.5–10 s; Magic Click 0.29 s after the first; cleanup 0.39 s warm;
enhance 4.0 s → 1024, 16.1 s → 2048.
Also measured on Intel UHD 770 (`shader-f16`): Quality 1024 fp16 7.9 s total / 7.7 s model warm, Fast 512 fp16 4.0 s /
3.6 s, Magic Click 0.26 s after the 5.8 s first click, cleanup 1.1 s warm. Details in `docs/photo-studio-performance.md`.

## Known gaps (Photoroom parity)

| Area | State |
| --- | --- |
| AI opt-in friction | **Cleared 2026-10-27 — the earlier note here was stale**: the opt-in has always persisted per browser via localStorage (`beams-bg-removal-ack-v1`, `beams-enhance-license-ack-v1`, plus the removal-mode choice and per-device planner memory). Reload test: gates stay hidden, keys survive, batch gate stays closed. Guarded by `npm run smoke` |
| Batch studio edits / templates | **Shipped 2026-10-27 (v0.2.0)** — presets across the queue incl. "My Studio setup" and now saved look templates, headless composition parity-verified against Studio export (mean Δ 0.216/255, 0% of pixels over 2/255). Per-photo editing stays single-image; crops, Magic Click and cleanup edits are not part of a preset or template |
| Project save/load | **Shipped 2026-10-27 (v0.2.0)** — projects persist in IndexedDB with layers (base + matte), before/after reference, original file, adjustments, crop, scene, backdrop; reopen is byte-identical. Since 2026-10-28 the 10 most recent undo snapshots persist with the project; older steps start history fresh |
| Reusable templates | **Shipped 2026-10-27 (v0.2.0)** — named looks (scene, backdrop + image blob, shadow, light settings, cutout choice) saved in IndexedDB, applicable to any photo in Studio or across the queue; image backdrops get a fresh object URL at run time |
| Batch queue persistence | **Shipped 2026-10-27 (v0.2.0)** — imports, results (with recipe) and failures survive reloads; per-row Retry with the current recipe/preset; Clear resets. Writes are immediate (a debounced write starved under batch bursts and died with the page) |
| Layers, text, shapes, stickers | Not implemented (deliberately deferred in Tranche 1) |
| Scene generation | Deterministic backdrops only; no generative scenes (kept out on purpose: privacy + licensing) |
| Export formats | JPEG/PNG/WebP only; no AVIF/JXL/PDF/social-size matrices |
| Mobile capture / API / accounts | Not in scope for the browser-local alpha |
| fp16 WebGPU paths | **Verified** on Intel UHD 770 — Auto picks Quality 1024 fp16, ~1.9× faster than fp32, output matches fp32. Apple Silicon and AMD `shader-f16` hardware remain unmeasured |
| Integrated-GPU speed | An iGPU with fp16 is still slower than a discrete GPU: 7.7 s vs 2.1 s model-only for Quality 1024. Expect 4–8 s per cutout on integrated graphics, not sub-second |
| WASM threading | Single-threaded on static hosting; real threads need COOP/COEP, which GitHub Pages cannot send |
| Test coverage | 216 unit/logic tests plus `npm run smoke` (41 browser checks over CDP) for the controller, persistence and export surfaces; the smoke runs locally against `npm run dev` + Chrome and **in CI** (the Pages deploy is gated on it) |
| Tooling | `npm run typecheck` (`tsc -b`) and `npm run smoke` (local + CI) shipped 2026-10-27; lint/format still absent |

## Licensing posture

No weights are committed or bundled; each model downloads from its publisher at a pinned revision, checksum-verified,
on first use. Code and released-weight licenses are MIT / Apache-2.0 / BSD-3-Clause and are recorded in
`docs/model-licensing.md` with notices in `THIRD_PARTY_NOTICES.md`.

Open question, unchanged: several models are trained on DIS5K / DUTS / SA-1B / Places2, whose dataset terms are
non-commercial or research-only. The project treats dataset terms as separate from the published weight licenses and
does not redistribute data — documented as residual risk for downstream commercial deployments, not a blocker for this
MIT project. Hosting weights yourself (`BEAMS_INCLUDE_MODELS`) requires carrying the notices.

## Documentation state

All documentation was refreshed against v0.1.2 on 2026-10-27:

- `ROADMAP.md` now records Quick Optimize and Photo Studio as shipped, with the real remaining work under "Next".
- `docs/tranche-1-boundaries.md` and `docs/photo-studio-assessment.md` keep their Tranche 1 architecture record but carry a
  status banner, and their deferred lists now say what shipped in v0.1.2 versus what is still missing.
- `README.md` links this file from its Roadmap section.

`docs/model-licensing.md`, `docs/background-removal-evaluation.md`, and `docs/realesrgan-audit.md` are current and were not changed.
`docs/photo-studio-performance.md` gained a measured fp16 section (Intel UHD 770) on 2026-10-27 and a batch-preset
timings + parity section the same day.

## Bugs fixed this session (2026-10-27)

All three were found by measuring instead of trusting: the parity measurement for the batch feature surfaced the
first two, and the new smoke test surfaced the third before it ever shipped to a user.

**1 — Studio exports could contain the "before" photo.** `#compare` ships checked; the comparison overlay is managed
with remove/add pairs, but fabric's `bringObjectToFront()` silently *re-adds* a removed object, so `remember()`
could leave the overlay referenced twice. `remove()` then only ever cleared one reference, `exportFile()` rendered
the other into the export, and switching photos kept the previous photo's overlay. Fix: explicit canvas
bookkeeping (`onCanvas`/`attachToCanvas`/`detachFromCanvas`), and `load()` resets the overlay. Pinned by
instrumenting `Canvas.add` over CDP; parity improved from 34.85 to 0.96 mean Δ/255.

**2 — a scene preset clicked while a photo was still decoding was silently lost.** `load()` reset `scene`/`backdrop`
*after* its `await FabricImage.fromURL`, so anything clicked during the decode was wiped, and interleaved
double-loads (queue add + immediate Edit) corrupted the canvas. Fix: the scene resets moved before the await,
`image` stays undefined until the decode lands so mid-load layouts no-op, `remember()` is suppressed while
loading, and a load-sequence token makes the newest load win. Guarded by the smoke's "preset clicked mid-decode"
check.

**3 — small photos exported as empty white frames.** `exportFile()` cropped the *display* canvas via
`toDataURL` with `multiplier: 1/frameBox.scale`; when the stage shows a small photo enlarged (scale > 1, multiplier
< 1) fabric renders the frame and shadow but loses the subject entirely (measured: 283 of 5625 export pixels
non-white, all shadow). Exports now render headlessly at native resolution through the same `composeScene` the
batch uses — one renderer, no shared canvas, no crop/multiplier semantics. Parity between a Studio export and a
batch export is now mean Δ 0.216/255 with 0% of pixels over 2/255, and the smoke asserts the export's centre pixel
is the subject, not the backdrop.

**Stale doc claim corrected:** the "AI opt-in re-enabled on every page load" gap was wrong — the ack keys were
already in `localStorage`. Verified by a reload test and now guarded by `npm run smoke`.

## Bugs fixed this session (2026-10-28)

Both surfaced by the new undo checks in the regression suite; the second one also showed up as a parity
regression in the AI QA suite (mean Δ 4.83/255, studio frame 2048 → 2038 after any undo/redo).

**4 — undo/redo never reverted Light/Color/Transform adjustments.** `restore()` rebuilt the canvas, scene,
crop and layers, but never applied the snapshot's `adjustments`, then immediately re-applied the *current*
(un-reverted) values over the restored image — so undoing an exposure change visibly did nothing while
moving the cursor. Fixed: `restore()` applies `snapshot.adjustments` before `sync()`. Pinned by the smoke
(in-session and after a project reopen).

**5 — undo/redo re-measured the subject and shrank the frame.** `restore()` called `measureOpaqueBounds()`
on the just-enlivened fabric image, which read one sampling step smaller than the live-path measurement of
the same pixels, so any undo/redo silently changed the frame (2048 → 2038 on the test photo). Fixed:
snapshots now carry their captured `opaqueBounds`; restore never re-measures. Undo restores the exact
captured layout, and the AI QA parity is back to mean Δ 0.216/255 with 0% of pixels over 2/255.

Batch QA harnesses (not part of the repo): `C:\Temp\opencode\beams-batch\qa.mjs` — full dev-server suite incl. the
AI-cutout project round-trip, undo across a real cutout, and the re-run-over-done-rows evidence; `live.mjs` —
production smoke against the deployed site; `diag*.mjs`/`probe*.mjs`/`reload.mjs`/`undo-*.mjs` — the
investigations behind the bugs above. The durable regression suite is `scripts/smoke.mjs` in the repo
(`npm run smoke`).

## How to resume

```sh
npm install
npm test            # 220 unit/logic tests
npm run typecheck   # tsc -b (same check the build runs, without vite)
npm run build       # production build into dist/
npm run dev         # http://localhost:5173 — keep it running, then:
npm run smoke       # 45 browser checks (needs the dev server + a local Chrome; CHROME_PATH overrides)
```

The smoke suite also runs in CI: the Pages workflow installs Chrome, boots the dev server, and blocks the
deploy on all 45 checks passing.

Windows PowerShell: use `npm.cmd` if `npm.ps1` is blocked. Dev-only QA hooks: `window.__studio`
(`layers()`, `src()`, `scene()`, `history()`, `objects()`, `refilter()`) and `window.__batch` (`rows()`, `file(i)`)
are available in development builds only.

## Suggested next steps (not started)

1. Additional marketplace export presets where the framing rules are documented.
2. Lint/format tooling on top of the existing typecheck + smoke.
3. Persist more undo history per project (currently capped at ten snapshots) if storage profiling allows.
4. Batch presets currently re-run the AI cutout for every photo even when a row already has one; reusing the existing matte would make queue re-runs much faster.
