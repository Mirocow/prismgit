import type { RepoGroup, RepositoryEntry } from '../../electron/types/settings-api';

/** A group (folder) node in the repository list tree. */
export interface RepoGroupNode {
  type: 'group';
  group: RepoGroup;
  children: RepoTreeNode[];
  /** Nesting level (0 = top level), used for indentation. */
  depth: number;
  /** Total number of repositories in this subtree (all levels). */
  repoCount: number;
}

/** A repository row in the repository list tree. */
export interface RepoItemNode {
  type: 'repo';
  repo: RepositoryEntry;
  depth: number;
}

export type RepoTreeNode = RepoGroupNode | RepoItemNode;

export interface BuildTreeOptions {
  /**
   * Group ids the user has collapsed. Children of collapsed groups are NOT
   * included in the output (but still count towards repoCount).
   */
  collapsed?: Set<string>;
  /**
   * Repo paths marked as favorite — favorites float to the top of their
   * group, mirroring the flat list's sorting.
   */
  favoritePaths?: Set<string>;
}

export interface BuiltRepoTree {
  /** Top-level nodes in display order. */
  nodes: RepoTreeNode[];
  /**
   * Groups whose parentId points to a missing group or forms a cycle —
   * they are repaired to root level for display.
   */
  repairedGroupIds: string[];
}

function compareGroups(a: RepoGroup, b: RepoGroup): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.name.localeCompare(b.name);
}

/**
 * The same stable repo ordering as the flat list used to use:
 * favorites first, then pinned, otherwise the array's insertion order.
 */
function compareRepos(a: RepositoryEntry, b: RepositoryEntry, favorites: Set<string>): number {
  const fa = favorites.has(a.path) ? 1 : 0;
  const fb = favorites.has(b.path) ? 1 : 0;
  if (fa !== fb) return fb - fa;
  const pa = a.pinned ? 1 : 0;
  const pb = b.pinned ? 1 : 0;
  if (pa !== pb) return pb - pa;
  return 0;
}

/**
 * Resolve the safe parent of every group. Guards against corrupt data:
 * a parentId pointing to a missing group, or a cycle in the parent chain.
 * Returns the repaired parent map plus the ids that were repaired.
 */
export function resolveSafeParents(groups: RepoGroup[]): {
  parentOf: Map<string, string | null>;
  repaired: Set<string>;
} {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const parentOf = new Map<string, string | null>();
  const repaired = new Set<string>();

  for (const group of groups) {
    const seen = new Set<string>([group.id]);
    const brokenChain: string[] = [];
    let cursor: RepoGroup | undefined = group;
    let broken = false;

    while (cursor && cursor.parentId) {
      const parent = byId.get(cursor.parentId);
      if (!parent) {
        // Parent vanished — surface the group at root level.
        broken = true;
        break;
      }
      if (seen.has(parent.id)) {
        // Cycle: the chain loops back — cut it off at root level.
        broken = true;
        break;
      }
      seen.add(parent.id);
      brokenChain.push(parent.id);
      cursor = parent;
    }

    if (broken) {
      repaired.add(group.id);
      parentOf.set(group.id, null);
      // Everything on the broken ancestor chain also becomes root to
      // guarantee a proper forest (no half-broken chains).
      for (const id of brokenChain) {
        repaired.add(id);
        parentOf.set(id, null);
      }
    } else {
      parentOf.set(group.id, group.parentId ?? null);
    }
  }

  return { parentOf, repaired };
}

/**
 * Build the display tree for the repository list from the flat group list
 * and the flat repo list. Pure function — corrupt input (cycles, missing
 * parents) is repaired into a forest instead of hanging or throwing.
 */
