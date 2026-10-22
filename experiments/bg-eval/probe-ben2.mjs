import ort from 'onnxruntime-node';
for (const level of ['basic', 'extended', 'all']) {
  try { const s = await ort.InferenceSession.create('models/ben2-base.onnx', { executionProviders: ['cpu'], graphOptimizationLevel: level }); console.log(level, 'OK', s.inputNames, JSON.stringify(s.inputMetadata[0].shape), s.outputNames, s.inputMetadata[0].type); await s.release(); }
  catch (e) { console.log(level, 'ERR', e.message.slice(0, 160)); }
}
