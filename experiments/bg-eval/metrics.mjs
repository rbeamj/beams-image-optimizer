// metrics.mjs
export function binarize(a, t = 0.5) {
  const n = a.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] >= t ? 1 : 0;
  return out;
}

function prefixSum(bin, w, h) {
  const ps = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    const psRow = (y + 1) * (w + 1);
    const psPrev = y * (w + 1);
    let run = 0;
    for (let x = 0; x < w; x++) {
      run += bin[rowOff + x];
      ps[psRow + x + 1] = ps[psPrev + x + 1] + run;
    }
  }
  return ps;
}

function rectSum(ps, w, h, x0, y0, x1, y1) {
  const x2 = x1 + 1;
  const y2 = y1 + 1;
  return (
    ps[y2 * (w + 1) + x2] -
    ps[y2 * (w + 1) + x0] -
    ps[y0 * (w + 1) + x2] +
    ps[y0 * (w + 1) + x0]
  );
}

export function dilate(bin, w, h, r) {
  const n = w * h;
  const out = new Uint8Array(n);
  if (r === 0) {
    for (let i = 0; i < n; i++) out[i] = bin[i];
    return out;
  }
  const ps = prefixSum(bin, w, h);
  for (let y = 0; y < h; y++) {
    const y0 = y - r < 0 ? 0 : y - r;
    const y1 = y + r >= h ? h - 1 : y + r;
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x - r < 0 ? 0 : x - r;
      const x1 = x + r >= w ? w - 1 : x + r;
      out[rowOff + x] = rectSum(ps, w, h, x0, y0, x1, y1) > 0 ? 1 : 0;
    }
  }
  return out;
}

export function erode(bin, w, h, r) {
  const n = w * h;
  const out = new Uint8Array(n);
  if (r === 0) {
    for (let i = 0; i < n; i++) out[i] = bin[i];
    return out;
  }
  const ps = prefixSum(bin, w, h);
  const size = (2 * r + 1) * (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const y0 = y - r;
    const y1 = y + r;
    if (y0 < 0 || y1 >= h) continue;
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x - r;
      const x1 = x + r;
      if (x0 < 0 || x1 >= w) continue;
      out[rowOff + x] = rectSum(ps, w, h, x0, y0, x1, y1) === size ? 1 : 0;
    }
  }
  return out;
}

export function boundary(bin, w, h) {
  const n = w * h;
  const out = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const i = rowOff + x;
      if (bin[i] === 0) continue;
      let isB = 0;
      if (x > 0 && bin[i - 1] === 0) isB = 1;
      else if (x + 1 < w && bin[i + 1] === 0) isB = 1;
      else if (y > 0 && bin[i - w] === 0) isB = 1;
      else if (y + 1 < h && bin[i + w] === 0) isB = 1;
      else if (x === 0 || x + 1 === w || y === 0 || y + 1 === h) isB = 1;
      out[i] = isB;
    }
  }
  return out;
}

