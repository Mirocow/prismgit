import * as childProcess from 'child_process';
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
    const child = spawnFn.call(this, command, args as string[], opts);
    try {
      liveChildren.add(child);
      const drop = () => liveChildren.delete(child);
      child.once('close', drop);
      child.once('error', drop);
    } catch {
      /* tracking must never break spawning */
    }
    return child;
  };
  cpModule.spawn = patched as typeof childProcess.spawn;
}

/**
 * Kill every tracked live child. Best-effort, synchronous issue of kills:
 * children that already exited are absent from the set; kill errors are
 * swallowed (a dying child races the bookkeeping). Returns the number of
 * children a kill was issued for.
 */
export function killAllChildren(): number {
  let killed = 0;
  for (const child of liveChildren) {
    try {
      // !child.killed filters processes we already sent a signal to; a child
      // may still be winding down (exit event not yet delivered).
      if (!child.killed && child.pid != null) {
        child.kill();
        killed++;
      }
    } catch {
      /* already gone — race between 'close' bookkeeping and this sweep */
    }
  }
  liveChildren.clear();
  return killed;
}

/** Test-only: number of currently tracked live children. */
export function __trackedChildrenForTests(): number {
  return liveChildren.size;
}

/** Test-only: reset module state (unpatch spawn, clear the set). */
export function __resetChildTrackerForTests(): void {
  if (installed && origSpawn) {
    cpModule.spawn = origSpawn;
  }
  installed = false;
  origSpawn = null;
  liveChildren.clear();
}
