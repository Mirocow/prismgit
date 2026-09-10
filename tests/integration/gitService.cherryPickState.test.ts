/**
 * PrismGit — cherry-pick STATE coverage (SmartGit "cherry-picking-state").
 *
 * Drives `electron/services/git.ts` against local repos:
 *  - empty picks ("The previous cherry-pick is now empty") are reported via
 *    {empty:true} instead of a silent success;
 *  - status() exposes cherryPick {commit, subject, empty} while the pick is
 *    in progress;
 *  - Skip / Continue (--allow-empty) / Abort resolve the state;
 *  - state detection works inside LINKED WORKTREES (rev-parse --absolute-git-dir),
 *    where '.git' is a file — the naive path check used to miss it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as gitService from '../../electron/services/git';

vi.setConfig({ testTimeout: 30_000 });

let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-cpick-'));
});

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

function write(dir: string, rel: string, content: string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

async function mkRepo(name: string, seed: Record<string, string> = { 'a.txt': 'alpha\n' }): Promise<string> {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  await gitService.init(dir, false);
  await gitService.configSet(dir, 'user.name', 'Test User', 'local');
  await gitService.configSet(dir, 'user.email', 'test@test.com', 'local');
  for (const [rel, content] of Object.entries(seed)) write(dir, rel, content);
  if (Object.keys(seed).length) {
    await gitService.addAll(dir);
    await gitService.commit(dir, 'seed commit');
  }
  return dir;
}

/** HEAD hash of a repo. */
async function head(repoPath: string): Promise<string> {
  return (await gitService.raw(repoPath, ['rev-parse', 'HEAD'])).trim();
}

