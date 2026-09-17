/**
 * Centralized helpers for branch name filtering.
 *
 * Used across all UI surfaces that display / filter / pick branch names:
 *   - BranchesPage (local list, remote groups, dialog inputs)
 *   - HistoryPage (branch picker dropdown)
 *   - RefActionDialog (filtered list)
 *   - GlobalSearch (branch search results)
 *   - BranchDialogs (SetTrackedBranchDialog, PushToDialog)
 *   - DiffPage (base / compare dropdowns)
 *
 * The backend branches() in electron/services/git.ts already strips
 * symbolic HEAD refs (`if (name.endsWith('/HEAD')) continue;`), but we
 * filter again on the UI side as defense-in-depth so a cached list
 * (or a different code path) can never leak them into the UI.
 */

/**
 * True if the ref name is a symbolic HEAD pointer:
 *   - "HEAD" (bare detached)
 *   - "origin/HEAD" (remote's default branch pointer)
 *   - "github/HEAD" (same for github remote)
 *
 * These are NOT real branches — they cannot be checked out, merged,
 * rebased, pushed, or deleted. They exist purely as git's cached
 * pointer to the remote's default branch (set by `git clone` or
 * `git remote set-head`).
 */
export function isSymbolicHead(name: string): boolean {
  return name === 'HEAD' || name.endsWith('/HEAD');
}

/**
 * Filter a list of branch names, removing symbolic HEAD refs.
 * Returns a new array — does not mutate the input.
 */
export function filterSymbolicHeads<T extends { name: string }>(branches: T[]): T[] {
  return branches.filter((b) => !isSymbolicHead(b.name));
}

/**
 * Filter a list of branch-name strings, removing symbolic HEAD refs.
 * Returns a new array — does not mutate the input.
 */
export function filterSymbolicHeadNames(names: string[]): string[] {
  return names.filter((n) => !isSymbolicHead(n));
}
