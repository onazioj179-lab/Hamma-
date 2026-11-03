import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as processingClient from '../processing/client';
import { useAppStore } from '../store/app';
import { UniversalWorkspace } from '../components/workspace/UniversalWorkspace';

vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) }); });

let root: Root;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
const caps = { archives: ['zip', 'gzip'], conversions: ['wav', 'png'], processing: 'local', version: 1, limits: { input: 1e9, expanded: 1e9, files: 5000 } };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ sessionOutputs: {}, recentArchives: [], result: null });
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

it('announces newly completed jobs once after reconnecting', async () => {
  let state = 'processing';
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/capabilities') ? caps : url.endsWith('/settings') ? { fileRetention: '24h', historyRetention: '30d' } : { jobs: [{ id: 'job-one', name: 'example.zip', state, operation: 'compress', inputSize: 100, outputSize: null, processed: 20, created: 1, fileExpires: 2, historyExpires: 3, fileCount: 1, format: 'zip', entries: 1, downloadAvailable: false }], total: 1 } }));
  const notice = vi.fn(); window.addEventListener('hamma-job-notice', notice);
  try {
    await render(); expect(notice).not.toHaveBeenCalled();
    state = 'completed';
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(notice).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(notice).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener('hamma-job-notice', notice); }
});

it('uses the shared file picker for SPK and keeps the current result on its original history row', async () => {
  const { useAppStore } = await import('../store/app');
  const entry = { id: 'record-one', fileName: 'note.txt', date: 1000, type: 'compress' as const, mode: 'auto' as const, originalSize: 4, compressedSize: 2, ratio: .5 };
  useAppStore.setState({ recentArchives: [entry] });
  const onSpkDownload = vi.fn();
  const onSpkSelect = vi.fn(async () => true);
  try {
    await act(async () => root.render(<UniversalWorkspace visible screen="workspace" onHistory={() => {}} spkReady onSpkSelect={onSpkSelect} spkResult={{ outputName: 'note.txt.spk', downloadUrl: 'blob:result', historyId: 'record-one' }} onSpkDownload={onSpkDownload} />));
    expect(host.querySelectorAll('.processing-job')).toHaveLength(1);
    expect(host.querySelector('.operation-tag')?.textContent).toBe('SPK / compress');
    const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Download note.txt.spk"]')!;
    expect(link.getAttribute('href')).toBe('blob:result');
    expect(link.download).toBe('note.txt.spk');
    await select([new File(['spk'], 'restore.spk')]);
    await act(async () => button('Extract').click());
    expect(onSpkSelect).toHaveBeenCalledWith([expect.objectContaining({ name: 'restore.spk' })], true);
    expect(host.querySelector('.source-row')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/uploads'))).toBe(false);
  } finally { await act(async () => useAppStore.setState({ recentArchives: [] })); }
});

it('restores a batch to independently downloadable outputs and keeps hidden files accessible', async () => {
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const restore = vi.fn(async (files: File[]) => {
    const name = files[0].name.replace('.spk', '');
    useAppStore.getState().setResult({ originalSize: 4, resultSize: 8, ratio: 2, duration: 1, speedMbps: 1, outputName: name, downloadUrl: 'blob:' + name });
    useAppStore.getState().addRecentArchive({ fileName: files[0].name, originalSize: 8, compressedSize: 4, ratio: .5, type: 'decompress', mode: 'auto' });
    return true;
  });
  await act(async () => root.render(<UniversalWorkspace visible screen="workspace" onHistory={() => {}} spkReady onSpkSelect={restore} />));
  await select([new File(['one'], 'first.txt.spk'), new File(['two'], 'second.txt.spk')]);
  await act(async () => button('Extract').click());
  expect(restore).toHaveBeenCalledTimes(2);
  expect(host.querySelectorAll('a[download]')).toHaveLength(2);
  await act(async () => useAppStore.getState().clearRecentArchives());
  expect(host.querySelectorAll('.processing-job')).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Filter by operation"]')!.click());
  const downloads = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(option => option.textContent === 'Available downloads')!;
  await act(async () => downloads.click());
  expect(host.querySelectorAll('a[download]')).toHaveLength(2);
  const first = Object.keys(useAppStore.getState().sessionOutputs)[0];
  await act(async () => useAppStore.getState().deleteSessionOutput(first));
  expect(host.querySelectorAll('a[download]')).toHaveLength(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first.txt');
});
it('reconnects and refreshes the list after an initial job-list failure', async () => {
  let unavailable = true;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/jobs?') && unavailable) throw new Error('Connection lost');
    return { ok: true, json: async () => url.endsWith('/capabilities') ? caps : url.endsWith('/settings') ? { fileRetention: '24h', historyRetention: '30d' } : { jobs: [{ id: 'recovered', name: 'recovered.zip', operation: 'compress', target: 'zip', state: 'completed', inputSize: 10, outputSize: 5, created: 1, fileExpires: 2, historyExpires: null, format: 'zip', fileCount: 1, entries: 1, downloadAvailable: false }], total: 1 } };
  });
  await render();
  expect(host.textContent).toContain('Local processor unavailable');
  unavailable = false;
  await act(async () => button('Reconnect').click());
  expect(host.textContent).toContain('recovered.zip');
  expect(host.textContent).not.toContain('Local processor unavailable');
});
