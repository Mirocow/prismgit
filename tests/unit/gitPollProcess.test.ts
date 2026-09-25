/**
 * gitPollProcess — the main-side manager of the DEDICATED git-poll
 * utilityProcess ("фетч статусов в отдельном процессе").
 *
 * Pins:
 *  - non-Electron hosts (vitest) run the job IN-PROCESS (the pre-split
 *    behavior — this is what keeps every existing poll suite valid);
 *  - inside the Electron main process the job is forwarded to the forked
 *    worker: buffered until 'ready', request matches the PollJobRequest,
 *    a 'poll-result' answer resolves the caller;
 *  - a crashed worker falls back to the in-process run (the caller never
 *    sees a failure) and the next job reforks;
 *  - a crash storm (3 unexpected exits / 5 min) puts the manager in a
 *    60 s cooldown — no fork per poll tick on a machine where the worker
 *    cannot start;
 *  - disposeGitPollWorker kills the process (app-quit hook).
 *
 * 'electron' is mocked with a fake utilityProcess.fork() that returns an
 * EventEmitter-based fake UtilityProcess; process.type is flipped to
 * 'browser' per test to simulate the Electron main process.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../../electron/services/gitPollCore.js', () => {
  const runPollJob = vi.fn(
    async (req: { repoPath: string }) =>
      ({
        fetched: false,
        error: null,
        branch: 'direct-branch',
        incoming: 11,
        outgoing: 22,
        dirty: 33,
      }) as const
  );
  return { runPollJob, DEFAULT_REMOTE_FETCH_TIMEOUT_MS: 60_000 };
});

vi.mock('../../electron/services/gitStatusCore.js', () => {
  const runStatusJob = vi.fn(
    async (req: { repoPath: string }) =>
      ({
        current: 'direct-status-branch',
        files: [],
        not_added: [],
        conflicted: [],
        created: [],
        deleted: [],
        modified: [],
        renamed: [],
        staged: [],
        ahead: 0,
        behind: 0,
        isClean: true,
        isMerging: false,
        isRebasing: false,
        isCherryPicking: false,
        isReverting: false,
        isBisecting: false,
        detached: false,
        // repoPath in the answer proves WHICH request produced it
        head: `direct:${req.repoPath}`,
      }) as const
  );
  return { runStatusJob, resolveHeadSha: vi.fn(), detectRepoStateFromGitDir: vi.fn(() => ({})) };
});

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events');

  class FakeUtilityProcess extends EE {
    posted: unknown[] = [];
    killed = false;
    postMessage(message: unknown): void {
      this.posted.push(message);
    }
    kill(): void {
      this.killed = true;
      this.emit('exit');
    }
  }

  const processes: FakeUtilityProcess[] = [];
  const fork = vi.fn(() => {
    const proc = new FakeUtilityProcess();
    processes.push(proc);
    return proc as unknown as import('electron').UtilityProcess;
  });

  return { utilityProcess: { fork }, __processes: processes };
});

import {
  runPollJobExternal,
  runStatusJobExternal,
  disposeGitPollWorker,
  __resetGitPollProcessForTests,
} from '../../electron/services/gitPollProcess';
import { runPollJob } from '../../electron/services/gitPollCore.js';
import { runStatusJob } from '../../electron/services/gitStatusCore.js';

const electronModule = (await import('electron')) as unknown as {
  utilityProcess: { fork: ReturnType<typeof vi.fn> };
  __processes: Array<
    EventEmitter & { posted: unknown[]; killed: boolean; postMessage(m: unknown): void; kill(): void }
  >;
};

const REQUEST = {
  repoPath: '/repos/alpha',
  checkedRemotes: ['origin'],
  sshEnvVars: {},
  authArgs: { origin: [] },
  fetchTimeoutMs: 60_000,
} as const;

const originalType = (process as { type?: string }).type;

function lastProcess() {
  return electronModule.__processes[electronModule.__processes.length - 1];
}

beforeEach(() => {
  // Simulate the Electron main process inside this file's module graph.
  (process as { type?: string }).type = 'browser';
  vi.mocked(runPollJob).mockClear();
  vi.mocked(runStatusJob).mockClear();
  electronModule.utilityProcess.fork.mockClear();
  electronModule.__processes.length = 0;
});

afterEach(() => {
  __resetGitPollProcessForTests();
  (process as { type?: string }).type = originalType;
});

afterAll(() => {
  delete (process as { parentPort?: unknown }).parentPort;
});

describe('gitPollProcess — separate-process status fetch', () => {
  it('runs the job IN-PROCESS outside the Electron main process (vitest fallback)', async () => {
    (process as { type?: string }).type = undefined;
    const result = await runPollJobExternal({ ...REQUEST });
    expect(result.branch).toBe('direct-branch');
    expect(runPollJob).toHaveBeenCalledWith({ ...REQUEST });
    expect(electronModule.utilityProcess.fork).not.toHaveBeenCalled();
  });

  it('forks once, buffers the request until ready, and resolves on the worker answer', async () => {
    const promise = runPollJobExternal({ ...REQUEST });

    // The worker was forked (lazily, for this first job only).
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();

    // Pre-'ready' the request is BUFFERED, not posted (nothing can be lost
    // while the worker is still booting).
    expect(proc.posted).toEqual([]);

    // Worker boots → flush.
    proc.emit('message', { kind: 'ready' });
    expect(proc.posted).toEqual([{ kind: 'poll', id: 1, request: { ...REQUEST } }]);

    // Worker answers → caller resolves with the worker's numbers (distinct
    // from the mocked in-process result).
    proc.emit('message', {
      kind: 'poll-result',
      id: 1,
      result: { fetched: true, error: null, branch: 'worker-branch', incoming: 1, outgoing: 2, dirty: 3 },
    });
    await expect(promise).resolves.toMatchObject({ branch: 'worker-branch', fetched: true });
    expect(runPollJob).not.toHaveBeenCalled();
  });

  it('reuses the live worker for subsequent jobs (no fork per poll)', async () => {
    const first = runPollJobExternal({ ...REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    proc.emit('message', {
      kind: 'poll-result',
      id: 1,
      result: { fetched: true, error: null, branch: 'b', incoming: 0, outgoing: 0, dirty: 0 },
    });
    await first;

    const second = runPollJobExternal({ ...REQUEST, repoPath: '/repos/beta' });
    await vi.waitFor(() => expect(lastProcess().posted.length).toBe(2));
    expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1);
    expect(lastProcess().posted[1]).toMatchObject({
      kind: 'poll',
      id: 2,
      request: { repoPath: '/repos/beta' },
    });
    lastProcess().emit('message', {
      kind: 'poll-result',
      id: 2,
      result: { fetched: true, error: null, branch: 'b2', incoming: 0, outgoing: 0, dirty: 0 },
    });
    await expect(second).resolves.toMatchObject({ branch: 'b2' });
  });

  it('a crashed worker falls back to the in-process run and is reforked by the next job', async () => {
    const first = runPollJobExternal({ ...REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const crashed = lastProcess();
    crashed.emit('exit'); // worker died before ever saying 'ready'

    // The caller still gets a valid result — via the in-process fallback.
    await expect(first).resolves.toMatchObject({ branch: 'direct-branch' });
    expect(runPollJob).toHaveBeenCalledTimes(1);

    // Next job → fresh worker (single crash does not trigger the cooldown).
    const second = runPollJobExternal({ ...REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(2));
    expect(lastProcess()).not.toBe(crashed);
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    // Answer with the id the manager actually assigned to THIS job.
    const jobId = (proc.posted[0] as { id: number }).id;
    proc.emit('message', {
      kind: 'poll-result',
      id: jobId,
      result: { fetched: true, error: null, branch: 'ok', incoming: 0, outgoing: 0, dirty: 0 },
    });
    await expect(second).resolves.toMatchObject({ branch: 'ok' });
  });

  it('a crash storm (3 exits) puts the manager in cooldown — no fork storm', async () => {
    for (let i = 0; i < 3; i++) {
      const p = runPollJobExternal({ ...REQUEST });
      await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(i + 1));
      lastProcess().emit('exit'); // crash before ready, each time
      await p; // in-process fallback
    }
    expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(3);

    // 4th job inside the cooldown window: NO fork, straight in-process.
    const fourth = await runPollJobExternal({ ...REQUEST });
    expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(3);
    expect(fourth.branch).toBe('direct-branch');
    expect(runPollJob).toHaveBeenCalledTimes(4);
  });

  it("rejects the caller's worker answer path via poll-error, then falls back in-process", async () => {
    const promise = runPollJobExternal({ ...REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    // Worker-side catastrophic failure branch of the protocol.
    proc.emit('message', { kind: 'poll-error', id: 1, message: 'worker exploded' });
    // runPollJobExternal swallows the worker failure → in-process result.
    await expect(promise).resolves.toMatchObject({ branch: 'direct-branch' });
  });

  it('ignores late/unknown messages without breaking the worker', async () => {
    const promise = runPollJobExternal({ ...REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    const jobId = (proc.posted[0] as { id: number }).id;
    proc.emit('message', { kind: 'nonsense' });
    proc.emit('message', null);
    proc.emit('message', { kind: 'poll-result', id: 999, result: {} }); // unknown id — late/garbage answer
    proc.emit('message', { kind: 'poll-result', id: 999, result: null });
    // The real answer for the real id still resolves the caller.
    proc.emit('message', {
      kind: 'poll-result',
      id: jobId,
      result: { fetched: true, error: null, branch: 'x', incoming: 0, outgoing: 0, dirty: 0 },
    });
    await expect(promise).resolves.toMatchObject({ branch: 'x' });
  });

  it('an invalid poll-result payload is treated as a protocol error → in-process fallback', async () => {
    const promise = runPollJobExternal({ ...REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    const jobId = (proc.posted[0] as { id: number }).id;
    // Missing result object — the manager rejects this job (protocol branch)
    // and runPollJobExternal falls back to the in-process run.
    proc.emit('message', { kind: 'poll-result', id: jobId, result: null });
    await expect(promise).resolves.toMatchObject({ branch: 'direct-branch' });
  });

  it('disposeGitPollWorker kills the worker process (app-quit hook)', async () => {
    const promise = runPollJobExternal({ ...REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    disposeGitPollWorker();
    expect(proc.killed).toBe(true);
    // The pending job survives via the in-process fallback.
    await expect(promise).resolves.toMatchObject({ branch: 'direct-branch' });
  });
});

describe('gitPollProcess — watcher status jobs on the SAME worker', () => {
  const STATUS_REQUEST = { repoPath: '/repos/alpha', gitDir: '/repos/alpha/.git' } as const;

  it('runs the status job IN-PROCESS outside the Electron main process (vitest fallback)', async () => {
    (process as { type?: string }).type = undefined;
    const result = await runStatusJobExternal({ ...STATUS_REQUEST });
    expect(result.current).toBe('direct-status-branch');
    expect(runStatusJob).toHaveBeenCalledWith({ ...STATUS_REQUEST });
    expect(electronModule.utilityProcess.fork).not.toHaveBeenCalled();
  });

  it('dispatches a status job with kind:"status" and resolves on status-result', async () => {
    const promise = runStatusJobExternal({ ...STATUS_REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });

    // The request went out tagged as a STATUS job (not 'poll').
    const sent = proc.posted[0] as { kind: string; id: number; request: unknown };
    expect(sent.kind).toBe('status');
    expect(sent.request).toEqual({ ...STATUS_REQUEST });

    proc.emit('message', {
      kind: 'status-result',
      id: sent.id,
      result: { current: 'worker-status-branch', files: [], isClean: true, head: 'abc' },
    });
    await expect(promise).resolves.toMatchObject({ current: 'worker-status-branch', head: 'abc' });
    expect(runStatusJob).not.toHaveBeenCalled(); // no in-process fallback needed
  });

  it('shares ONE worker between poll and status jobs (no extra fork)', async () => {
    const pollPromise = runPollJobExternal({ ...REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    proc.emit('message', {
      kind: 'poll-result',
      id: (proc.posted[0] as { id: number }).id,
      result: { fetched: true, error: null, branch: 'b', incoming: 0, outgoing: 0, dirty: 0 },
    });
    await pollPromise;

    const statusPromise = runStatusJobExternal({ ...STATUS_REQUEST });
    await vi.waitFor(() => expect(proc.posted.length).toBe(2));
    expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1); // SAME process
    const second = proc.posted[1] as { kind: string; id: number };
    expect(second.kind).toBe('status');
    proc.emit('message', {
      kind: 'status-result',
      id: second.id,
      result: { current: 's', files: [], isClean: true },
    });
    await expect(statusPromise).resolves.toMatchObject({ current: 's' });
  });

  it('a status-error from the worker falls back to the in-process run', async () => {
    const promise = runStatusJobExternal({ ...STATUS_REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    const jobId = (proc.posted[0] as { id: number }).id;
    proc.emit('message', { kind: 'status-error', id: jobId, message: 'status exploded' });
    // runStatusJobExternal swallows the worker failure → in-process result.
    await expect(promise).resolves.toMatchObject({ current: 'direct-status-branch' });
    expect(runStatusJob).toHaveBeenCalledTimes(1);
  });

  it('a crashed worker mid-status-job falls back in-process and the next job reforks', async () => {
    const first = runStatusJobExternal({ ...STATUS_REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    lastProcess().emit('exit'); // crash before ready
    await expect(first).resolves.toMatchObject({ current: 'direct-status-branch' });
    expect(runStatusJob).toHaveBeenCalledTimes(1);

    const second = runStatusJobExternal({ ...STATUS_REQUEST, repoPath: '/repos/beta', gitDir: '/repos/beta/.git' });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(2));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    const sent = proc.posted[0] as { kind: string; id: number };
    expect(sent.kind).toBe('status');
    proc.emit('message', {
      kind: 'status-result',
      id: sent.id,
      result: { current: 'ok', files: [], isClean: true },
    });
    await expect(second).resolves.toMatchObject({ current: 'ok' });
  });

  it('an invalid status-result payload is a protocol error → in-process fallback', async () => {
    const promise = runStatusJobExternal({ ...STATUS_REQUEST });
    await vi.waitFor(() => expect(electronModule.utilityProcess.fork).toHaveBeenCalledTimes(1));
    const proc = lastProcess();
    proc.emit('message', { kind: 'ready' });
    const jobId = (proc.posted[0] as { id: number }).id;
    proc.emit('message', { kind: 'status-result', id: jobId, result: null });
    await expect(promise).resolves.toMatchObject({ current: 'direct-status-branch' });
  });
});
