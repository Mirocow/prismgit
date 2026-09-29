/**
 * v2.3.5 integration — SERVER-SIDE History filters via the real git service.
 *
 * The user's report: typing an author into the History filter and pressing
 * Refresh showed no change — the filter ran client-side over the first
 * 100-commit page only; the author's commits appeared after manually
 * scrolling the whole history in. This suite drives `log()` directly with
 * author/date filters + the author+file combination (arg ORDER matters:
 * options must precede the `-- <path>` pathspec separator).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';

let ROOT = '';
let REPO = '';

const sh = (cmd: string, cwd = REPO) => execSync(cmd, { cwd, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v235-filters-'));
  REPO = path.join(ROOT, 'repo');
  fs.mkdirSync(REPO, { recursive: true });
  sh('git init -q -b main');

  // 12 commits: 6 by thomisus, 6 by otherdev — interleaved so page-1 of an
  // UNFILTERED log contains BOTH authors (the old client-side filter's blind
  // spot: filtering the loaded page missed commits beyond it).
  for (let i = 1; i <= 6; i++) {
    fs.writeFileSync(path.join(REPO, 'shared.txt'), `thomisus line ${i}\n`);
    sh(`git config user.name thomisus && git config user.email thom@example.com`);
    sh(`git add -A && git commit -q -m "t${i}: thomisus change"`);
    fs.writeFileSync(path.join(REPO, 'shared.txt'), `thomisus line ${i}\notherdev line ${i}\n`);
    sh(`git config user.name otherdev && git config user.email other@example.com`);
    sh(`git add -A && git commit -q -m "o${i}: otherdev change"`);
  }
  // A dedicated file only thomisus touched — for the author+file combo test.
  fs.writeFileSync(path.join(REPO, 'thomonly.txt'), 'thom only\n');
  sh(`git config user.name thomisus && git config user.email thom@example.com`);
  sh(`git add -A && git commit -q -m "t7: thomisus file"`);
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('git log — author filter (server-side, v2.3.5)', () => {
  it('returns ONLY the author\'s commits without loading everything first', async () => {
    const result = await gitService.log(REPO, { maxCount: 100, author: 'thomisus' });
    expect(result.length).toBe(7); // 6 interleaved + 1 thomonly.txt
    for (const e of result) {
      expect(e.author.name).toBe('thomisus');
    }
  });

  it('matches case-insensitively (the UI promise)', async () => {
    const result = await gitService.log(REPO, { maxCount: 100, author: 'THOMISUS' });
    expect(result.length).toBe(7);
  });

  it('matches by EMAIL fragment too (git --author semantics over "Name <email>")', async () => {
    const result = await gitService.log(REPO, { maxCount: 100, author: 'other@example' });
    expect(result.length).toBe(6);
    expect(result.every((e) => e.author.name === 'otherdev')).toBe(true);
  });

  it('pages the FILTERED set (skip walks only matching commits)', async () => {
    const page1 = await gitService.log(REPO, { maxCount: 5, skip: 0, author: 'thomisus' });
    const page2 = await gitService.log(REPO, { maxCount: 5, skip: 5, author: 'thomisus' });
    expect(page1.length).toBe(5);
    expect(page2.length).toBe(2); // 7 total — 5 on page 1
    // No overlap between pages
    const hashes = new Set([...page1, ...page2].map((e) => e.hash));
    expect(hashes.size).toBe(7);
  });

  it('author + file TOGETHER (options must precede the pathspec separator)', async () => {
    // Regression guard: --author pushed AFTER `-- file` would be treated as
    // a PATH and git would silently return empty.
    const result = await gitService.log(REPO, { maxCount: 100, author: 'thomisus', file: 'thomonly.txt' });
    expect(result.length).toBe(1);
    expect(result[0].subject).toContain('thomisus file');
  });

  it('date window (since/until) narrows server-side', async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
    const past = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const all = await gitService.log(REPO, { maxCount: 100, since: past, until: future });
    expect(all.length).toBe(13); // everything is from today
    const none = await gitService.log(REPO, { maxCount: 100, since: future });
    expect(none.length).toBe(0);
  });

  it('no filter → unchanged behaviour (regression guard)', async () => {
    const result = await gitService.log(REPO, { maxCount: 100 });
    expect(result.length).toBe(13);
  });
});
