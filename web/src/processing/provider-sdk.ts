/** Official scripts load only after the user requests provider sign-in. */
export type ProviderId = 'google' | 'apple';
export interface ProviderSetup { state: string; nonce: string; clientId: string; redirectUri: string }
export interface GoogleIdentity {
  initialize(options: { client_id: string; nonce: string; auto_select: false; callback: (result: { credential: string }) => void }): void;
  disableAutoSelect?(): void;
  renderButton(host: HTMLElement, options: { theme: string; size: string; type: string; width: string }): void;
}
export interface AppleIdentity {
  init(options: { clientId: string; redirectURI: string; state: string; nonce: string; usePopup: true }): void;
  signIn(): Promise<{ authorization: { code: string; state: string } }>;
}
export const providerWindow = () => window as Window & { google?: { accounts: { id: GoogleIdentity } }; AppleID?: { auth: AppleIdentity } };
const sources = {
  google: 'https://accounts.google.com/gsi/client',
  apple: 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
};
const loading = new Map<ProviderId, Promise<void>>();
export function loadProviderSdk(provider: ProviderId): Promise<void> {
  const target = providerWindow();
  if (provider === 'google' ? !!target.google?.accounts?.id : !!target.AppleID?.auth) return Promise.resolve();
  const existing = loading.get(provider); if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = sources[provider]; script.async = true; script.referrerPolicy = 'no-referrer';
    const failed = () => { clearTimeout(timer); script.remove(); loading.delete(provider); reject(new Error('The sign-in service could not load. Check your connection and try again.')); };
    const timer = setTimeout(failed, 15000);
    script.onerror = failed;
    script.onload = () => { clearTimeout(timer); const current = providerWindow(); if (provider === 'google' ? !!current.google?.accounts?.id : !!current.AppleID?.auth) resolve(); else failed(); };
    document.head.append(script);
  });
  loading.set(provider, promise); return promise;
}
