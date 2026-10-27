# Status snapshot

Durable record of where the project actually is, so a new session can resume without chat history.
Update this file at the end of any working session; keep it factual and dated.

**Last verified: 2026-10-27** (v0.2.0 deployed: batch Studio presets, one shared export renderer, three Studio bugs fixed, projects save/reopen; `npm run typecheck` + `npm run smoke` shipped; dev + production QA green).

## Version and remotes

| Item | Value |
| --- | --- |
| Version | `0.2.0` (`package.json`) |
| Local `main` | `54be6d2` — *Fix three Studio bugs found by measurement; add typecheck + browser smoke* |
| GitHub `main` | `54be6d2` (in sync) |
| Other branches | `feature/photo-studio-core-tools` (`ad869aa`), `feature/photo-studio-foundation` (`5af4df4`) — both merged, safe to delete |
| Hosted site | https://rbeamj.github.io/beams-image-optimizer/ — Pages run **#8, success**, serves `index-zNZv0jgf.js` (382.24 kB, gzip 120.06 kB), byte-identical to a fresh local `npm run build`. Earlier today: live batch smoke on a fresh profile passed with the real HuggingFace model download (21.3 s, 0 console errors) |
| Open issues / PRs | none |

The two dev-only QA hooks (`window.__studio.objects()/refilter()`, `window.__batch.rows()/file()`, `?ai-fail=`) do not affect the shipped build.

## Verified health (2026-10-27)

| Check | Result |
| --- | --- |
| `npm test` | 21 files, **201 tests passed** (~0.4 s) |
| `npm run build` | passes; `dist/` ≈ 388 kB JS + 195 kB ORT worker, gzip 122 kB + 24 kB |
| `npm run dev` | boots clean; app loads with **no console errors** |
| Studio UI | all 10 panels present: Cutout, Refine, Cleanup, Enhance, Scene, Light, Color, Transform, Crop, Export |
| fp16 WebGPU | **verified** 2026-10-27 on Intel UHD 770 (`gen-12lp`, `shader-f16`); Quality 1024 fp16 7.7 s warm, ~1.9× faster than fp32, matte matches fp32 (mean Δ 0.014/255) |
| Batch Studio presets | **verified** 2026-10-27 in real Chrome over CDP (same iGPU): consent gate, 5 presets, cancel mid-batch, transparency, "My Studio setup", **0 console errors**; parity vs Studio export mean Δ 0.216/255, 0% of pixels over 2/255 (same renderer) |
| Projects | **verified** 2026-10-27 over CDP with a real fp16 cutout: save → reload → reopen restores matte, removal metadata, scene and look; export **byte-identical** (3,507,939 bytes both sides); smoke covers the no-AI round-trip the same way |
| `npm run smoke` | **verified** 2026-10-27: **28/28** browser checks in ~5.8 s (boot, opt-in persistence across reload, quick optimize, 10 panels, mid-decode preset race, overlay single-reference, export subject/overlay/adjustments, project save/reload/reopen byte-identity, 0 console errors) |

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
as saved — verified byte-identical, with and without a cutout. Undo history is not persisted.

Measured on a GTX 1080 Ti (Pascal, no `shader-f16`), 2048 MB WebGPU buffer:
cutout warm 2.3 s (Quality 1024 fp32), cold page 6.5–10 s; Magic Click 0.29 s after the first; cleanup 0.39 s warm;
enhance 4.0 s → 1024, 16.1 s → 2048.
Also measured on Intel UHD 770 (`shader-f16`): Quality 1024 fp16 7.9 s total / 7.7 s model warm, Fast 512 fp16 4.0 s /
3.6 s, Magic Click 0.26 s after the 5.8 s first click, cleanup 1.1 s warm. Details in `docs/photo-studio-performance.md`.

## Known gaps (Photoroom parity)

| Area | State |
| --- | --- |
| AI opt-in friction | **Cleared 2026-10-27 — the earlier note here was stale**: the opt-in has always persisted per browser via localStorage (`beams-bg-removal-ack-v1`, `beams-enhance-license-ack-v1`, plus the removal-mode choice and per-device planner memory). Reload test: gates stay hidden, keys survive, batch gate stays closed. Guarded by `npm run smoke` |
| Batch studio edits / templates | **Shipped 2026-10-27 (v0.2.0)** — presets across the queue incl. "My Studio setup", headless composition parity-verified against Studio export (mean Δ 0.216/255, 0% of pixels over 2/255). Per-photo editing stays single-image; crops, Magic Click and cleanup edits are not part of a captured preset |
| Project save/load | **Shipped 2026-10-27 (v0.2.0)** — projects persist in IndexedDB with layers (base + matte), before/after reference, original file, adjustments, crop, scene, backdrop; reopen is byte-identical. Not persisted: undo history. Template management beyond "My Studio setup" is still open |
| Layers, text, shapes, stickers | Not implemented (deliberately deferred in Tranche 1) |
| Scene generation | Deterministic backdrops only; no generative scenes (kept out on purpose: privacy + licensing) |
| Export formats | JPEG/PNG/WebP only; no AVIF/JXL/PDF/social-size matrices |
| Mobile capture / API / accounts | Not in scope for the browser-local alpha |
| fp16 WebGPU paths | **Verified** on Intel UHD 770 — Auto picks Quality 1024 fp16, ~1.9× faster than fp32, output matches fp32. Apple Silicon and AMD `shader-f16` hardware remain unmeasured |
| Integrated-GPU speed | An iGPU with fp16 is still slower than a discrete GPU: 7.7 s vs 2.1 s model-only for Quality 1024. Expect 4–8 s per cutout on integrated graphics, not sub-second |
| WASM threading | Single-threaded on static hosting; real threads need COOP/COEP, which GitHub Pages cannot send |
| Test coverage | 191 unit/logic tests plus `npm run smoke` (23 browser checks over CDP) for the controller surface; the smoke is manual-trigger and needs `npm run dev` + local Chrome — it does not run in CI |
| Tooling | `npm run typecheck` (`tsc -b`) and `npm run smoke` shipped 2026-10-27; lint/format still absent |

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

Batch QA harnesses (not part of the repo): `C:\Temp\opencode\beams-batch\qa.mjs` — full dev-server suite incl. the
AI-cutout project round-trip; `live.mjs` — production smoke against the deployed site; `diag*.mjs`/`probe*.mjs`/
`reload.mjs` — the investigations behind the three bugs above. The durable regression suite is `scripts/smoke.mjs`
in the repo (`npm run smoke`).

## How to resume

```sh
npm install
npm test            # 201 unit/logic tests
npm run typecheck   # tsc -b (same check the build runs, without vite)
npm run build       # production build into dist/
npm run dev         # http://localhost:5173 — keep it running, then:
npm run smoke       # 28 browser checks (needs the dev server + a local Chrome; CHROME_PATH overrides)
```

Windows PowerShell: use `npm.cmd` if `npm.ps1` is blocked. Dev-only QA hooks: `window.__studio`
(`layers()`, `src()`, `scene()`, `objects()`, `refilter()`) and `window.__batch` (`rows()`, `file(i)`)
are available in development builds only.

## Suggested next steps (not started)

1. A reusable template library beyond "My Studio setup" — named scene/backdrop/light looks applicable to any photo or queue.
2. Save/cancel the batch queue itself across reloads, and per-row retry for failed photos.
3. Run `npm run smoke` in CI (needs a Chrome install in the Pages workflow; it is manual-trigger only today).
4. Lint/format tooling on top of the existing typecheck + smoke.
