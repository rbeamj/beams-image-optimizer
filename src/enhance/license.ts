/** Soft gate: AI Enhance stays disabled until the operator acknowledges the notice. */
export const ENHANCE_LICENSE_ACK_KEY = 'beams-enhance-license-ack-v1';

export const ENHANCE_LICENSE_SUMMARY = [
  'Optional Real-ESRGAN enhance runs entirely in this browser after you opt in.',
  'Model: realesr-general-x4v3 (BSD-3-Clause, © Xintao Wang / Real-ESRGAN).',
  'Weights are loaded as local assets; image pixels are not uploaded for inference.',
  'Training-data residual risk (DIV2K academic terms) is documented in docs/realesrgan-audit.md.',
].join(' ');

export function hasAcknowledgedEnhanceLicense(storage: Pick<Storage, 'getItem'> = localStorage) {
  try { return storage.getItem(ENHANCE_LICENSE_ACK_KEY) === '1'; } catch { return false; }
}

export function acknowledgeEnhanceLicense(storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(ENHANCE_LICENSE_ACK_KEY, '1');
}
