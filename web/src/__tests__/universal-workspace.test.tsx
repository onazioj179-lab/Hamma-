import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as processingClient from '../processing/client';
import { UniversalWorkspace } from '../components/workspace/UniversalWorkspace';

let root: Root;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
const caps = { archives: ['zip', 'gzip'], conversions: ['wav', 'png'], processing: 'local', version: 1, limits: { input: 1e9, expanded: 1e9, files: 5000 } };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/capabilities') ? caps : url.endsWith('/settings') ? { fileRetention: '24h', historyRetention: '30d' } : { jobs: [], total: 0 } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = async (screen: 'workspace' | 'history' | 'files' = 'workspace') => { await act(async () => root.render(<UniversalWorkspace visible screen={screen} onHistory={() => {}} />)); };
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
const select = async (files: File[]) => {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Add files to queue"]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
};

it('adds files without processing them until a direct action and virtualizes large selections', async () => {
  await render();
  await select(Array.from({ length: 1000 }, (_, i) => new File(['test'], `file-${i}.txt`)));
  expect(host.textContent).toContain('1,000 selected');
  expect(host.querySelectorAll('.source-row').length).toBeLessThan(20);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/uploads'))).toBe(false);
  expect(button('Compress').disabled).toBe(false);
  expect(button('Extract').disabled).toBe(false);
});

it('rejects duplicate names as a complete selection', async () => {
  await render(); await select([new File(['one'], 'Same.txt'), new File(['two'], 'same.txt')]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Duplicate filename');
  expect(host.querySelector('.source-row')).toBeNull();
});

it('shows unavailable processing without fabricating progress or downloads', async () => {
  fetchMock.mockRejectedValue(new Error('Offline'));
  await render(); await select([new File(['data'], 'data.txt')]);
  expect(host.textContent).toContain('Local processor unavailable');
  expect(button('Compress').disabled).toBe(true);
  expect(host.querySelector('progress')).toBeNull();
  expect(host.querySelector('a[download]')).toBeNull();
});

it('keeps file deletion distinct from history deletion and exposes retention choices', async () => {
  await render('history');
  await act(async () => host.querySelector<HTMLButtonElement>('[role=combobox][aria-label="History retention"]')!.click());
  expect(document.querySelectorAll('[role=listbox] [role=option]')).toHaveLength(4);
  await act(async () => host.querySelector<HTMLButtonElement>('[role=combobox][aria-label="History retention"]')!.click());
  await act(async () => button('Clear history').click());
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/history') && init.method === 'DELETE')).toBe(true);
  await act(async () => button('Delete all files').click());
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/files') && init.method === 'DELETE')).toBe(true);
});

it('shows newly submitted jobs instead of retaining a Completed-only queue filter', async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('[role=combobox][aria-label="Filter processing history"]')!.click());
  const completed=Array.from(document.querySelectorAll<HTMLElement>('[role=option]')).find(option=>option.textContent==='Completed')!;
  await act(async () => completed.click());
  expect(host.querySelector('[aria-label="Filter processing history"]')?.textContent).toBe('Completed');
  vi.spyOn(processingClient,'upload').mockResolvedValue('fixture-upload');
  vi.spyOn(processingClient,'requestId').mockResolvedValue('fixture-request');
  vi.spyOn(processingClient,'jsonRequest').mockResolvedValue({ id:'fixture-job' });
  await select([new File(['test'],'queue-check.txt')]);
  await act(async () => button('Compress').click());
  expect(host.querySelector('[aria-label="Filter processing history"]')?.textContent).toBe('All statuses');
  expect(host.querySelector('[aria-label="Sort processing history"]')?.textContent).toBe('Newest first');
});
