/**
 * PrismGit — the REMOTE-conflict half of the conflict-reaction audit.
 *
 * «расширь сам список проработав все случаи возникающие при работе с git и
 * Remote сессиями (gitlab, github)» — a push can be refused by the REMOTE
 * in ways the user can act on. Each shape is reproduced against REAL
 * repositories (a bare origin + divergent clones + a declining pre-receive
 * hook standing in for GitLab/GitHub branch protection) and the test pins
 * the contract the PushRejectionDialog reaction keys off:
 *
 *   N1. non-fast-forward — clone B is behind a moved remote branch
 *       (pushed via gitService.push — proves the error text SURVIVES the
 *       service's describeNetworkError wrapping) → classify → pull (merge)
 *       → the SAME push succeeds. The full «Стянуть и слить» recovery.
 *   S1. lease-stale — --force-with-lease refused after the remote moved
 *       again → classify → fetch → the lease check passes and the SAME
 *       force push succeeds. The full «Fetch и повторить» recovery.
 *   P1. protected — a pre-receive hook declining with the EXACT GitLab
 *       wording (stand-in for server-side branch protection, GitHub's
 *       GH006 uses the same reject shape) → classify 'protected' → the
 *       dialog's route is Create-MR, not a retry.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'node:child_process';
import { classifyPushFailure } from '../../src/lib/pushFailures';
import * as gitService from '../../electron/services/git';

vi.setConfig({ testTimeout: 30_000 });

let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-push-reject-'));
});
afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
/** Run a push EXPECTED to fail; return the combined stderr/stdout. */
function tryPush(cmd: string, cwd: string): string {
  try {
    sh(cmd, cwd);
    return '';
  } catch (e) {
    const err = e as { stderr?: string | Buffer; stdout?: string | Buffer };
    return `${String(err.stderr ?? '')}\n${String(err.stdout ?? '')}`;
  }
}
function write(repo: string, rel: string, content: string): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function commit(repo: string, message: string): string {
  sh('git add -A', repo);
  sh(`git -c user.name=T -c user.email=t@t commit -m ${JSON.stringify(message)}`, repo);
  return sh('git rev-parse HEAD', repo).trim();
}
function remoteHead(origin: string, branch: string): string {
  return sh(`git rev-parse refs/heads/${branch}`, origin).trim();
}

