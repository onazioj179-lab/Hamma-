import { afterEach, expect, it, vi } from 'vitest';
import { droppedSources, randomId, requestId, upload, request, type Source } from '../processing/client';

afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });

it('creates stable retry keys on HTTP phones without subtle crypto or randomUUID', async () => {
  vi.stubGlobal('crypto', { getRandomValues: (data: Uint8Array) => { for (let i = 0; i < data.length; i++) data[i] = (i + Math.floor(Math.random() * 256)) % 256; return data; } });
  expect(randomId()).toMatch(/^[a-f0-9]{32}$/);
  const key = await requestId(['phone', 'zip']);
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  expect(await requestId(['phone', 'zip'])).toBe(key);
  expect(await requestId(['other-phone', 'zip'])).not.toBe(key);
});

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
  expect(fetch).not.toHaveBeenCalled();
  expect(source.upload).toBe('existing');
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

it('recreates an expired upload and sends the original bytes from the beginning', async () => {
  const source: Source = { id: 'retry', upload: 'expired', file: new File(['123'], 'file.txt'), name: 'file.txt', size: 3, directory: false };
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({ error: 'Expired' }) })
    .mockResolvedValueOnce(response({ id: 'fresh' }))
    .mockResolvedValueOnce(response({ offset: 0 }))
    .mockResolvedValueOnce(response({ offset: 3 }));
  vi.stubGlobal('fetch', fetch);
  expect(await upload(source, new AbortController().signal, () => {})).toBe('fresh');
  expect(source.upload).toBe('fresh');
  expect(fetch.mock.calls[3][0]).toBe('/api/process/uploads/fresh');
  expect(fetch.mock.calls[3][1].body.size).toBe(3);
});
it('times out a stalled processor and cleans up cancellation', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })));
  try {
    const pending = request('/capabilities');
    const failed = expect(pending).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(30001);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('reports unreadable processor responses without displaying server HTML', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('<html>proxy failure</html>'); } })));
  await expect(request('/jobs')).rejects.toThrow('unreadable response');
});

it('exposes the server retry interval without automatically resubmitting work', async () => {
  const fetch = vi.fn(async () => ({ ok: false, status: 429, headers: { get: () => '12' }, json: async () => ({ error: 'Too many requests' }) }));
  vi.stubGlobal('fetch', fetch);
  await expect(request('/jobs')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 12, message: 'Too many requests. Try again in 12 seconds.' });
  expect(fetch).toHaveBeenCalledOnce();
});
it('preserves cancellation during response parsing', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError'); } })));
  await expect(request('/jobs', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
