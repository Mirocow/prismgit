import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCommandLogStore } from '../../src/stores/commandLogStore';
import type { CommandLogEntry } from '../../src/lib/api';

// Mock the API to avoid main-process IPC during tests.
vi.mock('../../src/lib/api', () => ({
  api: {
    commandLog: { list: vi.fn().mockResolvedValue([]), clear: vi.fn().mockResolvedValue(undefined) },
  },
}));

const SUCCESS_ENTRY: CommandLogEntry = {
  args: ['status'],
  exitCode: 0,
  stdout: '',
  stderr: '',
  timestamp: Date.now(),
  durationMs: 10,
};

const FAILURE_ENTRY: CommandLogEntry = {
  ...SUCCESS_ENTRY,
  args: ['push', 'no-such-remote'],
  exitCode: 1,
  stderr: 'fatal: remote not found',
};

describe('QW-5 commandLogStore snooze', () => {
  beforeEach(() => {
    useCommandLogStore.setState({
      entries: [],
      errorPulse: 0,
      lastManualCloseAt: 0,
    });
  });

  it('starts with lastManualCloseAt = 0 (never closed)', () => {
    expect(useCommandLogStore.getState().lastManualCloseAt).toBe(0);
  });

  it('markManualClose sets lastManualCloseAt to ~now', () => {
    const before = Date.now();
    useCommandLogStore.getState().markManualClose();
    const after = Date.now();
    const ts = useCommandLogStore.getState().lastManualCloseAt;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('a successful append does NOT bump errorPulse', () => {
    useCommandLogStore.getState().append(SUCCESS_ENTRY);
    expect(useCommandLogStore.getState().errorPulse).toBe(0);
  });

  it('a failed append DOES bump errorPulse', () => {
    useCommandLogStore.getState().append(FAILURE_ENTRY);
    expect(useCommandLogStore.getState().errorPulse).toBe(1);
  });

  it('a second failed append bumps errorPulse again (no dedup)', () => {
    useCommandLogStore.getState().append(FAILURE_ENTRY);
    useCommandLogStore.getState().append(FAILURE_ENTRY);
    expect(useCommandLogStore.getState().errorPulse).toBe(2);
  });

  it('markManualClose can be called repeatedly (latest wins)', () => {
    useCommandLogStore.getState().markManualClose();
    const first = useCommandLogStore.getState().lastManualCloseAt;
    // Spin until Date.now() ticks forward (rare on fast CI).
    let n = 0;
    while (Date.now() === first && n < 1000) n++;
    useCommandLogStore.getState().markManualClose();
    expect(useCommandLogStore.getState().lastManualCloseAt).toBeGreaterThanOrEqual(first);
  });

  it('the 30s snooze window is respected by the App.tsx-style check', () => {
    // Simulate: user closes panel now.
    useCommandLogStore.getState().markManualClose();
    // Within 30s, a new error arrives.
    useCommandLogStore.getState().append(FAILURE_ENTRY);
    const sinceClose = Date.now() - useCommandLogStore.getState().lastManualCloseAt;
    expect(sinceClose).toBeLessThan(30_000); // App.tsx would SUPPRESS the auto-open.
  });

  it('after 30s+, the auto-open would fire again', () => {
    useCommandLogStore.setState({ lastManualCloseAt: Date.now() - 31_000 });
    useCommandLogStore.getState().append(FAILURE_ENTRY);
    const sinceClose = Date.now() - useCommandLogStore.getState().lastManualCloseAt;
    expect(sinceClose).toBeGreaterThanOrEqual(30_000); // App.tsx would OPEN the panel.
  });
});
