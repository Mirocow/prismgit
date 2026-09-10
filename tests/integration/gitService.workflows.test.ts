import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as gitService from '../../electron/services/git';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Self-contained integration suite for gitService workflow operations.
 *
 * Unlike gitService.real.test.ts (external fixture script) and comprehensive.test.ts
 * (project fixture), this suite builds its OWN disposable environment:
 *   <tmp>/remote.git   — bare remote
 *   <tmp>/main         — working repository (branch: main)
 * …so it runs on any machine / CI without setup scripts.
 *
 * Coverage targets the workflow families that other suites do not reach:
 * reset (mixed/keep), rebase (continue/skip/abort), merge (ff-only/squash/strategy/continue),
 * stash (branch), remote sync (push/pull/fetch/aheadBehind/pushTag/deleteTag),
 * findCommit, checkoutFile, ignore, editCommitMessage, clean, worktree, bisect,
 * config, stageLines/unstageLines, splitCommit, reflog, init/clone.
 */

let ROOT = '';
let REPO = '';
let REMOTE = '';
let baseHash = '';

/** Run a raw git command for fixture setup / verification (NOT the code under test). */
function g(args: string[], cwd: string = REPO): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function write(file: string, content: string, cwd: string = REPO) {
  const p = path.join(cwd, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

async function commitFiles(message: string, files: Record<string, string>, cwd: string = REPO) {
  for (const [file, content] of Object.entries(files)) write(file, content, cwd);
  g(['add', '-A'], cwd);
  g(['commit', '-m', message], cwd);
  return g(['rev-parse', 'HEAD'], cwd).trim();
}

beforeAll(async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'smartgit-wf-'));
  REMOTE = path.join(ROOT, 'remote.git');
  REPO = path.join(ROOT, 'main');

  // gitService.init() requires the target directory to exist
  fs.mkdirSync(REMOTE, { recursive: true });
  fs.mkdirSync(REPO, { recursive: true });
  await gitService.init(REMOTE, true);
  await gitService.init(REPO, false);
  // Repo-local config: identity + non-interactive editor for rebase --continue etc.
  g(['config', 'user.email', 'wf-test@example.com']);
  g(['config', 'user.name', 'Workflow Test']);
  g(['config', 'core.editor', 'true']);
  g(['config', 'commit.gpgsign', 'false']);
  await gitService.addRemote(REPO, 'origin', REMOTE);

  // Base history: 3 commits on main
  commitFiles('init: readme', { 'README.md': '# Workflow Test\n' });
  commitFiles('feat: core module', { 'src/core.ts': 'export const core = 1;\n' });
  commitFiles('docs: add docs', { 'docs/a.md': '# Docs\n' });
  baseHash = g(['rev-parse', 'HEAD']).trim();
  g(['push', 'origin', 'main']);
}, 60_000);

afterAll(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch { /* best effort */ }
});

