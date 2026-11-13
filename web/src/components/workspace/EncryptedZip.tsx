import { useEffect, useRef, useState, type FormEvent } from 'react';
import { downloadBlob } from '../../utils/fileHelpers';
import type { Source } from '../../processing/client';
import { inspectZip } from '../../processing/zip-inspection';

type Props = { sources?: Source[]; archive?: File; disabled?: boolean };

export function UnlockZip({ archive, disabled }: { archive: File; disabled?: boolean }) {
  const [encrypted, setEncrypted] = useState<File>();
  useEffect(() => {
    let current = true;
    void inspectZip(archive).then(directory => {
      if (current) setEncrypted(directory.members.some(member => member.encrypted) ? archive : undefined);
    }).catch(() => {});
    return () => { current = false; };
  }, [archive]);
  return encrypted === archive ? <EncryptedZip archive={archive} disabled={disabled} /> : null;
}

export function EncryptedZip({ sources, archive, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; name: string }>();
  const password = useRef<HTMLInputElement>(null);
  const task = useRef<AbortController | null>(null);
  useEffect(() => () => task.current?.abort(), []);
  const action = archive ? 'Unlock ZIP' : 'Create password-protected ZIP';

  async function run(event: FormEvent) {
    event.preventDefault();
    const secret = password.current?.value;
    if (!secret || disabled || task.current) return;
    password.current!.value = '';
    setError('');
    setResult(undefined);
    setBusy(true);
    const controller = new AbortController();
    task.current = controller;
    try {
      const { createEncryptedZip, unlockEncryptedZip } = await import('../../processing/encrypted-zip');
      controller.signal.throwIfAborted();
      const blob = archive ? await unlockEncryptedZip(archive, secret, controller.signal)
        : await createEncryptedZip(sources ?? [], secret, controller.signal);
      if (!controller.signal.aborted) setResult({ blob, name: archive
        ? archive.name.replace(/\.zip$/i, '') + '.unlocked.zip' : 'protected.zip' });
    } catch {
      if (!controller.signal.aborted) setError(archive
        ? 'Could not unlock this ZIP. Check the password and use a supported AES ZIP.'
        : 'Could not create the encrypted ZIP. Check the file names and selection size.');
    } finally {
      if (task.current === controller) {
        task.current = null;
        setBusy(false);
      }
    }
  }

  return <details className="processing-options encrypted-zip" onToggle={event => {
    setOpen(event.currentTarget.open);
    if (!event.currentTarget.open) {
      if (password.current) password.current.value = '';
      task.current?.abort();
      setError('');
      setResult(undefined);
    }
  }}>
    <summary>{action}</summary>
    {open && <form onSubmit={event => void run(event)}>
      <p className="footnote">{archive
        ? 'Downloads a new ZIP with the unlocked files. The password stays in this browser.'
        : 'AES-256 protects file contents. File names stay visible. The password stays in this browser.'}</p>
      <label className="search-field">
        <input ref={password} type="password" aria-label="ZIP password" placeholder="ZIP password"
          autoComplete="off" required maxLength={256} disabled={disabled || busy} />
      </label>
      <div className="button-row">
        <button className="button secondary" type="submit" disabled={disabled || busy}>{archive ? 'Unlock' : 'Create ZIP'}</button>
        {busy && <button className="button secondary" type="button" onClick={() => task.current?.abort()}>Cancel</button>}
        {result && <button className="button primary" type="button" onClick={() => downloadBlob(result.blob, result.name)}>Download ZIP</button>}
      </div>
      {busy && <p role="status" className="footnote">{archive ? 'Unlocking ZIP…' : 'Creating and checking ZIP…'}</p>}
      {error && <p role="alert" className="footnote">{error}</p>}
    </form>}
  </details>;
}
