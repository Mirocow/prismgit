/**
 * Auto refresh gate for the repository-list remote polling.
 *
 * useRemotePolling must:
 *  - run the initial check + schedule the timer when autoRefresh is on
 *    (the default);
 *  - do NOTHING when Settings → "Auto refresh" is off (no initial check,
 *    no timer) — the sidebar "Check now" button stays the only trigger;
 *  - start/stop live when the setting is toggled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../src/lib/api', () => ({
  api: {
    settings: {
      getAll: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
    git: {
      pollRemoteSummaries: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { useRepositoryStore } from '../../src/stores/repositoryStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { useRemotePolling } from '../../src/hooks/useRemotePolling';

const checkRemotes = vi.fn().mockResolvedValue(undefined);
// Replace the store action — the hook calls useRepositoryStore.getState().checkRemotes.
useRepositoryStore.setState({ checkRemotes } as unknown as Partial<ReturnType<typeof useRepositoryStore.getState>>);

describe('useRemotePolling — Auto refresh gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useRepositoryStore.setState({ repos: [{ path: '/repo/a', name: 'a', lastOpened: 1 }], currentRepo: null, loading: false, error: null });
    useSettingsStore.setState({ settings: {}, theme: 'dark', loading: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('performs the initial check by default (autoRefresh defaults to on)', () => {
    renderHook(() => useRemotePolling());
    expect(checkRemotes).toHaveBeenCalledTimes(1);
    expect(checkRemotes).toHaveBeenCalledWith(['/repo/a']);
  });

  it('does NOT check when Auto refresh is off', () => {
    act(() => {
      useSettingsStore.setState({ settings: { autoRefresh: false }, theme: 'dark', loading: false });
    });
    renderHook(() => useRemotePolling());
    expect(checkRemotes).not.toHaveBeenCalled();
    // And no timer fires later either
    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });
    expect(checkRemotes).not.toHaveBeenCalled();
  });

  it('starts polling when Auto refresh is switched on, stops when switched off', () => {
    act(() => {
      useSettingsStore.setState({ settings: { autoRefresh: false, repoRemoteCheckIntervalSec: 30 }, theme: 'dark', loading: false });
    });
    const { rerender } = renderHook(() => useRemotePolling());
    expect(checkRemotes).not.toHaveBeenCalled();

    // Toggle ON (Settings checkbox) — the hook re-subscribes and checks
    act(() => {
      useSettingsStore.setState({ settings: { autoRefresh: true, repoRemoteCheckIntervalSec: 30 }, theme: 'dark', loading: false });
    });
    rerender();
    expect(checkRemotes).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(30 * 1000); });
    expect(checkRemotes).toHaveBeenCalledTimes(2);

    // Toggle OFF — the pending timer must be cancelled
    act(() => {
      useSettingsStore.setState({ settings: { autoRefresh: false, repoRemoteCheckIntervalSec: 30 }, theme: 'dark', loading: false });
    });
    rerender();
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(checkRemotes).toHaveBeenCalledTimes(2);
  });
});
