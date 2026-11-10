import { jsonRequest, request } from './client';

export interface IdentityProvider { id: string; name: string; available: boolean; message: string }
export interface AccountSession {
  providers?: IdentityProvider[];
  authenticated: boolean;
  credentialsAllowed: boolean;
  account: null | { accountId: string; username: string; displayName: string; created: number; plan: 'free'; passwordEnabled?: boolean };
  plan: { tier: 'guest' | 'free'; historyRecords: number; maxQueuedJobs: number; maxConcurrentJobs: number; maxUploadFiles: number; maxInputBytes: number; maxStorageBytes: number };
  billingEnabled: false;
}
export const loadAccount = (signal?: AbortSignal) => request<AccountSession>('/account/me', { signal });
let changing = false;
export const accountChanging = () => changing;
const channel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel('hamma-account-changes') : null;
channel?.addEventListener('message', event => {
  if (event.data !== 'changed') return;
  window.dispatchEvent(new Event('hamma-owner-clearing'));
  window.dispatchEvent(new CustomEvent('hamma-owner-changed', { detail: { external: true } }));
});
/** Cookies stay HttpOnly; only the processor changes account ownership. */
export async function changeAccount(action: 'register' | 'login' | 'logout' | 'password-change' | 'oauth/google/complete' | 'oauth/apple/complete', fields: Record<string, string>): Promise<AccountSession> {
  if (changing) throw new Error('An account change is already in progress.');
  const event = new CustomEvent('hamma-owner-changing', { cancelable: true });
  if (!window.dispatchEvent(event)) throw new Error('Finish the current upload or file operation before changing accounts.');
  changing = true;
  window.dispatchEvent(new Event('hamma-owner-clearing'));
  let success = false;
  try {
    const result = await jsonRequest<AccountSession>('/account/' + action, fields);
    success = true;
    return result;
  } finally {
    changing = false;
    window.dispatchEvent(new CustomEvent('hamma-owner-changed', { detail: { success, ownerChanged: success && action !== 'password-change' } }));
    channel?.postMessage('changed');
  }
}
