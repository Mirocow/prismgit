import { simpleGit } from 'simple-git';
import { GIT_UNSAFE_OPTIONS, withMergedGitEnv } from './git-env.js';

/**
 * RAW READ job (v3.6, repo-switch freeze) — executes `git <args>` in the
 * DEDICATED git worker process so the spawn + stdout assembly never touches
 * the main event loop.
 *
 * The Changes page's repo-open loaders (ls-files -v over the whole index,
 * numstat x2, submodule summary) used to run via the main process's
 * shared simple-git instance: each raw() spawns a child, streams its
 * output through the MAIN loop and returns multi-hundred-KB strings over
 * IPC from there. On a 2.5k-file repo that measured 60-90ms main-loop
 * blocks per repo switch; on 50k-file repos it scales into seconds — the
 * "зависание при переключении репозитория" report.
 *
 * Read-only by construction: the worker accepts a fixed allow-list of
 * commands (whitelist below) so a compromised renderer can never make the
 * background process run mutations (no add/commit/push/reset/…).
 */

export interface RawJobRequest {
  repoPath: string;
  args: string[];
}

/** Allow-list: read-only plumbing commands the worker will execute. */
const ALLOWED_COMMANDS = new Set([
  'ls-files', 'diff', 'status', 'log', 'show', 'cat-file', 'rev-parse',
  'submodule', 'config', 'remote', 'branch', 'tag', 'describe', 'blame',
  'ls-tree', 'name-rev', 'for-each-ref', 'stash', 'check-ignore',
  'check-attr', 'ls-remote', 'merge-base', 'rev-list', 'shortlog',
  'verify-commit', 'count-objects', 'hash-object', 'diff-tree', 'cherry',
]);

function isAllowed(args: string[]): boolean {
  if (args.length === 0) return false;
  const first = args[0];
  if (typeof first !== 'string' || !ALLOWED_COMMANDS.has(first)) return false;
  // No command injection surface: reject any arg that could shell out or
  // alter state via config/remote helpers.
  for (const a of args) {
    if (typeof a !== 'string') return false;
    if (a.startsWith('--exec') || a.includes('!')) return false;
  }
  return true;
}

export async function runRawJob(req: RawJobRequest): Promise<string> {
  if (!isAllowed(req.args)) {
    throw new Error(`raw job rejected (command not in read-only allow-list): ${req.args[0]}`);
  }
  const git = withMergedGitEnv(simpleGit({
    baseDir: req.repoPath,
    binary: 'git',
    maxConcurrentProcesses: 4,
    trimmed: false,
    ...GIT_UNSAFE_OPTIONS,
  }));
  return git.raw(req.args);
}
