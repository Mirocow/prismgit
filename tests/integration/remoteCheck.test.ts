/**
 * Integration: periodic remote check (pollRemoteSummary / pollRemoteSummaries)
 *
 * Uses REAL local git repositories (file:// remotes — no network needed):
 *   - a bare "origin" plus two working clones pushing against it, so we can
 *     produce genuine incoming/outgoing situations;
 *   - a repo without remotes;
 *   - a non-repo directory (must not throw).
 *
 * Contract since Task 27: the network fetch runs ONLY for remotes whose
 * "Perform background Poll or Fetch" checkbox is enabled (shared app
 * settings, key backgroundFetchRemotes). Without the checkbox the check is
 * network-free: fetched=false and counters reflect the last fetch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let gitService: typeof import('../../electron/services/git');
let storage: typeof import('../../electron/services/storage');

let root = '';

function shell(cmd: string, cwd?: string) {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 'tester@example.com',
      GIT_COMMITTER_NAME: 'Tester', GIT_COMMITTER_EMAIL: 'tester@example.com',
    },
  }).trim();
}

function commitAll(cwd: string, message: string, file: string, content: string) {
  fs.writeFileSync(path.join(cwd, file), content);
  shell(`git add ${file}`, cwd);
  shell(`git commit -q -m "${message}"`, cwd);
}

describe('git service — remote check (fetch + incoming/outgoing)', () => {
  let origin = '';
  let work1 = '';
  let work2 = '';
  let noRemote = '';
  let notARepo = '';

  beforeAll(async () => {
    // Isolate the app-settings store so the checkbox writes never touch the
    // developer's real settings file. Must happen BEFORE the first import of
    // electron/services/* (which instantiates the store at module load).
    process.env.PRISMGIT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-remote-check-store-'));
    gitService = await import('../../electron/services/git');
    storage = await import('../../electron/services/storage');

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-remote-check-'));
    origin = path.join(root, 'origin.git');
    work1 = path.join(root, 'work1');
    work2 = path.join(root, 'work2');
    noRemote = path.join(root, 'no-remote');
    notARepo = path.join(root, 'not-a-repo');
    fs.mkdirSync(notARepo, { recursive: true });

    // Bare remote with initial commit from work1
    shell(`git init --bare -b main "${origin}"`);
    shell(`git clone -q "${origin}" "${work1}"`);
    shell('git config user.name Tester', work1);
    shell('git config user.email tester@example.com', work1);
    commitAll(work1, 'init', 'README.md', '# init\n');
    shell('git push -q -u origin main', work1);

    // Second clone that pushes a commit work1 has not seen yet
    shell(`git clone -q "${origin}" "${work2}"`);
    shell('git config user.name Tester', work2);
    shell('git config user.email tester@example.com', work2);
    commitAll(work2, 'from work2', 'w2.txt', 'work2\n');
    shell('git push -q origin main', work2);

    // Local-only repo without remotes
    shell(`git init -q -b main "${noRemote}"`);
    shell('git config user.name Tester', noRemote);
    shell('git config user.email tester@example.com', noRemote);
    commitAll(noRemote, 'solo', 'solo.txt', 'solo\n');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports hasRemote=false for a repo without remotes (never throws)', async () => {
    const summary = await gitService.pollRemoteSummary(noRemote);
    expect(summary.hasRemote).toBe(false);
    expect(summary.remotes).toEqual([]);
    expect(summary.fetched).toBe(false);
    expect(summary.branch).toBe('main');
    expect(summary.outgoing).toBeGreaterThanOrEqual(0);
    expect(summary.checkedAt).toBeGreaterThan(0);
  });

  it('treats a non-repo directory as an empty summary (never throws)', async () => {
    const summary = await gitService.pollRemoteSummary(notARepo);
    expect(summary.hasRemote).toBe(false);
    expect(summary.incoming).toBe(0);
    expect(summary.outgoing).toBe(0);
    expect(summary.branch).toBeNull();
  });

  it('skips the network fetch when no remote opted in (no checkbox)', async () => {
    // No backgroundFetchRemotes entry → no fetch — the summary must report
    // fetched=false and work2's pushed commit is NOT seen yet.
    const summary = await gitService.pollRemoteSummary(work1);
    expect(summary.hasRemote).toBe(true);
    expect(summary.remotes).toEqual(['origin']);
    expect(summary.fetched).toBe(false);
    expect(summary.incoming).toBe(0); // the commit is on the server, unseen
  });

  it('fetches ONLY opted-in remotes and detects incoming commits', async () => {
    // The checkbox (Repository Settings → Remotes / Remotes tool) opts in.
    storage.setSetting('backgroundFetchRemotes', { [work1]: ['origin'] });
    const before = await gitService.pollRemoteSummary(work1);
    expect(before.hasRemote).toBe(true);
    expect(before.remotes).toEqual(['origin']);
    expect(before.fetched).toBe(true); // checkbox on → fetch ran
    // work2 pushed 'from work2'; work1 fetched inside pollRemoteSummary
    expect(before.incoming).toBe(1);
    expect(before.outgoing).toBe(0);
    expect(before.branch).toBe('main');
    expect(before.error).toBeUndefined();
  });

  it('detects outgoing commits (local commit not pushed)', async () => {
    commitAll(work1, 'local only', 'local.txt', 'local\n');
    const summary = await gitService.pollRemoteSummary(work1);
    expect(summary.outgoing).toBe(1);
    expect(summary.incoming).toBe(1); // still behind work2's commit
  });

  it('counts dirty working-tree files', async () => {
    fs.writeFileSync(path.join(work1, 'uncommitted.txt'), 'dirty\n');
    fs.writeFileSync(path.join(work1, 'uncommitted2.txt'), 'dirty too\n');
    const summary = await gitService.pollRemoteSummary(work1);
    expect(summary.dirty).toBeGreaterThanOrEqual(2);
  });

  it('batch pollRemoteSummaries returns an entry for every path', async () => {
    const summaries = await gitService.pollRemoteSummaries([work1, noRemote, notARepo]);
    expect(Object.keys(summaries).sort()).toEqual([noRemote, notARepo, work1].sort());
    expect(summaries[work1].hasRemote).toBe(true);
    expect(summaries[noRemote].hasRemote).toBe(false);
    expect(summaries[notARepo].hasRemote).toBe(false);
  });

  it('batch poll deduplicates paths', async () => {
    const summaries = await gitService.pollRemoteSummaries([work1, work1, work1]);
    expect(Object.keys(summaries)).toHaveLength(1);
  });

  it('batch poll with an empty array resolves to an empty map', async () => {
    expect(await gitService.pollRemoteSummaries([])).toEqual({});
  });
});
