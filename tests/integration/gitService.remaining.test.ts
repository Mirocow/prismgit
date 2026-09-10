/**
 * PrismGit — integration coverage for the REMAINING git-service surface.
 *
 * Drives `electron/services/git.ts` (the same layer behind all 179 IPC
 * handlers) against LOCAL bare repositories — zero external network.
 * Complements gitService.real / workflows / comprehensive suites, which
 * already cover the core flow; this file targets the 75 functions that
 * had no test at all (Notes, Bisect continuation, cherry-pick/revert
 * continuation, submodules, remote rename/set-url, tagsAt/groupTags,
 * stash anatomy, shallow fetch, worktrees, index flags, file ops, …).
 *
 * Every operation runs through the PrismGit client service (not raw
 * simple-git) — matching how the renderer calls the app via IPC.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';

vi.setConfig({ testTimeout: 30_000 });

let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-remaining-'));
  // git ≥2.38.1 blocks the file:// transport for submodule clones by default;
  // our "remote" is a local path, so lift that restriction for THIS process only.
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'protocol.file.allow';
  process.env.GIT_CONFIG_VALUE_0 = 'always';
});

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

function sh(cmd: string, cwd = ROOT, env: Record<string, string> = {}): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  }).trim();
}

/** Console git with deterministic identity (scenario §0.3). */
function shGit(args: string, cwd = ROOT, env: Record<string, string> = {}): string {
  return sh(`git -c user.name="Test User" -c user.email=test@test.com ${args}`, cwd, env);
}

