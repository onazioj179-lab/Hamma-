import { act } from 'react';
import { zipSync } from 'fflate';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as processingClient from '../processing/client';
import { changeAccount } from '../processing/account';
import { useAppStore } from '../store/app';
import { UniversalWorkspace } from '../components/workspace/UniversalWorkspace';

vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) }); });

let root: Root;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
const caps = { actionRegistry: [{ mime: ['image/png'], extensions: ['png'], conversions: ['png'], extract: false }, { mime: ['audio/wav'], extensions: ['wav'], conversions: ['wav', 'mp3'], extract: false }, { mime: [], extensions: ['zip'], conversions: [], extract: true }], archives: ['zip', 'gzip'], conversions: ['wav', 'png'], processing: 'local', version: 1, limits: { input: 1e9, expanded: 1e9, files: 5000 } };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ sessionOutputs: {}, recentArchives: [], history: [], result: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/capabilities') ? caps : url.endsWith('/settings') ? { fileRetention: '24h', historyRetention: '30d' } : url.endsWith('/deletion-preview') ? { historyRecords: 2, inputFiles: 3, outputFiles: 1, activeJobs: 0, historyToken: 'history-snapshot', filesToken: 'files-snapshot' } : { jobs: [], total: 0 } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = async (screen: 'workspace' | 'history' | 'files' = 'workspace') => { await act(async () => root.render(<UniversalWorkspace visible screen={screen} onHistory={() => {}} />)); };
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
const confirmButton = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role=alertdialog] button')).find(b => b.textContent?.trim() === text)!;
const select = async (files: File[]) => {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Add files to queue"]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
};

it('opens and searches a ZIP directory without uploading the archive', async () => {
  await render();
  const bytes = new Uint8Array(zipSync({ 'first.txt': new Uint8Array([1]), 'second.txt': new Uint8Array([2]) }));
  await select([new File([bytes], 'example.zip')]);
  await act(async () => button('Inspect ZIP').click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.textContent).toContain('2 of 2 entries');
  });
  const search = host.querySelector<HTMLInputElement>('[aria-label="Search ZIP entries"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'SECOND');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.textContent).toContain('1 of 2 entries');
  expect(host.textContent).toContain('second.txt');
  expect(host.textContent).not.toContain('first.txt');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/uploads'))).toBe(false);
});

it('queues a ZIP integrity report only when the processor advertises verification', async () => {
  const initial = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/capabilities')
    ? { ok: true, json: async () => ({ ...caps, zipVerification: true }) } : initial(url));
  const upload = vi.spyOn(processingClient, 'upload').mockResolvedValue('uploaded-zip');
  vi.spyOn(processingClient, 'requestId').mockResolvedValue('verify-request');
  const submit = vi.spyOn(processingClient, 'jsonRequest').mockResolvedValue({});
  await render();
  await select([new File(['zip fixture'], 'archive.zip')]);
  await act(async () => button('Test ZIP integrity').click());
  expect(upload).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith('/jobs', expect.objectContaining({
    operation: 'verify', target: 'json', uploads: ['uploaded-zip'], recursive: false,
  }), 'POST', { signal: expect.any(AbortSignal) });
});

it('uses an explicit read-only directory picker and queues nested and empty folders', async () => {
  vi.stubGlobal('isSecureContext', true);
  const picker = vi.fn(async () => ({ kind: 'directory', name: 'Selected', async *values() {
    yield { kind: 'file', name: 'note.txt', getFile: async () => new File(['hello'], 'note.txt') };
    yield { kind: 'directory', name: 'empty', async *values() {} };
  } }));
  vi.stubGlobal('showDirectoryPicker', picker);
  await render(); await act(async () => button('Add Folder').click());
  expect(picker).toHaveBeenCalledWith({ mode: 'read', id: 'hamma-add-folder' });
  expect(host.textContent).toContain('Selected/note.txt');
  expect(host.textContent).toContain('Selected/empty/');
  expect(host.textContent).toContain('2 selected');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/uploads'))).toBe(false);
});

