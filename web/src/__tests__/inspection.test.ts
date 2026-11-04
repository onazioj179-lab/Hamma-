import { afterEach, expect, it, vi } from 'vitest';
import { inspectSources } from '../processing/inspection';
import type { Source } from '../processing/client';
afterEach(() => vi.unstubAllGlobals());
it('sends only a bounded header and retains the detected format', async () => {
  const file = new File([new Uint8Array(1024 * 1024)], 'misleading.jpg', { type: 'audio/wav' });
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ entries: [{ format: 'png', conversions: ['png'], extract: false }] }) }));
  vi.stubGlobal('fetch', fetchMock);
  const source: Source = { id: 'one', name: file.name, file, size: file.size, directory: false };
  const result = await inspectSources([source], new AbortController().signal);
  expect(result.get('one')?.format).toBe('png');
  expect(fetchMock.mock.calls[0][0]).toBe('/api/process/inspect');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).entries[0].head).toHaveLength(1024);
});
it('rejects oversized inspection batches and cancellation before reading', async () => {
  const source: Source = { id: 'one', name: 'file', file: new File(['test'], 'file'), size: 4, directory: false };
  await expect(inspectSources(Array(33).fill(source), new AbortController().signal)).rejects.toThrow('limit');
  const controller = new AbortController(); controller.abort();
  await expect(inspectSources([source], controller.signal)).rejects.toThrow();
});
