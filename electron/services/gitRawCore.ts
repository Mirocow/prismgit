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
  // v3.8: the coalescedRaw read router (git.ts) now sends every classified
  // read/meta command here — the allow-list must cover everything the
  // classifier can classify as a read, or those commands silently stay on
  // the main loop (the exact "тупит на всех инструментах" cost we are
  // removing). Read forms only — mutating subcommands of these (notes
  // add/append, tag -d…) never reach the router: classifyGitCommand marks
  // them 'write' and the router only forwards 'read'/'meta'.
  'reflog', 'notes', 'symbolic-ref', 'var', 'whatchanged', 'verify-tag',
  'show-ref', 'check-ref-format', 'mktree', 'grep',
]);

/** Global git options that consume the NEXT argv slot as a value — kept in
 * lockstep with the classifier's GLOBAL_OPTS_WITH_VALUE in git.ts so an argv
 * like ['-C', '/repo', 'log', …] is parsed to the SAME subcommand here and
 * there. '-C' (change directory) is included: the notes/other helpers call
 * raw(['-C', repoPath, …]). */
const GLOBAL_OPTS_WITH_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

function effectiveSubcommand(argv: string[]): string | undefined {
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--' || a === undefined) return undefined;
    if (a.startsWith('-')) {
      if (GLOBAL_OPTS_WITH_VALUE.has(a)) { i += 2; continue; }
      if (a.startsWith('--') && a.includes('=')) { i += 1; continue; }
      i += 1; continue;
    }
    return a;
  }
  return undefined;
}

function isAllowed(args: string[]): boolean {
  const first = effectiveSubcommand(args);
  if (!first || !ALLOWED_COMMANDS.has(first)) return false;
  // No command injection surface: reject any arg that could shell out or
  // alter state via config/remote helpers.
  for (const a of args) {
    if (typeof a !== 'string') return false;
    if (a.startsWith('--exec') || a.includes('!')) return false;
  }
  return true;
}

/** Public form of isAllowed — the main process's coalescedRaw router uses it
 * to decide which read commands can move to the worker. Exported (not
 * re-implemented) so the two sides can never drift apart. */
export function rawJobIsAllowed(args: string[]): boolean {
  return isAllowed(args);
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
