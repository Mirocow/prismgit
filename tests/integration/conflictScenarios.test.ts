/**
 * PrismGit — the conflict-reaction audit's emulation matrix.
 *
 * «проверь всю работу с конфликтами, сам эмулируй все возможные конфликты
 * при pull, слиянии веток, работе со сквошами и коммитами из разных веток».
 *
 * Every conflict SHAPE an operation can land on is reproduced against REAL
 * repositories, and for each the test pins the CONTRACT the UI reaction
 * (surfaceConflictedState → Changes tool + banner) keys off:
 *   - does the operation report the conflict (throw / result.conflicts),
 *   - does `git status` expose it (conflicted files, isMerging / isRebasing),
 *   - what the REPO is left in (the exact state the user must be able to
 *     resolve from the Changes tool: Continue / Skip / Abort).
 *
 * Covered:
 *   A. pull — merge strategy, text modify/modify conflict
 *   B. pull — rebase strategy conflict (rebasing state)
 *   C. merge — text modify/modify
 *   D. merge — add/add (both branches create the same file)
 *   E. merge — delete/modify (one side deletes, the other edits)
 *   F. rebase — commits from different branches conflict
 *   G. cherry-pick — a commit from another branch conflicts
 *   H. revert — conflicting revert
 *   I. stash pop — conflicted pop (NO sequencer state, stash KEPT)
 *   J. stash apply — same, entry always kept
 *
 * (squashToBranch conflicts are pinned in squashToBranch.test.ts — the
 * live route leaves the cherry-pick sequencer state verified there.)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'node:child_process';
import * as gitService from '../../electron/services/git';

vi.setConfig({ testTimeout: 30_000 });

let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-conflicts-'));
});
afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function write(repo: string, rel: string, content: string): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
async function commit(repo: string, message: string): Promise<string> {
  await gitService.addAll(repo);
  await gitService.commit(repo, message);
  return (await gitService.revParse(repo, 'HEAD')).trim();
}

/** Fresh repo with one seed commit; returns to the default branch. */
async function seedRepo(name: string): Promise<string> {
  const repo = path.join(ROOT, name);
  fs.mkdirSync(repo, { recursive: true });
  await gitService.init(repo, false);
  await gitService.configSet(repo, 'user.name', 'Conflict Author', 'local');
  await gitService.configSet(repo, 'user.email', 'conflict@author.dev', 'local');
  write(repo, 'shared.txt', 'line1\nline2\nline3\n');
  await commit(repo, 'seed');
  return repo;
}

// ═══ A/B. PULL conflicts (bare 'server' + clone) ═══════════════════════════

describe('pull conflicts (real bare remote)', () => {
  let remote: string;
  let clone: string;

  beforeAll(() => {
    const dir = path.join(ROOT, 'pull');
    fs.mkdirSync(dir, { recursive: true });
    remote = path.join(dir, 'origin.git');
    sh(`git init -q -b main --bare ${JSON.stringify(remote)}`, dir);
    // Seeder: pushes the base commit FIRST…
    const seeder = path.join(dir, 'seeder');
    sh(`git clone -q ${JSON.stringify(remote)} seeder`, dir);
    sh('git config user.email pull@prismgit.test && git config user.name Puller', seeder);
    write(seeder, 'shared.txt', 'line1\nline2\nline3\n');
    sh('git add -A && git commit -q -m base', seeder);
    sh('git push -q origin main', seeder);
    // …THEN the clone is made (so it tracks the base), and ONLY AFTER that
    // does the remote move — genuine divergence, the precondition for a
    // conflicted pull.
    clone = path.join(dir, 'clone');
    sh(`git clone -q ${JSON.stringify(remote)} clone`, dir);
    sh('git config user.email local@prismgit.test && git config user.name Localer', clone);
    write(clone, 'shared.txt', 'line1\nLOCAL\nline3\n');
    sh('git add -A && git commit -q -m "local change"', clone);
    // Remote-side commit touching the same lines (moves AFTER the clone).
    write(seeder, 'shared.txt', 'line1\nREMOTE\nline3\n');
    sh('git add -A && git commit -q -m "remote change"', seeder);
    sh('git push -q origin main', seeder);
  });

  it('A. merge-strategy pull conflict: throws, leaves a MERGE-IN-PROGRESS state the UI must surface', async () => {
    await expect(gitService.pull(clone, 'origin', 'main', false)).rejects.toThrow();
    const st = await gitService.status(clone);
    expect(st.conflicted).toContain('shared.txt');
    expect(st.isMerging).toBe(true);
    // The reaction contract: the user lands on the Changes tool and the
    // merge can be completed (commit) or aborted (merge --abort).
    sh('git merge --abort', clone);
    const st2 = await gitService.status(clone);
    expect(st2.conflicted.length).toBe(0);
    expect(st2.isMerging).toBe(false);
  });

  it('B. rebase-strategy pull conflict: throws, leaves a REBASING state (Continue / Skip / Abort)', async () => {
    await expect(gitService.pull(clone, 'origin', 'main', true)).rejects.toThrow();
    const st = await gitService.status(clone);
    expect(st.conflicted).toContain('shared.txt');
    expect(st.isRebasing).toBe(true);
    // Abort restores the pre-rebase position — the recovery path the banner
    // offers the user.
    sh('git rebase --abort', clone);
    const st2 = await gitService.status(clone);
    expect(st2.conflicted.length).toBe(0);
    expect(st2.isRebasing).toBe(false);
  });
});

