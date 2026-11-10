import { useEffect, useRef, useState } from 'react';
import { accountChanging, changeAccount, type AccountSession } from '../../processing/account';
import { jsonRequest } from '../../processing/client';
import { loadProviderSdk, providerWindow, type ProviderId, type ProviderSetup } from '../../processing/provider-sdk';

type Props = { provider: ProviderId; name: string; disabled: boolean; onSuccess: (session: AccountSession) => void; onError: (message: string) => void; onBusy: (busy: boolean) => void };
function guard() {
  if (accountChanging() || !window.dispatchEvent(new CustomEvent('hamma-owner-changing', { cancelable: true }))) throw new Error('Finish the current file operation before signing in.');
}
export function ProviderSignIn({ provider, name, disabled, onSuccess, onError, onBusy }: Props) {
  const [setup, setSetup] = useState<ProviderSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true), running = useRef(false), opening = useRef(false);
  const googleHost = useRef<HTMLDivElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const finish = async (fields: Record<string, string>) => {
    if (!active.current || running.current) return;
    running.current = true; setBusy(true); onBusy(true); onError('');
    try { const session = await changeAccount(provider === 'google' ? 'oauth/google/complete' : 'oauth/apple/complete', fields); if (active.current) onSuccess(session); }
    catch (error) { if (active.current) { onError(error instanceof Error ? error.message : 'Sign-in failed. Try again.'); setSetup(null); googleHost.current?.replaceChildren(); } }
    finally { running.current = false; if (active.current) { setBusy(false); onBusy(false); } }
  };
  const prepare = async () => {
    if (disabled || running.current) return;
    try { guard(); } catch (error) { onError((error as Error).message); return; }
    running.current = true; setBusy(true); onBusy(true); onError('');
    try {
      await loadProviderSdk(provider);
      const next = await jsonRequest<ProviderSetup>('/account/oauth/' + provider + '/start', {});
      if (!active.current) return;
      if (!/^[A-Za-z0-9_-]{43}$/.test(next.state) || !/^[A-Za-z0-9_-]{43}$/.test(next.nonce) || typeof next.clientId !== 'string' || new URL(next.redirectUri).origin !== location.origin) throw new Error('Sign-in configuration is invalid.');
      setSetup(next);
      if (provider === 'google') {
        const identity = providerWindow().google!.accounts.id;
        identity.initialize({ client_id: next.clientId, nonce: next.nonce, auto_select: false, callback: result => { void finish({ state: next.state, credential: result.credential }); } });
        if (googleHost.current) { googleHost.current.replaceChildren(); identity.renderButton(googleHost.current, { theme: 'outline', size: 'large', type: 'standard', width: String(Math.max(120, Math.min(240, (googleHost.current.parentElement?.clientWidth || 280) - 28))) }); }
      } else providerWindow().AppleID!.auth.init({ clientId: next.clientId, redirectURI: next.redirectUri, state: next.state, nonce: next.nonce, usePopup: true });
    } catch (error) { if (active.current) onError(error instanceof Error ? error.message : 'Sign-in could not start.'); }
    finally { running.current = false; if (active.current) { setBusy(false); onBusy(false); } }
  };
  const appleSignIn = async () => {
    if (!setup || disabled || running.current || opening.current) return;
    opening.current = true;
    try {
      guard();
      // Call synchronously in the button gesture so browser popup rules apply.
      const response = providerWindow().AppleID!.auth.signIn();
      setBusy(true); onBusy(true);
      const result = await response;
      if (!active.current) return;
      if (result.authorization.state !== setup.state) throw new Error('Sign-in could not be verified. Start again.');
      await finish({ state: result.authorization.state, code: result.authorization.code });
    } catch (error) { if (active.current) { onError('Sign-in was cancelled or could not finish. Start again.'); setSetup(null); } }
    finally { opening.current = false; if (active.current) { setBusy(false); onBusy(false); } }
  };
  return <div className="account-provider"><strong>{name}</strong><button type="button" className="button secondary" disabled={disabled || busy} onClick={() => void (provider === 'apple' && setup ? appleSignIn() : prepare())}>{busy ? 'Working...' : setup && provider === 'apple' ? 'Open Apple sign-in' : setup ? 'Restart sign-in' : 'Continue with ' + name}</button><div className="account-provider-widget" ref={googleHost} hidden={provider !== 'google' || !setup || disabled || busy} />{setup && <span>Choose your account in the provider window or button. This sign-in request expires after 10 minutes.</span>}</div>;
}