it('offers normal file selection when the native folder picker cannot select folders', async () => {
  await render();
  const files = host.querySelector<HTMLInputElement>('[aria-label="Add files to queue"]')!;
  const directory = host.querySelector<HTMLInputElement>('[aria-label="Add folder to queue"]')!;
  Object.defineProperty(directory, 'webkitdirectory', { value: true, configurable: true });
  const folderClick = vi.spyOn(directory, 'click');
  const fileClick = vi.spyOn(files, 'click');
  await act(async () => button('Add Folder').click());
  expect(folderClick).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Can’t select the folder?');
  await act(async () => button('Select files instead').click());
  expect(fileClick).toHaveBeenCalledTimes(1);
  await select([new File(['mobile'], 'mobile.txt')]);
  expect(host.textContent).toContain('mobile.txt');
  expect(host.textContent).not.toContain('Can’t select the folder?');
  expect(button('Compress').disabled).toBe(false);
});

it('leaves the selection intact when a folder picker is cancelled', async () => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('showDirectoryPicker', vi.fn(async () => { throw new DOMException('Cancelled', 'AbortError'); }));
  await render(); await select([new File(['keep'], 'keep.txt')]);
  await act(async () => button('Add Folder').click());
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(host.textContent).toContain('keep.txt');
  expect(button('Add Folder').disabled).toBe(false);
});

it('preserves relative paths from directory input and allows the same folder again after removal', async () => {
  await render();
  const directory = host.querySelector<HTMLInputElement>('[aria-label="Add folder to queue"]')!;
  const file = new File(['nested'], 'nested.txt');
  Object.defineProperty(file, 'webkitRelativePath', { value: 'Picked/sub/nested.txt' });
  Object.defineProperty(directory, 'files', { value: [file], configurable: true });
  await act(async () => directory.dispatchEvent(new Event('change', { bubbles: true })));
  expect(host.textContent).toContain('Picked/sub/nested.txt');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove selected files"]')!.click());
  await act(async () => directory.dispatchEvent(new Event('change', { bubbles: true })));
  expect(host.textContent).toContain('Picked/sub/nested.txt');
});

it('clears previous-owner jobs before auth resolves while preserving selected files', async () => {
  const initial = fetchMock.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  let member = false;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/account/login')) return new Promise(resolve => { finish = resolve; });
    if (url.includes('/jobs?')) return { ok: true, json: async () => ({ total: member ? 0 : 1, jobs: member ? [] : [{ id: 'guest-only', name: 'guest-private.zip', state: 'completed', operation: 'compress', target: 'zip', inputSize: 10, outputSize: 5, created: 1, fileExpires: 2, fileCount: 1, format: 'zip', downloadAvailable: false }] }) };
    return initial(url);
  });
  await render('history');
  expect(host.textContent).toContain('guest-private.zip');
  await render(); await select([new File(['keep'], 'keep-selected.txt')]);
  vi.spyOn(processingClient, 'upload').mockImplementation(async source => { source.upload = 'guest-upload'; throw new Error('Upload interrupted'); });
  await act(async () => button('Compress').click());
  let transition!: Promise<unknown>;
  await act(async () => { transition = changeAccount('login', { username: 'alice', password: 'valid-password' }); });
  await render('history'); expect(host.textContent).not.toContain('guest-private.zip');
  member = true;
  await act(async () => { finish({ ok: true, json: async () => ({}) }); await transition; });
  await render();
  expect(host.textContent).toContain('keep-selected.txt');
  expect(host.textContent).toContain('1 selected');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove selected files"]')!.click());
  expect(document.querySelector('[role=alertdialog]')).toBeNull();
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/uploads/guest-upload') && init?.method === 'DELETE')).toBe(false);
});

it('blocks account changes during foreground SPK processing', async () => {
  await act(async () => root.render(<UniversalWorkspace visible screen="workspace" spkBusy onHistory={() => {}} />));
  await expect(changeAccount('logout', {})).rejects.toThrow('Finish the current upload');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/account/'))).toBe(false);
});

