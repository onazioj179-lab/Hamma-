import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountPanel } from '../components/ui/AccountPanel';
import { changeAccount } from '../processing/account';

let host: HTMLDivElement;
let root: Root;
const guest = { authenticated: false, credentialsAllowed: true, account: null, plan: { tier: 'guest', historyRecords: 500, maxQueuedJobs: 100, maxConcurrentJobs: 1, maxUploadFiles: 5000, maxInputBytes: 1024 ** 3, maxStorageBytes: 5 * 1024 ** 3 }, billingEnabled: false };
const member = { ...guest, authenticated: true, account: { accountId: 'id', username: 'alice', displayName: 'Alice', created: 1, plan: 'free' }, plan: { ...guest.plan, tier: 'free', historyRecords: 1000, maxQueuedJobs: 200, maxConcurrentJobs: 2 } };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => guest })); vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = async () => { await act(async () => root.render(<AccountPanel />)); };
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(value => value.textContent === label)!;
const fill = (name: string, value: string) => { host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value; };
const submit = async () => { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };

it('keeps quotas out of the page and disables credentials on insecure remote transport', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...guest, credentialsAllowed: false, plan: { ...guest.plan, historyRecords: 321 } }) });
  await render();
  expect(host.textContent).not.toContain('321');
  expect(host.textContent).not.toContain('Guest workspace');
  expect(host.textContent).not.toContain('Billing');
  expect(host.textContent).toContain('Use HTTPS');
  expect(host.querySelector<HTMLInputElement>('input[name=password]')!.disabled).toBe(true);
  expect(button('Sign in to account').disabled).toBe(true);
});

it('registers without persisting credentials and clears passwords after success', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  await render(); await act(async () => button('Create account').click());
  fill('username', 'alice'); fill('password', 'long-password-123'); fill('confirm', 'long-password-123');
  fetchMock.mockResolvedValue({ ok: true, json: async () => member });
  await submit();
  const [url, init] = fetchMock.mock.calls[1];
  expect(url).toBe('/api/process/account/register');
  expect(JSON.parse(init.body)).toEqual({ username: 'alice', password: 'long-password-123' });
  expect(init.credentials).toBe('same-origin');
  expect(host.textContent).toContain('Alice');
  expect(host.textContent).not.toContain('1,000');
  expect(storage).not.toHaveBeenCalled();
  expect(Array.from(host.querySelectorAll<HTMLInputElement>('input[type=password]')).every(input => input.value === '')).toBe(true);
});

it('rejects mismatched confirmation before sending registration', async () => {
  await render(); await act(async () => button('Create account').click());
  fill('username', 'alice'); fill('password', 'long-password-123'); fill('confirm', 'different-password');
  await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Passwords do not match');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('changes password and signs out through real account endpoints', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => member }); await render();
  fill('currentPassword', 'old-password-123'); fill('newPassword', 'new-password-456'); fill('confirm', 'new-password-456');
  await act(async () => host.querySelectorAll('form')[1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fetchMock.mock.calls[1][0]).toBe('/api/process/account/password-change');
  expect(host.textContent).toContain('Other sessions have been signed out');
  fetchMock.mockResolvedValue({ ok: true, json: async () => guest }); await submit();
  expect(fetchMock.mock.calls[2][0]).toBe('/api/process/account/logout');
  expect(host.textContent).toContain('Signed out.');
});

it('honors foreground ownership guards before sending credentials', async () => {
  const block = (event: Event) => event.preventDefault();
  window.addEventListener('hamma-owner-changing', block);
  try { await expect(changeAccount('login', { username: 'alice', password: 'not-sent' })).rejects.toThrow('Finish the current upload'); }
  finally { window.removeEventListener('hamma-owner-changing', block); }
  expect(fetchMock).not.toHaveBeenCalled();
});

it('retains wrong-password feedback after reloading the current session', async () => {
  await render(); fill('username', 'alice'); fill('password', 'wrong-password');
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/login') ? { ok: false, status: 401, json: async () => ({ error: 'Incorrect username or password' }) } : { ok: true, json: async () => guest });
  await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Incorrect username or password');
  expect(host.querySelector<HTMLInputElement>('input[name=password]')!.value).toBe('');
});


it('shows honest provider availability without starting an unconfigured sign-in', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...guest, providers: [
    { id: 'google', name: 'Google', available: false }, { id: 'apple', name: 'Apple', available: false },
  ] }) });
  await render();
  expect(host.textContent).toContain('Google');
  expect(host.textContent).toContain('Apple');
  expect(host.querySelectorAll('.account-provider')).toHaveLength(2);
  expect(host.querySelector('.account-providers button')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('toggles password visibility and clears a visible password after failed sign-in', async () => {
  await render();
  fill('username', 'alice'); fill('password', 'wrong-password');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Show password"]')!.click());
  expect(host.querySelector<HTMLInputElement>('[name=password]')!.type).toBe('text');
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/login') ? { ok: false, status: 401, json: async () => ({ error: 'Incorrect username or password' }) } : { ok: true, json: async () => guest });
  await submit();
  expect(host.querySelector<HTMLInputElement>('[name=password]')!.value).toBe('');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Incorrect');
});