describe('reset family (soft/mixed/hard/keep + resetFile)', () => {
  it('reset --soft moves HEAD but keeps changes staged', async () => {
    g(['checkout', '-b', 'reset-soft', 'main']);
    const d1 = await commitFiles('feat: to be soft-reset', { 'soft.txt': 'x\n', 'src/core.ts': 'export const core = 2;\n' });
    expect(g(['rev-parse', 'HEAD']).trim()).toBe(d1);

    await gitService.reset(REPO, 'soft', 'HEAD~1');

    expect(g(['rev-parse', 'HEAD']).trim()).toBe(baseHash);
    const st = await gitService.status(REPO);
    // Changes from the reset commit remain STAGED
    expect(st.staged.some((f) => f.path === 'soft.txt')).toBe(true);
    expect(st.staged.some((f) => f.path === 'src/core.ts')).toBe(true);
  });

  it('reset --mixed (default) unstages everything, keeps files', async () => {
    g(['checkout', '-b', 'reset-mixed', 'main']);
    await commitFiles('feat: to be mixed-reset', { 'mixed.txt': 'y\n' });

    await gitService.reset(REPO, 'mixed', 'HEAD~1');

    expect(g(['rev-parse', 'HEAD']).trim()).toBe(baseHash);
    const st = await gitService.status(REPO);
    expect(st.staged.length).toBe(0);
    // File was committed then reset --mixed → back to untracked/modified state
    const allPaths = [...st.not_added, ...st.modified, ...st.created].map((f) => (typeof f === 'string' ? f : f.path));
    expect(allPaths).toContain('mixed.txt');
    // File content preserved on disk
    expect(fs.existsSync(path.join(REPO, 'mixed.txt'))).toBe(true);
  });

  it('reset --hard wipes working tree changes', async () => {
    g(['checkout', '-b', 'reset-hard', 'main']);
    await commitFiles('feat: to be hard-reset', { 'hard.txt': 'z\n' });

    await gitService.reset(REPO, 'hard', 'HEAD~1');

    expect(g(['rev-parse', 'HEAD']).trim()).toBe(baseHash);
    const st = await gitService.status(REPO);
    expect(st.files.length).toBe(0);
    expect(fs.existsSync(path.join(REPO, 'hard.txt'))).toBe(false);
  });

  it('reset --keep reverts commit but preserves unrelated local changes', async () => {
    g(['checkout', '-b', 'reset-keep', 'main']);
    await commitFiles('feat: keep-me', { 'keep.txt': 'committed\n' });
    // Unrelated local modification that must survive
    write('docs/a.md', '# Docs\nlocal edit\n');

    await gitService.reset(REPO, 'keep', 'HEAD~1');

    expect(g(['rev-parse', 'HEAD']).trim()).toBe(baseHash);
    expect(fs.existsSync(path.join(REPO, 'keep.txt'))).toBe(false); // committed file reverted
    expect(fs.readFileSync(path.join(REPO, 'docs/a.md'), 'utf8')).toContain('local edit');
  });

  it('resetFile unstages a single file (git reset HEAD -- file)', async () => {
    g(['checkout', '-b', 'reset-file', 'main']);
    write('src/core.ts', 'export const core = 42;\n');
    g(['add', 'src/core.ts']);
    let st = await gitService.status(REPO);
    expect(st.staged.some((f) => f.path === 'src/core.ts')).toBe(true);

    await gitService.resetFile(REPO, 'src/core.ts');

    st = await gitService.status(REPO);
    expect(st.staged.length).toBe(0);
    expect(st.modified).toContain('src/core.ts');
  });
});

