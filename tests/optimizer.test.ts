import { beforeEach, describe, expect, it } from 'vitest';
import { optimizeImage } from '../src/engine/optimizer';

class FakeBitmap {
  constructor(public width: number, public height: number) {}
  close() {}
}

let fills = 0;
beforeEach(() => {
  fills = 0;
  Object.assign(globalThis, {
    window: globalThis,
    ImageBitmap: FakeBitmap,
    createImageBitmap: async () => new FakeBitmap(3000, 1500),
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: () => { fills += 1; }, drawImage: () => {} }), toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob(['image'], { type })) }) },
  });
});

const file = { name: 'sample.png', size: 1000 } as File;
describe('browser optimizer', () => {
  it('converts a source to 1K while preserving its aspect ratio', async () => {
    const result = await optimizeImage(file, { format: 'webp', quality: .8, maxEdge: 1024 });
    expect(result.width).toBe(1024);
    expect(result.height).toBe(512);
    expect(result.blob.type).toBe('image/webp');
  });
  it('does not upscale a smaller source', async () => {
    (globalThis.createImageBitmap as unknown as () => Promise<FakeBitmap>) = async () => new FakeBitmap(800, 400);
    const result = await optimizeImage(file, { format: 'png', maxEdge: 1024 });
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
    expect(result.blob.type).toBe('image/png');
  });
  it('composites JPEG output but not transparent-capable output', async () => {
    await optimizeImage(file, { format: 'jpeg', maxEdge: 1024 });
    expect(fills).toBe(1);
    await optimizeImage(file, { format: 'png', maxEdge: 1024 });
    expect(fills).toBe(1);
  });
});
