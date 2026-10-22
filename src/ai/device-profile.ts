// src/ai/device-profile.ts
import type { DeviceProfile, VariantRecord } from './planner';

export type ProfileStore = Pick<Storage, 'getItem' | 'setItem'>;

export function profileKey(signature: string): string {
  return `beams-ai-profile-v1:${signature}`;
}

export function deviceSignature(caps: {
  webgpu: { f16: boolean; vendor: string; architecture: string; maxBufferSizeMB: number } | null;
  deviceMemoryGB: number | null;
  cores: number;
}): string {
  const gpu = caps.webgpu;
  const gpuPart = gpu
    ? `gpu:${gpu.vendor}/${gpu.architecture}/f16:${gpu.f16 ? 1 : 0}/buf:${gpu.maxBufferSizeMB}`
    : 'gpu:none';
  return `${gpuPart}|mem:${caps.deviceMemoryGB ?? '?'}|cores:${caps.cores}`;
}

function defaultStore(): ProfileStore | undefined {
  return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : undefined;
}

export function loadProfile(signature: string, store?: ProfileStore): DeviceProfile {
  const s = store ?? defaultStore();
  if (!s) return { variants: {} };
  try {
    const raw = s.getItem(profileKey(signature));
    if (!raw) return { variants: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.variants) return { variants: {} };
    return { variants: parsed.variants as Record<string, VariantRecord> };
  } catch {
    return { variants: {} };
  }
}

export function recordResult(
  signature: string,
  variantId: string,
  record: { ok: boolean; ms?: number; reason?: string },
  store?: ProfileStore,
  now?: number,
): DeviceProfile {
  const s = store ?? defaultStore();
  const profile = loadProfile(signature, s);
  profile.variants[variantId] = { ...record, at: now ?? Date.now() } as VariantRecord;
  if (s) {
    try {
      s.setItem(profileKey(signature), JSON.stringify(profile));
    } catch {
      // ignore storage write errors
    }
  }
  return profile;
}

export function lastSuccessful(profile: DeviceProfile, family?: string): string | null {
  let best: string | null = null;
  let bestAt = -1;
  for (const [id, rec] of Object.entries(profile.variants)) {
    if (!rec.ok) continue;
    if (family && !id.startsWith(`${family}-`)) continue;
    if (rec.at > bestAt) {
      bestAt = rec.at;
      best = id;
    }
  }
  return best;
}

export function loadMode(store?: ProfileStore): 'auto' | 'fast' | 'quality' {
  const s = store ?? defaultStore();
  if (!s) return 'auto';
  try {
    const raw = s.getItem('beams-ai-removal-mode');
    if (raw === 'auto' || raw === 'fast' || raw === 'quality') return raw;
  } catch {
    // ignore
  }
  return 'auto';
}

export function saveMode(mode: 'auto' | 'fast' | 'quality', store?: ProfileStore): void {
  const s = store ?? defaultStore();
  if (!s) return;
  try {
    s.setItem('beams-ai-removal-mode', mode);
  } catch {
    // ignore
  }
}