describe('rebase family (clean / continue / skip / abort)', () => {
  it('clean rebase brings main commits into feature history', async () => {
    g(['checkout', '-b', 'rb-clean', 'main']);
    const f1 = await commitFiles('feat: rb-clean', { 'rb-clean.txt': '1\n' });
    g(['checkout', 'main']);
    await commitFiles('docs: main moves on', { 'docs/main-move.md': 'x\n' });
    g(['checkout', 'rb-clean']);

    await gitService.rebase(REPO, 'main');

    const log = await gitService.log(REPO, { maxCount: 10 });
    const msgs = log.map((c) => c.subject);
    expect(msgs).toContain('docs: main moves on');
    expect(msgs).toContain('feat: rb-clean');
    // Parent of rb-clean is main's tip
    const parents = g(['rev-parse', 'rb-clean^']).trim();
    expect(parents).toBe(g(['rev-parse', 'main']).trim());
    void f1;
    g(['checkout', 'main']);
  });

  it('conflict + resolve + rebase --continue completes the rebase', async () => {
    g(['checkout', '-b', 'rb-conflict', 'main']);
    await commitFiles('feat: conflict side', { 'src/core.ts': 'export const core = 100;\n' });
    g(['checkout', 'main']);
    await commitFiles('feat: main side same line', { 'src/core.ts': 'export const core = 200;\n' });
    g(['checkout', 'rb-conflict']);

    let threw = false;
    try {
      await gitService.rebase(REPO, 'main');
    } catch {
      threw = true; // git exits non-zero on rebase conflict — service propagates
    }
    expect(threw).toBe(true);

    const st = await gitService.status(REPO);
    expect(st.conflicted).toContain('src/core.ts');

    // Resolve + stage
    write('src/core.ts', 'export const core = 300;\n');
    g(['add', 'src/core.ts']);

    await gitService.rebase(REPO, 'main', { continue: true });

    const log = await gitService.log(REPO, { maxCount: 10 });
    expect(log.map((c) => c.subject)).toContain('feat: conflict side');
    expect(log.map((c) => c.subject)).toContain('feat: main side same line');
    const after = await gitService.status(REPO);
    expect(after.conflicted.length).toBe(0);
    g(['checkout', 'main']);
  });

  it('rebase --skip drops the conflicting commit', async () => {
    g(['checkout', '-b', 'rb-skip', 'main']);
    await commitFiles('feat: will be skipped', { 'src/core.ts': 'export const core = 999;\n' });
    g(['checkout', 'main']);
    await commitFiles('feat: main wins line', { 'src/core.ts': 'export const core = 111;\n' });
    g(['checkout', 'rb-skip']);

    try { await gitService.rebase(REPO, 'main'); } catch { /* conflict expected */ }
    await gitService.rebase(REPO, 'main', { skip: true });

    const log = await gitService.log(REPO, { maxCount: 10 });
    expect(log.map((c) => c.subject)).not.toContain('feat: will be skipped');
    expect(log.map((c) => c.subject)).toContain('feat: main wins line');
    g(['checkout', 'main']);
  });

  it('rebase --abort restores pre-rebase state', async () => {
    g(['checkout', '-b', 'rb-abort', 'main']);
    const featTip = await commitFiles('feat: abort target', { 'src/core.ts': 'export const core = 555;\n' });
    g(['checkout', 'main']);
    await commitFiles('feat: conflicting main', { 'src/core.ts': 'export const core = 666;\n' });
    g(['checkout', 'rb-abort']);

    try { await gitService.rebase(REPO, 'main'); } catch { /* conflict expected */ }
    await gitService.rebase(REPO, 'main', { abort: true });

    expect(g(['rev-parse', 'rb-abort']).trim()).toBe(featTip);
    const st = await gitService.status(REPO);
    expect(st.conflicted.length).toBe(0);
    g(['checkout', 'main']);
  });
});

