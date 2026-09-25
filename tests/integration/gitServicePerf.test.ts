/**
 * PERF regression tests (v3 optimizations) — subprocess-count budgets for
 * the hottest git-service endpoints.
 *
 * Each optimization in the v3 pass removed redundant subprocesses from a
 * hot path. These tests pin the NEW spawn counts so a future change cannot
 * silently regress them (e.g. re-adding the `rev-parse --verify HEAD`
 * preflight to status(), or a git.status() call inside branches()).
 *
 * How counting works: the read-coalescing wrapper (installReadCoalescing)
 * counts every subprocess it launches in per-repo stats
 * (__readCoalescingStats). We reset the counters before each measurement
 * and assert on the delta. This observes the wrapper realm regardless of
 * how simple-git spawns (same technique as readCoalescing.test.ts).
 *
 * Counts are EXACT on a warmed repo (gitDirCache + remotes cache already
 * populated by the warm-up call, read-coalescing stats freshly reset —
 * which also clears the 1s meta TTL cache).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as gitService from '../../electron/services/git';
import { invalidateReadCache, __readCoalescingStats } from '../../electron/services/git';

const ROOT = path.join(os.tmpdir(), `prismgit-perf-${Date.now()}`);
const NORMAL = path.join(ROOT, 'normal');
const UNBORN = path.join(ROOT, 'unborn');
const WITH_UPSTREAM = path.join(ROOT, 'with-upstream');
const REMOTE = path.join(ROOT, 'remote.git');

const NL = String.fromCharCode(10);

function sh(cmd: string, cwd: string = ROOT): void {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Run `fn` and return how many git subprocesses it launched.
 *
 * Uses invalidateReadCache (NOT __resetReadCoalescingForTests) to clear the
 * 1s meta TTL cache — a full reset would orphan the cached proxy's stats
 * object from the registry and every subsequent read of
 * __readCoalescingStats would return undefined. Counting the DELTA around
 * the call keeps the proxy + its stats alive and warm.
 */
async function measure(repoPath: string, fn: () => Promise<unknown>) {
  invalidateReadCache(repoPath);
  const before = __readCoalescingStats(repoPath)?.subprocesses ?? 0;
  await fn();
  const after = __readCoalescingStats(repoPath)?.subprocesses ?? 0;
  return { subprocesses: after - before };
}

