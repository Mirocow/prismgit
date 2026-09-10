/**
 * Integration test — renameStash (real git).
 *
 * renameStash has no native git command: the service rebuilds refs/stash by
 * creating a replacement commit (same tree + parents, new message) and
 * re-storing every entry in chronological order. This test verifies on a REAL
 * repository that after renaming:
 *   - the number of stashes is unchanged
 *   - the target message is replaced
 *   - other messages are preserved verbatim
 *   - the order (stash@{0} = newest) is preserved
 *   - the renamed stash's CONTENT still applies correctly
 *   - untracked-file stashes (-u, 3-parent commits) survive too
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { renameStash, stashList, stashApply, remoteProperties } from '../../electron/services/git.js';

let repoDir: string;
let originDir: string; // local "remote" repo for remoteProperties test

function sh(cmd: string) {
  return execSync(cmd, { cwd: repoDir, encoding: 'utf-8' });
}

beforeAll(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-rename-stash-'));
  sh('git init -b main -q');
  sh('git config user.email t@t.t');
  sh('git config user.name T');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'base\n');
  sh('git add . && git commit -m base -q');

  // Local "origin" repo + fetch from it → gives remoteProperties real data
  originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-origin-'));
  execSync('git init -b main -q', { cwd: originDir });
  execSync('git config user.email o@o.o && git config user.name O', { cwd: originDir });
  fs.writeFileSync(path.join(originDir, 'r.txt'), 'remote\n');
  execSync('git add . && git commit -m remote-base -q', { cwd: originDir });
  sh(`git remote add origin ${originDir}`);
  sh('git fetch origin -q');
  // Cache the remote HEAD locally (what git clone does) — lets remoteProperties
  // resolve the HEAD branch without network access.
  sh('git remote set-head origin -a');
});

afterAll(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.rmSync(originDir, { recursive: true, force: true });
});

describe('renameStash — real git integration', () => {
  it('renames a stash in the middle of the stack, preserving order + content', async () => {
    // stash ONE (oldest) → stash@{2}
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n');
    sh('git stash push -m "stash ONE" -q');
    // stash TWO → stash@{1} (target)
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'two\n');
    sh('git stash push -m "stash TWO" -q');
    // stash THREE (newest) → stash@{0}
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'three\n');
    sh('git stash push -m "stash THREE" -q');

    await renameStash(repoDir, 1, 'RENAMED stash TWO');

    const stashes = await stashList(repoDir);
    expect(stashes).toHaveLength(3);
    // git's reflog subject keeps the "On <branch>: " prefix created by stash push
    expect(stashes[0].message).toBe('On main: stash THREE');
    expect(stashes[1].message).toBe('RENAMED stash TWO');
    expect(stashes[2].message).toBe('On main: stash ONE');

    // Content of the renamed stash must still be intact (a.txt = "two")
    await stashApply(repoDir, 1);
    expect(fs.readFileSync(path.join(repoDir, 'a.txt'), 'utf-8')).toBe('two\n');
    // Clean the applied change for the next assertion
    sh('git checkout -- a.txt');
  });

  it('renames an untracked-files stash (3-parent commit) and keeps the untracked file', async () => {
    fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'u1\n');
    sh('git stash push -m "with untracked" --include-untracked -q');

    await renameStash(repoDir, 0, 'renamed with untracked');

    const stashes = await stashList(repoDir);
    expect(stashes).toHaveLength(4); // 3 from the previous test + this one
    expect(stashes[0].message).toBe('renamed with untracked');

    // Untracked file must still be inside the stash
    await stashApply(repoDir, 0);
    expect(fs.existsSync(path.join(repoDir, 'untracked.txt'))).toBe(true);
    sh('git clean -fdq');
  });

  it('rejects empty messages and out-of-range indexes', async () => {
    await expect(renameStash(repoDir, 0, '   ')).rejects.toThrow(/empty/i);
    await expect(renameStash(repoDir, 99, 'nope')).rejects.toThrow(/does not exist/);
  });

  it('remoteProperties returns real URLs, HEAD branch and tracking branches', async () => {
    const props = await remoteProperties(repoDir, 'origin');
    expect(props.name).toBe('origin');
    expect(props.fetchUrl).toBe(originDir);
    expect(props.headBranch).toBe('main');
    expect(props.trackingBranchCount).toBe(1);
    expect(props.trackingBranches).toContain('origin/main');
    expect(props.shallow).toBe(false);
    expect(props.mirror).toBe(false);
    expect(props.config.some((c) => c.key === 'remote.origin.url')).toBe(true);
  });

  it('remoteProperties throws for an unknown remote', async () => {
    await expect(remoteProperties(repoDir, 'nonexistent-remote')).rejects.toThrow();
  });
});
