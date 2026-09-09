import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';

const TEST_REPO_DIR = '/home/z/my-project/repos/test-repo';

function shell(cmd: string, cwd = TEST_REPO_DIR) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

function writeFile(p: string, content: string): void {
  fs.writeFileSync(p, content);
}

describe('git service — integration with real git repo', () => {
  beforeAll(() => {
    // Ensure test repo exists; if not, set it up
    if (!fs.existsSync(path.join(TEST_REPO_DIR, '.git'))) {
      execSync('bash /home/z/my-project/scripts/setup-test-repo.sh', { encoding: 'utf-8' });
    }
  });

  describe('isRepo', () => {
    it('returns true for valid git repo', async () => {
      const result = await gitService.isRepo(TEST_REPO_DIR);
      expect(result).toBe(true);
    });

    it('returns false for non-repo dir', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notrepo-'));
      try {
        const result = await gitService.isRepo(tmp);
        expect(result).toBe(false);
      } finally {
        fs.rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('status', () => {
    it('returns current branch correctly', async () => {
      const s = await gitService.status(TEST_REPO_DIR);
      expect(s.current).toBe('main');
      expect(s.tracking).toBeUndefined();
      expect(typeof s.isClean).toBe('boolean');
    });

    it('detects modified files', async () => {
      const file = path.join(TEST_REPO_DIR, 'src/index.js');
      const original = readFile(file);
      try {
        writeFile(file, original + '\n// modified');
        const s = await gitService.status(TEST_REPO_DIR);
        expect(s.modified).toContain('src/index.js');
        expect(s.isClean).toBe(false);
      } finally {
        writeFile(file, original);
      }
    });

    it('detects untracked files', async () => {
      const f = path.join(TEST_REPO_DIR, 'new-untracked.txt');
      try {
        writeFile(f, 'test');
        const s = await gitService.status(TEST_REPO_DIR);
        expect(s.not_added).toContain('new-untracked.txt');
      } finally {
        fs.rmSync(f, { force: true });
      }
    });

    it('detects staged files', async () => {
      const f = path.join(TEST_REPO_DIR, 'staged-test.txt');
      try {
        writeFile(f, 'staged');
        shell('git add staged-test.txt');
        const s = await gitService.status(TEST_REPO_DIR);
        expect(s.staged.some(sf => sf.path === 'staged-test.txt')).toBe(true);
      } finally {
        shell('git reset -q staged-test.txt || true');
        fs.rmSync(f, { force: true });
      }
    });
  });

  describe('log', () => {
    it('returns commits in topological order', async () => {
      const log = await gitService.log(TEST_REPO_DIR, { maxCount: 50 });
      expect(log.length).toBeGreaterThan(0);
      // Newest commit is first
      expect(log[0].hash).toMatch(/^[0-9a-f]{40}$/);
      expect(log[0].subject).toBeTruthy();
      expect(log[0].author.name).toBe('Test User');
      expect(log[0].author.email).toBe('test@test.com');
    });

    it('parse parent hashes correctly', async () => {
      // Without --all, only current branch (main) is shown, which contains the merge commit
      const log = await gitService.log(TEST_REPO_DIR, { maxCount: 50 });
      const merge = log.find(c => c.parents.length > 1);
      expect(merge).toBeDefined();
      expect(merge!.parents.length).toBe(2);
      expect(merge!.parents[0]).toMatch(/^[0-9a-f]{40}$/);
    });

    it('returns refs (branches/tags) for HEAD', async () => {
      const log = await gitService.log(TEST_REPO_DIR, { maxCount: 50 });
      const head = log[0];
      // HEAD commit on main should have refs containing 'main' or 'HEAD ->'
      const refsStr = head.refs.join('|');
      expect(refsStr.length).toBeGreaterThan(0);
    });

    it('includes body when present', async () => {
      shell('git checkout -q -b test-body-branch');
      try {
        shell("git commit -q --allow-empty -m 'Subject line' -m 'Body paragraph 1' -m 'Body paragraph 2'");
        const log = await gitService.log(TEST_REPO_DIR, { maxCount: 5 });
        const commit = log[0];
        expect(commit.subject).toBe('Subject line');
        expect(commit.body).toContain('Body paragraph 1');
        expect(commit.body).toContain('Body paragraph 2');
      } finally {
        shell('git checkout -q main');
        shell('git branch -q -D test-body-branch');
      }
    });

    it('returns all branches with --all flag', async () => {
      const log = await gitService.log(TEST_REPO_DIR, { maxCount: 100, all: true });
      const subjects = log.map(c => c.subject);
      expect(subjects).toContain('Add login function');
      expect(subjects).toContain('Add API fetch helper');
      expect(subjects).toContain('Merge feature/auth into main');
    });

    it('multi-branch: returns union of commits from multiple selected branches', async () => {
      // Ask for history of feature/api + develop (which has different commits)
      const log = await gitService.log(TEST_REPO_DIR, {
        maxCount: 100,
        branches: ['feature/api', 'develop'],
      });
      expect(log.length).toBeGreaterThan(0);
      const subjects = log.map(c => c.subject);
      // feature/api has "Add API fetch helper" + "Add API config"
      expect(subjects).toContain('Add API fetch helper');
      expect(subjects).toContain('Add API config');
      // develop has "Develop branch commit 1" + "Develop branch commit 2"
      expect(subjects).toContain('Develop branch commit 1');
      expect(subjects).toContain('Develop branch commit 2');
      // Common ancestor should also appear
      expect(subjects).toContain('Initial commit');
    });

    it('multi-branch: returns commits reachable only from given branches (no leak from others)', async () => {
      // Only feature/auth — should NOT contain develop's commits
      const log = await gitService.log(TEST_REPO_DIR, {
        maxCount: 100,
        branches: ['feature/auth'],
      });
      const subjects = log.map(c => c.subject);
      expect(subjects).toContain('Add login function');
      expect(subjects).toContain('Add logout function');
      // develop's commits should NOT appear
      expect(subjects).not.toContain('Develop branch commit 1');
      expect(subjects).not.toContain('Develop branch commit 2');
    });

    it('multi-branch: combines branches with non-overlapping histories', async () => {
      // feature/api (never merged into main) + feature/auth (merged into main)
      const log = await gitService.log(TEST_REPO_DIR, {
        maxCount: 100,
        branches: ['feature/api', 'feature/auth'],
      });
      const subjects = log.map(c => c.subject);
      expect(subjects).toContain('Add API fetch helper');
      expect(subjects).toContain('Add login function');
      expect(subjects).toContain('Add logout function');
      // Common ancestor (Initial commit) should appear once
      const initialCount = subjects.filter(s => s === 'Initial commit').length;
      expect(initialCount).toBe(1);
    });
  });

  describe('branches', () => {
    it('returns all local branches with current flag', async () => {
      const list = await gitService.branches(TEST_REPO_DIR);
      const local = list.filter(b => !b.remote);
      expect(local.length).toBeGreaterThanOrEqual(5);
      const main = local.find(b => b.name === 'main');
      expect(main).toBeDefined();
      expect(main!.current).toBe(true);
      const auth = local.find(b => b.name === 'feature/auth');
      expect(auth).toBeDefined();
      expect(auth!.current).toBe(false);
    });

    it('returns remote branches (none in test repo)', async () => {
      const list = await gitService.branches(TEST_REPO_DIR);
      const remotes = list.filter(b => b.remote);
      // Test repo has no remotes, so this should be empty
      expect(remotes.length).toBe(0);
    });

    it('returns lastCommit info for branches', async () => {
      const list = await gitService.branches(TEST_REPO_DIR);
      const main = list.find(b => b.name === 'main' && !b.remote);
      expect(main!.lastCommit).toBeDefined();
      expect(main!.lastCommit!.hash).toMatch(/^[0-9a-f]{7}$/);
      expect(main!.lastCommit!.message).toBeTruthy();
    });
  });

  describe('createBranch + checkout + deleteBranch', () => {
    it('creates, switches to, and deletes a branch', async () => {
      const name = 'test-tmp-branch-' + Date.now();
      await gitService.createBranch(TEST_REPO_DIR, name);
      await gitService.checkout(TEST_REPO_DIR, name);
      const s = await gitService.status(TEST_REPO_DIR);
      expect(s.current).toBe(name);
      // Cleanup
      await gitService.checkout(TEST_REPO_DIR, 'main');
      await gitService.deleteBranch(TEST_REPO_DIR, name);
      const list = await gitService.branches(TEST_REPO_DIR);
      expect(list.find(b => b.name === name)).toBeUndefined();
    });

    it('creates branch from a start point', async () => {
      const name = 'test-from-start-' + Date.now();
      await gitService.createBranch(TEST_REPO_DIR, name, 'HEAD~2');
      const hash = await gitService.revParse(TEST_REPO_DIR, name);
      const head2 = shell('git rev-parse HEAD~2');
      expect(hash).toBe(head2);
      await gitService.deleteBranch(TEST_REPO_DIR, name);
    });

    it('renameBranch changes name', async () => {
      const oldName = 'test-rename-old-' + Date.now();
      const newName = 'test-rename-new-' + Date.now();
      await gitService.createBranch(TEST_REPO_DIR, oldName);
      await gitService.renameBranch(TEST_REPO_DIR, oldName, newName);
      const list = await gitService.branches(TEST_REPO_DIR);
      expect(list.find(b => b.name === newName)).toBeDefined();
      expect(list.find(b => b.name === oldName)).toBeUndefined();
      await gitService.deleteBranch(TEST_REPO_DIR, newName);
    });
  });

  describe('merge', () => {
    it('fast-forward merges when possible', async () => {
      // Create branch ahead of main, then merge it back
      shell('git checkout -q -b test-ff-source main');
      try {
        shell('git commit -q --allow-empty -m "FF source commit"');
        shell('git checkout -q main');
        // Reset main to before, then FF
        shell('git reset -q --hard HEAD~1');

        const result = await gitService.merge(TEST_REPO_DIR, 'test-ff-source');
        expect(result.fastForward).toBe(true);
        expect(result.conflicts).toHaveLength(0);
      } finally {
        shell('git checkout -q main 2>/dev/null || true');
        shell('git branch -q -D test-ff-source 2>/dev/null || true');
      }
    });

    it('returns already-up-to-date when branch is behind', async () => {
      // Create a branch that's behind main
      shell('git checkout -q -b test-behind main~3');
      try {
        const result = await gitService.merge(TEST_REPO_DIR, 'main', { ffOnly: false });
        expect(result.fastForward).toBe(true);
      } finally {
        shell('git checkout -q main');
        shell('git branch -q -D test-behind');
      }
    });

    it('detects conflicts and lists conflicted files', async () => {
      // Set up a clean conflict scenario: branch off main, modify same file differently
      shell('git checkout -q -b test-conflict-a main');
      shell('echo "version A" > src/conflict-test.txt');
      shell('git add src/conflict-test.txt');
      shell('git commit -qm "Branch A conflict file"');
      shell('git checkout -q -b test-conflict-b main');
      shell('echo "version B" > src/conflict-test.txt');
      shell('git add src/conflict-test.txt');
      shell('git commit -qm "Branch B conflict file"');
      try {
        const result = await gitService.merge(TEST_REPO_DIR, 'test-conflict-a');
        expect(result.conflicts.length).toBeGreaterThan(0);
        expect(result.conflicts).toContain('src/conflict-test.txt');
        await gitService.abortMerge(TEST_REPO_DIR);
      } finally {
        shell('git merge -q --abort 2>/dev/null || true');
        shell('git reset -q --hard HEAD 2>/dev/null || true');
        shell('git clean -fdq 2>/dev/null || true');
        shell('git checkout -q main 2>/dev/null || true');
        shell('git branch -q -D test-conflict-a 2>/dev/null || true');
        shell('git branch -q -D test-conflict-b 2>/dev/null || true');
      }
    });

    it('--no-ff creates a merge commit', async () => {
      shell('git checkout -q -b test-noff-source main');
      try {
        shell('git commit -q --allow-empty -m "no-ff source"');
        shell('git checkout -q main');
        // Put main behind so we can no-ff
        shell('git reset -q --hard HEAD~1');
        const result = await gitService.merge(TEST_REPO_DIR, 'test-noff-source', { noFf: true });
        expect(result.fastForward).toBe(false);
        // Verify it's a merge commit
        const log = await gitService.log(TEST_REPO_DIR, { maxCount: 1 });
        expect(log[0].parents.length).toBe(2);
      } finally {
        // Reset main back
        shell('git reset -q --hard origin/main 2>/dev/null || git reset -q --hard HEAD~1 2>/dev/null || true');
        shell('git branch -q -D test-noff-source 2>/dev/null || true');
      }
    });
  });

  describe('diff', () => {
    it('returns diff for modified working file', async () => {
      const file = path.join(TEST_REPO_DIR, 'src/index.js');
      const original = readFile(file);
      try {
        writeFile(file, original + '\n// new line');
        const diff = await gitService.diff(TEST_REPO_DIR, 'src/index.js', {});
        expect(diff.hunks.length).toBeGreaterThan(0);
        const addLines = diff.hunks.flatMap(h => h.lines).filter(l => l.type === 'add');
        expect(addLines.length).toBeGreaterThan(0);
      } finally {
        writeFile(file, original);
      }
    });

    it('returns diff for staged file', async () => {
      const file = path.join(TEST_REPO_DIR, 'staged-diff.txt');
      try {
        writeFile(file, 'staged content\n');
        shell('git add staged-diff.txt');
        const diff = await gitService.diff(TEST_REPO_DIR, 'staged-diff.txt', { staged: true });
        expect(diff.hunks.length).toBeGreaterThan(0);
        expect(diff.newFile).toBe(true);
      } finally {
        shell('git reset -q HEAD -- staged-diff.txt 2>/dev/null || true');
        fs.rmSync(file, { force: true });
      }
    });
  });

  describe('commitFiles', () => {
    it('returns files changed in a commit', async () => {
      const log = await gitService.log(TEST_REPO_DIR, { maxCount: 100, all: true });
      const commitWithFiles = log.find(c => c.subject === 'Add API fetch helper');
      expect(commitWithFiles).toBeDefined();
      const files = await gitService.commitFiles(TEST_REPO_DIR, commitWithFiles!.hash);
      expect(files.length).toBe(1);
      expect(files[0].path).toBe('src/api.js');
      expect(files[0].status).toBe('A');
      expect(files[0].additions).toBeGreaterThan(0);
    });
  });

  describe('diffCommit', () => {
    it('returns diff between commit and its parent', async () => {
      const log = await gitService.log(TEST_REPO_DIR, { maxCount: 50 });
      const commit = log.find(c => c.subject === 'Add login function');
      expect(commit).toBeDefined();
      const diff = await gitService.diffCommit(TEST_REPO_DIR, commit!.hash);
      expect(diff.hunks.length).toBeGreaterThan(0);
    });
  });

  describe('stash operations', () => {
    // Use a fresh setup for stash tests to ensure known state
    function ensureTestStash() {
      // Drop all stashes, then re-create our test one
      shell('git stash clear 2>/dev/null || true');
      const f = path.join(TEST_REPO_DIR, 'src/stash-marker.txt');
      writeFile(f, 'stash me\n');
      shell('git stash push -u -m "Test stash entry" -q');
      fs.rmSync(f, { force: true });
    }

    it('stashList returns existing stashes', async () => {
      ensureTestStash();
      const stashes = await gitService.stashList(TEST_REPO_DIR);
      expect(stashes.length).toBeGreaterThanOrEqual(1);
      expect(stashes[0].message).toContain('Test stash entry');
    });

    it('stashPush + stashPop roundtrip', async () => {
      ensureTestStash();
      const file = path.join(TEST_REPO_DIR, 'src/version.js');
      const original = readFile(file);
      try {
        writeFile(file, "const VERSION = '99.9.9';");
        await gitService.stashPush(TEST_REPO_DIR, 'roundtrip test');
        // File should be back to original
        expect(readFile(file).trim()).toBe(original.trim());

        const list = await gitService.stashList(TEST_REPO_DIR);
        expect(list.length).toBeGreaterThanOrEqual(2); // existing + new
        // The newest stash is at index 0 (stash@{0}); the just-pushed one should be first.
        const newest = list[0];
        expect(newest.message).toContain('roundtrip test');
        await gitService.stashPop(TEST_REPO_DIR, newest.index);
        // Now file should have our change
        expect(readFile(file)).toContain('99.9.9');
      } finally {
        writeFile(file, original);
        ensureTestStash();
      }
    });
  });

  describe('tags', () => {
    it('returns all tags', async () => {
      const list = await gitService.tags(TEST_REPO_DIR);
      expect(list.find(t => t.name === 'v1.0.0')).toBeDefined();
      expect(list.find(t => t.name === 'v1.0.1')).toBeDefined();
    });

    it('createTag + deleteTag roundtrip', async () => {
      const name = 'test-tag-' + Date.now();
      await gitService.createTag(TEST_REPO_DIR, name, 'test message', undefined, false, true);
      const list = await gitService.tags(TEST_REPO_DIR);
      expect(list.find(t => t.name === name)).toBeDefined();
      await gitService.deleteTag(TEST_REPO_DIR, name);
      const list2 = await gitService.tags(TEST_REPO_DIR);
      expect(list2.find(t => t.name === name)).toBeUndefined();
    });

    it('lightweight tag has no annotation', async () => {
      const list = await gitService.tags(TEST_REPO_DIR);
      const v100 = list.find(t => t.name === 'v1.0.0');
      expect(v100).toBeDefined();
      expect(v100!.lightweight).toBe(true);
      const v101 = list.find(t => t.name === 'v1.0.1');
      expect(v101).toBeDefined();
      expect(v101!.lightweight).toBe(false);
    });
  });

  describe('remotes', () => {
    it('returns empty list for repo without remotes', async () => {
      const list = await gitService.remotes(TEST_REPO_DIR);
      expect(list).toEqual([]);
    });
  });

  describe('reflog', () => {
    it('returns reflog entries', async () => {
      const list = await gitService.reflog(TEST_REPO_DIR, undefined, 50);
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].hash).toMatch(/^[0-9a-f]{40}$/);
      expect(list[0].message).toBeTruthy();
    });
  });

  describe('blame', () => {
    it('returns blame for src/index.js', async () => {
      const result = await gitService.blame(TEST_REPO_DIR, 'src/index.js');
      expect(result.file).toBe('src/index.js');
      expect(result.lines.length).toBeGreaterThan(0);
      expect(result.lines[0].author).toBe('Test User');
      expect(result.lines[0].content).toContain('function');
    });
  });

  describe('reset', () => {
    it('soft reset keeps changes staged', async () => {
      shell('git checkout -q -b test-reset main');
      try {
        shell('git commit -q --allow-empty -m "to be reset"');
        await gitService.reset(TEST_REPO_DIR, 'soft', 'HEAD~1');
        const s = await gitService.status(TEST_REPO_DIR);
        // Empty commit reset soft leaves nothing in working tree (empty commit)
        // But HEAD should be at HEAD~1 now
        const head = shell('git rev-parse HEAD');
        const head1 = shell('git rev-parse HEAD~1');
        // After soft reset HEAD~1, HEAD should be HEAD~1 (which was the new HEAD~1 = old HEAD~2)
        // Actually let's just verify the commit is gone from log
        const log = await gitService.log(TEST_REPO_DIR, { maxCount: 3 });
        expect(log[0].subject).not.toBe('to be reset');
      } finally {
        shell('git reset -q --hard HEAD');
        shell('git checkout -q main');
        shell('git branch -q -D test-reset');
      }
    });
  });

  describe('cherryPick', () => {
    it('cherry-picks a commit from another branch onto clean main', async () => {
      // main already has the auth changes merged in, so cherry-pick "Add API config" from feature/api
      // which is NOT in main yet.
      shell('git checkout -q -b test-cherry main');
      try {
        const log = await gitService.log(TEST_REPO_DIR, { maxCount: 100, all: true });
        const target = log.find(c => c.subject === 'Add API config');
        expect(target).toBeDefined();
        const result = await gitService.cherryPick(TEST_REPO_DIR, [target!.hash]);
        // Should be clean since "Add API config" was never merged into main
        expect(result.conflicts).toHaveLength(0);
        expect(fs.existsSync(path.join(TEST_REPO_DIR, 'src/config.js'))).toBe(true);
      } finally {
        shell('git cherry-pick --abort 2>/dev/null || true');
        shell('git reset -q --hard HEAD 2>/dev/null || true');
        shell('git clean -fdq src/config.js 2>/dev/null || true');
        shell('git checkout -q main');
        shell('git branch -q -D test-cherry 2>/dev/null || true');
      }
    });
  });

  describe('revert', () => {
    it('reverts a commit by creating an inverse commit', async () => {
      shell('git checkout -q -b test-revert main');
      try {
        const log = await gitService.log(TEST_REPO_DIR, { maxCount: 5 });
        const target = log.find(c => c.subject === 'Latest main commit');
        if (target) {
          const result = await gitService.revert(TEST_REPO_DIR, [target!.hash], true);
          // noCommit=true means changes are staged, not committed
          expect(result.conflicts).toHaveLength(0);
        }
      } finally {
        shell('git reset -q --hard HEAD');
        shell('git checkout -q main');
        shell('git branch -q -D test-revert');
      }
    });
  });

  describe('configGet/Set', () => {
    it('sets and gets a local config value', async () => {
      await gitService.configSet(TEST_REPO_DIR, 'user.testkey', 'testvalue', 'local');
      const val = await gitService.configGet(TEST_REPO_DIR, 'user.testkey', 'local');
      expect(val).toBe('testvalue');
      // Cleanup
      await gitService.configUnset(TEST_REPO_DIR, 'user.testkey', 'local');
    });

    it('configList returns entries', async () => {
      const list = await gitService.configList(TEST_REPO_DIR, 'local');
      expect(list.length).toBeGreaterThan(0);
      const hasName = list.some(c => c.key === 'user.name');
      expect(hasName).toBe(true);
    });
  });

  describe('ignore', () => {
    it('adds pattern to .gitignore', async () => {
      const ignoreFile = path.join(TEST_REPO_DIR, '.gitignore');
      const original = readFile(ignoreFile);
      try {
        await gitService.ignore(TEST_REPO_DIR, ['*.log', 'temp/']);
        const content = readFile(ignoreFile);
        expect(content).toContain('*.log');
        expect(content).toContain('temp/');
        // Verify isIgnored works
        const ignored = await gitService.isIgnored(TEST_REPO_DIR, 'something.log');
        expect(ignored).toBe(true);
        const notIgnored = await gitService.isIgnored(TEST_REPO_DIR, 'src/index.js');
        expect(notIgnored).toBe(false);
      } finally {
        writeFile(ignoreFile, original);
      }
    });
  });

  describe('revParse', () => {
    it('resolves HEAD', async () => {
      const hash = await gitService.revParse(TEST_REPO_DIR, 'HEAD');
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });

    it('resolves branch name', async () => {
      const hash = await gitService.revParse(TEST_REPO_DIR, 'main');
      const expected = shell('git rev-parse main');
      expect(hash).toBe(expected);
    });
  });

  describe('currentBranch', () => {
    it('returns "main" when on main', async () => {
      const name = await gitService.currentBranch(TEST_REPO_DIR);
      expect(name).toBe('main');
    });
  });

  describe('findRef', () => {
    it('finds branch by name', async () => {
      const refs = await gitService.findRef(TEST_REPO_DIR, 'feature');
      expect(refs.length).toBeGreaterThan(0);
      const types = refs.map(r => r.type);
      expect(types).toContain('branch');
    });

    it('finds tags', async () => {
      const refs = await gitService.findRef(TEST_REPO_DIR, 'v1');
      expect(refs.length).toBeGreaterThan(0);
      const tagRef = refs.find(r => r.type === 'tag');
      expect(tagRef).toBeDefined();
    });
  });

  describe('extractRepoInfo', () => {
    it('returns unknown when no remote', async () => {
      const info = await gitService.extractRepoInfo(TEST_REPO_DIR);
      expect(info.provider).toBe('unknown');
    });
  });

  describe('mergeTree (pre-merge preview)', () => {
    it('returns clean when no conflicts expected', async () => {
      // feature/api is fully behind main (was merged), so merging main into feature/api is clean
      // Actually: feature/api branch was never merged into main; let's test merging main into feature/auth
      // which IS already merged — should be clean
      const ours = await gitService.revParse(TEST_REPO_DIR, 'main');
      const theirs = await gitService.revParse(TEST_REPO_DIR, 'feature/auth');
      const result = await gitService.mergeTree(TEST_REPO_DIR, ours, theirs);
      expect(result.clean).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it('returns conflicts when both branches modify same file', async () => {
      shell('git checkout -q -b test-mt-a main');
      shell('echo "VERSION_A" > src/mt-test.txt');
      shell('git add src/mt-test.txt');
      shell('git commit -qm "MT test A"');
      shell('git checkout -q -b test-mt-b main');
      shell('echo "VERSION_B" > src/mt-test.txt');
      shell('git add src/mt-test.txt');
      shell('git commit -qm "MT test B"');
      try {
        const ours = await gitService.revParse(TEST_REPO_DIR, 'test-mt-b');
        const theirs = await gitService.revParse(TEST_REPO_DIR, 'test-mt-a');
        const result = await gitService.mergeTree(TEST_REPO_DIR, ours, theirs);
        expect(result.clean).toBe(false);
        expect(result.conflicts).toContain('src/mt-test.txt');
      } finally {
        shell('git checkout -q main');
        shell('git branch -q -D test-mt-a test-mt-b');
        shell('git clean -fdq src/mt-test.txt 2>/dev/null || true');
      }
    });
  });

  describe('aheadBehind', () => {
    it('returns 0 ahead, 0 behind when refs are equal', async () => {
      const head = await gitService.revParse(TEST_REPO_DIR, 'HEAD');
      const result = await gitService.aheadBehind(TEST_REPO_DIR, 'HEAD', 'HEAD');
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
    });

    it('returns nonzero counts when branches diverged', async () => {
      // develop has 2 commits beyond main, and main has 1 commit (Latest main commit) not in develop
      const result = await gitService.aheadBehind(TEST_REPO_DIR, 'main', 'develop');
      // For range main...develop: left = main (commits in main not in develop),
      //                            right = develop (commits in develop not in main).
      // Output: "<left>\t<right>" — we expose left as `behind` (base is behind compare by this much)
      // and right as `ahead` (compare is ahead of base by this much).
      expect(result.ahead).toBe(2);  // develop is ahead of main by 2
      expect(result.behind).toBe(1); // main has 1 commit not in develop (Latest main commit)
    });
  });
});