describe('remote push rejections — real repositories', () => {
  it('N1 non-fast-forward: gitService.push rejection classifies; pull+push recovers', async () => {
    const origin = path.join(ROOT, 'n1-origin.git');
    sh(`git init --bare -b main ${JSON.stringify(origin)}`, ROOT);
    const a = path.join(ROOT, 'n1-a');
    const b = path.join(ROOT, 'n1-b');
    sh(`git clone ${JSON.stringify(origin)} ${JSON.stringify(a)}`, ROOT);
    sh(`git clone ${JSON.stringify(origin)} ${JSON.stringify(b)}`, ROOT);

    // Seed → A pushes a commit on main; B clones-diverges with its own.
    write(a, 'seed.txt', 'seed\n');
    commit(a, 'seed');
    sh('git push origin main', a);
    write(a, 'a-change.txt', 'from A\n');
    commit(a, 'A moves ahead');
    sh('git push origin main', a);

    sh('git pull --no-rebase origin main', b); // B is now at A's push…
    write(b, 'b-change.txt', 'from B\n');
    commit(b, 'B diverges');

    // A pushes AGAIN — B's remote-tracking ref is now behind (the exact
    // «someone pushed while you worked» shape).
    write(a, 'a-again.txt', 'from A again\n');
    commit(a, 'A pushes once more');
    sh('git push origin main', a);

    // B pushes THROUGH THE SERVICE — the error text must survive
    // describeNetworkError and still classify as non-fast-forward.
    let out = '';
    try {
      await gitService.push(b, 'origin', 'main');
      throw new Error('push unexpectedly succeeded');
    } catch (e) {
      out = String(e);
    }
    const failure = classifyPushFailure(new Error(out));
    expect(failure.kind).toBe('non-fast-forward');
    expect(failure.remoteBranch).toBe('main');
    expect(out).toMatch(/fetch first|non-fast-forward|behind/);

    // The «Стянуть и слить» recovery: pull (merge) — different files, no
    // conflict — then the SAME push succeeds.
    sh('git pull --no-rebase origin main', b);
    sh('git push origin main', b);
    expect(remoteHead(origin, 'main')).toBe(sh('git rev-parse HEAD', b).trim());
  });

  it('S1 lease-stale: force-with-lease refused while stale; fetch renews the lease', () => {
    const origin = path.join(ROOT, 's1-origin.git');
    sh(`git init --bare -b main ${JSON.stringify(origin)}`, ROOT);
    const a = path.join(ROOT, 's1-a');
    const b = path.join(ROOT, 's1-b');
    sh(`git clone ${JSON.stringify(origin)} ${JSON.stringify(a)}`, ROOT);
    sh(`git clone ${JSON.stringify(origin)} ${JSON.stringify(b)}`, ROOT);

    write(a, 'seed.txt', 'seed\n');
    commit(a, 'seed');
    sh('git push origin main', a);

    sh('git pull --no-rebase origin main', b);
    write(b, 'b.txt', 'b rewrites history\n');
    commit(b, 'B rewrite');
    sh('git commit --amend -m "B rewrite (amended)" --no-edit', b);

    // A lands ANOTHER commit after B's last fetch → B's lease is stale.
    write(a, 'a-new.txt', 'a moved on\n');
    commit(a, 'A moves the remote');
    sh('git push origin main', a);

    const out = tryPush('git push --force-with-lease origin main', b);
    expect(out).toMatch(/stale info/);
    expect(classifyPushFailure(out).kind).toBe('lease-stale');

    // The «Fetch и повторить» recovery: fetch refreshes the remote-tracking
    // ref — the lease check passes and the same force push lands.
    sh('git fetch origin', b);
    sh('git push --force-with-lease origin main', b);
    expect(remoteHead(origin, 'main')).toBe(sh('git rev-parse HEAD', b).trim());
  });

  it('P1 protected: a declining pre-receive hook (GitLab wording) classifies as protected', () => {
    const origin = path.join(ROOT, 'p1-origin.git');
    sh(`git init --bare -b main ${JSON.stringify(origin)}`, ROOT);
    // Stand in for GitLab/GitHub branch protection: the hook declines with
    // the exact server wording git prints on a protected-branch push.
    const hook = path.join(origin, 'hooks', 'pre-receive');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, [
      '#!/bin/sh',
      'echo "remote: GitLab: You are not allowed to push code to a protected branch on this project." >&2',
      'exit 1',
      '',
    ].join('\n'));
    fs.chmodSync(hook, 0o755);

    const c = path.join(ROOT, 'p1-c');
    sh(`git clone ${JSON.stringify(origin)} ${JSON.stringify(c)}`, ROOT);
    write(c, 'change.txt', 'cannot land directly\n');
    commit(c, 'direct push attempt');

    const out = tryPush('git push origin main', c);
    expect(out).toMatch(/pre-receive hook declined/);
    expect(out).toMatch(/not allowed to push code/);
    const failure = classifyPushFailure(out);
    expect(failure.kind).toBe('protected');
    expect(failure.remoteBranch).toBe('main');
    // The dialog offers Create-MR for this kind — nothing was pushed (the
    // bare origin has NO refs at all; for-each-ref prints nothing).
    expect(sh('git for-each-ref refs/heads', origin).trim()).toBe('');
  });

  it('the classifier eats the REAL GitHub GH006 shape too', () => {
    const githubShape = [
      'remote: error: GH006: Protected branch update failed for refs/heads/main.',
      'remote: error: Cannot delete a protected branch',
      'To https://github.com/owner/repo.git',
      ' ! [remote rejected] main -> main (protected branch hook declines)',
      'error: failed to push some refs to \'https://github.com/owner/repo.git\'',
    ].join('\n');
    expect(classifyPushFailure(githubShape).kind).toBe('protected');
  });
});
