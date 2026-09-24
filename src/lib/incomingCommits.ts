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

/** Runner shape of `api.git.raw` — injected so tests can stub it. */
export type RawRunner = (repoPath: string, args: string[]) => Promise<string>;

/**
 * ONE `git for-each-ref --format=%(refname)` call that lists every ref in
 * the repo (heads, remotes, tags) — used to validate refs BEFORE running a
 * `rev-list A..B` that would die with
 *   "fatal: ambiguous argument 'v2..origin/v2': unknown revision…"
 * when the upstream ref is `[gone]` (deleted on the remote) or was never
 * fetched.
 *
 * The argv is deliberately IDENTICAL to the one used by the main-process
 * `log()` branch validation, so both callers hit the SAME 1s-TTL meta-cache
 * entry in the read-coalescing layer — effectively one subprocess serves
 * the whole History-page load (log validation + incoming check).
 */
const REF_LIST_ARGS = ['for-each-ref', '--format=%(refname)'];

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

/** Parse `for-each-ref --format=%(refname)` output into a Set of full refnames. */
export function parseRefNames(raw: string): Set<string> {
  const out = new Set<string>();
  for (const line of raw.split('\n')) {
    const r = line.trim();
    if (r) out.add(r);
  }
  return out;
}

/**
 * Does `ref` (given in the short form used across the app: `main`,
 * `origin/main`, `v1.0`, or a full `refs/…` name) resolve to a ref in
 * `refNames` — the set of ALL refs from `for-each-ref --format=%(refname)`?
 */
export function refExists(ref: string, refNames: Set<string>): boolean {
  return (
    refNames.has(ref) ||
    refNames.has(`refs/heads/${ref}`) ||
    refNames.has(`refs/remotes/${ref}`) ||
    refNames.has(`refs/tags/${ref}`)
  );
}

/**
 * Compute the incoming-commit hash set for the History graph.
 *
 * Wraps `incomingRevListArgs` with REF VALIDATION: in head+upstream mode the
 * two refs of `<current>..<upstream>` are checked against the repo's actual
 * ref list first. When either side does not exist (the classic case: the
 * branch config still points at an upstream whose remote ref was deleted →
 * git status reports `tracking: 'origin/v2'` while `refs/remotes/origin/v2`
 * is gone), the result is an EMPTY set — there is nothing to pull from a
 * deleted branch — instead of a fatal rev-list error.
 *
 * The validation costs ONE `for-each-ref` subprocess, which is TTL-cached in
 * the main process (meta read) and shared with `log()`'s branch validation
 * when both run on the same History load.
 */
export async function fetchIncomingHashes(
  repoPath: string,
  scope: IncomingScope,
  raw: RawRunner,
): Promise<Set<string>> {
  const args = incomingRevListArgs(scope);
  if (
    scope.mode === 'head+upstream' &&
    args.length === 2 &&
    args[1].includes('..')
  ) {
    const [left, right] = args[1].split('..');
    try {
      const refNames = parseRefNames(await raw(repoPath, REF_LIST_ARGS));
      if (!refExists(left, refNames) || !refExists(right, refNames)) {
        // Upstream (or local branch) gone → nothing incoming for this view.
        return new Set();
      }
    } catch {
      // for-each-ref itself failed — fall through and let rev-list decide;
      // the renderer's catch handler treats that as empty as well.
    }
  }
  return parseRevList(await raw(repoPath, args));
}
