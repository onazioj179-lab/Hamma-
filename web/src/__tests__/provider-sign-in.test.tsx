import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderSignIn } from '../components/ui/ProviderSignIn';

const sdk = vi.hoisted(() => ({ load: vi.fn(async () => {}), initialize: vi.fn(), renderButton: vi.fn(), init: vi.fn(), signIn: vi.fn() }));
vi.mock('../processing/provider-sdk', () => ({ loadProviderSdk: sdk.load, providerWindow: () => ({ google: { accounts: { id: { initialize: sdk.initialize, renderButton: sdk.renderButton } } }, AppleID: { auth: { init: sdk.init, signIn: sdk.signIn } } }) }));
let root: Root, host: HTMLDivElement, fetchMock: ReturnType<typeof vi.fn>;
const setup = { state: 'a'.repeat(43), nonce: 'b'.repeat(43), clientId: 'fixture-client', redirectUri: location.origin + '/' };
const onSuccess = vi.fn(), onError = vi.fn(), onBusy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/start') ? setup : { authenticated: true, account: { displayName: 'Provider user', passwordEnabled: false } } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = async (provider: 'google' | 'apple') => { await act(async () => root.render(<ProviderSignIn provider={provider} name={provider === 'google' ? 'Google' : 'Apple'} disabled={false} onSuccess={onSuccess} onError={onError} onBusy={onBusy} />)); };
const click = async () => { await act(async () => host.querySelector('button')!.click()); };

it('loads nothing before intent and completes Google through the protected session endpoint', async () => {
  await render('google');
  expect(sdk.load).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  await click();
  expect(sdk.load).toHaveBeenCalledWith('google');
  expect(sdk.initialize).toHaveBeenCalledWith(expect.objectContaining({ nonce: setup.nonce, auto_select: false }));
  expect(sdk.renderButton).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ width: '240' }));
  await act(async () => sdk.initialize.mock.calls[0][0].callback({ credential: 'signed-fixture-token' }));
  expect(fetchMock.mock.calls[1][0]).toBe('/api/process/account/oauth/google/complete');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ state: setup.state, credential: 'signed-fixture-token' });
  expect(fetchMock.mock.calls[1][1].headers['X-Hamma-Request']).toBe('1');
  expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ authenticated: true }));
});

it('opens the Apple popup only on a second direct gesture and validates its returned state', async () => {
  sdk.signIn.mockResolvedValue({ authorization: { code: 'apple-code', state: setup.state } });
  await render('apple'); await click();
  expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({ nonce: setup.nonce, usePopup: true }));
  expect(sdk.signIn).not.toHaveBeenCalled();
  await click();
  expect(sdk.signIn).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[1][0]).toBe('/api/process/account/oauth/apple/complete');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ state: setup.state, code: 'apple-code' });
});

it('does not send Apple responses with a mismatched state', async () => {
  sdk.signIn.mockResolvedValue({ authorization: { code: 'apple-code', state: 'wrong' } });
  await render('apple'); await click(); await click();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('could not finish'));
});

it('respects foreground file-operation guards before loading provider code', async () => {
  const block = (event: Event) => event.preventDefault();
  window.addEventListener('hamma-owner-changing', block);
  try { await render('google'); await click(); }
  finally { window.removeEventListener('hamma-owner-changing', block); }
  expect(sdk.load).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('file operation'));
});

it('reports blocked SDK loading and never creates a sign-in transaction', async () => {
  sdk.load.mockRejectedValueOnce(new Error('Provider script blocked'));
  await render('google'); await click();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith('Provider script blocked');
  expect(onBusy).toHaveBeenLastCalledWith(false);
});
