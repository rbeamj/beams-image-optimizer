"""
Build a small graph patch that turns a published ONNX model into a rewritten one without shipping any weights.

The patch lists, by original node index, the NodeProto entries that replace each changed node, plus the small
initializers the rewrite added. The browser applies it to the downloaded original (src/ai/onnx-splice.ts) by copying
every other protobuf field verbatim, so all weights still come from the upstream file.

    python scripts/make-graph-patch.py ORIGINAL.onnx REWRITTEN.onnx OUT.json --url URL

Checks before writing: the spliced bytes parse, their node list and initializers equal the rewritten model's, and
(unless --no-run) ONNX Runtime CPU gives identical outputs for the rewritten and spliced models on a random input.
"""

import argparse
import base64
import hashlib
import json
import sys

import numpy as np
import onnx


def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def read_varint(buf, pos):
    shift = result = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7


def fields(buf):
    """Yields (field_number, wire_type, start, payload_start, end) for each top-level field."""
    pos = 0
    while pos < len(buf):
        start = pos
        key, pos = read_varint(buf, pos)
        field, wire = key >> 3, key & 7
        if wire == 0:
            _, pos = read_varint(buf, pos)
            yield field, wire, start, pos, pos
        elif wire == 1:
            yield field, wire, start, pos, pos + 8
            pos += 8
        elif wire == 2:
            length, pos = read_varint(buf, pos)
            yield field, wire, start, pos, pos + length
            pos += length
        elif wire == 5:
            yield field, wire, start, pos, pos + 4
            pos += 4
        else:
            raise ValueError(f"unsupported wire type {wire}")


def entry(field, payload):
    return varint((field << 3) | 2) + varint(len(payload)) + payload


def splice(model, replace, append):
    """Reference implementation of src/ai/onnx-splice.ts."""
    out = bytearray()
    for field, wire, start, p0, end in fields(model):
        if field != 7:
            out += model[start:end]
            continue
        graph = model[p0:end]
        g = bytearray()
        index = 0
        for gf, gw, gs, gp0, ge in fields(graph):
            if gf == 1:
                g += replace.get(index, graph[gs:ge])
                index += 1
            else:
                g += graph[gs:ge]
        g += append
        out += entry(7, bytes(g))
    return bytes(out), index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("original")
    ap.add_argument("rewritten")
    ap.add_argument("out")
    ap.add_argument("--url", required=True, help="published URL of ORIGINAL")
    ap.add_argument("--no-run", action="store_true")
    args = ap.parse_args()

    original_bytes = open(args.original, "rb").read()
    orig = onnx.load_from_string(original_bytes)
    new = onnx.load(args.rewritten)
    O = [n.SerializeToString() for n in orig.graph.node]
    P = [n.SerializeToString() for n in new.graph.node]
    kept = set(O) & set(P)

    replace, j = {}, 0
    i = 0
    while i < len(O):
        if j < len(P) and P[j] == O[i]:
            i += 1
            j += 1
            continue
        k = next((k for k in range(i + 1, len(O)) if O[k] in kept), None)
        stop = O[k] if k is not None else None
        group = []
        while j < len(P) and P[j] != stop:
            group.append(P[j])
            j += 1
        replace[i] = b"".join(entry(1, n) for n in group)
        for d in range(i + 1, k if k is not None else len(O)):
            replace[d] = b""
        i = k if k is not None else len(O)
    assert j == len(P), "rewritten graph has trailing nodes that could not be placed"

    orig_init = [t.name for t in orig.graph.initializer]
    new_init = [t.name for t in new.graph.initializer]
    assert new_init[: len(orig_init)] == orig_init, "rewrite must only append initializers"
    append = b"".join(entry(5, t.SerializeToString()) for t in new.graph.initializer[len(orig_init):])

    spliced, node_count = splice(original_bytes, replace, append)
    check = onnx.load_from_string(spliced)
    assert [n.SerializeToString() for n in check.graph.node] == P, "spliced nodes differ from the rewritten model"
    assert [t.name for t in check.graph.initializer] == new_init
    onnx.checker.check_model(check, full_check=False)

    if not args.no_run:
        import onnxruntime as ort

        a = ort.InferenceSession(args.rewritten, providers=["CPUExecutionProvider"])
        b = ort.InferenceSession(spliced, providers=["CPUExecutionProvider"])
        inp = a.get_inputs()[0]
        shape = [d if isinstance(d, int) else 1 for d in inp.shape]
        x = np.random.default_rng(0).standard_normal(shape).astype(np.float32)
        ya = a.run(None, {inp.name: x})[0]
        yb = b.run(None, {inp.name: x})[0]
        diff = float(np.max(np.abs(ya - yb)))
        print(f"ORT CPU output max |diff| = {diff}")
        assert diff == 0.0, "spliced model is not numerically identical"

    patch = {
        "format": "beams-onnx-graph-patch-v1",
        "source": {"url": args.url, "bytes": len(original_bytes), "sha256": hashlib.sha256(original_bytes).hexdigest()},
        "result": {"bytes": len(spliced), "sha256": hashlib.sha256(spliced).hexdigest()},
        "nodeCount": node_count,
        "replace": [[idx, base64.b64encode(data).decode()] for idx, data in sorted(replace.items())],
        "append": base64.b64encode(append).decode(),
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(patch, fh, separators=(",", ":"))
    print(f"replaced {sum(1 for v in replace.values() if v)} nodes, removed {sum(1 for v in replace.values() if not v)}, "
          f"appended {len(new_init) - len(orig_init)} initializers; patch {len(json.dumps(patch))} bytes; "
          f"result {len(spliced)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
