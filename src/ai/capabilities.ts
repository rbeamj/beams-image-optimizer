// src/ai/capabilities.ts

export type GpuCaps = {
  f16: boolean;
  maxBufferSizeMB: number;
  maxStorageBufferBindingSizeMB: number;
  maxStorageBuffersPerShaderStage: number;
  vendor: string;
  architecture: string;
};

export type DeviceCaps = {
  webgpu: GpuCaps | null;
  deviceMemoryGB: number | null;
  cores: number;
  crossOriginIsolated: boolean;
  mobile: boolean;
};

const MB = 1048576;
const ADAPTER_TIMEOUT_MS = 3000;

function floorMB(bytes: number): number {
  return Math.floor(bytes / MB);
}

function isMobileUA(ua?: string): boolean {
  if (!ua) return false;
  return /Android|iPhone|iPad|Mobile/i.test(ua);
}

export async function detectCapabilities(
  env?: { navigator?: any; crossOriginIsolated?: boolean },
): Promise<DeviceCaps> {
  const nav = env?.navigator ?? (typeof globalThis !== 'undefined' ? (globalThis as any).navigator : undefined);
  const crossOriginIsolated = env?.crossOriginIsolated ?? (typeof globalThis !== 'undefined' ? (globalThis as any).crossOriginIsolated : false);

  let webgpu: GpuCaps | null = null;
  const gpu = nav?.gpu;
  if (gpu?.requestAdapter) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('webgpu timeout')), ADAPTER_TIMEOUT_MS);
    });
    try {
      const adapter = await Promise.race([gpu.requestAdapter(), timeout]).finally(() => clearTimeout(timer));
      if (adapter) {
        const limits = adapter.limits ?? {};
        const info = adapter.info ?? {};
        webgpu = {
          f16: Boolean(adapter.features?.has?.('shader-f16')),
          maxBufferSizeMB: floorMB(limits.maxBufferSize ?? 0),
          maxStorageBufferBindingSizeMB: floorMB(limits.maxStorageBufferBindingSize ?? 0),
          maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage ?? 0,
          vendor: info.vendor ?? '',
          architecture: info.architecture ?? '',
        };
      }
    } catch {
      webgpu = null;
    }
  }

  const deviceMemory = nav?.deviceMemory;
  const deviceMemoryGB = typeof deviceMemory === 'number' && deviceMemory > 0 ? deviceMemory : null;
  const cores = typeof nav?.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
    ? nav.hardwareConcurrency
    : 2;
  const ua = typeof nav?.userAgent === 'string' ? nav.userAgent : '';
  const mobile =
    (nav?.userAgentData?.mobile === true) || isMobileUA(ua);

  return { webgpu, deviceMemoryGB, cores, crossOriginIsolated, mobile };
}
