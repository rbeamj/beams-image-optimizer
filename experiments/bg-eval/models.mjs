/**
 * Candidate registry. Preprocessing follows each publisher's reference code:
 * rembg sessions (U²-Net family, IS-Net), onnx-community/BiRefNet preprocessor_config,
 * BEN2 and RMBG-1.4 model cards. `browserFile` is the variant attempted in browsers.
 */
const IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
const HALF = { mean: [0.5, 0.5, 0.5], std: [1, 1, 1] };
const REMBG = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0';
const HF = 'https://huggingface.co';

export const MODELS = [
  { id: 'u2netp', label: 'U²-Netp', file: 'u2netp.onnx', url: `${REMBG}/u2netp.onnx`, bytes: 4574861, size: 320, ...IMAGENET, post: 'minmax', tier: 'light', current: true },
  { id: 'silueta', label: 'silueta', file: 'silueta.onnx', url: `${REMBG}/silueta.onnx`, bytes: 44173029, size: 320, ...IMAGENET, post: 'minmax', tier: 'light' },
  { id: 'u2net', label: 'U²-Net', file: 'u2net.onnx', url: `${REMBG}/u2net.onnx`, bytes: 175997641, size: 320, ...IMAGENET, post: 'minmax', tier: 'mid' },
  { id: 'isnet', label: 'IS-Net general', file: 'isnet-general-use.onnx', url: `${REMBG}/isnet-general-use.onnx`, bytes: 178648008, size: 1024, ...HALF, post: 'minmax', tier: 'mid' },
  { id: 'birefnet-lite-512', label: 'BiRefNet lite 512', file: 'birefnet-lite-512.onnx', url: `${HF}/JONNYVERSE/birefnet-lite-512/resolve/main/onnx/model.onnx`, bytes: 191877254, size: 512, ...IMAGENET, post: 'sigmoid', tier: 'mid',
    variants: [{ file: 'birefnet-lite-512-fp16.onnx', url: `${HF}/JONNYVERSE/birefnet-lite-512/resolve/main/onnx/model_fp16.onnx`, bytes: 98484532 }] },
  { id: 'birefnet-lite-1024', label: 'BiRefNet lite 1024', file: 'birefnet-lite-1024.onnx', url: `${HF}/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx`, bytes: 224005088, size: 1024, ...IMAGENET, post: 'sigmoid', tier: 'high',
    variants: [{ file: 'birefnet-lite-1024-fp16.onnx', url: `${HF}/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx`, bytes: 114538221 }] },
  { id: 'birefnet-lite-1024-webgpu', label: 'BiRefNet lite 1024 WebGPU graph (Backgroundless)', file: 'birefnet-lite-1024-webgpu-fp16.onnx', url: `${HF}/jiabins0303/birefnet-lite-1024-webgpu/resolve/main/onnx/model_fp16.onnx`, bytes: 114834127, size: 1024, ...IMAGENET, post: 'sigmoid', tier: 'high', note: 'Graph rewritten (Split trees, GatherND→Gather); weights claimed unchanged from BiRefNet_lite fp16' },
  { id: 'birefnet-1024', label: 'BiRefNet general 1024', file: 'birefnet-1024.onnx', url: `${HF}/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx`, bytes: 972666916, size: 1024, ...IMAGENET, post: 'sigmoid', tier: 'high',
    variants: [{ file: 'birefnet-1024-fp16.onnx', url: `${HF}/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model_fp16.onnx`, bytes: 489666272 }] },
  { id: 'birefnet-hr-matting', label: 'BiRefNet HR matting 2048', file: 'birefnet-hr-matting.onnx', url: `${REMBG}/BiRefNet_HR-matting-epoch_135.onnx`, bytes: 1098928867, size: 2048, ...IMAGENET, post: 'sigmoid', tier: 'high' },
  { id: 'ben2', label: 'BEN2 base', file: 'ben2-base.onnx', url: `${HF}/PramaLLC/BEN2/resolve/main/BEN2_Base.onnx`, bytes: 222932053, size: 1024, mean: [0, 0, 0], std: [1, 1, 1], post: 'minmax', tier: 'high', note: 'BEN2 onnx_run.py: ToTensor only, min-max output; graph needs ORT optimizations enabled to load' },
  { id: 'rmbg-1.4', label: 'RMBG-1.4 (non-commercial reference)', file: 'rmbg-1.4.onnx', url: `${HF}/briaai/RMBG-1.4/resolve/main/onnx/model.onnx`, bytes: 176153355, size: 1024, ...HALF, post: 'minmax', tier: 'reference',
    variants: [{ file: 'rmbg-1.4-int8.onnx', url: `${HF}/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx`, bytes: 44403226 }] },
];
