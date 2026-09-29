/**
 * PrismGit — integration coverage for squashToBranch (History tool).
 *
 * "Выделение группы коммитов и отправка их в другую ветку одним сквошем":
 *   - FAST PATH (merge-tree + commit-tree + update-ref): no checkout, no
 *     worktree impact, atomic CAS, preserved author.
 *   - Conflict dry-run → 'conflicts-preview' (repo completely untouched),
 *     then proceedOnConflict → live route (carrier cherry-pick) reusing the
 *     cherry-pick resolve flow (Continue commits with message AND author).
 *   - New branch creation (range base / explicit base), validation refusals
 *     (gaps, merge-spanning, current branch, existing name).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as gitService from '../../electron/services/git';

vi.setConfig({ testTimeout: 30_000 });

let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-squashbranch-'));
});

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

function write(repo: string, rel: string, content: string): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

async function commit(repo: string, message: string): Promise<string> {
  await gitService.addAll(repo);
  await gitService.commit(repo, message);
  return (await gitService.revParse(repo, 'HEAD')).trim();
}

/** branch 'dev' with range commits r1..r3 on top of seed, 'main' kept at seed. */
async function rangeRepo(name: string): Promise<{ repo: string; seed: string; r1: string; r2: string; r3: string }> {
  const repo = path.join(ROOT, name);
  fs.mkdirSync(repo, { recursive: true });
  await gitService.init(repo, false);
  await gitService.configSet(repo, 'user.name', 'Range Author', 'local');
  await gitService.configSet(repo, 'user.email', 'range@author.dev', 'local');
  write(repo, 'a.txt', 'seed\n');
  const seed = await commit(repo, 'seed');
  // Branch dev off seed; the OTHER branch (master/main) stays at seed.
  const defaultBranch = (await gitService.raw(repo, ['symbolic-ref', '--short', 'HEAD'])).trim();
  await gitService.raw(repo, ['branch', 'base', defaultBranch]);
  await gitService.raw(repo, ['checkout', '-q', '-b', 'dev']);
  write(repo, 'x.txt', 'x0\n');
  const r1 = await commit(repo, 'r1');
  write(repo, 'x.txt', 'x1\n');
  const r2 = await commit(repo, 'r2');
  write(repo, 'x.txt', 'x1\nx2\n');
  const r3 = await commit(repo, 'r3');
  return { repo, seed, r1, r2, r3 };
}

  async function conflictingRepo(name: string): Promise<{ repo: string; r1: string; r2: string; r3: string }> {
    const { repo, r1, r2, r3 } = await rangeRepo(`conf-${name}`);
    // Make 'base' modify the SAME file the range touches → guaranteed conflict.
    await gitService.raw(repo, ['checkout', '-q', 'base']);
    write(repo, 'x.txt', 'conflicting base content\n');
    await commit(repo, 'base conflict');
    await gitService.raw(repo, ['checkout', '-q', 'dev']);
    return { repo, r1, r2, r3 };
  }

