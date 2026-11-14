import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UniversalWorkspace } from '../components/workspace/UniversalWorkspace';
import { useAppStore } from '../store/app';
import { defaultProjectSettings, type SavedProject } from '../processing/projects';

vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) }); });
let host: HTMLDivElement, root: Root;
let saved: SavedProject | undefined;
let checkpoint: { id: string; upload: string; name: string; size: number; directory: boolean } | undefined;
let selections: { id: string; name: string; size: number; directory: boolean }[];
let offset: number, chunkWrites: number, jobAttempts: number;
let rejectJob: boolean;
const uploadId = 'c'.repeat(32);
const caps = { outputReuse: false, groupedWorkflows: true, projectRecovery: true, projectSelections: false, recoverableUploads: false, draftScope: '', archives: ['zip'], conversions: [], version: 1, processing: 'local', limits: { files: 5000, input: 1e9, expanded: 1e9, seconds: 30 } };
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ sessionOutputs: {}, recentArchives: [], history: [], result: null });
  saved = undefined; checkpoint = undefined; offset = 0; chunkWrites = 0; jobAttempts = 0; rejectJob = true;
  caps.recoverableUploads = false;
  caps.outputReuse = false;
  caps.projectSelections = false; selections = [];
  caps.draftScope = '';
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    if (url.endsWith('/capabilities')) return ok(caps);
    if (url.endsWith('/settings')) return ok({ fileRetention: '24h', historyRetention: '30d' });
    if (url.endsWith('/projects')) return ok({ projects: saved ? [saved] : [] });
    if (url.endsWith('/projects/default') && init?.method === 'PUT') {
      saved = { id: 'default', revision: (saved?.revision || 0) + 1, created: 1, updated: 1, settings: body.settings };
      return ok(saved);
    }
    if (url.endsWith('/projects/default/inputs') && init?.method === 'PUT') {
      selections = body.selections;
      return ok({ saved: true });
    }
    if (url.includes('/projects/default/inputs?')) {
      const sources = selections.map(source => ({ ...source, pending: true }));
      return ok({ sources: checkpoint ? [...sources, { ...checkpoint, uploaded: offset, inspection: { format: 'file', conversions: [], extract: false } }] : sources,
        total: sources.length + Number(!!checkpoint), scanned: sources.length + Number(!!checkpoint), unavailable: 0, nextCursor: null });
    }
    if (/\/projects\/default\/inputs\/[a-f0-9]{32}$/.test(url) && init?.method === 'PUT') {
      expect(caps.recoverableUploads).toBe(false);
      checkpoint = { id: url.split('/').pop()!, upload: body.upload, name: 'resume.txt', size: 3, directory: false };
      return ok({ saved: true });
    }
    if (url.endsWith('/uploads') && init?.method === 'POST') {
      if (caps.recoverableUploads) {
        expect(body.projectId).toBe('default');
        expect(body.sourceId).toMatch(/^[a-f0-9]{32}$/);
        selections = selections.filter(source => source.id !== body.sourceId);
        checkpoint = { id: body.sourceId, upload: uploadId, name: body.name, size: body.size, directory: body.directory };
      }
      return ok({ id: uploadId });
    }
    if (url.endsWith('/uploads/' + uploadId)) {
      if (init?.method === 'PUT') { chunkWrites++; offset += (init.body as Blob).size; }
      return ok({ offset });
    }
    if (url.endsWith('/reuse') && init?.method === 'POST') {
      expect(body).toEqual({ name: 'output.zip', projectId: 'default' });
      return ok({ id: uploadId, upload: uploadId, name: body.name, size: 3, uploaded: 3, directory: false,
        inspection: { format: 'zip', conversions: [], extract: true } });
    }
    if (url.endsWith('/jobs') && init?.method === 'POST') {
      jobAttempts++;
      expect(body.recoverable).toBe(true);
      expect(body.uploads).toEqual([uploadId]);
      if (rejectJob) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: 'Queue full' }) };
      checkpoint = undefined;
      return ok({ id: 'd'.repeat(32) });
    }
    if (url.includes('/jobs?')) return caps.outputReuse ? ok({ total: 1, jobs: [{
      id: 'a'.repeat(32), name: 'input.txt', outputName: 'output.zip', downloadAvailable: true,
      download: '/api/process/output.zip', operation: 'compress', target: 'zip', state: 'completed',
      format: 'file', fileCount: 1, created: 1, inputSize: 3, outputSize: 3,
    }] }) : ok({ jobs: [], total: 0 });
    throw new Error('Unexpected request: ' + url);
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = async () => { await act(async () => root.render(<UniversalWorkspace visible screen="workspace" onHistory={() => {}} />)); };
const compress = () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Compress')!;

