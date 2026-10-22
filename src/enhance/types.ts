export type EnhanceTargetEdge = 1024 | 2048;

export type EnhanceExecutionProvider = 'wasm' | 'webgpu';

export interface EnhanceOptions {
  targetEdge: EnhanceTargetEdge;
  signal?: AbortSignal;
  onProgress?: (fraction: number, label: string) => void;
  /** Override model URL (tests / custom hosting). Default: ./models/realesr-general-x4v3.onnx */
  modelUrl?: string;
}

export interface EnhanceResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  modelInputWidth: number;
  modelInputHeight: number;
  provider: EnhanceExecutionProvider;
  elapsedMs: number;
  peakBytesEstimate: number;
}

export const REALESRGAN_MODEL_ID = 'realesr-general-x4v3';
export const REALESRGAN_SCALE = 4;
export const DEFAULT_MODEL_URL = './models/realesr-general-x4v3.onnx';
