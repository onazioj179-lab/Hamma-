import { providerWindow } from '../../processing/provider-sdk';
import { ProviderSignIn } from './ProviderSignIn';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { changeAccount, loadAccount, type AccountSession } from '../../processing/account';
import { Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import './AccountPanel.css';

function PasswordField({ label, name, autoComplete, disabled, minimum }: { label: string; name: string; autoComplete: string; disabled: boolean; minimum?: number }) {
  const [shown, setShown] = useState(false);
  const id = 'account-' + name;
  return <div className="account-password-field"><label htmlFor={id}>{label}</label><div className="account-password-input"><input id={id} name={name} type={shown ? 'text' : 'password'} autoComplete={autoComplete} minLength={minimum} maxLength={256} required disabled={disabled} spellCheck={false} /><button type="button" aria-label={`${shown ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={shown} aria-controls={id} disabled={disabled} onClick={() => setShown(value => !value)}>{shown ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>;
}

export function AccountPanel() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<{ external?: boolean }>).detail?.external) { setSession(null); setAttempt(value => value + 1); } };
    window.addEventListener('hamma-owner-changed', changed);
    return () => window.removeEventListener('hamma-owner-changed', changed);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    loadAccount(controller.signal).then(result => { if (!controller.signal.aborted) setSession(result); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Account service unavailable.'); });
    return () => { mounted.current = false; controller.abort(); };
  }, [attempt]);
  async function submit(event: FormEvent<HTMLFormElement>, action: 'login' | 'register' | 'password-change' | 'logout') {
    event.preventDefault();
    if (running.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const fields: Record<string, string> = {};
    data.forEach((value, key) => { if (typeof value === 'string' && key !== 'confirm') fields[key] = value; });
    if (!fields.displayName) delete fields.displayName;
    setError(''); setNotice('');
    if ((action === 'register' || action === 'password-change') && data.get('confirm') !== (data.get('newPassword') ?? data.get('password'))) { setError('Passwords do not match.'); return; }
    running.current = true; setBusy(true);
    try {
      const next = await changeAccount(action, fields);
      if (action === 'logout') { try { providerWindow().google?.accounts?.id.disableAutoSelect?.(); } catch { /* Application sign-out already succeeded. */ } }
      if (mounted.current) { setSession(next); setNotice(action === 'password-change' ? 'Password changed. Other sessions have been signed out.' : action === 'logout' ? 'Signed out.' : 'Signed in. Your workspace is ready.'); }
    } catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : 'Account request failed.'); setAttempt(value => value + 1); } }
    finally { form.querySelectorAll<HTMLInputElement>('input[autocomplete*=password]').forEach(input => { input.value = ''; }); running.current = false; if (mounted.current) setBusy(false); }
  }
  const providers = session?.providers || [];
  const disabled = busy || !session?.credentialsAllowed;
  return <section className="account-panel" aria-labelledby="account-title">
    <header className="account-heading"><span className="account-emblem" aria-hidden="true"><UserRound size={25} /></span><div><p className="account-eyebrow">YOUR WORKSPACE</p><h1 id="account-title">Account</h1><p>{session?.authenticated ? 'Manage your profile and account security.' : 'A place for your files. A sign-in that stays simple.'}</p></div></header>
    {error && <p className="account-feedback account-feedback-error" role="alert">{error}</p>}
    {notice && <p className="account-feedback" role="status">{notice}</p>}
    {!session ? <div><p>{error ? 'Account details could not be loaded.' : 'Loading account details…'}</p>{error && <button className="button secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button>}</div> : <>
      {session.account && <section className="account-card account-profile"><span className="account-avatar" aria-hidden="true">{session.account.displayName.slice(0, 1).toUpperCase()}</span><div><h2>{session.account.displayName}</h2><p>{session.account.passwordEnabled === false ? 'Connected provider account' : '@' + session.account.username}</p><span className="account-badge"><ShieldCheck size={14} /> Signed in</span></div></section>}
      {!session.credentialsAllowed && <p role="status">Use HTTPS or connect from the processor computer to sign in or change a password.</p>}
      {session.authenticated ? <>
        <form onSubmit={event => void submit(event, 'logout')}><button className="button secondary" disabled={busy}>Sign out</button></form>
        {session.account?.passwordEnabled !== false && <form className="account-card account-form" onSubmit={event => void submit(event, 'password-change')}><h2>Change password</h2>
          <PasswordField label="Current password" name="currentPassword" autoComplete="current-password" disabled={disabled} />
          <PasswordField label="New password" name="newPassword" autoComplete="new-password" minimum={12} disabled={disabled} />
          <PasswordField label="Confirm new password" name="confirm" autoComplete="new-password" minimum={12} disabled={disabled} />
          <p>Use at least 12 characters. Changing your password signs out all other sessions.</p><button className="button primary" disabled={disabled}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>}
      </> : <section className="account-card account-signin"><div className="account-mode" role="group" aria-label="Account access"><button className="button secondary" aria-pressed={mode === 'login'} disabled={busy} onClick={() => { setMode('login'); setError(''); }}>Sign in</button><button className="button secondary" aria-pressed={mode === 'register'} disabled={busy} onClick={() => { setMode('register'); setError(''); }}>Create account</button></div>
        <form key={mode} className="account-form" onSubmit={event => void submit(event, mode)}><h2>{mode === 'login' ? 'Sign in' : 'Create an account'}</h2>
          <label>Username<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" required disabled={disabled} /></label>
          {mode === 'register' && <label>Display name (optional)<input name="displayName" autoComplete="nickname" maxLength={80} disabled={disabled} /></label>}
          <PasswordField label="Password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minimum={mode === 'register' ? 12 : undefined} disabled={disabled} />
          {mode === 'register' && <><PasswordField label="Confirm password" name="confirm" autoComplete="new-password" minimum={12} disabled={disabled} /><p>Username: 3–64 letters, numbers, dots, underscores or hyphens. Password: at least 12 characters.</p></>}
          <p className="footnote">Signing in opens a separate workspace. Files already here stay here.</p>
          <button className="button primary" disabled={disabled}>{busy ? 'Working…' : mode === 'login' ? 'Sign in to account' : 'Create account'}</button>
        </form>
        {providers.length > 0 && <section className="account-providers" aria-labelledby="account-providers-title"><h3 id="account-providers-title">Other ways to sign in</h3><div className="account-provider-grid">{providers.map(provider => provider.available && (provider.id === 'google' || provider.id === 'apple') ? <ProviderSignIn key={provider.id} provider={provider.id} name={provider.name} disabled={disabled} onBusy={setBusy} onError={setError} onSuccess={next => { setSession(next); setBusy(false); setNotice('Signed in. Your workspace is ready.'); }} /> : <div className="account-provider" key={provider.id}><strong>{provider.name}</strong><span>Not available yet</span></div>)}</div><p>{providers.some(provider => provider.available) ? 'Provider sign-in opens only when you choose it. Your files are not part of the sign-in request. Provider accounts are separate from username accounts.' : 'Google and Apple sign-in are not configured. You can use your username and password today.'}</p></section>}
      </section>}
    </>}
    <p className="account-security-note"><LockKeyhole size={15} aria-hidden="true" /> Password fields are cleared after sign-in requests.</p>
  </section>;
}
