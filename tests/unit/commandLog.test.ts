import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import {
  installGitCommandLogger,
  uninstallGitCommandLogger,
  listEntries,
  clearEntries,
  resetForTests,
  sanitizeArg,
  StreamTailer,
} from '../../electron/services/commandLog';
import type { CommandLogEntry } from '../../electron/types/command-log-api';

/**
 * Unit tests for the raw git command logger (main process).
 *
 * The install/uninstall tests run REAL git child processes. Spawning goes
 * through require('child_process').spawn — the same mutable CJS module object
 * the interceptor patches — exactly like simple-git and the compiled app do
 * in production.
 */

const require_ = createRequire(process.cwd() + '/prismgit.cjs');
const cp = require_('child_process') as typeof import('child_process');

function waitForEntries(n: number, timeoutMs = 5000): Promise<CommandLogEntry[]> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const list = listEntries();
      if (list.length >= n) {
        resolve(list);
      } else if (Date.now() > deadline) {
        reject(new Error(`timeout: expected ${n} entries, got ${list.length}`));
      } else {
        setTimeout(poll, 25);
      }
    };
    poll();
  });
}

afterEach(() => {
  uninstallGitCommandLogger();
  resetForTests();
});

describe('sanitizeArg — credential redaction in URLs', () => {
  it('redacts user:pass in https/ssh URLs', () => {
    expect(sanitizeArg('https://user:secret123@github.com/team/repo.git')).toBe(
      'https://***@github.com/team/repo.git',
    );
    expect(sanitizeArg('http://token@gitlab.local/web/git.git')).toBe(
      'http://***@gitlab.local/web/git.git',
    );
    expect(sanitizeArg('ssh://git@host:22/team/repo.git')).toBe('ssh://***@host:22/team/repo.git');
  });

  it('leaves plain arguments untouched', () => {
    expect(sanitizeArg('origin')).toBe('origin');
    expect(sanitizeArg('feature/smartgit-electron-v1')).toBe('feature/smartgit-electron-v1');
    expect(sanitizeArg('--no-verify')).toBe('--no-verify');
    expect(sanitizeArg('/home/user/repos/project')).toBe('/home/user/repos/project');
  });
});

describe('StreamTailer — output capping', () => {
  it('keeps everything under the cap', () => {
    const t = new StreamTailer();
    t.push('hello ');
    t.push(Buffer.from('world'));
    expect(t.result()).toBe('hello world');
  });

  it('marks output above 32KB as truncated', () => {
    const t = new StreamTailer();
    t.push('a'.repeat(40 * 1024));
    const result = t.result();
    expect(result.startsWith('a'.repeat(32 * 1024))).toBe(true);
    expect(result.endsWith('output truncated)')).toBe(true);
    expect(result.length).toBeLessThan(33 * 1024);
  });
});

describe('installGitCommandLogger — real git spawn interception', () => {
  it('records a successful git command with stdout and exit code 0', async () => {
    clearEntries();
    installGitCommandLogger();

    cp.spawn('git', ['--version'], { cwd: process.cwd() });
    const [entry] = await waitForEntries(1);

    expect(entry.args).toEqual(['--version']);
    expect(entry.exitCode).toBe(0);
    expect(entry.signal).toBeNull();
    expect(entry.stdout).toContain('git version');
    expect(entry.stderr).toBe('');
    expect(typeof entry.durationMs).toBe('number');
    expect(typeof entry.repo).toBe('string');
  });

  it('records a failing git command with exit code and stderr', async () => {
    clearEntries();
    installGitCommandLogger();

    // Run in a directory that is not a git repository (assuming HOME isn't one)
    cp.spawn('git', ['rev-parse', '--git-dir'], { cwd: process.env.HOME || process.cwd() });
    const [entry] = await waitForEntries(1);

    expect(entry.args).toEqual(['rev-parse', '--git-dir']);
    expect(entry.exitCode).not.toBe(0);
    expect(entry.stderr.toLowerCase()).toContain('not a git repository');
  });

  it('does not record non-git spawns', async () => {
    clearEntries();
    installGitCommandLogger();

    cp.spawn(process.execPath, ['-e', 'process.exit(0)']);
    // Give the (non-recorded) spawn time to finish, then assert emptiness.
    await new Promise((r) => setTimeout(r, 700));
    expect(listEntries()).toEqual([]);
  });

  it('handles the (command, options) spawn overload shape', async () => {
    clearEntries();
    installGitCommandLogger();

    // git without args prints usage to stderr and exits with code 1
    cp.spawn('git', { cwd: process.cwd() });
    const [entry] = await waitForEntries(1);

    expect(entry.args).toEqual([]);
    expect(entry.exitCode).not.toBe(0);
  });

  it('uninstall restores the original spawn (no more recording)', async () => {
    clearEntries();
    installGitCommandLogger();
    uninstallGitCommandLogger();

    cp.spawn('git', ['--version']);
    await new Promise((r) => setTimeout(r, 700));
    expect(listEntries()).toEqual([]);
  });
});
