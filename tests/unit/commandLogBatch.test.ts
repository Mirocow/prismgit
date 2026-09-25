/**
 * commandLogStore.appendBatch — the 100 ms batch append that replaced the
 * per-entry append (N back-to-back set()s, each copying the 500-entry array,
 * froze the renderer during a "Check all repositories" burst).
 *
 * Pinned here: ONE state update per batch (subscriber notified once), the
 * batch lands newest-first on top of existing entries, the 500-entry cap,
 * errorPulse bumps ONCE per batch (only when an entry failed), and the
 * legacy per-entry append keeps its semantics.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCommandLogStore } from '../../src/stores/commandLogStore';
import type { CommandLogEntry } from '../../src/lib/api';

const entry = (id: number, exitCode: number | null = 0): CommandLogEntry => ({
  id,
  timestamp: id,
  repo: '/repo',
  args: ['status'],
  exitCode,
  signal: null,
  durationMs: 5,
  stdout: '',
  stderr: '',
});

let listenerCalls: number;
const trackListener = () => {
  listenerCalls = 0;
  return useCommandLogStore.subscribe(() => { listenerCalls++; });
};

beforeEach(() => {
  vi.resetModules();
  useCommandLogStore.setState({ entries: [], errorPulse: 0, lastManualCloseAt: 0 });
});

describe('appendBatch', () => {
  it('one batch = ONE store update (one subscriber notification)', () => {
    const unsub = trackListener();
    useCommandLogStore.getState().appendBatch([entry(1), entry(2), entry(3)]);
    expect(listenerCalls).toBe(1);
    unsub();
  });

  it('batch arrives oldest→newest and lands newest-first', () => {
    useCommandLogStore.getState().appendBatch([entry(1), entry(2), entry(3)]);
    const entries = useCommandLogStore.getState().entries;
    expect(entries.map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it('prepends on top of existing entries without mutating the old array', () => {
    useCommandLogStore.getState().appendBatch([entry(1)]);
    const before = useCommandLogStore.getState().entries;
    useCommandLogStore.getState().appendBatch([entry(2), entry(3)]);
    const after = useCommandLogStore.getState().entries;
    expect(after.map((e) => e.id)).toEqual([3, 2, 1]);
    expect(before.map((e) => e.id)).toEqual([1]); // previous snapshot untouched
  });

  it('caps at 500 entries', () => {
    const bigBatch = Array.from({ length: 600 }, (_, i) => entry(i + 1));
    useCommandLogStore.getState().appendBatch(bigBatch);
    expect(useCommandLogStore.getState().entries.length).toBe(500);
    // Newest survive: the last id of the batch is on top.
    expect(useCommandLogStore.getState().entries[0]?.id).toBe(600);
  });

  it('bumps errorPulse ONCE per batch when any entry failed (not per entry)', () => {
    const unsub = trackListener();
    const before = useCommandLogStore.getState().errorPulse;
    useCommandLogStore.getState().appendBatch([entry(1, 0), entry(2, 128), entry(3, 1)]);
    expect(useCommandLogStore.getState().errorPulse).toBe(before + 1);
    expect(listenerCalls).toBe(1);
    unsub();
  });

  it('does NOT bump errorPulse for a successful batch', () => {
    const before = useCommandLogStore.getState().errorPulse;
    useCommandLogStore.getState().appendBatch([entry(1), entry(2)]);
    expect(useCommandLogStore.getState().errorPulse).toBe(before);
  });

  it('ignores empty / non-array payloads', () => {
    const unsub = trackListener();
    useCommandLogStore.getState().appendBatch([]);
    useCommandLogStore.getState().appendBatch(undefined as unknown as CommandLogEntry[]);
    expect(listenerCalls).toBe(0);
    expect(useCommandLogStore.getState().entries).toEqual([]);
    unsub();
  });
});

describe('append (legacy per-entry) keeps its semantics', () => {
  it('still bumps errorPulse per failed entry', () => {
    const before = useCommandLogStore.getState().errorPulse;
    useCommandLogStore.getState().append(entry(1, 128));
    expect(useCommandLogStore.getState().errorPulse).toBe(before + 1);
    expect(useCommandLogStore.getState().entries[0]?.id).toBe(1);
  });
});
