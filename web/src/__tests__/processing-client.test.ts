import { afterEach, expect, it, vi } from 'vitest';
import { droppedSources, upload, type Source } from '../processing/client';

afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });

it('reconciles a committed chunk after the response is lost without duplicating bytes', async () => {
  const file = new File([new Uint8Array(8)], 'input');
  const source: Source = { id: 'one', file, name: file.name, size: 8, directory: false };
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ id: 'upload' }))
    .mockResolvedValueOnce(response({ offset: 0 }))
    .mockRejectedValueOnce(new Error('Response lost'))
    .mockResolvedValueOnce(response({ offset: 3 }))
    .mockResolvedValueOnce(response({ offset: 8 }));
  vi.stubGlobal('fetch', fetch);
  const update = vi.fn();
  expect(await upload(source, new AbortController().signal, update)).toBe('upload');
  const lastRequest = fetch.mock.calls[4][1];
  expect(lastRequest.headers['Upload-Offset']).toBe('3');
  expect(lastRequest.body.size).toBe(5);
  expect(update).toHaveBeenLastCalledWith(8);
});

it('keeps an existing upload ID when resuming and honors cancellation', async () => {
  const source: Source = { id: 'one', upload: 'existing', file: new File(['12345'], 'input'), name: 'input', size: 5, directory: false };
  const fetch = vi.fn().mockResolvedValue(response({ offset: 2 }));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController(); controller.abort();
  await expect(upload(source, controller.signal, () => {})).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe('/api/process/uploads/existing');
});

it('preserves empty folders in directory drops', async () => {
  const entry = { isDirectory: true, fullPath: '/folder/empty', createReader: () => ({ readEntries: (resolve: (entries: unknown[]) => void) => resolve([]) }) };
  const transfer = { items: [{ webkitGetAsEntry: () => entry }], files: [] } as unknown as DataTransfer;
  const sources = await droppedSources(transfer);
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatchObject({ name: 'folder/empty/', directory: true, file: null, size: 0 });
});

it('rejects oversized drops instead of silently skipping files', async () => {
  const transfer = { items: [], files: [new File(['a'], 'a'), new File(['b'], 'b')] } as unknown as DataTransfer;
  await expect(droppedSources(transfer, 1)).rejects.toThrow('Nothing was added');
});
