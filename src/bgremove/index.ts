export { applyMatte, CLEANUP_RANGES, edgeCurve, maskFromOutput, MATTE_ADAPTERS, matteMetrics, toModelTensor } from './matte';
export type { EdgeCleanup, MatteAdapter, MatteModelId } from './matte';
export { removeBackground } from './remove';
export type { RemovalOptions, RemovalResult } from './remove';
export { releaseMatteSessions, webGpuAvailable } from './runtime';
export type { MatteProvider } from './runtime';

/** Soft gate: AI background removal stays off until the operator acknowledges the model notice. */
export const BG_REMOVAL_ACK_KEY = 'beams-bg-removal-ack-v1';
export const BG_REMOVAL_NOTICE = 'Optional AI background removal runs in this browser after you opt in; pixels are never uploaded. It uses U²-Netp (Apache-2.0, 4.6 MB). Upstream does not state terms for its DUTS training data. See docs/background-removal-evaluation.md.';
export const hasAcknowledgedBgRemoval = (storage: Pick<Storage, 'getItem'> = localStorage) => { try { return storage.getItem(BG_REMOVAL_ACK_KEY) === '1'; } catch { return false; } };
export const acknowledgeBgRemoval = (storage: Pick<Storage, 'setItem'> = localStorage) => storage.setItem(BG_REMOVAL_ACK_KEY, '1');
