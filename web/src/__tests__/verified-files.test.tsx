import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { VerifiedFiles } from '../components/workspace/VerifiedFiles';

it('loads bounded manifest pages on demand and stops at an exact page boundary', async () => {
  let failNextPage = true;
  const fetch = vi.fn(async (url: string) => {
    const after = Number(new URL(url, 'http://localhost').searchParams.get('after'));
    if (after === 50 && failNextPage) {
      failNextPage = false;
      throw new Error('Connection lost');
    }
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
    next().focus();
    await act(async () => next().click());
    expect(document.activeElement).toBe(next());
    expect(fetch.mock.calls[1][0]).toContain('limit=50&after=50');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Connection lost');
    const previous = [...host.querySelectorAll('button')].find(button => button.textContent === 'Previous files')!;
    expect(previous.getAttribute('aria-disabled')).toBe('false');
    await act(async () => previous.click());
    expect(host.textContent).toContain('1–50 of 100');
    await act(async () => next().click());
    expect(host.textContent).toContain('51–100 of 100');
    expect(host.querySelectorAll('li')).toHaveLength(50);
    expect(next().getAttribute('aria-disabled')).toBe('true');
    await act(async () => next().click());
    expect(fetch).toHaveBeenCalledTimes(4);
    await act(async () => previous.click());
    expect(host.textContent).toContain('1–50 of 100');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
