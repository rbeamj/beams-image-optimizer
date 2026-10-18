# Beams Image Optimizer

> **Alpha software — features, interfaces, and behavior may change.**

Beams Image Optimizer is a free, open-source image optimizer that runs in your browser. Convert, resize, and compress a batch of images with a clear record of the settings used for each result.

## v0.1.1 local update

- Adds the local Photo Studio editor foundation, with live adjustments, before/after comparison, undo, reset, rotation, and flips.
- Unifies edited-image export with the existing format, quality, and maximum-size recipe.
- Uses compact Adjust and Export panels with a stable canvas height and always-visible image import control.

## Privacy

Image decoding, resizing, and encoding happen in your browser using standard browser APIs. This app does not include a backend, account system, image-upload API, analytics, or tracking. Hosting the app still requires a normal network request to load its HTML, CSS, and JavaScript; image bytes are not sent to a processing server by this application.

## Current alpha features

- JPEG, PNG, and WebP input and output
- Browser-local conversion, compression, and orientation-aware resizing
- Original, 1K (1024px), 2K, 3K, 4K, and custom maximum-long-edge controls
- Aspect-ratio preservation with no unintended upscaling
- Adjustable output quality and Smallest File, Balanced, High Quality, Product Photo 1K, and Custom recipes
- PNG/WebP transparency preservation where the browser encoder supports it; JPEG composites transparent pixels onto white
- Batch queue, cancellation at safe processing boundaries, individual downloads, and download-all
- Before/after previews, byte statistics, and the actual recipe retained for each processed image
- Light and dark presentation

## Browser support and limitations

Use a current desktop or mobile browser with Canvas, Blob, and image-decoding support. WebP output and EXIF orientation behavior depend on the browser. Inputs are limited to JPEG, PNG, and WebP files up to 50 MB. A canvas encoder cannot be forcibly stopped mid-encode, so cancellation takes effect at the next safe processing boundary. This is an optimizer, not yet a full photo-editing studio.

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