// ═══ C/D/E. MERGE conflicts — every classic shape ═══════════════════════════

describe('merge conflicts by shape', () => {
  it('C. text modify/modify: merge() returns the conflicts (does NOT throw) + merging state', async () => {
    const repo = await seedRepo('merge-text');
    sh('git checkout -q -b feature', repo);
    write(repo, 'shared.txt', 'line1\nFEATURE\nline3\n');
    await commit(repo, 'feature change');
    sh('git checkout -q main', repo);
    write(repo, 'shared.txt', 'line1\nMAIN\nline3\n');
    await commit(repo, 'main change');

    const result = await gitService.merge(repo, 'feature', {});
    expect(result.conflicts).toContain('shared.txt');
    const st = await gitService.status(repo);
    expect(st.isMerging).toBe(true);
    expect(st.conflicted).toContain('shared.txt');
    sh('git merge --abort', repo);
  });

  it('D. add/add (same NEW file on both branches): both contents conflict', async () => {
    const repo = await seedRepo('merge-addadd');
    sh('git checkout -q -b feature', repo);
    write(repo, 'new-file.txt', 'from feature\n');
    await commit(repo, 'feature adds file');
    sh('git checkout -q main', repo);
    write(repo, 'new-file.txt', 'from main\n');
    await commit(repo, 'main adds same file');

    const result = await gitService.merge(repo, 'feature', {});
    expect(result.conflicts).toContain('new-file.txt');
    sh('git merge --abort', repo);
  });

  it('E. delete/modify (one side deletes, the other edits): shows as conflicted', async () => {
    const repo = await seedRepo('merge-delmod');
    write(repo, 'doomed.txt', 'to be deleted\n');
    await commit(repo, 'add doomed');
    sh('git checkout -q -b feature', repo);
    sh('git rm -q doomed.txt', repo);
    await commit(repo, 'feature deletes file');
    sh('git checkout -q main', repo);
    write(repo, 'doomed.txt', 'modified on main\n');
    await commit(repo, 'main modifies file');

    const result = await gitService.merge(repo, 'feature', {});
    expect(result.conflicts).toContain('doomed.txt');
    sh('git merge --abort', repo);
  });
});

// ═══ F. REBASE — commits from different branches ════════════════════════════

describe('rebase conflict (commits from different branches)', () => {
  it('F. rebase() throws, repo left in rebasing state, conflicted file listed', async () => {
    const repo = await seedRepo('rebase-conflict');
    sh('git checkout -q -b feature', repo);
    write(repo, 'shared.txt', 'line1\nFEATURE\nline3\n');
    await commit(repo, 'feature change');
    sh('git checkout -q main', repo);
    write(repo, 'shared.txt', 'line1\nMAIN\nline3\n');
    await commit(repo, 'main change');
    sh('git checkout -q feature', repo);

    await expect(gitService.rebase(repo, 'main')).rejects.toThrow();
    const st = await gitService.status(repo);
    expect(st.isRebasing).toBe(true);
    expect(st.conflicted).toContain('shared.txt');
    // Recovery: resolve + continue, or abort back to the pre-rebase tip.
    sh('git rebase --abort', repo);
    const st2 = await gitService.status(repo);
    expect(st2.isRebasing).toBe(false);
  });
});

