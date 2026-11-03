import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmAction } from '../components/ui/ConfirmAction';
import { SettingsPanel } from '../components/ui/SettingsPanel';
import { useAppStore } from '../store/app';

vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) }); });
let root: Root, host: HTMLDivElement, trigger: HTMLButtonElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  useAppStore.setState({ sessionOutputs: {}, recentArchives: [], history: [], result: null });
  trigger = document.createElement('button'); host = document.createElement('div');
  document.body.append(trigger, host); trigger.focus(); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); trigger.remove(); vi.restoreAllMocks(); });
const inDialog = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role=alertdialog] button')].find(button => button.textContent === name)!;
const settingsButton = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name)!;

function Prompt({ action, cancelled }: { action: () => void | Promise<void>; cancelled: () => void }) {
  const [open, setOpen] = useState(true);
  return open ? <ConfirmAction title="Delete 2 files?" description="Downloaded copies stay." confirmLabel="Delete files" onConfirm={action} onCancel={() => { cancelled(); setOpen(false); }} /> : null;
}

it('focuses Cancel, contains keyboard focus, and restores background state on cancellation', async () => {
  const action = vi.fn(), cancelled = vi.fn();
  await act(async () => root.render(<Prompt action={action} cancelled={cancelled} />));
  expect(document.activeElement).toBe(inDialog('Cancel'));
  expect(host.hasAttribute('inert')).toBe(true);
  expect(host.getAttribute('aria-hidden')).toBe('true');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(inDialog('Delete files'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(inDialog('Cancel'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(action).not.toHaveBeenCalled(); expect(cancelled).toHaveBeenCalledOnce();
  expect(document.querySelector('[role=alertdialog]')).toBeNull();
  expect(host.hasAttribute('inert')).toBe(false); expect(host.hasAttribute('aria-hidden')).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it('submits a confirmed mutation once and prevents cancellation while it is running', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const action = vi.fn(() => pending), cancelled = vi.fn();
  await act(async () => root.render(<Prompt action={action} cancelled={cancelled} />));
  const confirm = inDialog('Delete files');
  await act(async () => { confirm.click(); confirm.click(); });
  expect(action).toHaveBeenCalledOnce(); expect(confirm.disabled).toBe(true);
  expect(inDialog('Cancel').disabled).toBe(true);
  const openShortcut = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true });
  await act(async () => document.dispatchEvent(openShortcut));
  expect(openShortcut.defaultPrevented).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(cancelled).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(cancelled).toHaveBeenCalledOnce();
});

const archive = (id: string) => ({ id, fileName: id + '.txt', originalSize: 10, compressedSize: 5, ratio: .5, date: 1000, type: 'compress' as const, mode: 'auto' as const });
const output = (id: string) => ({ archive: archive(id), outputName: id + '.spk', downloadUrl: 'blob:' + id, savedToDevice: false });
const renderSettings = async () => {
  useAppStore.setState({ recentArchives: [archive('one')], sessionOutputs: { one: output('one'), two: output('two') } });
  await act(async () => root.render(<SettingsPanel section="storage" onSectionChange={() => {}} busy={false} />));
};

it('confirms counted Settings history clearing while preserving temporary downloads', async () => {
  await renderSettings();
  await act(async () => settingsButton('Clear history').click());
  expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('2 browser activity records');
  expect(useAppStore.getState().recentArchives).toHaveLength(1);
  await act(async () => inDialog('Cancel').click());
  expect(useAppStore.getState().recentArchives).toHaveLength(1);
  await act(async () => settingsButton('Clear history').click());
  await act(async () => inDialog('Clear history').click());
  expect(useAppStore.getState().recentArchives).toHaveLength(0);
  expect(useAppStore.getState().sessionOutputs.one.downloadUrl).toBe('blob:one');
  expect(useAppStore.getState().sessionOutputs.one.hidden).toBe(true);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it('deletes only the browser files reviewed in Settings when another output arrives later', async () => {
  await renderSettings();
  await act(async () => settingsButton('Delete browser files').click());
  expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('2 temporary browser downloads');
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => useAppStore.setState(state => ({ sessionOutputs: { ...state.sessionOutputs, later: output('later') } })));
  await act(async () => inDialog('Delete browser files').click());
  expect(Object.keys(useAppStore.getState().sessionOutputs)).toEqual(['later']);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:later');
  expect(useAppStore.getState().recentArchives).toHaveLength(1);
});
