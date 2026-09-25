import { runPollJob } from './gitPollCore.js';
import type { PollJobRequest } from './gitPollCore.js';
import { runStatusJob } from './gitStatusCore.js';
import type { StatusJobRequest } from './gitStatusCore.js';
import { runStatsJob } from './gitStatsCore.js';
import type { StatsJobRequest } from './gitStatsCore.js';
import { runRawJob } from './gitRawCore.js';
import type { RawJobRequest } from './gitRawCore.js';
import { installChildTracker, killAllChildren, __trackedChildPidsForLog } from './childTracker.js';
import { WORKTREE_IGNORED } from './watcherIgnore.js';
import chokidar, { type FSWatcher } from 'chokidar';

/**
 * GIT POLL WORKER — the entry file of the DEDICATED Electron utilityProcess
 * that owns the app's BACKGROUND git work (gitPollProcess.fork() loads the
 * compiled `dist-electron/gitPollWorker.js`).
 *
 * Two job kinds share this one OS process (with its own event loop), so the
 * Electron main process stays free to broker renderer IPC:
 *
 *  - 'poll'   the repository-list remote check ("проверка удалённых
 *             репозиториев"): background fetch + local counters; the thing
 *             that kept the UI unresponsive while slow/hung remotes were
 *             being fetched;
 *  - 'status' the WATCHER-driven working-tree refresh: the full
 *             `gitService.status()` computation (porcelain parse of
 *             potentially thousands of entries + repo-state reads) that
 *             used to be pumped/parsed on the MAIN loop on every IDE
 *             auto-save / build churn;
 *  - 'stats'  the sidebar metadata sweep (refreshRepoStats / the stats half
 *             of "Check all repositories"): log -1 + branch list + remotes
 *             + commit count per repo — 4 spawns per repo that used to run
 *             on the MAIN loop while the user was clicking around.
 *  - 'watch'  (Linux only) the WORKDIR chokidar watch: its initial readdir
 *             scan of a big tree blocks the host event loop for ~100ms-2s
 *             and its per-file inotify marks exhaust the 8192 default budget
 *             on big repos (ENOSPC). Running it HERE keeps the main loop
 *             free (repo-switch freeze fix, v3.6) and the failure isolated
 *             — main degrades to a 10s synthetic poll on 'watch-error'.
 *
 * Protocol (see electron/services/gitPollProcess.ts — the main-side peer):
 *   main  → worker : { kind: 'poll',   id: number, request: PollJobRequest }
 *                    { kind: 'status', id: number, request: StatusJobRequest }
 *                    { kind: 'stats',  id: number, request: StatsJobRequest }
 *                    { kind: 'watch-start', repoPath: string }   (Linux workdir)
 *                    { kind: 'watch-stop',  repoPath: string }
 *                    { kind: 'shutdown' }            (dispose: kill git children)
 *   worker → main  : { kind: 'ready' }                       (once, at startup)
 *                    { kind: 'poll-result',   id, result: PollJobResult }
 *                    { kind: 'poll-error',    id, message: string }
 *                    { kind: 'status-result', id, result: StatusJobResult }
 *                    { kind: 'status-error',  id, message: string }
 *                    { kind: 'stats-result',  id, result: StatsJobResult }
 *                    { kind: 'stats-error',   id, message: string }
 *                    { kind: 'watch-event', repoPath }       (throttled 50ms leading)
 *                    { kind: 'watch-error', repoPath, code } (watch died — degrade)
 *
 * Everything is plain JSON-serializable data. The worker holds no settings,
 * no secrets, no Electron imports — the main process resolves which remotes
 * to fetch, the SSH env, the HTTP auth args AND the gitDir (from its session
 * cache) and passes them per request.
 *
 * NOTE: in a utility process `process.parentPort` is the MessagePort-like
 * channel to the main process (undefined everywhere else — importing this
 * module outside a utility process is a harmless no-op, which is exactly
 * what the vitest protocol tests rely on). Messages FROM main arrive as
 * MessageEvent-shaped objects (`event.data`); messages TO main are posted
 * with plain `postMessage(payload)` and arrive in main as the payload
 * itself.
 */

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

interface PollMessage {
  kind: 'poll';
  id: number;
  request: PollJobRequest;
}

interface StatusMessage {
  kind: 'status';
  id: number;
  request: StatusJobRequest;
}