// ═══ G/H. CHERRY-PICK / REVERT conflicts ═══════════════════════════════════

describe('cherry-pick & revert conflicts', () => {
  it('G. cherry-pick a commit from another branch: returns { conflicts } + cherry-picking state', async () => {
    const repo = await seedRepo('pick-conflict');
    sh('git checkout -q -b feature', repo);
    write(repo, 'shared.txt', 'line1\nFEATURE\nline3\n');
    const picked = await commit(repo, 'feature change');
    sh('git checkout -q main', repo);
    write(repo, 'shared.txt', 'line1\nMAIN\nline3\n');
    await commit(repo, 'main change');

    const result = await gitService.cherryPick(repo, [picked]);
    expect(result.conflicts).toContain('shared.txt');
    const st = await gitService.status(repo);
    expect(st.isCherryPicking).toBe(true);
    sh('git cherry-pick --abort', repo);
    const st2 = await gitService.status(repo);
    expect(st2.isCherryPicking).toBe(false);
  });

  it('H. revert with a conflicting inverse: returns { conflicts }', async () => {
    const repo = await seedRepo('revert-conflict');
    write(repo, 'shared.txt', 'line1\nCHANGED\nline3\n');
    const reverted = await commit(repo, 'change to revert');
    write(repo, 'shared.txt', 'line1\nCHANGED-AGAIN\nline3\n');
    await commit(repo, 'change again on top');

    const result = await gitService.revert(repo, [reverted]);
    expect(result.conflicts).toContain('shared.txt');
    sh('git revert --abort', repo);
  });
});

// ═══ I/J. STASH pop/apply conflicts — the "silent" classic ══════════════════

describe('stash pop/apply conflicts', () => {
  it('I. pop: throws, working tree has unmerged paths, NO sequencer state, stash entry KEPT', async () => {
    const repo = await seedRepo('stash-pop');
    write(repo, 'shared.txt', 'line1\nSTASHED\nline3\n');
    await gitService.stashPush(repo, 'wip');
    write(repo, 'shared.txt', 'line1\nLATER\nline3\n');
    await commit(repo, 'conflicting commit on top');

    await expect(gitService.stashPop(repo, 0)).rejects.toThrow();
    const st = await gitService.status(repo);
    // The exact shape surfaceConflictedState was generalized for: conflicted
    // files WITHOUT any sequencer state (no MERGE_HEAD / rebase dir).
    expect(st.conflicted).toContain('shared.txt');
    expect(st.isMerging).toBe(false);
    expect(st.isRebasing).toBe(false);
    // git keeps the stash when the pop conflicts — the user must be TOLD.
    const stashes = await gitService.stashList(repo);
    expect(stashes.length).toBe(1);
    // Recovery: resolve + commit, or reset --hard to discard.
    sh('git reset -q --hard', repo);
    const st2 = await gitService.status(repo);
    expect(st2.conflicted.length).toBe(0);
    expect(st2.isClean).toBe(true);
  });

  it('J. apply: same contract, entry kept (and pop is still possible afterwards)', async () => {
    const repo = await seedRepo('stash-apply');
    write(repo, 'shared.txt', 'line1\nSTASHED\nline3\n');
    await gitService.stashPush(repo, 'wip');
    write(repo, 'shared.txt', 'line1\nLATER\nline3\n');
    await commit(repo, 'conflicting commit on top');

    await expect(gitService.stashApply(repo, 0)).rejects.toThrow();
    const st = await gitService.status(repo);
    expect(st.conflicted).toContain('shared.txt');
    expect(st.isMerging).toBe(false);
    const stashes = await gitService.stashList(repo);
    expect(stashes.length).toBe(1);
    sh('git reset -q --hard', repo);
  });
});
