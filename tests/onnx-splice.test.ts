import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyGraphPatch, type GraphPatch } from '../src/ai/onnx-splice';

const enc = new TextEncoder();
const varint = (n: number) => { const o: number[] = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n >>>= 7; } o.push(n); return o; };
const lenField = (field: number, payload: number[]) => [(field << 3) | 2, ...varint(payload.length), ...payload];
const node = (name: string) => lenField(1, lenField(3, [...enc.encode(name)]));
const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

describe('applyGraphPatch', () => {
  // ModelProto { ir_version = 8 (field 1), graph (field 7) { node A, node B, node C, name "g" (field 2) }, opset (field 8) }
  const graph = [...node('A'), ...node('B'), ...lenField(2, [...enc.encode('g')]), ...node('C')];
  const model = new Uint8Array([0x08, 8, ...lenField(7, graph), ...lenField(8, [0x10, 17])]);
  const replacement = [...node('B1'), ...node('B2')];
  const init = lenField(5, lenField(8, [...enc.encode('k')]));
  const expectedGraph = [...node('A'), ...replacement, ...lenField(2, [...enc.encode('g')]), ...node('C'), ...init];
  const expected = new Uint8Array([0x08, 8, ...lenField(7, expectedGraph), ...lenField(8, [0x10, 17])]);
  const patch: GraphPatch = {
    format: 'beams-onnx-graph-patch-v1',
    source: { url: 'x', bytes: model.length, sha256: '' },
    result: { bytes: expected.length, sha256: '' },
    nodeCount: 3,
    replace: [[1, b64(replacement)]],
    append: b64(init),
  };

  it('replaces listed nodes, appends initializers and copies everything else verbatim', () => {
    expect([...applyGraphPatch(model, patch)]).toEqual([...expected]);
  });

  it('removes nodes whose replacement is empty', () => {
    const out = applyGraphPatch(model, { ...patch, replace: [[1, '']], append: '', result: { bytes: model.length - node('B').length, sha256: '' } });
    expect([...out]).toEqual([0x08, 8, ...lenField(7, [...node('A'), ...lenField(2, [...enc.encode('g')]), ...node('C')]), ...lenField(8, [0x10, 17])]);
  });

  it('rejects a model that does not match the patch', () => {
    expect(() => applyGraphPatch(model.subarray(1), patch)).toThrow('does not match');
    expect(() => applyGraphPatch(model, { ...patch, nodeCount: 4 })).toThrow('node count');
  });

  const original = 'public/models/birefnet-lite.onnx';
  const shipped = 'public/patches/birefnet-lite-1024-webgpu-fp32.json';
  it.skipIf(!existsSync(original))('turns the published BiRefNet lite 1024 export into the verified WebGPU graph', () => {
    const real = JSON.parse(readFileSync(shipped, 'utf8')) as GraphPatch;
    const out = applyGraphPatch(new Uint8Array(readFileSync(original)), real);
    expect(out.length).toBe(real.result.bytes);
    expect(createHash('sha256').update(out).digest('hex')).toBe(real.result.sha256);
  });
});
