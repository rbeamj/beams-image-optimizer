// src/ai/planner.ts

import type { DeviceCaps } from './capabilities';
import { MODEL_VARIANTS, type ModelVariant, type ModelFamily } from './models';

export type RemovalMode = 'auto' | 'fast' | 'quality';
export type VariantRecord = { ok: boolean; ms?: number; reason?: string; at: number };
export type DeviceProfile = { variants: Record<string, VariantRecord> };
export type Plan = {
  attempts: string[];
  notes: string[];
  unavailable: { variantId: string; reason: string }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 14;
const SUCCESS_WINDOW_DAYS = 30;
const DEFAULT_SLOW_1024_MS = 15000;
const DEFAULT_SLOW_512_MS = 20000;

const MODE_CHAIN: Record<RemovalMode, ModelFamily[]> = {
  auto: ['birefnet-1024', 'birefnet-512', 'u2netp'],
  fast: ['birefnet-512', 'u2netp'],
  quality: ['birefnet-1024', 'birefnet-512', 'u2netp'],
};

export function eligibility(v: ModelVariant, caps: DeviceCaps): string | null {
  if (v.provider === 'webgpu' && caps.webgpu === null) {
    return 'WebGPU is not available in this browser';
  }
  if (v.requiresF16 && !caps.webgpu?.f16) {
    return 'this GPU does not support 16-bit shaders (shader-f16)';
  }
  if (v.minMaxBufferSizeMB != null && caps.webgpu?.maxBufferSizeMB != null && caps.webgpu.maxBufferSizeMB < v.minMaxBufferSizeMB) {
    return `GPU buffer limit ${caps.webgpu.maxBufferSizeMB} MB is below ${v.minMaxBufferSizeMB} MB`;
  }
  if (v.minDeviceMemoryGB != null && caps.deviceMemoryGB !== null && caps.deviceMemoryGB < v.minDeviceMemoryGB) {
    return `${v.minDeviceMemoryGB} GB of device memory recommended`;
  }
  if (v.family === 'birefnet-1024' && caps.mobile) {
    return 'Quality mode is disabled on mobile devices to avoid running out of memory';
  }
  return null;
}

function isRecent(at: number, now: number, days: number): boolean {
  return now - at <= days * DAY_MS;
}

function familyHasEligible(family: ModelFamily, caps: DeviceCaps, profile: DeviceProfile, now: number): boolean {
  return MODEL_VARIANTS.some(
    (v) => v.family === family && eligibility(v, caps) === null && !isFailedRecently(v.id, profile, now),
  );
}

function isFailedRecently(id: string, profile: DeviceProfile, now: number): boolean {
  const rec = profile.variants[id];
  return Boolean(rec && !rec.ok && isRecent(rec.at, now, RECENT_DAYS));
}

function recentSuccess(id: string, profile: DeviceProfile, now: number): VariantRecord | null {
  const rec = profile.variants[id];
  if (!rec?.ok || !isRecent(rec.at, now, SUCCESS_WINDOW_DAYS)) return null;
  return rec;
}

export function planRemoval(
  caps: DeviceCaps,
  mode: RemovalMode,
  profile: DeviceProfile,
  opts?: { now?: number; slowMs?: Record<string, number> },
): Plan {
  const now = opts?.now ?? Date.now();

  const notes: string[] = [];
  const unavailable: { variantId: string; reason: string }[] = [];
  const attempts: string[] = [];
  const seen = new Set<string>();

  const chain = MODE_CHAIN[mode];

  // Build per-family candidate lists (registry order), marking ineligible / recently failed.
  const familyCandidates: Record<string, string[]> = {};
  for (const family of chain) {
    const ids: string[] = [];
    for (const v of MODEL_VARIANTS) {
      if (v.family !== family) continue;
      const reason = eligibility(v, caps);
      if (reason) {
        unavailable.push({ variantId: v.id, reason });
        continue;
      }
      if (isFailedRecently(v.id, profile, now)) {
        const rec = profile.variants[v.id];
        unavailable.push({ variantId: v.id, reason: `failed on this device: ${rec?.reason ?? 'unknown error'}` });
        continue;
      }
      ids.push(v.id);
    }
    familyCandidates[family] = ids;
  }

  // Auto-mode slow-family demotion.
  if (mode === 'auto') {
    const demoteFamily = (family: ModelFamily, slowKey: string, slowDefault: number, fallbackNote: string) => {
      const ids = familyCandidates[family];
      if (!ids.length) return;
      const slowThreshold = opts?.slowMs?.[slowKey] ?? slowDefault;
      const hasSlowSuccess = ids.some((id) => {
        const rec = recentSuccess(id, profile, now);
        return Boolean(rec && rec.ms != null && rec.ms > slowThreshold);
      });
      if (hasSlowSuccess) {
        for (const id of ids) {
          const rec = profile.variants[id];
          if (rec?.ok && rec.ms != null && rec.ms > slowThreshold) {
            unavailable.push({ variantId: id, reason: `too slow on this device last time (${rec.ms} ms)` });
          }
        }
        familyCandidates[family] = [];
        notes.push(fallbackNote);
      }
    };

    demoteFamily('birefnet-1024', 'birefnet-1024', DEFAULT_SLOW_1024_MS, 'Quality was too slow on this device last time; using Fast');
    demoteFamily('birefnet-512', 'birefnet-512', DEFAULT_SLOW_512_MS, 'Fast was too slow on this device last time; using Basic');
  }

  // Auto-mode remembered-success promotion: highest eligible family first.
  const orderedFamilies = [...chain];
  if (mode === 'auto') {
    const highestEligible = chain.find((f) => familyCandidates[f].length > 0);
    if (highestEligible) {
      const promoted = familyCandidates[highestEligible].filter((id) => recentSuccess(id, profile, now));
      if (promoted.length) {
        // Move promoted ids to front of their family list.
        const rest = familyCandidates[highestEligible].filter((id) => !promoted.includes(id));
        familyCandidates[highestEligible] = [...promoted, ...rest];
      }
    }
  }

  // Flatten attempts.
  for (const family of orderedFamilies) {
    for (const id of familyCandidates[family]) {
      if (!seen.has(id)) {
        attempts.push(id);
        seen.add(id);
      }
    }
  }

  // Ensure u2netp is last if eligible.
  const u2netpIds = familyCandidates['u2netp'] ?? [];
  for (const id of u2netpIds) {
    if (!seen.has(id)) {
      attempts.push(id);
      seen.add(id);
    }
  }

  if (attempts.length === 0) {
    notes.push('No compatible background-removal model for this browser.');
  }

  // Quality-mode unavailability note.
  if (mode === 'quality') {
    const qIds = familyCandidates['birefnet-1024'];
    if (!qIds.length) {
      const firstReason = MODEL_VARIANTS
        .filter((v) => v.family === 'birefnet-1024')
        .map((v) => eligibility(v, caps))
        .find((r) => r != null);
      if (firstReason) {
        notes.push(`Quality (1024) is unavailable: ${firstReason}. Using Fast instead.`);
      }
    }
  }

  return { attempts, notes, unavailable };
}

export function describeMode(
  caps: DeviceCaps,
  mode: RemovalMode,
  profile: DeviceProfile,
): { available: boolean; message: string } {
  const now = Date.now();

  if (mode === 'auto') {
    const plan = planRemoval(caps, mode, profile, { now });
    const firstId = plan.attempts[0];
    const firstVariant = firstId ? MODEL_VARIANTS.find((v) => v.id === firstId) : undefined;
    const label = firstVariant ? ` (${firstVariant.label})` : '';
    return {
      available: plan.attempts.length > 0,
      message: `Auto picks Quality (1024) when this device can run it reliably, otherwise Fast (512).${label}`,
    };
  }

  const primaryFamily = mode === 'quality' ? 'birefnet-1024' : 'birefnet-512';
  const candidates = MODEL_VARIANTS.filter(
    (v) => v.family === primaryFamily && eligibility(v, caps) === null && !isFailedRecently(v.id, profile, now),
  );

  if (candidates.length === 0) {
    const fallback = MODE_CHAIN[mode].slice(1).find((f) => familyHasEligible(f, caps, profile, now));
    const fallbackVariant = fallback
      ? MODEL_VARIANTS.find((v) => v.family === fallback && eligibility(v, caps) === null && !isFailedRecently(v.id, profile, now))
      : undefined;
    const reason = MODEL_VARIANTS
      .filter((v) => v.family === primaryFamily)
      .map((v) => eligibility(v, caps))
      .find((r) => r != null);
    const fallbackPart = fallbackVariant
      ? ` Using ${fallbackVariant.label} instead.`
      : '';
    return {
      available: false,
      message: `${mode === 'quality' ? 'Quality (1024)' : 'Fast (512)'} is unavailable: ${reason ?? 'it failed on this device recently'}.${fallbackPart}`,
    };
  }

  // Pick the most recent successful candidate, else first in registry order.
  let chosen = candidates[0];
  let bestAt = -1;
  for (const v of candidates) {
    const rec = recentSuccess(v.id, profile, now);
    if (rec && rec.at > bestAt) {
      bestAt = rec.at;
      chosen = v;
    }
  }
  return { available: true, message: `Uses ${chosen.label}` };
}
