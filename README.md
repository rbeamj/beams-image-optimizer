# Beams Image Optimizer

> **Alpha software — features, interfaces, and behavior may change.**

Beams Image Optimizer is a free, open-source, browser-local product-image application with two experiences built on one reusable engine: **Quick Optimize** for fast batch exports and **Photo Studio** for careful single-image editing.

## v0.1.1 local update

- Adds the local Photo Studio editor foundation, with live adjustments, before/after comparison, undo, reset, rotation, and flips.
- Unifies edited-image export with the existing format, quality, and maximum-size recipe.
- Uses compact Adjust and Export panels with a stable canvas height and always-visible image import control.

## Privacy

Image decoding, resizing, and encoding happen in your browser using standard browser APIs. This app does not include a backend, account system, image-upload API, analytics, or tracking. Hosting the app still requires a normal network request to load its HTML, CSS, and JavaScript; image bytes are not sent to a processing server by this application.

## Current alpha features

- A clear workspace choice: Quick Optimize for everyday batch work, and Photo Studio for detailed editing
- JPEG, PNG, and WebP input and output
- Browser-local conversion, compression, and orientation-aware resizing
- Original, 1K (1024px), 2K, 3K, 4K, and custom maximum-long-edge controls
- Aspect-ratio preservation with no unintended upscaling
- Adjustable output quality and Smallest File, Balanced, High Quality, Product Photo 1K, and Custom recipes
- PNG/WebP transparency preservation where the browser encoder supports it; JPEG composites transparent pixels onto white
- Batch queue, cancellation at safe processing boundaries, individual downloads, and download-all
- Before/after previews, byte statistics, and the actual recipe retained for each processed image
- Light and dark presentation

## Photo Studio foundation

The in-progress Photo Studio is a browser-local, non-destructive single-image editor over the optimizer. Current Tranche 1 tools include freeform and ratio crop, straighten and flip, exposure, brightness, contrast, saturation, temperature, sharpness, grayscale and sepia filters, zoom, undo/redo, reset controls, and combined export. Images are kept in the browser and the original input file is never modified.

Quick Optimize and Photo Studio intentionally share the same import queue, output recipes, and browser-only image engine. They are separate interfaces, not separate products or processing systems.

## Browser support and limitations

Use a current desktop or mobile browser with Canvas, Blob, and image-decoding support. WebP output and EXIF orientation behavior depend on the browser. Inputs are limited to JPEG, PNG, and WebP files up to 50 MB. A canvas encoder cannot be forcibly stopped mid-encode, so cancellation takes effect at the next safe processing boundary. This is an alpha editor. AI features are opt-in, run in the browser, and are only added after their model weights, commercial-use terms, redistribution terms, performance, and privacy tradeoffs are reviewed.

### Optional AI Enhance (Real-ESRGAN)

Photo Studio's Enhance panel can upscale to a 1024px or 2048px longest edge with `realesr-general-x4v3` through ONNX Runtime Web (WASM, no GPU required). It never runs automatically and stays off until acknowledged. Weights are not committed:

```sh
npm run fetch:model   # downloads realesr-general-x4v3.onnx into public/models/
npm run bench:enhance # writes docs/realesrgan-benchmark.md
```

See `docs/realesrgan-audit.md` for the license review and residual training-data risk.

### Backgrounds and optional AI background removal

The Background panel builds marketplace scenes without touching product pixels: transparent, solid, studio gradients, custom gradients, or an uploaded photo (fill or fit); square, 4:5, 4:3, 16:9, or product-ratio frames with padding and positioning; and adjustable ground-contact or drop shadows. Scene changes are undoable and export at the product's native resolution.

Opt-in AI background removal uses U²-Netp (Apache-2.0, 4.6 MB) on the browser CPU (WASM) or WebGPU, with edge cleanup and optional edge refinement. It never runs automatically and the weights are not committed:

```sh
npm run fetch:bg-model # downloads u2netp.onnx into public/models/
npm run bench:bg       # native CPU timings
```

See `docs/background-removal-evaluation.md` for the model and license decisions and benchmark results.

`npm run build` strips fetched `.onnx` files and local benchmark images from `dist/`. To host specific weights deliberately, list them: `BEAMS_INCLUDE_MODELS=u2netp.onnx,realesr-general-x4v3.onnx npm run build`.

## Develop locally

```sh
git clone https://github.com/rbeamj/beams-image-optimizer.git
cd beams-image-optimizer
npm install
npm run dev
```

On Windows PowerShell systems that block `npm.ps1`, use `npm.cmd run dev` instead.

## Verify a checkout

```sh
npm test
npm run build
```

The production-ready static files are written to `dist/`. The Vite configuration uses relative asset paths, making the build suitable for GitHub Pages.

## Reuse the engine

The browser-only TypeScript engine lives in `src/engine/` and has no UI imports or application state:

```ts
import { optimizeImage } from './engine';
const result = await optimizeImage(file, { format: 'webp', quality: 0.82, maxEdge: 2048 });
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the deliberately staged path toward a more capable local-first photo studio.

## Contributing and issues

Bug reports, reproducible browser-compatibility findings, documentation improvements, and focused pull requests are welcome. Please open an issue before proposing a large feature or adding a dependency, especially one with a license outside the project’s preferred policy.

## License and notices

This project is licensed under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the dependency license review.