it('adds files without processing them until a direct action and virtualizes large selections', async () => {
  await render();
  await select(Array.from({ length: 1000 }, (_, i) => new File(['test'], `file-${i}.txt`)));
  expect(host.textContent).toContain('1,000 selected');
  expect(host.querySelectorAll('.source-row').length).toBeLessThan(20);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/uploads'))).toBe(false);
  expect(button('Compress').disabled).toBe(false);
  expect(button('Extract')).toBeUndefined();
});

it('keeps duplicate names using distinct archive paths', async () => {
  await render(); await select([new File(['one'], 'Same.txt'), new File(['two'], 'same.txt')]);
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(host.textContent).toContain('2 selected');
  expect(host.textContent).toContain('duplicate-2/same.txt');
});

it('renders a new selection after removing a scrolled 5000-file batch', async () => {
  await render();
  await select(Array.from({ length: 5000 }, (_, i) => new File(['x'], `stress-${i}.txt`)));
  const scroller = host.querySelector<HTMLDivElement>('.source-scroll')!;
  scroller.scrollTop = 250000;
  await act(async () => scroller.dispatchEvent(new Event('scroll', { bubbles: true })));
  expect(host.querySelectorAll('.source-row').length).toBeLessThanOrEqual(14);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove selected files"]')!.click());
  expect(document.querySelector('[role=alertdialog]')).toBeNull();
  await select([new File(['new'], 'visible-after-stress.txt')]);
  expect(host.querySelector('.source-row')?.textContent).toContain('visible-after-stress.txt');
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
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('2 processor history records');
  await act(async () => confirmButton('Clear history').click());
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/history') && init.method === 'DELETE')).toBe(true);
  await act(async () => button('Delete all files').click());
  expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('3 uploaded items');
  await act(async () => confirmButton('Delete files').click());
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

it('reports a disconnect after bulk retry without an unhandled rejection', async () => {
  let disconnected = false;
  fetchMock.mockImplementation(async (url: string) => {
    if (disconnected && url.includes('/jobs?')) throw new Error('Connection lost after retry');
    return { ok: true, json: async () => url.endsWith('/capabilities') ? caps : url.endsWith('/settings') ? { fileRetention: '24h', historyRetention: '30d' } : { jobs: [{ id: 'retry-job', name: 'retry.zip', state: 'failed', operation: 'compress', inputSize: 100, outputSize: null, created: 1, fileExpires: 2, fileCount: 1, format: 'zip', downloadAvailable: false }], total: 1 } };
  });
  await render();
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Select all visible jobs"]')!.click());
  disconnected = true;
  await act(async () => button('Retry').click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Connection lost after retry');
  expect(host.textContent).toContain('Local processor unavailable');
});

it('bounds rendered history rows while paging and searching 500 retained jobs', async () => {
  const jobs = Array.from({ length: 500 }, (_, index) => ({
    id: `stress-${index}`, name: `history-stress-${index}.zip`, state: 'completed',
    operation: 'compress', target: 'zip', inputSize: 100, outputSize: 50,
    created: index, fileExpires: 2, fileCount: 1, format: 'zip', downloadAvailable: false,
  }));
  fetchMock.mockImplementation(async (url: string) => {
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset') || 0);
    return { ok: true, json: async () => url.endsWith('/capabilities') ? caps : url.endsWith('/settings') ? { fileRetention: '24h', historyRetention: '30d' } : { jobs: jobs.slice(offset, offset + 100), total: jobs.length } };
  });
  await render('history');
  expect(host.querySelectorAll('.processing-job')).toHaveLength(50);
  for (let page = 0; page < 9; page++) {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next history page"]')!.click());
    expect(host.querySelectorAll('.processing-job')).toHaveLength(50);
  }
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Next history page"]')!.disabled).toBe(true);
  const search = host.querySelector<HTMLInputElement>('[aria-label="Search processing history"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'history-stress-499.zip');
  await act(async () => search.dispatchEvent(new Event('input', { bubbles: true })));
  expect(host.querySelectorAll('.processing-job')).toHaveLength(1);
  expect(host.querySelector('.processing-job')?.textContent).toContain('history-stress-499.zip');
});

it('deletes only the selected operations captured by a confirmed bulk action', async () => {
  const records = ['one', 'two', 'later'].map(id => ({ id, name: id + '.zip', state: 'completed', operation: 'compress', target: 'zip', inputSize: 100, outputSize: 50, created: 1, finished: 2, fileExpires: 3, fileCount: 1, format: 'zip', downloadAvailable: true }));
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/capabilities') ? caps : url.endsWith('/settings') ? { fileRetention: '24h', historyRetention: '30d' } : { jobs: records, total: records.length } }));
  await render('history');
  for (const name of ['one.zip', 'two.zip']) await act(async () => host.querySelector<HTMLInputElement>(`[aria-label="Select job ${name}"]`)!.click());
  await act(async () => button('Delete files').click());
  expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('2 selected operations');
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  // Simulate a later state change; confirmation must retain its reviewed IDs.
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Select job later.zip"]')!.click());
  await act(async () => confirmButton('Delete files').click());
  const deleted = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url).sort();
  expect(deleted).toEqual(['/api/process/jobs/one/files', '/api/process/jobs/two/files']);
});

it('uses deletion preview tokens and leaves browser files intact when the server selection changes', async () => {
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const entry = { id: 'local', fileName: 'local.txt', originalSize: 10, compressedSize: 5, ratio: .5, date: 1000, type: 'compress' as const, mode: 'auto' as const };
  useAppStore.setState({ recentArchives: [entry], sessionOutputs: { local: { archive: entry, outputName: 'local.spk', downloadUrl: 'blob:local', savedToDevice: false } } });
  const initial = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/files') && init?.method === 'DELETE') return { ok: false, status: 409, json: async () => ({ error: 'Selection changed. Review again.' }) };
    return initial(url, init);
  });
  await render('history');
  await act(async () => button('Delete all files').click());
  expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('1 temporary browser download');
  await act(async () => confirmButton('Cancel').click());
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  await act(async () => button('Delete all files').click());
  await act(async () => confirmButton('Delete files').click());
  const deletion = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/files') && init?.method === 'DELETE')!;
  expect(deletion[1].headers['X-Hamma-Deletion-Token']).toBe('files-snapshot');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Selection changed');
  expect(useAppStore.getState().sessionOutputs.local.downloadUrl).toBe('blob:local');
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it('fails closed if an accurate server deletion preview is unavailable', async () => {
  const initial = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/deletion-preview')) throw new Error('Preview unavailable');
    return initial(url);
  });
  await render('history');
  await act(async () => button('Delete all files').click());
  expect(document.querySelector('[role=alertdialog]')).toBeNull();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Preview unavailable');
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});

it('requires explicit lossy consent and sends quality and metadata choices with the job identity', async () => {
  const initial = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/capabilities') ? { ok: true, json: async () => ({ ...caps, conversions: ['wav', 'png', 'mp3'] }) } : initial(url));
  const upload = vi.spyOn(processingClient, 'upload').mockResolvedValue('uploaded');
  const key = vi.spyOn(processingClient, 'requestId').mockResolvedValue('quality-request');
  const submit = vi.spyOn(processingClient, 'jsonRequest').mockResolvedValue({ id: 'quality-job' });
  await render(); await select([new File(['fixture'], 'music.wav')]);
  const chooseOption = async (name: string, optionText: string) => {
    await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(item => item.textContent === optionText)!;
    await act(async () => option.click());
  };
  await chooseOption('Conversion format', 'mp3');
  await act(async () => button('Convert').click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Choose Allow quality loss');
  expect(upload).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  await chooseOption('Conversion quality', 'Allow quality loss');
  await chooseOption('Conversion metadata', 'Preserve supported tags');
  await act(async () => button('Convert').click());
  expect(submit).toHaveBeenCalledWith('/jobs', expect.objectContaining({ operation: 'convert', target: 'mp3', qualityMode: 'lossy', metadataPolicy: 'preserve', requestId: 'quality-request' }), 'POST', { signal: expect.any(AbortSignal) });
  expect(key).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ qualityMode: 'lossy', metadataPolicy: 'preserve' })]));
});

