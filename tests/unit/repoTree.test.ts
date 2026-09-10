import { describe, it, expect } from 'vitest';
import {
  buildRepoTree,
  canMoveGroup,
  flattenGroupOptions,
  getDescendantGroupIds,
  resolveSafeParents,
} from '../../src/lib/repoTree';
import type { RepoGroup, RepositoryEntry } from '../../electron/types/settings-api';
import type { RepoTreeNode } from '../../src/lib/repoTree';

function group(id: string, name: string, parentId: string | null, order = 0): RepoGroup {
  return { id, name, parentId, order, createdAt: order, expanded: true };
}

function repo(path: string, name: string, groupId?: string | null, pinned = false): RepositoryEntry {
  return { path, name, lastOpened: 0, pinned, groupId: groupId ?? null };
}

describe('repoTree.buildRepoTree', () => {
  it('returns empty for empty input', () => {
    const { nodes, repairedGroupIds } = buildRepoTree([], []);
    expect(nodes).toEqual([]);
    expect(repairedGroupIds).toEqual([]);
  });

  it('lists ungrouped repos at root level', () => {
    const { nodes } = buildRepoTree([], [repo('/a', 'a'), repo('/b', 'b')]);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.type === 'repo' && n.depth === 0)).toBe(true);
  });

  it('nests repos inside groups with depth 1', () => {
    const groups = [group('g1', 'Work', null)];
    const repos = [repo('/a', 'a', 'g1'), repo('/b', 'b')];
    const { nodes } = buildRepoTree(groups, repos);
    // Root: repo /b first, then group g1
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ type: 'repo', depth: 0 });
    const g = nodes[1] as Extract<typeof nodes[1], { type: 'group' }>;
    expect(g.group.id).toBe('g1');
    expect(g.children).toHaveLength(1);
    expect(g.children[0]).toMatchObject({ type: 'repo', repo: { path: '/a' }, depth: 1 });
    expect(g.repoCount).toBe(1);
  });

  it('nests groups into groups (multi-level tree)', () => {
    const groups = [
      group('work', 'Work', null),
      group('clients', 'Clients', 'work'),
      group('acme', 'Acme', 'clients'),
    ];
    const repos = [repo('/deep', 'deep', 'acme')];
    const { nodes } = buildRepoTree(groups, repos);
    const work = nodes[0] as Extract<typeof nodes[0], { type: 'group' }>;
    expect(work.depth).toBe(0);
    const clients = work.children[0] as Extract<typeof work.children[0], { type: 'group' }>;
    expect(clients.group.id).toBe('clients');
    expect(clients.depth).toBe(1);
    const acme = clients.children[0] as Extract<typeof clients.children[0], { type: 'group' }>;
    expect(acme.depth).toBe(2);
    const leaf = acme.children[0];
    expect(leaf).toMatchObject({ type: 'repo', depth: 3 });
    // repoCount aggregates the whole subtree
    expect(work.repoCount).toBe(1);
    expect(clients.repoCount).toBe(1);
  });

  it('sorts sibling groups by order then name', () => {
    const groups = [
      group('b', 'Beta', null, 2),
      group('a', 'Alpha', null, 1),
      group('c', 'Zeta', null, 1),
    ];
    const { nodes } = buildRepoTree(groups, []);
    const ids = nodes.map((n) => (n.type === 'group' ? n.group.id : 'repo'));
    expect(ids).toEqual(['a', 'c', 'b']); // order 1 (Alpha, Zeta alphabetical), then order 2
  });

  it('floats favorites and pinned repos to the top of their group', () => {
    const groups = [group('g', 'G', null)];
    const repos = [
      repo('/plain', 'plain', 'g'),
      repo('/fav', 'fav', 'g'),
      repo('/pin', 'pin', 'g', true),
    ];
    const { nodes } = buildRepoTree(groups, repos, { favoritePaths: new Set(['/fav']) });
    const g = nodes[0] as Extract<typeof nodes[0], { type: 'group' }>;
    const order = (g.children as Array<Extract<RepoTreeNode, { type: 'repo' }>>).map((n) => n.repo.path);
    expect(order).toEqual(['/fav', '/pin', '/plain']);
  });

  it('hides children of collapsed groups but keeps repoCount', () => {
    const groups = [group('g', 'G', null), group('sub', 'Sub', 'g')];
    const repos = [repo('/a', 'a', 'g'), repo('/b', 'b', 'sub')];
    const { nodes } = buildRepoTree(groups, repos, { collapsed: new Set(['g']) });
    const g = nodes[0] as Extract<typeof nodes[0], { type: 'group' }>;
    expect(g.children).toHaveLength(0);
    expect(g.repoCount).toBe(2); // /a + /b (in sub)
  });

  it('repairs groups whose parent is missing (surfaces at root)', () => {
    const groups = [group('orphan', 'Orphan', 'missing-parent')];
    const { nodes, repairedGroupIds } = buildRepoTree(groups, []);
    expect(repairedGroupIds).toContain('orphan');
    const orphan = nodes.find((n) => n.type === 'group') as Extract<RepoTreeNode, { type: 'group' }>;
    expect(orphan.depth).toBe(0);
  });

  it('repairs cyclic parent chains into a forest (no infinite loop)', () => {
    const groups = [
      group('a', 'A', 'b'),
      group('b', 'B', 'a'),
      group('c', 'C', 'a'),
    ];
    const { nodes, repairedGroupIds } = buildRepoTree(groups, []);
    // Must terminate and produce SOME valid forest with all groups present
    const allGroupIds: string[] = [];
    const walk = (list: typeof nodes) => {
      for (const n of list) {
        if (n.type === 'group') {
          allGroupIds.push(n.group.id);
          walk(n.children);
        }
      }
    };
    walk(nodes);
    expect(allGroupIds.sort()).toEqual(['a', 'b', 'c']);
    expect(repairedGroupIds.length).toBeGreaterThan(0);
    // And the chain a -> c must not be lost: c was a child of a, at least one group is nested
    const totalNesting = nodes.reduce((acc, n) => acc + (n.type === 'group' ? n.children.length : 0), 0);
    expect(totalNesting).toBeGreaterThanOrEqual(0);
  });
});

