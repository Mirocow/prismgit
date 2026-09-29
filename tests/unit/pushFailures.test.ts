/**
 * pushFailures — classifier unit tests.
 *
 * Every fixture is a REAL git / GitLab / GitHub stderr transcript (trimmed)
 * captured from the matching rejection scenario; the integration suite
 * (pushRejectionScenarios.test.ts) reproduces N1/S1/P1 against live
 * repositories, these tests pin the classification CONTRACT.
 */
import { describe, it, expect } from 'vitest';
import { classifyPushFailure, buildNewPullRequestUrl } from '../../src/lib/pushFailures';

const NON_FF_STDERR = `To http://178.140.10.58:8082/web/git/gitclient.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'http://178.140.10.58:8082/web/git/gitclient.git'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart. If you wish to integrate the remote changes,
hint: use 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.`;

const NON_FF_HINTLESS = `To origin
 ! [rejected]        feature/x -> feature/x (non-fast-forward)
error: failed to push some refs to 'origin'`;

const LEASE_STALE_STDERR = `To origin
 ! [rejected]        main -> main (stale info)
error: failed to push some refs to 'origin'`;

const GITLAB_PROTECTED_STDERR = `remote: GitLab: You are not allowed to push code to a protected branch on this project.
To http://178.140.10.58:8082/web/git/gitclient.git
 ! [remote rejected] main -> main (pre-receive hook declined)
error: failed to push some refs to 'http://178.140.10.58:8082/web/git/gitclient.git'`;

const GITHUB_PROTECTED_STDERR = `remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: error: Cannot force-push to this protected branch
To https://github.com/owner/repo.git
 ! [remote rejected] main -> main (protected branch hook declines)
error: failed to push some refs to 'https://github.com/owner/repo.git'`;

const POLICY_ERROR = `fatal: force-push denied by PrismGit policy — branch 'main' is protected by the local policy (Preferences → Commands → Force Push Policy)`;

const NETWORK_ERROR = `fatal: unable to access 'http://178.140.10.58:8082/web/git/gitclient.git/': Failed to connect to 178.140.10.58 port 8082: Connection refused`;

describe('classifyPushFailure', () => {
  it('non-fast-forward — "fetch first" reject + hint wording', () => {
    const f = classifyPushFailure(new Error(NON_FF_STDERR));
    expect(f.kind).toBe('non-fast-forward');
    expect(f.remoteBranch).toBe('main');
    expect(f.message).toContain('Updates were rejected');
  });

  it('non-fast-forward — "(non-fast-forward)" reject without hints', () => {
    const f = classifyPushFailure(NON_FF_HINTLESS);
    expect(f.kind).toBe('non-fast-forward');
    expect(f.remoteBranch).toBe('feature/x');
  });

  it('lease-stale — force-with-lease refusal wins over generic wording', () => {
    const f = classifyPushFailure(new Error(LEASE_STALE_STDERR));
    expect(f.kind).toBe('lease-stale');
    expect(f.remoteBranch).toBe('main');
  });

  it('protected — GitLab pre-receive hook decline', () => {
    const f = classifyPushFailure(new Error(GITLAB_PROTECTED_STDERR));
    expect(f.kind).toBe('protected');
    expect(f.remoteBranch).toBe('main');
  });

  it('protected — GitHub GH006 protected-branch hook decline', () => {
    const f = classifyPushFailure(GITHUB_PROTECTED_STDERR);
    expect(f.kind).toBe('protected');
    expect(f.remoteBranch).toBe('main');
  });

  it('protected beats non-fast-forward when both appear (hook rewrites + FF)', () => {
    const both = `${GITLAB_PROTECTED_STDERR}\nhint: Updates were rejected because the tip of your current branch is behind`;
    expect(classifyPushFailure(both).kind).toBe('protected');
  });

  it('policy — the local PrismGit force-push gate', () => {
    const f = classifyPushFailure(new Error(POLICY_ERROR));
    expect(f.kind).toBe('policy');
    expect(f.remoteBranch).toBeUndefined();
  });

  it('unknown — plain network failures are NOT remote conflicts', () => {
    const f = classifyPushFailure(new Error(NETWORK_ERROR));
    expect(f.kind).toBe('unknown');
  });

  it('unknown — auth failures stay out of the dialog', () => {
    expect(classifyPushFailure('remote: HTTP Basic: Access denied').kind).toBe('unknown');
  });

  it('caps the raw message so the dialog stays readable', () => {
    const f = classifyPushFailure('x'.repeat(10_000));
    expect(f.message.length).toBeLessThanOrEqual(1600);
  });

  it('strips refs/heads/ from the rejected branch name', () => {
    const f = classifyPushFailure(' ! [rejected] HEAD -> refs/heads/main (fetch first)');
    expect(f.remoteBranch).toBe('main');
  });
});

describe('buildNewPullRequestUrl', () => {
  it('GitLab — pre-filled new merge request page', () => {
    expect(buildNewPullRequestUrl('http://gitlab.example.com/group/repo', 'gitlab', 'feature/x'))
      .toBe('http://gitlab.example.com/group/repo/-/merge_requests/new?merge_request[source_branch]=feature%2Fx');
  });

  it('GitHub — compare page with the branch as head (empty base = default)', () => {
    expect(buildNewPullRequestUrl('https://github.com/owner/repo/', 'github', 'feature/x'))
      .toBe('https://github.com/owner/repo/compare/...feature%2Fx?expand=1');
  });

  it('unknown provider / missing URL → undefined (caller opens the repo page)', () => {
    expect(buildNewPullRequestUrl('https://bitbucket.org/owner/repo', 'bitbucket', 'x')).toBeUndefined();
    expect(buildNewPullRequestUrl(undefined, 'gitlab', 'x')).toBeUndefined();
    expect(buildNewPullRequestUrl('https://gitlab.com/a/b', 'gitlab', '')).toBeUndefined();
  });
});
