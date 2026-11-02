import { describe, expect, it } from 'vitest';
import { chunkArray } from '../utils/fileHelpers';

describe('chunkArray', () => {
  it('preserves order and the final partial chunk', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 2)).toEqual([]);
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid chunk size %s without hanging', (size) => {
      expect(() => chunkArray([1], size)).toThrow(RangeError);
    },
  );
});
