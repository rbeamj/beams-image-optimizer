# Real-ESRGAN prototype benchmarks

Generated: 2026-10-22T00:05:50.722Z
Host: win32 · 13th Gen Intel(R) Core(TM) i7-13700K · 24 logical cores · 51.2 GB RAM

## Model

| Field | Value |
| --- | --- |
| File | `public/models/realesr-general-x4v3.onnx` |
| Bytes | 4866417 |
| sha256 | `1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112` |

## Planning estimates

| Case | Model input | Output | Peak working set (estimate) |
| --- | --- | --- | --- |
| listing-1k-from-800x600 | 256×192 | 1024×768 | 26.4 MB |
| listing-2k-from-1600x1200 | 512×384 | 2048×1536 | 66.5 MB |
| phone-1k-from-4032x3024 | 256×192 | 1024×768 | 26.4 MB |

## CPU inference (`onnxruntime-node`, measured)

| Case | Input | Output | Elapsed ms | RSS after run |
| --- | --- | --- | --- | --- |
| listing-1k-from-800x600 | 256×192 | 1024×768 | 124 | 147 MB |
| listing-2k-from-1600x1200 | 512×384 | 2048×1536 | 585 | 357 MB |
| phone-1k-from-4032x3024 | 256×192 | 1024×768 | 116 | 367 MB |

Browser WASM is typically slower than native CPU; the Studio Enhance status line reports in-browser elapsed time.
