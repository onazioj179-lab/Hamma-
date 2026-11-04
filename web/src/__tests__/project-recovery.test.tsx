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
let offset: number, chunkWrites: number, jobAttempts: number;
let rejectJob: boolean;
const uploadId = 'c'.repeat(32);
const caps = { groupedWorkflows: true, projectRecovery: true, archives: ['zip'], conversions: [], version: 1, processing: 'local', limits: { files: 5000, input: 1e9, expanded: 1e9, seconds: 30 } };
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ sessionOutputs: {}, recentArchives: [], history: [], result: null });
  saved = undefined; checkpoint = undefined; offset = 0; chunkWrites = 0; jobAttempts = 0; rejectJob = true;
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
    if (url.includes('/projects/default/inputs?')) return ok({ sources: checkpoint ? [{ ...checkpoint, uploaded: checkpoint.size, inspection: { format: 'file', conversions: [], extract: false } }] : [], total: checkpoint ? 1 : 0, scanned: checkpoint ? 1 : 0, unavailable: 0, nextCursor: null });
    if (/\/projects\/default\/inputs\/[a-f0-9]{32}$/.test(url) && init?.method === 'PUT') {
      checkpoint = { id: url.split('/').pop()!, upload: body.upload, name: 'resume.txt', size: 3, directory: false };
      return ok({ saved: true });
    }
    if (url.endsWith('/uploads') && init?.method === 'POST') return ok({ id: uploadId });
    if (url.endsWith('/uploads/' + uploadId)) {
      if (init?.method === 'PUT') { chunkWrites++; offset += (init.body as Blob).size; }
      return ok({ offset });
    }
    if (url.endsWith('/jobs') && init?.method === 'POST') {
      jobAttempts++;
      expect(body.recoverable).toBe(true);
      expect(body.uploads).toEqual([uploadId]);
      if (rejectJob) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: 'Queue full' }) };
      checkpoint = undefined;
      return ok({ id: 'd'.repeat(32) });
    }
    if (url.includes('/jobs?')) return ok({ jobs: [], total: 0 });
    throw new Error('Unexpected request: ' + url);
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = async () => { await act(async () => root.render(<UniversalWorkspace visible screen="workspace" onHistory={() => {}} />)); };
const compress = () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Compress')!;

it('restores a completed upload after refresh and submits it without uploading its bytes again', async () => {
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

it('lets the user remove a recovered entry whose upload has already expired', async () => {
  saved = { id: 'default', revision: 1, created: 1, updated: 1, settings: defaultProjectSettings };
  checkpoint = { id: 'a'.repeat(32), upload: uploadId, name: 'expired.txt', size: 3, directory: false };
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