it('cancels a deletion preview when the user leaves the processing page', async () => {
  const initial = fetchMock.getMockImplementation()!;
  let aborted = false;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/deletion-preview')) return new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    return initial(url, init);
  });
  await render('history');
  await act(async () => button('Delete all files').click());
  await act(async () => root.render(<UniversalWorkspace visible={false} screen="history" onHistory={() => {}} />));
  expect(aborted).toBe(true);
  expect(document.querySelector('[role=alertdialog]')).toBeNull();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});

it('confirms removal of an uploaded selection and preserves it when cancellation is chosen', async () => {
  vi.spyOn(processingClient, 'upload').mockImplementation(async source => { source.upload = 'partial-upload'; throw new Error('Upload interrupted'); });
  await render(); await select([new File(['original'], 'resume.txt')]);
  await act(async () => button('Compress').click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove selected files"]')!.click());
  expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('1 uploaded item');
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  await act(async () => confirmButton('Cancel').click());
  expect(host.querySelector('.source-row')?.textContent).toContain('resume.txt');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove selected files"]')!.click());
  const confirm = confirmButton('Remove selected');
  await act(async () => { confirm.click(); confirm.click(); });
  expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/uploads/partial-upload') && init?.method === 'DELETE')).toHaveLength(1);
  expect(host.querySelector('.source-row')).toBeNull();
});

it('does not show a fabricated completion date for a retried job with a null finish time', async () => {
  const initial = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string) => url.includes('/jobs?') ? { ok: true, json: async () => ({ total: 1, jobs: [{ id: 'retry-date', name: 'retry.txt', state: 'queued', operation: 'compress', target: 'zip', inputSize: 5, outputSize: null, created: 100, finished: null, fileExpires: 200, fileCount: 1, format: 'file', downloadAvailable: false }] }) } : initial(url));
  await render('history');
  const finished = [...host.querySelectorAll('dt')].find(term => term.textContent === 'Finished')!;
  expect(finished.nextElementSibling?.textContent).toBe('—');
});

