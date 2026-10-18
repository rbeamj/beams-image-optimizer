# Beams Image Optimizer

A privacy-first, browser-local image optimizer. It converts JPEG, PNG, and WebP images, resizes them using the embedded EXIF orientation where the browser supports it, and never uploads a file.

## What is included

- A reusable, UI-independent TypeScript engine in `src/engine/`
- A static, accessible single-page application in `src/main.ts`
- JPEG, PNG and WebP output; PNG/WebP retain transparency when browser encoders support it
- Original, 1K, 2K, 3K, 4K, and Custom maximum-long-edge controls that never upscale
- Smallest File, Balanced, High Quality, Product Photo 1K, and Custom recipes
- A photo-studio batch queue with light/dark presentation, previews, byte statistics, cancellation, and per-image/all downloads
- Results retain the recipe used for that run, distinct from the settings currently selected for the next batch
- GitHub Pages-compatible production output (`npm run build` produces `dist/` with relative asset paths)

## Run locally

```sh
npm install
npm run dev
npm test
npm run build
```

## Reusing the engine

Import only from `src/engine`, which has no UI imports or application state:

```ts
import { optimizeImage } from './engine';
const result = await optimizeImage(file, { format: 'webp', quality: .82, maxEdge: 2000 });
```

`AbortSignal` can cancel between decode, draw, and encode operations. Browser canvas operations cannot be forcibly interrupted mid-encode, so cancellation completes at the next safe boundary.

## Privacy and compatibility

All image bytes remain local to the browser. Output availability and metadata orientation handling ultimately depend on the browser's decoding and canvas capabilities. JPEG cannot represent transparent pixels; the engine composites those on white by default. There are no runtime dependencies. Development dependencies (Vite, TypeScript, Vitest, and `@types/node`) are MIT-licensed or Apache-2.0 licensed; verify their lockfile-resolved versions before any publication.

## License

MIT. See [LICENSE](LICENSE).
