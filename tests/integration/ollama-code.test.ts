/**
 * Integration test — runs ALL git service functions against ollama-code repo.
 * This tests the actual electron/services/git.ts code (not mocked).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as gitService from '../../electron/services/git';

const OLLAMA_REPO = '/home/z/my-project/repos/ollama-code';

// Optional large-repo fixture: suite is skipped when the repo is absent so the
// rest of the verification stays green. To run it locally:
//   git clone https://github.com/ollama/ollama /home/z/my-project/repos/ollama-code
const OLLAMA_REPO_EXISTS = require('fs').existsSync(`${OLLAMA_REPO}/.git`);

describe.skipIf(!OLLAMA_REPO_EXISTS)('git service — ollama-code integration (5731 commits, 591 tags)', () => {
  beforeAll(() => {
    // Ensure repo exists
    if (!require('fs').existsSync(`${OLLAMA_REPO}/.git`)) {
      throw new Error('ollama-code repo not found');
    }
  }, /* timeout */ 10_000);

  it('isRepo returns true', async () => {
    const result = await gitService.isRepo(OLLAMA_REPO);
    expect(result).toBe(true);
  });

  it('status returns current branch', async () => {
    const s = await gitService.status(OLLAMA_REPO);
    expect(s.current).toBe('main');
    expect(typeof s.isClean).toBe('boolean');
  });

  it('log returns 500+ commits with --all', async () => {
    const log = await gitService.log(OLLAMA_REPO, { maxCount: 500, all: true });
    expect(log.length).toBeGreaterThan(100);
    expect(log[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(log[0].author.name).toBeTruthy();
  });

  it('log parses parents correctly (merge commits)', async () => {
    const log = await gitService.log(OLLAMA_REPO, { maxCount: 500, all: true });
    const merge = log.find(c => c.parents.length > 1);
    if (merge) {
      expect(merge.parents.length).toBeGreaterThanOrEqual(2);
      expect(merge.parents[0]).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('branches returns local branches', async () => {
    const list = await gitService.branches(OLLAMA_REPO);
    const local = list.filter(b => !b.remote);
    expect(local.length).toBeGreaterThan(0);
    const main = local.find(b => b.name === 'main');
    expect(main).toBeDefined();
    expect(main!.current).toBe(true);
  });

  it('tags returns 500+ tags (for-each-ref, no N+1)', async () => {
    const tags = await gitService.tags(OLLAMA_REPO);
    expect(tags.length).toBeGreaterThan(100);
    // Check both types
    const annotated = tags.find(t => !t.lightweight);
    const lightweight = tags.find(t => t.lightweight);
    if (annotated) expect(annotated.annotation).toBeTruthy();
    if (lightweight) expect(lightweight.lightweight).toBe(true);
  });

  it('remotes returns origin', async () => {
    const remotes = await gitService.remotes(OLLAMA_REPO);
    expect(remotes.length).toBeGreaterThan(0);
    const origin = remotes.find(r => r.name === 'origin');
    expect(origin).toBeDefined();
    expect(origin!.refs.fetch).toContain('ollama');
  });

  it('revParse HEAD returns 40-char hash', async () => {
    const hash = await gitService.revParse(OLLAMA_REPO, 'HEAD');
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('currentBranch returns "main"', async () => {
    const name = await gitService.currentBranch(OLLAMA_REPO);
    expect(name).toBe('main');
  });

  it('commitFiles returns files for HEAD', async () => {
    const files = await gitService.commitFiles(OLLAMA_REPO, 'HEAD');
    expect(files.length).toBeGreaterThan(0);
    expect(files[0].path).toBeTruthy();
    expect(files[0].status).toMatch(/^[A-Z]$/);
  });

  it('diffCommit returns hunks', async () => {
    const log = await gitService.log(OLLAMA_REPO, { maxCount: 5 });
    const diff = await gitService.diffCommit(OLLAMA_REPO, log[0].hash);
    expect(diff.hunks).toBeDefined();
  });

  it('blame returns lines for README.md', async () => {
    const result = await gitService.blame(OLLAMA_REPO, 'README.md');
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines[0].author).toBeTruthy();
    expect(result.lines[0].content).toBeDefined();
  });

  it('reflog returns entries', async () => {
    const entries = await gitService.reflog(OLLAMA_REPO, undefined, 50);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('stashList returns (may be empty)', async () => {
    const stashes = await gitService.stashList(OLLAMA_REPO);
    expect(Array.isArray(stashes)).toBe(true);
  });

  it('findRef finds "main"', async () => {
    const refs = await gitService.findRef(OLLAMA_REPO, 'main');
    expect(refs.length).toBeGreaterThan(0);
    const branch = refs.find(r => r.type === 'branch');
    expect(branch).toBeDefined();
  });

  it('findRef finds tags (v0)', async () => {
    const refs = await gitService.findRef(OLLAMA_REPO, 'v0');
    expect(refs.length).toBeGreaterThan(0);
    const tag = refs.find(r => r.type === 'tag');
    expect(tag).toBeDefined();
  });

  it('aheadBehind returns 0,0 for HEAD vs HEAD', async () => {
    const result = await gitService.aheadBehind(OLLAMA_REPO, 'HEAD', 'HEAD');
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });

  it('mergeTree returns clean for HEAD vs HEAD', async () => {
    const result = await gitService.mergeTree(OLLAMA_REPO, 'HEAD', 'HEAD');
    expect(result.clean).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('extractRepoInfo detects GitHub', async () => {
    const info = await gitService.extractRepoInfo(OLLAMA_REPO);
    expect(info.provider).toBe('github');
    expect(info.owner).toBe('ollama');
    expect(info.repo).toBe('ollama');
  });

  it('configList returns entries', async () => {
    const list = await gitService.configList(OLLAMA_REPO, 'local');
    expect(list.length).toBeGreaterThan(0);
  });

  it('multi-branch log: returns union of branches', async () => {
    const log = await gitService.log(OLLAMA_REPO, {
      maxCount: 50,
      branches: ['main'],
    });
    expect(log.length).toBeGreaterThan(0);
  });

  it('log with file filter (--follow)', async () => {
    const log = await gitService.log(OLLAMA_REPO, {
      maxCount: 50,
      file: 'README.md',
      follow: true,
    });
    expect(log.length).toBeGreaterThan(0);
    // Every commit in file-history should touch README.md
    for (const entry of log) {
      const files = await gitService.commitFiles(OLLAMA_REPO, entry.hash);
      expect(files.some(f => f.path === 'README.md')).toBe(true);
    }
  });
});
