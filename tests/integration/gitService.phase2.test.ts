/**
 * PrismGit — phase 2 / 4.5 integration coverage.
 *
 * New in phase 2:
 *   - hasSubmoduleConfigChanges() — .gitmodules diff probe behind the
 *     "Warn when checkout changes submodule configuration" feature (2.1).
 *   - stashApply/stashPop keepIndex — `git stash (apply|pop) --index`
 *     restores the staged/unstaged split (2.3, SmartGit "Keep index").
 *
 * Drives `electron/services/git.ts` (the same layer behind all IPC
 * handlers) against LOCAL repositories — zero external network.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';

vi.setConfig({ testTimeout: 30_000 });

let ROOT = '';
let repo = '';
let repoStash = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-phase2-'));
  repo = path.join(ROOT, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  shGit(`init -q ${JSON.stringify(repo)}`, ROOT);
  shGit('config user.name "Test User"', repo);
  shGit('config user.email test@test.com', repo);
  write(repo, 'base.txt', 'base\n');
  shGit('add -A', repo);
  shGit('commit -qm "init"', repo);

  // Dedicated repo for stash tests — keep-index scenarios must not see
  // stale entries left by other scenarios. a.txt/b.txt are COMMITTED so
  // that staged/unstaged modifications behave predictably under stash.
  repoStash = path.join(ROOT, 'repo-stash');
  fs.mkdirSync(repoStash, { recursive: true });
  shGit(`init -q ${JSON.stringify(repoStash)}`, ROOT);
  shGit('config user.name "Test User"', repoStash);
  shGit('config user.email test@test.com', repoStash);
  write(repoStash, 'a.txt', 'a base\n');
  write(repoStash, 'b.txt', 'b base\n');
  shGit('add -A', repoStash);
  shGit('commit -qm "init"', repoStash);
});

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

function sh(cmd: string, cwd = ROOT): string {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/** Console git with deterministic identity. */
function shGit(args: string, cwd = ROOT): string {
  return sh(`git -c user.name="Test User" -c user.email=test@test.com ${args}`, cwd);
}

function write(dir: string, rel: string, content: string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

describe('phase 2.1 — hasSubmoduleConfigChanges', () => {
  it('returns true when the target branch ships a different .gitmodules', async () => {
    const base = shGit('rev-parse --abbrev-ref HEAD', repo);
    // branch "with-sub" adds/changes .gitmodules
    shGit(`checkout -q -b with-sub`, repo);
    write(repo, '.gitmodules', '[submodule "lib"]\n\tpath = lib\n\turl = https://example.com/lib.git\n');
    shGit('add -A', repo);
    shGit('commit -qm "add submodule config"', repo);
    shGit(`checkout -q ${base}`, repo);

    const changed = await gitService.hasSubmoduleConfigChanges(repo, 'with-sub');
    expect(changed).toBe(true);
  });

  it('returns false when .gitmodules is identical between branches', async () => {
    // A second branch WITHOUT .gitmodules changes (same as HEAD)
    shGit('checkout -q -b same-sub', repo);
    shGit('checkout -q -', repo); // back

    const changed = await gitService.hasSubmoduleConfigChanges(repo, 'same-sub');
    expect(changed).toBe(false);
  });

  it('returns false (never throws) for a non-existent target', async () => {
    const changed = await gitService.hasSubmoduleConfigChanges(repo, 'no-such-branch');
    expect(changed).toBe(false);
  });
});

describe('phase 2.3 — stash apply/pop with keepIndex', () => {
  it('stashApply(repo, 0, true) restores the staged/unstaged split', async () => {
    const R = repoStash;
    // Work tree: staged modification (a.txt) + unstaged modification (b.txt)
    write(R, 'a.txt', 'a staged\n');
    write(R, 'b.txt', 'b unstaged\n');
    shGit('add a.txt', R);

    await gitService.stashPush(R, 'phase2 keep-index');
    // After stash both tracked modifications are clean
    const cleanStatus = await gitService.status(R);
    expect(cleanStatus.files.length).toBe(0);

    // apply WITHOUT keep-index: everything lands unstaged
    await gitService.stashApply(R, 0, false);
    let st = await gitService.status(R);
    const aAfterPlain = st.files.find((f) => f.path === 'a.txt');
    expect(aAfterPlain?.index).not.toBe('M'); // split NOT restored — staged part collapsed

    // drop the applied entry, reset, stash the mess again, apply WITH keep-index
    await gitService.stashDrop(R, 0);
    shGit('checkout -q -- .', R);
    shGit('reset -q', R);
    write(R, 'a.txt', 'a staged\n');
    write(R, 'b.txt', 'b unstaged\n');
    shGit('add a.txt', R);
    await gitService.stashPush(R, 'phase2 keep-index 2');

    await gitService.stashApply(R, 0, true);
    st = await gitService.status(R);
    const aStaged = st.files.find((f) => f.path === 'a.txt');
    expect(aStaged?.index).toBe('M'); // staged split restored by --index

    // cleanup: commit the mess so the next test starts clean
    shGit('add -A', R);
    shGit('commit -qm "after apply"', R);
    // apply() KEEPS the stash entry — drop it so the next test starts clean
    await gitService.stashDrop(R, 0);
    expect((await gitService.stashList(R)).length).toBe(0);
  });

  it('stashPop(repo, 0, true) pops with --index and removes the entry', async () => {
    const R = repoStash;
    expect((await gitService.stashList(R)).length).toBe(0); // clean slate
    write(R, 'c.txt', 'pop me\n');
    shGit('add c.txt', R);
    await gitService.stashPush(R, 'phase2 pop keep-index');
    expect((await gitService.stashList(R)).length).toBe(1);

    await gitService.stashPop(R, 0, true);
    expect((await gitService.stashList(R)).length).toBe(0);

    const st = await gitService.status(R);
    const c = st.files.find((f) => f.path === 'c.txt');
    expect(c?.index).toBe('A'); // --index restored the staged state
    shGit('reset -q', R);
    shGit('checkout -q -- .', R);
    fs.rmSync(path.join(R, 'c.txt'), { force: true });
  });
});
