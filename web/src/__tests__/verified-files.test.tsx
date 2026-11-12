import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { VerifiedFiles } from '../components/workspace/VerifiedFiles';

it('loads bounded manifest pages on demand and stops at an exact page boundary', async () => {
  const fetch = vi.fn(async (url: string) => {
    const after = Number(new URL(url, 'http://localhost').searchParams.get('after'));
    return { ok: true, status: 200, json: async () => ({
      total: 100, nextCursor: String(after + 50),
      files: Array.from({ length: 50 }, (_, index) => ({
        id: after + index + 1, name: `file-${after + index + 1}.txt`, directory: 0, size: 1,
      })),
    }) };
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<VerifiedFiles jobId={'a'.repeat(32)} />));
    expect(fetch).not.toHaveBeenCalled();
    const details = host.querySelector('details')!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true })); });
    expect(fetch.mock.calls[0][0]).toContain('limit=50&after=0');
    expect(host.textContent).toContain('1–50 of 100');
    const next = () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Next files')!;
    await act(async () => next().click());
    expect(fetch.mock.calls[1][0]).toContain('limit=50&after=50');
    expect(host.textContent).toContain('51–100 of 100');
    expect(host.querySelectorAll('li')).toHaveLength(50);
    expect(next().disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
