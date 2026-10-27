# Status snapshot

Durable record of where the project actually is, so a new session can resume without chat history.
Update this file at the end of any working session; keep it factual and dated.

**Last verified: 2026-10-27** (working tree clean before this file was added).

## Version and remotes

| Item | Value |
| --- | --- |
| Version | `0.1.2` (`package.json`) |
| Local `main` | `80b58b0` — *Expose canvas object state in the dev-only studio hook* (**not pushed**) |
| GitHub `main` | `22ca645` — *Merge photo studio AI workflow v0.1.2* |
| Other branches | `feature/photo-studio-core-tools` (`ad869aa`), `feature/photo-studio-foundation` (`5af4df4`) — both merged, safe to delete |
| Hosted site | https://rbeamj.github.io/beams-image-optimizer/ — Pages run #3, success, serves `index-BgfvkFyE.js`, byte-identical to a fresh local `npm run build` |
| Open issues / PRs | none |

The single unpushed commit is a dev-only QA hook (`window.__studio.objects()/refilter()`); it does not affect the shipped build.

## Verified health (2026-10-27)

| Check | Result |
| --- | --- |
| `npm test` | 19 files, **180 tests passed** (~0.8 s) |
| `npm run build` | passes; `dist/` ≈ 373 kB JS + 195 kB ORT worker, gzip 117 kB + 23 kB |
| `npm run dev` | boots in ~0.2 s; app loads with **no console errors** |
| Studio UI | all 10 panels present: Cutout, Refine, Cleanup, Enhance, Scene, Light, Color, Transform, Crop, Export |

## What is actually built

**Quick Optimize** — batch import, JPEG/PNG/WebP in and out, orientation-aware resize (Original → 4K + custom),
quality control, 5 recipes, queue/cancel/download-all, before-after preview, per-result recipe and byte stats.

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
enhance 4.0 s → 1024, 16.1 s → 2048. Details in `docs/photo-studio-performance.md`.

## Known gaps (Photoroom parity)

| Area | State |
| --- | --- |
| AI opt-in friction | Re-enabled on every page load; no persisted opt-in, so it is not yet the one-click experience Photoroom has |
| Batch studio edits / templates | Not implemented — Studio is single-image; batch preset application is the biggest workflow gap |
| Project save/load, layers, text, shapes, stickers | Not implemented (deliberately deferred in Tranche 1) |
| Scene generation | Deterministic backdrops only; no generative scenes (kept out on purpose: privacy + licensing) |
| Export formats | JPEG/PNG/WebP only; no AVIF/JXL/PDF/social-size matrices |
| Mobile capture / API / accounts | Not in scope for the browser-local alpha |
| fp16 WebGPU paths | Implemented and gated, but **unverified** — no `shader-f16` hardware on hand (Apple Silicon / recent NVIDIA/AMD/Intel) |
| WASM threading | Single-threaded on static hosting; real threads need COOP/COEP, which GitHub Pages cannot send |
| Test coverage | All 180 tests are unit/logic tests; `src/editor/controller.ts` (57 kB, DOM + canvas) has no automated coverage — browser QA is manual |
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

`docs/model-licensing.md`, `docs/background-removal-evaluation.md`, `docs/realesrgan-audit.md`, and
`docs/photo-studio-performance.md` are current and were not changed.

## How to resume

```sh
npm install
npm test          # 180 tests
npm run build     # also typechecks (tsc -b)
npm run dev       # http://localhost:5173
```

Windows PowerShell: use `npm.cmd` if `npm.ps1` is blocked. Dev-only QA hook: `window.__studio`
(`layers()`, `src()`, `scene()`, `objects()`, `refilter()`) is available in development builds only.

## Suggested next steps (not started)

1. Fix documentation drift (roadmap + tranche docs) so this file and the repo agree.
2. Persist the AI opt-in per browser (one click instead of every load) — smallest parity win.
3. Batch apply of Studio presets (cutout + scene + export) across the Quick Optimize queue — largest parity win.
4. Project save/load (IndexedDB) with reusable product templates.
5. Verify fp16 WebGPU on `shader-f16` hardware; record real numbers in `docs/photo-studio-performance.md`.
6. Add `npm run typecheck` and a browser smoke test for the studio controller.
