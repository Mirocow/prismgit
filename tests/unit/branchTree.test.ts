import { describe, it, expect } from 'vitest';
import { buildBranchTree } from '../../src/lib/branchTree';

describe('branchTree', () => {
  it('returns empty list for no branches', () => {
    expect(buildBranchTree([])).toEqual([]);
  });

  it('returns single top-level branch with depth 0', () => {
    const rows = buildBranchTree(['main']);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('main');
    expect(rows[0].label).toBe('main');
    expect(rows[0].depth).toBe(0);
    expect(rows[0].isBranch).toBe(true);
    expect(rows[0].hasChildren).toBe(false);
  });

  it('returns multiple top-level branches flat', () => {
    const rows = buildBranchTree(['main', 'develop', 'release']);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.name)).toEqual(['main', 'develop', 'release']);
    expect(rows.every(r => r.depth === 0)).toBe(true);
  });

  it('compresses single-child chains (Fork / IntelliJ style)', () => {
    // feat/foo/bar — all single-children, no branch at intermediate — should collapse to one row
    const rows = buildBranchTree(['feat/foo/bar']);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('feat/foo/bar');
    expect(rows[0].label).toBe('feat/foo/bar');
    expect(rows[0].depth).toBe(0);
    expect(rows[0].isBranch).toBe(true);
    expect(rows[0].hasChildren).toBe(false);
  });

  it('does NOT compress when there are multiple children at any level', () => {
    // feat/auth and feat/api — `feat` has 2 children, so it stays as a folder
    const rows = buildBranchTree(['feat/auth', 'feat/api']);
    expect(rows).toHaveLength(3);
    // First row: feat folder
    expect(rows[0].label).toBe('feat');
    expect(rows[0].depth).toBe(0);
    expect(rows[0].isBranch).toBe(false);
    expect(rows[0].hasChildren).toBe(true);
    // Then auth and api at depth 1
    expect(rows[1].label).toBe('auth');
    expect(rows[1].depth).toBe(1);
    expect(rows[1].isBranch).toBe(true);
    expect(rows[1].hasChildren).toBe(false);
    expect(rows[2].label).toBe('api');
    expect(rows[2].depth).toBe(1);
  });

  it('compresses only the single-child portion of a path', () => {
    // feat/foo/auth, feat/foo/api, feat/foo/bar/baz
    // `feat/foo` is a single chain (no branches at `feat` or `foo`), so it collapses
    // Then `auth`, `api`, `bar/baz` are children
    const rows = buildBranchTree(['feat/foo/auth', 'feat/foo/api', 'feat/foo/bar/baz']);
    expect(rows[0].label).toBe('feat/foo'); // collapsed folder
    expect(rows[0].depth).toBe(0);
    expect(rows[0].isBranch).toBe(false);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[1].label).toBe('auth');
    expect(rows[1].depth).toBe(1);
    expect(rows[1].isBranch).toBe(true);
    expect(rows[2].label).toBe('api');
    expect(rows[2].depth).toBe(1);
    // bar/baz collapsed because `bar` has single child `baz`
    expect(rows[3].label).toBe('bar/baz');
    expect(rows[3].depth).toBe(1);
  });

  it('handles branches with empty path segments gracefully', () => {
    // git rejects `a//b` but if it slips through, we filter empty segments
    const rows = buildBranchTree(['a//b']);
    expect(rows[0].name).toBe('a/b');
  });

  it('handles remote-style names with slashes', () => {
    // Use branches that don't form single-chains: origin/main + origin/feature/auth + origin/feature/api
    // → `origin` folder, then `main` + `feature` folder + `auth` + `api`
    const rows = buildBranchTree(['origin/main', 'origin/feature/auth', 'origin/feature/api']);
    expect(rows[0].label).toBe('origin');
    expect(rows[0].depth).toBe(0);
    expect(rows[0].isBranch).toBe(false);
    expect(rows[0].hasChildren).toBe(true);
    // main at depth 1
    expect(rows[1].label).toBe('main');
    expect(rows[1].depth).toBe(1);
    expect(rows[1].isBranch).toBe(true);
    // feature folder at depth 1 (has 2 children: auth, api)
    expect(rows[2].label).toBe('feature');
    expect(rows[2].depth).toBe(1);
    expect(rows[2].isBranch).toBe(false);
    expect(rows[2].hasChildren).toBe(true);
    // auth and api at depth 2
    expect(rows[3].label).toBe('auth');
    expect(rows[3].depth).toBe(2);
    expect(rows[3].isBranch).toBe(true);
    expect(rows[4].label).toBe('api');
    expect(rows[4].depth).toBe(2);
  });

  it('produces depth-first traversal order', () => {
    const rows = buildBranchTree(['main', 'feature/auth', 'feature/api', 'release/v1', 'release/v2']);
    // main, then feature folder + auth + api, then release folder + v1 + v2
    expect(rows.map(r => r.label)).toEqual([
      'main',
      'feature', 'auth', 'api',
      'release', 'v1', 'v2',
    ]);
  });

  it('marks folder nodes (no branch of their own) as non-branch', () => {
    const rows = buildBranchTree(['feat/auth', 'feat/api']);
    expect(rows[0].isBranch).toBe(false); // feat folder
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[1].isBranch).toBe(true);  // auth
    expect(rows[1].hasChildren).toBe(false);
    expect(rows[2].isBranch).toBe(true);  // api
    expect(rows[2].hasChildren).toBe(false);
  });

  it('marks a branch that is also a parent of others as branch with children', () => {
    // 'feature' is a branch itself AND has children 'feature/auth'
    const rows = buildBranchTree(['feature', 'feature/auth']);
    expect(rows[0].name).toBe('feature');
    expect(rows[0].isBranch).toBe(true);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[1].name).toBe('feature/auth');
    expect(rows[1].depth).toBe(1);
    expect(rows[1].isBranch).toBe(true);
    expect(rows[1].hasChildren).toBe(false);
  });
});
