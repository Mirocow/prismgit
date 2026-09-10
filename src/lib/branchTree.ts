/**
 * Branch tree with chain-compression (Fork / IntelliJ style).
 *
 * Adapted from PlatypusGit's `src/features/branches/branchTree.ts`.
 *
 * Problem:
 *   Branches like `feat/foo/bar/baz` rendered naively as nested tree would create
 *   4 levels of nesting with only 1 child at each level. Visually noisy.
 *
 * Solution:
 *   Walk the tree; for any non-branch node with exactly one child, merge the child
 *   label into the parent label with `/`. So `feat` (single child `foo` (single
 *   child `bar` (single child `baz`))) becomes a single row `feat/foo/bar/baz`.
 *
 * Output:
 *   A FLAT list of rows, each with a `depth` (nesting level after compression),
 *   `name` (full branch name), and `label` (compressed display label).
 *
 * NOTE: the function is PURE — it takes branch names and returns a list of rows.
 * The Branches UI can map each row back to its branch info by `name`.
 */

export interface BranchTreeRow {
  /** Full branch name (e.g. "feat/foo/bar") — undefined for folder-only rows. */
  name?: string;
  /** Compressed display label (e.g. "foo/bar" if parent folder is "feat"). */
  label: string;
  /** Nesting depth after compression (0 = top-level). */
  depth: number;
  /** True if this row is an actual branch (leaf or branch-with-children), false if it's just a folder. */
  isBranch: boolean;
  /** True if this row has child rows (folder or branch-with-children). */
  hasChildren: boolean;
  /** Full path prefix up to (but not including) this row, used for nesting visualization. */
  parentPath: string;
}

interface RawNode {
  label: string;
  /** Full branch name if this node IS a branch (last segment matches a real branch), undefined otherwise. */
  branch?: string;
  children: Map<string, RawNode>;
}

/**
 * Build a tree from a list of branch names, then compress chains.
 *
 * @param branchNames Full branch names, e.g. ["main", "feature/auth", "feature/api", "release/v2.0"]
 * @returns Flat list of tree rows (depth-first traversal)
 */
export function buildBranchTree(branchNames: string[]): BranchTreeRow[] {
  if (branchNames.length === 0) return [];

  // 1. Build raw tree from path segments
  const root: RawNode = { label: '', children: new Map() };

  for (const name of branchNames) {
    const segments = name.split('/').filter(s => s !== '');
    // Normalize: collapse multiple slashes
    const normalizedName = segments.join('/');
    let cur = root;
    let path = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      path = path ? `${path}/${seg}` : seg;
      if (!cur.children.has(seg)) {
        cur.children.set(seg, { label: seg, children: new Map() });
      }
      cur = cur.children.get(seg)!;
      // Mark as a branch if this is the last segment
      if (i === segments.length - 1) {
        cur.branch = normalizedName;
      }
    }
  }

  // 2. Walk + flatten, applying chain-compression on the fly.
  //    A chain is a sequence of single-child, non-branch nodes — collapse them into one label.
  const rows: BranchTreeRow[] = [];

  function walk(node: RawNode, depth: number, parentPath: string) {
    for (const child of node.children.values()) {
      let compressed = child;
      let label = child.label;
      let curPath = parentPath ? `${parentPath}/${child.label}` : child.label;

      // Compress: while the current node has exactly one child AND is NOT itself a branch,
      // merge with that child.
      while (!compressed.branch && compressed.children.size === 1) {
        const only = [...compressed.children.values()][0]!;
        label = `${label}/${only.label}`;
        curPath = `${curPath}/${only.label}`;
        compressed = only;
      }

      const isBranch = compressed.branch !== undefined;
      const hasChildren = compressed.children.size > 0;

      rows.push({
        name: compressed.branch,
        label,
        depth,
        isBranch,
        hasChildren,
        parentPath,
      });

      // Recurse into compressed node's children at depth + 1
      if (hasChildren) {
        walk(compressed, depth + 1, curPath);
      }
    }
  }

  walk(root, 0, '');
  return rows;
}
