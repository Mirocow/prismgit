/**
 * Refspec helpers — detect "single-branch clone" configurations.
 *
 * BUGFIX "не получаю все ветки хотя в Remotes они есть":
 * `git clone --depth N` (and any clone with an explicit --single-branch)
 * configures `remote.<name>.fetch` to cover exactly ONE branch. Every
 * later `git fetch <name>` respects that refspec, so refs/remotes/<name>/
 * only ever contains that branch — while the Remotes page (live ls-remote)
 * shows them all. The Branches page therefore looks incomplete.
 *
 * The renderer reads the refspecs via api.git.remoteFetchSpecs() and uses
 * isSingleBranchRefspec() to decide whether to offer the "Fetch all
 * branches" remediation (api.git.fetchAllBranches → git remote
 * set-branches <name> '*' + fetch).
 */

/** Escape all regex metacharacters in a literal string. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A remote is in single-branch mode when NONE of its fetch refspecs covers
 * all heads for that remote (`[+]refs/heads/*:refs/remotes/<name>/*`).
 *
 * Notes:
 *  - An empty/missing refspec list is treated as NOT single-branch: remotes
 *    created by `git remote add` start without refspecs, and the app's
 *    fetch-once flow writes the full wildcard. Nothing to remediate.
 *  - Multi-refspec configs that deliberately limit tracking (e.g. only
 *    `refs/heads/release/*`) ARE reported as single-branch — that is the
 *    same user-visible symptom (branches exist on the remote but are not
 *    fetched), and the same one-click remediation applies.
 */
export function isSingleBranchRefspec(remoteName: string, specs: string[] | undefined | null): boolean {
  if (!specs || specs.length === 0) return false;
  const full = new RegExp(`^\\+?refs/heads/\\*:refs/remotes/${escapeRegExp(remoteName)}/\\*$`);
  return !specs.some((s) => full.test(String(s).trim()));
}

/**
 * Convenience: map of remote → specs (from api.git.remoteFetchSpecs) →
 * the list of remotes whose refspec is single-branch / limited.
 */
export function singleBranchRemotes(specsByRemote: Record<string, string[]> | null | undefined): string[] {
  if (!specsByRemote) return [];
  return Object.keys(specsByRemote).filter((name) => isSingleBranchRefspec(name, specsByRemote[name]));
}
