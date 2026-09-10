/**
 * File tree builder with chain-compression.
 *
 * Used by Changes view to display working-tree files in a tree layout.
 * Reuses the same chain-compression logic as `branchTree.ts` — single-child
 * folders collapse into one label, so `src/components/foo/bar.ts` becomes
 * a single row "src/components/foo/bar.ts" instead of 4 nested folders.
 *
 * Each file carries a `status` (M/A/D/R/?) and `staged` flag, so the tree
 * preserves the working-tree state across compressions.
 */

export type FileStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | '?' | 'U' | 'T';

export interface FileEntry {
  /** Full file path (e.g. "src/components/Button.tsx"). */
  path: string;
  /** Status code: M=modified, A=added, D=deleted, R=renamed, ?=untracked, U=unmerged. */
  status: FileStatusCode;
  /** True if file is staged. */
  staged: boolean;
  /** Old path (for renames). */
  oldPath?: string;
}

export interface FileTreeRow {
  /** Full path for files; for folders it's the compressed path prefix. */
  path: string;
  /** Display label (compressed for folders). */
  label: string;
  /** Nesting depth (0 = top-level). */
  depth: number;
  /** True for actual file rows; false for folder rows. */
  isFile: boolean;
  /** File entry if isFile, undefined otherwise. */
  entry?: FileEntry;
  /** Children count for folders. */
  childCount: number;
  /** Aggregate: number of staged files in this subtree. */
  stagedCount: number;
  /** Aggregate: number of modified files in this subtree. */
  modifiedCount: number;
  /** Aggregate: number of added files in this subtree. */
  addedCount: number;
  /** Aggregate: number of deleted files in this subtree. */
  deletedCount: number;
}

interface RawNode {
  label: string;
  entry?: FileEntry;
  children: Map<string, RawNode>;
}

/**
 * Build a flat list of tree rows from a list of file entries.
 *
 * @param files       List of file entries
 * @param compress    If true (default), single-child folders collapse into one row
 * @returns           Flat depth-first list of rows
 */
export function buildFileTree(
  files: FileEntry[],
  compress: boolean = true,
): FileTreeRow[] {
  if (files.length === 0) return [];

  // 1. Build raw tree
  const root: RawNode = { label: '', children: new Map() };

  for (const entry of files) {
    const segments = entry.path.split('/').filter(s => s !== '');
    let cur = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!cur.children.has(seg)) {
        cur.children.set(seg, { label: seg, children: new Map() });
      }
      cur = cur.children.get(seg)!;
      if (i === segments.length - 1) {
        cur.entry = entry;
      }
    }
  }

  // 2. Walk + flatten, applying chain-compression if enabled
  const rows: FileTreeRow[] = [];

  function walk(node: RawNode, depth: number) {
    for (const child of node.children.values()) {
      let compressed = child;
      let label = child.label;
      let curPath = child.label;

      // Compress: while current is a non-file folder with exactly one child, merge
      if (compress) {
        while (!compressed.entry && compressed.children.size === 1) {
          const only = [...compressed.children.values()][0]!;
          label = `${label}/${only.label}`;
          curPath = `${curPath}/${only.label}`;
          compressed = only;
        }
      }

      const isFile = compressed.entry !== undefined;
      const hasChildren = compressed.children.size > 0;

      // Compute subtree aggregates
      let stagedCount = 0;
      let modifiedCount = 0;
      let addedCount = 0;
      let deletedCount = 0;
      const countAggregates = (n: RawNode) => {
        if (n.entry) {
          if (n.entry.staged) stagedCount++;
          if (n.entry.status === 'M' || n.entry.status === 'R' || n.entry.status === 'C' || n.entry.status === 'T') modifiedCount++;
          if (n.entry.status === 'A') addedCount++;
          if (n.entry.status === 'D') deletedCount++;
        }
        for (const c of n.children.values()) countAggregates(c);
      };
      countAggregates(compressed);

      rows.push({
        path: isFile ? compressed.entry!.path : curPath,
        label,
        depth,
        isFile,
        entry: compressed.entry,
        childCount: compressed.children.size,
        stagedCount,
        modifiedCount,
        addedCount,
        deletedCount,
      });

      if (hasChildren) {
        walk(compressed, depth + 1);
      }
    }
  }

  walk(root, 0);
  return rows;
}

/**
 * Filter file entries by extension, status, or staged state.
 */
export function filterFiles(
  files: FileEntry[],
  opts: {
    extension?: string | null;
    status?: 'all' | 'modified' | 'added' | 'deleted' | 'untracked' | 'staged' | 'unstaged';
    search?: string | null;
  },
): FileEntry[] {
  let result = files;
  if (opts.extension) {
    const ext = opts.extension.toLowerCase();
    result = result.filter(f => f.path.toLowerCase().endsWith(ext));
  }
  if (opts.status && opts.status !== 'all') {
    switch (opts.status) {
      case 'modified':
        result = result.filter(f => f.status === 'M' || f.status === 'R' || f.status === 'C' || f.status === 'T');
        break;
      case 'added':
        result = result.filter(f => f.status === 'A');
        break;
      case 'deleted':
        result = result.filter(f => f.status === 'D');
        break;
      case 'untracked':
        result = result.filter(f => f.status === '?');
        break;
      case 'staged':
        result = result.filter(f => f.staged);
        break;
      case 'unstaged':
        result = result.filter(f => !f.staged);
        break;
    }
  }
  if (opts.search && opts.search.trim()) {
    const q = opts.search.toLowerCase();
    result = result.filter(f => f.path.toLowerCase().includes(q));
  }
  return result;
}