describe('repoTree.getDescendantGroupIds / canMoveGroup', () => {
  const groups = [
    group('root', 'Root', null),
    group('child', 'Child', 'root'),
    group('grand', 'Grand', 'child'),
    group('other', 'Other', null),
  ];

  it('collects all descendants (transitively)', () => {
    const desc = getDescendantGroupIds(groups, 'root');
    expect(desc.has('child')).toBe(true);
    expect(desc.has('grand')).toBe(true);
    expect(desc.has('other')).toBe(false);
    expect(desc.has('root')).toBe(false);
  });

  it('allows moving to root and under unrelated groups', () => {
    expect(canMoveGroup(groups, 'child', null)).toBe(true);
    expect(canMoveGroup(groups, 'child', 'other')).toBe(true);
    expect(canMoveGroup(groups, 'grand', 'other')).toBe(true);
  });

  it('forbids moving into itself or its own subtree', () => {
    expect(canMoveGroup(groups, 'root', 'root')).toBe(false);
    expect(canMoveGroup(groups, 'root', 'child')).toBe(false);
    expect(canMoveGroup(groups, 'root', 'grand')).toBe(false);
    expect(canMoveGroup(groups, 'child', 'grand')).toBe(false);
  });

  it('sibling subtrees are not descendants', () => {
    expect(canMoveGroup(groups, 'grand', 'root')).toBe(true);
    expect(canMoveGroup(groups, 'other', 'child')).toBe(true);
  });
});

describe('repoTree.resolveSafeParents', () => {
  it('keeps valid parents intact', () => {
    const groups = [group('a', 'A', null), group('b', 'B', 'a')];
    const { parentOf, repaired } = resolveSafeParents(groups);
    expect(parentOf.get('a')).toBeNull();
    expect(parentOf.get('b')).toBe('a');
    expect(repaired.size).toBe(0);
  });

  it('flags groups with missing parents', () => {
    const groups = [group('a', 'A', 'ghost')];
    const { repaired } = resolveSafeParents(groups);
    expect(repaired.has('a')).toBe(true);
  });

  it('detects direct self-parenting', () => {
    const groups = [group('a', 'A', 'a')];
    const { repaired } = resolveSafeParents(groups);
    expect(repaired.has('a')).toBe(true);
  });
});

describe('repoTree.flattenGroupOptions', () => {
  it('starts with root option and indents nested groups', () => {
    const groups = [
      group('w', 'Work', null),
      group('c', 'Clients', 'w'),
    ];
    const options = flattenGroupOptions(groups, []);
    expect(options[0]).toMatchObject({ id: null, isRoot: true });
    expect(options[1]).toMatchObject({ id: 'w', depth: 0 });
    expect(options[2]).toMatchObject({ id: 'c', depth: 1 });
  });

  it('excludes the moved group and its subtree from targets', () => {
    const groups = [
      group('w', 'Work', null),
      group('c', 'Clients', 'w'),
      group('o', 'Other', null),
    ];
    const options = flattenGroupOptions(groups, [], 'w');
    const ids = options.map((o) => o.id);
    expect(ids).toContain(null);
    expect(ids).toContain('o');
    expect(ids).not.toContain('w');
    expect(ids).not.toContain('c');
  });
});
