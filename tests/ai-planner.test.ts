// tests/ai-planner.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { detectCapabilities } from '../src/ai/capabilities';
import { planRemoval, describeMode, eligibility } from '../src/ai/planner';
import { MODEL_VARIANTS } from '../src/ai/models';

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function makeNavigator(overrides: Record<string, any> = {}): any {
  return {
    gpu: undefined,
    deviceMemory: undefined,
    hardwareConcurrency: 8,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    userAgentData: undefined,
    ...overrides,
  };
}

function makeAdapter(overrides: Record<string, any> = {}): any {
  return {
    features: new Set<string>(),
    limits: {},
    info: {},
    ...overrides,
  };
}

function stubRequestAdapter(nav: any, adapter: any | null): void {
  nav.gpu = { requestAdapter: vi.fn().mockResolvedValue(adapter) };
}

function variantId(family: string, provider: string, precision?: string): string | undefined {
  return MODEL_VARIANTS.find((v) => v.family === family && v.provider === provider && (!precision || v.precision === precision))?.id;
}

const F16_DESKTOP = {
  webgpu: {
    f16: true,
    maxBufferSizeMB: 4096,
    maxStorageBufferBindingSizeMB: 4096,
    maxStorageBuffersPerShaderStage: 8,
    vendor: 'Apple',
    architecture: 'M2',
  },
  deviceMemoryGB: 8,
  cores: 8,
  crossOriginIsolated: false,
  mobile: false,
};

const NON_F16_DESKTOP = {
  webgpu: {
    f16: false,
    maxBufferSizeMB: 2048,
    maxStorageBufferBindingSizeMB: 2048,
    maxStorageBuffersPerShaderStage: 8,
    vendor: 'NVIDIA',
    architecture: 'GTX 1080 Ti',
  },
  deviceMemoryGB: 8,
  cores: 8,
  crossOriginIsolated: false,
  mobile: false,
};

const NO_WEBGPU = {
  webgpu: null,
  deviceMemoryGB: 8,
  cores: 4,
  crossOriginIsolated: false,
  mobile: false,
};

const LOW_MEMORY_PHONE = {
  webgpu: null,
  deviceMemoryGB: 2,
  cores: 4,
  crossOriginIsolated: false,
  mobile: true,
};

const UNKNOWN_MEMORY = {
  webgpu: null,
  deviceMemoryGB: null,
  cores: 2,
  crossOriginIsolated: false,
  mobile: false,
};

const emptyProfile: any = { variants: {} };

