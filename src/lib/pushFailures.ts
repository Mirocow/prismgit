/**
 * pushFailures — classify REMOTE-side push rejections into recoverable
 * conflict kinds, so the UI can offer the user a REACTION (pull / rebase /
 * force / create MR) instead of the old transient raw-stderr toast.
 *
 * Remote-conflict audit (the remote half of «проверь всю работу с
 * конфликтами… Надо предоставить пользователю возможность реагировать»):
 * a push can be refused for reasons the USER can act on:
 *
 *   1. non-fast-forward — the remote branch moved ahead (someone else
 *      pushed, or the same branch was pushed from another machine).
 *      Recovery: pull (merge) → push, pull (rebase) → push, or force push.
 *      Real git stderr:
 *        ! [rejected]        main -> main (fetch first / non-fast-forward)
 *        error: failed to push some refs to '<url>'
 *        hint: Updates were rejected because the tip of your current branch is behind
 *
 *   2. lease-stale — `--force-with-lease` refused the rewrite: the remote
 *      moved since our last fetch, the lease is stale.
 *      Recovery: fetch → retry the same force push (or plain --force).
 *        ! [rejected]        main -> main (stale info)
 *
 *   3. protected — the SERVER refuses direct pushes to a protected branch
 *      (GitLab branch protection / GitHub protected rules, enforced via
 *      pre-receive hooks). Local `git` sees a hook decline.
 *      Recovery: create a Merge/Pull Request instead.
 *        remote: GitLab: You are not allowed to push code to a protected branch
 *        ! [remote rejected] main -> main (pre-receive hook declined)
 *        remote: error: GH006: Protected branch update failed for refs/heads/main.
 *        ! [remote rejected] main -> main (protected branch hook declined)
 *
 *   4. policy — PrismGit's OWN force-push policy (Preferences → Commands)
 *      denied the push before it ever left the machine.
 *        fatal: force-push denied by PrismGit policy — …
 *
 * Everything else (network, auth, pack errors) is 'unknown' → callers keep
 * their generic error toast; those are handled by describeNetworkError on
 * the service side.
 */
export type PushFailureKind =
  | 'non-fast-forward'
  | 'lease-stale'
  | 'protected'
  | 'policy'
  | 'unknown';

export interface PushFailureInfo {
  kind: PushFailureKind;
  /** Trimmed, size-capped git output for the details area. */
  message: string;
  /** Remote-side branch from the `! [rejected] src -> dst (reason)` line. */
  remoteBranch?: string;
}

/** `! [rejected] src -> dst (reason)` — both local and remote-side rejects. */
const REJECTED_LINE_RE = /!\s*\[(?:rejected|remote rejected)\]\s*(\S+)\s*->\s*(\S+)\s*\(([^)]+)\)/;

const LEASE_STALE_RE = /stale info|\(stale info\)/i;
const POLICY_RE = /force-push denied by PrismGit policy/i;
const PROTECTED_RE =
  /protected branch|protected ref|protected_branch|not allowed to push code|GH00[0-9]|Protected branch update failed|hook declines|pre-receive hook declined|post-receive hook declined/i;
const NON_FF_RE =
  /\(non-fast-forward\)|non-fast-forward|fetch first|behind (?:its|the) remote|Updates were rejected|diverged|(?:hint: )?(?:not possible to fast-forward|have diverged)/i;

/** Cap the raw git output embedded in the dialog (stderr can be huge). */
const MAX_RAW = 1600;

/**
 * Classify a push failure. Order matters:
 *   lease-stale → policy → protected → non-fast-forward → unknown.
 * 'stale info' is a reject REASON that coexists with generic wording, and
 * protected-branch hook declines can arrive together with non-FF hints —
 * the most SPECIFIC actionable kind wins.
 */
export function classifyPushFailure(err: unknown): PushFailureInfo {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const message = raw.trim().slice(0, MAX_RAW);
  const m = raw.match(REJECTED_LINE_RE);
  const remoteBranch = m?.[2]?.replace(/^(?:refs\/heads\/)/, '') || undefined;

  let kind: PushFailureKind = 'unknown';
  if (LEASE_STALE_RE.test(raw)) kind = 'lease-stale';
  else if (POLICY_RE.test(raw)) kind = 'policy';
  else if (PROTECTED_RE.test(raw)) kind = 'protected';
  else if (NON_FF_RE.test(raw)) kind = 'non-fast-forward';

  return { kind, message, remoteBranch };
}

/**
 * Build the "create a PR/MR" URL for a branch the server won't let us push
 * to directly. GitLab and GitHub both support pre-filled new-MR/PR pages:
 *
 *   GitLab:  {web}/-/merge_requests/new?merge_request[source_branch]=<branch>
 *   GitHub:  {web}/compare/...<branch>?expand=1   (empty base = default branch)
 *
 * Returns undefined when the remote is neither of the two supported
 * providers (or the web URL couldn't be resolved) — callers then fall back
 * to just opening the repository page.
 */
export function buildNewPullRequestUrl(
  webUrl: string | undefined,
  provider: string | undefined,
  branch: string,
): string | undefined {
  if (!webUrl || !branch) return undefined;
  const base = webUrl.replace(/\/+$/, '');
  if (provider === 'gitlab') {
    return `${base}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}`;
  }
  if (provider === 'github') {
    return `${base}/compare/...${encodeURIComponent(branch)}?expand=1`;
  }
  return undefined;
}
