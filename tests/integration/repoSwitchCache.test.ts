/**
 * PERF (v3.1, repo-switch) integration tests — the main-process side of the
 * repo open/switch latency work:
 *
 *   1. isRepo() positive session cache — every open/switch of a KNOWN repo
 *      skips the `rev-parse --is-inside-work-tree` spawn entirely.
 *   2. trimRepoCaches() — the SOFT eviction the renderer now calls on repo
 *      switch-away: warm caches survive (A → B → A is fast), memory stays
 *      bounded (LRU caps), and invalidateCache() still hard-drops a repo.
 *   3. isLfsInstalled() machine-wide cache — `git lfs version` is not a
 *      per-repo question; it runs once per session (both outcomes cached).
 *   4. Wall-clock proof: the OLD switch pattern (invalidateCache away) vs
 *      the NEW one (trimRepoCaches away) on a real A → B → A sequence.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as gitService from '../../electron/services/git';

const ROOT = path.join(os.tmpdir(), `prismgit-switch-${Date.now()}`);
const NL = String.fromCharCode(10);

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function makeRepo(name: string, commits = 3): string {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  sh('git init -q -b main .', dir);
  sh('git config user.name "T"', dir);
  sh('git config user.email t@t', dir);
  for (let i = 0; i < commits; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), `v${i}${NL}`);
    sh(`git add f${i}.txt`, dir);
    sh(`git commit -q -m c${i}`, dir);
  }
  return dir;
}

describe('repo-switch caches (integration)', () => {
  beforeEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    gitService.invalidateCache(); // full reset between tests
    gitService.__resetReadCoalescingForTests();
  });

  it('isRepo(): positive results are cached — repeat calls skip the spawn', async () => {
    const repo = makeRepo('r1');
    // Cold call: spawns rev-parse --is-inside-work-tree.
    const t0 = performance.now();
    expect(await gitService.isRepo(repo)).toBe(true);
    const coldMs = performance.now() - t0;
    expect(gitService.__repoCacheSizesForTests(repo).isRepoEntryCached).toBe(true);

    // Warm call: a Set membership check — sub-millisecond even on loaded CI.
    const t1 = performance.now();
    expect(await gitService.isRepo(repo)).toBe(true);
    const warmMs = performance.now() - t1;
    expect(warmMs).toBeLessThan(5);
    // Informational: the cold call DID spawn (bounded below by a real git
    // subprocess, not asserted — CI variance).
    console.log(`\n[switch] isRepo cold ~${coldMs.toFixed(1)}ms vs cached ~${warmMs.toFixed(2)}ms`);
  });

  it('isRepo(): negative results are NOT cached — git init is picked up', async () => {
    const dir = path.join(ROOT, 'plain');
    fs.mkdirSync(dir, { recursive: true });
    expect(await gitService.isRepo(dir)).toBe(false);
    expect(gitService.__repoCacheSizesForTests(dir).isRepoEntryCached).toBe(false);
    // Initialize it — the next call must see the repo (no false caching).
    sh('git init -q -b main .', dir);
    expect(await gitService.isRepo(dir)).toBe(true);
  });

  it('isRepo(): invalidateCache(path) drops the cached positive', async () => {
    const repo = makeRepo('r2');
    expect(await gitService.isRepo(repo)).toBe(true);
    gitService.invalidateCache(repo);
    expect(gitService.__repoCacheSizesForTests(repo).isRepoEntryCached).toBe(false);
    // Still true — just a fresh spawn.
    expect(await gitService.isRepo(repo)).toBe(true);
  });

  it('trimRepoCaches(): warm caches SURVIVE a switch-away (A→B→A is fast)', async () => {
    const a = makeRepo('a');
    const b = makeRepo('b');
    // Open A: populates isRepo + gitDir + instance caches.
    await gitService.isRepo(a);
    await gitService.status(a);
    expect(gitService.__repoCacheSizesForTests(a).gitDirCached).toBe(true);

    // Switch A → B (the renderer's new switch-away call):
    await gitService.isRepo(b);
    await gitService.status(b);
    gitService.trimRepoCaches();

    // A's caches are warm — returning to A skips rev-parse --absolute-git-dir
    // and the isRepo spawn.
    const sizes = gitService.__repoCacheSizesForTests(a);
    expect(sizes.gitDirCached).toBe(true);
    expect(sizes.isRepoEntryCached).toBe(true);
  });

  it('trimRepoCaches(): memory stays bounded (LRU caps)', async () => {
    const repos: string[] = [];
    for (let i = 0; i < 7; i++) repos.push(makeRepo(`cap${i}`));
    for (const r of repos) {
      await gitService.isRepo(r);
      await gitService.status(r);
    }
    gitService.trimRepoCaches();
    const sizes = gitService.__repoCacheSizesForTests();
    expect(sizes.gitInstances).toBeLessThanOrEqual(4);
    expect(sizes.gitDirs).toBeLessThanOrEqual(16);
    expect(sizes.coalesceStates).toBeLessThanOrEqual(8);
    expect(sizes.isRepoCached).toBe(7); // positive set is a few bytes per repo
  });

  it('invalidateCache(path) remains a HARD drop (mutation semantics)', async () => {
    const repo = makeRepo('hard');
    await gitService.isRepo(repo);
    await gitService.status(repo);
    gitService.invalidateCache(repo);
    const sizes = gitService.__repoCacheSizesForTests(repo);
    expect(sizes.gitDirCached).toBe(false);
    expect(sizes.isRepoEntryCached).toBe(false);
  });

  it('isLfsInstalled(): machine-wide cache — one spawn per session', async () => {
    const a = makeRepo('lfsa');
    const b = makeRepo('lfsb');
    // First call spawns `git lfs version` (fails here — git-lfs not
    // installed in the test env — which is exactly the cached-failure path).
    const t0 = performance.now();
    const first = await gitService.isLfsInstalled(a);
    const coldMs = performance.now() - t0;
    // Both the second repo AND a repeat on the first are served from cache.
    const t1 = performance.now();
    const second = await gitService.isLfsInstalled(b);
    const third = await gitService.isLfsInstalled(a);
    const warmMs = performance.now() - t1;
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(warmMs).toBeLessThan(5);
    console.log(`[switch] isLfsInstalled cold ~${coldMs.toFixed(1)}ms vs cached ~${warmMs.toFixed(2)}ms (result: ${first})`);
  });

  it('WALL-CLOCK: A→B→A — old invalidateCache-away vs new trim-away', async () => {
    const a = makeRepo('bench-a', 8);
    const b = makeRepo('bench-b', 8);

    // Warm both repos once (app start with A and B previously opened).
    await gitService.isRepo(a);
    await gitService.status(a);
    await gitService.isRepo(b);
    await gitService.status(b);

    const openSequence = async (repo: string) => {
      // What the renderer fires on switch: validity check + status.
      await gitService.isRepo(repo);
      await gitService.status(repo);
    };

    // OLD pattern: switch-away destroyed the previous repo's caches.
    let t0 = performance.now();
    await openSequence(b);
    gitService.invalidateCache(a); // old repositoryStore.openRepository
    await openSequence(a);
    const oldMs = performance.now() - t0;

    // Restore warm state for both, then the NEW pattern.
    await openSequence(b);
    let t1 = performance.now();
    await openSequence(b);
    gitService.trimRepoCaches(); // new repositoryStore.openRepository
    await openSequence(a);
    const newMs = performance.now() - t1;

    console.log(`[switch] A→B→A open+status chain: old ~${oldMs.toFixed(0)}ms vs new ~${newMs.toFixed(0)}ms`);
    // The new path strictly does LESS work (cached isRepo + cached gitDir);
    // allow a small scheduling-noise tolerance so slow CI doesn't flake.
    expect(newMs).toBeLessThanOrEqual(oldMs + 5);
  }, 60_000);
});