beforeAll(async () => {
  fs.mkdirSync(ROOT, { recursive: true });

  // ── normal repo: 3 commits, one file modified ──
  sh(`git init -q -b main "${NORMAL}"`);
  sh('git config user.name "T"', NORMAL);
  sh('git config user.email t@t', NORMAL);
  fs.writeFileSync(path.join(NORMAL, 'a.txt'), 'one' + NL);
  sh('git add a.txt', NORMAL);
  sh('git commit -q -m init', NORMAL);
  fs.writeFileSync(path.join(NORMAL, 'b.txt'), 'two' + NL);
  sh('git add b.txt', NORMAL);
  sh('git commit -q -m second', NORMAL);
  fs.writeFileSync(path.join(NORMAL, 'a.txt'), 'one CHANGED' + NL);
  sh('git add a.txt', NORMAL);
  sh('git commit -q -m third', NORMAL);

  // ── unborn repo: git init only ──
  sh(`git init -q -b main "${UNBORN}"`);
  fs.writeFileSync(path.join(UNBORN, 'fresh.txt'), 'fresh' + NL);

  // ── with-upstream repo: bare remote + pushed branch + divergence ──
  sh(`git init -q -b main --bare "${REMOTE}"`);
  sh(`git clone -q "${REMOTE}" "${WITH_UPSTREAM}"`);
  sh('git checkout -q -b main', WITH_UPSTREAM);
  sh('git config user.name "T"', WITH_UPSTREAM);
  sh('git config user.email t@t', WITH_UPSTREAM);
  fs.writeFileSync(path.join(WITH_UPSTREAM, 'base.txt'), 'base' + NL);
  sh('git add base.txt', WITH_UPSTREAM);
  sh('git commit -q -m base', WITH_UPSTREAM);
  sh('git push -q -u origin main', WITH_UPSTREAM);
  // Local-only commit → ahead 1 (remote doesn't have it).
  fs.writeFileSync(path.join(WITH_UPSTREAM, 'local.txt'), 'local' + NL);
  sh('git add local.txt', WITH_UPSTREAM);
  sh('git commit -q -m local-only', WITH_UPSTREAM);
  // Extra local branches for the log() multi-branch budget test below
  // (created WITHOUT checkout so `main` stays the current branch).
  sh('git branch feat/a', WITH_UPSTREAM);
  sh('git branch feat/b', WITH_UPSTREAM);
  sh('git branch feat/c', WITH_UPSTREAM);

  // Warm the per-repo caches (gitDirCache, poll/remotes caches, coalescing
  // state) so the measurements below count steady-state behavior.
  // AWAIT them — a fire-and-forget warm-up races the first test and the
  // resolveGitDir rev-parse lands inside its measurement window.
  await gitService.status(NORMAL);
  await gitService.status(UNBORN);
  await gitService.status(WITH_UPSTREAM);
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('status() — single-subprocess budget (v3: rev-parse preflight removed)', () => {
  it('normal repo: exactly 1 subprocess (was 2: rev-parse --verify + status)', async () => {
    const m = await measure(NORMAL, () => gitService.status(NORMAL));
    expect(m.subprocesses).toBe(1);
  });

  it('unborn HEAD repo: exactly 1 subprocess and correct payload', async () => {
    const m = await measure(UNBORN, () => gitService.status(UNBORN));
    // simple-git's .status() handles `## No commits yet on main` natively —
    // no preflight, no fallback, no throw.
    expect(m.subprocesses).toBe(1);
    const s = await gitService.status(UNBORN);
    expect(s.current).toBe('main');
    expect(s.not_added).toContain('fresh.txt');
    // NOTE: the project's StatusResult contract exposes isClean as a
    // BOOLEAN (already evaluated), not a function.
    expect(s.isClean).toBe(false);
  });

  it('result is complete: files, staged buckets, current branch', async () => {
    const s = await gitService.status(NORMAL);
    expect(s.current).toBe('main');
    expect(s.isClean).toBe(true);
    expect(s.files).toHaveLength(0);
  });
});

describe('branches() — for-each-ref-only budget (v3: git.status() dropped)', () => {
  it('exactly 2 subprocesses (two for-each-ref calls), no status spawn', async () => {
    const m = await measure(WITH_UPSTREAM, () => gitService.branches(WITH_UPSTREAM));
    // Before v3: git.status() + 2× for-each-ref + rev-parse gone-probe = 4.
    // After v3: exactly the two for-each-ref reads.
    expect(m.subprocesses).toBe(2);
  });

  it('current branch tracking/ahead/behind still correct without git status', async () => {
    const brs = await gitService.branches(WITH_UPSTREAM);
    const main = brs.find((b) => !b.remote && b.name === 'main')!;
    expect(main.current).toBe(true);
    expect(main.tracking).toBe('origin/main');
    // local-only commit pushed branch is missing on remote → ahead 1.
    // v3 keeps git-status semantics for the CURRENT branch (0 when in sync).
    expect(main.ahead).toBe(1);
    expect(main.behind).toBe(0);
    expect(main.gone).toBeUndefined();
  });

  it('unborn repo: no local branches, no crash', async () => {
    const brs = await gitService.branches(UNBORN);
    expect(brs.filter((b) => !b.remote)).toHaveLength(0);
  });
});

describe('commitFiles() — 3-subprocess budget (v3: preflight dropped, numstat parallel)', () => {
  it('normal commit: exactly 3 subprocesses with numstat filled in', async () => {
    const hash = execSync('git rev-parse HEAD', { cwd: NORMAL, encoding: 'utf-8' }).trim();
    const files: gitService.CommitFile[] = [];
    const m = await measure(NORMAL, async () => {
      const r = await gitService.commitFiles(NORMAL, hash);
      files.push(...r);
    });
    // rev-list --parents + show --name-status + show --numstat (the last two
    // in parallel). Before v3: 4 sequential spawns.
    expect(m.subprocesses).toBe(3);
    expect(files.length).toBeGreaterThan(0);
    // numstat data must still be merged in (parallel path worked).
    expect(files[0].additions).toBeGreaterThanOrEqual(0);
    expect(files[0].deletions).toBeGreaterThanOrEqual(0);
  });

  it('bad hash: 1 subprocess, empty list (rev-list validates existence)', async () => {
    let result: gitService.CommitFile[] = [];
    const m = await measure(NORMAL, async () => {
      result = await gitService.commitFiles(NORMAL, '0123456789abcdef0123456789abcdef01234567');
    });
    expect(m.subprocesses).toBe(1); // just the failing rev-list
    expect(result).toEqual([]);
  });
});

describe('diffCommit() — preflights dropped (v3)', () => {
  it('no parentHash: exactly 2 subprocesses and parses hunks', async () => {
    const log = await gitService.log(NORMAL, { maxCount: 1 });
    let diff: Awaited<ReturnType<typeof gitService.diffCommit>> | null = null;
    const m = await measure(NORMAL, async () => {
      diff = await gitService.diffCommit(NORMAL, log[0].hash);
    });
    // rev-list --parents (root/parent detection) + the diff itself.
    // Before v3: 2× commitExists + rev-list + diff = 4.
    expect(m.subprocesses).toBe(2);
    expect(diff).not.toBeNull();
  });

  it('with parentHash: exactly 1 subprocess (no preflights, no rev-list)', async () => {
    const log = await gitService.log(NORMAL, { maxCount: 2 });
    let diff: Awaited<ReturnType<typeof gitService.diffCommit>> | null = null;
    const m = await measure(NORMAL, async () => {
      diff = await gitService.diffCommit(NORMAL, log[0].hash, log[1].hash);
    });
    // Only the `git diff <parent>..<hash>` call remains.
    expect(m.subprocesses).toBe(1);
    expect(diff).not.toBeNull();
  });

  it('bad hash: empty diff, no throw (was: empty via preflight)', async () => {
    const diff = await gitService.diffCommit(NORMAL, '0123456789abcdef0123456789abcdef01234567');
    expect(diff.hunks).toEqual([]);
    expect(diff.newFile).toBe(false);
  });

  it('root commit: uses git show (full diff vs empty tree)', async () => {
    const root = execSync('git rev-list --max-parents=0 HEAD', { cwd: NORMAL, encoding: 'utf-8' }).trim();
    const diff = await gitService.diffCommit(NORMAL, root);
    // Root commit shows every file as new — the parser marks it.
    expect(diff.newFile).toBe(true);
    expect(diff.hunks.length).toBeGreaterThan(0);
  });
});

describe('pollRemoteSummary() — parallel step batch (v3.2: decoupled from the shared queue)', () => {
  it('local poll commands do NOT occupy the shared getGit queue (repo-open burst stays free)', async () => {
    // Poll NORMAL (no remotes configured → network fetch skipped).
    //   getRemotes(1) + symbolic-ref + 2× rev-list + status (4 concurrent)
    //
    // v3.2: the four local reads run on a DEDICATED short-lived instance, so
    // the shared-queue coalescing stats only observe the getRemotes spawn.
    // Before v3.2 the delta was 5 — the poll's two rev-list walks and its
    // status sat in the SAME 4-slot queue the repo-open / status-refresh
    // burst depends on, delaying every repo switch while a poll ran.
    // The full 5-spawn budget (4 local + getRemotes) is pinned at the mock
    // level in tests/unit/pollFetchKill.test.ts (it sees every instance).
    let summary: Awaited<ReturnType<typeof gitService.pollRemoteSummary>> | null = null;
    const m = await measure(NORMAL, async () => {
      summary = await gitService.pollRemoteSummary(NORMAL);
    });
    expect(summary!.branch).toBe('main');
    expect(summary!.dirty).toBe(0);
    expect(summary!.hasRemote).toBe(false);
    // Only getRemotes goes through the shared queue now.
    expect(m.subprocesses).toBe(1);
  }, 20_000);
});

describe('log() — batched branch validation (v3.1: N rev-parse → 1 for-each-ref)', () => {
  it('head+upstream pair: exactly 2 subprocesses (was 3: 2 rev-parse + log)', async () => {
    let entries: gitService.LogEntry[] = [];
    const m = await measure(WITH_UPSTREAM, async () => {
      entries = await gitService.log(WITH_UPSTREAM, { branches: ['main', 'origin/main'] });
    });
    // 1× for-each-ref (validates BOTH refs — TTL-cached meta read shared
    // with the renderer's incoming-commits validation) + 1× git log.
    expect(m.subprocesses).toBe(2);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('5 selected branches: still 2 subprocesses (was 6: 5 rev-parse + log)', async () => {
    let entries: gitService.LogEntry[] = [];
    const m = await measure(WITH_UPSTREAM, async () => {
      entries = await gitService.log(WITH_UPSTREAM, {
        branches: ['main', 'feat/a', 'feat/b', 'feat/c', 'origin/main'],
      });
    });
    // The one for-each-ref lists EVERY ref in the repo — validation cost is
    // O(1) subprocesses no matter how many branches the user selected.
    expect(m.subprocesses).toBe(2);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('non-ref spec (SHA) still works via the rev-parse fallback', async () => {
    const sha = execSync('git rev-parse HEAD', { cwd: WITH_UPSTREAM, encoding: 'utf-8' }).trim();
    let entries: gitService.LogEntry[] = [];
    const m = await measure(WITH_UPSTREAM, async () => {
      entries = await gitService.log(WITH_UPSTREAM, { branches: ['main', sha] });
    });
    // 1× for-each-ref + 1× rev-parse --verify (the SHA is not a ref name)
    // + 1× git log.
    expect(m.subprocesses).toBe(3);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('invalid refs are skipped, not fatal', async () => {
    const entries = await gitService.log(WITH_UPSTREAM, {
      branches: ['main', 'deleted-branch', 'origin/pruned'],
    });
    // Both invalid refs silently dropped — log ran with the valid one.
    expect(entries.length).toBeGreaterThan(0);
    // And with ONLY invalid refs: empty result, no throw.
    const none = await gitService.log(WITH_UPSTREAM, { branches: ['nope', 'also-nope'] });
    expect(none).toEqual([]);
  });

  it('HEAD is accepted without a probe (cheap path for detached fallback)', async () => {
    let entries: gitService.LogEntry[] = [];
    const m = await measure(WITH_UPSTREAM, async () => {
      entries = await gitService.log(WITH_UPSTREAM, { branches: ['HEAD'] });
    });
    // 1× for-each-ref (HEAD not found in the set but special-cased) + log.
    expect(m.subprocesses).toBe(2);
    expect(entries.length).toBeGreaterThan(0);
  });
});