it('selects a retained output for another operation without uploading it', async () => {
  caps.outputReuse = true;
  const onWorkspace = vi.fn();
  const show = (screen: 'history' | 'workspace') => root.render(<UniversalWorkspace visible screen={screen} onHistory={() => {}} onWorkspace={onWorkspace} />);
  await act(async () => show('history'));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Use output.zip in workspace"]')!.click());
  expect(onWorkspace).toHaveBeenCalledOnce();
  await act(async () => show('workspace'));
  expect(host.querySelector<HTMLInputElement>('[aria-label="Select output.zip"]')?.checked).toBe(true);
  expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Extract')).toBe(true);
  expect(chunkWrites).toBe(0);
});

it.each([false, true])('restores a completed upload without sending its bytes again (recoverableUploads=%s)', async recoverableUploads => {
  caps.recoverableUploads = recoverableUploads;
  await render();
  const input = host.querySelector<HTMLInputElement>('[aria-label="Add files to queue"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['abc'], 'resume.txt')], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => compress().click());
  expect(host.textContent).toContain('Queue full');
  expect(chunkWrites).toBe(1);
  expect(checkpoint).toBeDefined();
  await act(async () => root.unmount()); root = createRoot(host);
  await render();
  expect(host.textContent).toContain('Recovered 1 uploaded file');
  expect(host.textContent).toContain('resume.txt');
  rejectJob = false;
  await act(async () => compress().click());
  expect(jobAttempts).toBe(2);
  expect(chunkWrites).toBe(1);
  expect(checkpoint).toBeUndefined();
  expect(host.querySelector('[aria-label="Selected files"]')).toBeNull();
});

it('clears recovered server inputs when the account changes', async () => {
  saved = { id: 'default', revision: 1, created: 1, updated: 1, settings: defaultProjectSettings };
  checkpoint = { id: 'a'.repeat(32), upload: uploadId, name: 'private-old-owner.txt', size: 3, directory: false };
  offset = 3;
  await render();
  expect(host.textContent).toContain('private-old-owner.txt');
  await act(async () => {
    window.dispatchEvent(new Event('hamma-owner-clearing'));
    saved = undefined; checkpoint = undefined;
    window.dispatchEvent(new Event('hamma-owner-changed'));
  });
  expect(host.textContent).not.toContain('private-old-owner.txt');
  expect(host.querySelector('[aria-label="Selected files"]')).toBeNull();
});

it.each([false, true])('verifies saved bytes before resuming (SubtleCrypto=%s)', async localHash => {
  saved = { id: 'default', revision: 1, created: 1, updated: 1, settings: defaultProjectSettings };
  checkpoint = { id: 'a'.repeat(32), upload: uploadId, name: 'resume.txt', size: 3, directory: false };
  caps.recoverableUploads = true;
  offset = 1; rejectJob = false;
  if (!localHash) vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const initial = vi.mocked(fetch).getMockImplementation()!;
  let matches = false;
  let writer = '';
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).includes('/prefix?')) {
      expect(String(url)).toContain('start=0&length=1');
      expect(init?.method ?? 'GET').toBe(localHash ? 'GET' : 'POST');
      if (!localHash) return ok({ matches }) as Response;
      return ok({ sha256: matches ? 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb' : 'different' }) as Response;
    }
    if (String(url).endsWith('/resume')) {
      const body = JSON.parse(String(init?.body));
      expect(body.offset).toBe(1);
      writer = body.writer;
      return ok({ offset }) as Response;
    }
    if (String(url).endsWith('/uploads/' + uploadId) && init?.method === 'PUT') {
      expect(new Headers(init.headers).get('Upload-Writer')).toBe(writer);
      expect(new Headers(init.headers).get('Upload-Offset')).toBe('1');
      expect((init.body as Blob).size).toBe(2);
    }
    return initial(url, init);
  });
  await render();
  expect(host.textContent).toContain('continue 1 upload');
  await act(async () => compress().click());
  expect(jobAttempts).toBe(0);
  const picker = host.querySelector<HTMLInputElement>('[aria-label="Select original file for resume.txt"]')!;
  const file = new File(['abc'], 'resume.txt');
  const slice = file.slice.bind(file);
  if (localHash) vi.spyOn(file, 'slice').mockImplementation((start, end) => {
    const chunk = slice(start, end);
    return Object.assign(chunk, { arrayBuffer: async () => new Uint8Array([97]).buffer });
  });
  Object.defineProperty(picker, 'files', { value: [file], configurable: true });
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => compress().click());
  expect(host.textContent).toContain('differs from the saved upload');
  expect(chunkWrites).toBe(0);
  matches = true;
  await act(async () => compress().click());
  expect(writer).toMatch(/^[a-f0-9]{32}$/);
  expect(jobAttempts).toBe(1);
  expect(chunkWrites).toBe(1);
});

