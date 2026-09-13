import * as childProcess from 'child_process';
import { createRequire } from 'module';
import * as path from 'path';
import type { CommandLogEntry } from '../types/command-log-api.js';

/**
 * Git Command Logger
 * ==================
 *
 * Captures every actual `git <args>` child process the main process spawns —
 * from simple-git (which spawns git internally for ~every operation) and from
 * custom `spawnGitCapture` helpers — together with its full stdout/stderr and
 * exit code.
 *
 * How it works: `child_process.spawn` is wrapped once at app startup. Any
 * spawned binary whose basename is `git` (git / git.exe / git.cmd) is tailed
 * for output and recorded into an in-memory ring buffer. Non-git spawns pass
 * through untouched. This gives an honest, low-level history of git activity
 * (the thing the Output panel's operation log cannot show: raw command lines,
 * raw git output, exit codes), while keeping 100+ call sites unchanged.
 *
 * Privacy: credentials embedded in remote URLs (https://user:pass@host) are
 * redacted from recorded arguments; environment is never recorded.
 */

const MAX_ENTRIES = 500;
const MAX_STREAM_CHARS = 32 * 1024;
const TRUNCATED_MARKER = '\n… (output truncated)';

const entries: CommandLogEntry[] = [];
let nextId = 1;
let installed = false;
let origSpawn: typeof childProcess.spawn | null = null;
let onEntryCb: ((entry: CommandLogEntry) => void) | null = null;

// TS types declare the builtin's exports read-only, and in ESM environments
// (vitest) the namespace object is frozen. `require('child_process')` always
// returns the mutable CJS module.exports object — the SAME object that
// simple-git and our own compiled spawn helpers resolve through, so patching
// its `spawn` property intercepts every git spawn in the app, in production
// (CJS main bundle) and in tests alike.
//
// Use __dirname as the base for createRequire so it works in production
// (packaged app) where process.cwd() may be outside the app bundle.
const require_ = createRequire(path.join(__dirname, 'prismgit.cjs'));
const cpModule = require_('child_process') as typeof childProcess;

/** Redact credentials embedded in URLs: scheme://user:pass@host → scheme://***@host */
export function sanitizeArg(arg: string): string {
  return arg.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1***@');
}

/** Accumulates a stream's chunks up to MAX_STREAM_CHARS. Exported for tests. */
export class StreamTailer {
  private text = '';
  private truncated = false;
  push(chunk: Buffer | string): void {
    if (this.text.length >= MAX_STREAM_CHARS) {
      this.truncated = true;
      return;
    }
    this.text += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (this.text.length > MAX_STREAM_CHARS) {
      this.text = this.text.slice(0, MAX_STREAM_CHARS);
      this.truncated = true;
    }
  }
  result(): string {
    return this.text + (this.truncated ? TRUNCATED_MARKER : '');
  }
}

function isGitBinary(command: string): boolean {
  const base = command.replace(/\\/g, '/').split('/').pop() || command;
  return base === 'git' || base === 'git.exe' || base === 'git.cmd' || base === 'git.bat';
}

function normalizeArgs(argv: unknown): string[] {
  if (argv == null) return [];
  if (typeof argv === 'string') return [argv];
  if (Array.isArray(argv)) return argv.map((a) => String(a));
  return [String(argv)];
}

function recordSpawn(
  command: string,
  rawArgs: unknown,
  options: childProcess.SpawnOptions | undefined,
  child: childProcess.ChildProcess,
): void {
  const id = nextId++;
  const started = Date.now();
  const out = new StreamTailer();
  const err = new StreamTailer();

  if (child.stdout) child.stdout.on('data', (c: Buffer | string) => out.push(c));
  if (child.stderr) child.stderr.on('data', (c: Buffer | string) => err.push(c));

  let done = false;
  const finalize = (exitCode: number | null, signal: string | null) => {
    if (done) return; // 'error' may be followed by 'close' (or vice versa) — record once
    done = true;
    const args = normalizeArgs(rawArgs).map(sanitizeArg);
    const entry: CommandLogEntry = {
      id,
      timestamp: started,
      repo: (options && typeof options.cwd === 'string' && options.cwd) || process.cwd(),
      args,
      exitCode,
      signal,
      durationMs: Date.now() - started,
      stdout: out.result(),
      stderr: err.result(),
    };
    entries.unshift(entry); // newest first
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    try {
      onEntryCb?.(entry);
    } catch {
      /* listener errors must not break the spawned command */
    }
  };

  child.on('close', (code, signal) => finalize(code, signal ?? null));
  child.on('error', () => finalize(null, null));
}

export interface GitCommandLoggerOptions {
  /** Called on every recorded entry (used to broadcast to renderer windows). */
  onEntry?: (entry: CommandLogEntry) => void;
}

/**
 * Install the spawn interceptor. Must be called once, before any git work
 * (i.e. at the very start of the app's ready handler). Idempotent.
 */
export function installGitCommandLogger(options: GitCommandLoggerOptions = {}): void {
  if (installed) return;
  installed = true;
  onEntryCb = options.onEntry ?? null;
  origSpawn = cpModule.spawn; // original unpatched spawn (same object we patch below)

  const patched = function spawn(
    this: unknown,
    command: string,
    argv?: unknown,
    maybeOptions?: unknown,
  ): childProcess.ChildProcess {
    if (!origSpawn) throw new Error('git command logger not installed');
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
      if (isGitBinary(command)) recordSpawn(command, args, opts, child);
    } catch {
      /* logging must never break spawning */
    }
    return child;
  };
  (patched as unknown as { __prismGitCommandLogger?: boolean }).__prismGitCommandLogger = true;
  cpModule.spawn = patched as typeof childProcess.spawn;
}

/** Remove the interceptor (tests). Restores the original spawn. */
export function uninstallGitCommandLogger(): void {
  if (!installed) return;
  if (origSpawn) cpModule.spawn = origSpawn;
  origSpawn = null;
  installed = false;
  onEntryCb = null;
}

export function listEntries(): CommandLogEntry[] {
  return entries.slice();
}

export function clearEntries(): void {
  entries.length = 0;
}

/** Test helper: reset the buffer and id counter without touching the patch. */
export function resetForTests(): void {
  entries.length = 0;
  nextId = 1;
}