export function enclosedHoles(bin, w, h) {
  const n = w * h;
  const visited = new Uint8Array(n);
  const stack = [];
  const push = (i) => {
    if (visited[i] === 0 && bin[i] === 0) {
      visited[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x + 1 < w) push(i + 1);
    if (y > 0) push(i - w);
    if (y + 1 < h) push(i + w);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (bin[i] === 0 && visited[i] === 0) out[i] = 1;
  }
  return out;
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

export function evaluate(pred, gt, w, h, opts = {}) {
  const n = w * h;
  const predBin = binarize(pred, 0.5);
  const gtBin = binarize(gt, 0.5);

  // IoU
  let inter = 0;
  let union = 0;
  for (let i = 0; i < n; i++) {
    if (predBin[i] || gtBin[i]) union++;
    if (predBin[i] && gtBin[i]) inter++;
  }
  const iou = union === 0 ? 1 : inter / union;

  // MAE
  let maeSum = 0;
  for (let i = 0; i < n; i++) maeSum += Math.abs(pred[i] - gt[i]);
  const mae = maeSum / n;

  // Edge band B
  const gtBoundary = boundary(gtBin, w, h);
  const dilGb3 = dilate(gtBoundary, w, h, 3);
  const band = new Uint8Array(n);
  let bandCount = 0;
  let bandSum = 0;
  for (let i = 0; i < n; i++) {
    const inBand = dilGb3[i] === 1 || (gt[i] > 0.02 && gt[i] < 0.98);
    if (inBand) {
      band[i] = 1;
      bandCount++;
      bandSum += Math.abs(pred[i] - gt[i]);
    }
  }
  const edgeMae = bandCount === 0 ? 0 : bandSum / bandCount;

  // Boundary F
  const predBoundary = boundary(predBin, w, h);
  const dilGb2 = dilate(gtBoundary, w, h, 2);
  const dilPb2 = dilate(predBoundary, w, h, 2);
  let pbCount = 0;
  let gbCount = 0;
  let pbHit = 0;
  let gbHit = 0;
  for (let i = 0; i < n; i++) {
    if (predBoundary[i]) {
      pbCount++;
      if (dilGb2[i]) pbHit++;
    }
    if (gtBoundary[i]) {
      gbCount++;
      if (dilPb2[i]) gbHit++;
    }
  }
  let boundaryF;
  if (pbCount === 0 && gbCount === 0) boundaryF = 1;
  else if (pbCount === 0 || gbCount === 0) boundaryF = 0;
  else {
    const prec = pbHit / pbCount;
    const rec = gbHit / gbCount;
    boundaryF = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
  }

  // Thin recall
  const erode2 = erode(gtBin, w, h, 2);
  const dilErode2 = dilate(erode2, w, h, 2);
  const thin = new Uint8Array(n);
  let thinCount = 0;
  let thinSum = 0;
  for (let i = 0; i < n; i++) {
    if (gtBin[i] === 1 && dilErode2[i] === 0) {
      thin[i] = 1;
      thinCount++;
      thinSum += pred[i] >= 0.5 ? 1 : 0;
    }
  }
  const thinRecall = thinCount < 50 ? null : thinSum / thinCount;

  // Hole leak
  const gtHoles = enclosedHoles(gtBin, w, h);
  let holeCount = 0;
  let holeSum = 0;
  for (let i = 0; i < n; i++) {
    if (gtHoles[i] === 1 && gt[i] < 0.05) {
      holeCount++;
      holeSum += pred[i];
    }
  }
  const holeLeak = holeCount < 50 ? null : holeSum / holeCount;

  // Halo
  const dilGt6 = dilate(gtBin, w, h, 6);
  const dilGt1 = dilate(gtBin, w, h, 1);
  let ringCount = 0;
  let ringSum = 0;
  for (let i = 0; i < n; i++) {
    if (dilGt6[i] === 1 && dilGt1[i] === 0 && gt[i] < 0.05) {
      ringCount++;
      ringSum += pred[i];
    }
  }
  const halo = ringCount === 0 ? null : ringSum / ringCount;

  // Product loss
  let prodCount = 0;
  let prodMiss = 0;
  for (let i = 0; i < n; i++) {
    if (gt[i] > 0.95) {
      prodCount++;
      if (pred[i] < 0.5) prodMiss++;
    }
  }
  const productLoss = prodCount === 0 ? null : prodMiss / prodCount;

  // Translucency MAE
  let transCount = 0;
  let transSum = 0;
  for (let i = 0; i < n; i++) {
    if (gt[i] > 0.05 && gt[i] < 0.95) {
      transCount++;
      transSum += Math.abs(pred[i] - gt[i]);
    }
  }
  const translucencyMae = transCount < 200 ? null : transSum / transCount;

  // Shadow inclusion
  let shadowInclusion = null;
  if (opts.shadow) {
    let shCount = 0;
    let shSum = 0;
    for (let i = 0; i < n; i++) {
      if (opts.shadow[i] === 1 && gt[i] < 0.05) {
        shCount++;
        shSum += pred[i];
      }
    }
    shadowInclusion = shCount < 50 ? null : shSum / shCount;
  }

  // Composite errors
  let compositeError = null;
  let compositeEdgeError = null;
  if (opts.src && opts.fg) {
    const dilGt8 = dilate(gtBin, w, h, 8);
    let compCount = 0;
    let compSum = 0;
    let compEdgeCount = 0;
    let compEdgeSum = 0;
    for (let y = 0; y < h; y++) {
      const rowOff = y * w;
      const base = rowOff * 3;
      for (let x = 0; x < w; x++) {
        const i = rowOff + x;
        const c = base + x * 3;
        let err = 0;
        for (let k = 0; k < 3; k++) {
          const p = pred[i] * opts.src[c + k] + (1 - pred[i]) * 255;
          const g = gt[i] * opts.fg[c + k] + (1 - gt[i]) * 255;
          err += Math.abs(p - g) / 255;
        }
        if (dilGt8[i]) {
          compCount += 3;
          compSum += err;
        }
        if (band[i]) {
          compEdgeCount += 3;
          compEdgeSum += err;
        }
      }
    }
    compositeError = compCount === 0 ? 0 : compSum / compCount;
    compositeEdgeError = compEdgeCount === 0 ? 0 : compEdgeSum / compEdgeCount;
  }

  return {
    iou: round4(iou),
    mae: round4(mae),
    edgeMae: round4(edgeMae),
    boundaryF: round4(boundaryF),
    thinRecall: thinRecall === null ? null : round4(thinRecall),
    holeLeak: holeLeak === null ? null : round4(holeLeak),
    halo: halo === null ? null : round4(halo),
    productLoss: productLoss === null ? null : round4(productLoss),
    translucencyMae: translucencyMae === null ? null : round4(translucencyMae),
    shadowInclusion: shadowInclusion === null ? null : round4(shadowInclusion),
    compositeError: compositeError === null ? null : round4(compositeError),
    compositeEdgeError: compositeEdgeError === null ? null : round4(compositeEdgeError),
  };
}
