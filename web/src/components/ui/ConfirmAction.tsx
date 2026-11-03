import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './ConfirmAction.css';

export interface ConfirmationRequest {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

/** Destructive actions start with Cancel focused and cannot submit twice. */
export function ConfirmAction({ title, description, confirmLabel, onConfirm, onCancel }: ConfirmationRequest & { onCancel: () => void }) {
  const id = useId();
  const layer = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  const cancelAction = useRef(onCancel);
  cancelAction.current = onCancel;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== layer.current);
    const state = background.map(element => ({ element, inert: element.hasAttribute('inert'), hidden: element.getAttribute('aria-hidden') }));
    for (const { element } of state) { element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true'); }
    cancel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['o', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!running.current) cancelAction.current();
      } else if (event.key === 'Tab') {
        const controls = Array.from(layer.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); layer.current?.querySelector<HTMLElement>('[role=alertdialog]')?.focus(); }
        else if (!layer.current?.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault(); first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      mounted.current = false;
      document.removeEventListener('keydown', key, true);
      for (const { element, inert, hidden } of state) {
        if (!inert) element.removeAttribute('inert');
        if (hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', hidden);
      }
      if (previous?.isConnected && !(previous as HTMLButtonElement).disabled) previous.focus();
      else document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
    };
  }, []);

  const confirm = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await onConfirm(); cancelAction.current(); }
    catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'The action could not finish.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };

  return createPortal(<div className="shante-confirm-layer" ref={layer} tabIndex={-1} onKeyDown={event => event.stopPropagation()}>
    <section className="shante-confirm" role="alertdialog" tabIndex={-1} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div id={`${id}-description`} className="shante-confirm-description">{description}</div>
      {error && <p role="alert">{error}</p>}
      <div className="shante-confirm-actions">
        <button type="button" ref={cancel} className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="button primary" disabled={busy} onClick={() => void confirm()}>{busy ? 'Working…' : confirmLabel}</button>
      </div>
    </section>
  </div>, document.body);
}
