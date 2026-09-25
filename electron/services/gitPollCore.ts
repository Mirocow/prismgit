import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { GIT_SSH_UNSAFE_OPTIONS, GIT_UNSAFE_OPTIONS, withMergedGitEnv } from './git-env.js';

/**
 * GIT POLL JOB CORE — the actual git work of the periodic remote check
 * (pollRemoteSummary), extracted so it can run in a SEPARATE PROCESS.
 *
 * Why a separate process: the poll used to run inside the Electron MAIN
 * process. The main process is also the IPC broker for every renderer
 * interaction (status refreshes, diffs, logs — the whole UI). One poll cycle
 * spawns, per repo: 1 network fetch + symbolic-ref + 2 rev-list walks +
 * `status --porcelain`, with all the subprocess bookkeeping and output
 * pumping on the main event loop. With a sidebar of many repos the main
 * process got saturated and every UI IPC round-trip queued behind poll
 * churn — the reported "interface freezes while remote repos are being
 * checked, worse with every repo switch".
 *
 * This module is DELIBERATELY free of `electron`, settings and secrets
 * imports: everything environment-dependent (which remotes are opted into
 * the background fetch, SSH env incl. askpass secrets, HTTP auth `-c` args)
 * is resolved by the caller IN THE MAIN PROCESS and passed in as plain
 * serializable data (see PollJobRequest). That keeps the worker process
 * dumb and the secrets (askpass passphrase scripts, HTTP tokens) confined
 * to main — the worker only ever sees transient env-var strings.
 *
 * Execution hosts:
 *  - Electron main: `electron/services/gitPollWorker.ts` (utilityProcess)
 *    via `gitPollProcess.runPollJobExternal()`;
 *  - vitest / non-Electron node: imported directly as the fallback path —
 *    exactly the behavior the poll had before the process split, so all
 *    existing unit/integration contracts keep holding.
 */

/** Inactivity timeout for the network fetch of a remote check. simple-git's
 * timeoutPlugin KILLS the child process after this many ms WITHOUT output on
 * stdout/stderr (every chunk resets the timer, so a slow-but-active download
 * is never killed — only a truly hung one: unreachable host, stalled TLS,
 * dead VPN). This replaces the old Promise.race which rejected the caller
 * but left the git subprocess RUNNING — repeated polls against a slow
 * remote accumulated zombie fetches (the "switching repos gets slower and
 * slower" report: every poll cycle spawned a fresh fetch while the previous
 * ones were still alive). */
export const DEFAULT_REMOTE_FETCH_TIMEOUT_MS = 60_000;

/** One poll job for a single repository, fully described by plain data. */
export interface PollJobRequest {
  /** Absolute repository path. */
  repoPath: string;
  /** Remotes opted into "Perform background Poll or Fetch" (intersected
   *  with the repo's actual remotes by the main-side caller). Empty → the
   *  job skips the network phase entirely. */
  checkedRemotes: string[];
  /** SSH env (GIT_SSH_COMMAND / SSH_ASKPASS…) resolved main-side. The
   *  askpass temp-file cleanup stays in MAIN (the file path lives in
   *  sshEnvVars.SSH_ASKPASS) — the worker never deletes main's files. */
  sshEnvVars: Record<string, string>;
  /** Per-remote HTTP(S) auth `-c` args (http.extraHeader etc.) resolved
   *  main-side from the credential vault. */
  authArgs: Record<string, string[]>;
  /** simple-git block timeout for the fetch phase (kill hung fetches). */
  fetchTimeoutMs: number;
}

/** The git-computed part of a RemoteCheckSummary (the caller merges this
 *  into its own summary skeleton). Plain data — crosses the process
 *  boundary unchanged. */
export interface PollJobResult {
  fetched: boolean;
  error: string | null;
  branch: string | null;
  incoming: number;
  outgoing: number;
  dirty: number;
}

async function countRevList(git: SimpleGit, args: string[]): Promise<number> {
  const out = await git.raw(args);
  return parseInt(out.trim(), 10) || 0;
}

/**
 * Execute one poll job: (optional) network fetch of the opted-in remotes,
 * then the four cheap local reads (symbolic-ref, incoming/outgoing
 * rev-list counts, dirty-file count). Mirrors the pre-split behavior
 * exactly — same instances, same flags, same error semantics — so the
 * pollFetchKill / remoteCheck test contracts keep holding on either host.
 */