interface StatsMessage {
  kind: 'stats';
  id: number;
  request: StatsJobRequest;
}

interface RawMessage {
  kind: 'raw';
  id: number;
  request: RawJobRequest;
}

interface ShutdownMessage {
  kind: 'shutdown';
}

interface WatchStartMessage {
  kind: 'watch-start';
  repoPath: string;
}

interface WatchStopMessage {
  kind: 'watch-stop';
  repoPath: string;
}

function isPollMessage(data: unknown): data is PollMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as { kind?: unknown; id?: unknown; request?: unknown };
  return (
    msg.kind === 'poll' &&
    typeof msg.id === 'number' &&
    !!msg.request &&
    typeof (msg.request as { repoPath?: unknown }).repoPath === 'string'
  );
}

function isStatusMessage(data: unknown): data is StatusMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as { kind?: unknown; id?: unknown; request?: unknown };
  return (
    msg.kind === 'status' &&
    typeof msg.id === 'number' &&
    !!msg.request &&
    typeof (msg.request as { repoPath?: unknown }).repoPath === 'string' &&
    typeof (msg.request as { gitDir?: unknown }).gitDir === 'string'
  );
}

function isStatsMessage(data: unknown): data is StatsMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as { kind?: unknown; id?: unknown; request?: unknown };
  return (
    msg.kind === 'stats' &&
    typeof msg.id === 'number' &&
    !!msg.request &&
    typeof (msg.request as { repoPath?: unknown }).repoPath === 'string'
  );
}

function isRawMessage(data: unknown): data is RawMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as { kind?: unknown; id?: unknown; request?: unknown; args?: unknown };
  return (
    msg.kind === 'raw' &&
    typeof msg.id === 'number' &&
    !!msg.request &&
    typeof (msg.request as { repoPath?: unknown }).repoPath === 'string' &&
    Array.isArray((msg.request as { args?: unknown }).args) &&
    ((msg.request as { args?: unknown[] }).args as unknown[]).every((a) => typeof a === 'string')
  );
}

function isShutdownMessage(data: unknown): data is ShutdownMessage {
  return !!data && typeof data === 'object' && (data as { kind?: unknown }).kind === 'shutdown';
}

function isWatchStartMessage(data: unknown): data is WatchStartMessage {
  return !!data && typeof data === 'object' &&
    (data as { kind?: unknown }).kind === 'watch-start' &&
    typeof (data as { repoPath?: unknown }).repoPath === 'string';
}

function isWatchStopMessage(data: unknown): data is WatchStopMessage {
  return !!data && typeof data === 'object' &&
    (data as { kind?: unknown }).kind === 'watch-stop' &&
    typeof (data as { repoPath?: unknown }).repoPath === 'string';
}

const port: ParentPort | undefined = (process as { parentPort?: ParentPort }).parentPort;

// ── Linux workdir watch (runs HERE so the scan never blocks main) ─────────
// One chokidar instance per watched repo. Events are throttled to ONE
// postMessage per 50ms (leading edge) — main applies its own 500ms debounce
// on top, so the process boundary never carries an event storm.
const workdirWatchers = new Map<string, FSWatcher>();
const watchThrottle = new Map<string, number>();
const WATCH_EVENT_MIN_INTERVAL_MS = 50;

