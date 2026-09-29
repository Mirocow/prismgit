/**
 * Integration tests — batched config access (Repository Settings freeze fix).
 *
 * User report: "Repository Settings зависло приложение при открытии" — the
 * dialog fired 19 parallel configGet IPC round-trips (19 git subprocess
 * spawns through the shared getGit() queue). configGetMany collapses them
 * into ONE `git config --list -z`; configSetMany writes the whole dialog
 * in one sequential, lock-retried batch.
 *
 * Covers:
 *  - configGetMany: values from all scopes, last-wins for multi-value keys,
 *    absent keys → undefined, unknown keys filtered, empty key list → {}.
 *  - configGetMany parity with configGet for the same key.
 *  - configSetMany: set / unset (null) / empty-string → unset / unset of an
 *    absent key is a no-op; result verified through `git config --get`.
 *
 * Global/system git config neutralized so the machine's ~/.gitconfig can't
 * leak values into the assertions (same mechanism as identityConfig tests).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-cfgbatch-data-'));
process.env.PRISMGIT_USER_DATA = TEST_DATA_DIR;
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';
const REAL_HOME = process.env.HOME;
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-cfgbatch-home-'));
process.env.HOME = EMPTY_HOME;

const gitService = await import('../../electron/services/git');

function shell(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    // `git config --get <absent-key>` exits 1 with empty output — that is
    // "no value", not a failure.
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1 && !String(err.stdout ?? '').trim()) return '';
    throw e;
  }
}

let repo: string;
beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-cfgbatch-repo-'));
  execSync('git init', { cwd: repo, stdio: 'ignore' });
});

afterAll(() => {
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  fs.rmSync(EMPTY_HOME, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('configGetMany — one `git config --list -z` for all keys', () => {
  it('returns values for set keys and undefined for absent keys', async () => {
    shell('git config user.name Alice', repo);
    shell('git config pull.rebase true', repo);
    const out = await gitService.configGetMany(repo, [
      'user.name', 'user.email', 'pull.rebase',
    ]);
    expect(out).toEqual({
      'user.name': 'Alice',
      'user.email': undefined,
      'pull.rebase': 'true',
    });
  });

  it('empty key list answers an empty object without spawning', async () => {
    const out = await gitService.configGetMany(repo, []);
    expect(out).toEqual({});
  });

  it('multi-value keys: the LAST entry wins (matches `git config --get`)', async () => {
    shell('git config --add credential.helper store', repo);
    shell('git config --add credential.helper cache', repo);
    const out = await gitService.configGetMany(repo, ['credential.helper']);
    expect(out['credential.helper']).toBe('cache');
    expect(shell('git config --get credential.helper', repo)).toBe('cache');
  });

  it('is value-compatible with configGet for the same key', async () => {
    shell('git config gui.encoding KOI8-R', repo);
    const [many, one] = await Promise.all([
      gitService.configGetMany(repo, ['gui.encoding']),
      gitService.configGet(repo, 'gui.encoding'),
    ]);
    expect(many['gui.encoding']).toBe(one).toBe('KOI8-R');
  });

  it('parses values with = and multi-line escapes intact (the -z format splits on \\n, not =)', async () => {
    // -z records are "key\nvalue" — a '=' inside the VALUE must survive
    // (the plain format's key=value would confuse a naive parser).
    shell("git config smartgit.tag-grouping.pattern 'v(\\d+\\.\\d+)'", repo);
    // git escapes a real newline to literal "\n" when storing; --list -z
    // prints the escaped sequence — configGetMany must return it verbatim
    // (exactly what configGet does).
    execSync('git config smartgit.tag-grouping.single "a\\nb"', { cwd: repo, stdio: 'ignore' });
    const out = await gitService.configGetMany(repo, [
      'smartgit.tag-grouping.pattern',
      'smartgit.tag-grouping.single',
    ]);
    expect(out['smartgit.tag-grouping.pattern']).toBe('v(\\d+\\.\\d+)');
    expect(out['smartgit.tag-grouping.single']).toBe('a\\nb');
    expect(shell('git config --get smartgit.tag-grouping.single', repo)).toBe('a\\nb');
  });
});

describe('configSetMany — one sequential, lock-retried batch', () => {
  it('writes values and unsets null/empty entries', async () => {
    shell('git config user.name Alice', repo);
    await gitService.configSetMany(repo, [
      { key: 'user.name', value: 'Bob' },
      { key: 'user.email', value: 'bob@example.com' },
      { key: 'pull.rebase', value: 'input' },
      { key: 'gpg.program', value: null },            // unset an existing/absent key
      { key: 'core.fsmonitor', value: '' },           // empty string → unset as well
    ]);
    expect(shell('git config --get user.name', repo)).toBe('Bob');
    expect(shell('git config --get user.email', repo)).toBe('bob@example.com');
    expect(shell('git config --get pull.rebase', repo)).toBe('input');
    expect(shell('git config --get core.fsmonitor', repo)).toBe('');
    // unset of an ABSENT key must be a no-op, not an error
    await gitService.configSetMany(repo, [{ key: 'never.set.before', value: null }]);
  });

  it('values are trimmed exactly like the dialog did per-key', async () => {
    await gitService.configSetMany(repo, [
      { key: 'user.signingkey', value: '  ABC123  ' },
    ]);
    expect(shell('git config --get user.signingkey', repo)).toBe('ABC123');
  });

  it('writes simple-git "unsafe" keys (gpg.program) when set explicitly', async () => {
    await gitService.configSetMany(repo, [
      { key: 'gpg.program', value: '/usr/bin/gpg' },
    ]);
    expect(shell('git config --get gpg.program', repo)).toBe('/usr/bin/gpg');
  });

  it('survives a held .git/config.lock (retry path)', async () => {
    // Simulate a concurrent writer (watcher refresh / IDE): create the lock
    // file BEFORE the batch — git fails with "Another git process seems to
    // be operating" / "File exists" and configSetMany retries after 150 ms.
    const lock = path.join(repo, '.git', 'config.lock');
    fs.writeFileSync(lock, 'stale lock\n');
    try {
      // Keep the lock alive ~50 ms: the FIRST attempt fails immediately
      // (git: "could not lock config file … File exists"), configSetMany
      // backs off 150 ms and the retry lands with the lock already gone.
      setTimeout(() => { try { fs.rmSync(lock, { force: true }); } catch { /* gone */ } }, 50).unref();
      await gitService.configSetMany(repo, [
        { key: 'fetch.prune', value: 'true' },
      ]);
      expect(shell('git config --get fetch.prune', repo)).toBe('true');
    } finally {
      try { fs.rmSync(lock, { force: true }); } catch { /* gone */ }
    }
  });
});
