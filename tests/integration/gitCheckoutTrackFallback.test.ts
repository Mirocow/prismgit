/**
 * Integration test — checkout(remote, { track: true }) fallback.
 *
 * User-reported bug: «При переключении на Remote ветку словил сообщение а
 * не диалоговое окно Error:Не удалось переключить ветку / Error invoking
 * remote method 'git:checkout': Error: fatal: a branch named 'main'
 * already exists» — clicking a REMOTE branch always ran
 * `git checkout --track origin/main`, which dies when a local branch with
 * the same short name already exists.
 *
 * The service now detects the specific fatal and falls back to a plain
 * checkout of the existing local branch (defense in depth — the renderer
 * pre-checks too).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { checkout } from '../../electron/services/git';

const ROOT = '/tmp/prismgit-checkout-track-fallback-test';
const REMOTE = `${ROOT}/remote.git`;
const LOCAL = `${ROOT}/local`;

const NL = String.fromCharCode(10);

function sh(cmd: string, cwd: string = ROOT) {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Raw HEAD read — bypasses the service's 1s read-coalesce cache (the
 *  beforeAll/within-test state changes happen in the same millisecond). */
function head(): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd: LOCAL, encoding: 'utf-8' }).trim();
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  sh('git init -q -b main --bare remote.git');
  sh(`git clone -q ${REMOTE} local`, ROOT);
  sh('git checkout -b main', LOCAL);
  sh('git config user.name "T"', LOCAL);
  sh('git config user.email "t@t"', LOCAL);
  writeFileSync(`${LOCAL}/a.txt`, 'a' + NL);
  sh('git add a.txt', LOCAL);
  sh('git commit -q -m "init"', LOCAL);
  sh('git push -q -u origin main', LOCAL);
  // A second branch to prove normal --track still works.
  sh('git checkout -q -b topic', LOCAL);
  writeFileSync(`${LOCAL}/t.txt`, 't' + NL);
  sh('git add t.txt', LOCAL);
  sh('git commit -q -m "topic"', LOCAL);
  sh('git push -q -u origin topic', LOCAL);
  sh('git checkout -q main', LOCAL);
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('checkout --track fallback (branch already exists)', () => {
  it('switches to the EXISTING local branch instead of erroring', async () => {
    // Sanity: local `main` exists, HEAD is on main.
    expect(head()).toBe('main');
    // Move off main first so the switch is observable.
    sh('git checkout -q topic', LOCAL);
    expect(head()).toBe('topic');

    // BEFORE the fix: rejected with "fatal: a branch named 'main' already
    // exists". NOW: falls back to plain `git checkout main`.
    const res = await checkout(LOCAL, 'origin/main', { track: true });
    expect(res.autoStashed).toBe(false);
    expect(head()).toBe('main');
  });

  it('still creates a NEW tracking branch when no local branch exists', async () => {
    // Delete the local branch to force the --track path.
    sh('git checkout -q main', LOCAL);
    sh('git branch -q -D topic', LOCAL);
    await checkout(LOCAL, 'origin/topic', { track: true });
    expect(head()).toBe('topic');
    // And it tracks origin/topic.
    const tracking = execSync('git rev-parse --abbrev-ref topic@{upstream}', {
      cwd: LOCAL, encoding: 'utf-8',
    }).trim();
    expect(tracking).toBe('origin/topic');
  });

  it('does NOT swallow unrelated checkout errors', async () => {
    // A nonexistent branch must still reject (the fallback only covers the
    // exact "already exists" fatal for the tracked short name).
    await expect(
      checkout(LOCAL, 'origin/does-not-exist', { track: true }),
    ).rejects.toThrow();
  });
});