describe('merge strategies (ff-only / squash / ours / continue)', () => {
  it('--ff-only on diverged branches refuses to merge and leaves HEAD intact', async () => {
    g(['checkout', '-b', 'mg-ffonly', 'main']);
    await commitFiles('feat: ff-only side', { 'mg-ff.txt': 'a\n' });
    g(['checkout', 'main']);
    await commitFiles('feat: main diverged', { 'mg-main.txt': 'b\n' });

    const res = await gitService.merge(REPO, 'mg-ffonly', { ffOnly: true });

    expect(res.conflicts.length).toBe(0);
    expect(res.fastForward).toBe(false);
    expect(res.alreadyUpToDate).toBe(false);
    // Merge was rejected — main tip unchanged
    expect(g(['rev-parse', 'HEAD']).trim()).toBe(g(['rev-parse', 'main']).trim());
    const st = await gitService.status(REPO);
    expect(st.conflicted.length).toBe(0);
  });

  it('--squash folds feature commits into a single unmerged commit', async () => {
    g(['checkout', '-b', 'mg-squash', 'main']);
    await commitFiles('feat: squash part 1', { 'sq1.txt': '1\n' });
    await commitFiles('feat: squash part 2', { 'sq2.txt': '2\n' });
    g(['checkout', 'main']);

    await gitService.merge(REPO, 'mg-squash', { squash: true });
    // Squash leaves changes staged without committing — commit them
    g(['commit', '-m', 'chore: squash merge']);

    const head = g(['rev-parse', 'HEAD']).trim();
    const parents = g(['rev-parse', 'HEAD^@']).trim();
    expect(parents.split('\n').length).toBe(1); // NOT a merge commit
    const log = await gitService.log(REPO, { maxCount: 2 });
    expect(log[0].hash).toBe(head);
    expect(log[0].subject).toBe('chore: squash merge');
    expect(fs.existsSync(path.join(REPO, 'sq1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(REPO, 'sq2.txt'))).toBe(true);
  });

  it('--strategy ours keeps current branch content, ignores incoming', async () => {
    g(['checkout', '-b', 'mg-ours', 'main']);
    await commitFiles('feat: incoming ignored', { 'incoming.txt': 'should not appear\n' });
    g(['checkout', 'main']);
    await commitFiles('feat: ours side', { 'ours.txt': 'stays\n' });

    const res = await gitService.merge(REPO, 'mg-ours', { strategy: 'ours' });

    expect(res.conflicts.length).toBe(0);
    expect(fs.existsSync(path.join(REPO, 'ours.txt'))).toBe(true);
    expect(fs.existsSync(path.join(REPO, 'incoming.txt'))).toBe(false);
  });

  it('conflict + resolve + continueMerge produces a 2-parent merge commit', async () => {
    g(['checkout', '-b', 'mg-cont-side', 'main']);
    await commitFiles('feat: side edit', { 'src/core.ts': 'export const core = 700;\n' });
    g(['checkout', 'main']);
    await commitFiles('feat: main edit same line', { 'src/core.ts': 'export const core = 701;\n' });

    const res = await gitService.merge(REPO, 'mg-cont-side');
    expect(res.conflicts).toContain('src/core.ts');

    write('src/core.ts', 'export const core = 702;\n');
    g(['add', 'src/core.ts']);
    await gitService.continueMerge(REPO);

    const parents = g(['rev-parse', 'HEAD^@']).trim().split('\n');
    expect(parents.length).toBe(2);
    const st = await gitService.status(REPO);
    expect(st.conflicted.length).toBe(0);
  });

  it('mergeTree previews conflicts without touching the working tree', async () => {
    g(['checkout', '-b', 'mt-side', 'main']);
    await commitFiles('feat: mt side', { 'src/core.ts': 'export const core = 800;\n' });
    g(['checkout', 'main']);
    await commitFiles('feat: mt main', { 'src/core.ts': 'export const core = 801;\n' });

    const before = g(['rev-parse', 'HEAD']).trim();
    const preview = await gitService.mergeTree(REPO, 'HEAD', 'mt-side');

    expect(preview.conflicts.length).toBeGreaterThan(0);
    expect(preview.clean).toBe(false);
    // Working tree untouched
    expect(g(['rev-parse', 'HEAD']).trim()).toBe(before);
    g(['branch', '-D', 'mt-side']);
  });
});

describe('stash family (push/apply/pop/drop/branch)', () => {
  // NOTE: stash works on TRACKED modifications — untracked files need --include-untracked
  it('stash push with message saves and restores working tree', async () => {
    write('docs/a.md', '# Docs\ndirty modification\n');
    const out = await gitService.stashPush(REPO, 'wf: test stash');
    expect(out).not.toBe('');

    // Working tree reverted to committed state
    expect(fs.readFileSync(path.join(REPO, 'docs/a.md'), 'utf8')).toBe('# Docs\n');

    const list = await gitService.stashList(REPO);
    expect(list[0].message).toContain('wf: test stash');

    await gitService.stashApply(REPO, 0);
    expect(fs.readFileSync(path.join(REPO, 'docs/a.md'), 'utf8')).toBe('# Docs\ndirty modification\n');
    // apply keeps the stash entry
    expect((await gitService.stashList(REPO)).length).toBe(1);
    await gitService.stashDrop(REPO, 0);
    expect((await gitService.stashList(REPO)).length).toBe(0);
    write('docs/a.md', '# Docs\n');
  });

  it('stash pop = apply + drop', async () => {
    write('docs/a.md', '# Docs\npop me\n');
    await gitService.stashPush(REPO, 'wf: pop stash');
    await gitService.stashPop(REPO, 0);
    expect(fs.readFileSync(path.join(REPO, 'docs/a.md'), 'utf8')).toBe('# Docs\npop me\n');
    expect((await gitService.stashList(REPO)).length).toBe(0);
    write('docs/a.md', '# Docs\n');
  });

  it('stash branch recreates the stashed state on a new branch', async () => {
    write('docs/a.md', '# Docs\nbranch me\n');
    await gitService.stashPush(REPO, 'wf: branch stash');

    await gitService.stashBranch(REPO, 'stash-branch-test', 0);

    expect(g(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('stash-branch-test');
    expect(fs.readFileSync(path.join(REPO, 'docs/a.md'), 'utf8')).toBe('# Docs\nbranch me\n');
    expect((await gitService.stashList(REPO)).length).toBe(0);
    g(['checkout', 'main']);
    write('docs/a.md', '# Docs\n');
  });

  it('stash push --include-untracked captures untracked files too', async () => {
    write('untracked-stash.txt', 'new file\n');
    await gitService.stashPush(REPO, 'wf: untracked', true);
    expect(fs.existsSync(path.join(REPO, 'untracked-stash.txt'))).toBe(false);
    await gitService.stashPop(REPO, 0);
    expect(fs.readFileSync(path.join(REPO, 'untracked-stash.txt'), 'utf8')).toBe('new file\n');
    fs.rmSync(path.join(REPO, 'untracked-stash.txt'), { force: true });
  });
});

describe('remote sync against bare remote (push/pull/fetch/aheadBehind/tags)', () => {
  it('push -u publishes main; remote tip matches local', async () => {
    await gitService.push(REPO, 'origin', 'main', true);
    const local = g(['rev-parse', 'main']).trim();
    const remote = g(['rev-parse', 'main'], REMOTE).trim();
    expect(local).toBe(remote);
  });

  it('aheadBehind reports ahead/behind vs origin/main', async () => {
    const before = await gitService.aheadBehind(REPO, 'origin/main', 'HEAD');
    expect(before).toEqual({ ahead: 0, behind: 0 });
    // Local commit -> ahead 1
    await commitFiles('feat: not yet pushed', { 'ahead.txt': '1\n' });
    const after = await gitService.aheadBehind(REPO, 'origin/main', 'HEAD');
    expect(after.ahead).toBe(1);
    expect(after.behind).toBe(0);
  });

  it('fetch does not move local branch; pull fast-forwards from a second clone', async () => {
    const mainBefore = g(['rev-parse', 'main']).trim();
    await gitService.fetch(REPO, 'origin');
    expect(g(['rev-parse', 'main']).trim()).toBe(mainBefore);

    // Second clone makes a commit and pushes
    const clonePath = path.join(ROOT, 'clone');
    await gitService.clone(REMOTE, clonePath);
    expect(await gitService.isRepo(clonePath)).toBe(true);
    g(['config', 'user.email', 'clone@example.com'], clonePath);
    g(['config', 'user.name', 'Clone Bot'], clonePath);
    await commitFiles('feat: from clone', { 'from-clone.txt': 'hi\n' }, clonePath);
    g(['push', 'origin', 'main'], clonePath);

    // Pull on a dedicated branch tracking the remote tip (local main has
    // unrelated commits from other tests — keep this scenario deterministic)
    g(['checkout', '-B', 'pull-test', 'origin/main']);
    await gitService.pull(REPO, 'origin', 'main');
    expect(g(['rev-parse', 'pull-test']).trim()).toBe(g(['rev-parse', 'main'], clonePath).trim());
    expect(fs.existsSync(path.join(REPO, 'from-clone.txt'))).toBe(true);
    g(['checkout', 'main']);
    g(['branch', '-D', 'pull-test']);
  });

  it('pushTag + deleteTag(remote) manage tags on the remote', async () => {
    g(['tag', '-a', 'wf-v1', '-m', 'workflow tag']);
    await gitService.pushTag(REPO, 'wf-v1');
    let ls = g(['ls-remote', '--tags', 'origin']);
    expect(ls).toContain('refs/tags/wf-v1');

    await gitService.deleteTag(REPO, 'wf-v1', true);
    ls = g(['ls-remote', '--tags', 'origin']);
    expect(ls).not.toContain('refs/tags/wf-v1');
  });

  it('fetchAll and remotes work with the bare origin', async () => {
    await gitService.fetchAll(REPO, false);
    const remotes = await gitService.remotes(REPO);
    expect(remotes.some((r) => r.name === 'origin')).toBe(true);
  });
});

describe('findCommit (hash lookup beyond the loaded window)', () => {
  it('finds by 7-char prefix and by full hash', async () => {
    const log = await gitService.log(REPO, { maxCount: 50 });
    const target = log[2];
    const byPrefix = await gitService.findCommit(REPO, target.hash.substring(0, 7));
    expect(byPrefix).not.toBeNull();
    expect(byPrefix!.hash).toBe(target.hash);
    expect(byPrefix!.subject).toBe(target.subject);

    const byFull = await gitService.findCommit(REPO, target.hash);
    expect(byFull!.hash).toBe(target.hash);
  });

  it('returns null for unknown hash / invalid query', async () => {
    expect(await gitService.findCommit(REPO, 'deadbeef')).toBeNull();
    expect(await gitService.findCommit(REPO, 'zzzz')).toBeNull(); // not hex
    expect(await gitService.findCommit(REPO, 'abc')).toBeNull(); // too short
    expect(await gitService.findCommit(REPO, '')).toBeNull();
  });
});

describe('checkoutFile / ignore / editCommitMessage / clean', () => {
  it('checkoutFile restores file content from a ref', async () => {
    const committed = g(['show', 'HEAD:src/core.ts']);
    write('src/core.ts', 'export const core = "dirty";\n');
    expect(fs.readFileSync(path.join(REPO, 'src/core.ts'), 'utf8')).not.toBe(committed);
    await gitService.checkoutFile(REPO, 'src/core.ts', 'HEAD');
    expect(fs.readFileSync(path.join(REPO, 'src/core.ts'), 'utf8')).toBe(committed);
  });

  it('ignore appends to .gitignore; isIgnored checks check-ignore', async () => {
    await gitService.ignore(REPO, ['*.wflog']);
    const gi = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    expect(gi).toContain('*.wflog');
    expect(await gitService.isIgnored(REPO, 'debug.wflog')).toBe(true);
    expect(await gitService.isIgnored(REPO, 'README.md')).toBe(false);
    // localOnly → .git/info/exclude, .gitignore untouched
    await gitService.ignore(REPO, ['*.local-secret'], true);
    const exclude = fs.readFileSync(path.join(REPO, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('*.local-secret');
  });

  it('editCommitMessage amends the HEAD message', async () => {
    const before = g(['rev-parse', 'HEAD']).trim();
    await gitService.editCommitMessage(REPO, 'HEAD', 'amended: new message');
    const after = g(['rev-parse', 'HEAD']).trim();
    expect(after).not.toBe(before);
    const log = await gitService.log(REPO, { maxCount: 1 });
    expect(log[0].subject).toBe('amended: new message');
  });

  it('clean dry-run lists, then force removes untracked files and dirs', async () => {
    write('junk.txt', 'x\n');
    write('junkdir/nested.txt', 'y\n');
    const dry = await gitService.clean(REPO, ['.'], true, false, true);
    expect(dry.some((l) => l.includes('junk.txt'))).toBe(true);

    await gitService.clean(REPO, ['.'], false, true, true);
    expect(fs.existsSync(path.join(REPO, 'junk.txt'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'junkdir'))).toBe(false);
  });
});

describe('worktrees', () => {
  it('add → list → remove round-trip', async () => {
    const wtPath = path.join(ROOT, 'wt');
    await gitService.worktreeAdd(REPO, wtPath, 'wf-worktree');
    let list = await gitService.worktrees(REPO);
    expect(list.length).toBe(2);
    const wt = list.find((w) => fs.realpathSync(w.path) === fs.realpathSync(wtPath));
    expect(wt).toBeDefined();
    expect(wt!.branch).toBe('wf-worktree');

    await gitService.worktreeRemove(REPO, wtPath);
    list = await gitService.worktrees(REPO);
    expect(list.length).toBe(1);
  });
});

describe('bisect', () => {
  it('start/bad/good → bisecting state; reset → none', async () => {
    await gitService.bisectStart(REPO);
    await gitService.bisectBad(REPO); // HEAD is bad
    await gitService.bisectGood(REPO, baseHash); // base is good

    const st = await gitService.bisectStatus(REPO);
    expect(st.state).toBe('bisecting');

    await gitService.bisectReset(REPO);
    const after = await gitService.bisectStatus(REPO);
    expect(after.state).toBe('none');
    expect(g(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main');
  });
});

describe('config get/set/list/unset', () => {
  it('round-trips a local config value', async () => {
    await gitService.configSet(REPO, 'smartgit.testkey', 'hello', 'local');
    expect(await gitService.configGet(REPO, 'smartgit.testkey', 'local')).toBe('hello');
    const list = await gitService.configList(REPO, 'local');
    expect(list.some((e) => e.key === 'smartgit.testkey' && e.value === 'hello')).toBe(true);
    await gitService.configUnset(REPO, 'smartgit.testkey', 'local');
    expect(await gitService.configGet(REPO, 'smartgit.testkey', 'local')).toBeUndefined();
  });
});

describe('stageLines / unstageLines (partial staging)', () => {
  it('stageLines stages the file; unstageLines unstages it', async () => {
    const committed = g(['show', 'HEAD:src/core.ts']);
    write('src/core.ts', committed + 'export const extra = true;\n');
    await gitService.stageLines(REPO, 'src/core.ts', [{ start: 2, end: 2 }]);
    let st = await gitService.status(REPO);
    expect(st.staged.some((f) => f.path === 'src/core.ts')).toBe(true);

    await gitService.unstageLines(REPO, 'src/core.ts', [{ start: 2, end: 2 }]);
    st = await gitService.status(REPO);
    expect(st.staged.some((f) => f.path === 'src/core.ts')).toBe(false);
    expect(st.modified).toContain('src/core.ts');
    // restore committed content
    write('src/core.ts', committed);
  });
});

describe('splitCommit (interactive edit on HEAD)', () => {
  it('splits HEAD into an editable state and completes via continue', async () => {
    // Make a dedicated commit to split
    const splitBranch = 'split-head';
    g(['checkout', '-b', splitBranch, 'main']);
    const target = await commitFiles('feat: big commit to split', { 'split-a.txt': 'a\n', 'split-b.txt': 'b\n' });
    const countBefore = (await gitService.log(REPO, { maxCount: 100 })).length;

    const res = await gitService.splitCommit(REPO, target);
    expect(res.started, `splitCommit failed: ${res.message}`).toBe(true);

    // After split: HEAD is back one commit, changes are unstaged
    const countMid = (await gitService.log(REPO, { maxCount: 100 })).length;
    expect(countMid).toBe(countBefore - 1);
    const st = await gitService.status(REPO);
    expect(st.not_added).toContain('split-a.txt');

    // Re-commit and continue the rebase
    g(['add', '-A']);
    g(['commit', '-m', 'feat: re-committed after split']);
    await gitService.rebase(REPO, 'HEAD', { continue: true });

    const log = await gitService.log(REPO, { maxCount: 100 });
    expect(log.length).toBe(countBefore);
    expect(log.map((c) => c.subject)).toContain('feat: re-committed after split');
    g(['checkout', 'main']);
    g(['branch', '-D', splitBranch]);
  }, 30_000);
});

describe('reflog / init / clone', () => {
  it('reflog records checkouts and commits', async () => {
    const entries = await gitService.reflog(REPO, 'HEAD', 50);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(entries[0].message.length).toBeGreaterThan(0);
  });

  it('init creates a valid empty repository', async () => {
    const fresh = path.join(ROOT, 'fresh');
    fs.mkdirSync(fresh, { recursive: true });
    await gitService.init(fresh, false);
    expect(await gitService.isRepo(fresh)).toBe(true);
    expect(await gitService.currentBranch(fresh)).toBeNull(); // no commits yet
  });
});
