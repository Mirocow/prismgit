/**
 * Integration tests — gitStatusCore.runStatusJob: the status computation the
 * background git worker executes for WATCHER-driven refreshes (and that
 * gitService.status() now delegates to for foreground refreshes).
 *
 * Pins the semantics against REAL git states:
 *  - normal repo: staged/modified/untracked/renamed classification, branch,
 *    tracking, ahead/behind, HEAD hash, isClean;
 *  - unborn HEAD (fresh `git init`): current='main', no head, untracked files;
 *  - detached HEAD;
 *  - merge in progress (conflict): isMerging + conflicted + merge.subject;
 *  - rebase in progress (conflict): isRebasing + rebase {step,total};
 *  - cherry-pick in progress (conflict): isCherryPicking + {commit, subject, empty};
 *  - parity: gitService.status() (shared instance path) answers EXACTLY what
 *    runStatusJob (private-instance path, the worker's mode) answers.
 *
 * Global/system git config neutralized (same mechanism as identityConfig).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stw-data-'));
process.env.PRISMGIT_USER_DATA = TEST_DATA_DIR;
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';
const REAL_HOME = process.env.HOME;
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stw-home-'));
process.env.HOME = EMPTY_HOME;

const gitService = await import('../../electron/services/git');
const gitStatusCore = await import('../../electron/services/gitStatusCore');
const { runStatusJob, resolveHeadSha, detectRepoStateFromGitDir } = gitStatusCore;

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'ignore', 'pipe'] });
}
function out(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A repo with base commit + branch layout suitable for conflict scenarios. */
let repo: string;
let baseSha: string;

function run(path_: string): Promise<ReturnType<typeof runStatusJob>> {
  return runStatusJob({ repoPath: path_, gitDir: path.join(path_, '.git') });
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stw-repo-'));
  sh('git init -b main', repo);
  sh('git config user.email stw@test', repo);
  sh('git config user.name STW', repo);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  sh('git add .', repo);
  sh('git commit -q -m base', repo);
  baseSha = out('git rev-parse HEAD', repo);

  // Feature branch conflicting with main for the merge/rebase/cherry-pick states.
  sh('git checkout -q -b feature', repo);
  fs.writeFileSync(path.join(repo, 'conflict.txt'), 'feature version\n');
  sh('git add .', repo);
  sh('git commit -q -m feature', repo);
  sh('git checkout -q main', repo);
  fs.writeFileSync(path.join(repo, 'conflict.txt'), 'main version\n');
  sh('git add .', repo);
  sh('git commit -q -m main-side', repo);
});