describe('capabilities', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('detects f16 GPU desktop', async () => {
    const adapter = makeAdapter({
      features: new Set(['shader-f16']),
      limits: { maxBufferSize: 4294967296, maxStorageBufferBindingSize: 4294967296, maxStorageBuffersPerShaderStage: 8 },
      info: { vendor: 'Apple', architecture: 'M2' },
    });
    const nav = makeNavigator({ deviceMemory: 8, hardwareConcurrency: 8 });
    stubRequestAdapter(nav, adapter);
    const caps = await detectCapabilities({ navigator: nav });
    expect(caps.webgpu?.f16).toBe(true);
    expect(caps.webgpu?.maxBufferSizeMB).toBe(4096);
    expect(caps.webgpu?.vendor).toBe('Apple');
    expect(caps.deviceMemoryGB).toBe(8);
    expect(caps.mobile).toBe(false);
  });

  it('detects non-f16 desktop GPU', async () => {
    const adapter = makeAdapter({
      features: new Set([]),
      limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 2147483648, maxStorageBuffersPerShaderStage: 8 },
      info: { vendor: 'NVIDIA', architecture: 'GTX 1080 Ti' },
    });
    const nav = makeNavigator({ deviceMemory: 8 });
    stubRequestAdapter(nav, adapter);
    const caps = await detectCapabilities({ navigator: nav });
    expect(caps.webgpu?.f16).toBe(false);
    expect(caps.webgpu?.maxBufferSizeMB).toBe(2048);
    expect(caps.deviceMemoryGB).toBe(8);
  });

  it('treats requestAdapter rejection as no WebGPU', async () => {
    const nav = makeNavigator({ deviceMemory: 8 });
    nav.gpu = { requestAdapter: vi.fn().mockRejectedValue(new Error('no gpu')) };
    const caps = await detectCapabilities({ navigator: nav });
    expect(caps.webgpu).toBeNull();
  });

  it('times out requestAdapter after 3000 ms', async () => {
    const nav = makeNavigator({ deviceMemory: 8 });
    let resolveAdapter: any;
    nav.gpu = {
      requestAdapter: vi.fn().mockImplementation(() => new Promise((r) => { resolveAdapter = r; })),
    };
    vi.useFakeTimers();
    const promise = detectCapabilities({ navigator: nav });
    await vi.advanceTimersByTimeAsync(3100);
    resolveAdapter(makeAdapter({ features: new Set(['shader-f16']) }));
    const caps = await promise;
    expect(caps.webgpu).toBeNull();
  });

  it('deviceMemory missing -> null', async () => {
    const nav = makeNavigator({ hardwareConcurrency: undefined });
    stubRequestAdapter(nav, null);
    const caps = await detectCapabilities({ navigator: nav });
    expect(caps.deviceMemoryGB).toBeNull();
    expect(caps.cores).toBe(2);
  });

  it('detects mobile from userAgentData', async () => {
    const nav = makeNavigator({ deviceMemory: 4, userAgentData: { mobile: true } });
    stubRequestAdapter(nav, null);
    const caps = await detectCapabilities({ navigator: nav });
    expect(caps.mobile).toBe(true);
  });

  it('detects mobile from UA fallback', async () => {
    const nav = makeNavigator({ deviceMemory: 4, userAgent: 'iPhone' });
    stubRequestAdapter(nav, null);
    const caps = await detectCapabilities({ navigator: nav });
    expect(caps.mobile).toBe(true);
  });
});

describe('eligibility', () => {
  const f16Caps = F16_DESKTOP;
  const nonF16Caps = NON_F16_DESKTOP;
  const noWebGPUCaps = NO_WEBGPU;
  const mobileCaps = LOW_MEMORY_PHONE;

  const birefnet1024Fp16 = MODEL_VARIANTS.find((v) => v.id === 'birefnet-1024-webgpu-fp16')!;
  const birefnet512Fp16 = MODEL_VARIANTS.find((v) => v.id === 'birefnet-512-webgpu-fp16')!;
  const u2netpWebgpu = MODEL_VARIANTS.find((v) => v.id === 'u2netp-webgpu')!;

  it('webgpu null -> message', () => {
    expect(eligibility(birefnet1024Fp16, noWebGPUCaps)).toBe('WebGPU is not available in this browser');
  });

  it('requiresF16 without f16 -> message', () => {
    expect(eligibility(birefnet1024Fp16, nonF16Caps)).toBe("this GPU does not support 16-bit shaders (shader-f16)");
  });

  it('minMaxBufferSizeMB below -> message', () => {
    const v = { ...birefnet1024Fp16, requiresF16: false, minMaxBufferSizeMB: 8192 };
    expect(eligibility(v, nonF16Caps)).toBe('GPU buffer limit 2048 MB is below 8192 MB');
  });

  it('minDeviceMemoryGB below -> message', () => {
    const v = { ...birefnet1024Fp16, minDeviceMemoryGB: 16 };
    expect(eligibility(v, f16Caps)).toBe('16 GB of device memory recommended');
  });

  it('mobile birefnet-1024 -> message', () => {
    expect(eligibility(birefnet1024Fp16, { ...f16Caps, mobile: true })).toBe('Quality mode is disabled on mobile devices to avoid running out of memory');
  });

  it('eligible -> null', () => {
    expect(eligibility(birefnet512Fp16, f16Caps)).toBeNull();
    expect(eligibility(MODEL_VARIANTS.find(v => v.id === 'u2netp-wasm')!, noWebGPUCaps)).toBeNull();
  });
});