describe('cherry-pick: normal success', () => {
  it('applies a clean pick and leaves NO cherry-pick state behind', async () => {
    const repo = await mkRepo('cp-clean');
    await gitService.createBranch(repo, 'feature', 'HEAD');
    await gitService.checkout(repo, 'feature');
    write(repo, 'b.txt', 'feature work\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'add b.txt');
    const featureHash = await head(repo);
    await gitService.checkout(repo, 'main');

    const res = await gitService.cherryPick(repo, [featureHash]);
    expect(res.conflicts).toEqual([]);
    expect(res.empty).toBeUndefined();
    expect(res.error).toBeUndefined();

    const st = await gitService.status(repo);
    expect(st.isCherryPicking).toBe(false);
    expect(st.cherryPick).toBeUndefined();
    // b.txt arrived on master
    expect(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8')).toBe('feature work\n');
  });

  it('status() has no cherryPick info when nothing is being picked', async () => {
    const repo = await mkRepo('cp-status-clean');
    const st = await gitService.status(repo);
    expect(st.isCherryPicking).toBe(false);
    expect(st.cherryPick).toBeUndefined();
  });
});

describe('cherry-pick: EMPTY pick (changes already applied)', () => {
  // Repo layout: seed(a=alpha) → branch pick: a=beta → master applies a=beta itself.
  // Cherry-picking the pick onto master then produces an EMPTY result: git
  // exits 1 with "The previous cherry-pick is now empty" and leaves the repo
  // in cherry-picking-state. This is exactly the user-reported scenario.
  async function mkEmptyPickRepo(name: string): Promise<{ repo: string; pickHash: string }> {
    const repo = await mkRepo(name);
    await gitService.createBranch(repo, 'pick', 'HEAD');
    await gitService.checkout(repo, 'pick');
    write(repo, 'a.txt', 'beta\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'change alpha to beta');
    const pickHash = await head(repo);
    await gitService.checkout(repo, 'main');
    // Same change applied manually on master — the pick will be empty here
    write(repo, 'a.txt', 'beta\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'manually apply beta');
    return { repo, pickHash };
  }

  it('reports {empty:true} instead of a silent success', async () => {
    const { repo, pickHash } = await mkEmptyPickRepo('cp-empty');
    const before = await head(repo);

    const res = await gitService.cherryPick(repo, [pickHash]);
    expect(res.conflicts).toEqual([]);
    expect(res.empty).toBe(true);

    // Repo is now in cherry-picking-state with the pick details exposed
    const st = await gitService.status(repo);
    expect(st.isCherryPicking).toBe(true);
    expect(st.cherryPick).toBeDefined();
    expect(st.cherryPick!.commit).toBe(pickHash);
    expect(st.cherryPick!.subject).toBe('change alpha to beta');
    expect(st.cherryPick!.empty).toBe(true);
    // HEAD must NOT have moved — nothing was committed
    expect(await head(repo)).toBe(before);
  });

  it('Continue WITHOUT allowEmpty refuses and keeps the state', async () => {
    const { repo } = await mkEmptyPickRepo('cp-empty-continue-refused');
    const pickHash = (await gitService.raw(repo, ['rev-parse', 'pick'])).trim();
    await gitService.cherryPick(repo, [pickHash]);

    const res = await gitService.cherryPickContinue(repo);
    expect(res.empty).toBe(true);
    expect((await gitService.status(repo)).isCherryPicking).toBe(true);
  });

  it('Continue WITH allowEmpty commits an empty commit and clears the state', async () => {
    const { repo, pickHash } = await mkEmptyPickRepo('cp-empty-allow-empty');
    const before = await head(repo);
    await gitService.cherryPick(repo, [pickHash]);

    const res = await gitService.cherryPickContinue(repo, true);
    expect(res.empty).toBeUndefined();

    const st = await gitService.status(repo);
    expect(st.isCherryPicking).toBe(false);
    expect(st.cherryPick).toBeUndefined();

    // New empty commit on top with the picked subject
    const newHash = await head(repo);
    expect(newHash).not.toBe(before);
    const msg = (await gitService.raw(repo, ['log', '-1', '--format=%s'])).trim();
    expect(msg).toBe('change alpha to beta');
    const parents = (await gitService.raw(repo, ['rev-list', '--parents', '-1', newHash])).trim().split(' ');
    expect(parents).toHaveLength(2); // single parent — commit itself is empty
  });

  it('Skip drops the empty pick and clears the state (HEAD unchanged)', async () => {
    const { repo, pickHash } = await mkEmptyPickRepo('cp-empty-skip');
    const before = await head(repo);
    await gitService.cherryPick(repo, [pickHash]);
    expect((await gitService.status(repo)).isCherryPicking).toBe(true);

    await gitService.cherryPickSkip(repo);

    const st = await gitService.status(repo);
    expect(st.isCherryPicking).toBe(false);
    expect(st.cherryPick).toBeUndefined();
    expect(await head(repo)).toBe(before);
  });

  it('Abort also resolves the empty state', async () => {
    const { repo, pickHash } = await mkEmptyPickRepo('cp-empty-abort');
    await gitService.cherryPick(repo, [pickHash]);
    await gitService.cherryPickAbort(repo);
    const st = await gitService.status(repo);
    expect(st.isCherryPicking).toBe(false);
  });
});

describe('cherry-pick: conflicts', () => {
  it('reports conflicts, exposes non-empty pick state, and Abort restores HEAD', async () => {
    const repo = await mkRepo('cp-conflict');
    await gitService.createBranch(repo, 'feature', 'HEAD');
    await gitService.checkout(repo, 'feature');
    write(repo, 'a.txt', 'feature line\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'feature edit a');
    const featureHash = await head(repo);
    await gitService.checkout(repo, 'main');
    write(repo, 'a.txt', 'master line\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'master edit a');
    const before = await head(repo);

    const res = await gitService.cherryPick(repo, [featureHash]);
    expect(res.conflicts).toEqual(['a.txt']);
    expect(res.empty).toBeUndefined();

    const st = await gitService.status(repo);
    expect(st.isCherryPicking).toBe(true);
    expect(st.cherryPick!.commit).toBe(featureHash);
    expect(st.cherryPick!.empty).toBe(false); // real conflicted changes exist

    await gitService.cherryPickAbort(repo);
    const after = await gitService.status(repo);
    expect(after.isCherryPicking).toBe(false);
    expect(await head(repo)).toBe(before);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('master line\n');
  });
});

describe('cherry-pick: hard failures are surfaced', () => {
  it('returns {error} when local changes would be overwritten (no state left)', async () => {
    const repo = await mkRepo('cp-dirty');
    await gitService.createBranch(repo, 'feature', 'HEAD');
    await gitService.checkout(repo, 'feature');
    write(repo, 'b.txt', 'committed feature content\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'add b.txt');
    const featureHash = await head(repo);
    await gitService.checkout(repo, 'main');
    // Dirty working tree touching the file the pick would modify
    write(repo, 'b.txt', 'uncommitted local junk\n');

    const res = await gitService.cherryPick(repo, [featureHash]);
    expect(res.empty).toBeUndefined();
    expect(res.error).toBeTruthy();
    expect(res.error).toMatch(/overwrit|local changes|untracked/i);
    // No sequencer state left behind
    expect((await gitService.status(repo)).isCherryPicking).toBe(false);
  });

  it('returns {error} for a bad revision instead of pretending success', async () => {
    const repo = await mkRepo('cp-badrev');
    const res = await gitService.cherryPick(repo, ['deadbeefdeadbeefdeadbeefdeadbeefdeadbeef']);
    expect(res.empty).toBeUndefined();
    expect(res.error).toBeTruthy();
  });
});

describe('cherry-pick state inside a LINKED WORKTREE', () => {
  // In a linked worktree '.git' is a FILE pointing at <main>/.git/worktrees/<n>.
  // State files (CHERRY_PICK_HEAD) live in that per-worktree dir — the old
  // fs.existsSync(repo/.git/CHERRY_PICK_HEAD) check NEVER saw them. Detection
  // now goes through `git rev-parse --absolute-git-dir`.
  it('status() detects an in-progress pick in a worktree', async () => {
    const repo = await mkRepo('cp-wt-main');
    await gitService.createBranch(repo, 'wt-feature', 'HEAD');
    await gitService.checkout(repo, 'wt-feature');
    write(repo, 'w.txt', 'from branch\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'wt branch commit');
    const pickHash = await head(repo);
    await gitService.checkout(repo, 'main');

    const wtPath = path.join(ROOT, 'cp-wt-linked');
    await gitService.worktreeAdd(repo, wtPath, 'wt-copy', undefined, false);

    // cherry-pick in the WORKTREE dir → empty pick (same change already there? no—
    // wt-copy branched from master, the change is NOT applied → clean pick).
    const res = await gitService.cherryPick(wtPath, [pickHash]);
    // The pick applies cleanly in the worktree; assert no false state first.
    expect(res.conflicts).toEqual([]);
    expect((await gitService.status(wtPath)).isCherryPicking).toBe(false);

    // Now force an EMPTY pick inside the worktree: apply the same change and
    // pick it again.
    write(wtPath, 'w.txt', 'from branch\n');
    await gitService.addAll(wtPath);
    await gitService.commit(wtPath, 'same change manually');
    const res2 = await gitService.cherryPick(wtPath, [pickHash]);
    expect(res2.empty).toBe(true);
    const st = await gitService.status(wtPath);
    expect(st.isCherryPicking).toBe(true);
    expect(st.cherryPick!.commit).toBe(pickHash);
    expect(st.cherryPick!.empty).toBe(true);

    // Skip resolves it, and the MAIN checkout never saw any pick state
    await gitService.cherryPickSkip(wtPath);
    expect((await gitService.status(wtPath)).isCherryPicking).toBe(false);
    expect((await gitService.status(repo)).isCherryPicking).toBe(false);
  });
});
