/**
 * gitStatsCore — the sidebar metadata reads (log -1 / branches / remotes /
 * commit count) extracted to run in the background git worker.
 *
 * Pinned here: field computation on a real repo, unborn-HEAD degradation,
 * provider classification from the remote URL, and PARITY with
 * storage.refreshRepoStats (which routes through runStatsJobExternal →
 * in-process on this host) so foreground/background can never drift.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit } from 'simple-git';
import { runStatsJob } from '../../electron/services/gitStatsCore';
import { refreshRepoStats } from '../../electron/services/storage';

let root: string;
let repo: string;

function write(file: string, content: string) {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stats-'));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig('user.email', 'stats@example.com');
  await git.addConfig('user.name', 'Stats Tester');
  write('a.txt', 'one\n');
  await git.add('.');
  await git.commit('first commit');
  write('b.txt', 'two\n');
  await git.add('.');
  await git.commit('second commit');
  await git.branch(['feature']);
  await git.addRemote('origin', 'git@gitlab.example.com:team/repo.git');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('runStatsJob — real git', () => {
  it('computes last-commit / branch count / commit count from a real repo', async () => {
    const result = await runStatsJob({ repoPath: repo });
    expect(result.lastCommitMessage).toBe('second commit');
    expect(result.lastCommitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(result.lastCommitDate).toBeTruthy();
    // main + feature
    expect(result.branchCount).toBe(2);
    expect(result.commitCount).toBe(2);
  });

  it('classifies the provider and web URL from the remote (gitlab ssh form)', async () => {
    const result = await runStatsJob({ repoPath: repo });
    expect(result.provider).toBe('gitlab');
    expect(result.owner).toBe('team');
    expect(result.repo).toBe('repo');
    expect(result.webUrl).toBe('https://gitlab.example.com/team/repo');
  });

  it('returns zeros/nulls (never throws) for a directory that is not a repo', async () => {
    const notARepo = path.join(root, 'plain');
    fs.mkdirSync(notARepo, { recursive: true });
    const result = await runStatsJob({ repoPath: notARepo });
    expect(result.branchCount).toBe(0);
    expect(result.commitCount).toBe(0);
    expect(result.provider).toBe('unknown');
    expect(result.lastCommitHash).toBeUndefined();
  });

  it('unborn HEAD: no last-commit, zero commits, but remotes still readable', async () => {
    const fresh = path.join(root, 'unborn');
    fs.mkdirSync(fresh, { recursive: true });
    const git = simpleGit(fresh);
    await git.init();
    await git.addRemote('origin', 'https://github.com/org/proj.git');
    const result = await runStatsJob({ repoPath: fresh });
    expect(result.lastCommitHash).toBeUndefined();
    expect(result.commitCount).toBe(0);
    expect(result.branchCount).toBe(0);
    expect(result.provider).toBe('github');
  });

  it('PARITY: storage.refreshRepoStats returns the same git-computed values', async () => {
    // In non-Electron hosts runStatsJobExternal runs runStatsJob in-process —
    // exactly the fallback ladder production uses when the worker is sick.
    // refreshRepoStats must therefore agree with the core byte-for-byte.
    const viaStorage = await refreshRepoStats(repo);
    const viaCore = await runStatsJob({ repoPath: repo });
    expect(viaStorage.lastCommitHash).toBe(viaCore.lastCommitHash);
    expect(viaStorage.lastCommitMessage).toBe(viaCore.lastCommitMessage);
    expect(viaStorage.lastCommitDate).toBe(viaCore.lastCommitDate);
    expect(viaStorage.branchCount).toBe(viaCore.branchCount);
    expect(viaStorage.commitCount).toBe(viaCore.commitCount);
    expect(viaStorage.provider).toBe(viaCore.provider);
    expect(viaStorage.remoteUrl).toBe(viaCore.remoteUrl);
    expect(viaStorage.owner).toBe(viaCore.owner);
    expect(viaStorage.webUrl).toBe(viaCore.webUrl);
    expect(typeof viaStorage.updatedAt).toBe('number');
  });

  it('refreshRepoStats on a missing repo degrades to an empty object (never throws)', async () => {
    const result = await refreshRepoStats(path.join(root, 'does-not-exist'));
    expect(result).toEqual({});
  });
});
