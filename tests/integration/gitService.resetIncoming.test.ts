/**
 * Integration — "after `git reset --hard`, remote commits must display as
 * incoming, not as merged into the local branch" (user-reported).
 *
 * Reproduces the full data pipeline the History page runs:
 *   gitService.status()          → head hash / behind count
 *   gitService.log(branches)     → ref decorations for the graph
 *   gitService.raw(rev-list …)   → the incoming set (via
 *                                  lib/incomingCommits scope selection)
 *
 * Two regressions are pinned:
 *   1. status() must expose the HEAD hash (moved by reset without a branch
 *      rename) so the renderer can detect graph staleness.
 *   2. The per-view incoming range `main..origin/main` must survive the
 *      "contaminated backup branch" case where the repo-wide
 *      `--remotes --not --branches` set silently goes EMPTY — the state that
 *      made remote commits render as plain local history.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';
import { incomingRevListArgs, parseRevList } from '../../src/lib/incomingCommits';

const ROOT = path.join(os.tmpdir(), 'prismgit-repos', 'reset-incoming');

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

describe('hard reset → incoming commits display', () => {
  beforeAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    // Isolate from the machine's global git identity.
    process.env.GIT_CONFIG_GLOBAL = path.join(ROOT, 'empty-gitconfig');
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');

    // Bare origin + clone.
    shell('git init -q --bare origin.git', ROOT);
    shell(`git clone -q ${path.join(ROOT, 'origin.git')} work`, ROOT);
    const work = path.join(ROOT, 'work');
    shell('git config user.name "Ivan Testov"', work);
    shell('git config user.email "ivan@test.dev"', work);

    // 6 commits, pushed → main in sync with origin/main.
    for (let i = 1; i <= 6; i++) {
      fs.writeFileSync(path.join(work, 'file.txt'), `line ${i}\n`);
      shell('git add file.txt', work);
      shell(`git commit -q -m "base ${i}"`, work);
    }
    const branch = shell('git symbolic-ref --short HEAD', work);
    shell(`git push -q -u origin ${branch}`, work);
    if (branch !== 'main') shell('git branch -q -m main', work);
  });

  afterAll(() => {
    delete process.env.GIT_CONFIG_GLOBAL;
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it('status() exposes the HEAD hash (reset moves HEAD without renaming the branch)', async () => {
    const work = path.join(ROOT, 'work');
    const before = await gitService.status(work);
    expect(before.current).toBe('main');
    expect(before.tracking).toBe('origin/main');
    expect(before.behind).toBe(0);
    expect(before.head).toBe(shell('git rev-parse HEAD', work));

    shell('git reset -q --hard HEAD~3', work);

    const after = await gitService.status(work);
    expect(after.current).toBe('main');            // branch name unchanged —
    expect(after.tracking).toBe('origin/main');    // …so NAME deps can't see the reset…
    expect(after.head).not.toBe(before.head);      // …but the HEAD hash did.
    expect(after.head).toBe(shell('git rev-parse HEAD', work));
    expect(after.behind).toBe(3);
  });

  it('after reset, log(branches) puts origin/main at the tip and main 3 rows down', async () => {
    const work = path.join(ROOT, 'work');
    const entries = await gitService.log(work, { maxCount: 10, branches: ['main', 'origin/main'] });
    expect(entries.length).toBeGreaterThanOrEqual(6);

    // Newest row = remote tip.
    expect(entries[0].refs.some((r) => r.includes('refs/remotes/origin/main'))).toBe(true);
    // 3 incoming rows (index 0..2) are remote-only; main sits at index 3.
    const mainIdx = entries.findIndex((e) => e.refs.some((r) => r.includes('refs/heads/main')));
    expect(mainIdx).toBe(3);
    // The remote-only rows carry NO local-branch decoration.
    for (let i = 0; i < 3; i++) {
      expect(entries[i].refs.some((r) => r.includes('refs/heads/'))).toBe(false);
    }
  });

  it('incoming set = the 3 remote-only commits (per-view range)', async () => {
    const work = path.join(ROOT, 'work');
    const status = await gitService.status(work);
    const args = incomingRevListArgs({
      mode: 'head+upstream',
      currentBranch: status.current,
      upstream: status.tracking,
    });
    const incoming = parseRevList(await gitService.raw(work, args));
    expect(incoming.size).toBe(3);

    // The same hashes the graph shows as remote-only (see previous test).
    const entries = await gitService.log(work, { maxCount: 10, branches: ['main', 'origin/main'] });
    for (let i = 0; i < 3; i++) {
      expect(incoming.has(entries[i].hash)).toBe(true);
    }
  });

  it('REGRESSION: a backup branch must NOT blank the incoming markers', async () => {
    const work = path.join(ROOT, 'work');
    // Common real-world state after a reset: a backup (or any feature
    // branch) still points at the old tip, i.e. CONTAINS the remote commits.
    shell('git branch backup origin/main', work);

    // The OLD (repo-wide) computation — contaminated, returns nothing:
    const globalSet = parseRevList(
      await gitService.raw(work, ['rev-list', '--remotes', '--not', '--branches']),
    );
    expect(globalSet.size).toBe(0);

    // The FIXED (per-view) computation — still returns the 3 incoming commits:
    const status = await gitService.status(work);
    const args = incomingRevListArgs({
      mode: 'head+upstream',
      currentBranch: status.current,
      upstream: status.tracking,
    });
    const incoming = parseRevList(await gitService.raw(work, args));
    expect(incoming.size).toBe(3);

    shell('git branch -q -D backup', work);
  });

  it('after pulling the incoming commits back, the incoming set is empty', async () => {
    const work = path.join(ROOT, 'work');
    shell('git pull -q --no-rebase origin main', work);

    const status = await gitService.status(work);
    expect(status.behind).toBe(0);
    const args = incomingRevListArgs({
      mode: 'head+upstream',
      currentBranch: status.current,
      upstream: status.tracking,
    });
    const incoming = parseRevList(await gitService.raw(work, args));
    expect(incoming.size).toBe(0);
  });
});
