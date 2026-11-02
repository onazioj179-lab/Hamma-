import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApplicationCache, usePreferences } from '../store/preferences';
import { useAppStore } from '../store/app';

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
  });
});
beforeEach(() => {
  usePreferences.getState().setPrivacyChoice('essential');
  usePreferences.getState().setRememberHistory(true);
  useAppStore.getState().clearRecentArchives();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local privacy controls', () => {
  it('retains no learning measurements without opt-in and clears them on opt-out', () => {
    usePreferences.getState().recordOutcome(100, 50, 10);
    expect(usePreferences.getState().learning.samples).toBe(0);
    usePreferences.getState().setPrivacyChoice('learning');
    usePreferences.getState().recordOutcome(100, 50, 10);
    expect(usePreferences.getState().learning).toEqual({
      samples: 1,
      inputBytes: 100,
      outputBytes: 50,
      durationMs: 10,
    });
    usePreferences.getState().setPrivacyChoice('essential');
    expect(usePreferences.getState().learning).toEqual({
      samples: 0,
      inputBytes: 0,
      outputBytes: 0,
      durationMs: 0,
    });
  });
  it('bounds observations and rejects invalid measurements', () => {
    usePreferences.getState().setPrivacyChoice('learning');
    for (let i = 0; i < 150; i++)
      usePreferences.getState().recordOutcome(100, 50, 10);
    const before = usePreferences.getState().learning;
    expect(before.samples).toBe(100);
    for (const values of [
      [NaN, 1, 1],
      [1, -1, 1],
      [1, 1, 0],
      [Infinity, 1, 1],
    ]) {
      usePreferences.getState().recordOutcome(values[0], values[1], values[2]);
    }
    expect(usePreferences.getState().learning).toEqual(before);
    expect(Object.keys(before)).toEqual([
      'samples',
      'inputBytes',
      'outputBytes',
      'durationMs',
    ]);
  });
  it('stops new history records while preserving the current result', () => {
    usePreferences.getState().setRememberHistory(false);
    useAppStore
      .getState()
      .addRecentArchive({
        fileName: 'private.txt',
        originalSize: 10,
        compressedSize: 5,
        ratio: 0.5,
        type: 'compress',
        mode: 'auto',
      });
    expect(useAppStore.getState().recentArchives).toEqual([]);
    usePreferences.getState().setRememberHistory(true);
    useAppStore
      .getState()
      .addRecentArchive({
        fileName: 'recorded.txt',
        originalSize: 10,
        compressedSize: 5,
        ratio: 0.5,
        type: 'compress',
        mode: 'auto',
      });
    expect(useAppStore.getState().recentArchives[0].fileName).toBe(
      'recorded.txt',
    );
  });
  it('clears only application-owned Cache Storage entries', async () => {
    const remove = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: async () => [
        'hamma-assets-v1',
        'spk:preview',
        'other-project-v1',
        'hamma-lookalike',
      ],
      delete: remove,
    });
    expect(await clearApplicationCache()).toBe(3);
    expect(remove.mock.calls.map((call) => call[0])).toEqual([
      'hamma-assets-v1',
      'spk:preview',
      'hamma-lookalike',
    ]);
    expect(remove).not.toHaveBeenCalledWith('other-project-v1');
  });
  it('handles browsers without Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    // Access can be disabled by the browser or absent entirely.
    expect(await clearApplicationCache()).toBe(0);
  });
});
