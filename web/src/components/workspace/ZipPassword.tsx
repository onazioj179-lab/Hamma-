import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { downloadBlob } from '../../utils/fileHelpers';

interface Props {
  unlock?: boolean;
  disabled?: boolean;
  filename: string;
  run: (password: string, signal: AbortSignal) => Promise<Blob>;
}

export function ZipPassword({ unlock, disabled, filename, run }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Blob | null>(null);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (disabled) {
      controller.current?.abort();
      if (input.current) input.current.value = '';
      setResult(null);
    }
  }, [disabled]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.current || disabled || controller.current) return;
    const password = input.current.value;
    input.current.value = '';
    const active = new AbortController();
    controller.current = active;
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const archive = await run(password, active.signal);
      if (!active.signal.aborted) setResult(archive);
    } catch (caught) {
      if (!active.signal.aborted) setError(caught instanceof Error ? caught.message : 'ZIP processing failed.');
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  function close() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setError('');
    setResult(null);
    setOpen(false);
  }

  return <div className="zip-inspection">
    <button type="button" className="button secondary" aria-controls={id} aria-expanded={open}
      disabled={disabled && !open} onClick={open ? close : () => setOpen(true)}>
      {open ? 'Close password options' : unlock ? 'Unlock ZIP' : 'Create password-protected ZIP'}
    </button>
    {open && <form id={id} className="zip-inspection" onSubmit={event => void submit(event)}>
      <p className="footnote">{unlock ? 'Unlocking creates a ZIP without password protection.' : 'The password protects file contents. File names are visible.'}</p>
      <div className="button-row">
        <label className="search-field"><input ref={input} type="password" required maxLength={1024}
          autoComplete={unlock ? 'off' : 'new-password'} aria-label="ZIP password" placeholder="ZIP password"
          disabled={disabled || busy} /></label>
        <button type="submit" className="button primary" disabled={disabled || busy}>{unlock ? 'Unlock' : 'Create encrypted ZIP'}</button>
        {busy && <button type="button" className="button secondary" onClick={() => controller.current?.abort()}>Cancel</button>}
      </div>
      {busy && <p role="status">{unlock ? 'Verifying ZIP…' : 'Creating and verifying ZIP…'}</p>}
      {error && <p role="alert">{error}</p>}
      {result && <button type="button" className="button secondary" disabled={disabled}
        onClick={() => downloadBlob(result, filename)}>Download {unlock ? 'unlocked' : 'encrypted'} ZIP</button>}
    </form>}
  </div>;
}