it('keeps a hidden processor output discoverable through Available downloads after history is cleared', async () => {
  let hidden = false;
  const record = { id: 'retained-output', name: 'retained.txt', outputName: 'retained.zip', operation: 'compress', target: 'zip', state: 'completed', inputSize: 100, outputSize: 50, created: 1, finished: 2, fileExpires: 10000, fileCount: 1, format: 'zip', downloadAvailable: true, download: '/retained-download' };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/history') && init?.method === 'DELETE') { hidden = true; return { ok: true, json: async () => ({ deleted: true }) }; }
    const body = url.endsWith('/capabilities') ? caps : url.endsWith('/settings') ? { fileRetention: '24h', historyRetention: '30d' } : url.endsWith('/deletion-preview') ? { historyRecords: 1, inputFiles: 1, outputFiles: 1, activeJobs: 0, historyToken: 'history-snapshot', filesToken: 'files-snapshot' } : { jobs: hidden && !url.includes('includeHiddenDownloads=1') ? [] : [{ ...record, hidden }], total: hidden && !url.includes('includeHiddenDownloads=1') ? 0 : 1 };
    return { ok: true, json: async () => body };
  });
  const counts: number[] = [];
  const count = (event: Event) => counts.push((event as CustomEvent<number>).detail);
  window.addEventListener('hamma-job-count', count);
  try {
    await render('history');
    expect(host.querySelectorAll('.processing-job')).toHaveLength(1);
    await act(async () => button('Clear history').click());
    await act(async () => confirmButton('Clear history').click());
    expect(host.querySelectorAll('.processing-job')).toHaveLength(0);
    expect(counts[counts.length - 1]).toBe(0);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Filter by operation"]')!.click());
    const available = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(option => option.textContent === 'Available downloads')!;
    await act(async () => available.click());
    expect(host.querySelectorAll('.processing-job')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Download retained.zip"]')).not.toBeNull();
  } finally { window.removeEventListener('hamma-job-count', count); }
});


