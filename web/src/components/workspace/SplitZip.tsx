import { useEffect, useRef, useState } from 'react';
import { downloadBlob } from '../../utils/fileHelpers';
import type { Source } from '../../processing/client';
import { SelectField } from '../ui/SelectField';

export function SplitZip({ sources, disabled }: { sources: Source[]; disabled: boolean }) {
  const joining = sources.some(source => /\.z\d{2,3}$/i.test(source.name));
  const total = sources.reduce((sum, source) => sum + source.size, 0);
  const sizes = [1, 8, 32].filter(size => size * 1048576 < total);
  const [volume, setVolume] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloads, setDownloads] = useState<{ blob: Blob; name: string }[]>([]);
  const task = useRef<AbortController | null>(null);
  useEffect(() => () => task.current?.abort(), []);
  if (!joining && (!sizes.length || total > 128 * 1048576 || sources.length > 1000)) return null;
  const chosenSize = sizes.includes(volume) ? volume : sizes[0];

  async function run() {
    if (task.current || disabled) return;
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setError('');
    setDownloads([]);
    try {
      const { createSplitZip, joinSplitZip } = await import('../../processing/split-zip');
      const result = joining
        ? [{ blob: await joinSplitZip(sources.map(source => source.file!), controller.signal), name: 'joined.zip' }]
        : await createSplitZip(sources, chosenSize, controller.signal);
      if (!controller.signal.aborted) setDownloads(result);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Could not process the ZIP volumes.');
    } finally {
      task.current = null;
      setBusy(false);
    }
  }

  return <details className="processing-options" onToggle={event => {
    if (!event.currentTarget.open) {
      task.current?.abort();
      setDownloads([]);
      setError('');
    }
  }}>
    <summary>{joining ? 'Join split ZIP volumes' : 'Create split ZIP volumes'}</summary>
    <p className="footnote">{joining ? 'Select every numbered volume and the final .zip.'
      : 'Download each volume and keep the set together.'}</p>
    <div className="button-row">
      {!joining && <label className="conversion-select">ZIP volume size
        <SelectField aria-label="ZIP volume size" value={String(chosenSize)} onChange={value => setVolume(Number(value))} disabled={disabled || busy}>
          {sizes.map(size => <option key={size} value={String(size)}>{size} MiB</option>)}
        </SelectField>
      </label>}
      <button type="button" className="button secondary" disabled={disabled || busy} onClick={() => void run()}>
        {joining ? 'Join volumes' : 'Create volumes'}
      </button>
      {busy && <button type="button" className="button secondary" onClick={() => task.current?.abort()}>Cancel</button>}
    </div>
    {busy && <p role="status" className="footnote">Checking ZIP volumes…</p>}
    {error && <p role="alert" className="footnote">{error}</p>}
    {!!downloads.length && <ul className="zip-inspection-list">
      {downloads.map(({ blob, name }) => <li key={name}>
        <button type="button" className="text-button" onClick={() => downloadBlob(blob, name)}>Download {name}</button>
      </li>)}
    </ul>}
  </details>;
}
