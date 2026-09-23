/**
 * Incoming-commits computation for the History graph.
 *
 * "Incoming" = commits that exist on the remote-tracking side but are NOT in
 * the local branch yet (VS Code / GitKraken draw them dashed+dimmed with a
 * "↓ incoming" badge so the user can see what Pull would bring in).
 *
 * Two scopes exist:
 *
 * 1. `head+upstream` view — `git rev-list <local>..<upstream>`
 *    Commits reachable from the upstream but not from the CURRENT branch.
 *    This is the view-accurate set: it answers "what does Pull bring into
 *    MY branch" regardless of what other local branches contain.
 *
 *    IMPORTANT — why not always use the global set (see 2): the global set
 *    is CONTAMINATED whenever ANY other local branch already contains the
 *    remote commits (a backup branch created after a reset, a feature
 *    branch that shares history, a second worktree, …). It then silently
 *    returns EMPTY and the incoming commits render as plain local history
 *    — exactly the user-reported bug: "after `git reset --hard` the remote
 *    commits still show as if they are merged into the local branch".
 *
 * 2. Everything else (`all` / single-branch views) — the global set:
 *    `git rev-list --remotes --not --branches` = commits reachable from any
 *    remote-tracking ref but from NO local branch. Here the global semantics
 *    are what the view shows, so contamination is not a factor.
 */

export type IncomingScope =
  | { mode: 'head+upstream'; currentBranch?: string | null; upstream?: string | null }
  | { mode: 'global' };

/**
 * Build the `git rev-list` argv that yields the incoming commit set for the
 * given scope. Returns the args for `api.git.raw(repoPath, args)`.
 */
export function incomingRevListArgs(scope: IncomingScope): string[] {
  if (
    scope.mode === 'head+upstream' &&
    scope.currentBranch &&
    scope.upstream &&
    scope.upstream !== scope.currentBranch
  ) {
    // `A..B` = reachable from B, not reachable from A → exactly the
    // commits the upstream has that the local branch lacks.
    return ['rev-list', `${scope.currentBranch}..${scope.upstream}`];
  }
  // Global scope, or head+upstream with a missing side (detached HEAD with
  // no upstream, local-only branch, …) — fall back to the global set.
  return ['rev-list', '--remotes', '--not', '--branches'];
}

/** Parse raw `git rev-list` output into a Set of commit hashes. */
export function parseRevList(raw: string): Set<string> {
  const out = new Set<string>();
  for (const line of raw.trim().split('\n')) {
    const h = line.trim();
    if (h) out.add(h);
  }
  return out;
}
