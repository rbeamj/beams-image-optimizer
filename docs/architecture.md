# Architecture

## Clean-room boundary

This repository is an independent implementation. It does not import from, embed, or rely on Beams Vault source code, assets, configuration, product data, or services. Its application code does not send image bytes or make processing API calls; a hosted static site still requires ordinary browser requests to load its assets.

## Engine

`src/engine/` is a browser-only TypeScript library with no UI dependencies:

- `types.ts` defines the stable public types.
- `math.ts` contains deterministic sizing, MIME, filename, and quality helpers.
- `optimizer.ts` decodes an image with its orientation applied where supported, draws a proportionally resized canvas, and encodes JPEG, PNG, or WebP.
- `index.ts` is the intended import surface for a future host application.

The engine accepts an `AbortSignal`. Cancellation is checked before and after each browser operation; browsers do not expose interruption for an already-running canvas encoder.

## Standalone UI

`src/main.ts` is a deliberately thin adapter over the engine. It owns DOM events, the batch queue, previews, visible status, and download actions. It never changes engine behavior or imports private application code.

## Privacy and output

Image bytes are decoded and encoded entirely through browser APIs. JPEG output is composited over white because JPEG has no alpha channel; PNG and WebP preserve alpha when the browser's encoder supports it. The site has no backend, telemetry, cookies, accounts, or uploads.

## Distribution

Vite is configured with `base: './'`, allowing the generated `dist/` folder to be hosted from a GitHub Pages project path without an application server. `dist/` is intentionally ignored and should be produced in CI or a release workflow.
