import * as childProcess from 'child_process';
import { execFileSync } from 'node:child_process';
import * as path from 'path';
import { createRequire } from 'node:module';

/**
 * CHILD TRACKER — records every child process this process spawns so they
 * can ALL be killed when the process itself is asked to shut down.
 *
 * WHY THIS EXISTS: the background git worker (gitPollWorker) is killed with
 * proc.kill() when the app quits (disposeGitPollWorker). Killing the worker
 * does NOT kill its children — an in-flight `git fetch` against a hung
 * remote becomes an ORPHAN that keeps running (holding the network, making
 * antivirus scan it, keeping the disk busy) for up to the OS TCP timeout
 * after the app is already gone. That was the reported "closing the app
 * leaves the machine sluggish, as if something is still interfering".
 *
 * The worker therefore tracks its children (same child_process.spawn patch
 * technique the main process's command log uses) and kills them on the
 * 'shutdown' message BEFORE exiting — see gitPollWorker.ts.
 *
 * Kill semantics on exit paths:
 *  - POSIX: child.kill() (SIGTERM) is enough for git — it exits promptly.
 *  - Windows: child.kill() maps to TerminateProcess — immediate.
 * The kill is best-effort: a child that already exited is a no-op, and a
 * kill failure must never prevent the worker's own exit.
 */

// TS types declare the builtin's exports read-only, and in ESM environments
// the namespace object is frozen. `require('child_process')` always returns
// the mutable CJS module.exports object — the SAME object simple-git and the
// compiled spawn helpers resolve through, so patching its `spawn` property
// intercepts every spawn (same technique as commandLog.ts, proven in the
// built CJS bundle).
const require_ = createRequire(path.join(__dirname, 'prismgit.cjs'));
const cpModule = require_('child_process') as typeof childProcess;

const liveChildren = new Set<childProcess.ChildProcess>();
let installed = false;
let origSpawn: typeof childProcess.spawn | null = null;

// ── Live-pids listener (quit-orphan safety, v3.7) ──────────────────────────
// The worker reports its live child pids to the main process (which cannot
// see them otherwise — the children are grandchildren from main's point of
// view). If the worker is hard-killed BEFORE its own shutdown handler kills
// the children (wedged worker at quit), main uses the LAST reported set to
// SIGKILL the process groups itself. Without this, a wedged worker's
// in-flight `git fetch` chains orphan to init and keep the network/AV busy
// after the app is gone.
type ChildrenListener = (pids: number[]) => void;
let childrenListener: ChildrenListener | null = null;
let notifyQueued = false;

/** Coalesce add/remove bursts into ONE listener callback per event-loop turn
 *  (a repo-open burst spawns a dozen children in a few ms — the protocol
 *  must not carry a message per spawn). */
function scheduleChildrenNotify(): void {
  if (notifyQueued || !childrenListener) return;
  notifyQueued = true;
  setImmediate(() => {
    notifyQueued = false;
    try {
      childrenListener?.([...liveChildren].map((c) => c.pid ?? 0).filter((p) => p > 0));
    } catch {
      /* listener must never break tracking */
    }
  });
}

/** Register (or clear, with null) the live-pids listener. The FIRST
 *  registration immediately reports the current set so a listener attached
 *  after jobs already ran still sees existing children. */
export function setChildrenListener(listener: ChildrenListener | null): void {
  childrenListener = listener;
  scheduleChildrenNotify();
}

/**
 * Wrap child_process.spawn so every child of THIS process is tracked until
 * it exits. Idempotent. MUST run before any git work — the worker installs
 * it at module evaluation, before the 'ready' handshake lets jobs start.
 */
