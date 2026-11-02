import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectField } from '../components/ui/SelectField';

let root: Root;
let host: HTMLDivElement;
const changed = vi.fn();
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('zip');
  return (
    <SelectField
      aria-label="Format"
      value={value}
      disabled={disabled}
      onChange={(next) => {
        setValue(next);
        changed(next);
      }}
    >
      <option value="zip">ZIP</option>
      <option value="tar">TAR</option>
      <option value="png">PNG</option>
    </SelectField>
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  changed.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const trigger = () => host.querySelector<HTMLButtonElement>('[role=combobox]')!;
const key = async (name: string) =>
  act(async () => {
    trigger().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
it('selects with arrow keys and Enter and returns focus', async () => {
  trigger().focus();
  await key('ArrowDown');
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  await key('Enter');
  expect(changed).toHaveBeenLastCalledWith('tar');
  expect(trigger().textContent).toBe('TAR');
  expect(document.activeElement).toBe(trigger());
  expect(document.querySelector('[role=listbox]')).toBeNull();
});
it('dismisses with Escape and outside clicks without changing selection', async () => {
  const globalKey = vi.fn();
  window.addEventListener('keydown', globalKey);
  await act(async () => trigger().click());
  await key('Escape');
  window.removeEventListener('keydown', globalKey);
  expect(globalKey).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  await act(async () => trigger().click());
  await act(async () =>
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
  );
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
});
it('supports type-to-find and pointer selection in the portaled menu', async () => {
  await key('p');
  await key('Enter');
  expect(changed).toHaveBeenLastCalledWith('png');
  await act(async () => trigger().click());
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role=option]'),
  ).find((item) => item.textContent === 'ZIP')!;
  await act(async () => option.click());
  expect(changed).toHaveBeenLastCalledWith('zip');
});
it('does not open a disabled control', async () => {
  await act(async () => root.render(<Harness disabled />));
  await act(async () => trigger().click());
  expect(document.querySelector('[role=listbox]')).toBeNull();
});
