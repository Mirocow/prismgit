/**
 * Reproduces the user-reported bug:
 *   Error occurred in handler for 'git:pull':
 *   Error: fatal: Need to specify how to reconcile divergent branches.
 *
 * Root cause: git 2.27+ refuses to pull when local and remote branches
 * have diverged AND no `pull.rebase` strategy is configured. The previous
 * pull() implementation only passed `--rebase` when rebase=true, leaving
 * the merge case implicit — git then exited 128 with "Need to specify
 * how to reconcile divergent branches" on every divergent pull.
 *
 * The fix always passes either `--rebase` or `--no-rebase` so git never
 * has to ask. This test verifies both branches work end-to-end against
 * a real git repo with divergent branches.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pull } from '../../electron/services/git';

const ROOT = '/tmp/prismgit-pull-strategy-test';
const REMOTE = `${ROOT}/remote.git`;
const LOCAL1 = `${ROOT}/local1`;
const LOCAL2 = `${ROOT}/local2`;

// Use \u000A to avoid esbuild's "unterminated string literal" warning
// when the source contains the literal escape sequence.
const NEWLINE = String.fromCharCode(10);

function sh(cmd: string, cwd: string = ROOT) {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  // Create a bare remote — `-b main` ensures the empty remote's HEAD
  // points at `main` (older git defaults to `master`).
  sh('git init -q -b main --bare remote.git');

  // local1: initial commit + push
  sh('git init -q -b main local1', ROOT);
  sh('git config user.name "L1"', LOCAL1);
  sh('git config user.email "l1@l1"', LOCAL1);
  sh('git remote add origin ' + REMOTE, LOCAL1);
  writeFileSync(`${LOCAL1}/a.txt`, 'a' + NEWLINE);
  sh('git add a.txt', LOCAL1);
  sh('git commit -q -m "init"', LOCAL1);
  sh('git push -q origin main', LOCAL1);

  // local2: clone, add divergent commit, push
  sh(`git clone -q ${REMOTE} local2`, ROOT);
  sh('git config user.name "L2"', LOCAL2);
  sh('git config user.email "l2@l2"', LOCAL2);
  writeFileSync(`${LOCAL2}/b.txt`, 'b' + NEWLINE);
  sh('git add b.txt', LOCAL2);
  sh('git commit -q -m "add b on local2"', LOCAL2);
  sh('git push -q origin main', LOCAL2);

  // local1: divergent commit (no push yet) — local1 and origin/main are
  // now divergent. A plain `git pull` would fail with the
  // "Need to specify how to reconcile divergent branches" error.
  writeFileSync(`${LOCAL1}/c.txt`, 'c' + NEWLINE);
  sh('git add c.txt', LOCAL1);
  sh('git commit -q -m "add c on local1"', LOCAL1);
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('git.pull — divergent branches', () => {
  it('succeeds with default merge strategy (--no-rebase) and creates a merge commit', async () => {
    // local1 is divergent with origin/main.
    // pull(rebase=false) → `git pull --no-rebase origin main` → merge.
    const result = await pull(LOCAL1, 'origin', 'main', false, false);
    expect(result.autoStashed).toBe(false);
    // After the merge, both b.txt and c.txt should be in the working tree.
    const files = execSync(`ls -1 ${LOCAL1}`, { encoding: 'utf-8' }).trim().split('\n');
    expect(files).toContain('a.txt');
    expect(files).toContain('b.txt');
    expect(files).toContain('c.txt');
    // The log should contain the merge commit.
    const log = execSync(`git -C ${LOCAL1} log --pretty=format:"%s"`, { encoding: 'utf-8' });
    expect(log).toMatch(/Merge/);
  });

  it('succeeds with rebase strategy (--rebase) — local commit replayed on top', async () => {
    // Reset local1's merge commit so we can re-test with --rebase.
    // Move HEAD back to the local commit before the merge.
    sh('git reset --hard HEAD~1', LOCAL1);
    // Confirm we're back on the local-only commit (with c.txt but no b.txt).
    const files = execSync(`ls -1 ${LOCAL1}`, { encoding: 'utf-8' }).trim().split('\n');
    expect(files).toContain('a.txt');
    expect(files).toContain('c.txt');
    expect(files).not.toContain('b.txt');

    // pull(rebase=true) → `git pull --rebase origin main` — local commit
    // gets replayed on top of origin/main, no merge commit created.
    const result = await pull(LOCAL1, 'origin', 'main', true, false);
    expect(result.autoStashed).toBe(false);

    // After rebase, both b.txt and c.txt should be in the working tree.
    const files2 = execSync(`ls -1 ${LOCAL1}`, { encoding: 'utf-8' }).trim().split('\n');
    expect(files2).toContain('a.txt');
    expect(files2).toContain('b.txt');
    expect(files2).toContain('c.txt');

    // The log should NOT contain a "Merge" commit — rebase keeps history linear.
    const log = execSync(`git -C ${LOCAL1} log --pretty=format:"%s"`, { encoding: 'utf-8' });
    expect(log).not.toMatch(/^Merge/);
  });
});