export function installChildTracker(): void {
  if (installed) return;
  installed = true;
  origSpawn = cpModule.spawn;
  const patched = function spawn(
    this: unknown,
    command: string,
    argv?: unknown,
    maybeOptions?: unknown,
  ): childProcess.ChildProcess {
    if (!origSpawn) throw new Error('child tracker not installed');
    // Normalize the 4 overload shapes: (cmd), (cmd, opts), (cmd, args), (cmd, args, opts)
    let args: unknown;
    let opts: childProcess.SpawnOptions | undefined;
    if (Array.isArray(argv)) {
      args = argv;
      opts = maybeOptions as childProcess.SpawnOptions | undefined;
    } else if (argv == null) {
      args = [];
      opts = maybeOptions as childProcess.SpawnOptions | undefined;
    } else {
      // (cmd, options) overload — options passed as 2nd arg
      args = [];
      opts = argv as childProcess.SpawnOptions;
    }
    // Forward the ORIGINAL overload shape: spawn(cmd, args?, opts?) — args
    // must stay a single array argument, never splatted positionally.
    // (Explicit signature — TS overload resolution struggles with .call here.)
    const spawnFn = origSpawn as unknown as (
      this: unknown,
      command: string,
      args: string[],
      options?: childProcess.SpawnOptions,
    ) => childProcess.ChildProcess;
    // POSIX: make each git child its OWN PROCESS-GROUP LEADER (detached).
    // A hung `git fetch` spawns helper chains (git remote-http → curl) that
    // plain child.kill() can't reach — killing only the direct child leaves
    // the transport helpers orphaned and holding the socket. As group
    // leaders, kill(-pid) takes the whole tree down. Exit events still fire
    // normally (detached does not detach stdio pipes). Windows: groups don't
    // work that way — the tree kill there uses `taskkill /T` instead.
    const mergedOpts = { ...opts };
    if (process.platform !== 'win32') mergedOpts.detached = true;
    const child = spawnFn.call(this, command, args as string[], mergedOpts);
    try {
      liveChildren.add(child);
      const drop = () => { liveChildren.delete(child); scheduleChildrenNotify(); };
      child.once('close', drop);
      child.once('error', drop);
      scheduleChildrenNotify();
      if (process.env.PRISMGIT_QUIT_LOG && child.pid != null) {
        console.log(`[worker pid=${process.pid}] spawn pid=${child.pid} group=${mergedOpts.detached ? 'yes' : 'no'}: ${command} ${(args as string[]).slice(0, 3).join(' ')}`);
      }
    } catch {
      /* tracking must never break spawning */
    }
    return child;
  };
  cpModule.spawn = patched as typeof childProcess.spawn;
}

/**
 * Kill every tracked live child — the WHOLE process tree, not just the
 * direct child, and with SIGKILL, not SIGTERM. Best-effort: children that
 * already exited are absent from the set; kill errors are swallowed (a
 * dying child races the bookkeeping). Returns the number of children a
 * kill was issued for.
 *
 * SIGTERM proved insufficient (verified live, Sep 2026): a `git fetch`
 * blocked in connect() to an unreachable remote — and its remote-http
 * helper chain — SURVIVED a SIGTERM sweep and lingered for minutes after
 * the app quit. SIGKILL cannot be caught/blocked. `child.killed` only
 * means "a signal was SENT earlier" — never trust it as "the child died",
 * so the sweep re-kills unconditionally.
 */
export function killAllChildren(): number {
  let killed = 0;
  for (const child of liveChildren) {
    if (child.pid == null) continue;
    try {
      if (process.platform === 'win32') {
        // Windows: child.kill() only terminates the DIRECT process and
        // ignores the helper chain. taskkill /T walks the tree, /F forces
        // (a wedged child never processes a graceful close).
        try {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          /* already gone — race between 'close' bookkeeping and this sweep */
        }
      } else {
        // POSIX: SIGKILL the process GROUP (children spawn detached = group
        // leaders, see the patched spawn above). Reaching the group also
        // kills the git-remote-http/curl helpers under a hung `git fetch`.
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Group already gone — the direct child may still linger.
          try {
            child.kill('SIGKILL');
          } catch { /* already gone */ }
        }
      }
      killed++;
    } catch {
      /* bookkeeping races must never block the shutdown sweep */
    }
  }
  liveChildren.clear();
  return killed;
}

/** Test-only: number of currently tracked live children. */
export function __trackedChildrenForTests(): number {
  return liveChildren.size;
}

/** Diagnostics (PRISMGIT_QUIT_LOG): pids currently tracked as live. */
export function __trackedChildPidsForLog(): number[] {
  return [...liveChildren].map((c) => c.pid ?? -1).filter((p) => p > 0);
}

/** Test-only: reset module state (unpatch spawn, clear the set). */
export function __resetChildTrackerForTests(): void {
  if (installed && origSpawn) {
    cpModule.spawn = origSpawn;
  }
  installed = false;
  origSpawn = null;
  liveChildren.clear();
  childrenListener = null;
  notifyQueued = false;
}