afterAll(() => {
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  fs.rmSync(EMPTY_HOME, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/** Restore the clean `main` state after a conflict-state test. */
function resetToCleanMain(): void {
  sh('git rebase --abort 2>/dev/null || true', repo);
  sh('git cherry-pick --abort 2>/dev/null || true', repo);
  sh('git merge --abort 2>/dev/null || true', repo);
  sh('git checkout -q -f main', repo);
  sh('git reset -q --hard', repo);
  sh('git clean -qfd', repo);
}

describe('runStatusJob — normal repository', () => {
  it('classifies staged / modified / untracked / renamed and resolves branch + HEAD', async () => {
    sh('git checkout -q -b work', repo);
    fs.writeFileSync(path.join(repo, 'mod.txt'), 'content\n');
    sh('git add mod.txt', repo);
    sh('git commit -q -m add-mod', repo);
    fs.writeFileSync(path.join(repo, 'keep.txt'), 'v1\n');
    sh('git add keep.txt', repo);
    sh('git commit -q -m add-keep', repo);
    sh('git mv mod.txt renamed.txt', repo);           // staged rename
    fs.writeFileSync(path.join(repo, 'keep.txt'), 'v2\n'); // modified (unstaged)
    fs.writeFileSync(path.join(repo, 'new.txt'), 'untracked\n'); // untracked
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n');
    sh('git add staged.txt', repo);                   // staged new file

    try {
      const s = await run(repo);
      expect(s.current).toBe('work');
      expect(s.head).toBe(out('git rev-parse HEAD', repo));
      expect(s.isClean).toBe(false);
      expect(s.modified).toContain('keep.txt');
      expect(s.not_added).toContain('new.txt');
      expect(s.renamed).toContainEqual({ from: 'mod.txt', to: 'renamed.txt' });
      const stagedPaths = s.staged.map((f) => f.path);
      expect(stagedPaths).toContain('renamed.txt');
      expect(stagedPaths).toContain('staged.txt');
      expect(s.files.length).toBe(4); // renamed + keep + new + staged
    } finally {
      sh('git checkout -q -f main', repo);
      sh('git branch -q -D work 2>/dev/null || true', repo);
      sh('git clean -qfd', repo);
    }
  });

  it('untracked files land in not_added, staged files in staged[]', async () => {
    fs.writeFileSync(path.join(repo, 'u1.txt'), 'u\n');
    fs.writeFileSync(path.join(repo, 'u2.txt'), 'u\n');
    sh('git add u1.txt', repo);
    try {
      const s = await run(repo);
      expect(s.not_added).toContain('u2.txt');
      expect(s.staged.map((f) => f.path)).toContain('u1.txt');
      expect(s.isClean).toBe(false);
      expect(s.isMerging).toBe(false);
      expect(s.isRebasing).toBe(false);
      expect(s.isCherryPicking).toBe(false);
      expect(s.isReverting).toBe(false);
      expect(s.isBisecting).toBe(false);
    } finally {
      sh('git reset -q --hard', repo);
      sh('git clean -qfd', repo);
    }
  });
});

describe('runStatusJob — unborn HEAD', () => {
  it('answers current=main, head=undefined, untracked files parsed', async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stw-unborn-'));
    try {
      sh('git init -b trunk', fresh);
      fs.writeFileSync(path.join(fresh, 'first.txt'), 'hello\n');
      const s = await runStatusJob({ repoPath: fresh, gitDir: path.join(fresh, '.git') });
      expect(s.current).toBe('trunk');
      expect(s.head).toBeUndefined();
      expect(s.not_added).toContain('first.txt');
      expect(s.isClean).toBe(false);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe('runStatusJob — detached HEAD', () => {
  it('reports the detached state with the HEAD hash', async () => {
    sh('git checkout -q --detach ' + baseSha, repo);
    try {
      const s = await run(repo);
      expect(s.detached).toBe(true);
      expect(s.head).toBe(baseSha);
    } finally {
      sh('git checkout -q main', repo);
    }
  });
});

describe('runStatusJob — merge in progress (conflict)', () => {
  it('surfaces isMerging, conflicted files and the merge subject', async () => {
    resetToCleanMain();
    try {
      sh('git merge feature', repo); // conflict on conflict.txt → exit 1
    } catch { /* expected conflict */ }
    try {
      const s = await run(repo);
      expect(s.isMerging).toBe(true);
      expect(s.conflicted).toContain('conflict.txt');
      expect(s.merge?.message).toContain('Merge'); // MERGE_MSG first line
    } finally {
      resetToCleanMain();
    }
  });
});

describe('runStatusJob — rebase in progress (conflict)', () => {
  it('surfaces isRebasing with the sequencer progress', async () => {
    resetToCleanMain();
    try {
      sh('git rebase feature', repo); // conflict → rebase-merge dir created
    } catch { /* expected conflict */ }
    try {
      const s = await run(repo);
      expect(s.isRebasing).toBe(true);
      expect(s.rebase).toBeDefined();
      if (fs.existsSync(path.join(repo, '.git', 'rebase-merge', 'end'))) {
        expect(typeof s.rebase?.total).toBe('number');
      }
    } finally {
      resetToCleanMain();
    }
  });
});

describe('runStatusJob — cherry-pick in progress (conflict)', () => {
  it('surfaces isCherryPicking with the picked commit and subject', async () => {
    resetToCleanMain();
    const featureSha = out('git rev-parse feature', repo);
    try {
      sh('git cherry-pick feature', repo); // conflict on conflict.txt
    } catch { /* expected conflict */ }
    try {
      const s = await run(repo);
      expect(s.isCherryPicking).toBe(true);
      expect(s.cherryPick?.commit).toBe(featureSha);
      expect(s.cherryPick?.subject).toBe('feature');
    } finally {
      resetToCleanMain();
    }
  });
});

describe('runStatusJob — parity with gitService.status() (foreground path)', () => {
  it('answers the SAME result the shared-instance foreground path produces', async () => {
    resetToCleanMain();
    fs.writeFileSync(path.join(repo, 'parity.txt'), 'parity\n');
    sh('git add parity.txt', repo);
    fs.writeFileSync(path.join(repo, 'parity2.txt'), 'untracked\n');
    try {
      // status() resolves gitDir via its session cache and passes the SHARED
      // instance; runStatusJob() (the worker's mode) creates a private one.
      const [foreground, background] = await Promise.all([
        gitService.status(repo),
        runStatusJob({ repoPath: repo, gitDir: path.join(repo, '.git') }),
      ]);
      expect(background.current).toBe(foreground.current);
      expect(background.head).toBe(foreground.head);
      expect(background.ahead).toBe(foreground.ahead);
      expect(background.behind).toBe(foreground.behind);
      expect(background.isClean).toBe(foreground.isClean);
      expect(background.not_added).toEqual(foreground.not_added);
      expect(background.modified).toEqual(foreground.modified);
      expect(background.staged).toEqual(foreground.staged);
      expect(background.files.map((f) => f.path).sort()).toEqual(foreground.files.map((f) => f.path).sort());
    } finally {
      resetToCleanMain();
    }
  });

  it('gitService.statusBackground() (the new IPC surface) matches status()', async () => {
    resetToCleanMain();
    fs.writeFileSync(path.join(repo, 'bg.txt'), 'bg\n');
    try {
      const [fg, bg] = await Promise.all([
        gitService.status(repo),
        gitService.statusBackground(repo),
      ]);
      expect(bg.current).toBe(fg.current);
      expect(bg.head).toBe(fg.head);
      expect(bg.files.map((f) => f.path)).toEqual(fg.files.map((f) => f.path));
      expect(bg.isClean).toBe(fg.isClean);
    } finally {
      resetToCleanMain();
    }
  });
});

describe('core helpers (moved from git.ts)', () => {
  it('resolveHeadSha: symbolic, detached and packed refs', () => {
    const symbolic = resolveHeadSha(path.join(repo, '.git'));
    expect(symbolic).toBe(out('git rev-parse HEAD', repo));

    // Packed refs path: create a repo where the branch only exists in packed-refs
    const packed = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stw-packed-'));
    try {
      sh('git init -b main', packed);
      sh('git config user.email p@t', packed);
      sh('git config user.name P', packed);
      fs.writeFileSync(path.join(packed, 'x.txt'), 'x\n');
      sh('git add .', packed);
      sh('git commit -q -m x', packed);
      sh('git pack-refs --all', packed); // move loose refs into packed-refs
      expect(fs.existsSync(path.join(packed, '.git', 'refs', 'heads', 'main'))).toBe(false);
      expect(resolveHeadSha(path.join(packed, '.git'))).toBe(out('git rev-parse HEAD', packed));
    } finally {
      fs.rmSync(packed, { recursive: true, force: true });
    }
  });

  it('detectRepoStateFromGitDir: all flags from the .git markers', () => {
    const gitDir = path.join(repo, '.git');
    expect(detectRepoStateFromGitDir(gitDir)).toEqual({
      isMerging: false, isRebasing: false, isCherryPicking: false, isReverting: false, isBisecting: false,
    });
    const markers: Array<[string, keyof ReturnType<typeof detectRepoStateFromGitDir>]> = [
      ['MERGE_HEAD', 'isMerging'],
      ['CHERRY_PICK_HEAD', 'isCherryPicking'],
      ['REVERT_HEAD', 'isReverting'],
      ['BISECT_LOG', 'isBisecting'],
    ];
    const created: string[] = [];
    try {
      for (const [file] of markers) {
        fs.writeFileSync(path.join(gitDir, file), 'x\n');
        created.push(file);
      }
      fs.mkdirSync(path.join(gitDir, 'rebase-merge'), { recursive: true });
      const state = detectRepoStateFromGitDir(gitDir);
      expect(state.isMerging).toBe(true);
      expect(state.isRebasing).toBe(true);
      expect(state.isCherryPicking).toBe(true);
      expect(state.isReverting).toBe(true);
      expect(state.isBisecting).toBe(true);
    } finally {
      for (const file of created) fs.rmSync(path.join(gitDir, file), { force: true });
      fs.rmSync(path.join(gitDir, 'rebase-merge'), { recursive: true, force: true });
    }
  });
});
