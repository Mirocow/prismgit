/**
 * Reproduces the user-reported bug:
 *   "У тебя пишет что синхронизировано только те ветки что стоят в HEAD
 *    а это не верно" — the sync indicator only showed "synced" for the
 *    HEAD branch because branches() only computed ahead/behind for the
 *    current branch. Non-current branches had undefined ahead/behind,
 *    so the BranchSyncIndicator treated them all as in sync.
 *
 * The fix: branches() now uses `%(upstream:track)` from for-each-ref
 * to compute ahead/behind/gone for ALL local branches with an upstream,
 * not just the current one.
 *
 * Test setup (single repo with a bare remote):
 *   main          → pushed, in sync
 *   feature/ahead → ahead 2 (local commits not pushed)
 *   feature/behind→ behind 1 (remote has commit not pulled)
 *   feature/gone  → upstream was deleted on remote (gone)
 *   feature/notrack → no upstream (local-only, never pushed)
 *
 * We assert that branches() returns the correct ahead/behind/gone
 * fields for each non-current branch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { branches } from '../../electron/services/git';

const ROOT = '/tmp/prismgit-branches-track-test';
const REMOTE = `${ROOT}/remote.git`;
const LOCAL = `${ROOT}/local`;

const NL = String.fromCharCode(10);

function sh(cmd: string, cwd: string = ROOT) {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  // Bare remote — `-b main` makes the empty remote's HEAD point at `main`
  // (older git defaults to `master`, which then makes `git push -u origin
  // main` fail with "src refspec main does not match any").
  sh('git init -q -b main --bare remote.git');

  // Clone to local — an empty bare clone doesn't carry the branch name,
  // so create `main` explicitly before the first commit.
  sh(`git clone -q ${REMOTE} local`, ROOT);
  sh('git checkout -b main', LOCAL);
  sh('git config user.name "T"', LOCAL);
  sh('git config user.email "t@t"', LOCAL);

  // Initial commit on main
  writeFileSync(`${LOCAL}/a.txt`, 'a' + NL);
  sh('git add a.txt', LOCAL);
  sh('git commit -q -m "init"', LOCAL);
  sh('git push -q -u origin main', LOCAL);

  // ── feature/ahead: 2 local commits not pushed ──────────────────────
  sh('git checkout -q -b feature/ahead', LOCAL);
  writeFileSync(`${LOCAL}/a1.txt`, 'a1' + NL);
  sh('git add a1.txt', LOCAL);
  sh('git commit -q -m "a1"', LOCAL);
  writeFileSync(`${LOCAL}/a2.txt`, 'a2' + NL);
  sh('git add a2.txt', LOCAL);
  sh('git commit -q -m "a2"', LOCAL);
  sh('git push -q -u origin feature/ahead', LOCAL);
  // Now add 2 more local commits WITHOUT pushing → ahead 2
  writeFileSync(`${LOCAL}/a3.txt`, 'a3' + NL);
  sh('git add a3.txt', LOCAL);
  sh('git commit -q -m "a3"', LOCAL);
  writeFileSync(`${LOCAL}/a4.txt`, 'a4' + NL);
  sh('git add a4.txt', LOCAL);
  sh('git commit -q -m "a4"', LOCAL);

  // ── feature/behind: remote has 1 commit not pulled ──────────────────
  sh('git checkout -q main', LOCAL);
  sh('git checkout -q -b feature/behind', LOCAL);
  sh('git push -q -u origin feature/behind', LOCAL);
  // Add a commit to the REMOTE side (via another clone)
  sh(`git clone -q ${REMOTE} ${ROOT}/remote-work`);
  sh('git config user.name "R"', `${ROOT}/remote-work`);
  sh('git config user.email "r@r"', `${ROOT}/remote-work`);
  sh('git checkout -q feature/behind', `${ROOT}/remote-work`);
  writeFileSync(`${ROOT}/remote-work/r1.txt`, 'r1' + NL);
  sh('git add r1.txt', `${ROOT}/remote-work`);
  sh('git commit -q -m "r1"', `${ROOT}/remote-work`);
  sh('git push -q origin feature/behind', `${ROOT}/remote-work`);
  // Update the local side's remote-tracking refs via fetch
  sh('git fetch -q origin', LOCAL);

  // ── feature/gone: upstream deleted on remote ────────────────────────
  sh('git checkout -q main', LOCAL);
  sh('git checkout -q -b feature/gone', LOCAL);
  sh('git push -q -u origin feature/gone', LOCAL);
  sh('git push -q origin :feature/gone', `${ROOT}/remote-work`);
  sh('git fetch -q --prune origin', LOCAL);

  // ── feature/notrack: no upstream (local-only) ──────────────────────
  sh('git checkout -q main', LOCAL);
  sh('git checkout -q -b feature/notrack', LOCAL);
  writeFileSync(`${LOCAL}/nt.txt`, 'nt' + NL);
  sh('git add nt.txt', LOCAL);
  sh('git commit -q -m "nt"', LOCAL);
  // No push — no upstream configured.

  // Back to main for the test
  sh('git checkout -q main', LOCAL);
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('git.branches() — ahead/behind/gone for ALL local branches', () => {
  it('returns ahead/behind/gone for non-current branches too (not just HEAD)', async () => {
    const brs = await branches(LOCAL);
    const byName = new Map(brs.map((b) => [b.name, b]));

    // ── main: current, in sync ──────────────────────────────────────
    const main = byName.get('main');
    expect(main).toBeDefined();
    expect(main!.current).toBe(true);
    expect(main!.tracking).toBe('origin/main');
    // git status reports 0 for both ahead and behind when in sync.
    expect(main!.ahead).toBe(0);
    expect(main!.behind).toBe(0);
    expect(main!.gone).toBeUndefined();

    // ── feature/ahead: non-current, ahead 2 ──────────────────────────
    const ahead = byName.get('feature/ahead');
    expect(ahead).toBeDefined();
    expect(ahead!.current).toBe(false);
    expect(ahead!.upstream).toBe('origin/feature/ahead');
    // THE BUG: this was undefined before the fix.
    expect(ahead!.ahead).toBe(2);
    // for-each-ref reports only "ahead 2" — behind is undefined.
    // The BranchSyncIndicator treats undefined as 0 via `?? 0`.
    expect(ahead!.behind).toBeUndefined();
    expect(ahead!.gone).toBeUndefined();

    // ── feature/behind: non-current, behind 1 ─────────────────────────
    const behind = byName.get('feature/behind');
    expect(behind).toBeDefined();
    expect(behind!.current).toBe(false);
    expect(behind!.upstream).toBe('origin/feature/behind');
    // THE BUG: this was undefined before the fix.
    expect(behind!.ahead).toBeUndefined();
    expect(behind!.behind).toBe(1);
    expect(behind!.gone).toBeUndefined();

    // ── feature/gone: non-current, gone ──────────────────────────────
    const gone = byName.get('feature/gone');
    expect(gone).toBeDefined();
    expect(gone!.current).toBe(false);
    expect(gone!.upstream).toBe('origin/feature/gone');
    // THE BUG: gone was only set for current branch before the fix.
    expect(gone!.gone).toBe(true);

    // ── feature/notrack: local-only, no upstream ────────────────────
    const notrack = byName.get('feature/notrack');
    expect(notrack).toBeDefined();
    expect(notrack!.current).toBe(false);
    expect(notrack!.upstream).toBeUndefined();
    expect(notrack!.tracking).toBeUndefined();
    expect(notrack!.ahead).toBeUndefined();
    expect(notrack!.behind).toBeUndefined();
    expect(notrack!.gone).toBeUndefined();
  });

  it('still lists remote-tracking branches', async () => {
    const brs = await branches(LOCAL);
    const remote = brs.find((b) => b.remote && b.name === 'origin/main');
    expect(remote).toBeDefined();
    expect(remote!.remote).toBe(true);
  });
});
