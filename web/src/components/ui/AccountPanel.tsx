import { useEffect, useRef, useState, type FormEvent } from 'react';
import { changeAccount, loadAccount, type AccountSession } from '../../processing/account';
import './AccountPanel.css';

const bytes = (value: number) => `${(value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;
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
      if (mounted.current) { setSession(next); setNotice(action === 'password-change' ? 'Password changed. Other sessions have been signed out.' : action === 'logout' ? 'Signed out. Your guest workspace is restored.' : 'Signed in. Your account workspace is ready.'); }
    } catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : 'Account request failed.'); setAttempt(value => value + 1); } }
    finally { form.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input => { input.value = ''; }); running.current = false; if (mounted.current) setBusy(false); }
  }
  const disabled = busy || !session?.credentialsAllowed;
  return <section className="account-panel" aria-labelledby="account-title">
    <header><h1 id="account-title">Account</h1><p>Use HAMMA as a guest, or create a Free account on this processor.</p></header>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!session ? <div><p>{error ? 'Account details could not be loaded.' : 'Loading account details…'}</p>{error && <button className="button secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button>}</div> : <>
      <section className="account-card" aria-labelledby="plan-title"><h2 id="plan-title">{session.plan.tier === 'free' ? 'Free account' : 'Guest workspace'}</h2>
        {session.account && <p><strong>{session.account.displayName}</strong> · {session.account.username}</p>}
        <dl className="account-limits">{[
          ['History records', session.plan.historyRecords.toLocaleString()], ['Queued jobs', session.plan.maxQueuedJobs.toLocaleString()],
          ['Concurrent jobs', session.plan.maxConcurrentJobs.toLocaleString()], ['Retained input files', session.plan.maxUploadFiles.toLocaleString()],
          ['Input limit', bytes(session.plan.maxInputBytes)], ['Storage limit', bytes(session.plan.maxStorageBytes)],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>These limits are enforced by this processor. Billing is unavailable.</p>
      </section>
      <p>Guest and account jobs stay separate; signing in does not move guest files. Signing out restores this browser’s guest workspace. SPK files and browser history remain separate, on this browser.</p>
      {!session.credentialsAllowed && <p role="status">Use HTTPS or connect from the processor computer to sign in or change a password.</p>}
      {session.authenticated ? <>
        <form onSubmit={event => void submit(event, 'logout')}><button className="button secondary" disabled={busy}>Sign out</button></form>
        <form className="account-card account-form" onSubmit={event => void submit(event, 'password-change')}><h2>Change password</h2>
          <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} disabled={disabled} /></label>
          <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={disabled} /></label>
          <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={disabled} /></label>
          <p>Use at least 12 characters. Changing your password signs out all other sessions.</p><button className="button primary" disabled={disabled}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      </> : <section className="account-card"><div className="button-row"><button className="button secondary" aria-pressed={mode === 'login'} disabled={busy} onClick={() => { setMode('login'); setError(''); }}>Sign in</button><button className="button secondary" aria-pressed={mode === 'register'} disabled={busy} onClick={() => { setMode('register'); setError(''); }}>Create account</button></div>
        <form key={mode} className="account-form" onSubmit={event => void submit(event, mode)}><h2>{mode === 'login' ? 'Sign in' : 'Create a Free account'}</h2>
          <label>Username<input name="username" autoComplete="username" minLength={3} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" required disabled={disabled} /></label>
          {mode === 'register' && <label>Display name (optional)<input name="displayName" autoComplete="nickname" maxLength={80} disabled={disabled} /></label>}
          <label>Password<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 12 : undefined} maxLength={256} required disabled={disabled} /></label>
          {mode === 'register' && <><label>Confirm password<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={disabled} /></label><p>Username: 3–64 letters, numbers, dots, underscores or hyphens. Password: at least 12 characters.</p></>}
          <button className="button primary" disabled={disabled}>{busy ? 'Working…' : mode === 'login' ? 'Sign in to account' : 'Create Free account'}</button>
        </form>
      </section>}
    </>}
  </section>;
}
