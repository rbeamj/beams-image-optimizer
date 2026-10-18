import { describe, expect, it } from 'vitest';
import { inputIssue, MAX_INPUT_BYTES } from '../src/engine/input';

describe('input validation', () => {
  it('accepts supported image formats within the local limit', () => expect(inputIssue({ type: 'image/webp', size: 1 } as File)).toBeUndefined());
  it('rejects unsupported, empty, and oversized files', () => {
    expect(inputIssue({ type: 'image/gif', size: 10 } as File)).toMatch(/Unsupported/);
    expect(inputIssue({ type: 'image/png', size: 0 } as File)).toMatch(/empty/);
    expect(inputIssue({ type: 'image/jpeg', size: MAX_INPUT_BYTES + 1 } as File)).toMatch(/50 MB/);
  });
});
