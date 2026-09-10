import { describe, it, expect, beforeEach } from 'vitest';
import { useOperationLogStore } from '@/stores/operationLogStore';

/**
 * Tests for the operation log store — tracks every Git command executed
 * by the app (push, pull, commit, etc.) with timestamps + status.
 *
 * The StatusBar reads `runningIds` to show a progress spinner.
 * The CommandLogPanel reads `ops` to show the timestamped history.
 */
describe('operationLogStore', () => {
  beforeEach(() => {
    useOperationLogStore.getState().clearLog();
  });

  it('starts with an empty log', () => {
    const s = useOperationLogStore.getState();
    expect(s.ops).toEqual([]);
    expect(s.runningIds.size).toBe(0);
  });

  it('startOp creates a running entry and returns an ID', () => {
    const id = useOperationLogStore.getState().startOp('Push', '/repo', 'git push origin main');
    expect(id).toBeTruthy();

    const s = useOperationLogStore.getState();
    expect(s.ops.length).toBe(1);
    expect(s.ops[0].action).toBe('Push');
    expect(s.ops[0].status).toBe('running');
    expect(s.ops[0].command).toBe('git push origin main');
    expect(s.ops[0].repoPath).toBe('/repo');
    expect(s.runningIds.has(id)).toBe(true);
  });

  it('finishOp marks the operation as succeeded with duration', () => {
    const { startOp, finishOp } = useOperationLogStore.getState();
    const id = startOp('Pull', '/repo', 'git pull');
    expect(useOperationLogStore.getState().runningIds.has(id)).toBe(true);

    finishOp(id, '3 files changed');

    const s = useOperationLogStore.getState();
    expect(s.ops[0].status).toBe('success');
    expect(s.ops[0].duration).toBeGreaterThanOrEqual(0);
    expect(s.ops[0].result).toBe('3 files changed');
    expect(s.runningIds.has(id)).toBe(false);
  });

  it('failOp marks the operation as failed with error message', () => {
    const { startOp, failOp } = useOperationLogStore.getState();
    const id = startOp('Commit', '/repo', 'git commit -m "..."');

    failOp(id, 'fatal: not a git repository');

    const s = useOperationLogStore.getState();
    expect(s.ops[0].status).toBe('error');
    expect(s.ops[0].error).toBe('fatal: not a git repository');
    expect(s.runningIds.has(id)).toBe(false);
  });

  it('newest ops appear first (newest-first ordering)', () => {
    const { startOp, finishOp } = useOperationLogStore.getState();
    const id1 = startOp('Push', '/repo');
    finishOp(id1);
    const id2 = startOp('Pull', '/repo');
    finishOp(id2);

    const s = useOperationLogStore.getState();
    expect(s.ops[0].action).toBe('Pull'); // newest first
    expect(s.ops[1].action).toBe('Push');
  });

  it('supports multiple concurrent running operations', () => {
    const { startOp } = useOperationLogStore.getState();
    const id1 = startOp('Fetch', '/repo', 'git fetch');
    const id2 = startOp('Push', '/repo', 'git push');

    const s = useOperationLogStore.getState();
    expect(s.runningIds.size).toBe(2);
    expect(s.runningIds.has(id1)).toBe(true);
    expect(s.runningIds.has(id2)).toBe(true);
  });

  it('clearLog resets everything', () => {
    const { startOp, finishOp, clearLog } = useOperationLogStore.getState();
    const id = startOp('Push', '/repo');
    finishOp(id);

    clearLog();

    const s = useOperationLogStore.getState();
    expect(s.ops).toEqual([]);
    expect(s.runningIds.size).toBe(0);
  });

  it('prunes entries beyond 100 (keeps newest 100)', () => {
    const { startOp, finishOp } = useOperationLogStore.getState();
    // Create 105 operations
    for (let i = 0; i < 105; i++) {
      const id = startOp(`Op ${i}`, '/repo');
      finishOp(id);
    }

    const s = useOperationLogStore.getState();
    expect(s.ops.length).toBe(100);
    // The newest 100 should be kept (Op 104 is newest, Op 5 is oldest kept)
    expect(s.ops[0].action).toBe('Op 104');
    expect(s.ops[99].action).toBe('Op 5');
  });
});
