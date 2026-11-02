import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { usePreferences } from '../store/preferences';
import { useAppStore } from '../store/app';

const mock = vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
  });
  return { download: vi.fn(), cancel: vi.fn() };
});
vi.mock('../hooks/useCompression', () => ({
  useCompression: () => ({
    workerReady: true,
    isIdle: false,
    isProcessing: false,
    isComplete: true,
    isError: false,
    result: {
      originalSize: 100,
      resultSize: 50,
      ratio: 0.5,
      duration: 5,
      outputName: 'real.spk',
      downloadUrl: 'blob:current',
    },
    progress: { bytesProcessed: 0, totalBytes: 0 },
    currentStrategy: 'main-js',
    deviceInfo: null,
    compress: vi.fn(),
    decompress: vi.fn(),
    compressMultiple: vi.fn(),
    reset: vi.fn(),
    download: mock.download,
    cancel: mock.cancel,
  }),
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  localStorage.setItem('hamma-terms-v1', 'accepted');
  usePreferences.getState().setRememberHistory(true);
  usePreferences.getState().setPrivacyChoice('essential');
  useAppStore.getState().clearRecentArchives();
  mock.download.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === name,
  )!;

it('keeps the real result available across navigation without requiring an account', async () => {
  expect(host.textContent).not.toContain('Login');
  await act(async () => button('Files & History').click());
  expect(host.textContent).toContain('real.spk');
  await act(async () => button('Download').click());
  expect(mock.download).toHaveBeenCalledOnce();
  await act(async () => button('Overview').click());
  expect(host.textContent).toContain('0 B');
  expect(host.textContent).not.toContain('Local performance learning');
});
it('opens the persistent settings panel and honors privacy controls', async () => {
  await act(async () => button('Settings').click());
  expect(host.querySelector('[role=dialog]')).toBeNull();
  await act(async () => button('Privacy').click());
  const switches =
    host.querySelectorAll<HTMLInputElement>('input[role=switch]');
  expect(switches[0].checked).toBe(true);
  await act(async () => switches[0].click());
  expect(usePreferences.getState().rememberHistory).toBe(false);
  expect(host.textContent).not.toContain('Local performance learning');
  await act(async () => button('About').click());
  expect(host.textContent).toContain('Onazi Treasure Oj');
  expect(
    host.querySelector('a[href="https://github.com/onazioj179-lab/Hamma-"]'),
  ).not.toBeNull();
});
