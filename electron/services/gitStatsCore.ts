import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { GIT_UNSAFE_OPTIONS, withMergedGitEnv } from './git-env.js';

/**
 * GIT STATS JOB CORE — the git work of `storage.refreshRepoStats()` (the
 * sidebar's per-repo metadata: last commit, branch count, commit count,
 * remote URL / provider), extracted so it can run in the SEPARATE background
 * git worker process (gitPollWorker) instead of the Electron main process.
 *
 * WHY: the "Check all repositories for remote changes" button and every repo
 * open used to fan out FOUR git subprocesses per repository ON THE MAIN EVENT
 * LOOP (log -1 + branchLocal + getRemotes + rev-list --count). With a
 * sidebar of N repos that is 4N spawns whose bookkeeping and output pumping
 * queue behind every renderer IPC round-trip — the reported "UI goes fully
 * unresponsive while the check runs". The remote-check poll itself already
 * lives in this worker (gitPollCore); the stats sweep is the other half of
 * the same button, so it moves here too.
 *
 * This module is DELIBERATELY free of `electron` and settings imports: the
 * job takes a repo path, returns plain data, and the CALLER (main process)
 * persists the result into the settings store. In non-Electron hosts
 * (vitest) the same function runs in-process — byte-identical behavior,
 * which is what the existing storage tests pin.
 */

/** One stats job for a single repository — plain data in. */
export interface StatsJobRequest {
  /** Absolute repository path. */
  repoPath: string;
}

/** The git-computed part of RepositoryMetadata — plain data out. */
export interface StatsJobResult {
  /** True when <repoPath>/.git exists — distinguishes a REAL (possibly
   *  unborn) repository from a directory that is not a repo at all. The
   *  caller keeps old metadata for the latter and writes zeros for the
   *  former (an unborn repo legitimately has 0 commits). */
  isRepo: boolean;
  lastCommitHash?: string;
  lastCommitDate?: string;
  lastCommitMessage?: string;
  branchCount: number;
  commitCount: number;
  remoteUrl?: string;
  provider: 'github' | 'gitlab' | 'unknown';
  owner?: string;
  repo?: string;
  webUrl?: string;
}

/**
 * Execute one stats job: the four independent reads (log -1, branch list,
 * remotes, commit count), then the provider classification from the remote
 * URL. Mirrors the pre-extraction behavior exactly — same commands, same
 * flags, same error semantics (every read degrades to a default instead of
 * throwing) — so foreground/background results can never drift.
 */
export async function runStatsJob(req: StatsJobRequest): Promise<StatsJobResult> {
  const result: StatsJobResult = {
    isRepo: false,
    branchCount: 0,
    commitCount: 0,
    provider: 'unknown',
  };

  if (!fs.existsSync(path.join(req.repoPath, '.git'))) {
    return result;
  }
  result.isRepo = true;

  // PERF: run all reads in parallel — they are independent. Same instance
  // shape as the poll core's local-counter reads (private to this job, max
  // 4 concurrent, LFS smudge filters disabled via GIT_UNSAFE_OPTIONS).
  const git: SimpleGit = withMergedGitEnv(
    simpleGit({
      baseDir: req.repoPath,
      binary: 'git',
      maxConcurrentProcesses: 4,
      trimmed: false,
      ...GIT_UNSAFE_OPTIONS,
    })
  );

  const [logRaw, branchResult, remotes, commitCountStr] = await Promise.all([
    // PERF: git.raw instead of git.log — avoids simple-git's full LogEntry parsing
    git.raw(['log', '-1', '--format=%H%x1f%s%x1f%cI']).catch(() => ''),
    git.branchLocal().catch(() => ({ all: [] as string[] })),
    git.getRemotes(true).catch(() => [] as Array<{ name: string; refs: { fetch: string } }>),
    git.raw(['rev-list', '--count', 'HEAD']).catch(() => '0'),
  ]);

  // Parse the raw log output: hash\x1fsubject\x1fdate
  const logParts = logRaw.trim().split('\x1f');
  const latest = logParts.length >= 3
    ? { hash: logParts[0], date: logParts[2].trim(), message: logParts[1] }
    : null;
  const origin = (remotes as Array<{ name: string; refs: { fetch: string } }>).find(r => r.name === 'origin') ||
    (remotes as Array<{ name: string; refs: { fetch: string } }>)[0];
  const url = origin?.refs.fetch;
  const commitCount = parseInt((commitCountStr || '0').trim(), 10) || 0;

  // Detect provider
  let provider: StatsJobResult['provider'] = 'unknown';
  let owner: string | undefined;
  let repo: string | undefined;
  let webUrl: string | undefined;

  if (url) {
    const sshMatch = url.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
    const httpsMatch = url.match(/https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);
    const match = sshMatch || httpsMatch;
    if (match) {
      const [, host, ownerName, repoName] = match;
      webUrl = `https://${host}/${ownerName}/${repoName}`;
      // Match by host substring so self-hosted instances are detected too:
      //   github.com, github.company.com  → github
      //   gitlab.com, gitlab.company.com  → gitlab
      // We no longer classify bitbucket/gitea/gogs because there is no API
      // integration for them — they will be 'unknown' and the UI will offer
      // manual GitHub/GitLab selection.
      if (host.includes('github')) { provider = 'github'; owner = ownerName; repo = repoName; }
      else if (host.includes('gitlab')) { provider = 'gitlab'; owner = ownerName; repo = repoName; }
    }
  }

  result.lastCommitHash = latest?.hash;
  result.lastCommitDate = latest?.date;
  result.lastCommitMessage = latest?.message;
  result.branchCount = (branchResult as { all: string[] }).all.length;
  result.commitCount = commitCount;
  result.remoteUrl = url;
  result.provider = provider;
  result.owner = owner;
  result.repo = repo;
  result.webUrl = webUrl;

  return result;
}