function write(dir: string, rel: string, content: string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

/** New non-bare repo, initialised and committed THROUGH the PrismGit service. */
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

/** Local bare "remote" — created from the console like scenario §0.2. */
function bareRemote(name: string): string {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  shGit('init --bare -q -b main .', dir);
  return dir;
}

async function commitCount(repo: string): Promise<number> {
  return parseInt(await gitService.raw(repo, ['rev-list', '--count', 'HEAD']), 10);
}

async function headSubject(repo: string): Promise<string> {
  return (await gitService.raw(repo, ['log', '-1', '--format=%s'])).trim();
}

// =====================================================================
// Notes (SmartGit Notes: add / show / remove, custom refs)
// =====================================================================
describe('notes (noteAdd / noteShow / noteRemove)', () => {
  it('adds a note to a commit and reads it back', async () => {
    const repo = await mkRepo('notes-basic');
    const hash = await gitService.revParse(repo, 'HEAD');
    await gitService.noteAdd(repo, hash, 'reviewed by alice');
    expect((await gitService.noteShow(repo, hash)).trim()).toBe('reviewed by alice');
  });

  it('supports custom note refs (categories)', async () => {
    const repo = await mkRepo('notes-refs');
    const hash = await gitService.revParse(repo, 'HEAD');
    await gitService.noteAdd(repo, hash, 'ci badge: red', 'refs/notes/ci');
    expect((await gitService.noteShow(repo, hash, 'refs/notes/ci')).trim()).toBe('ci badge: red');
    // default notes ref is untouched
    expect(await gitService.noteShow(repo, hash)).toBe('');
  });

  it('requires --force to overwrite, remove empties the note', async () => {
    const repo = await mkRepo('notes-force');
    const hash = await gitService.revParse(repo, 'HEAD');
    await gitService.noteAdd(repo, hash, 'first');
    await expect(gitService.noteAdd(repo, hash, 'second')).rejects.toThrow();
    await gitService.noteAdd(repo, hash, 'second', 'refs/notes/commits', true);
    expect((await gitService.noteShow(repo, hash)).trim()).toBe('second');
    await gitService.noteRemove(repo, hash);
    expect(await gitService.noteShow(repo, hash)).toBe('');
  });
});

// =====================================================================
// Bisect continuation: bisectSkip / bisectLog / bisectStatus
// =====================================================================
describe('bisect continuation (skip / log / status)', () => {
  it('bisectStatus reports bisecting state, log contains history, skip advances, reset clears', async () => {
    const repo = await mkRepo('bisect-flow');
    for (let i = 1; i <= 4; i++) {
      write(repo, 'a.txt', `v${i}\n`);
      await gitService.addAll(repo);
      await gitService.commit(repo, `commit v${i}`);
    }
    const good = await gitService.revParse(repo, 'HEAD~3');
    await gitService.bisectStart(repo);
    await gitService.bisectBad(repo);
    await gitService.bisectGood(repo, good);

    const status = await gitService.bisectStatus(repo);
    expect(status.state).toBe('bisecting');
    expect(status.rev).toBeTruthy();

    const log = await gitService.bisectLog(repo);
    expect(log).toContain('git bisect start');

    // skip moves to another candidate but stays in bisect mode
    await gitService.bisectSkip(repo);
    expect((await gitService.bisectStatus(repo)).state).toBe('bisecting');

    await gitService.bisectReset(repo);
    expect((await gitService.bisectStatus(repo)).state).toBe('none');
  });
});

// =====================================================================
// Cherry-pick / revert: abort and continue paths
// =====================================================================
describe('cherry-pick abort/continue, revert abort/continue', () => {
  async function conflictSetup(name: string): Promise<{ repo: string; featHash: string }> {
    const repo = await mkRepo(name, { 'a.txt': 'line1\n' });
    await gitService.createBranch(repo, 'feat');
    await gitService.checkout(repo, 'feat');
    write(repo, 'a.txt', 'feat change\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'feat edit');
    const featHash = await gitService.revParse(repo, 'HEAD');
    await gitService.checkout(repo, 'main');
    write(repo, 'a.txt', 'main change\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'main edit');
    return { repo, featHash };
  }

  it('cherry-pick conflict → cherryPickAbort restores clean pre-pick state', async () => {
    const { repo, featHash } = await conflictSetup('cp-abort');
    const before = await commitCount(repo);
    const res = await gitService.cherryPick(repo, [featHash]);
    expect(res.conflicts).toContain('a.txt');
    await gitService.cherryPickAbort(repo);
    const st = await gitService.status(repo);
    expect(st.isClean).toBe(true);
    expect(read(repo, 'a.txt')).toBe('main change\n');
    expect(await commitCount(repo)).toBe(before);
  });

  it('resolve + cherryPickContinue applies the pick with original message', async () => {
    const { repo, featHash } = await conflictSetup('cp-continue');
    await gitService.cherryPick(repo, [featHash]);
    write(repo, 'a.txt', 'resolved\n');
    await gitService.add(repo, ['a.txt']);
    await gitService.cherryPickContinue(repo);
    const st = await gitService.status(repo);
    expect(st.isClean).toBe(true);
    expect(await headSubject(repo)).toBe('feat edit');
    expect(read(repo, 'a.txt')).toBe('resolved\n');
  });

  it('revert conflict → revertAbort restores state', async () => {
    const repo = await mkRepo('rv-abort', { 'a.txt': 'v1\n' });
    write(repo, 'a.txt', 'v2\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'bump to v2');
    const first = await gitService.revParse(repo, 'HEAD~1');
    const res = await gitService.revert(repo, [first]);
    expect(res.conflicts).toContain('a.txt');
    await gitService.revertAbort(repo);
    const st = await gitService.status(repo);
    expect(st.isClean).toBe(true);
    expect(read(repo, 'a.txt')).toBe('v2\n');
    expect(await commitCount(repo)).toBe(2);
  });

  it('resolve + revertContinue completes the revert', async () => {
    const repo = await mkRepo('rv-continue', { 'a.txt': 'v1\n' });
    write(repo, 'a.txt', 'v2\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'bump to v2');
    const first = await gitService.revParse(repo, 'HEAD~1');
    await gitService.revert(repo, [first]);
    write(repo, 'a.txt', 'v2 reverted\n');
    await gitService.add(repo, ['a.txt']);
    await gitService.revertContinue(repo);
    const st = await gitService.status(repo);
    expect(st.isClean).toBe(true);
    expect(await headSubject(repo)).toBe('Revert "seed commit"');
  });
});

// =====================================================================
// Submodules (local bare-free sub repo, no network)
// =====================================================================
describe('submodules (list / sync / deinit)', () => {
  it('submoduleAdd + submodules() reports parsed metadata, sync is a no-op', async () => {
    const sub = await mkRepo('submod-src', { 'lib.txt': 'lib\n' });
    const parent = await mkRepo('submod-parent', { 'app.txt': 'app\n' });
    await gitService.submoduleAdd(parent, sub, 'libs/sub');

    const list = await gitService.submodules(parent);
    expect(list).toHaveLength(1);
    const info = list[0];
    // git names the .gitmodules section after the PATH when no explicit name is given
    expect(info.name).toBe('libs/sub');
    expect(info.path).toBe('libs/sub');
    expect(info.url).toBe(sub);
    expect(info.initialized).toBe(true);
    expect(info.upToDate).toBe(true);
    expect(info.currentCommit).toBeTruthy();
    expect(info.trackedCommit).toBe(info.currentCommit);

    // sync must succeed (resolves URLs; nothing to change locally)
    await gitService.submoduleSync(parent);
  });

  it('submoduleDeinit removes the working tree, submodules() flags uninitialized', async () => {
    const sub = await mkRepo('submod-src2', { 'lib.txt': 'lib\n' });
    const parent = await mkRepo('submod-parent2', { 'app.txt': 'app\n' });
    await gitService.submoduleAdd(parent, sub, 'libs/sub');

    await gitService.submoduleDeinit(parent, 'libs/sub', true);
    expect(fs.existsSync(path.join(parent, 'libs', 'sub', '.git'))).toBe(false);
    const list = await gitService.submodules(parent);
    expect(list[0].initialized).toBe(false);
  });

  it('repo without .gitmodules returns empty list', async () => {
    const repo = await mkRepo('no-submods');
    expect(await gitService.submodules(repo)).toEqual([]);
  });
});

// =====================================================================
// Remotes: rename / set-url / list
// =====================================================================
describe('remote rename and set-url', () => {
  it('renameRemote renames, setRemoteUrl changes fetch and push URLs', async () => {
    const origin = bareRemote('remote-origin.git');
    const repo = await mkRepo('remote-mgmt');
    await gitService.addRemote(repo, 'origin', origin);
    expect((await gitService.remotes(repo)).map(r => r.name)).toEqual(['origin']);

    await gitService.renameRemote(repo, 'origin', 'upstream');
    expect((await gitService.remotes(repo)).map(r => r.name)).toEqual(['upstream']);

    const origin2 = bareRemote('remote-origin2.git');
    await gitService.setRemoteUrl(repo, 'upstream', origin2);
    let remotes = await gitService.remotes(repo);
    expect(remotes[0].refs.fetch).toBe(origin2);
    expect(remotes[0].refs.push).toBe(origin2);

    // separate push URL (e.g. Gerrit ssh vs https fetch)
    const origin3 = bareRemote('remote-origin3.git');
    await gitService.setRemoteUrl(repo, 'upstream', origin3, true);
    remotes = await gitService.remotes(repo);
    expect(remotes[0].refs.fetch).toBe(origin2);
    expect(remotes[0].refs.push).toBe(origin3);
  });
});

// =====================================================================
// Tags at commit + grouping
// =====================================================================
describe('tagsAt and groupTags', () => {
  it('tagsAt distinguishes lightweight vs annotated tags pointing at a commit', async () => {
    const repo = await mkRepo('tags-at');
    const hash = await gitService.revParse(repo, 'HEAD');
    await gitService.raw(repo, ['tag', 'light-tag']);
    await gitService.addAnnotatedTag(repo, 'v1.0.0', 'release one');

    const tags = await gitService.tagsAt(repo, hash);
    expect(tags).toHaveLength(2);
    const light = tags.find(t => t.name === 'light-tag')!;
    const ann = tags.find(t => t.name === 'v1.0.0')!;
    expect(light.annotated).toBe(false);
    expect(ann.annotated).toBe(true);
    expect(ann.message).toBe('release one');
    expect(ann.tagger).toBeTruthy();
    expect(ann.date).toBeTruthy();
  });

  it('groupTags buckets semver prefixes, sorts by latest, leftovers go to Other', () => {
    const mk = (name: string, date: string): any => ({ name, hash: 'h-' + name, hashAbbrev: 'abc1234', date, lightweight: false });
    const tags = [
      mk('v1.0.0', '2024-01-01T00:00:00Z'),
      mk('v1.0.2', '2024-01-03T00:00:00Z'),
      mk('v1.1.0', '2024-02-01T00:00:00Z'),
      mk('weekly-42', '2024-03-01T00:00:00Z'),
    ];
    const groups = gitService.groupTags(tags);
    const byName = Object.fromEntries(groups.map(g => [g.name, g]));
    expect(Object.keys(byName).sort()).toEqual(['1.0', '1.1', 'Other']); // pattern strips the leading v
    expect(byName['1.0'].tags).toHaveLength(2);
    expect(byName['1.0'].latest!.name).toBe('v1.0.2'); // newest first inside group
    expect(groups[0].name).toBe('1.1'); // groups sorted by latest date desc
    expect(byName['Other'].tags.map(t => t.name)).toEqual(['weekly-42']);
  });
});

// =====================================================================
// Stash anatomy: stashFiles / stashFileRawDiff (tracked + untracked parts)
// =====================================================================
describe('stash anatomy (stashFiles / stashFileRawDiff)', () => {
  it('lists tracked AND untracked files of a stash with per-file raw diffs', async () => {
    const repo = await mkRepo('stash-anatomy');
    write(repo, 'a.txt', 'alpha modified\n');
    write(repo, 'brand-new.txt', 'untracked content\n');
    await gitService.stashPush(repo, 'mixed stash', true);

    const stashes = await gitService.stashList(repo);
    expect(stashes.length).toBeGreaterThanOrEqual(1);
    const hash = stashes[0].hash;

    const files = await gitService.stashFiles(repo, hash);
    const tracked = files.find(f => f.path === 'a.txt');
    const untracked = files.find(f => f.path === 'brand-new.txt');
    expect(tracked).toBeTruthy();
    expect(tracked!.status).toBe('M');
    expect(untracked).toBeTruthy();
    expect(untracked!.status).toBe('A');

    const trackedDiff = await gitService.stashFileRawDiff(repo, hash, 'a.txt');
    expect(trackedDiff).toContain('a.txt');
    const untrackedDiff = await gitService.stashFileRawDiff(repo, hash, 'brand-new.txt');
    expect(untrackedDiff).toContain('untracked content');

    await gitService.stashDrop(repo);
  });
});

// =====================================================================
// Shallow clone: fetchDeepen / setFetchDepth
// =====================================================================
describe('shallow fetch (fetchDeepen / setFetchDepth)', () => {
  it('deepens a shallow clone step by step and unshallows at depth 0', async () => {
    // build a 5-commit source and push it to a local bare remote
    const src = await mkRepo('shallow-src');
    for (let i = 2; i <= 5; i++) {
      write(src, 'a.txt', `v${i}\n`);
      await gitService.addAll(src);
      await gitService.commit(src, `commit v${i}`);
    }
    const bare = bareRemote('shallow-origin.git');
    await gitService.addRemote(src, 'origin', bare);
    await gitService.push(src, 'origin', 'main', true);

    // file:// transport is required for --depth to take effect locally
    const target = path.join(ROOT, 'shallow-clone');
    await gitService.clone(`file://${bare}`, target, { depth: 1 });
    await gitService.configSet(target, 'user.name', 'Test User', 'local');
    await gitService.configSet(target, 'user.email', 'test@test.com', 'local');
    expect(await commitCount(target)).toBe(1);

    await gitService.fetchDeepen(target, 'origin', 2);
    expect(await commitCount(target)).toBe(3);

    await gitService.setFetchDepth(target, 'origin', 4);
    expect(await commitCount(target)).toBe(4);

    await gitService.setFetchDepth(target, 'origin', 0); // unshallow
    expect(await commitCount(target)).toBe(5);
  });
});

// =====================================================================
// Worktrees: move / prune
// =====================================================================
describe('worktrees (move / prune)', () => {
  it('worktreeMove relocates a linked worktree, prune clears stale records', async () => {
    const repo = await mkRepo('wt-main');
    const wt1 = path.join(ROOT, 'wt-joined');
    const wt2 = path.join(ROOT, 'wt-moved');
    await gitService.worktreeAdd(repo, wt1, 'wt-branch');

    let list = await gitService.worktrees(repo);
    // On macOS, git may resolve /tmp → /private/tmp — compare realpaths
    const hasWt1 = list.some(w => fs.realpathSync(w.path) === fs.realpathSync(wt1) && w.branch === 'wt-branch');
    expect(hasWt1).toBe(true);

    await gitService.worktreeMove(repo, wt1, wt2);
    list = await gitService.worktrees(repo);
    const hasWt2 = list.some(w => { try { return fs.realpathSync(w.path) === fs.realpathSync(wt2); } catch { return false; } });
    const hasOldWt1 = list.some(w => { try { return fs.realpathSync(w.path) === fs.realpathSync(wt1); } catch { return false; } });
    expect(hasWt2).toBe(true);
    expect(hasOldWt1).toBe(false);
    expect(fs.existsSync(path.join(wt2, 'a.txt'))).toBe(true); // contents follow the move

    await gitService.worktreeRemove(repo, wt2);
    list = await gitService.worktrees(repo);
    const stillHasWt2 = list.some(w => { try { return fs.realpathSync(w.path) === fs.realpathSync(wt2); } catch { return false; } });
    expect(stillHasWt2).toBe(false);

    await expect(gitService.worktreePrune(repo)).resolves.toBeUndefined();
  });
});

// =====================================================================
// Index flags: skip-worktree / assume-unchanged
// =====================================================================
describe('index flags (getIndexFlags / setIndexFlag)', () => {
  it('skip-worktree round-trips on a tracked file', async () => {
    const repo = await mkRepo('flags-skip');
    await gitService.setIndexFlag(repo, 'a.txt', 'skip-worktree', true);
    expect(await gitService.getIndexFlags(repo, 'a.txt')).toEqual({
      assumeUnchanged: false, skipWorktree: true, tracked: true,
    });
    await gitService.setIndexFlag(repo, 'a.txt', 'skip-worktree', false);
    const flags = await gitService.getIndexFlags(repo, 'a.txt');
    expect(flags.skipWorktree).toBe(false);
    expect(flags.tracked).toBe(true);
  });

  it('assume-unchanged round-trips and untracked files report tracked=false', async () => {
    const repo = await mkRepo('flags-au');
    write(repo, 'untracked.txt', 'nope\n');
    await gitService.setIndexFlag(repo, 'a.txt', 'assume-unchanged', true);
    expect((await gitService.getIndexFlags(repo, 'a.txt')).assumeUnchanged).toBe(true);
    expect(await gitService.getIndexFlags(repo, 'untracked.txt')).toEqual({
      assumeUnchanged: false, skipWorktree: false, tracked: false,
    });
  });
});

// =====================================================================
// File operations: moveFile / deleteFile / applyLineEdit
// =====================================================================
describe('file operations (moveFile / deleteFile / applyLineEdit)', () => {
  it('moveFile on a tracked file stages a rename', async () => {
    const repo = await mkRepo('mv-tracked');
    await gitService.moveFile(repo, 'a.txt', 'sub/moved.txt');
    expect(fs.existsSync(path.join(repo, 'sub', 'moved.txt'))).toBe(true);
    expect(fs.existsSync(path.join(repo, 'a.txt'))).toBe(false);
    const st = await gitService.status(repo);
    expect(st.renamed.map(r => r.to)).toContain('sub/moved.txt');
  });

  it('moveFile falls back to filesystem rename for untracked files', async () => {
    const repo = await mkRepo('mv-untracked');
    write(repo, 'loose.txt', 'not committed\n');
    await gitService.moveFile(repo, 'loose.txt', 'renamed-loose.txt');
    expect(fs.existsSync(path.join(repo, 'renamed-loose.txt'))).toBe(true);
    expect(fs.existsSync(path.join(repo, 'loose.txt'))).toBe(false);
  });

  it('moveFile rejects a missing source', async () => {
    const repo = await mkRepo('mv-missing');
    await expect(gitService.moveFile(repo, 'ghost.txt', 'x.txt')).rejects.toThrow(/Source not found/);
  });

  it('deleteFile removes tracked (git rm) and untracked (fs) files', async () => {
    const repo = await mkRepo('del-files');
    write(repo, 'loose.txt', 'temp\n');
    await gitService.deleteFile(repo, 'a.txt');
    await gitService.deleteFile(repo, 'loose.txt');
    expect(fs.existsSync(path.join(repo, 'a.txt'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'loose.txt'))).toBe(false);
    const st = await gitService.status(repo);
    expect(st.staged.map(f => f.path)).toContain('a.txt'); // tracked deletion staged via git rm
  });

  it('applyLineEdit edits one line, optionally staging the change', async () => {
    const repo = await mkRepo('line-edit', { 'a.txt': 'one\ntwo\nthree\n' });
    await gitService.applyLineEdit(repo, 'a.txt', 2, 'TWO');
    expect(read(repo, 'a.txt')).toBe('one\nTWO\nthree\n');
    await gitService.applyLineEdit(repo, 'a.txt', 1, 'ONE', true);
    const st = await gitService.status(repo);
    expect(st.staged.map(f => f.path)).toContain('a.txt');
  });

  it('applyLineEdit rejects out-of-range line numbers', async () => {
    const repo = await mkRepo('line-range', { 'a.txt': 'one\n' });
    await expect(gitService.applyLineEdit(repo, 'a.txt', 5, 'x')).rejects.toThrow(/out of range/);
    await expect(gitService.applyLineEdit(repo, 'a.txt', 0, 'x')).rejects.toThrow(/out of range/);
  });
});

// =====================================================================
// Repo introspection: mergeNestedCommits / isCommitPushed / recyclableCommits
// =====================================================================
describe('repo introspection (mergeNestedCommits / isCommitPushed / recyclableCommits)', () => {
  it('mergeNestedCommits returns second-parent commits of a merge, [] for plain commits', async () => {
    const repo = await mkRepo('nested-merge');
    const seedHash = await gitService.revParse(repo, 'HEAD');
    await gitService.createBranch(repo, 'feat');
    await gitService.checkout(repo, 'feat');
    write(repo, 'f1.txt', 'feature\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'feat work');
    const featHash = await gitService.revParse(repo, 'HEAD');
    await gitService.checkout(repo, 'main');
    write(repo, 'f2.txt', 'mainline\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'mainline work');
    await gitService.merge(repo, 'feat', { noFf: true });
    const mergeHash = await gitService.revParse(repo, 'HEAD');

    const nested = await gitService.mergeNestedCommits(repo, mergeHash);
    expect(nested.map(c => c.hash)).toContain(featHash);
    // plain commits (even the seed root) have no nested history
    expect(await gitService.mergeNestedCommits(repo, seedHash)).toEqual([]);
    // unknown hash → []
    expect(await gitService.mergeNestedCommits(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toEqual([]);
  });

  it('isCommitPushed distinguishes pushed vs local-only commits', async () => {
    const bare = bareRemote('pushed-check.git');
    const repo = await mkRepo('pushed-check');
    await gitService.addRemote(repo, 'origin', bare);
    await gitService.push(repo, 'origin', 'main', true);
    const pushedHash = await gitService.revParse(repo, 'HEAD');

    write(repo, 'a.txt', 'local only\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'not pushed yet');
    const localHash = await gitService.revParse(repo, 'HEAD');

    expect(await gitService.isCommitPushed(repo, pushedHash)).toBe(true);
    expect(await gitService.isCommitPushed(repo, localHash)).toBe(false);
  });

  it('recyclableCommits finds reflog-only commits after reset --hard', async () => {
    const repo = await mkRepo('recyclable');
    // fresh repo: everything reachable → empty
    expect(await gitService.recyclableCommits(repo)).toEqual([]);

    write(repo, 'a.txt', 'second\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'doomed commit');
    const doomed = await gitService.revParse(repo, 'HEAD');
    await gitService.raw(repo, ['reset', '--hard', 'HEAD~1']);

    const recyclable = await gitService.recyclableCommits(repo);
    expect(recyclable.map(c => c.hash)).toContain(doomed);
    const entry = recyclable.find(c => c.hash === doomed)!;
    expect(entry.subject).toBe('doomed commit');
    expect(entry.hashAbbrev).toHaveLength(8);
    expect(entry.timestamp).toBeGreaterThan(0);
  });
});

// =====================================================================
// Filesystem & object introspection
// =====================================================================
describe('fs & object introspection (trackedFiles / listDirectories / countObjects / updateServerInfo / revParseArgs)', () => {
  it('trackedFiles lists all committed paths', async () => {
    const repo = await mkRepo('tracked', { 'a.txt': 'a\n', 'src/deep/mod.ts': 'export {};\n' });
    await gitService.addAll(repo);
    await gitService.commit(repo, 'add nested');
    const files = await gitService.trackedFiles(repo);
    expect(files).toContain('a.txt');
    expect(files).toContain('src/deep/mod.ts');
  });

  it('listDirectories builds a nested tree of working-dir folders', async () => {
    const repo = await mkRepo('dirs');
    write(repo, 'src/lib/deep.txt', 'x\n');
    const tree = await gitService.listDirectories(repo);
    const src = tree.find(d => d.name === 'src');
    expect(src).toBeTruthy();
    const lib = src!.children.find(d => d.name === 'lib');
    expect(lib).toBeTruthy();
    expect(lib!.path).toBe('src/lib');
  });

  it('countObjects -v reports object stats; updateServerInfo writes info/refs', async () => {
    const repo = await mkRepo('count-obj');
    const out = await gitService.countObjects(repo, true);
    expect(out).toContain('count:');
    expect(out).toContain('size:');
    await gitService.updateServerInfo(repo);
    expect(fs.existsSync(path.join(repo, '.git', 'info', 'refs'))).toBe(true);
  });

  it('revParseArgs covers short hash, abbrev-ref and bare checks', async () => {
    const repo = await mkRepo('revparse');
    const short = await gitService.revParseArgs(repo, ['--short', 'HEAD']);
    expect(short.trim()).toMatch(/^[0-9a-f]{7,}$/);
    expect((await gitService.revParseArgs(repo, ['--abbrev-ref', 'HEAD'])).trim()).toBe('main');
    expect((await gitService.revParseArgs(repo, ['--is-bare-repository'])).trim()).toBe('false');
    // On macOS, /tmp is a symlink to /private/tmp — resolve both sides
    const toplevel = (await gitService.revParseArgs(repo, ['--show-toplevel'])).trim();
    expect(fs.realpathSync(toplevel)).toBe(fs.realpathSync(path.resolve(repo)));
  });
});

// =====================================================================
// show / showBuffer (binary-safe) / diffBranches / forceCompare
// =====================================================================
describe('show family (show / showBuffer / diffBranches / forceCompare)', () => {
  it('show reads file content at HEAD and commit stats', async () => {
    const repo = await mkRepo('show-txt');
    expect(await gitService.show(repo, ['HEAD:a.txt'])).toBe('alpha\n');
    const stat = await gitService.show(repo, ['--stat', '--format=', 'HEAD']);
    expect(stat).toContain('a.txt');
  });

  it('showBuffer returns byte-exact binary content', async () => {
    const repo = await mkRepo('show-bin');
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    fs.writeFileSync(path.join(repo, 'blob.bin'), bytes);
    await gitService.addAll(repo);
    await gitService.commit(repo, 'add binary');
    const buf = await gitService.showBuffer(repo, ['HEAD:blob.bin']);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.equals(bytes)).toBe(true);
  });

  it('diffBranches produces hunks between branch tips; forceCompare delegates to diff', async () => {
    const repo = await mkRepo('diff-branches');
    await gitService.createBranch(repo, 'feat');
    await gitService.checkout(repo, 'feat');
    write(repo, 'feat.txt', 'feature line\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'feat commit');
    await gitService.checkout(repo, 'main');

    const res = await gitService.diffBranches(repo, 'main', 'feat');
    expect(res.hunks.length).toBeGreaterThan(0);
    expect(res.newPath).toBe('feat');

    write(repo, 'a.txt', 'alpha edited\n');
    const force = await gitService.forceCompare(repo, 'a.txt');
    expect(force.hunks.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// History mining: blameBidirectional / pickaxeSearch / detectRenames
// =====================================================================
describe('history mining (blameBidirectional / pickaxeSearch / detectRenames)', () => {
  it('blameBidirectional pairs past blame with future commit candidates', async () => {
    const repo = await mkRepo('blame-bi', {}); // no seed commit — dated commits below
    write(repo, 'code.txt', 'line one\nline two\n');
    const env1 = { GIT_AUTHOR_DATE: '2024-01-01T00:00:01+00:00', GIT_COMMITTER_DATE: '2024-01-01T00:00:01+00:00' };
    shGit('add -A', repo, env1);
    shGit('commit -m "first cut" --no-gpg-sign', repo, env1);
    write(repo, 'code.txt', 'line one rewritten\nline two\n');
    const env2 = { GIT_AUTHOR_DATE: '2024-01-02T00:00:02+00:00', GIT_COMMITTER_DATE: '2024-01-02T00:00:02+00:00' };
    shGit('add -A', repo, env2);
    shGit('commit -m "rewrite line one" --no-gpg-sign', repo, env2);

    const result = await gitService.blameBidirectional(repo, 'code.txt');
    expect(result.past.lines).toHaveLength(2);
    // line 1 was rewritten by the later commit; line 2 is still from the first
    const first = result.past.lines.find(l => l.finalLineNumber === 1)!;
    const second = result.past.lines.find(l => l.finalLineNumber === 2)!;
    expect(first.summary).toBe('rewrite line one');
    expect(second.summary).toBe('first cut');
    // future candidates exist only for the older line
    const future = result.futureLines.find(f => f.lineNumber === 2);
    expect(future).toBeTruthy();
    expect(future!.commits.map(c => c.subject)).toContain('rewrite line one');
    expect(result.futureLines.find(f => f.lineNumber === 1)).toBeUndefined();
  });

  it('pickaxeSearch finds commits that added and removed a string', async () => {
    const repo = await mkRepo('pickaxe', { 'todo.txt': 'work item\n' });
    write(repo, 'todo.txt', 'TODO fix later\nwork item\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'introduce TODO');
    const addHash = await gitService.revParse(repo, 'HEAD');
    write(repo, 'todo.txt', 'work item\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'resolve TODO');
    const rmHash = await gitService.revParse(repo, 'HEAD');

    const hits = await gitService.pickaxeSearch(repo, 'todo.txt', 'TODO');
    expect(hits.map(h => h.hash)).toEqual([rmHash, addHash]); // git log order: newest first
    // case-insensitive mode still matches
    const ci = await gitService.pickaxeSearch(repo, 'todo.txt', 'todo', { ignoreCase: true });
    expect(ci).toHaveLength(2);
  });

  it('detectRenames spots a staged rename with similarity', async () => {
    const repo = await mkRepo('rename-detect');
    await gitService.moveFile(repo, 'a.txt', 'renamed.txt');
    const renames = await gitService.detectRenames(repo);
    const pair = renames.find(r => r.to === 'renamed.txt');
    expect(pair).toBeTruthy();
    expect(pair!.from).toBe('a.txt');
    expect(pair!.similarity).toBeGreaterThan(0);
  });
});

// =====================================================================
// Smart operations: smartPull strategies / octopusMerge / autoStash
// =====================================================================
describe('smartPull strategies (reset / rebase / fast-forward)', () => {
  async function cloneSetup(name: string): Promise<{ bare: string; a: string; b: string }> {
    const bare = bareRemote(`${name}-origin.git`);
    const seed = await mkRepo(`${name}-seed`);
    await gitService.addRemote(seed, 'origin', bare);
    await gitService.push(seed, 'origin', 'main', true);
    const a = path.join(ROOT, `${name}-a`);
    const b = path.join(ROOT, `${name}-b`);
    await gitService.clone(bare, a);
    await gitService.clone(bare, b);
    await gitService.configSet(a, 'user.name', 'Test User', 'local');
    await gitService.configSet(a, 'user.email', 'test@test.com', 'local');
    await gitService.configSet(b, 'user.name', 'Test User', 'local');
    await gitService.configSet(b, 'user.email', 'test@test.com', 'local');
    return { bare, a, b };
  }

  it('clean tree + no local commits + behind → reset to remote', async () => {
    const { a, b } = await cloneSetup('sp-reset');
    write(b, 'a.txt', 'from b\n');
    await gitService.addAll(b);
    await gitService.commit(b, 'remote advance');
    await gitService.push(b, 'origin', 'main');

    const res = await gitService.smartPull(a);
    expect(res.strategy).toBe('reset');
    expect(res.message).toContain('origin/main');
    expect(await gitService.raw(a, ['log', '-1', '--format=%s'])).toContain('remote advance');
  });

  it('local commits ahead → rebase preserves them linearly', async () => {
    const { a, b } = await cloneSetup('sp-rebase');
    write(b, 'a.txt', 'from b\n');
    await gitService.addAll(b);
    await gitService.commit(b, 'remote advance');
    await gitService.push(b, 'origin', 'main');

    write(a, 'local.txt', 'local work\n');
    await gitService.addAll(a);
    await gitService.commit(a, 'local commit');

    const res = await gitService.smartPull(a);
    expect(res.strategy).toBe('rebase');
    const subjects = (await gitService.raw(a, ['log', '--format=%s'])).trim().split('\n');
    expect(subjects).toContain('local commit');
    expect(subjects).toContain('remote advance');
    // linear history: every commit has exactly one parent (except root)
    const parents = await gitService.raw(a, ['rev-list', '--parents', '--all']);
    for (const line of parents.trim().split('\n')) {
      expect(line.trim().split(/\s+/).length).toBeLessThanOrEqual(2);
    }
  });

  it('dirty unrelated file + behind → fast-forward keeps local changes', async () => {
    const { a, b } = await cloneSetup('sp-ff');
    write(b, 'a.txt', 'from b\n');
    await gitService.addAll(b);
    await gitService.commit(b, 'remote advance');
    await gitService.push(b, 'origin', 'main');

    write(a, 'dirty.txt', 'uncommitted\n');
    const res = await gitService.smartPull(a);
    expect(res.strategy).toBe('merge');
    expect((await gitService.raw(a, ['log', '-1', '--format=%s'])).trim()).toBe('remote advance');
    expect(read(a, 'dirty.txt')).toBe('uncommitted\n'); // untouched
  });
});

describe('octopusMerge', () => {
  it('merges three diverged branches into one 4-parent commit', async () => {
    const repo = await mkRepo('octopus', { 'f1.txt': 'f1\n', 'f2.txt': 'f2\n', 'f3.txt': 'f3\n' });
    for (const b of ['b1', 'b2', 'b3']) await gitService.createBranch(repo, b);
    for (const [b, f] of [['b1', 'f1'], ['b2', 'f2'], ['b3', 'f3']] as const) {
      await gitService.checkout(repo, b);
      write(repo, `${f}.txt`, `${f} changed\n`);
      await gitService.addAll(repo);
      await gitService.commit(repo, `${b} work`);
    }
    await gitService.checkout(repo, 'main');

    const res = await gitService.octopusMerge(repo, ['b1', 'b2', 'b3']);
    expect(res.success).toBe(true);
    expect(res.conflicts).toEqual([]);
    const parents = (await gitService.raw(repo, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(/\s+/);
    expect(parents).toHaveLength(4); // merge + main(ff→b1) + b2 + b3
  });

  it('requires at least 2 branches', async () => {
    const repo = await mkRepo('octopus-err');
    await expect(gitService.octopusMerge(repo, ['only-one'])).rejects.toThrow(/at least 2/);
  });
});

describe('autoStash', () => {
  it('temporarily cleans the tree, runs fn, restores dirty state and return value', async () => {
    const repo = await mkRepo('autostash');
    write(repo, 'a.txt', 'dirty work\n');
    let cleanDuringFn = false;
    const ret = await gitService.autoStash(repo, async () => {
      cleanDuringFn = (await gitService.status(repo)).isClean;
      return 42;
    });
    expect(ret).toBe(42);
    expect(cleanDuringFn).toBe(true);
    expect((await gitService.status(repo)).isClean).toBe(false);
    expect(read(repo, 'a.txt')).toBe('dirty work\n');
  });
});

// =====================================================================
// History surgery: squashCommits / coalesceCommits
// =====================================================================
describe('history surgery (squashCommits / coalesceCommits)', () => {
  async function linear(name: string, count: number): Promise<string> {
    const repo = await mkRepo(name, { 'a.txt': 'v1\n' });
    for (let i = 2; i <= count; i++) {
      write(repo, 'a.txt', `v${i}\n`);
      await gitService.addAll(repo);
      await gitService.commit(repo, `commit ${i}`);
    }
    return repo;
  }

  it('squashes a commit range into one commit with the given message', async () => {
    const repo = await linear('squash-basic', 3);
    const c2 = await gitService.revParse(repo, 'HEAD~1');
    const c3 = await gitService.revParse(repo, 'HEAD');

    await gitService.squashCommits(repo, c2, c3, 'unified change');

    expect(await commitCount(repo)).toBe(2);
    expect(await headSubject(repo)).toBe('unified change');
  });

  it('REGRESSION: commits AFTER the squashed range survive the rebase', async () => {
    const repo = await linear('squash-tail', 4);
    const c2 = await gitService.revParse(repo, 'HEAD~2');
    const c3 = await gitService.revParse(repo, 'HEAD~1');

    await gitService.squashCommits(repo, c2, c3, 'joined');

    expect(await commitCount(repo)).toBe(3); // c1, squashed(c2+c3), c4
    const subjects = (await gitService.raw(repo, ['log', '--format=%s'])).trim().split('\n');
    expect(subjects[0]).toBe('commit 4');      // tail preserved
    expect(subjects[1]).toBe('joined');
    expect(subjects[2]).toBe('seed commit');
  });

  it('coalesceCommits combines two adjacent commit messages', async () => {
    const repo = await linear('coalesce', 3);
    const c1 = await gitService.revParse(repo, 'HEAD~2');
    const c2 = await gitService.revParse(repo, 'HEAD~1');

    await gitService.coalesceCommits(repo, c1, c2);

    expect(await commitCount(repo)).toBe(2);
    const subjects = (await gitService.raw(repo, ['log', '--format=%s'])).trim().split('\n');
    expect(subjects[0]).toBe('commit 3');                  // tail commit intact on top
    expect(subjects[1]).toContain('commit 2');             // coalesced message below
  });
});

// =====================================================================
// clonePartial (partial clone filter)
// =====================================================================
describe('clonePartial', () => {
  it('creates a partial clone with blob:none filter from a local bare', async () => {
    const src = await mkRepo('partial-src');
    const bare = bareRemote('partial-origin.git');
    await gitService.addRemote(src, 'origin', bare);
    await gitService.push(src, 'origin', 'main', true);

    const target = path.join(ROOT, 'partial-clone');
    await gitService.clonePartial(`file://${bare}`, target, 'blob:none');
    expect(await gitService.isRepo(target)).toBe(true);
    expect(await commitCount(target)).toBe(1);
    expect(await gitService.configGet(target, 'remote.origin.partialclonefilter', 'local')).toBe('blob:none');
  });
});

// =====================================================================
// Config import/export & ignore tooling
// =====================================================================
describe('config import/export & ignore tooling', () => {
  it('exportConfig collects git config, .gitignore and info/exclude', async () => {
    const repo = await mkRepo('export-cfg');
    write(repo, '.gitignore', '*.log\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'add gitignore');
    await gitService.raw(repo, ['config', '--local', 'prismgit.test', 'hello']);

    const cfg = await gitService.exportConfig(repo);
    expect(cfg.version).toBe('2.0.0');
    expect(cfg.exportedAt).toBeTruthy();
    expect(cfg.gitConfig).toEqual(expect.arrayContaining([
      { key: 'user.name', value: 'Test User' },
      { key: 'prismgit.test', value: 'hello' },
    ]));
    expect(cfg.gitignore).toBe('*.log\n');
    expect(cfg.infoExclude).toBeTruthy(); // git init pre-creates info/exclude from the template
  });

  it('importConfig writes files and sets local config; round-trips through export', async () => {
    const src = await mkRepo('import-src');
    const dst = await mkRepo('import-dst');
    const blob = await gitService.exportConfig(src);
    await gitService.importConfig(dst, {
      ...blob,
      gitConfig: [...(blob.gitConfig ?? []), { key: 'prismgit.roundtrip', value: 'yes' }],
      infoExclude: '*.tmp\n',
      gitreview: '[gerrit]\nhost=example\n',
    });
    expect(await gitService.configGet(dst, 'prismgit.roundtrip', 'local')).toBe('yes');
    expect(await gitService.configGet(dst, 'user.name', 'local')).toBe('Test User');
    expect(read(dst, '.git/info/exclude')).toBe('*.tmp\n');
    expect(read(dst, '.gitreview')).toContain('[gerrit]');
  });

  it('editIgnoreFile creates .gitignore on demand; editInfoExclude creates local exclude', async () => {
    const repo = await mkRepo('ignore-files');
    fs.rmSync(path.join(repo, '.gitignore'), { force: true });
    const ignorePath = await gitService.editIgnoreFile(repo, 'local');
    expect(ignorePath).toBe(path.join(repo, '.gitignore'));
    expect(fs.existsSync(ignorePath)).toBe(true);

    const exclPath = await gitService.editInfoExclude(repo);
    expect(exclPath).toBe(path.join(repo, '.git', 'info', 'exclude'));
    // git init ships a template exclude — the create-on-demand branch only
    // fires when the file is genuinely missing.
    fs.rmSync(exclPath, { force: true });
    const exclPath2 = await gitService.editInfoExclude(repo);
    expect(exclPath2).toBe(exclPath);
    expect(read(repo, '.git/info/exclude')).toContain('Local exclude patterns');
  });

  it('traceIgnoreRule identifies the exact .gitignore line; null when not ignored', async () => {
    const repo = await mkRepo('trace-ignore');
    await gitService.ignore(repo, ['*.log']);
    const hit = await gitService.traceIgnoreRule(repo, 'debug.log');
    expect(hit).toBeTruthy();
    expect(hit!.source.endsWith('.gitignore')).toBe(true);
    expect(hit!.lineNumber).toBe(1);
    expect(hit!.pattern).toBe('*.log');
    expect(await gitService.traceIgnoreRule(repo, 'clean.txt')).toBeNull();
  });

  it('isEolOnlyChange is true for CRLF-only edits, false for real changes', async () => {
    const repo = await mkRepo('eol');
    write(repo, 'a.txt', 'alpha\r\n');
    expect(await gitService.isEolOnlyChange(repo, 'a.txt')).toBe(true);
    write(repo, 'a.txt', 'beta\n');
    expect(await gitService.isEolOnlyChange(repo, 'a.txt')).toBe(false);
  });

  it('detectRepoFormat reports sha1/files by default and sha256 when initialised so', async () => {
    const repo = await mkRepo('fmt-sha1');
    expect(await gitService.detectRepoFormat(repo)).toEqual({ objectFormat: 'sha1', refStorage: 'files' });

    const sha256Repo = path.join(ROOT, 'fmt-sha256');
    fs.mkdirSync(sha256Repo, { recursive: true });
    shGit('init -q --object-format=sha256 .', sha256Repo);
    expect(await gitService.detectRepoFormat(sha256Repo)).toEqual({ objectFormat: 'sha256', refStorage: 'files' });
  });
});

// =====================================================================
// Force-push policy + credential helper
// =====================================================================
describe('policy & helpers (isForcePushAllowed / setupCredentialHelper)', () => {
  it('isForcePushAllowed honours deny/allow policies and protected branch wildcards', () => {
    expect(gitService.isForcePushAllowed('main', 'deny').allowed).toBe(false);
    expect(gitService.isForcePushAllowed('feature/x', 'allow').allowed).toBe(true);
    expect(gitService.isForcePushAllowed(undefined, 'feature-only').allowed).toBe(false);
    expect(gitService.isForcePushAllowed('main', 'feature-only').allowed).toBe(false);
    expect(gitService.isForcePushAllowed('develop', 'feature-only').allowed).toBe(false);
    expect(gitService.isForcePushAllowed('release/2.0', 'feature-only').allowed).toBe(false); // wildcard
    const feat = gitService.isForcePushAllowed('feature/x', 'feature-only');
    expect(feat.allowed).toBe(true);
    expect(feat.reason).toContain('feature/x');
  });

  it('setupCredentialHelper sets a local credential.helper', async () => {
    const repo = await mkRepo('cred-helper');
    await gitService.setupCredentialHelper(repo);
    expect(await gitService.configGet(repo, 'credential.helper', 'local')).toBe('store');
  });
});

// =====================================================================
// Batch operations across multiple repos
// =====================================================================
describe('batchOperation', () => {
  it('runs status across several repos, reporting per-repo success', async () => {
    const a = await mkRepo('batch-a');
    const b = await mkRepo('batch-b');
    const results = await gitService.batchOperation([a, b], 'status');
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.error).toBeUndefined();
    }
  });

  it('captures per-repo failures without aborting the batch', async () => {
    const good = await mkRepo('batch-good');
    const bare = bareRemote('batch-origin.git');
    await gitService.addRemote(good, 'origin', bare);
    const bad = await mkRepo('batch-bad'); // no remotes at all
    const results = await gitService.batchOperation([good, bad], 'fetch');
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBeTruthy();
  });
});

// =====================================================================
// Gerrit push (refs/for/<branch>)
// =====================================================================
describe('pushToGerrit', () => {
  it('pushes HEAD to refs/for/<branch> on a remote', async () => {
    const bare = bareRemote('gerrit-basic.git');
    const repo = await mkRepo('gerrit-basic');
    await gitService.addRemote(repo, 'origin', bare);
    await gitService.pushToGerrit(repo, 'main');
    const refs = await gitService.listRemote(repo, 'origin');
    expect(refs).toContain('refs/for/main');
  });

  it('encodes topic as Gerrit % option on the refspec', async () => {
    const bare = bareRemote('gerrit-topic.git');
    const repo = await mkRepo('gerrit-topic');
    await gitService.addRemote(repo, 'origin', bare);
    await gitService.pushToGerrit(repo, 'main', 'origin', { topic: 'feature-42' });
    const refs = await gitService.listRemote(repo, 'origin');
    expect(refs).toContain('refs/for/main%topic=feature-42');
  });
});

// =====================================================================
// Signed operations (no GPG secret keys in this environment)
// =====================================================================
describe('signed operations (commitSigned / createSignedTag)', () => {
  it('commitSigned without signing flags commits and returns the real hash', async () => {
    const repo = await mkRepo('signed-plain');
    write(repo, 'a.txt', 'changed\n');
    await gitService.addAll(repo);
    const hash = await gitService.commitSigned(repo, 'signed-path commit');
    expect(hash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(await gitService.commitExists(repo, hash)).toBe(true);
    expect(await headSubject(repo)).toBe('signed-path commit');
  });

  it('commitSigned with gpgSign fails cleanly without a secret key', async () => {
    const repo = await mkRepo('signed-gpg');
    write(repo, 'a.txt', 'changed\n');
    await gitService.addAll(repo);
    await expect(gitService.commitSigned(repo, 'will fail', { gpgSign: true })).rejects.toThrow();
  });

  it('createSignedTag fails cleanly without a secret key', async () => {
    const repo = await mkRepo('signed-tag');
    await expect(gitService.createSignedTag(repo, 'v-signed', 'msg')).rejects.toThrow();
  });
});

// =====================================================================
// editCommitMessage — non-HEAD reword (interactive rebase path)
// =====================================================================
describe('editCommitMessage (non-HEAD reword)', () => {
  it('REGRESSION: rewords a non-HEAD commit via the interactive-rebase path', async () => {
    const repo = await mkRepo('reword-nonhead', { 'a.txt': 'v1\n' });
    write(repo, 'a.txt', 'v2\n');
    await gitService.addAll(repo);
    await gitService.commit(repo, 'commit 2');
    const first = await gitService.revParse(repo, 'HEAD~1');

    await gitService.editCommitMessage(repo, first, 'rewritten first message');

    const subjects = (await gitService.raw(repo, ['log', '--format=%s'])).trim().split('\n');
    expect(subjects[1]).toBe('rewritten first message'); // older commit changed
    expect(subjects[0]).toBe('commit 2');                 // HEAD untouched
    expect((await gitService.status(repo)).isClean).toBe(true);
  });

  it('amends HEAD without rebase', async () => {
    const repo = await mkRepo('reword-head');
    await gitService.editCommitMessage(repo, 'HEAD', 'amended head');
    expect(await headSubject(repo)).toBe('amended head');
  });
});

// =====================================================================
// LFS family — git-lfs binary is NOT installed here; graceful degradation
// =====================================================================
describe('LFS without git-lfs binary (graceful degradation)', () => {
  it('lfsStatus / lfsList / lfsFsck / lfsListLocks degrade to safe defaults', async () => {
    const repo = await mkRepo('lfs-graceful');
    expect(await gitService.lfsStatus(repo)).toEqual({ installed: false, files: [] });
    expect(await gitService.lfsList(repo)).toEqual([]);
    const fsck = await gitService.lfsFsck(repo);
    expect(fsck.ok).toBe(false);
    expect(fsck.output).toContain('lfs');
    expect(await gitService.lfsListLocks(repo)).toEqual([]);
  });

  it('mutating LFS ops surface a clear error when the binary is missing', async () => {
    const repo = await mkRepo('lfs-missing');
    await expect(gitService.lfsInstall(repo)).rejects.toThrow();
    await expect(gitService.lfsTrack(repo, ['*.bin'])).rejects.toThrow();
    await expect(gitService.lfsPull(repo)).rejects.toThrow();
    await expect(gitService.lfsPush(repo)).rejects.toThrow();
    await expect(gitService.lfsFetch(repo)).rejects.toThrow();
    await expect(gitService.lfsLock(repo, 'big.bin')).rejects.toThrow();
    await expect(gitService.lfsUnlock(repo, 'big.bin')).rejects.toThrow();
    await expect(gitService.lfsLocks(repo)).rejects.toThrow(/Failed to list LFS locks/);
  });
});

// =====================================================================
// Push To... — refspec `local:target` (push a branch under a DIFFERENT
// remote-side name; backs the Branches "Push To..." dialog)
// =====================================================================
describe('push with targetBranch (Push To... refspec `local:target`)', () => {
  it('publishes a local branch under a different remote-side name and verifies the TARGET', async () => {
    const src = await mkRepo('pushto-src');
    const bare = bareRemote('pushto-origin.git');
    await gitService.addRemote(src, 'origin', bare);
    await gitService.raw(src, ['checkout', '-b', 'feature/auth']);

    write(src, 'f.txt', 'feature work\n');
    await gitService.addAll(src);
    await gitService.commit(src, 'feature work');

    // Push local `feature/auth` to remote `main` (with upstream tracking)
    const res = await gitService.push(src, 'origin', 'feature/auth', true, false, false, 'main');
    expect(res.updated).toBe(true);
    // Post-push verification must check the TARGET branch, not the source name
    expect(res.verification?.branch).toBe('main');
    expect(res.verification?.ok).toBe(true);

    // The remote really has refs/heads/main at the local feature/auth commit
    const localHash = (await gitService.raw(src, ['rev-parse', 'feature/auth'])).trim();
    const ls = await gitService.raw(src, ['ls-remote', 'origin', 'refs/heads/main']);
    expect(ls.split(/\s+/)[0]).toBe(localHash);
  });

  it('keeps the plain single-ref refspec when the target equals the source', async () => {
    const src = await mkRepo('pushto-same');
    const bare = bareRemote('pushto-same-origin.git');
    await gitService.addRemote(src, 'origin', bare);
    await gitService.raw(src, ['checkout', '-b', 'feature']);

    const res = await gitService.push(src, 'origin', 'feature', true, false, false, 'feature');
    expect(res.updated).toBe(true);
    expect(res.verification?.branch).toBe('feature');
    expect(res.verification?.ok).toBe(true);
    expect(res.branch).toBe('feature');
  });
});


