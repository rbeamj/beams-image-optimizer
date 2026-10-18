import { describe, expect, it } from 'vitest';
import { runBatch } from '../src/engine/batch';

describe('batch processing', () => {
  it('keeps successful results and reports a non-fatal item failure', async () => {
    const progress: string[] = [];
    const result = await runBatch([{ name: 'one.jpg' }, { name: 'bad.jpg' }, { name: 'three.jpg' }], async item => {
      if (item.name === 'bad.jpg') throw new Error('decode failed');
      return item.name.toUpperCase();
    }, event => progress.push(`${event.index}:${event.error ? 'error' : 'ok'}`));
    expect(result).toEqual(['ONE.JPG', 'THREE.JPG']);
    expect(progress).toEqual(['0:ok', '1:error', '2:ok']);
  });
  it('stops a batch on cancellation', async () => {
    await expect(runBatch([{ name: 'one.jpg' }], async () => { throw new DOMException('cancelled', 'AbortError'); })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
