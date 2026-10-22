# Roadmap

This roadmap is directional, not a promise or a delivery schedule. Beams Image Optimizer remains browser-local by default and keeps its processing engine reusable independently of the interface.

## Current: Quick Optimize

- Format conversion, compression, resizing, quality controls, recipes, batch processing, and downloads
- Clear per-result settings and byte statistics
- A dedicated, simple workspace for quick import, recipe selection, batch export, and download

## In progress: Photo Studio foundation

- Professional browser canvas with zoom, pan, rotate, flip, freeform and common-ratio crop, undo/redo, and local export
- Non-destructive adjustment controls for exposure, brightness, contrast, saturation, temperature, sharpness, grayscale, and sepia
- Preserve the original input; never silently change product details
- A distinct professional workspace that shares Quick Optimize's browser-local engine and export recipes

## Next: Photo Studio core

- Better before/after splitter and export framing
- Project save/load and composition features such as text, shapes, overlays, layers, alignment, and templates
- Manually controlled shadows and more advanced selective editing

## Longer term: local product-photo tools

- Prototype done: background scenes (gradients, uploaded photos, framing, padding, shadows) and opt-in U²-Netp background removal; see [background-removal-evaluation.md](docs/background-removal-evaluation.md)
- Higher-detail cutouts (hair, laces, glass) once a model with clear training-data terms runs within ordinary-hardware browser limits
- Batch editing and reusable product-photo templates
- Prototype done: opt-in Real-ESRGAN enhance; see [realesrgan-audit.md](docs/realesrgan-audit.md)
- Additional export formats where browser support makes them practical

AI features are opt-in and run in the browser; model weights are fetched separately and never committed. No remote processing service, account system, or image-upload backend is included in the current alpha.
