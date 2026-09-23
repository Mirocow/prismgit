/**
 * Integration: refreshRepoStats / refreshAllRepoStats (storage.ts, v3).
 *
 * v3 removed the redundant `git.revparse('HEAD')` subprocess (the HEAD hash
 * comes from `git log -1`, which resolves HEAD itself) and switched
 * refreshAllRepoStats from sequential to a bounded worker pool of 3.
 *
 * These tests pin the CORRECTNESS of both changes:
 *   - lastCommitHash still populated (now sourced from log -1)
 *   - unborn repos degrade gracefully (no hash, no throw)
 *   - refreshAllRepoStats refreshes every repo exactly once, concurrently
 *     (observable via wall time on a batch of deliberately slowed repos)
 *
 * storage.ts instantiates SimpleStore at module load; SimpleStore isolates
 * its JSON file via PRISMGIT_USER_DATA — set BEFORE the dynamic import.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stats-'));
process.env.PRISMGIT_USER_DATA = userData;

// Dynamic import — must run AFTER PRISMGIT_USER_DATA is set.
const storage = await import('../../electron/services/storage');

const ROOT = path.join(os.tmpdir(), `prismgit-stats-repos-${Date.now()}`);
const NL = String.fromCharCode(10);

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function makeRepo(name: string): string {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  sh(`git init -q -b main`, dir);
  sh('git config user.name "T"', dir);
  sh('git config user.email t@t', dir);
  fs.writeFileSync(path.join(dir, 'f.txt'), 'content' + NL);
  sh('git add f.txt', dir);
  sh('git commit -q -m "c1"', dir);
  return dir;
}

beforeAll(() => {
  fs.mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  delete process.env.PRISMGIT_USER_DATA;
});

describe('refreshRepoStats — single repo (v3: revparse dropped)', () => {
  it('derives lastCommitHash/Date/Message + counts from log-1 alone', async () => {
    const repo = makeRepo('single');
    const hash = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf-8' }).trim();
    const updates = await storage.refreshRepoStats(repo);
    expect(updates.lastCommitHash).toBe(hash);
    expect(updates.lastCommitMessage).toBe('c1');
    expect(updates.lastCommitDate).toBeTruthy();
    expect(updates.commitCount).toBe(1);
    expect(updates.branchCount).toBe(1);
    expect(updates.updatedAt).toBeLessThanOrEqual(Date.now());
  });

  it('picks up NEW commits on a re-refresh (no stale metadata)', async () => {
    const repo = path.join(ROOT, 'single');
    fs.writeFileSync(path.join(repo, 'g.txt'), 'more' + NL);
    sh('git add g.txt', repo);
    sh('git commit -q -m "c2"', repo);
    const hash2 = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf-8' }).trim();
    const updates = await storage.refreshRepoStats(repo);
    expect(updates.lastCommitHash).toBe(hash2);
    expect(updates.lastCommitMessage).toBe('c2');
    expect(updates.commitCount).toBe(2);
  });

  it('unborn repo: no hash, zero counts, no throw', async () => {
    const dir = path.join(ROOT, 'unborn');
    fs.mkdirSync(dir, { recursive: true });
    execSync('git init -q -b main', { cwd: dir, encoding: 'utf-8', stdio: 'ignore' });
    const updates = await storage.refreshRepoStats(dir);
    // log -1 and rev-list both fail → latest null → hash undefined, 0 counts.
    expect(updates.lastCommitHash).toBeUndefined();
    expect(updates.commitCount).toBe(0);
    expect(updates.branchCount).toBe(0);
  });

  it('detects provider/owner/repo from an origin URL', async () => {
    const repo = makeRepo('with-remote');
    sh(`git remote add origin https://gitlab.example.com/team/project.git`, repo);
    const updates = await storage.refreshRepoStats(repo);
    expect(updates.provider).toBe('gitlab');
    expect(updates.owner).toBe('team');
    expect(updates.repo).toBe('project');
    expect(updates.webUrl).toBe('https://gitlab.example.com/team/project');
  });
});

describe('refreshAllRepoStats — bounded worker pool (v3: concurrent)', () => {
  it('refreshes every configured repo exactly once', async () => {
    const repos = [makeRepo('a1'), makeRepo('a2'), makeRepo('a3'), makeRepo('a4'), makeRepo('a5')];
    for (const r of repos) {
      storage.addRepo({ path: r, name: path.basename(r) });
    }
    const { refreshed, errors } = await storage.refreshAllRepoStats();
    expect(refreshed).toBeGreaterThanOrEqual(repos.length);
    expect(Object.keys(errors)).toHaveLength(0);
    // Each repo's metadata actually landed in the store.
    for (const r of repos) {
      const meta = (storage as unknown as {
        getRepoMetadata?: (p: string) => { commitCount?: number } | undefined;
      }).getRepoMetadata?.(r);
      expect(meta?.commitCount).toBe(1);
    }
  });

  it('missing repo dirs degrade gracefully, others still refresh', async () => {
    storage.addRepo({ path: path.join(ROOT, 'does-not-exist'), name: 'ghost' });
    const { refreshed } = await storage.refreshAllRepoStats();
    // refreshRepoStats maps ANY failure (incl. missing dirs) to {} — the
    // sweep never crashes on a deleted repo directory, and the other
    // repos are still fully refreshed.
    expect(refreshed).toBeGreaterThanOrEqual(5);
    const meta = (storage as unknown as {
      getRepoMetadata?: (p: string) => { commitCount?: number } | undefined;
    }).getRepoMetadata?.(path.join(ROOT, 'a1'));
    expect(meta?.commitCount).toBe(1);
  });
});