it('continues a 300-file batch after 14 file-specific queue rejections and retains retry details', async () => {
  await render();
  const initial = fetchMock.getMockImplementation()!;
  let count = 0;
  vi.spyOn(processingClient, 'upload').mockImplementation(async source => 'upload-' + source.id);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/jobs') && init?.method === 'POST') {
      count++;
      if (count <= 14) return { ok: false, status: 415, json: async () => ({ error: 'Unsupported test image' }) };
      return { ok: true, json: async () => ({ id: String(count) }) };
    }
    return initial(url, init);
  });
  await select(Array.from({ length: 300 }, (_, i) => new File(['fixture'], `image-${i}.png`, { type: 'image/png' })));
  expect(button('Extract')).toBeUndefined();
  expect(host.textContent).not.toContain('WAV');
  await act(async () => button('Convert').click());
  expect(count).toBe(300);
  expect(host.textContent).toContain('14 selected');
  expect(host.textContent).toContain('14 files could not be queued');
  expect(host.textContent).toContain('Unsupported test image');
  await act(async () => button('Convert').click());
  expect(count).toBe(314);
  expect(host.querySelector('[aria-label="Selected files"]')).toBeNull();
});


it('pauses on queue capacity errors and retains only unsubmitted files', async () => {
  await render();
  const initial = fetchMock.getMockImplementation()!;
  let count = 0;
  vi.spyOn(processingClient, 'upload').mockImplementation(async source => 'upload-' + source.id);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/jobs') && init?.method === 'POST') {
      if (++count === 2) return { ok: false, status: 429, json: async () => ({ error: 'Queue limit reached' }) };
      return { ok: true, json: async () => ({ id: String(count) }) };
    }
    return initial(url, init);
  });
  await select([0, 1, 2].map(i => new File(['fixture'], `photo-${i}.png`, { type: 'image/png' })));
  await act(async () => button('Convert').click());
  expect(count).toBe(2);
  expect(host.textContent).toContain('2 selected');
  expect(host.textContent).toContain('Queue limit reached');
});


it('keeps selections and archive settings independent across projects', async () => {
  await render(); await select([new File(['one'], 'first.txt')]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Archive format"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(option => option.textContent === 'gzip')!.click());
  await act(async () => button('New project').click());
  expect(host.querySelector('[aria-label="Archive format"]')?.textContent).toContain('zip');
  expect(host.textContent).not.toContain('first.txt');
  await select([new File(['two'], 'second.txt')]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Current project"]')!.click());
  await act(async () => document.querySelector<HTMLElement>('[role=option]')!.click());
  expect(host.textContent).toContain('first.txt');
  expect(host.textContent).not.toContain('second.txt');
  expect(host.querySelector('[aria-label="Archive format"]')?.textContent).toContain('gzip');
});


it('recovers projects from durable jobs and retries only the active project failures', async () => {
  const initial = fetchMock.getMockImplementation()!;
  const row = { operation: 'convert', target: 'png', inputSize: 4, outputSize: 4, created: 1, fileExpires: 9999999999, fileCount: 1, format: 'png', downloadAvailable: false };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/jobs?')) return { ok: true, json: async () => ({ total: 2, jobs: [
      { ...row, id: 'good', name: 'good.png', state: 'completed', projectId: 'default' },
      { ...row, id: 'bad', name: 'bad.png', state: 'failed', projectId: 'images' },
    ] }) };
    return initial(url, init);
  });
  await render();
  expect(host.textContent).toContain('good.png');
  expect(host.textContent).not.toContain('bad.png');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Current project"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(option => option.textContent === 'Project 2')!.click());
  expect(host.textContent).toContain('bad.png');
  expect(host.textContent).not.toContain('good.png');
  await act(async () => button('Retry failed').click());
  expect(fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).endsWith('/retry')).map(([url]) => url)).toEqual(['/api/process/jobs/bad/retry']);
});
