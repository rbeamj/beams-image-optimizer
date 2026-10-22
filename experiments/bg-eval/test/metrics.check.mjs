// test/metrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binarize, dilate, erode, boundary, enclosedHoles, evaluate } from '../metrics.mjs';

test('binarize threshold', () => {
  const a = new Float32Array([0, 0.4, 0.5, 0.6, 1]);
  const out = binarize(a, 0.5);
  assert.deepEqual([...out], [0, 0, 1, 1, 1]);
  const out2 = binarize(a, 0.7);
  assert.deepEqual([...out2], [0, 0, 0, 0, 1]);
});

test('dilate single pixel', () => {
  const bin = new Uint8Array([0,0,0, 0,1,0, 0,0,0]);
  const out = dilate(bin, 3, 3, 1);
  assert.deepEqual([...out], [1,1,1, 1,1,1, 1,1,1]);
});

test('dilate 3x3 block radius 1 fills 5x5', () => {
  const bin = new Uint8Array(25);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) bin[y*5+x] = 1;
  const out = dilate(bin, 5, 5, 1);
  const expected = new Uint8Array(25);
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) expected[y*5+x] = 1;
  assert.deepEqual([...out], [...expected]);
});

test('dilate r=0 returns copy', () => {
  const bin = new Uint8Array([1,0,1]);
  const out = dilate(bin, 3, 1, 0);
  assert.deepEqual([...out], [1,0,1]);
  out[0] = 9;
  assert.equal(bin[0], 1);
});

test('erode single pixel radius 1 -> all zero (border rule)', () => {
  const bin = new Uint8Array([0,0,0, 0,1,0, 0,0,0]);
  const out = erode(bin, 3, 3, 1);
  assert.deepEqual([...out], [0,0,0, 0,0,0, 0,0,0]);
});

test('erode 3x3 block radius 1 -> center only', () => {
  const bin = new Uint8Array(25);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) bin[y*5+x] = 1;
  const out = erode(bin, 5, 5, 1);
  const expected = new Uint8Array(25);
  expected[2*5+2] = 1;
  assert.deepEqual([...out], [...expected]);
});

test('erode r=0 returns copy', () => {
  const bin = new Uint8Array([1,0,1]);
  const out = erode(bin, 3, 1, 0);
  assert.deepEqual([...out], [1,0,1]);
});

test('boundary of 3x3 block in 5x5 = 8 pixels', () => {
  const bin = new Uint8Array(25);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) bin[y*5+x] = 1;
  const out = boundary(bin, 5, 5);
  let count = 0;
  for (let v of out) count += v;
  assert.equal(count, 8);
  assert.equal(out[1*5+1], 1);
  assert.equal(out[2*5+2], 0);
});

test('enclosedHoles ring with centre hole', () => {
  const bin = new Uint8Array(25);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    if (x === 0 || x === 4 || y === 0 || y === 4) bin[y*5+x] = 1;
    else if (x === 1 || x === 3 || y === 1 || y === 3) bin[y*5+x] = 1;
  }
  const out = enclosedHoles(bin, 5, 5);
  assert.equal(out[2*5+2], 1);
  let count = 0;
  for (let v of out) count += v;
  assert.equal(count, 1);
});

test('enclosedHoles open ring -> no holes', () => {
  const bin = new Uint8Array(25);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    // Both rings are opened at x = 2, so the centre connects to the border.
    if (x === 2 && y <= 1) continue;
    if (x === 0 || x === 4 || y === 0 || y === 4) bin[y*5+x] = 1;
    else if (x === 1 || x === 3 || y === 1 || y === 3) bin[y*5+x] = 1;
  }
  const out = enclosedHoles(bin, 5, 5);
  let count = 0;
  for (let v of out) count += v;
  assert.equal(count, 0);
});

test('evaluate identical masks', () => {
  const w = 4, h = 4;
  const gt = new Float32Array([1,1,0,0, 1,1,0,0, 0,0,0,0, 0,0,0,0]);
  const pred = Float32Array.from(gt);
  const m = evaluate(pred, gt, w, h);
  assert.equal(m.iou, 1);
  assert.equal(m.mae, 0);
  assert.equal(m.boundaryF, 1);
  assert.equal(m.halo, 0);
  assert.equal(m.productLoss, 0);
  assert.equal(m.translucencyMae, null);
  assert.equal(m.shadowInclusion, null);
  assert.equal(m.compositeError, null);
  assert.equal(m.compositeEdgeError, null);
});

