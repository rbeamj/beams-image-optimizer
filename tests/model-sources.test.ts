import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODEL_SOURCES, MODEL_VARIANTS, resolveModel } from '../src/ai/models';

const BASE = 'https://example.github.io/app/';

describe('model sources', () => {
  it('has a pinned, checksummed, CORS-enabled source for every model file the app uses', () => {
    for (const file of new Set([...MODEL_VARIANTS.map(v => v.file), 'realesr-general-x4v3.onnx'])) {
      const source = MODEL_SOURCES[file];
      expect(source, file).toBeDefined();
      expect(source!.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
      expect(source!.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('matches registry sizes, except the patched graph which downloads its original', () => {
    for (const v of MODEL_VARIANTS) {
      const source = MODEL_SOURCES[v.file]!;
      if (source.patch) {
        const patch = JSON.parse(readFileSync(`public/${source.patch}`, 'utf8'));
        expect(patch.source.bytes).toBe(source.bytes);
        expect(patch.source.sha256).toBe(source.sha256);
        expect(patch.result.bytes).toBe(v.bytes);
      } else expect(source.bytes, v.file).toBe(v.bytes);
    }
  });

  it('prefers a deployment-hosted copy listed in the manifest', () => {
    const r = resolveModel('u2netp.onnx', { files: { 'u2netp.onnx': { bytes: 4574861 } } }, BASE);
    expect(r).toEqual({ url: `${BASE}models/u2netp.onnx`, bytes: 4574861, hosted: true });
  });

  it('falls back to the upstream source, with integrity and patch information', () => {
    const plain = resolveModel('migan-pipeline-v2.onnx', null, BASE);
    expect(plain.hosted).toBe(false);
    expect(plain.url).toContain('andraniksargsyan/migan');
    expect(plain.sha256).toBe(MODEL_SOURCES['migan-pipeline-v2.onnx']!.sha256);
    const patched = resolveModel('birefnet-lite-1024-webgpu-fp32.onnx', { files: {} }, BASE);
    expect(patched.url).toContain('onnx-community/BiRefNet_lite-ONNX');
    expect(patched.patchUrl).toBe(`${BASE}patches/birefnet-lite-1024-webgpu-fp32.json`);
  });
});