it('reconnects saved files in bulk without adding duplicate sources', async () => {
  caps.draftScope = 'test-owner';
  await render();
  const original = new File(['abc'], 'resume.txt');
  const input = host.querySelector<HTMLInputElement>('[aria-label="Add files to queue"]')!;
  Object.defineProperty(input, 'files', { value: [original] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => root.unmount()); root = createRoot(host);
  await render();
  const picker = host.querySelector<HTMLInputElement>('[aria-label="Reconnect original files"]')!;
  const choose = async (files: File[]) => {
    Object.defineProperty(picker, 'files', { value: files, configurable: true });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
  };
  await choose([original, new File(['xyz'], 'resume.txt')]);
  expect(host.textContent).toContain('No original files matched');
  expect(compress().disabled).toBe(true);
  await choose([original, new File(['def'], 'unrelated.txt')]);
  expect(host.querySelectorAll('[aria-label="Select resume.txt"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Select unrelated.txt"]')).toBeNull();
  rejectJob = false;
  await act(async () => compress().click());
  expect(chunkWrites).toBe(1);
  expect(jobAttempts).toBe(1);
});

it('restores an unstarted selection and requires the original before uploading', async () => {
  caps.draftScope = 'test-owner';
  await render();
  const input = host.querySelector<HTMLInputElement>('[aria-label="Add files to queue"]')!;
  const file = new File(['abc'], 'resume.txt');
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  const picker = host.querySelector<HTMLInputElement>('[aria-label="Select original file for resume.txt"]')!;
  expect(picker).toBeTruthy();
  await act(async () => compress().click());
  expect(chunkWrites).toBe(0);
  Object.defineProperty(picker, 'files', { value: [file] });
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
  rejectJob = false;
  await act(async () => compress().click());
  expect(chunkWrites).toBe(1);
  expect(jobAttempts).toBe(1);
  expect(localStorage.getItem('hamma-selection:test-owner:default')).toBeNull();
});

it('preserves a deselected browser draft when the processor also restores it', async () => {
  caps.draftScope = 'test-owner';
  caps.projectSelections = true;
  saved = { id: 'default', revision: 1, created: 1, updated: 1, settings: defaultProjectSettings };
  const draft = { id: 'b'.repeat(32), name: 'draft.txt', size: 3, directory: false };
  selections = [draft];
  localStorage.setItem('hamma-selection:test-owner:default', JSON.stringify({
    expires: Date.now() + 60_000, sources: [draft], selected: [],
  }));

  await render();

  const restored = host.querySelector<HTMLInputElement>('[aria-label="Select draft.txt"]');
  expect(restored).not.toBeNull();
  expect(restored?.checked).toBe(false);
});

it('lets the user remove a recovered entry whose upload has already expired', async () => {
  saved = { id: 'default', revision: 1, created: 1, updated: 1, settings: defaultProjectSettings };
  checkpoint = { id: 'a'.repeat(32), upload: uploadId, name: 'expired.txt', size: 3, directory: false };
  offset = 3;
  const initial = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/uploads/' + uploadId) && init?.method === 'DELETE'
    ? { ok: false, status: 404, json: async () => ({ error: 'File unavailable' }) } as Response
    : initial(url, init));
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove selected files"]')!.click());
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(button => button.textContent?.trim() === 'Remove selected')!.click());
  expect(host.querySelector('[aria-label="Selected files"]')).toBeNull();
});