test('evaluate shifted square hand-computed', () => {
  const w = 4, h = 4;
  const gt = new Float32Array(16);
  const pred = new Float32Array(16);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) gt[y*4+x] = 1;
  for (let y = 1; y < 3; y++) for (let x = 1; x < 3; x++) pred[y*4+x] = 1;
  const m = evaluate(pred, gt, w, h);
  // One shared pixel; 3 gt-only + 3 pred-only pixels differ.
  assert.equal(m.iou, round4(1/7));
  assert.equal(m.mae, round4(6/16));
});

test('evaluate halo detection', () => {
  const w = 15, h = 15;
  const gt = new Float32Array(w * h);
  gt[7 * w + 7] = 1;
  const pred = new Float32Array(w * h).fill(0.3);
  pred[7 * w + 7] = 1;
  const m = evaluate(pred, gt, w, h);
  assert.equal(m.halo, 0.3);
});

test('evaluate productLoss half missing', () => {
  const w = 4, h = 1;
  const gt = new Float32Array([1,1,1,1]);
  const pred = new Float32Array([1,1,0,0]);
  const m = evaluate(pred, gt, w, h);
  assert.equal(m.productLoss, 0.5);
});

test('evaluate translucencyMae partial alpha', () => {
  const w = 200, h = 1;
  const gt = new Float32Array(w);
  const pred = new Float32Array(w);
  for (let i = 0; i < w; i++) { gt[i] = 0.5; pred[i] = 0.7; }
  const m = evaluate(pred, gt, w, h);
  assert.equal(m.translucencyMae, 0.2);
});

test('evaluate translucencyMae too few pixels -> null', () => {
  const w = 100, h = 1;
  const gt = new Float32Array(w);
  const pred = new Float32Array(w);
  for (let i = 0; i < w; i++) gt[i] = 0.5;
  const m = evaluate(pred, gt, w, h);
  assert.equal(m.translucencyMae, null);
});

test('evaluate shadowInclusion', () => {
  const w = 100, h = 1;
  const gt = new Float32Array(w);
  const pred = new Float32Array(w).fill(0.2);
  const shadow = new Uint8Array(w);
  shadow.fill(1, 0, 60);
  const m = evaluate(pred, gt, w, h, { shadow });
  assert.equal(m.shadowInclusion, 0.2);
});

test('evaluate shadowInclusion too few pixels -> null', () => {
  const w = 4, h = 1;
  const gt = new Float32Array([0,0,0,0]);
  const pred = new Float32Array([0.2,0.2,0.2,0.2]);
  const shadow = new Uint8Array([1,0,0,0]);
  const m = evaluate(pred, gt, w, h, { shadow });
  assert.equal(m.shadowInclusion, null);
});

test('evaluate compositeError zero when pred==gt and src==fg', () => {
  const w = 2, h = 2;
  const gt = new Float32Array([1,1,1,1]);
  const pred = new Float32Array([1,1,1,1]);
  const src = new Uint8Array([10,20,30, 40,50,60, 70,80,90, 100,110,120]);
  const fg = Uint8Array.from(src);
  const m = evaluate(pred, gt, w, h, { src, fg });
  assert.equal(m.compositeError, 0);
  assert.equal(m.compositeEdgeError, 0);
});

test('evaluate compositeError counts background bleed per channel', () => {
  const w = 2, h = 1;
  const gt = new Float32Array([1, 0]);
  const pred = new Float32Array([1, 1]);
  // Pixel 1 is background (0,0,0) wrongly kept: |0 - 255| / 255 = 1 on each channel.
  const src = new Uint8Array([100, 100, 100, 0, 0, 0]);
  const fg = new Uint8Array([100, 100, 100, 0, 0, 0]);
  const m = evaluate(pred, gt, w, h, { src, fg });
  assert.equal(m.compositeError, 0.5);
});

function round4(v) { return Math.round(v * 10000) / 10000; }
