import { expect, it, vi, afterEach } from 'vitest';
import { combineActivity, filterActivity, loadJobs } from '../processing/activity';
import type { Job } from '../processing/client';
import type { RecentArchive } from '../store/app';
vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) }); });
afterEach(() => vi.unstubAllGlobals());
const job = (id: string, created: number): Job => ({ id, name: id + '.txt', created, operation: 'compress', target: 'zip', format: 'zip', state: 'completed', inputSize: 100, outputSize: 50, processed: 100, entries: 1, fileCount: 1, downloadAvailable: false, fileExpires: 0, historyExpires: null });
const archive: RecentArchive = { id: 'local', fileName: 'restored.spk', date: 2000, type: 'decompress', mode: 'auto', originalSize: 1000, compressedSize: 20, ratio: .02 };
it('interleaves both engines and searches unique IDs and operation types', () => {
  const merged = combineActivity([job('new', 3), job('old', 1)], [archive]);
  expect(filterActivity(merged, '', '', 'newest').map(item => item.id)).toEqual(['new', 'spk:local', 'old']);
  expect(filterActivity(merged, 'spk:local', 'completed', 'newest')).toHaveLength(1);
  expect(filterActivity(merged, 'extract', '', 'newest')[0]).toMatchObject({ inputSize: 20, outputSize: 1000 });
  expect(filterActivity(merged, '', 'failed', 'newest')).toHaveLength(0);
});
it('paginates after merging so browser records displace server records correctly', () => {
  const merged = combineActivity(Array.from({ length: 51 }, (_, index) => job(String(index), index)), [{ ...archive, date: 100000 }]);
  const sorted = filterActivity(merged, '', '', 'newest');
  expect(sorted.slice(0, 50)).toHaveLength(50);
  expect(sorted[0].id).toBe('spk:local');
  expect(sorted.slice(50).map(item => item.id)).toEqual(['1', '0']);
});
it('loads all retained pages instead of silently dropping jobs after the first 100', async () => {
  const records = Array.from({ length: 125 }, (_, index) => job(String(index), index));
  const fetch = vi.fn(async (url: string) => {
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
    return { ok: true, json: async () => ({ jobs: records.slice(offset, offset + 100), total: records.length }) };
  });
  vi.stubGlobal('fetch', fetch);
  expect(await loadJobs()).toHaveLength(125);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps hidden processor outputs out of history while retaining download discovery', async () => {
  const hidden = { ...job('hidden', 1), hidden: true, downloadAvailable: true, download: '/signed-download' };
  expect(combineActivity([hidden], [])).toHaveLength(0);
  expect(combineActivity([hidden], [], {}, true)).toHaveLength(1);
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ jobs: [hidden], total: 1 }) }));
  vi.stubGlobal('fetch', fetch);
  expect(await loadJobs(undefined, true)).toHaveLength(1);
  expect(fetch.mock.calls[0][0]).toContain('includeHiddenDownloads=1');
});