describe('squashToBranch — FAST PATH (existing branch, clean apply)', () => {
  it('carries the range as ONE commit, preserves the author, never touches the worktree', async () => {
    const { repo, seed, r1, r2, r3 } = await rangeRepo('fast-existing');
    // 'base' is at the seed; worktree is on dev with x.txt present.
    const before = fs.readFileSync(path.join(repo, 'x.txt'), 'utf8');

    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'base' },
      message: 'carried work (squash)',
    });

    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    // ONE new commit on 'base', parented at the seed, tree == newest's tree.
    expect((await gitService.raw(repo, ['rev-list', '--count', 'base'])).trim()).toBe('2');
    expect((await gitService.raw(repo, ['log', '-1', '--format=%P', 'base'])).trim()).toBe(seed);
    expect((await gitService.raw(repo, ['log', '-1', '--format=%s', 'base'])).trim()).toBe('carried work (squash)');
    // Author preserved (name/email/DATE of the OLDEST commit).
    expect((await gitService.raw(repo, ['log', '-1', '--format=%an <%ae>', 'base'])).trim())
      .toBe('Range Author <range@author.dev>');
    const aDates = (await gitService.raw(repo, ['log', '--format=%aI', `base~1..base`])).trim().split('\n');
    expect(aDates).toHaveLength(1);
    // The worktree/HEAD is COMPLETELY untouched: still on dev, same content.
    expect((await gitService.raw(repo, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe('dev');
    expect(fs.readFileSync(path.join(repo, 'x.txt'), 'utf8')).toBe(before);
    const st = await gitService.status(repo);
    expect(st.current).toBe('dev');
    expect(st.files.length).toBe(0);
    // dev itself is unchanged.
    expect((await gitService.raw(repo, ['rev-list', '--count', 'dev'])).trim()).toBe('4');
  });

  it('keeps the current branch checked out (switchToTarget defaults to false for existing branches)', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('fast-noswitch');
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'base' },
      message: 'no switch',
    });
    expect(res.status).toBe('ok');
    expect((await gitService.raw(repo, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe('dev');
  });

  it('reports empty when the target already contains the changes', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('fast-empty');
    // Carry the range to a new branch first, then carry the SAME range to
    // that same branch again → tree identical → 'empty'.
    const first = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'new', name: 'carrier', base: 'range-base' },
      message: 'carried',
      switchToTarget: false,
    });
    expect(first.status).toBe('ok');
    const again = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'carrier' },
      message: 'again',
    });
    expect(again.status).toBe('empty');
    // No extra commit was added.
    expect((await gitService.raw(repo, ['rev-list', '--count', 'carrier'])).trim()).toBe('2');
  });
});

describe('squashToBranch — NEW branch', () => {
  it('creates the branch at the range base with exactly the squashed commit', async () => {
    const { repo, seed, r1, r2, r3 } = await rangeRepo('new-rangebase');
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'new', name: 'release/one' },
      message: 'one squashed commit',
    });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.switchedTo).toBe('release/one'); // new branches switch by default
    expect((await gitService.raw(repo, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe('release/one');
    expect((await gitService.raw(repo, ['rev-list', '--count', 'release/one'])).trim()).toBe('2');
    expect((await gitService.raw(repo, ['log', '-1', '--format=%P', 'release/one'])).trim()).toBe(seed);
    // Tree == newest commit's tree (the whole range content).
    const newestTree = (await gitService.raw(repo, ['rev-parse', `${r3}^{tree}`])).trim();
    const branchTree = (await gitService.raw(repo, ['rev-parse', 'release/one^{tree}'])).trim();
    expect(branchTree).toBe(newestTree);
    // Author preserved.
    expect((await gitService.raw(repo, ['log', '-1', '--format=%an', 'release/one'])).trim()).toBe('Range Author');
  });

  it('new branch from an EXPLICIT base resolves that ref', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('new-explicitbase');
    // Extra commit on base so the fork point differs from the range base.
    await gitService.raw(repo, ['checkout', '-q', 'base']);
    write(repo, 'b.txt', 'b\n');
    const bTip = await commit(repo, 'base extra');
    await gitService.raw(repo, ['checkout', '-q', 'dev']);
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'new', name: 'fork', base: 'base' },
      message: 'forked squash',
      switchToTarget: false,
    });
    expect(res.status).toBe('ok');
    expect((await gitService.raw(repo, ['log', '-1', '--format=%P', 'fork'])).trim()).toBe(bTip);
  });

  it('refuses an already-existing branch name', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('new-exists');
    await expect(gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'new', name: 'dev' },
      message: 'x',
    })).rejects.toThrow(/already exists/i);
  });

  it('refuses an invalid branch name', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('new-invalid');
    await expect(gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'new', name: 'bad..name' },
      message: 'x',
    })).rejects.toThrow(/invalid branch name/i);
  });

  it('supports a ROOT-commit range on a new branch (no parent)', async () => {
    // A fresh repo: the very first commits are the range.
    const repo = path.join(ROOT, 'new-root');
    fs.mkdirSync(repo, { recursive: true });
    await gitService.init(repo, false);
    await gitService.configSet(repo, 'user.name', 'Root Author', 'local');
    await gitService.configSet(repo, 'user.email', 'root@author.dev', 'local');
    write(repo, 'r.txt', 'one\n');
    const c1 = await commit(repo, 'root one');
    write(repo, 'r.txt', 'one\ntwo\n');
    const c2 = await commit(repo, 'root two');
    const res = await gitService.squashToBranch(repo, {
      commits: [c1, c2],
      target: { kind: 'new', name: 'fresh', base: 'range-base' },
      message: 'root squash',
      switchToTarget: false,
    });
    expect(res.status).toBe('ok');
    // The branch's single commit is a ROOT commit (no parent) with c2's tree.
    expect((await gitService.raw(repo, ['rev-list', '--count', 'fresh'])).trim()).toBe('1');
    const parents = (await gitService.raw(repo, ['log', '-1', '--format=%P', 'fresh'])).trim();
    expect(parents).toBe('');
    expect((await gitService.raw(repo, ['rev-parse', 'fresh^{tree}'])).trim())
      .toBe((await gitService.raw(repo, ['rev-parse', `${c2}^{tree}`])).trim());
  });
});

