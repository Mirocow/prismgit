/**
 * BUGFIX "не получаю все ветки хотя в Remotes они есть":
 *
 * Reproduces the user-reported scenario end-to-end against a REAL repository:
 *   1. A clone made with `--single-branch` (or `--depth N`, which implies it)
 *      configures remote.origin.fetch to ONE branch.
 *   2. remoteFetchSpecs() must report that refspec so the Branches page can
 *      show the warning row (the Remotes page shows all branches via live
 *      ls-remote — that's why the user sees "branches exist but missing").
 *   3. No amount of plain `fetch()` widens the refspec — the branches stay
 *      invisible.
 *   4. fetchAllBranches() (git remote set-branches '*' + fetch) must make
 *      ALL remote branches appear in refs/remotes.
 *
 * Also verifies the clone() fix: --depth clones now pass --no-single-branch
 * so new clones fetch all branch refs from the start.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { branches, remoteFetchSpecs, fetchAllBranches, fetch, clone } from '../../electron/services/git';
import { isSingleBranchRefspec, singleBranchRemotes } from '../../src/lib/remoteSpecs';

const ROOT = '/tmp/prismgit-remote-specs-test';
const REMOTE = `${ROOT}/remote.git`;
const CLONES = `${ROOT}/clones`;

function sh(cmd: string, cwd: string = ROOT) {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Create the shared "server": bare remote with three branches. */
function makeRemoteRepo() {
  sh('git init -q -b main --bare remote.git');
  // Seed via a scratch pusher repo
  sh(`git clone -q ${REMOTE} seeder`);
  const SEED = `${ROOT}/seeder`;
  sh('git config user.email seed@prismgit.test', SEED);
  sh('git config user.name Seeder', SEED);
  sh('git commit -q --allow-empty -m "main c1"', SEED);
  sh('git push -q origin main', SEED);
  for (const b of ['feature/one', 'feature/two', 'release/1.0']) {
    sh(`git checkout -q -b ${b}`, SEED);
    sh(`git commit -q --allow-empty -m "${b} c1"`, SEED);
    sh(`git push -q origin ${b}`, SEED);
  }
}

/** All remote-tracking refs under refs/remotes/<remote>/ (excluding HEAD). */
function remoteRefs(repo: string, remote = 'origin'): string[] {
  const out = execSync(`git for-each-ref --format='%(refname)' refs/remotes/${remote}`, {
    cwd: repo,
    encoding: 'utf-8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map((r) => r.trim().replace(`refs/remotes/${remote}/`, ''))
    // refname:short of refs/remotes/origin/HEAD is just "origin" — use full
    // refnames and drop the symbolic HEAD explicitly.
    .filter((n) => n && n !== 'HEAD');
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(CLONES);
  makeRemoteRepo();
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('remoteFetchSpecs — single-branch detection', () => {
  it('full clone → full wildcard refspec → NOT single-branch', async () => {
    const full = `${CLONES}/full`;
    sh(`git clone -q ${REMOTE} ${CLONES}/full`);
    const specs = await remoteFetchSpecs(full);
    expect(specs.origin).toEqual(['+refs/heads/*:refs/remotes/origin/*']);
    expect(isSingleBranchRefspec('origin', specs.origin)).toBe(false);
    expect(singleBranchRemotes(specs)).toEqual([]);
    expect(remoteRefs(full).sort()).toEqual(['feature/one', 'feature/two', 'main', 'release/1.0'].sort());
  });

  it('single-branch clone → one-branch refspec → detected as single-branch', async () => {
    const single = `${CLONES}/single`;
    sh(`git clone -q --single-branch --branch main ${REMOTE} ${CLONES}/single`);
    const specs = await remoteFetchSpecs(single);
    expect(specs.origin).toEqual(['+refs/heads/main:refs/remotes/origin/main']);
    expect(isSingleBranchRefspec('origin', specs.origin)).toBe(true);
    // The user's exact symptom: only ONE remote branch visible although the
    // remote has four (the Remotes page shows all of them via ls-remote).
    expect(remoteRefs(single)).toEqual(['main']);
  });

  it('depth clone (--depth implies --single-branch in stock git) → detected', async () => {
    const deep = `${CLONES}/deep`;
    sh(`git clone -q --depth 1 --branch main ${REMOTE} ${CLONES}/deep`);
    const specs = await remoteFetchSpecs(deep);
    expect(isSingleBranchRefspec('origin', specs.origin)).toBe(true);
  });

  it('repo without remotes → empty spec map (not single-branch)', async () => {
    const lone = `${CLONES}/lone`;
    sh(`git init -q -b main ${CLONES}/lone`);
    const specs = await remoteFetchSpecs(lone);
    expect(specs).toEqual({});
    expect(singleBranchRemotes(specs)).toEqual([]);
  });
});

describe('plain fetch does NOT widen a single-branch clone (the trap)', () => {
  it('fetch() succeeds but the other branches stay invisible', async () => {
    const single = `${CLONES}/single`;
    await fetch(single, 'origin', true);
    // Refspec still single-branch → still only main fetched.
    expect(remoteRefs(single)).toEqual(['main']);
    const specs = await remoteFetchSpecs(single);
    expect(isSingleBranchRefspec('origin', specs.origin)).toBe(true);
  });
});

describe('fetchAllBranches — the one-click remediation', () => {
  it('widens the refspec and fetches ALL branches into refs/remotes', async () => {
    const single = `${CLONES}/single`;
    await fetchAllBranches(single, 'origin');

    const specs = await remoteFetchSpecs(single);
    expect(specs.origin).toContain('+refs/heads/*:refs/remotes/origin/*');
    expect(isSingleBranchRefspec('origin', specs.origin)).toBe(false);

    // Every branch that "exists in Remotes" is now locally fetched —
    // exactly what the Branches page renders.
    expect(remoteRefs(single).sort()).toEqual(['feature/one', 'feature/two', 'main', 'release/1.0'].sort());

    // And branches() (what the Branches page calls) now returns them all.
    const list = await branches(single);
    const remoteNames = list.filter((b) => b.remote).map((b) => b.name).sort();
    expect(remoteNames).toEqual(
      ['origin/feature/one', 'origin/feature/two', 'origin/main', 'origin/release/1.0'].sort(),
    );
  });

  it('is a no-op-safe call on an already-full clone (custom refspecs untouched when full)', async () => {
    const full = `${CLONES}/full`;
    await fetchAllBranches(full, 'origin');
    const specs = await remoteFetchSpecs(full);
    expect(specs.origin).toEqual(['+refs/heads/*:refs/remotes/origin/*']);
    expect(remoteRefs(full).length).toBe(4);
  });
});

describe('clone() — --depth no longer implies single-branch', () => {
  it('app clone with depth fetches ALL branch refs from the start', async () => {
    const target = `${CLONES}/appclone`;
    // file:// is required — plain local paths make git IGNORE --depth.
    await clone(`file://${REMOTE}`, target, { depth: 1 });
    expect(existsSync(target)).toBe(true);
    const specs = await remoteFetchSpecs(target);
    expect(isSingleBranchRefspec('origin', specs.origin)).toBe(false);
    expect(remoteRefs(target).sort()).toEqual(['feature/one', 'feature/two', 'main', 'release/1.0'].sort());
    // ...while history stays shallow (the actual point of --depth).
    const isShallow = execSync('git rev-parse --is-shallow-repository', { cwd: target, encoding: 'utf-8' }).trim();
    expect(isShallow).toBe('true');
  }, 120_000);
});
