import { describe, expect, it } from 'vitest';
import { isQueueRecord, QUEUE_RECORD_ID, queuedResult, toQueueRecord } from '../src/storage/queue';
import type { ImageResult } from '../src/engine/types';

const file = (name = 'photo.png') => new File(['bytes'], name, { type: 'image/png' });

const result = (): ImageResult => ({
  blob: new Blob(['webp']),
  filename: 'photo.webp',
  width: 1024,
  height: 1024,
  sourceWidth: 2178,
  sourceHeight: 1788,
  sourceBytes: 1000,
  outputBytes: 100,
  format: 'webp',
});

describe('queuedResult', () => {
  it('extracts the persistable subset of a result', () => {
    expect(queuedResult(result())).toEqual({
      blob: expect.any(Blob),
      filename: 'photo.webp',
      width: 1024,
      height: 1024,
      sourceWidth: 2178,
      sourceHeight: 1788,
      sourceBytes: 1000,
      outputBytes: 100,
      format: 'webp',
    });
  });
});

describe('toQueueRecord', () => {
  it('maps rows onto the persistable record', () => {
    const record = toQueueRecord([
      { file: file(), preset: 'Marketplace white 1:1', recipe: { format: 'webp', quality: 0.85, maxEdge: 1024, label: '1K' }, result: result() },
      { file: file('other.jpg'), error: 'Unable to decode other.jpg.' },
      { file: file('plain.webp') },
    ]);
    expect(record.id).toBe(QUEUE_RECORD_ID);
    expect(record.rows).toHaveLength(3);
    expect(record.rows[0]).toMatchObject({ fileName: 'photo.png', fileType: 'image/png', preset: 'Marketplace white 1:1', recipe: { format: 'webp', quality: 0.85, maxEdge: 1024, label: '1K' } });
    expect(record.rows[0].result?.blob).toBeInstanceOf(Blob);
    expect(record.rows[1]).toMatchObject({ fileName: 'other.jpg', error: 'Unable to decode other.jpg.', result: null, preset: null, recipe: null });
    expect(record.rows[2]).toMatchObject({ fileName: 'plain.webp', error: null, result: null, preset: null, recipe: null });
  });
});

describe('isQueueRecord', () => {
  const record = () => toQueueRecord([{ file: file() }]);

  it('accepts a mapped record', () => {
    expect(isQueueRecord(record())).toBe(true);
  });

  it('accepts rows with and without outcomes', () => {
    expect(isQueueRecord(toQueueRecord([{ file: file(), error: 'Cancelled' }, { file: file(), result: result() }]))).toBe(true);
  });

  it('rejects records with the wrong id or shape', () => {
    expect(isQueueRecord({ id: 'other', rows: [] })).toBe(false);
    expect(isQueueRecord({ id: QUEUE_RECORD_ID, rows: {} })).toBe(false);
    expect(isQueueRecord({ id: QUEUE_RECORD_ID, rows: [{ fileName: 'x.png', fileType: 'image/png' }] })).toBe(false);
  });

  it('rejects malformed outcomes and metadata', () => {
    const base = record();
    expect(isQueueRecord({ ...base, rows: [{ ...base.rows[0]!, error: 7 }] })).toBe(false);
    expect(isQueueRecord({ ...base, rows: [{ ...base.rows[0]!, preset: true }] })).toBe(false);
    expect(isQueueRecord({ ...base, rows: [{ ...base.rows[0]!, result: { blob: 'png', filename: 'a.webp', width: 1, height: 1, sourceWidth: 1, sourceHeight: 1, sourceBytes: 1, outputBytes: 1, format: 'webp' } }] })).toBe(false);
    expect(isQueueRecord({ ...base, rows: [{ ...base.rows[0]!, result: { blob: new Blob(['x']), filename: 'a.webp', width: 1, height: 1, sourceWidth: 1, sourceHeight: 1, sourceBytes: 1, outputBytes: 'small' as unknown as number, format: 'webp' } }] })).toBe(false);
  });

  it('accepts recipes only when they are complete, and rejects them otherwise', () => {
    const base = record();
    expect(isQueueRecord({ ...base, rows: [{ ...base.rows[0]!, recipe: { format: 'webp', quality: 0.82, maxEdge: 2048, label: '2K' } }] })).toBe(true);
    expect(isQueueRecord({ ...base, rows: [{ ...base.rows[0]!, recipe: { format: 'webp', quality: 0.82, maxEdge: 2048 } }] })).toBe(false);
    expect(isQueueRecord({ ...base, rows: [{ ...base.rows[0]!, recipe: { format: 7, quality: 0.82, maxEdge: 2048, label: '2K' } as never }] })).toBe(false);
  });
});