describe('squashToBranch — CONFLICTS', () => {

  it('dry-run returns conflicts-preview WITHOUT touching the repository', async () => {
    const { repo, r1, r2, r3 } = await conflictingRepo('preview');
    const baseBefore = (await gitService.revParse(repo, 'base')).trim();
    const headBefore = (await gitService.raw(repo, ['symbolic-ref', '--short', 'HEAD'])).trim();
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'base' },
      message: 'will conflict',
    });
    expect(res.status).toBe('conflicts-preview');
    if (res.status !== 'conflicts-preview') return;
    expect(res.conflicts).toContain('x.txt');
    // NOTHING changed: same branch tip, same HEAD, no cherry-pick state.
    expect((await gitService.revParse(repo, 'base')).trim()).toBe(baseBefore);
    expect((await gitService.raw(repo, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe(headBefore);
    expect(fs.existsSync(path.join(repo, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
  });

  it('proceedOnConflict runs the live route: conflicts land in the worktree and Continue finishes the squash', async () => {
    const { repo, r1, r2, r3 } = await conflictingRepo('live');
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'base' },
      message: 'resolved squash',
      proceedOnConflict: true,
    });
    expect(res.status).toBe('conflicts');
    if (res.status !== 'conflicts') return;
    expect(res.conflicts).toContain('x.txt');
    // We are ON the target branch, in cherry-pick state with conflict markers.
    expect((await gitService.raw(repo, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe('base');
    expect(fs.existsSync(path.join(repo, '.git', 'CHERRY_PICK_HEAD'))).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'x.txt'), 'utf8')).toContain('<<<<<<<');
    // Resolve + Continue — the standard cherry-pick flow.
    write(repo, 'x.txt', 'resolved by hand\n');
    await gitService.addAll(repo);
    await gitService.cherryPickContinue(repo);
    // ONE squashed commit on base with the message AND the preserved author.
    expect((await gitService.raw(repo, ['log', '-1', '--format=%s', 'base'])).trim()).toBe('resolved squash');
    expect((await gitService.raw(repo, ['log', '-1', '--format=%an', 'base'])).trim()).toBe('Range Author');
    expect(fs.existsSync(path.join(repo, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
    // dev is untouched.
    expect((await gitService.raw(repo, ['rev-list', '--count', 'dev'])).trim()).toBe('4');
  });

  it('live route to a NEW branch forks it at the base and picks onto it', async () => {
    const { repo, r1, r2, r3 } = await conflictingRepo('live-new');
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'new', name: 'target-new', base: 'base' },
      message: 'new branch squash',
      proceedOnConflict: true,
    });
    expect(res.status).toBe('conflicts');
    write(repo, 'x.txt', 'resolved 2\n');
    await gitService.addAll(repo);
    await gitService.cherryPickContinue(repo);
    expect((await gitService.raw(repo, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe('target-new');
    expect((await gitService.raw(repo, ['log', '-1', '--format=%s', 'target-new'])).trim()).toBe('new branch squash');
  });

  it('abandoning the live route restores the target branch', async () => {
    const { repo, r1, r2, r3 } = await conflictingRepo('live-abort');
    const baseBefore = (await gitService.revParse(repo, 'base')).trim();
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'base' },
      message: 'abort me',
      proceedOnConflict: true,
    });
    expect(res.status).toBe('conflicts');
    await gitService.cherryPickAbort(repo);
    expect((await gitService.revParse(repo, 'base')).trim()).toBe(baseBefore);
    expect(fs.existsSync(path.join(repo, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
    const st = await gitService.status(repo);
    expect(st.files.length).toBe(0);
  });
});

describe('squashToBranch — validation refusals', () => {
  it('refuses a selection with gaps (not contiguous)', async () => {
    const { repo, r1, r3 } = await rangeRepo('refuse-gap');
    // [r1, r3] skips r2 — span count (3) ≠ n (2).
    await expect(gitService.squashToBranch(repo, {
      commits: [r1, r3],
      target: { kind: 'new', name: 'x1' },
      message: 'x',
    })).rejects.toThrow(/contiguous/i);
  });

  it('refuses selections that span a merge commit', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('refuse-merge');
    // Diverge 'base' first so the merge is a REAL merge commit.
    await gitService.raw(repo, ['checkout', '-q', 'base']);
    write(repo, 'b.txt', 'b\n');
    await commit(repo, 'base extra');
    await gitService.raw(repo, ['checkout', '-q', 'dev']);
    await gitService.raw(repo, ['merge', '--no-ff', '-m', 'merge base into dev', 'base']);
    const tip = (await gitService.revParse(repo, 'HEAD')).trim();
    await expect(gitService.squashToBranch(repo, {
      commits: [r1, r2, r3, tip],
      target: { kind: 'new', name: 'x2' },
      message: 'x',
    })).rejects.toThrow(/contiguous|merge/i);
  });

  it('refuses the CURRENT branch as the target', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('refuse-current');
    await expect(gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'dev' },
      message: 'x',
    })).rejects.toThrow(/current branch/i);
  });

  it('refuses an unknown target branch', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('refuse-unknown');
    await expect(gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'no-such-branch' },
      message: 'x',
    })).rejects.toThrow(/not found/i);
  });

  it('refuses while another cherry-pick is in progress', async () => {
    const { repo, r1, r2, r3 } = await conflictingRepo('refuse-inprogress');
    // Start a conflicting pick to leave the repo in sequencer state.
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'base' },
      message: 'first',
      proceedOnConflict: true,
    });
    expect(res.status).toBe('conflicts');
    await expect(gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'new', name: 'x3' },
      message: 'second',
    })).rejects.toThrow(/another operation/i);
    await gitService.cherryPickAbort(repo);
  });
});

describe('squashToBranch — options', () => {
  it('keepAuthor=false uses the committer identity', async () => {
    const { repo, r1, r2, r3 } = await rangeRepo('keepauthor-false');
    // Change the repo identity AFTER the range commits were created.
    await gitService.configSet(repo, 'user.name', 'Committer Person', 'local');
    await gitService.configSet(repo, 'user.email', 'committer@person.dev', 'local');
    const res = await gitService.squashToBranch(repo, {
      commits: [r1, r2, r3],
      target: { kind: 'existing', branch: 'base' },
      message: 'no author keep',
      keepAuthor: false,
    });
    expect(res.status).toBe('ok');
    expect((await gitService.raw(repo, ['log', '-1', '--format=%an <%ae>', 'base'])).trim())
      .toBe('Committer Person <committer@person.dev>');
  });
});
