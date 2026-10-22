import { describe, expect, it } from 'vitest';
import { acknowledgeBgRemoval, BG_REMOVAL_ACK_KEY, BG_REMOVAL_NOTICE, hasAcknowledgedBgRemoval } from '../src/bgremove';
import { MATTE_ADAPTERS } from '../src/bgremove/matte';

describe('background removal gate and adapters', () => {
  it('stays off until the operator acknowledges the notice', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    expect(hasAcknowledgedBgRemoval(storage)).toBe(false);
    acknowledgeBgRemoval(storage);
    expect(store.get(BG_REMOVAL_ACK_KEY)).toBe('1');
    expect(hasAcknowledgedBgRemoval(storage)).toBe(true);
  });

  it('treats unreadable storage as not acknowledged', () => {
    expect(hasAcknowledgedBgRemoval({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
  });

  it('only allows BiRefNet on WebGPU and keeps U²-Netp available on both providers', () => {
    expect(MATTE_ADAPTERS.u2netp.providers).toEqual(['wasm', 'webgpu']);
    expect(MATTE_ADAPTERS['birefnet-lite'].providers).toEqual(['webgpu']);
  });

  it('names the shipped model and the license review in the notice', () => {
    expect(BG_REMOVAL_NOTICE).toContain('U²-Netp');
    expect(BG_REMOVAL_NOTICE).toContain('docs/background-removal-evaluation.md');
  });
});
