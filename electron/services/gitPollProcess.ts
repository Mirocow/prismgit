import * as path from 'path';
import { runPollJob } from './gitPollCore.js';
import type { PollJobRequest, PollJobResult } from './gitPollCore.js';
import { runStatusJob } from './gitStatusCore.js';
import type { StatusJobRequest, StatusJobResult } from './gitStatusCore.js';
import { runStatsJob } from './gitStatsCore.js';
import type { StatsJobRequest, StatsJobResult } from './gitStatsCore.js';
import { runRawJob } from './gitRawCore.js';
import type { RawJobRequest } from './gitRawCore.js';

/**
 * GIT POLL PROCESS — main-side manager of the DEDICATED utilityProcess that
 * executes the app's BACKGROUND git work off the main event loop:
 *
 *  - 'poll'   the repository-list remote check (the "status fetch") —
 *             background fetch + local counters per repo;
 *  - 'status' the watcher-driven working-tree refresh (gitStatusCore) —
 *             porcelain parse + repo-state reads; the exact computation
 *             the foreground status() runs, just never on the main loop;
 *  - 'stats'  the sidebar metadata sweep (gitStatsCore) — the 4 reads per
 *             repo (log -1 / branches / remotes / commit count) behind the
 *             "Check all repositories" button and every repo open.
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
/** Whole-job safety net for stats jobs: four quick reads; even a huge repo
 * never takes minutes — beyond this the worker is wedged. */
const STATS_JOB_TIMEOUT_MS = 5 * 60_000;
/** Whole-job safety net for raw read jobs: ls-files/diff/status output over
 * a huge repo is string data — big, but never minutes. Beyond this the
 * worker is wedged, not slow. */
const RAW_JOB_TIMEOUT_MS = 2 * 60_000;
/** Grace window for the worker's 'shutdown' (kill its git children, then
 * exit) before main hard-kills it. */
const WORKER_SHUTDOWN_GRACE_MS = 500;
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
type JobKind = 'poll' | 'status' | 'stats' | 'raw';

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

/** Workdir-watch commands are fire-and-forget (no reply, no job id) — they
 * are buffered here until the worker says 'ready', mirroring the job outbox. */
interface WatchCommand {
  kind: 'watch-start' | 'watch-stop';
  repoPath: string;
}

/** Listener events pushed to the watcher module:
 *  - 'worktree': a (throttled) workdir change event arrived from the worker;
 *  - 'error':    the worker-side watch DIED (e.g. ENOSPC) — caller degrades;
 *  - 'lost':     the worker process itself died — the watch is gone, caller
 *                should fall back to watching in-process. */
export type WorkdirWatchEvent = 'worktree' | 'error' | 'lost';
export type WorkdirWatchListener = (event: WorkdirWatchEvent) => void;

const workdirWatchListeners = new Map<string, WorkdirWatchListener>();
const watchOutbox: WatchCommand[] = [];

let workerState: WorkerState | null = null;

/**
 * Set the moment a QUIT-driven disposal starts. While true, the in-process
 * fallback paths in runXExternal() must NOT run: re-running a poll/status/
 * stats job inside the DYING main process spawns untracked git children
 * (verified: orphaned `git fetch --prune --quiet origin`, ppid=1, alive
 * minutes after the app closed). The fallback exists for a SICK worker;
 * a planned quit-shutdown is not sickness — reject instead.
 */
