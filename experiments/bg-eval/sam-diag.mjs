// Sanity check for the MobileSAM wiring: one positive click at the product's most interior pixel; IoU of SAM's mask vs ground truth.
import { readFile } from 'node:fs/promises';
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { binarize, erode, evaluate } from './metrics.mjs';
const S = 1024;
const enc = await ort.InferenceSession.create('models/mobilesam-acly-encoder.onnx');
const dec = await ort.InferenceSession.create('models/mobilesam-acly-decoder-single.onnx');
const set = JSON.parse(await readFile('data/set.json', 'utf8'));
const ious = [];
for (const e of set) {
  const rgb = await sharp(`data/${e.image}`).removeAlpha().raw().toBuffer();
  const gt = Float32Array.from(await sharp(`data/${e.gt}`).greyscale().raw().toBuffer(), v => v / 255);
  let core = binarize(gt);
  for (let r = 4; r < 300; r += 4) { const next = erode(binarize(gt), S, S, r); if (!next.some(v => v)) break; core = next; }
  const i = core.findIndex(v => v), x = i % S, y = Math.floor(i / S);
  const emb = (await enc.run({ input_image: new ort.Tensor('float32', Float32Array.from(rgb), [S, S, 3]) })).image_embeddings;
  const out = await dec.run({ image_embeddings: emb, point_coords: new ort.Tensor('float32', new Float32Array([x, y, 0, 0]), [1, 2, 2]), point_labels: new ort.Tensor('float32', new Float32Array([1, -1]), [1, 2]), mask_input: new ort.Tensor('float32', new Float32Array(65536), [1, 1, 256, 256]), has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]), orig_im_size: new ort.Tensor('float32', new Float32Array([S, S]), [2]) });
  const prob = Float32Array.from(out.masks.data, v => 1 / (1 + Math.exp(-v)));
  const m = evaluate(prob, gt, S, S);
  ious.push(m.iou);
  console.log(`${e.id.padEnd(24)} click (${x},${y}) dims ${out.masks.dims} IoU ${m.iou}`);
}
console.log('mean IoU', (ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(4));
