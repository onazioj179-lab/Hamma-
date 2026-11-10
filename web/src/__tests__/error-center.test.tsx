import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ErrorCenter } from '../components/workspace/ErrorCenter';
import type { Job } from '../processing/client';

it('groups errors, retries eligible jobs only, and reappears for a new failure', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  const retry = vi.fn();
  const job = (id: string, eligible: boolean) => ({ id, name: id, state: 'failed', finished: 1,
    errorInfo: { category: 'corrupt_file', retryEligible: eligible, stage: 'processing', jobId: id, fileIds: [id] } }) as Job;
  const jobs = [job('one', false), job('two', true)];
  try {
    await act(async () => root.render(<ErrorCenter jobs={jobs} busy={false} retry={retry} />));
    expect(host.textContent).toContain('Corrupt file: 2');
    await act(async () => host.querySelector('button')!.click());
    expect(retry).toHaveBeenCalledWith([jobs[1]]);
    await act(async () => host.querySelectorAll('button')[1].click());
    expect(host.textContent).toBe('');
    await act(async () => root.render(<ErrorCenter jobs={[...jobs, job('three', false)]} busy={false} retry={retry} />));
    expect(host.textContent).toContain('3 jobs need attention');
  } finally { await act(async () => root.unmount()); }
});