function handleWatchStart(repoPath: string): void {
  if (!port) return;
  if (workdirWatchers.has(repoPath)) return; // idempotent
  try {
    const watcher = chokidar.watch(repoPath, {
      persistent: false,
      ignoreInitial: true,
      ignored: WORKTREE_IGNORED,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    workdirWatchers.set(repoPath, watcher);
    watcher.on('all', () => {
      if (!port) return;
      const now = Date.now();
      const last = watchThrottle.get(repoPath) ?? 0;
      if (now - last < WATCH_EVENT_MIN_INTERVAL_MS) return;
      watchThrottle.set(repoPath, now);
      port.postMessage({ kind: 'watch-event', repoPath });
    });
    // ENOSPC (inotify budget exhausted on huge repos) and other fatal errors
    // are REPORTED — main degrades to its 10s synthetic poll. Never crash.
    watcher.on('error', (err) => {
      if (!port) return;
      const code = (err as NodeJS.ErrnoException)?.code ?? 'unknown';
      try { void watcher.close(); } catch { /* ignore */ }
      workdirWatchers.delete(repoPath);
      port.postMessage({ kind: 'watch-error', repoPath, code });
    });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code ?? 'unknown';
    port.postMessage({ kind: 'watch-error', repoPath, code });
  }
}

function handleWatchStop(repoPath: string): void {
  const watcher = workdirWatchers.get(repoPath);
  if (!watcher) return;
  workdirWatchers.delete(repoPath);
  watchThrottle.delete(repoPath);
  try { void watcher.close(); } catch { /* ignore */ }
}

// Track every git child this process spawns so a 'shutdown' from main can
// kill them before the process itself dies — an orphaned `git fetch` would
// otherwise keep running (and keep the network/AV busy) for up to the OS TCP
// timeout after the app has already quit (the "closing the app leaves the
// machine sluggish" report). Must be installed before any job arrives; jobs
// only start after the 'ready' handshake below.
installChildTracker();

const WORKER_LOG = !!process.env.PRISMGIT_QUIT_LOG;
if (WORKER_LOG) console.log(`[worker pid=${process.pid}] alive — child tracker installed`);

if (port) {
  port.on('message', (event) => {
    const data = (event as { data?: unknown } | undefined)?.data;
    // malformed/unknown messages are ignored, never crash the worker
    if (isShutdownMessage(data)) {
      // Graceful stop: kill tracked git children FIRST (they have no killer
      // of their own once this process is gone), then exit. Main falls back
      // to a hard kill if we don't exit in time.
      for (const repoPath of workdirWatchers.keys()) handleWatchStop(repoPath);
      const killedPids = __trackedChildPidsForLog();
      const killed = killAllChildren();
      if (WORKER_LOG) console.log(`[worker pid=${process.pid}] shutdown received — killing pids [${killedPids.join(',')}] (issued=${killed}), exiting`);
      process.exit(0);
    }
    if (isRawMessage(data)) {
      const { id, request } = data;
      runRawJob(request)
        .then((result) => {
          port.postMessage({ kind: 'raw-result', id, result });
        })
        .catch((e: unknown) => {
          port.postMessage({
            kind: 'raw-error',
            id,
            message: e instanceof Error ? e.message : String(e),
          });
        });
      return;
    }
    if (isWatchStartMessage(data)) {
      handleWatchStart(data.repoPath);
      return;
    }
    if (isWatchStopMessage(data)) {
      handleWatchStop(data.repoPath);
      return;
    }
    if (isPollMessage(data)) {
      const { id, request } = data;
      runPollJob(request)
        .then((result) => {
          port.postMessage({ kind: 'poll-result', id, result });
        })
        .catch((e: unknown) => {
          // runPollJob is designed not to throw (fetch errors land in
          // result.error); this is the belt-and-braces protocol branch.
          port.postMessage({
            kind: 'poll-error',
            id,
            message: e instanceof Error ? e.message : String(e),
          });
        });
      return;
    }
    if (isStatusMessage(data)) {
      const { id, request } = data;
      runStatusJob(request)
        .then((result) => {
          port.postMessage({ kind: 'status-result', id, result });
        })
        .catch((e: unknown) => {
          // A status error (vanished repo, unreadable git dir, …) is a REAL
          // answer the main side must see — runStatusJobExternal falls back
          // to the in-process run, which surfaces the same error to the
          // renderer's refreshStatus error handling.
          port.postMessage({
            kind: 'status-error',
            id,
            message: e instanceof Error ? e.message : String(e),
          });
        });
      return;
    }
    if (isStatsMessage(data)) {
      const { id, request } = data;
      runStatsJob(request)
        .then((result) => {
          port.postMessage({ kind: 'stats-result', id, result });
        })
        .catch((e: unknown) => {
          // runStatsJob degrades every read individually, so this is the
          // belt-and-braces protocol branch (missing repo, unreadable dir).
          port.postMessage({
            kind: 'stats-error',
            id,
            message: e instanceof Error ? e.message : String(e),
          });
        });
    }
  });

  // Tell the main process the listener is registered. Main buffers job
  // requests until 'ready' arrives (plus a ready-timeout escape hatch), so
  // no request posted immediately after fork can be lost while this module
  // is still being required.
  port.postMessage({ kind: 'ready' });
}
