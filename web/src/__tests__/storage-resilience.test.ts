import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it('initializes the theme and stores session state even when persistent storage is blocked', async () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  const { useAppStore } = await import('../store/app');
  const { usePreferences } = await import('../store/preferences');
  useAppStore.getState().setTheme('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(useAppStore.getState().theme).toBe('dark');
  usePreferences.getState().setRememberHistory(false);
  expect(usePreferences.getState().rememberHistory).toBe(false);
});
