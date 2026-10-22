import ort from 'onnxruntime-node';
for (const f of ['mobilesam-acly-encoder.onnx','mobilesam-acly-decoder-single.onnx','migan-pipeline-v2.onnx','birefnet-lite-1024-webgpu-fp16.onnx']) {
  try { const s = await ort.InferenceSession.create('models/'+f, { executionProviders: ['cpu'] });
    console.log(f, '| IN', s.inputNames.map((n,i)=>n+':'+s.inputMetadata[i].type+JSON.stringify(s.inputMetadata[i].shape)).join(' '), '| OUT', s.outputNames.map((n,i)=>n+':'+s.outputMetadata[i].type+JSON.stringify(s.outputMetadata[i].shape)).join(' '));
    await s.release(); } catch (e) { console.log(f, 'ERR', e.message.slice(0,150)); } }
