import * as path from 'path';
import { runPollJob } from './gitPollCore.js';
import type { PollJobRequest, PollJobResult } from './gitPollCore.js';
import { runStatusJob } from './gitStatusCore.js';
import type { StatusJobRequest, StatusJobResult } from './gitStatusCore.js';

/**
 * GIT POLL PROCESS — main-side manager of the DEDICATED utilityProcess that
 * executes the app's BACKGROUND git work off the main event loop:
 *
 *  - 'poll'   the repository-list remote check (the "status fetch") —
 *             background fetch + local counters per repo;
 *  - 'status' the watcher-driven working-tree refresh (gitStatusCore) —
 *             porcelain parse + repo-state reads; the exact computation
 *             the foreground status() runs, just never on the main loop.
 *
 * Lifecycle & failure policy (applies to BOTH job kinds):
 *  - The worker is forked LAZILY on the first job and reused for all
 *    subsequent ones (one OS process for the whole app session — not one
 *    per job).
 *  - Requests posted before the worker's 'ready' are buffered in `outbox`
 *    and flushed on 'ready' — nothing is lost during process boot. If
 *    'ready' never arrives (broken bundle, antivirus quarantined the file,
 *    …) a ready-timeout kills the worker and the job falls back to the
 *    in-process path.
 *  - A crashed worker rejects its pending jobs; the job runners then
 *    re-run the job IN-PROCESS so a sick worker never blanks the sidebar
 *    counters nor stalls a status refresh (both jobs are idempotent reads).
 *    The next job reforks the worker.
 *  - Fork-storm guard: 3+ unexpected exits within 5 minutes put the manager
 *    in direct-mode cooldown for 60 s — a machine where the worker cannot
 *    start at all must not fork a process on every poll tick.
 *  - Whole-job timeouts (per kind — far above each job's slowest legit
 *    path) kill a wedged worker; the job falls back in-process.
 *  - disposeGitPollWorker() on app quit kills the process and rejects
 *    pending jobs.
 *
 * In non-Electron hosts (vitest, plain node) `process.type` is undefined →
 * every job runs in-process via its core runner — byte-for-byte the
 * pre-split behavior, which is what the existing unit/integration suites
 * pin.
 */

/** Whole-job safety net for poll jobs: kill a worker that never answers at
 * all. Legit worst case ≈ 60 s hung fetch (killed) + slow rev-list walks ≪
 * this. */
const WORKER_JOB_TIMEOUT_MS = 10 * 60_000;
/** Whole-job safety net for status jobs: `git status` on a huge repo can be
 * slow (tens of seconds) but never minutes — anything beyond this is a
 * wedged worker, not a legit status. */
const STATUS_JOB_TIMEOUT_MS = 5 * 60_000;
/** The worker must say 'ready' within this window or the fork is treated as
 *  failed (and the manager cools down before reforking). */
const WORKER_READY_TIMEOUT_MS = 15_000;
/** Direct-mode cooldown after a failed fork / crash storm. */
const FORK_COOLDOWN_MS = 60_000;
/** Crash-storm threshold: this many unexpected exits within this window
 *  triggers the cooldown. */
const CRASH_STORM_COUNT = 3;
const CRASH_STORM_WINDOW_MS = 5 * 60_000;

type ElectronUtilityProcess = import('electron').UtilityProcess;

/** The job kinds this worker process serves. */
type JobKind = 'poll' | 'status';

