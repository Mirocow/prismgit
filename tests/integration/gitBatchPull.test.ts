/**
 * Reproduces the user-reported "Need to specify how to reconcile divergent
 * branches" error from `git pull` invoked via batchOperation.
 *
 * Root cause: `batchOperation({ operation: 'pull' })` called
 * `git.raw([...netArgs, 'pull', r, branch])` DIRECTLY, bypassing the
 * dedicated `pull()` function — which always passes `--rebase` or
 * `--no-rebase` so git 2.27+ doesn't refuse on divergent branches.
 *
 * The fix: batchOperation delegates pull to the pull() function
 * instead of raw git.raw().
 *
 * Test setup: a bare remote + a local clone with divergent branches.
 * Calling batchOperation(['local'], 'pull') must NOT throw "Need to
 * specify how to reconcile divergent branches" — it should succeed
 * and create a merge commit (default merge strategy).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { batchOperation } from '../../electron/services/git';

const ROOT = '/tmp/prismgit-batch-pull-test';
const REMOTE = `${ROOT}/remote.git`;
const LOCAL = `${ROOT}/local`;

const NL = String.fromCharCode(10);

function sh(cmd: string, cwd: string = ROOT) {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  sh('git init -q --bare remote.git', ROOT);

  sh(`git clone -q ${REMOTE} local`, ROOT);
  sh('git config user.name "T"', LOCAL);
  sh('git config user.email "t@t"', LOCAL);
  writeFileSync(`${LOCAL}/a.txt`, 'a' + NL);
  sh('git add a.txt', LOCAL);
  sh('git commit -q -m "init"', LOCAL);
  sh('git push -q -u origin main', LOCAL);

  // Create a divergent commit on the remote (via a second clone)
  sh(`git clone -q ${REMOTE} ${ROOT}/remote-work`, ROOT);
  sh('git config user.name "R"', `${ROOT}/remote-work`);
  sh('git config user.email "r@r"', `${ROOT}/remote-work`);
  writeFileSync(`${ROOT}/remote-work/b.txt`, 'b' + NL);
  sh('git add b.txt', `${ROOT}/remote-work`);
  sh('git commit -q -m "b on remote"', `${ROOT}/remote-work`);
  sh('git push -q origin main', `${ROOT}/remote-work`);

  // Create a divergent commit on the local clone (no push)
  writeFileSync(`${LOCAL}/c.txt`, 'c' + NL);
  sh('git add c.txt', LOCAL);
  sh('git commit -q -m "c on local"', LOCAL);
  sh('git fetch -q origin', LOCAL);
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('batchOperation — pull on divergent branches', () => {
  it('succeeds with the merge strategy (no "Need to specify how to reconcile" error)', async () => {
    // batchOperation(['local'], 'pull') must NOT throw — the fixed
    // implementation delegates to pull() which passes --no-rebase.
    const results = await batchOperation([LOCAL], 'pull', {
      remote: 'origin',
      branch: 'main',
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].error).toBeUndefined();

    // After the merge, both b.txt (from remote) and c.txt (local) should
    // be in the working tree.
    const files = execSync(`ls -1 ${LOCAL}`, { encoding: 'utf-8' }).trim().split('\n');
    expect(files).toContain('a.txt');
    expect(files).toContain('b.txt');
    expect(files).toContain('c.txt');

    // The log should contain a Merge commit.
    const log = execSync(`git -C ${LOCAL} log --pretty=format:"%s"`, { encoding: 'utf-8' });
    expect(log).toMatch(/Merge/);
  });
});
