/**
 * Integration test for gitService.fetchRef() — fetching ONE server-side
 * refspec into FETCH_HEAD, the mechanism the Pull Requests / Reviews
 * squash-to-branch flow uses to materialize PR/MR commit objects locally
 * (GitHub refs/pull/<n>/head, GitLab refs/merge-requests/<n>/head).
 *
 * Reproduces the exact scenario against REAL repositories (a bare "server"
 * + a clone):
 *   1. The PR head ref (here a synthetic refs/pull/9/head) is NOT a branch —
 *      a plain `git fetch origin` with the default refspec NEVER downloads
 *      it, so the PR's commit objects stay unknown to the clone.
 *   2. fetchRef(clone, 'origin', 'refs/pull/9/head') must bring the objects
 *      down (rev-parse of the PR head SHA starts resolving) while creating
 *      NO remote-tracking ref and touching NO existing ref.
 *   3. A stale/absent refspec must reject (the UI maps that to an error
 *      toast instead of silently opening the dialog).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fetchRef } from '../../electron/services/git';

const ROOT = '/tmp/prismgit-fetch-ref-test';
const REMOTE = `${ROOT}/remote.git`;
const CLONE = `${ROOT}/clone`;

function sh(cmd: string, cwd: string = ROOT): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function shQuiet(cmd: string, cwd: string): boolean {
  try {
    execSync(cmd, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

describe('gitService.fetchRef — PR head refspec fetch', () => {
  beforeAll(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    // ── "Server": bare remote ──
    sh('git init -q -b main --bare remote.git');
    sh(`git clone -q ${REMOTE} seeder`);
    const SEED = `${ROOT}/seeder`;
    sh('git config user.email seed@prismgit.test', SEED);
    sh('git config user.name Seeder', SEED);
    sh('git commit -q --allow-empty -m "base"', SEED);
    sh('git push -q origin main', SEED);
    // The "PR head": a chain of 3 commits on a side branch that is pushed
    // ONLY as refs/pull/9/head (never as refs/heads/*) — exactly how GitHub
    // exposes a PR from a fork, and why the default fetch refspec can't see it.
    sh('git checkout -q -b pr-branch', SEED);
    for (const m of ['pr one', 'pr two', 'pr three']) {
      sh(`git commit -q --allow-empty -m "${m}"`, SEED);
    }
    sh('git push -q origin pr-branch:refs/pull/9/head', SEED);
    // ── The local clone the app would have open ──
    // --no-local forces the smart transport (want/have negotiation with the
    // configured refspec) instead of the local-clone object-store COPY — a
    // plain local clone would receive refs/pull/9/head's objects for free,
    // which is exactly what does NOT happen with a real network remote.
    sh(`git clone -q --no-local ${REMOTE} clone`);
    sh('git config user.email clone@prismgit.test', CLONE);
    sh('git config user.name Clone', CLONE);
  });

  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  it('the PR head SHA is NOT visible through the default clone refspec', () => {
    const prHead = sh('git rev-parse refs/pull/9/head', REMOTE).trim();
    // Unknown object in the clone (rev-parse --verify --quiet: empty + exit 1)
    expect(shQuiet(`git rev-parse --verify --quiet ${prHead}^{commit}`, CLONE)).toBe(false);
  });

  it('fetchRef materializes the PR commits without creating ANY ref', async () => {
    const prHead = sh('git rev-parse refs/pull/9/head', REMOTE).trim();

    await fetchRef(CLONE, 'origin', 'refs/pull/9/head');

    // The PR head (and its whole chain) now resolves locally.
    expect(shQuiet(`git rev-parse --verify --quiet ${prHead}^{commit}`, CLONE)).toBe(true);
    // FETCH_HEAD points at the PR head.
    const fetchHead = sh('git rev-parse FETCH_HEAD', CLONE).trim();
    expect(fetchHead).toBe(prHead);
    // No remote-tracking ref was created for the PR ref…
    const tracking = sh("git for-each-ref --format='%(refname)' refs/remotes/origin", CLONE)
      .split('\n').filter(Boolean);
    expect(tracking).toEqual(['refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    // …and no local branch changed.
    const branches = sh("git for-each-ref --format='%(refname)' refs/heads", CLONE)
      .split('\n').filter(Boolean);
    expect(branches).toEqual(['refs/heads/main']);
  });

  it('rejects a refspec the server does not have', async () => {
    await expect(fetchRef(CLONE, 'origin', 'refs/pull/999/head')).rejects.toThrow();
  });
});