interface PendingJob {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedMessage {
  kind: JobKind;
  id: number;
  request: unknown;
}

interface WorkerState {
  proc: ElectronUtilityProcess;
  ready: boolean;
  dead: boolean;
  pending: Map<number, PendingJob>;
  outbox: QueuedMessage[];
  readyTimer: ReturnType<typeof setTimeout> | null;
}

let workerState: WorkerState | null = null;
let nextId = 1;
let lastForkFailure = 0;
const crashTimestamps: number[] = [];

function isElectronMain(): boolean {
  // 'browser' is the Electron main process; undefined in node/vitest,
  // 'renderer' in a renderer (this module is main-side only).
  return (process as { type?: string }).type === 'browser';
}

function getWorkerFilePath(): string {
  // __dirname is dist-electron in the built CJS main bundle — both in dev
  // (vite-plugin-electron watches & rebuilds both entries) and packaged
  // (electron-builder ships the whole dist-electron dir; utilityProcess
  // can load entries straight out of the asar archive).
  return path.join(__dirname, 'gitPollWorker.js');
}

function noteUnexpectedExit(): void {
  const now = Date.now();
  crashTimestamps.push(now);
  while (crashTimestamps.length > 0 && now - crashTimestamps[0] > CRASH_STORM_WINDOW_MS) {
    crashTimestamps.shift();
  }
  if (crashTimestamps.length >= CRASH_STORM_COUNT) {
    lastForkFailure = now;
    crashTimestamps.length = 0;
  }
}

function rejectAllPending(state: WorkerState, message: string): void {
  for (const [, job] of state.pending) {
    clearTimeout(job.timer);
    job.reject(new Error(message));
  }
  state.pending.clear();
}

/** Kill the current worker (planned kill: no crash accounting). Pending
 *  jobs are rejected by the 'exit' handler. */
function killWorkerState(): void {
  const state = workerState;
  if (!state || state.dead) return;
  state.dead = true;
  if (state.readyTimer !== null) {
    clearTimeout(state.readyTimer);
    state.readyTimer = null;
  }
  try {
    state.proc.kill();
  } catch {
    // Already gone — the 'exit' handler cleans up.
  }
}

async function ensureWorker(): Promise<WorkerState> {
  const existing = workerState;
  if (existing && !existing.dead) return existing;
  if (Date.now() - lastForkFailure < FORK_COOLDOWN_MS) {
    throw new Error('git poll worker fork is in cooldown (recent fork failures)');
  }

  // Lazy import: 'electron' is only importable inside the Electron main
  // process — importing it eagerly would break every non-Electron host
  // (vitest imports this module through git.ts).
  const { utilityProcess } = await import('electron');
  const proc = utilityProcess.fork(getWorkerFilePath(), [], {
    serviceName: 'prismgit-git-poll',
  });

  const state: WorkerState = {
    proc,
    ready: false,
    dead: false,
    pending: new Map(),
    outbox: [],
    readyTimer: null,
  };
  workerState = state;

  state.readyTimer = setTimeout(() => {
    if (workerState === state && !state.ready && !state.dead) {
      // Worker never registered its listener — treat as a failed fork so
      // the cooldown kicks in (a broken worker file must not refork every
      // poll tick). Pending jobs are rejected via the 'exit' handler.
      lastForkFailure = Date.now();
      killWorkerState();
    }
  }, WORKER_READY_TIMEOUT_MS);

  proc.on('message', (message: unknown) => {
    if (workerState !== state || state.dead) return;
    const msg = message as
      | { kind?: unknown; id?: unknown; result?: unknown; message?: unknown }
      | null
      | undefined;
    if (!msg || typeof msg.kind !== 'string') return;

    if (msg.kind === 'ready') {
      state.ready = true;
      if (state.readyTimer !== null) {
        clearTimeout(state.readyTimer);
        state.readyTimer = null;
      }
      for (const queued of state.outbox) {
        try {
          state.proc.postMessage(queued);
        } catch {
          // Worker died between 'ready' and the flush — the 'exit' handler
          // takes care of the pending jobs; remaining queue entries die
          // with the worker.
          break;
        }
      }
      state.outbox.length = 0;
      return;
    }

    if (
      (msg.kind === 'poll-result' || msg.kind === 'status-result' || msg.kind === 'poll-error' || msg.kind === 'status-error') &&
      typeof msg.id === 'number'
    ) {
      const job = state.pending.get(msg.id);
      if (!job) return; // late answer for an already-timeouted job — ignore
      state.pending.delete(msg.id);
      clearTimeout(job.timer);
      if ((msg.kind === 'poll-result' || msg.kind === 'status-result') && msg.result && typeof msg.result === 'object') {
        job.resolve(msg.result);
      } else {
        job.reject(new Error(typeof msg.message === 'string' && msg.message ? msg.message : 'git background worker job failed'));
      }
    }
  });

  proc.on('exit', () => {
    if (workerState !== state) return;
    workerState = null;
    if (state.readyTimer !== null) {
      clearTimeout(state.readyTimer);
      state.readyTimer = null;
    }
    const planned = state.dead; // killed by us (timeout/dispose) vs. crash
    state.dead = true;
    state.outbox.length = 0;
    rejectAllPending(state, planned ? 'git poll worker was stopped' : 'git poll worker exited unexpectedly');
    if (!planned) noteUnexpectedExit();
  });

  return state;
}

async function dispatchToWorker<T>(kind: JobKind, request: unknown, timeoutMs: number): Promise<T> {
  const state = await ensureWorker();
  return await new Promise<T>((resolve, reject) => {
    if (workerState !== state || state.dead) {
      reject(new Error('git background worker died before the job was sent'));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      // The worker went silent far beyond any legit worst case — kill it
      // (its pending jobs, this one included, are rejected by 'exit').
      killWorkerState();
    }, timeoutMs);
    state.pending.set(id, { resolve: resolve as (result: unknown) => void, reject, timer });
    const message: QueuedMessage = { kind, id, request };
    if (state.ready) {
      try {
        state.proc.postMessage(message);
      } catch (e) {
        state.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    } else {
      // Buffered until 'ready' (flushed by the message handler).
      state.outbox.push(message);
    }
  });
}

/**
 * Run one poll job — in the dedicated git-poll utility process when running
 * inside the Electron main process, in-process otherwise (vitest, plain
 * node). If the worker path fails for ANY reason (fork error, cooldown,
 * crash mid-job, protocol timeout) the job re-runs in-process, so a sick
 * worker degrades performance, never correctness.
 */
export async function runPollJobExternal(request: PollJobRequest): Promise<PollJobResult> {
  if (!isElectronMain()) {
    return runPollJob(request);
  }
  try {
    return await dispatchToWorker<PollJobResult>('poll', request, WORKER_JOB_TIMEOUT_MS);
  } catch {
    // The fetch is idempotent and TTL-gated, so a single duplicate run
    // after a rare worker crash is safe; the alternative (surfacing the
    // failure as summary.error) would blank the sidebar counters and
    // back a healthy remote off for 5 minutes on a worker hiccup.
    return runPollJob(request);
  }
}

/**
 * Run one WATCHER status job (gitStatusCore.runStatusJob) — in the same
 * dedicated background worker process when running inside the Electron
 * main process, in-process otherwise (vitest, plain node). Worker failure
 * for ANY reason falls back to the in-process run: a status refresh is an
 * idempotent read, so re-running it can't corrupt anything — the renderer
 * just sees the answer a bit later.
 */
export async function runStatusJobExternal(request: StatusJobRequest): Promise<StatusJobResult> {
  if (!isElectronMain()) {
    return runStatusJob(request);
  }
  try {
    return await dispatchToWorker<StatusJobResult>('status', request, STATUS_JOB_TIMEOUT_MS);
  } catch {
    return runStatusJob(request);
  }
}

/** App-quit hook: kill the worker process (main.ts calls this from
 *  'before-quit' alongside the other flush/stop handlers). */
export function disposeGitPollWorker(): void {
  killWorkerState();
}

/** Test-only: reset the manager's module state (kills the worker, clears
 *  crash history). Production code must not call this. */
export function __resetGitPollProcessForTests(): void {
  const state = workerState;
  if (state) {
    state.dead = true;
    if (state.readyTimer !== null) {
      clearTimeout(state.readyTimer);
      state.readyTimer = null;
    }
    try {
      state.proc.kill();
    } catch {
      // Mocked/already-dead process — ignore.
    }
    rejectAllPending(state, 'git poll worker reset for tests');
    state.outbox.length = 0;
  }
  workerState = null;
  crashTimestamps.length = 0;
  lastForkFailure = 0;
  nextId = 1;
}
