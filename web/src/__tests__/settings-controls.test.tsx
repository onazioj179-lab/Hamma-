import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsModal } from '../components/ui/SettingsModal';
import { useAppStore } from '../store/app';

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) });
});
let root: Root;
let host: HTMLDivElement;
let trigger: HTMLButtonElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  trigger = document.createElement('button');
  document.body.append(trigger, host);
  trigger.focus();
  root = createRoot(host);
  useAppStore.setState({ autoDownload: false, theme: 'system' });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); trigger.remove();
  document.documentElement.classList.remove('dark');
});
it('writes supported settings to the active store', async () => {
  await act(async () => root.render(<SettingsModal isOpen onClose={() => {}} />));
  const dark = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Dark')!;
  await act(async () => dark.click());
  expect(useAppStore.getState().theme).toBe('dark');
  expect(dark.getAttribute('aria-pressed')).toBe('true');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  const toggle = host.querySelector<HTMLButtonElement>('[role=switch]')!;
  await act(async () => toggle.click());
  expect(useAppStore.getState().autoDownload).toBe(true);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(host.textContent).not.toContain('Chunk Size');
});
it('contains keyboard focus, closes on Escape, and restores focus', async () => {
  const onClose = vi.fn();
  await act(async () => root.render(<SettingsModal isOpen onClose={onClose} />));
  const close = host.querySelector('button')!;
  const toggle = host.querySelector<HTMLButtonElement>('[role=switch]')!;
  expect(document.activeElement).toBe(close);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(toggle);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(close);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<SettingsModal isOpen={false} onClose={onClose} />));
  expect(document.activeElement).toBe(trigger);
});
