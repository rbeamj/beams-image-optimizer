import ort from 'onnxruntime-node';
import { readdirSync } from 'node:fs';
for (const f of readdirSync('models').filter(f => f.endsWith('.onnx'))) {
  try {
    const s = await ort.InferenceSession.create('models/' + f, { executionProviders: ['cpu'], graphOptimizationLevel: 'disabled' });
    const i = s.inputMetadata[0], o = s.outputMetadata;
    console.log(f, '| in', s.inputNames[0], i.type, JSON.stringify(i.shape), '| outs', s.outputNames.length, s.outputNames.slice(0, 2).join(','), JSON.stringify(o[0]?.shape));
    await s.release();
  } catch (e) { console.log(f, 'ERR', e.message.slice(0, 120)); }
}
