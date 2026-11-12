import { afterEach, expect, it, vi } from 'vitest';
import { ProjectRecovery, defaultProjectSettings } from '../processing/projects';

afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown) => ({ ok: true, status: 200, json: async () => value });

it('serializes concurrent settings saves against the last committed revision', async () => {
  const revisions: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); revisions.push(body.revision);
    return response({ id: 'default', revision: body.revision + 1, settings: body.settings });
  }));
  const recovery = new ProjectRecovery();
  await Promise.all([recovery.save('default', defaultProjectSettings), recovery.save('default', { ...defaultProjectSettings, conversion: 'png' })]);
  expect(revisions).toEqual([0, 1]);
  expect(recovery.get('default')?.settings.conversion).toBe('png');
});

it('reconciles a lost save response with the same committed settings', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Revision changed' }) })
    .mockResolvedValueOnce(response({ id: 'default', revision: 1, settings: defaultProjectSettings }));
  vi.stubGlobal('fetch', fetch);
  const recovery = new ProjectRecovery();
  expect((await recovery.save('default', defaultProjectSettings)).revision).toBe(1);
  await recovery.save('default', { recursive: false, metadataPolicy: 'strip', qualityMode: 'lossless', conversion: 'wav', target: 'zip' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('continues past expired entries even when the total changes between pages', async () => {
  const source = { id: 'b'.repeat(32), upload: 'c'.repeat(32), name: 'remaining.txt', size: 3, directory: false };
  const fetch = vi.fn().mockResolvedValueOnce(response({ sources: [], total: 101, scanned: 100, unavailable: 100, nextCursor: 'a'.repeat(32) }))
    .mockResolvedValueOnce(response({ sources: [source], total: 1, scanned: 1, unavailable: 0, nextCursor: null }));
  vi.stubGlobal('fetch', fetch);
  const result = await new ProjectRecovery().sources('default');
  expect(result.sources).toEqual([{ ...source, file: null }]);
  expect(result.unavailable).toBe(100);
  expect(fetch.mock.calls[1][0]).toContain('after=' + 'a'.repeat(32));
});

it('stops a broken cursor response instead of issuing an unbounded request loop', async () => {
  const fetch = vi.fn(async () => response({ sources: [], total: 500, scanned: 100, unavailable: 100, nextCursor: 'a'.repeat(32) }));
  vi.stubGlobal('fetch', fetch);
  await expect(new ProjectRecovery().sources('default')).rejects.toThrow('no progress');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('persists grouped choices and compares them independently of key insertion order', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    return response({ id: 'default', revision: body.revision + 1, settings: body.settings });
  });
  vi.stubGlobal('fetch', fetch);
  const recovery = new ProjectRecovery();
  await recovery.save('default', { ...defaultProjectSettings, groupActions: { png: 'convert:png', zip: 'extract:zip' } });
  await recovery.save('default', { ...defaultProjectSettings, groupActions: { zip: 'extract:zip', png: 'convert:png' } });
  expect(fetch).toHaveBeenCalledTimes(1);
  await recovery.save('default', { ...defaultProjectSettings, groupActions: { png: 'convert:jpg' } });
  expect(JSON.parse(fetch.mock.calls[1][1].body as string).revision).toBe(1);
});

it('saves a ZIP profile change on a project created before profile persistence', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    return response({ id: 'default', revision: body.revision + 1, settings: body.settings });
  });
  vi.stubGlobal('fetch', fetch);
  const recovery = new ProjectRecovery();
  await recovery.save('default', defaultProjectSettings);
  await recovery.save('default', { ...defaultProjectSettings, zipProfile: 'maximum' });
  await recovery.save('default', { ...defaultProjectSettings, zipProfile: 'maximum' });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(recovery.get('default')?.settings.zipProfile).toBe('maximum');
});
