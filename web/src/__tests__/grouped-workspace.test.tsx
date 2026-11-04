import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UniversalWorkspace } from '../components/workspace/UniversalWorkspace';
import * as client from '../processing/client';
import { useAppStore } from '../store/app';

vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) }); });
let host: HTMLDivElement, root: Root, posted: Record<string, unknown>[];
let rejectImage: boolean;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ sessionOutputs: {}, recentArchives: [], history: [], result: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  posted = []; rejectImage = false;
  vi.spyOn(client, 'upload').mockImplementation(async source => 'upload-' + source.name);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    let value: unknown;
    if (url.endsWith('/capabilities')) value = { groupedWorkflows: true, inspection: true, version: 1, processing: 'local', archives: ['zip'], conversions: ['png', 'jpg'], limits: { input: 1e9, expanded: 1e9, files: 5000, seconds: 60 } };
    else if (url.endsWith('/settings')) value = { fileRetention: '24h', historyRetention: '30d' };
    else if (url.endsWith('/inspect')) value = { entries: JSON.parse(init!.body as string).entries.map(({ head }: { head: string }) => head.startsWith('89504e47') ? { format: 'png', conversions: ['png', 'jpg'], extract: false } : head.startsWith('504b0304') ? { format: 'zip', conversions: [], extract: true } : { format: 'file', conversions: [], extract: false }) };
    else if (url.endsWith('/jobs') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string); posted.push(body);
      if (rejectImage && body.operation === 'convert') return { ok: false, status: 415, json: async () => ({ error: 'Unsupported test image' }) };
      value = { id: String(posted.length) };
    } else value = { jobs: [], total: 0 };
    return { ok: true, status: 200, json: async () => value };
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!;
const choose = async (label: string, text: string) => {
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(option => option.textContent === text)!.click());
};
const setup = async () => {
  await act(async () => root.render(<UniversalWorkspace visible screen="workspace" onHistory={() => {}} />));
  const input = host.querySelector<HTMLInputElement>('[aria-label="Add files to queue"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'image.png'), new File(['PK\x03\x04'], 'archive.zip'), new File(['text'], 'note.txt')] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  // FileReader completion occurs on a later task, just as real header inspection does.
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Action for PNG"]')).not.toBeNull());
};

it('runs compatible image, archive and document actions from a single mixed selection', async () => {
  await setup();
  expect(button('Run grouped workflow').disabled).toBe(true);
  await choose('Action for PNG', 'Convert to PNG');
  await choose('Action for ZIP', 'Extract to ZIP');
  await choose('Action for Other files', 'Archive as ZIP');
  await act(async () => button('Run grouped workflow').click());
  expect(posted.map(body => [body.operation, body.target])).toEqual([['convert', 'png'], ['extract', 'zip'], ['compress', 'zip']]);
  expect(posted.map(body => body.uploads)).toEqual([['upload-image.png'], ['upload-archive.zip'], ['upload-note.txt']]);
  expect(host.querySelector('[aria-label="Selected files"]')).toBeNull();
});

it('retains only the rejected image group and preserves its chosen action for retry', async () => {
  await setup(); rejectImage = true;
  await choose('Action for PNG', 'Convert to PNG');
  await choose('Action for ZIP', 'Extract to ZIP');
  await choose('Action for Other files', 'Archive as ZIP');
  await act(async () => button('Run grouped workflow').click());
  expect(posted).toHaveLength(3);
  expect(host.textContent).toContain('1 selected');
  expect(host.textContent).toContain('Unsupported test image');
  expect(host.querySelector('[aria-label="Action for PNG"]')?.textContent).toContain('Convert to PNG');
  rejectImage = false;
  await act(async () => button('Run grouped workflow').click());
  expect(posted).toHaveLength(4);
  expect(posted[3].uploads).toEqual(['upload-image.png']);
});

it('requires explicit quality-loss permission for a grouped JPEG conversion', async () => {
  await setup();
  await choose('Action for PNG', 'Convert to JPG');
  expect(host.textContent).toContain('JPG requires Allow quality loss');
  expect(button('Run grouped workflow').disabled).toBe(true);
  expect(posted).toHaveLength(0);
  await choose('Grouped conversion quality', 'Allow quality loss');
  await act(async () => button('Run grouped workflow').click());
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ operation: 'convert', target: 'jpg', qualityMode: 'lossy' });
  expect(host.textContent).toContain('2 selected');
});
