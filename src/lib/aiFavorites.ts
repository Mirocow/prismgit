/**
 * AI chat favorites — pure tree operations.
 *
 * A favorites tree is an array of root nodes; folders may nest arbitrarily,
 * notes (saved chat messages) are leaves. The model is deliberately simple
 * and renderer-owned (persisted to localStorage by aiFavoritesStore):
 *
 *   root: AiFavoriteNode[]
 *   ├─ 📁 Refactoring ideas            (folder)
 *   │   ├─ 💬 "explain the conflict…"  (note — user prompt)
 *   │   └─ 📁 GitFlow                  (nested folder)
 *   └─ 💬 "how to undo a push…"        (note at root)
 *
 * All mutations are pure: they take the tree (root array) and return a NEW
 * tree, leaving untouched branches referentially equal so React memoization
 * and zustand selectors stay cheap. Unit-tested in tests/unit/aiFavorites.test.ts
 * (no Electron / React imports here on purpose).
 */

export type AiFavoriteRole = 'user' | 'assistant';

export interface AiFavoriteNote {
  id: string;
  type: 'note';
  /** Display name — defaults to the first line of the content. */
  name: string;
  /** Snapshot of the saved message text (chat history gets trimmed!). */
  content: string;
  role: AiFavoriteRole;
  /** Repository the message belonged to (informational). */
  repoPath?: string;
  createdAt: number;
}

export interface AiFavoriteFolder {
  id: string;
  type: 'folder';
  name: string;
  children: AiFavoriteNode[];
  expanded: boolean;
  createdAt: number;
}

export type AiFavoriteNode = AiFavoriteNote | AiFavoriteFolder;

/** Create a unique-enough id for nodes (localStorage scope, no crypto needed). */
export function favId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Derive a display name from a message's content (first line, trimmed). */
export function noteNameFromContent(content: string): string {
  const firstLine = (content || '').split('\n').find((l) => l.trim()) || '';
  const name = firstLine.trim().slice(0, 60);
  return name || '—';
}

function isFolder(n: AiFavoriteNode): n is AiFavoriteFolder {
  return n.type === 'folder';
}

/** Depth-first search for a node by id. */
export function findNode(tree: AiFavoriteNode[], id: string): AiFavoriteNode | undefined {
  for (const n of tree) {
    if (n.id === id) return n;
    if (isFolder(n)) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Collect the ids of a folder and ALL its descendants (cycle guard for move). */
function descendantIds(folder: AiFavoriteFolder): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: AiFavoriteNode[]) => {
    for (const n of nodes) {
      out.add(n.id);
      if (isFolder(n)) walk(n.children);
    }
  };
  walk(folder.children);
  return out;
}

/** Remove a node by id from the tree; returns the new tree or null if absent. */
export function removeNodeFromTree(tree: AiFavoriteNode[], id: string): AiFavoriteNode[] | null {
  let removed: AiFavoriteNode[] | null = null;
  const walk = (nodes: AiFavoriteNode[]): AiFavoriteNode[] => {
    const next: AiFavoriteNode[] = [];
    for (const n of nodes) {
      if (n.id === id) {
        removed = nodes;
        continue; // drop
      }
      if (isFolder(n)) next.push({ ...n, children: walk(n.children) });
      else next.push(n);
    }
    return next;
  };
  const result = walk(tree);
  return removed ? result : null;
}

/**
 * Generic insert of `node` under parentId (null = root). If the parent does
 * not exist the node goes to the ROOT — the caller's intent ("save this
 * message") must never fail just because a folder was deleted a moment ago.
 */
export function insertIntoTree(
  tree: AiFavoriteNode[],
  parentId: string | null,
  node: AiFavoriteNode
): AiFavoriteNode[] {
  if (parentId === null) return [...tree, node];
  const walk = (nodes: AiFavoriteNode[]): AiFavoriteNode[] =>
    nodes.map((n) => {
      if (n.id === parentId && isFolder(n)) {
        return { ...n, children: [...n.children, node], expanded: true };
      }
      return isFolder(n) ? { ...n, children: walk(n.children) } : n;
    });
  const next = walk(tree);
  // Parent vanished → root (never lose the user's note).
  return findNode(next, node.id) ? next : [...tree, node];
}

/** Rename a node by id (no-op when absent). */
export function renameNodeInTree(tree: AiFavoriteNode[], id: string, name: string): AiFavoriteNode[] {
  const clean = name.trim();
  if (!clean) return tree;
  const walk = (nodes: AiFavoriteNode[]): AiFavoriteNode[] =>
    nodes.map((n) => {
      if (n.id === id) return { ...n, name: clean };
      return isFolder(n) ? { ...n, children: walk(n.children) } : n;
    });
  return walk(tree);
}

/**
 * Move a node under a new parent (null = root). Guards:
 *  - moving into itself or any of its descendants is rejected (cycle);
 *  - moving to the same parent is a no-op;
 *  - unknown target parent → node goes to root (same safety as insert).
 */
export function moveNodeInTree(
  tree: AiFavoriteNode[],
  id: string,
  newParentId: string | null
): AiFavoriteNode[] {
  const node = findNode(tree, id);
  if (!node) return tree;
  if (newParentId === null) {
    const detached = removeNodeFromTree(tree, id);
    return detached ? [...detached, node] : tree;
  }
  if (id === newParentId) return tree;
  // Cycle guard: the target parent must not live inside the moved subtree.
  if (isFolder(node) && descendantIds(node).has(newParentId)) return tree;
  const detached = removeNodeFromTree(tree, id);
  if (!detached) return tree;
  return insertIntoTree(detached, newParentId, node);
}

/** Toggle a folder's expanded state (no-op for notes / unknown ids). */
export function toggleFolderInTree(tree: AiFavoriteNode[], id: string): AiFavoriteNode[] {
  const walk = (nodes: AiFavoriteNode[]): AiFavoriteNode[] =>
    nodes.map((n) => {
      if (n.id === id && isFolder(n)) return { ...n, expanded: !n.expanded };
      return isFolder(n) ? { ...n, children: walk(n.children) } : n;
    });
  return walk(tree);
}

/** Collapse every folder recursively. */
export function collapseAllInTree(tree: AiFavoriteNode[]): AiFavoriteNode[] {
  const walk = (nodes: AiFavoriteNode[]): AiFavoriteNode[] =>
    nodes.map((n) =>
      isFolder(n) ? { ...n, expanded: false, children: walk(n.children) } : n
    );
  return walk(tree);
}

/** Total number of saved notes in the tree. */
export function countNotesInTree(tree: AiFavoriteNode[]): number {
  let count = 0;
  const walk = (nodes: AiFavoriteNode[]) => {
    for (const n of nodes) {
      if (n.type === 'note') count += 1;
      else walk(n.children);
    }
  };
  walk(tree);
  return count;
}

/** Structural validation for data loaded from localStorage. */
export function isValidFavoritesTree(value: unknown): value is AiFavoriteNode[] {
  if (!Array.isArray(value)) return false;
  const validNode = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return false;
    const node = n as Record<string, unknown>;
    if (typeof node.id !== 'string' || typeof node.name !== 'string') return false;
    if (node.type === 'note') {
      return typeof node.content === 'string' && (node.role === 'user' || node.role === 'assistant');
    }
    if (node.type === 'folder') {
      return Array.isArray(node.children) && node.children.every(validNode);
    }
    return false;
  };
  return value.every(validNode);
}
