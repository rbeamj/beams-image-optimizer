import { dimensionsWithinEdge } from '../engine/math';
import { REALESRGAN_SCALE, type EnhanceTargetEdge } from './types';

/** Longest edge fed to the 4× network so the 4× output lands on the chosen target. */
export function modelInputLongEdge(targetEdge: EnhanceTargetEdge, scale = REALESRGAN_SCALE) {
  return Math.max(1, Math.ceil(targetEdge / scale));
}

/** Pre-scale source pixels for the network, preserving aspect ratio. */
export function modelInputSize(sourceWidth: number, sourceHeight: number, targetEdge: EnhanceTargetEdge) {
  return dimensionsWithinEdge(sourceWidth, sourceHeight, modelInputLongEdge(targetEdge));
}

/** Final canvas size after 4× inference, clamped to the requested longest edge. */
export function enhanceOutputSize(modelInputWidth: number, modelInputHeight: number, targetEdge: EnhanceTargetEdge, scale = REALESRGAN_SCALE) {
  return dimensionsWithinEdge(modelInputWidth * scale, modelInputHeight * scale, targetEdge);
}

/** Rough activation + tensor working-set estimate for planning (not RSS). */
export function estimatePeakBytes(modelInputWidth: number, modelInputHeight: number, scale = REALESRGAN_SCALE) {
  const inputFloats = modelInputWidth * modelInputHeight * 3;
  const outputFloats = modelInputWidth * scale * modelInputHeight * scale * 3;
  const rgbaBuffers = modelInputWidth * modelInputHeight * 4 + modelInputWidth * scale * modelInputHeight * scale * 4;
  // float32 tensors + RGBA scratch + ~2× model weights (~5 MB) + ORT overhead factor
  return (inputFloats + outputFloats) * 4 + rgbaBuffers + 5_000_000 + 8_000_000;
}
