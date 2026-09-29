/**
 * Integration — the `git:raw` stale-range defense-in-depth layer.
 *
 * Scenario pinned (user-reported console spam):
 *   Error occurred in handler for 'git:raw': Error: fatal: ambiguous
 *   argument 'main..origin/main': unknown revision or path not in the
 *   working tree.
 *
 * The SOURCE-level fix (fetchIncomingHashes validates refs before spawning
 * the range command) landed in f23b3d3 and is unit-pinned. This file pins
 * the BOUNDARY-level defense added on top: whatever call site still ends up
 * running `A..B` / `A...B` with an unresolvable side (1s TTL ref-cache
 * staleness, a ref deleted by a concurrent external tool between the UI's
 * ref-list read and the range call), the git:raw IPC handler must degrade
 * the failure to '' instead of re-throwing it — because Electron logs every
 * thrown ipcMain.handle error as "Error occurred in handler for 'git:raw'".
 *
 * The handler itself needs an Electron runtime, so the pipeline is verified
 * in three pieces exactly as the handler runs them:
 *   1. gitService.raw(repo, ['rev-list', 'A..B']) REJECTS with the real
 *      git message (a live subprocess — proves the message format we match
 *      is the one real git produces, not a hand-copied string).
 *   2. wrap() (electron/ipc/git.ts) reduces the rejection to the lines
 *      containing 'fatal:' — reproduced here with the same 3-line logic.
 *   3. isBenignRawError() (src/lib/rawGitErrors.ts) classifies the cleaned
 *      message as benign → the handler returns '' (empty result for the
 *      renderer: empty incoming set / empty compare diff).
 *
 * Also pins the negative: a genuinely bad single-ref invocation must stay
 * classified as a REAL error so user-facing typos still surface.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';
import { isBenignRawError } from '../../src/lib/rawGitErrors';

const ROOT = path.join(os.tmpdir(), 'prismgit-repos', 'raw-stale-range');

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/** Same message-cleaning the ipc wrap() applies before the handler decides. */
function wrapClean(msg: string): string {
  const lines = msg.split('\n').filter((l) => l.includes('error:') || l.includes('fatal:'));
  return lines.length > 0 ? lines.join('\n') : msg.split('\n')[0] || msg;
}

async function rawError(repoPath: string, args: string[]): Promise<string> {
  try {
    await gitService.raw(repoPath, args);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error(`expected ${args.join(' ')} to fail on a repo without origin/main`);
}

describe('git:raw boundary — stale range errors degrade to empty', () => {
  let work: string;

  beforeAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    // Isolate from the machine's global git identity.
    process.env.GIT_CONFIG_GLOBAL = path.join(ROOT, 'empty-gitconfig');
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');

    // A local-only repo on `main` with one commit and NO remote at all —
    // `origin/main` cannot resolve, exactly like a [gone] upstream.
    shell('git init -q -b main work', ROOT);
    work = path.join(ROOT, 'work');
    shell('git config user.name "Ivan Testov"', work);
    shell('git config user.email "ivan@test.dev"', work);
    fs.writeFileSync(path.join(work, 'file.txt'), 'content\n');
    shell('git add file.txt', work);
    shell('git commit -q -m "base"', work);
  });

  afterAll(() => {
    delete process.env.GIT_CONFIG_GLOBAL;
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it('rev-list main..origin/main (upstream gone) is classified benign → handler answers ""', async () => {
    const msg = await rawError(work, ['rev-list', 'main..origin/main']);
    // Live-subprocess proof of the message shape git actually emits.
    expect(msg).toContain("ambiguous argument 'main..origin/main'");
    // The handler pipeline: wrap-clean → classify.
    expect(isBenignRawError(wrapClean(msg))).toBe(true);
  });

  it('diff main..origin/main (compare dialog vs deleted ref) is classified benign', async () => {
    const msg = await rawError(work, ['diff', '--name-status', 'main..origin/main']);
    expect(msg).toContain("ambiguous argument 'main..origin/main'");
    expect(isBenignRawError(wrapClean(msg))).toBe(true);
  });

  it('log master..origin/master (second user-log branch) is classified benign', async () => {
    const msg = await rawError(work, ['log', '--oneline', 'master..origin/master']);
    expect(msg).toContain("ambiguous argument 'master..origin/master'");
    expect(isBenignRawError(wrapClean(msg))).toBe(true);
  });

  it('triple-dot range (branches compare) is classified benign', async () => {
    const msg = await rawError(work, ['diff', '--name-status', 'main...feature/gone']);
    expect(msg).toContain("ambiguous argument 'main...feature/gone'");
    expect(isBenignRawError(wrapClean(msg))).toBe(true);
  });

  it('a single bad ref (real typo) stays a REAL error — handler re-throws', async () => {
    // `git rev-parse --verify <typo>` fails with a different message shape
    // (bad revision / ambiguous single ref) — must NOT be swallowed.
    const msg = await rawError(work, ['rev-parse', '--verify', 'no-such-branch']);
    expect(isBenignRawError(wrapClean(msg))).toBe(false);
  });

  it('valid range commands still succeed normally (regression guard)', async () => {
    const out = await gitService.raw(work, ['rev-list', 'main..main']);
    expect(out.trim()).toBe(''); // empty range of itself — valid, not an error
    const count = await gitService.raw(work, ['rev-list', '--count', 'HEAD']);
    expect(count.trim()).toBe('1');
  });
});
