/**
 * Ancestry resolver for filtered git history graph.
 *
 * Adapted from PlatypusGit's `src/features/commits/graphAncestry.ts`.
 *
 * Problem:
 *   When the user applies a filter (search, author, date) to the commit list,
 *   some commits become hidden. But their children's `parents[]` still point to
 *   their original parents (now hidden). The lane-assignment algorithm would
 *   then wait for a parent that never arrives, drawing phantom lanes to the
 *   bottom of the visible list.
 *
 * Solution:
 *   For each commit's parents, find the nearest visible ancestor via BFS.
 *   If found, the lane "rewires" to that ancestor with `elided: true` flag —
 *   drawn as a dashed line, signalling "there were commits here, but they
 *   are filtered out".
 *
 *   If the BFS exhausts all known ancestry without finding a visible commit,
 *   the parent is treated as `truncated` — the node gets a `truncated` flag
 *   and the lane ends at this node (it has no visible continuation).
 *
 * Memoization:
 *   `nearestVisible` and `resolve` are memoized per (oid) — same oid always
 *   resolves to the same result within one resolution pass.
 */

import type { LogEntry } from '../../electron/types/git-api';

export interface ResolvedParent {
  /** OID of the visible ancestor (or the original if not elided). */
  oid: string;
  /** True if the parent was hidden and we rewired to a further ancestor. */
  elided: boolean;
}

export interface ResolvedAncestry {
  /** For a commit, returns the list of resolved parents (possibly with `elided: true`). */
  resolve: (oid: string) => ResolvedParent[];
  /**
   * For a commit, returns whether ALL of its true parents are out of the visible window.
   * (Used to mark the node as `truncated`.)
   */
  isTruncated: (oid: string) => boolean;
}

/**
 * Build an ancestry resolver.
 *
 * @param visibleCommits The list of commits currently visible (post-filter).
 * @param ancestry      The full ancestry map (oid → parents[]) — includes ALL commits,
 *                      even hidden ones, so BFS can walk through them.
 */
export function createAncestryResolver(
  visibleCommits: LogEntry[],
  ancestry: LogEntry[],
): ResolvedAncestry {
  const visible = new Set(visibleCommits.map(c => c.hash));
  const parentsOf = new Map<string, string[]>();
  for (const c of ancestry) {
    parentsOf.set(c.hash, c.parents);
  }

  const nearestMemo = new Map<string, ResolvedParent | null>();
  const resolveMemo = new Map<string, ResolvedParent[]>();
  const truncatedMemo = new Map<string, boolean>();

  /**
   * BFS from `start` upward through ancestors, returning the first commit
   * that is in `visible`. Returns null if none found within the ancestry map.
   */
  function nearestVisible(start: string): ResolvedParent | null {
    const cached = nearestMemo.get(start);
    if (cached !== undefined) return cached;

    // If start itself is visible, it's its own nearest visible ancestor (no elision).
    if (visible.has(start)) {
      const result: ResolvedParent = { oid: start, elided: false };
      nearestMemo.set(start, result);
      return result;
    }

    // BFS upward through parents
    const queue: string[] = [start];
    const seen = new Set<string>([start]);
    let found: ResolvedParent | null = null;

    search: while (queue.length > 0) {
      const cur = queue.shift()!;
      const parents = parentsOf.get(cur);
      if (!parents) continue; // outside the loaded window
      for (const p of parents) {
        if (visible.has(p)) {
          found = { oid: p, elided: true };
          break search;
        }
        if (!seen.has(p)) {
          seen.add(p);
          queue.push(p);
        }
      }
    }

    nearestMemo.set(start, found);
    return found;
  }

  /**
   * Resolve all parents of a commit: each parent is mapped to its nearest visible ancestor.
   * Duplicate resolved parents are deduplicated (two true parents may map to the same
   * visible ancestor — the node remains a merge based on the number of TRUE parents).
   */
  function resolve(oid: string): ResolvedParent[] {
    const cached = resolveMemo.get(oid);
    if (cached) return cached;

    const trueParents = parentsOf.get(oid) ?? [];
    const result: ResolvedParent[] = [];
    const seen = new Set<string>();

    for (const p of trueParents) {
      const nearest = nearestVisible(p);
      if (nearest && !seen.has(nearest.oid)) {
        seen.add(nearest.oid);
        result.push(nearest);
      }
    }

    resolveMemo.set(oid, result);
    return result;
  }

  /**
   * A commit is "truncated" if it has parents but none of them resolve to a visible
   * ancestor within the loaded ancestry map.
   */
  function isTruncated(oid: string): boolean {
    const cached = truncatedMemo.get(oid);
    if (cached !== undefined) return cached;

    const trueParents = parentsOf.get(oid) ?? [];
    if (trueParents.length === 0) {
      truncatedMemo.set(oid, false);
      return false;
    }

    // Check if ANY true parent resolves to a visible ancestor
    const resolved = resolve(oid);
    const result = resolved.length === 0;
    truncatedMemo.set(oid, result);
    return result;
  }

  return { resolve, isTruncated };
}
