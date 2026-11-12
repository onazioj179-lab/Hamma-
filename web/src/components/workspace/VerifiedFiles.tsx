import { useEffect, useState } from 'react';
import { request } from '../../processing/client';

const pageSize = 50;

interface ManifestPage {
  files: { id: number; name: string; directory: number; size: number }[];
  total: number;
  nextCursor: string | null;
}

export function VerifiedFiles({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState(['0']);
  const [loaded, setLoaded] = useState<{ cursor: string; data: ManifestPage } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const cursor = cursors[cursors.length - 1];
  const page = loaded?.cursor === cursor ? loaded.data : null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoaded(null);
    setError('');
    void request<ManifestPage>(`/jobs/${jobId}/manifest?limit=${pageSize}&after=${cursor}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setLoaded({ cursor, data: result }); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Could not load verified files.'); });
    return () => controller.abort();
  }, [jobId, open, cursor, attempt]);

  const offset = (cursors.length - 1) * pageSize;
  return <details className="job-details verified-files" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Verified files</summary>
    {open && (error ? <p role="alert">{error} <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>
      : page ? <>
        <ul>{page.files.map(file => <li key={file.id}>{file.name}{file.directory ? '/' : ` · ${file.size.toLocaleString()} bytes`}</li>)}</ul>
        <div className="button-row">
          <button className="text-button" disabled={cursors.length === 1} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous files</button>
          <span role="status">{page.files.length ? `${(offset + 1).toLocaleString()}–${(offset + page.files.length).toLocaleString()} of ${page.total.toLocaleString()}` : 'No files'}</span>
          <button className="text-button" disabled={!page.nextCursor || offset + page.files.length >= page.total}
            onClick={() => { const next = page.nextCursor; if (next) setCursors(previous => previous[previous.length - 1] === cursor ? [...previous, next] : previous); }}>Next files</button>
        </div>
      </> : <p role="status">Loading verified files…</p>)}
  </details>;
}
