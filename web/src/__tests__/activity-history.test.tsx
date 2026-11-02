import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ActivityHistory } from '../components/files/ActivityHistory';
import { useAppStore } from '../store/app';
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) });
});
it('shows recorded operations and clears only local history metadata', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  useAppStore.setState({ recentArchives: [{ id: 'record', fileName: 'actual-file.spk', originalSize: 1024, compressedSize: 512, ratio: .5, date: Date.now(), type: 'compress', mode: 'auto' }] });
  try {
    await act(async () => root.render(<ActivityHistory />));
    expect(host.textContent).toContain('actual-file.spk');
    expect(host.textContent).toContain('1.00 KB');
    expect(host.querySelector('a[download]')).toBeNull();
    await act(async () => host.querySelector('button')!.click());
    expect(useAppStore.getState().recentArchives).toEqual([]);
    expect(host.querySelector('[role=status]')?.textContent).toContain('No completed operations');
    expect(host.querySelector('button')?.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});