let quitDisposalStarted = false;
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
      | { kind?: unknown; id?: unknown; result?: unknown; message?: unknown; repoPath?: unknown }
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
      // Fire-and-forget watch commands buffered while the worker booted.
      // watch-stop for a repo nobody asked to watch anymore is a harmless
      // no-op in the worker (map miss).
      for (const cmd of watchOutbox) {
        try {
          state.proc.postMessage(cmd);
        } catch {
          break;
        }
      }
      watchOutbox.length = 0;
      return;
    }

    if (msg.kind === 'watch-event' && typeof msg.repoPath === 'string') {
      workdirWatchListeners.get(msg.repoPath)?.('worktree');
      return;
    }
    if (msg.kind === 'watch-error' && typeof msg.repoPath === 'string') {
      workdirWatchListeners.get(msg.repoPath)?.('error');
      workdirWatchListeners.delete(msg.repoPath);
      return;
    }

    if (
      (msg.kind === 'poll-result' || msg.kind === 'status-result' || msg.kind === 'stats-result' || msg.kind === 'raw-result' || msg.kind === 'poll-error' || msg.kind === 'status-error' || msg.kind === 'stats-error' || msg.kind === 'raw-error') &&
      typeof msg.id === 'number'
    ) {
      const job = state.pending.get(msg.id);
      if (!job) return; // late answer for an already-timeouted job — ignore
      state.pending.delete(msg.id);
      clearTimeout(job.timer);
      if (msg.kind === 'raw-result' && typeof msg.result === 'string') {
        job.resolve(msg.result);
      } else if ((msg.kind === 'poll-result' || msg.kind === 'status-result' || msg.kind === 'stats-result') && msg.result && typeof msg.result === 'object') {
        job.resolve(msg.result);
      } else {
        job.reject(new Error(typeof msg.message === 'string' && msg.message ? msg.message : 'git background worker job failed'));
      }
    }
  });

  proc.on('exit', () => {
    if (workerState !== state) return;
    if (process.env.PRISMGIT_QUIT_LOG) console.log(`[quit +${Math.round(process.uptime() * 1000)}ms] worker process exited (planned=${state.dead})`);
    workerState = null;
    if (state.readyTimer !== null) {
      clearTimeout(state.readyTimer);
      state.readyTimer = null;
    }
    const planned = state.dead; // killed by us (timeout/dispose) vs. crash
    state.dead = true;
    state.outbox.length = 0;
    watchOutbox.length = 0;
    rejectAllPending(state, planned ? 'git poll worker was stopped' : 'git poll worker exited unexpectedly');
    // The worker's workdir watches died with it. Notify the watcher module
    // so it can fall back to an in-process watch — UNLESS we're quitting:
    // spinning up chokidar inside the DYING main process would leave
    // untracked handles at quit time.
    if (!quitDisposalStarted && workdirWatchListeners.size > 0) {
      const listeners = [...workdirWatchListeners.entries()];
      workdirWatchListeners.clear();
      for (const [, listener] of listeners) {
        try { listener('lost'); } catch { /* listener must not break the exit path */ }
      }
    } else {
      workdirWatchListeners.clear();
    }
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
 * Start the WORKDIR watch in the dedicated worker process (Linux repo-switch
 * freeze fix, v3.6). Fire-and-forget: no reply is expected; events arrive as
 * listener('worktree') calls (throttled to ~50ms by the worker; the caller
 * applies its own debounce). Returns false when the worker path is
 * unavailable (non-Electron host, fork cooldown, dead worker) — the caller
 * then falls back to its in-process watch. listener('error' | 'lost') tell
 * the caller to degrade (10s poll / in-process chokidar).
 */
export async function startWorkdirWatchExternal(
  repoPath: string,
  listener: WorkdirWatchListener,
): Promise<boolean> {
  if (!isElectronMain()) return false; // vitest / plain node — caller falls back
  workdirWatchListeners.set(repoPath, listener);
  try {
    const state = await ensureWorker();
    if (workerState !== state || state.dead) {
      workdirWatchListeners.delete(repoPath);
      return false;
    }
    const cmd: WatchCommand = { kind: 'watch-start', repoPath };
    if (state.ready) {
      state.proc.postMessage(cmd);
    } else {
      // Drop a superseded queued command for the same repo, then buffer.
      for (let i = watchOutbox.length - 1; i >= 0; i--) {
        if (watchOutbox[i].repoPath === repoPath) watchOutbox.splice(i, 1);
      }
      watchOutbox.push(cmd);
    }
    return true;
  } catch {
    workdirWatchListeners.delete(repoPath);
    return false;
  }
}

/** Stop a worker-side workdir watch (repo switch / repo close). Best-effort:
 * a dead worker has nothing to stop, and its 'exit' already cleared state. */
export function stopWorkdirWatchExternal(repoPath: string): void {
  workdirWatchListeners.delete(repoPath);
  for (let i = watchOutbox.length - 1; i >= 0; i--) {
    if (watchOutbox[i].repoPath === repoPath) watchOutbox.splice(i, 1);
  }
  const state = workerState;
  if (state && !state.dead && state.ready) {
    try {
      state.proc.postMessage({ kind: 'watch-stop', repoPath });
    } catch {
      // Worker died between the check and the post — its 'exit' cleanup
      // already discarded the watch.
    }
  }
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
  } catch (err) {
    // The fetch is idempotent and TTL-gated, so a single duplicate run
    // after a rare worker crash is safe; the alternative (surfacing the
    // failure as summary.error) would blank the sidebar counters and
    // back a healthy remote off for 5 minutes on a worker hiccup.
    //
    // QUIT is the exception (see quitDisposalStarted): re-running here
    // spawns untracked git children in the dying process.
    if (quitDisposalStarted) {
      throw err instanceof Error ? err : new Error('git poll worker unavailable: app is quitting');
    }
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
  } catch (err) {
    if (quitDisposalStarted) {
      throw err instanceof Error ? err : new Error('git poll worker unavailable: app is quitting');
    }
    return runStatusJob(request);
  }
}

/**
 * Run one STATS job (gitStatsCore.runStatsJob — the sidebar metadata reads)
 * — in the same dedicated background worker process when running inside the
 * Electron main process, in-process otherwise (vitest, plain node). Worker
 * failure for ANY reason falls back to the in-process run: a stats refresh
 * is an idempotent read, so re-running it can't corrupt anything.
 */
export async function runStatsJobExternal(request: StatsJobRequest): Promise<StatsJobResult> {
  if (!isElectronMain()) {
    return runStatsJob(request);
  }
  try {
    return await dispatchToWorker<StatsJobResult>('stats', request, STATS_JOB_TIMEOUT_MS);
  } catch (err) {
    if (quitDisposalStarted) {
      throw err instanceof Error ? err : new Error('git poll worker unavailable: app is quitting');
    }
    return runStatsJob(request);
  }
}

/**
 * Run one RAW read job (`git <args>` from the read-only allow-list — see
 * gitRawCore) in the same dedicated background worker process, falling back
 * to the in-process gitService.raw() when the worker path is unavailable.
 * Read-only and idempotent: a retry after a worker hiccup is always safe.
 */
export async function runRawJobExternal(request: RawJobRequest): Promise<string> {
  if (!isElectronMain()) {
    return runRawJob(request);
  }
  try {
    return await dispatchToWorker<string>('raw', request, RAW_JOB_TIMEOUT_MS);
  } catch (err) {
    if (quitDisposalStarted) {
      throw err instanceof Error ? err : new Error('git poll worker unavailable: app is quitting');
    }
    return runRawJob(request);
  }
}

/** App-quit hook: kill the worker process (main.ts calls this from
 *  'before-quit' alongside the other flush/stop handlers).
 *
 *  GRACEFUL first: the worker is asked to kill ITS git children (an orphaned
 *  `git fetch` would otherwise keep the network/AV busy for up to the OS TCP
 *  timeout after the app is gone — the "closing the app leaves the machine
 *  sluggish" report) and exit itself. If it doesn't exit within
 *  WORKER_SHUTDOWN_GRACE_MS we hard-kill it; its children are then orphans,
 *  which is the pre-existing behavior — strictly no worse.
 */
export function disposeGitPollWorker(): void {
  quitDisposalStarted = true;
  const state = workerState;
  if (!state || state.dead) return;
  try {
    state.proc.postMessage({ kind: 'shutdown' });
  } catch {
    // Worker already gone — fall through to the hard kill.
    killWorkerState();
    return;
  }
  // Planned kill from this point: the 'exit' handler must not count it as a
  // crash. Marking dead early also makes ensureWorker() refork-race-free.
  state.dead = true;
  if (state.readyTimer !== null) {
    clearTimeout(state.readyTimer);
    state.readyTimer = null;
  }
  setTimeout(() => {
    try {
      state.proc.kill();
    } catch {
      /* already exited via the graceful path */
    }
  }, WORKER_SHUTDOWN_GRACE_MS);
}

/**
 * Async app-quit hook: send the worker 'shutdown' (it SIGKILLs its git
 * children — process-group tree kill, see childTracker) and WAIT for the
 * worker to actually exit, bounded by `deadlineMs`, then hard-kill as the
 * backstop. main.ts parks the quit (before-quit + preventDefault) until
 * this resolves.
 *
 * WHY THE WAIT EXISTS (quit-orphan race, verified live): the old
 * fire-and-forget dispose raced Electron's quit lifecycle — 'quit' completed
 * ~50 ms later, the app process tore the utilityProcess down WITHOUT the
 * worker ever running its shutdown handler, and every in-flight
 * `git fetch` chain (fetch → git remote-http → curl) was orphaned to init,
 * holding the network/AV busy for minutes — the "after closing the app the
 * whole machine stays sluggish" report. Parking the quit until the worker
 * is verifiably dead closes the race at a bounded cost (≤ deadlineMs).
 */
export async function disposeGitPollWorkerAsync(deadlineMs: number = WORKER_SHUTDOWN_GRACE_MS): Promise<void> {
  quitDisposalStarted = true;
  const state = workerState;
  if (!state || state.dead) return;
  try {
    state.proc.postMessage({ kind: 'shutdown' });
  } catch {
    // Worker already gone — nothing to wait for.
    return;
  }
  // Planned kill from this point: the 'exit' handler must not count it as
  // a crash, and ensureWorker() must not refork-race us.
  state.dead = true;
  if (state.readyTimer !== null) {
    clearTimeout(state.readyTimer);
    state.readyTimer = null;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // Backstop: hard-kill after the grace window.
    const timer = setTimeout(() => {
      try {
        state.proc.kill();
      } catch {
        /* already exited via the graceful path */
      }
      // SIGKILL delivery is near-instant but 'exit' needs one loop turn —
      // give it a beat, but never block the quit on it.
      setTimeout(settle, 30);
    }, deadlineMs);
    // The normal path: worker killed its children and exited on its own.
    state.proc.once('exit', () => {
      clearTimeout(timer);
      settle();
    });
  });
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
  quitDisposalStarted = false;
}