it('saves a new empty project before making it available in the project selector', async () => {
  const initial = vi.mocked(fetch).getMockImplementation()!;
  let created = '';
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const match = String(url).match(/\/projects\/([a-f0-9]{32})(\/inputs\?.*)?$/);
    if (match && init?.method === 'PUT' && !match[2]) {
      created = match[1];
      return ok({ id: created, revision: 1, created: 1, updated: 1, settings: defaultProjectSettings }) as Response;
    }
    if (match?.[2]) return ok({ sources: [], total: 0, scanned: 0, unavailable: 0, nextCursor: null }) as Response;
    return initial(url, init);
  });
  await render();
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'New project')!.click());
  expect(created).toMatch(/^[a-f0-9]{32}$/);
  expect(host.querySelector('[aria-label="Current project"]')?.textContent).toContain('Project 2');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('reattaches the committed upload after an account action returns to the same owner', async () => {
  await render();
  const input = host.querySelector<HTMLInputElement>('[aria-label="Add files to queue"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['abc'], 'resume.txt')], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => compress().click());
  expect(chunkWrites).toBe(1);
  await act(async () => {
    window.dispatchEvent(new Event('hamma-owner-clearing'));
    window.dispatchEvent(new Event('hamma-owner-changed'));
  });
  rejectJob = false;
  await act(async () => compress().click());
  expect(chunkWrites).toBe(1);
  expect(jobAttempts).toBe(2);
});

it('restores grouped choices with pending uploaded inputs and runs the remaining group', async () => {
  saved = { id: 'default', revision: 1, created: 1, updated: 1, settings: { ...defaultProjectSettings, groupActions: { file: 'compress:zip' } } };
  checkpoint = { id: 'a'.repeat(32), upload: uploadId, name: 'resume.txt', size: 3, directory: false };
  offset = 3; rejectJob = false;
  await render();
  expect(host.querySelector('[aria-label="Action for Other files"]')?.textContent).toContain('Archive as ZIP');
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Run grouped workflow')!.click());
  expect(jobAttempts).toBe(1);
  expect(chunkWrites).toBe(0);
});

it('refuses an incompatible restored group choice before submitting any work', async () => {
  saved = { id: 'default', revision: 1, created: 1, updated: 1, settings: { ...defaultProjectSettings, groupActions: { file: 'convert:mp3' } } };
  checkpoint = { id: 'a'.repeat(32), upload: uploadId, name: 'resume.txt', size: 3, directory: false };
  offset = 3;
  await render();
  expect(host.textContent).toContain('choose a compatible action again');
  const run = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Run grouped workflow')!;
  expect(run.disabled).toBe(true);
  expect(jobAttempts).toBe(0);
});

it('reopens an unstarted selection and queues it only after the original is picked', async () => {
  caps.projectSelections = true;
  caps.recoverableUploads = true;
  rejectJob = false;
  await render();
  const original = new File(['abc'], 'draft.txt');
  const input = host.querySelector<HTMLInputElement>('[aria-label="Add files to queue"]')!;
  Object.defineProperty(input, 'files', { value: [original] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(selections).toHaveLength(1);
  expect(chunkWrites).toBe(0);
  expect(checkpoint).toBeUndefined();
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(host.textContent).toContain('Restored 1 selection from before upload.');
  await act(async () => compress().click());
  expect(jobAttempts).toBe(0);
  const picker = host.querySelector<HTMLInputElement>('[aria-label="Select original file for draft.txt"]')!;
  Object.defineProperty(picker, 'files', { value: [original] });
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => compress().click());
  expect(jobAttempts).toBe(1);
  expect(chunkWrites).toBe(1);
  expect(selections).toEqual([]);
});

it('merges unstarted selections with partial and completed uploads across recovery pages', async () => {
  caps.draftScope = 'mixed-scale';
  caps.recoverableUploads = true;
  saved = { id: 'default', revision: 1, created: 1, updated: 1, settings: defaultProjectSettings };
  const key = 'hamma-selection:mixed-scale:default';
  const pending = { id: 'f'.repeat(32), name: 'unstarted.txt', size: 3, directory: false };
  localStorage.setItem(key, JSON.stringify({
    expires: Date.now() + 60000,
    sources: [pending],
    selected: [pending.id],
  }));
  const sources = Array.from({ length: 105 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(32, '0'),
    upload: (index + 1000).toString(16).padStart(32, '0'),
    name: index === 0 ? 'partial.txt' : `complete-${index}.txt`,
    size: 3,
    directory: false,
    uploaded: index === 0 ? 1 : 3,
  }));
  const initial = vi.mocked(fetch).getMockImplementation()!;
  const cursors: string[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (!String(url).includes('/projects/default/inputs?')) return initial(url, init);
    const cursor = new URL(String(url), window.location.href).searchParams.get('after')!;
    cursors.push(cursor);
    const page = cursor ? sources.slice(100) : sources.slice(0, 100);
    return ok({ sources: page, total: 105, scanned: page.length, unavailable: 0,
      nextCursor: cursor ? null : page[99].id }) as Response;
  });
  try {
    await render();
    expect(cursors).toEqual(['', sources[99].id]);
    expect(host.textContent).toContain('Recovered 104 uploaded files.');
    expect(host.textContent).toContain('Select the original files for 1 saved selection.');
    expect(host.textContent).toContain('Select the original files to continue 1 upload.');
    expect(host.querySelector('[aria-label="Select original file for partial.txt"]')).not.toBeNull();
    expect(host.querySelectorAll('.source-row').length).toBeLessThan(106);
    expect(compress().disabled).toBe(true);
    await act(async () => compress().click());
    expect(chunkWrites).toBe(0);
    expect(jobAttempts).toBe(0);
  } finally {
    localStorage.removeItem(key);
  }
});
