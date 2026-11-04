import { expect, it } from 'vitest';
import { allocateSourcePaths } from '../processing/selection';
import type { Source } from '../processing/client';

const source = (name: string, id = name): Source => ({ id, name, file: new File([id], name), size: id.length, directory: false });

it('preserves distinct identities and original file references for duplicate names', () => {
  const files = [source('Photo.JPG', 'one'), source('photo.jpg', 'two')];
  const result = allocateSourcePaths([], files);
  expect(result.map(row => row.name)).toEqual(['Photo.JPG', 'duplicate-2/photo.jpg']);
  expect(result[1].id).toBe('two');
  expect(result[1].file).toBe(files[1].file);
});

it('reserves incoming paths and handles Unicode normalization across selections', () => {
  const result = allocateSourcePaths([source('é.png')], [source('e\u0301.png'), source('duplicate-2/e\u0301.png')]);
  expect(result.map(row => row.name)).toEqual(['duplicate-3/e\u0301.png', 'duplicate-2/e\u0301.png']);
});

it('retains every file in a 10000-file duplicate selection', () => {
  const files = Array.from({ length: 10000 }, (_, i) => source('photo.jpg', String(i)));
  const result = allocateSourcePaths([], files);
  expect(new Set(result.map(row => row.name)).size).toBe(10000);
  expect(result.map(row => row.id)).toEqual(files.map(row => row.id));
});

it('does not generate a directory beneath an existing file', () => {
  const result = allocateSourcePaths([source('photo.jpg'), source('duplicate-2')], [source('photo.jpg', 'new')]);
  expect(result[0].name).toBe('duplicate-3/photo.jpg');
});
