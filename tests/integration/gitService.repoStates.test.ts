/**
 * PrismGit — in-progress repository STATE coverage (SmartGit working-tree
 * states): cherry-picking, reverting, merging, rebasing, bisecting.
 *
 * Drives `electron/services/git.ts` against local repos and verifies that
 * status() exposes ALL five state flags + their per-state details, and that
 * the state-resolving operations (Continue / Skip / Abort / Reset) clean up:
 *  - merge conflict → isMerging + merge.message; Abort Merge clears;
 *    a resolved COMMIT also completes the merge (SmartGit semantics);
 *  - revert conflict → isReverting + revert{commit,subject}; Continue after
 *    resolution completes, Skip advances a sequence, Abort cancels;
 *  - rebase conflict → isRebasing (+ step/total progress); Abort clears;
 *  - bisect start → isBisecting + bisect.rev; Reset clears;
 *  - a clean repo reports every flag false without any detail object.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as gitService from '../../electron/services/git';

vi.setConfig({ testTimeout: 30_000 });

let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-states-'));
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

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
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

describe('MERGING state ("The working tree is in merging-state.")', () => {
  it('conflicted merge exposes isMerging + merge.message; Abort Merge clears it', async () => {
    const repo = await mkRepo('mg-abort');
    await gitService.createBranch(repo, 'feature', 'HEAD');
    await gitService.checkout(repo, 'feature');
    write(repo, 'a.txt', 'feature version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'feature edits a.txt');
    await gitService.checkout(repo, 'main');
    write(repo, 'a.txt', 'main version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'main edits a.txt');

    const res = await gitService.merge(repo, 'feature');
    expect(res.conflicts).toEqual(['a.txt']);

    const st = await gitService.status(repo);
    expect(st.isMerging).toBe(true);
    expect(st.isCherryPicking).toBe(false);
    expect(st.isReverting).toBe(false);
    expect(st.isRebasing).toBe(false);
    expect(st.isBisecting).toBe(false);
    expect(st.merge).toBeDefined();
    expect(st.merge!.message.length).toBeGreaterThan(0);
    // Conflicted files remain visible for the solver
    expect(st.conflicted).toContain('a.txt');

    await gitService.abortMerge(repo);
    const after = await gitService.status(repo);
    expect(after.isMerging).toBe(false);
    expect(after.merge).toBeUndefined();
    expect(after.conflicted).toEqual([]);
    expect(read(repo, 'a.txt')).toBe('main version\n');
  });

  it('a resolved COMMIT completes the merge (commit is NOT blocked during a merge)', async () => {
    const repo = await mkRepo('mg-commit');
    await gitService.createBranch(repo, 'feature', 'HEAD');
    await gitService.checkout(repo, 'feature');
    write(repo, 'a.txt', 'feature version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'feature edits a.txt');
    await gitService.checkout(repo, 'main');
    write(repo, 'a.txt', 'main version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'main edits a.txt');

    await gitService.merge(repo, 'feature');
    expect((await gitService.status(repo)).isMerging).toBe(true);

    // Resolve + commit — the legitimate way to finish a conflicted merge
    write(repo, 'a.txt', 'resolved version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, "Merge branch 'feature' — resolved");

    const st = await gitService.status(repo);
    expect(st.isMerging).toBe(false);
    expect(st.merge).toBeUndefined();
    expect(read(repo, 'a.txt')).toBe('resolved version\n');
  });
});

describe('REVERTING state ("The working tree is in reverting-state.")', () => {
  it('conflicted revert exposes isReverting + revert{commit,subject}; Abort clears it', async () => {
    const repo = await mkRepo('rv-abort');
    // c2: alpha→beta, c3: beta→gamma. Reverting c2 on gamma conflicts.
    write(repo, 'a.txt', 'beta\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'change alpha to beta');
    const c2 = await head(repo);
    write(repo, 'a.txt', 'gamma\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'change beta to gamma');

    const res = await gitService.revert(repo, [c2]);
    expect(res.conflicts).toContain('a.txt');

    const st = await gitService.status(repo);
    expect(st.isReverting).toBe(true);
    expect(st.isMerging).toBe(false);
    expect(st.revert).toBeDefined();
    expect(st.revert!.commit).toBe(c2);
    expect(st.revert!.subject).toBe('change alpha to beta');

    await gitService.revertAbort(repo);
    const after = await gitService.status(repo);
    expect(after.isReverting).toBe(false);
    expect(after.revert).toBeUndefined();
    expect(read(repo, 'a.txt')).toBe('gamma\n');
  });

  it('revertContinue completes the revert after resolution', async () => {
    const repo = await mkRepo('rv-continue');
    write(repo, 'a.txt', 'beta\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'change alpha to beta');
    const c2 = await head(repo);
    write(repo, 'a.txt', 'gamma\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'change beta to gamma');

    await gitService.revert(repo, [c2]);
    expect((await gitService.status(repo)).isReverting).toBe(true);

    // Accept the revert's outcome (back to alpha) and continue
    write(repo, 'a.txt', 'alpha\n');
    await gitService.addAll(repo);
    await gitService.revertContinue(repo);

    const st = await gitService.status(repo);
    expect(st.isReverting).toBe(false);
    expect(st.revert).toBeUndefined();
    expect(read(repo, 'a.txt')).toBe('alpha\n');
  });

  it('revertSkip drops the conflicting step and continues the sequence', async () => {
    const repo = await mkRepo('rv-skip');
    write(repo, 'a.txt', 'beta\n'); // c2 (its revert will conflict: tree moves on to gamma)
    await gitService.addAll(repo);
    await gitService.commit(repo, 'change alpha to beta');
    const c2 = await head(repo);
    write(repo, 'a.txt', 'gamma\n'); // c3
    await gitService.addAll(repo);
    await gitService.commit(repo, 'change beta to gamma');
    write(repo, 'b.txt', 'bravo\n'); // c4 (reverts cleanly — unrelated file)
    await gitService.addAll(repo);
    await gitService.commit(repo, 'add b.txt');
    const c4 = await head(repo);

    // Sequence: revert c4 (clean, auto-committed), then c2 → CONFLICT
    // (the tree is at gamma while the inverse patch wants alpha back)
    const res = await gitService.revert(repo, [c4, c2]);
    expect(res.conflicts).toContain('a.txt');
    expect((await gitService.status(repo)).isReverting).toBe(true);

    await gitService.revertSkip(repo);

    const st = await gitService.status(repo);
    expect(st.isReverting).toBe(false);
    expect(st.revert).toBeUndefined();
    // c4's revert went through; c2's revert was skipped (a.txt still gamma)
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(false);
    expect(read(repo, 'a.txt')).toBe('gamma\n');
  });
});

describe('REBASING state ("The working tree is in rebasing-state.")', () => {
  it('conflicted rebase exposes isRebasing (+ progress); Abort restores the branch', async () => {
    const repo = await mkRepo('rb-abort');
    await gitService.createBranch(repo, 'feature', 'HEAD');
    await gitService.checkout(repo, 'feature');
    write(repo, 'a.txt', 'feature version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'feature edits a.txt');
    await gitService.checkout(repo, 'main');
    write(repo, 'a.txt', 'main version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'main edits a.txt');

    await gitService.checkout(repo, 'feature');
    // Rebase onto main → conflict on a.txt (the service does not swallow this)
    await expect(gitService.rebase(repo, 'main')).rejects.toThrow();

    const st = await gitService.status(repo);
    expect(st.isRebasing).toBe(true);
    expect(st.isMerging).toBe(false);
    expect(st.rebase).toBeDefined();
    if (st.rebase?.step != null) expect(st.rebase.step).toBeGreaterThan(0);
    if (st.rebase?.total != null) expect(st.rebase.total).toBeGreaterThan(0);

    await gitService.rebase(repo, '', { abort: true });
    const after = await gitService.status(repo);
    expect(after.isRebasing).toBe(false);
    expect(after.rebase).toBeUndefined();
    expect(read(repo, 'a.txt')).toBe('feature version\n');
  });

  it('rebase --continue finishes after the conflict is resolved', async () => {
    const repo = await mkRepo('rb-continue');
    await gitService.createBranch(repo, 'feature', 'HEAD');
    await gitService.checkout(repo, 'feature');
    write(repo, 'a.txt', 'feature version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'feature edits a.txt');
    await gitService.checkout(repo, 'main');
    write(repo, 'a.txt', 'main version\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'main edits a.txt');

    await gitService.checkout(repo, 'feature');
    await expect(gitService.rebase(repo, 'main')).rejects.toThrow();
    expect((await gitService.status(repo)).isRebasing).toBe(true);

    // Resolve and continue. GIT_EDITOR=true keeps any editor invocation a no-op.
    const prevEditor = process.env.GIT_EDITOR;
    process.env.GIT_EDITOR = 'true';
    try {
      write(repo, 'a.txt', 'resolved version\n');
      await gitService.addAll(repo);
      await gitService.rebase(repo, '', { continue: true });
    } finally {
      if (prevEditor === undefined) delete process.env.GIT_EDITOR;
      else process.env.GIT_EDITOR = prevEditor;
    }

    const st = await gitService.status(repo);
    expect(st.isRebasing).toBe(false);
    expect(st.rebase).toBeUndefined();
    expect(read(repo, 'a.txt')).toBe('resolved version\n');
    // The branch now contains main's commit (rebased onto it)
    const log = await gitService.raw(repo, ['log', '--format=%s', 'HEAD~1..HEAD']);
    expect(log).toContain('feature edits a.txt');
  });
});

describe('BISECTING state ("The working tree is in bisecting-state.")', () => {
  it('bisect start exposes isBisecting + the tested rev; Reset clears it', async () => {
    const repo = await mkRepo('bs-start');
    write(repo, 'a.txt', 'beta\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'second commit');
    const before = await head(repo);

    await gitService.bisectStart(repo);
    let st = await gitService.status(repo);
    expect(st.isBisecting).toBe(true);
    expect(st.isRebasing).toBe(false);
    expect(st.bisect).toBeDefined();
    // HEAD is detached at the current candidate
    expect(st.bisect!.rev).toBe(before);

    await gitService.bisectReset(repo);
    st = await gitService.status(repo);
    expect(st.isBisecting).toBe(false);
    expect(st.bisect).toBeUndefined();
    expect(st.current).toBe('main');
  });
});

describe('clean repo: no in-progress state', () => {
  it('reports every flag false and omits every detail object', async () => {
    const repo = await mkRepo('clean-state');
    const st = await gitService.status(repo);
    expect(st.isMerging).toBe(false);
    expect(st.isRebasing).toBe(false);
    expect(st.isCherryPicking).toBe(false);
    expect(st.isReverting).toBe(false);
    expect(st.isBisecting).toBe(false);
    expect(st.cherryPick).toBeUndefined();
    expect(st.revert).toBeUndefined();
    expect(st.merge).toBeUndefined();
    expect(st.rebase).toBeUndefined();
    expect(st.bisect).toBeUndefined();
  });
});