export function buildRepoTree(
  groups: RepoGroup[],
  repos: RepositoryEntry[],
  options: BuildTreeOptions = {}
): BuiltRepoTree {
  const { parentOf, repaired } = resolveSafeParents(groups);
  const favorites = options.favoritePaths ?? new Set<string>();
  const collapsed = options.collapsed ?? new Set<string>();

  // Bucket groups by (safe) parent id.
  const childGroups = new Map<string | null, RepoGroup[]>();
  for (const group of groups) {
    const parent = parentOf.get(group.id) ?? null;
    const bucket = childGroups.get(parent) ?? [];
    bucket.push(group);
    childGroups.set(parent, bucket);
  }
  for (const bucket of childGroups.values()) bucket.sort(compareGroups);

  // Bucket repos by group id (undefined/null groupId => root).
  const childRepos = new Map<string | null, RepositoryEntry[]>();
  for (const repo of repos) {
    const parent = (repo.groupId ?? null) as string | null;
    const bucket = childRepos.get(parent) ?? [];
    bucket.push(repo);
    childRepos.set(parent, bucket);
  }

  function buildGroupNode(group: RepoGroup, depth: number): RepoGroupNode {
    const children: RepoTreeNode[] = [];
    let repoCount = 0;

    const reposHere = (childRepos.get(group.id) ?? []).slice()
      .sort((a, b) => compareRepos(a, b, favorites));
    repoCount += reposHere.length;
    if (!collapsed.has(group.id)) {
      for (const repo of reposHere) children.push({ type: 'repo', repo, depth: depth + 1 });
    }

    for (const child of childGroups.get(group.id) ?? []) {
      const node = buildGroupNode(child, depth + 1);
      repoCount += node.repoCount;
      if (!collapsed.has(group.id)) children.push(node);
    }

    return { type: 'group', group, children, depth, repoCount };
  }

  const nodes: RepoTreeNode[] = [];
  const rootRepos = (childRepos.get(null) ?? []).slice()
    .sort((a, b) => compareRepos(a, b, favorites));
  for (const repo of rootRepos) nodes.push({ type: 'repo', repo, depth: 0 });
  for (const group of childGroups.get(null) ?? []) {
    nodes.push(buildGroupNode(group, 0));
  }

  return { nodes, repairedGroupIds: [...repaired] };
}

/**
 * Collect the ids of every group strictly inside the subtree rooted at
 * `rootId` (excluding the root itself). Used for cycle checks before a move.
 */
export function getDescendantGroupIds(groups: RepoGroup[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const g of groups) {
    const parent = g.parentId ?? null;
    if (parent === null) continue;
    const bucket = byParent.get(parent) ?? [];
    bucket.push(g.id);
    byParent.set(parent, bucket);
  }
  const result = new Set<string>();
  const queue = [...(byParent.get(rootId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (result.has(id)) continue; // cycle guard
    result.add(id);
    for (const child of byParent.get(id) ?? []) queue.push(child);
  }
  return result;
}

/**
 * Can `groupId` be moved under `newParentId` without creating a cycle?
 * Root (null) is always allowed.
 */
export function canMoveGroup(
  groups: RepoGroup[],
  groupId: string,
  newParentId: string | null
): boolean {
  if (newParentId === null) return true;
  if (newParentId === groupId) return false;
  return !getDescendantGroupIds(groups, groupId).has(newParentId);
}

/** A single row of the flattened group hierarchy (for "Move to group…" menus). */
export interface FlatGroupOption {
  id: string | null;
  name: string;
  depth: number;
  isRoot: boolean;
}

/**
 * Flatten the built tree into menu options (hierarchy shown via depth
 * indentation). `excludeGroupId` hides a group and its whole subtree —
 * used when offering move targets for that very group.
 */
export function flattenGroupOptions(
  groups: RepoGroup[],
  repos: RepositoryEntry[],
  excludeGroupId?: string
): FlatGroupOption[] {
  const { nodes } = buildRepoTree(groups, repos);
  const options: FlatGroupOption[] = [
    { id: null, name: 'No group (root)', depth: 0, isRoot: true },
  ];
  const walk = (list: RepoTreeNode[]) => {
    for (const node of list) {
      if (node.type !== 'group') continue;
      if (node.group.id === excludeGroupId) continue; // skip the group AND its subtree
      options.push({ id: node.group.id, name: node.group.name, depth: node.depth, isRoot: false });
      walk(node.children);
    }
  };
  walk(nodes);
  return options;
}