describe('planRemoval', () => {
  const f16Id = variantId('birefnet-1024', 'webgpu', 'fp16')!;
  const f16_512 = variantId('birefnet-512', 'webgpu', 'fp16')!;
  const fp32_512 = variantId('birefnet-512', 'webgpu', 'fp32')!;
  const wasm_512 = variantId('birefnet-512', 'wasm', 'fp16')!;
  const u2_wgpu = variantId('u2netp', 'webgpu')!;
  const u2_wasm = variantId('u2netp', 'wasm')!;

  it('auto f16 desktop: 1024 fp16, fp32, 512 fp16, fp32, wasm, u2 webgpu, u2 wasm', () => {
    const plan = planRemoval(F16_DESKTOP, 'auto', emptyProfile, { now: NOW });
    expect(plan.attempts).toEqual([f16Id, 'birefnet-1024-webgpu-fp32', f16_512, fp32_512, wasm_512, u2_wgpu, u2_wasm]);
    expect(plan.notes).toEqual([]);
  });

  it('auto non-f16 desktop: skips fp16, starts 1024 fp32', () => {
    const plan = planRemoval(NON_F16_DESKTOP, 'auto', emptyProfile, { now: NOW });
    expect(plan.attempts[0]).toBe('birefnet-1024-webgpu-fp32');
    expect(plan.attempts).not.toContain('birefnet-1024-webgpu-fp16');
    expect(plan.attempts[plan.attempts.length - 1]).toBe(u2_wasm);
  });

  it('auto no WebGPU: falls to WASM 512 then u2netp wasm', () => {
    const plan = planRemoval(NO_WEBGPU, 'auto', emptyProfile, { now: NOW });
    expect(plan.attempts).toEqual([wasm_512, u2_wasm]);
    expect(plan.unavailable.map((u) => u.variantId)).toContain(f16Id);
  });

  it('auto low-memory phone: only u2netp wasm', () => {
    const plan = planRemoval(LOW_MEMORY_PHONE, 'auto', emptyProfile, { now: NOW });
    expect(plan.attempts).toEqual([u2_wasm]);
  });

  it('fast mode: 512 fp16, fp32, wasm, u2', () => {
    const plan = planRemoval(F16_DESKTOP, 'fast', emptyProfile, { now: NOW });
    expect(plan.attempts).toEqual([f16_512, fp32_512, wasm_512, u2_wgpu, u2_wasm]);
  });

  it('quality mode: 1024 fp16, fp32, 512..., u2', () => {
    const plan = planRemoval(F16_DESKTOP, 'quality', emptyProfile, { now: NOW });
    expect(plan.attempts[0]).toBe(f16Id);
    expect(plan.attempts[1]).toBe('birefnet-1024-webgpu-fp32');
    expect(plan.attempts[plan.attempts.length - 1]).toBe(u2_wasm);
  });

  it('quality unavailable on no-WebGPU adds note', () => {
    const plan = planRemoval(NO_WEBGPU, 'quality', emptyProfile, { now: NOW });
    expect(plan.notes.some((n) => n.includes('Quality (1024) is unavailable'))).toBe(true);
    expect(plan.attempts[0]).toBe(wasm_512);
  });

  it('mobile excludes 1024 in auto', () => {
    const plan = planRemoval(LOW_MEMORY_PHONE, 'auto', emptyProfile, { now: NOW });
    expect(plan.attempts).not.toContain(f16Id);
    expect(plan.attempts).not.toContain('birefnet-1024-webgpu-fp32');
  });

  it('failed record within 14 days is skipped', () => {
    const profile = {
      variants: {
        [f16Id]: { ok: false, reason: 'compile failed', at: NOW - 1000 },
      },
    };
    const plan = planRemoval(F16_DESKTOP, 'auto', profile, { now: NOW });
    expect(plan.attempts).not.toContain(f16Id);
    expect(plan.unavailable.some((u) => u.variantId === f16Id && u.reason.includes('failed on this device'))).toBe(true);
  });

  it('failed record older than 14 days is retried', () => {
    const profile = {
      variants: {
        [f16Id]: { ok: false, reason: 'compile failed', at: NOW - 15 * DAY_MS },
      },
    };
    const plan = planRemoval(F16_DESKTOP, 'auto', profile, { now: NOW });
    expect(plan.attempts[0]).toBe(f16Id);
  });

  it('slow 1024 success demotes whole family in auto', () => {
    const profile = {
      variants: {
        [f16Id]: { ok: true, ms: 20000, at: NOW - 1000 },
      },
    };
    const plan = planRemoval(F16_DESKTOP, 'auto', profile, { now: NOW });
    expect(plan.attempts).not.toContain(f16Id);
    expect(plan.attempts).not.toContain('birefnet-1024-webgpu-fp32');
    expect(plan.notes.some((n) => n.includes('Quality was too slow'))).toBe(true);
    expect(plan.attempts[0]).toBe(f16_512);
  });

  it('remembered 1024 success is tried first in auto', () => {
    const profile = {
      variants: {
        [f16Id]: { ok: true, ms: 5000, at: NOW - 1000 },
      },
    };
    const plan = planRemoval(F16_DESKTOP, 'auto', profile, { now: NOW });
    expect(plan.attempts[0]).toBe(f16Id);
  });

  it('remembered 512 success does not block eligible 1024', () => {
    const profile = {
      variants: {
        [f16_512]: { ok: true, ms: 3000, at: NOW - 1000 },
      },
    };
    const plan = planRemoval(F16_DESKTOP, 'auto', profile, { now: NOW });
    expect(plan.attempts[0]).toBe(f16Id);
    expect(plan.attempts.indexOf(f16_512)).toBeGreaterThan(plan.attempts.indexOf(f16Id));
  });

  it('u2netp always last when eligible', () => {
    const plan = planRemoval(F16_DESKTOP, 'auto', emptyProfile, { now: NOW });
    const u2Index = plan.attempts.indexOf(u2_wasm);
    expect(u2Index).toBe(plan.attempts.length - 1);
    expect(plan.attempts.indexOf(u2_wgpu)).toBeLessThan(u2Index);
  });

  it('empty plan gets message', () => {
    const noCaps: any = { webgpu: null, deviceMemoryGB: null, cores: 2, crossOriginIsolated: false, mobile: false };
    // Make everything ineligible by giving tiny memory to u2netp? u2netp has no memory gate, so force via failed records.
    const profile = {
      variants: {
        [wasm_512]: { ok: false, reason: 'oom', at: NOW },
        [u2_wgpu]: { ok: false, reason: 'oom', at: NOW },
        [u2_wasm]: { ok: false, reason: 'oom', at: NOW },
      },
    };
    const plan = planRemoval(NO_WEBGPU, 'auto', profile, { now: NOW });
    expect(plan.attempts).toEqual([]);
    expect(plan.notes.some((n) => n.includes('No compatible background-removal model'))).toBe(true);
  });
});

describe('describeMode', () => {
  const f16Id = variantId('birefnet-1024', 'webgpu', 'fp16')!;

  it('auto available message includes first variant label', () => {
    const d = describeMode(F16_DESKTOP, 'auto', emptyProfile);
    expect(d.available).toBe(true);
    expect(d.message).toContain('Auto picks Quality (1024)');
    expect(d.message).toContain(MODEL_VARIANTS.find((v) => v.id === f16Id)!.label);
  });

  it('fast message uses label', () => {
    const d = describeMode(F16_DESKTOP, 'fast', emptyProfile);
    expect(d.available).toBe(true);
    expect(d.message).toBe(`Uses ${MODEL_VARIANTS.find((v) => v.id === variantId('birefnet-512', 'webgpu', 'fp16'))!.label}`);
  });

  it('quality unavailable message', () => {
    const d = describeMode(NO_WEBGPU, 'quality', emptyProfile);
    expect(d.available).toBe(false);
    expect(d.message).toContain('Quality (1024) is unavailable');
    expect(d.message).toContain('Using');
  });
});
