/**
 * Integration tests — two user-reported problems:
 *
 * 1. "Failed to save settings — git:configSet: Configuring gpg.program is
 *    not permitted without enabling allowUnsafeGpgProgram".
 *    configSet/configUnset must accept simple-git "unsafe" config keys when
 *    the user edits them explicitly (Repository Settings → Signing).
 *
 * 2. "Repositories created via PrismGit get no author/email".
 *    - init()/clone() must write the default identity (gitUserName /
 *      gitUserEmail app settings) into the new repository's local config.
 *    - commit() must retry once with the default identity as -c overrides
 *      when git refuses with "Please tell me who you are".
 *
 * Global/system git config is neutralized via GIT_CONFIG_GLOBAL /
 * GIT_CONFIG_SYSTEM=/dev/null so the tests don't depend on the machine's
 * ~/.gitconfig (requires git 2.32+).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// Isolate the app settings store BEFORE importing the service modules —
// SimpleStore reads PRISMGIT_USER_DATA at module load.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-identity-data-'));
process.env.PRISMGIT_USER_DATA = TEST_DATA_DIR;
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';

const storage = await import('../../electron/services/storage');
const gitService = await import('../../electron/services/git');

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-identity-repo-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('configSet with simple-git "unsafe" keys (gpg.program)', () => {
  let repo: string;
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('writes gpg.program without the allowUnsafeGpgProgram error', async () => {
    await gitService.configSet(repo, 'gpg.program', '/usr/local/bin/gpg2', 'local');
    const value = await gitService.configGet(repo, 'gpg.program', 'local');
    expect(value).toBe('/usr/local/bin/gpg2');
  });

  it('unsets gpg.program without the allowUnsafeGpgProgram error', async () => {
    await gitService.configUnset(repo, 'gpg.program', 'local');
    const value = await gitService.configGet(repo, 'gpg.program', 'local');
    expect(value).toBeUndefined();
  });

  it('still writes ordinary keys directly', async () => {
    await gitService.configSet(repo, 'user.name', 'Ordinary Key', 'local');
    expect(await gitService.configGet(repo, 'user.name', 'local')).toBe('Ordinary Key');
  });
});

describe('default commit identity (Settings → Git)', () => {
  const NAME = 'Ivan Testov';
  const EMAIL = 'ivan.testov@example.com';

  afterAll(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('applyGitIdentity writes local user.name/user.email from app settings', async () => {
    storage.setSetting('gitUserName', NAME);
    storage.setSetting('gitUserEmail', EMAIL);
    const repo = makeTempRepo();
    try {
      // Re-init through the service so applyGitIdentity runs on top of an
      // existing repo (idempotent — config values are simply re-written).
      await gitService.init(repo);
      expect(await gitService.configGet(repo, 'user.name', 'local')).toBe(NAME);
      expect(await gitService.configGet(repo, 'user.email', 'local')).toBe(EMAIL);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('commit() falls back to the default identity when none is configured', async () => {
    storage.setSetting('gitUserName', NAME);
    storage.setSetting('gitUserEmail', EMAIL);
    // Plain `git init` (NOT the service) — no local identity is written.
    const repo = makeTempRepo();
    try {
      fs.writeFileSync(path.join(repo, 'file.txt'), 'hello\n');
      shell('git add file.txt', repo);
      // Sanity: without identity git refuses the commit.
      let refused = false;
      try {
        execSync('git -c user.email= -c user.name= commit -m nope', {
          cwd: repo,
          stdio: 'ignore',
          env: { ...process.env, GIT_AUTHOR_NAME: '', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: '', GIT_COMMITTER_EMAIL: '' },
        });
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);

      const hash = await gitService.commit(repo, 'identity fallback commit');
      expect(hash).toMatch(/^[a-f0-9]{7,40}$/);
      const author = shell(`git log -1 --format=%an%n%ae`, repo);
      expect(author).toBe(`${NAME}\n${EMAIL}`);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('commit() explains what to do when no identity exists anywhere', async () => {
    storage.setSetting('gitUserName', '');
    storage.setSetting('gitUserEmail', '');
    const repo = makeTempRepo();
    try {
      fs.writeFileSync(path.join(repo, 'file.txt'), 'hello\n');
      shell('git add file.txt', repo);
      await expect(gitService.commit(repo, 'should fail')).rejects.toThrow(
        /tell me who you are[\s\S]*Settings/i
      );
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
