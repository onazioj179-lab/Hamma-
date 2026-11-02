import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalOverview } from '../components/workspace/LocalOverview';
import { useAppStore } from '../store/app';
vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) }); });
afterEach(() => { vi.unstubAllGlobals(); useAppStore.setState({ recentArchives: [] }); });
it('counts both engines while excluding extraction expansion from compression savings', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ recentArchives: [{ id: 'restore', fileName: 'restore.spk', type: 'decompress', date: 1000, originalSize: 100000, compressedSize: 10, ratio: .0001, mode: 'auto' }] });
  const base = { target: 'zip', format: 'zip', state: 'completed', inputSize: 1000, outputSize: 500, processed: 1000, created: 1, fileExpires: 0, historyExpires: null, entries: 1, fileCount: 1, downloadAvailable: false };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ total: 3, jobs: [
    { ...base, id: 'compress', name: 'archive', operation: 'compress' },
    { ...base, id: 'convert', name: 'video', operation: 'convert', outputSize: 10000 },
    { ...base, id: 'pending', name: 'waiting', operation: 'compress', state: 'queued', outputSize: null },
  ] }) })));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const onHistory = vi.fn();
  try {
    await act(async () => root.render(<LocalOverview device={null} onHistory={onHistory} />));
    const metrics = [...host.querySelectorAll('.metric')];
    expect(metrics[0].textContent).toContain('4');
    expect(metrics[0].textContent).toContain('3 completed · 1 active');
    expect(metrics[2].textContent).toContain('500 B');
    expect(metrics[2].textContent).toContain('50.0%');
    expect(host.querySelectorAll('.overview-recent > button')).toHaveLength(4);
    await act(async () => host.querySelector<HTMLButtonElement>('.page-heading button')!.click());
    expect(onHistory).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
