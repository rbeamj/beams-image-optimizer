export { applyMatte, CLEANUP_RANGES, edgeCurve, maskFromOutput, MATTE_ADAPTERS, matteMetrics, toModelTensor } from './matte';
export type { EdgeCleanup, MatteAdapter, MatteModelId } from './matte';
export { removeBackground } from './remove';
export type { RemovalOptions, RemovalResult } from './remove';
export { releaseMatteSessions, webGpuAvailable } from './runtime';
export type { MatteProvider } from './runtime';

/** Soft gate: AI background removal stays off until the operator acknowledges the model notice. */
export const BG_REMOVAL_ACK_KEY = 'beams-bg-removal-ack-v1';
export const BG_REMOVAL_NOTICE = 'Optional AI background removal runs in this browser after you opt in; pixels are never uploaded. Auto picks BiRefNet lite 1024 or 512 (MIT) for this device, with U²-Netp (Apache-2.0) as the last fallback. Weights download on first use and are never bundled. Their training datasets carry research-only or unstated terms; see docs/model-licensing.md before commercial use.';
export const hasAcknowledgedBgRemoval = (storage: Pick<Storage, 'getItem'> = localStorage) => { try { return storage.getItem(BG_REMOVAL_ACK_KEY) === '1'; } catch { return false; } };
export const acknowledgeBgRemoval = (storage: Pick<Storage, 'setItem'> = localStorage) => storage.setItem(BG_REMOVAL_ACK_KEY, '1');
