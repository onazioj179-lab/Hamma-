import { useState } from 'react';
import type { Job } from '../../processing/client';

const labels: Record<string, string> = {
  memory_limit: 'Memory limit', insufficient_storage: 'Insufficient storage',
  permission_denied: 'Permission denied', corrupt_file: 'Corrupt file',
  processing_timeout: 'Processing timeout', unsupported_format: 'Unsupported format',
  invalid_input: 'Invalid input', resource_limit: 'Resource limit', conversion_failure: 'Processing failure',
};

export function ErrorCenter({ jobs, busy, retry }: { jobs: Job[]; busy: boolean; retry: (jobs: Job[]) => void }) {
  const [dismissed, setDismissed] = useState('');
  const failures = jobs.filter(job => ['failed', 'interrupted'].includes(job.state));
  const signature = failures.map(job => `${job.id}:${job.finished}:${job.retryCount || 0}`).join('|');
  if (!failures.length || signature === dismissed) return null;
  const groups = new Map<string, Job[]>();
  for (const job of failures) {
    const category = job.errorInfo?.category || 'conversion_failure';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(job);
  }
  const retryable = failures.filter(job => job.errorInfo?.retryEligible !== false);
  return <aside className="project-summary error-center" aria-label="Processing errors">
    <strong>{failures.length} {failures.length === 1 ? 'job needs' : 'jobs need'} attention</strong>
    <ul>{[...groups].map(([category, rows]) => <li key={category}>{labels[category] || 'Processing failure'}: {rows.length}</li>)}</ul>
    <div className="button-row">
      <button className="button secondary" disabled={busy || !retryable.length} onClick={() => retry(retryable)}>Retry eligible jobs</button>
      <button className="text-button" onClick={() => setDismissed(signature)}>Dismiss errors</button>
    </div>
    <details><summary>View error details</summary><ul>{failures.map(job => <li key={job.id}>
      {job.name}: {job.error || 'Worker interrupted'}{job.errorInfo ? ` · ${job.errorInfo.stage} · ${job.errorInfo.retryEligible ? 'Retry available' : 'Change the input or settings before retrying'}` : ''}
    </li>)}</ul></details>
  </aside>;
}
