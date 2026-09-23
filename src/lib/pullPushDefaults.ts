/**
 * Default target selection for the Push / Pull toolbar dropdowns.
 *
 * UNIFIED-STATE PRINCIPLE (user-reported bug): tools that operate on the
 * working copy must default to the CURRENTLY CHECKED-OUT branch. The global
 * UI selection (selectionStore.selectedBranch — what the user last clicked
 * in Branches/History) is a VIEW filter and must never drive operation
 * defaults: after the user browsed branch `feature/v1` there while having
 * `feature/v3` checked out, the Pull dialog pre-filled v1 and
 * `git pull origin feature/v1` merged the WRONG branch into the working
 * copy ("у инструментов нет единного состояния").
 */

/**
 * Pick the default remote branch for the Pull dropdown.
 *
 * Priority:
 *   1. `prev` — the user's explicit in-session choice (only when the dialog
 *      did NOT just (re)open — within one open session we don't fight the
 *      user's dropdown pick).
 *   2. The remote counterpart of the CURRENT checked-out branch
 *      (`origin/<current>`) — the unified-state default.
 *   3. `prev` even when the dialog just opened (detached HEAD fallback).
 *   4. First remote branch.
 *
 * @param remoteBranchNames  full names, e.g. ['origin/main', 'origin/feature/v1']
 * @param currentBranch      checked-out branch name ('main'), null if detached
 * @param prev               previously selected full name, '' initially
 * @param resetDefault       true when the dropdown (re)opened — clears the
 *                           prev-priority so a stale session pick can't win
 */
export function pickDefaultPullBranch(
  remoteBranchNames: string[],
  currentBranch: string | null | undefined,
  prev: string,
  resetDefault: boolean,
): string {
  const exists = (name: string) => remoteBranchNames.includes(name);
  // 1. Within an open session, respect the user's explicit dropdown pick.
  if (!resetDefault && prev && exists(prev)) return prev;
  // 2. The checked-out branch's remote counterpart — the default that
  //    matches the working copy the operation will act on.
  if (currentBranch) {
    // Find the remote whose branch matches — handles multi-remote repos
    // (origin/main, upstream/main): prefer the first, which is the list's
    // natural order (origin first in `git branch -r` output).
    const match = remoteBranchNames.find(
      (name) => name.includes('/') && name.slice(name.indexOf('/') + 1) === currentBranch,
    );
    if (match) return match;
  }
  // 3. Detached HEAD — keep the last pick, else 4. first remote branch.
  if (prev && exists(prev)) return prev;
  return remoteBranchNames[0] ?? '';
}

/**
 * Pick the default local branch for the Push dropdown.
 *
 * Priority:
 *   1. The CURRENT checked-out branch (what the user is actually working
 *      on — pushing anything else by default is surprising and dangerous).
 *   2. The global UI selection — only as a DETACHED-HEAD fallback, so
 *      browsing branches in the Branches page still gives a sensible
 *      default when there is no current branch to push.
 *   3. First local branch.
 */
export function pickDefaultPushBranch(
  localBranches: { name: string; current: boolean }[],
  globallySelected: string | null | undefined,
): string {
  const cur = localBranches.find((b) => b.current);
  if (cur) return cur.name;
  if (globallySelected && localBranches.some((b) => b.name === globallySelected)) {
    return globallySelected;
  }
  return localBranches[0]?.name ?? '';
}
