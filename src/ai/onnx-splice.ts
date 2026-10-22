/**
 * Applies a graph patch (scripts/make-graph-patch.py) to a downloaded ONNX model: graph nodes listed in the patch are
 * replaced and small initializers appended; every other protobuf field, including all weights, is copied verbatim.
 */

export type GraphPatch = {
  format: 'beams-onnx-graph-patch-v1';
  source: { url: string; bytes: number; sha256: string };
  result: { bytes: number; sha256: string };
  nodeCount: number;
  /** [original node index, base64 of replacement GraphProto field-1 entries (may be empty)] */
  replace: [number, string][];
  /** base64 of GraphProto field-5 (initializer) entries to append */
  append: string;
};

type Field = { field: number; start: number; payload: number; end: number };

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let scale = 1;
  for (;;) {
    const b = buf[pos++]!;
    result += (b & 0x7f) * scale;
    if (!(b & 0x80)) return [result, pos];
    scale *= 128;
  }
}

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return out;
}

function* fields(buf: Uint8Array, from = 0, to = buf.length): Generator<Field> {
  let pos = from;
  while (pos < to) {
    const start = pos;
    const [key, p] = readVarint(buf, pos);
    pos = p;
    const field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) { pos = readVarint(buf, pos)[1]; yield { field, start, payload: pos, end: pos }; }
    else if (wire === 1) { yield { field, start, payload: pos, end: pos + 8 }; pos += 8; }
    else if (wire === 2) { const [len, q] = readVarint(buf, pos); yield { field, start, payload: q, end: q + len }; pos = q + len; }
    else if (wire === 5) { yield { field, start, payload: pos, end: pos + 4 }; pos += 4; }
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function applyGraphPatch(model: Uint8Array, patch: GraphPatch): Uint8Array<ArrayBuffer> {
  if (patch.format !== 'beams-onnx-graph-patch-v1') throw new Error('Unknown graph patch format.');
  if (model.length !== patch.source.bytes) throw new Error('Graph patch does not match this model file.');
  const replace = new Map(patch.replace.map(([i, b64]) => [i, fromBase64(b64)]));
  const append = fromBase64(patch.append);
  const out = new Uint8Array(patch.result.bytes);
  let o = 0;
  const put = (bytes: Uint8Array | number[]) => { out.set(bytes, o); o += bytes.length; };
  for (const f of fields(model)) {
    if (f.field !== 7) { put(model.subarray(f.start, f.end)); continue; }
    // Graph: compute the new length first, then stream nodes / other fields.
    const graph: Uint8Array[] = [];
    let length = 0;
    let index = 0;
    for (const g of fields(model, f.payload, f.end)) {
      const part = g.field === 1 ? (replace.get(index++) ?? model.subarray(g.start, g.end)) : model.subarray(g.start, g.end);
      graph.push(part);
      length += part.length;
    }
    if (index !== patch.nodeCount) throw new Error('Graph patch node count does not match this model.');
    graph.push(append);
    length += append.length;
    put([0x3a, ...varint(length)]);
    for (const part of graph) put(part);
  }
  if (o !== out.length) throw new Error('Patched model has an unexpected size.');
  return out;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
