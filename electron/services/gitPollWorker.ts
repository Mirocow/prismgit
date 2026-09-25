import { runPollJob } from './gitPollCore.js';
import type { PollJobRequest } from './gitPollCore.js';
import { runStatusJob } from './gitStatusCore.js';
import type { StatusJobRequest } from './gitStatusCore.js';
import { runStatsJob } from './gitStatsCore.js';
import type { StatsJobRequest } from './gitStatsCore.js';
import { installChildTracker, killAllChildren } from './childTracker.js';

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
 *
 * Protocol (see electron/services/gitPollProcess.ts — the main-side peer):
 *   main  → worker : { kind: 'poll',   id: number, request: PollJobRequest }
 *                    { kind: 'status', id: number, request: StatusJobRequest }
 *                    { kind: 'stats',  id: number, request: StatsJobRequest }
 *                    { kind: 'shutdown' }            (dispose: kill git children)
 *   worker → main  : { kind: 'ready' }                       (once, at startup)
 *                    { kind: 'poll-result',   id, result: PollJobResult }
 *                    { kind: 'poll-error',    id, message: string }
 *                    { kind: 'status-result', id, result: StatusJobResult }
 *                    { kind: 'status-error',  id, message: string }
 *                    { kind: 'stats-result',  id, result: StatsJobResult }
 *                    { kind: 'stats-error',   id, message: string }
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

interface ShutdownMessage {
  kind: 'shutdown';
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

function isShutdownMessage(data: unknown): data is ShutdownMessage {
  return !!data && typeof data === 'object' && (data as { kind?: unknown }).kind === 'shutdown';
}

const port: ParentPort | undefined = (process as { parentPort?: ParentPort }).parentPort;

// Track every git child this process spawns so a 'shutdown' from main can
// kill them before the process itself dies — an orphaned `git fetch` would
// otherwise keep running (and keep the network/AV busy) for up to the OS TCP
// timeout after the app has already quit (the "closing the app leaves the
// machine sluggish" report). Must be installed before any job arrives; jobs
// only start after the 'ready' handshake below.
installChildTracker();

if (port) {
  port.on('message', (event) => {
    const data = (event as { data?: unknown } | undefined)?.data;
    // malformed/unknown messages are ignored, never crash the worker
    if (isShutdownMessage(data)) {
      // Graceful stop: kill tracked git children FIRST (they have no killer
      // of their own once this process is gone), then exit. Main falls back
      // to a hard kill if we don't exit in time.
      killAllChildren();
      process.exit(0);
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