export async function runPollJob(req: PollJobRequest): Promise<PollJobResult> {
  const result: PollJobResult = {
    fetched: false,
    error: null,
    branch: null,
    incoming: 0,
    outgoing: 0,
    dirty: 0,
  };

  // 1. Network fetch. Refresh ONLY the remotes whose "Perform background
  //    Poll or Fetch" checkbox is enabled — never every remote of every
  //    repository. With no checked remotes there is no network activity at
  //    all (counters reflect the last fetch).
  //    GIT_TERMINAL_PROMPT=0 so a credential prompt can never hang the
  //    background poll; per-remote timeout as a safety net.
  //    NOTE: only the override variable goes into .env() — spreading the full
  //    process.env here would trip simple-git's "unsafe operations" guard
  //    whenever the user's environment contains EDITOR/PAGER etc.
  const checked = req.checkedRemotes ?? [];
  if (checked.length > 0 && fs.existsSync(path.join(req.repoPath, '.git'))) {
    // SSH env (GIT_SSH_COMMAND / askpass) is resolved ONCE by the caller
    // from the first checked remote — key selection is per-repo, so the env
    // is identical for every remote of this repository.
    const fetchGit = withMergedGitEnv(
      simpleGit({
        baseDir: req.repoPath,
        binary: 'git',
        ...GIT_SSH_UNSAFE_OPTIONS,
        // Kills the child process after fetchTimeoutMs without output —
        // the old Promise.race only rejected the CALLER; the fetch
        // subprocess kept running and accumulated across poll cycles.
        timeout: { block: req.fetchTimeoutMs || DEFAULT_REMOTE_FETCH_TIMEOUT_MS },
      }),
      { ...req.sshEnvVars, GIT_TERMINAL_PROMPT: '0' }
    );
    const perRemote = async (name: string): Promise<void> => {
      const authArgs = req.authArgs?.[name] ?? [];
      try {
        await fetchGit.raw([...authArgs, 'fetch', '--prune', '--quiet', name]);
      } catch (e) {
        // simple-git's timeoutPlugin rejects with 'block timeout reached'.
        // Surface a message consistent with the old race-based timeout.
        const msg = e instanceof Error ? e.message : String(e);
        if (/timeout/i.test(msg)) {
          throw new Error(`fetch timed out after ${(req.fetchTimeoutMs || DEFAULT_REMOTE_FETCH_TIMEOUT_MS) / 1000}s (process killed)`);
        }
        throw e;
      }
    };
    const settled = await Promise.allSettled(checked.map(perRemote));
    const errors = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    if (errors.length === 0) {
      result.fetched = true;
    } else if (errors.length === checked.length) {
      result.error = errors.join('; ');
    } else {
      // At least one remote refreshed the refs; surface partial failures.
      result.fetched = true;
      result.error = errors.join('; ');
    }
  }

  // 2. Local counters. PERF (v3.2, remote-check): these run on a DEDICATED
  //    short-lived instance, NOT on any shared queue the repo-open /
  //    status-refresh burst depends on — a poll landing mid-switch can
  //    never put its two `rev-list --count` walks (expensive on big repos)
  //    and its `status --porcelain` in front of the foreground status the
  //    user is actively waiting for.
  const pollGit = withMergedGitEnv(
    simpleGit({
      baseDir: req.repoPath,
      binary: 'git',
      maxConcurrentProcesses: 4,
      trimmed: false,
      ...GIT_UNSAFE_OPTIONS,
    })
  );

  // PERF (v3): the four reads below are completely INDEPENDENT but used to
  // run sequentially — 4 round-trips of subprocess spawn+exec per repo per
  // poll. On a sidebar with 10 repos that's 40 serialized spawns per poll
  // cycle. They now run in one Promise.all: wall time drops from sum(...) to
  // max(...).
  const [branchName, incomingRaw, outgoingRaw, dirtyRaw] = await Promise.all([
    pollGit.raw(['symbolic-ref', '--short', '-q', 'HEAD'])
      .then((out) => out.trim())
      .catch(() => ''),
    countRevList(pollGit, ['rev-list', '--count', '--remotes', '--not', '--branches'])
      .then((n) => n)
      .catch(() => 0),
    countRevList(pollGit, ['rev-list', '--count', '--branches', '--not', '--remotes'])
      .then((n) => n)
      .catch(() => 0),
    pollGit.raw(['status', '--porcelain', '--ignore-submodules=all'])
      .then((status) => status.split('\n').filter((line) => line.trim().length > 0).length)
      .catch(() => 0),
  ]);
  result.branch = branchName || null; // empty → detached or unborn
  result.incoming = incomingRaw;
  result.outgoing = outgoingRaw;
  result.dirty = dirtyRaw;

  return result;
}
