# Status snapshot

Durable record of where the project actually is, so a new session can resume without chat history.
Update this file at the end of any working session; keep it factual and dated.

**Last verified: 2026-10-27** (v0.2.0 shipped: batch Studio presets; Studio export-overlay leak fixed; dev + production QA green).

## Version and remotes

| Item | Value |
| --- | --- |
| Version | `0.2.0` (`package.json`) |
| Local `main` | `42bd24b` — *Ship batch Studio presets across the Quick Optimize queue (v0.2.0)* |
| GitHub `main` | `42bd24b` (in sync) |
| Other branches | `feature/photo-studio-core-tools` (`ad869aa`), `feature/photo-studio-foundation` (`5af4df4`) — both merged, safe to delete |
| Hosted site | https://rbeamj.github.io/beams-image-optimizer/ — Pages run **#6, success**, serves `index-nc1Sa7Rh.js` (381.94 kB, gzip 120.02 kB), byte-identical to a fresh local `npm run build`; live batch smoke passed on the production build with a fresh profile (real HuggingFace model download, 21.3 s for one Marketplace-white export, 0 console errors) |
| Open issues / PRs | none |

The two dev-only QA hooks (`window.__studio.objects()/refilter()`, `window.__batch.rows()/file()`, `?ai-fail=`) do not affect the shipped build.

## Verified health (2026-10-27)

| Check | Result |
| --- | --- |
| `npm test` | 20 files, **191 tests passed** (~0.4 s) |
| `npm run build` | passes; `dist/` ≈ 382 kB JS + 195 kB ORT worker, gzip 120 kB + 23 kB |
| `npm run dev` | boots clean; app loads with **no console errors** |
| Studio UI | all 10 panels present: Cutout, Refine, Cleanup, Enhance, Scene, Light, Color, Transform, Crop, Export |
| fp16 WebGPU | **verified** 2026-10-27 on Intel UHD 770 (`gen-12lp`, `shader-f16`); Quality 1024 fp16 7.7 s warm, ~1.9× faster than fp32, matte matches fp32 (mean Δ 0.014/255) |
| Batch Studio presets | **verified** 2026-10-27 in real Chrome over CDP (same iGPU): consent gate, 5 presets, cancel mid-batch, transparency, "My Studio setup", **0 console errors**; parity vs Studio export mean Δ 0.96/255 |

## What is actually built

**Quick Optimize** — batch import, JPEG/PNG/WebP in and out, orientation-aware resize (Original → 4K + custom),
quality control, 5 recipes, queue/cancel/download-all, before-after preview, per-result recipe and byte stats.
Since v0.2.0 an optional **Studio preset** applies to every queued photo: AI cutout plus frame/backdrop/shadow
composition, exported with the shared recipes. Built-ins (Marketplace white 1:1, Social 4:5, Banner 16:9,
Catalog 4:3, Transparent PNG) mirror the Studio scene buttons; **My Studio setup** captures whatever frame,
backdrop, shadow, light settings and cutout choice the open Studio photo has. The batch pipeline
(`src/batch/`) reuses the same adaptive removal engine (one shared warm session set), the same scene math
(`src/editor/scene.ts`), and a headless fabric compositor (`src/editor/compose.ts`) that mirrors the editor's
scene graph, so batch output matches a single Studio export (measured mean Δ 0.96/255). Originals are never
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

Measured on a GTX 1080 Ti (Pascal, no `shader-f16`), 2048 MB WebGPU buffer:
cutout warm 2.3 s (Quality 1024 fp32), cold page 6.5–10 s; Magic Click 0.29 s after the first; cleanup 0.39 s warm;
enhance 4.0 s → 1024, 16.1 s → 2048.
Also measured on Intel UHD 770 (`shader-f16`): Quality 1024 fp16 7.9 s total / 7.7 s model warm, Fast 512 fp16 4.0 s /
3.6 s, Magic Click 0.26 s after the 5.8 s first click, cleanup 1.1 s warm. Details in `docs/photo-studio-performance.md`.

## Known gaps (Photoroom parity)

| Area | State |
| --- | --- |
| AI opt-in friction | Re-enabled on every page load; no persisted opt-in, so it is not yet the one-click experience Photoroom has |
| Batch studio edits / templates | **Shipped 2026-10-27 (v0.2.0)** — presets across the queue incl. "My Studio setup", headless composition parity-verified against Studio export. Per-photo editing stays single-image; crops, Magic Click and cleanup edits are not part of a captured preset |
| Project save/load, layers, text, shapes, stickers | Not implemented (deliberately deferred in Tranche 1) |
| Scene generation | Deterministic backdrops only; no generative scenes (kept out on purpose: privacy + licensing) |
| Export formats | JPEG/PNG/WebP only; no AVIF/JXL/PDF/social-size matrices |
| Mobile capture / API / accounts | Not in scope for the browser-local alpha |
| fp16 WebGPU paths | **Verified** on Intel UHD 770 — Auto picks Quality 1024 fp16, ~1.9× faster than fp32, output matches fp32. Apple Silicon and AMD `shader-f16` hardware remain unmeasured |
| Integrated-GPU speed | An iGPU with fp16 is still slower than a discrete GPU: 7.7 s vs 2.1 s model-only for Quality 1024. Expect 4–8 s per cutout on integrated graphics, not sub-second |
| WASM threading | Single-threaded on static hosting; real threads need COOP/COEP, which GitHub Pages cannot send |
| Test coverage | All 191 tests are unit/logic tests; `src/editor/controller.ts` (58 kB, DOM + canvas) and the headless compositor have no automated coverage — browser QA is manual |
| Tooling | No lint/format/typecheck-only script; `tsc -b` only runs inside `build` |

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

## Bug fixed this session (2026-10-27)

**Studio exports could contain the "before" photo.** `#compare` ships checked; the comparison overlay is managed
with remove/add pairs, but fabric's `bringObjectToFront()` silently *re-adds* a removed object, so `remember()`
could leave the overlay referenced twice. `remove()` then only ever cleared one reference, `exportFile()` rendered
the other into the export, and switching photos kept the previous photo's overlay. Fixes: explicit canvas
bookkeeping (`onCanvas`/`attachToCanvas`/`detachFromCanvas` in the controller), exports hide overlays instead of
detaching them, and `load()` resets the overlay. Verified by instrumenting `Canvas.add` over CDP (duplicate gone,
one reference, overlay aligned) and by the parity measurement above (34.85 → 0.96 mean Δ/255).

Batch QA harnesses (not part of the repo): `C:\Temp\opencode\beams-batch\qa.mjs` — full dev-server suite;
`live.mjs` — production smoke against the deployed site; `diag*.mjs` — the parity/overlay investigations
that found the leak.

## How to resume

```sh
npm install
npm test          # 191 tests
npm run build     # also typechecks (tsc -b)
npm run dev       # http://localhost:5173
```

Windows PowerShell: use `npm.cmd` if `npm.ps1` is blocked. Dev-only QA hooks: `window.__studio`
(`layers()`, `src()`, `scene()`, `objects()`, `refilter()`) and `window.__batch` (`rows()`, `file(i)`)
are available in development builds only.

## Suggested next steps (not started)

1. Persist the AI opt-in per browser (one click instead of every load) — smallest remaining parity win.
2. Project save/load (IndexedDB) with reusable product templates.
3. Add `npm run typecheck` and a browser smoke test for the Studio controller and the headless compositor.
4. Save/cancel the batch queue itself across reloads, and per-row retry for failed photos.
