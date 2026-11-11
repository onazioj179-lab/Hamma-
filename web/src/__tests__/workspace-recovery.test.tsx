import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkspaceRecovery } from '../components/workspace/WorkspaceRecovery';

it('reopens after a transient render failure and only offers manual recovery after a repeat', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers();
  let fail = true;
  function Workspace() {
    if (fail) throw new Error('render failed');
    return <span>Saved jobs</span>;
  }
  const render = () => root.render(<WorkspaceRecovery><Workspace /></WorkspaceRecovery>);
  try {
    await act(async () => render());
    expect(host.textContent).toBe('');
    fail = false;
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(host.textContent).toBe('Saved jobs');
    fail = true;
    await act(async () => render());
    expect(host.textContent).toContain('Workspace unavailable');
    expect(vi.getTimerCount()).toBe(0);
    fail = false;
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toBe('Saved jobs');
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    logger.mockRestore();
  }
});
