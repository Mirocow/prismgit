import { describe, it, expect } from 'vitest';
import { createAncestryResolver } from '../../src/lib/graphAncestry';
import type { LogEntry } from '../../electron/types/git-api';

function makeCommit(hash: string, parents: string[] = [], subject = ''): LogEntry {
  return {
    hash,
    hashAbbrev: hash.substring(0, 7),
    parents,
    parentsAbbrev: parents.map(p => p.substring(0, 7)),
    author: { name: 'A', email: 'a@b.c', date: '', timestamp: 0 },
    committer: { name: 'A', email: 'a@b.c', date: '', timestamp: 0 },
    subject,
    body: '',
    refs: [],
    message: subject,
  };
}

describe('graphAncestry', () => {
  it('returns original parents when nothing is filtered out', () => {
    // Visible = all commits, no filter
    const all = [
      makeCommit('C', ['B']),
      makeCommit('B', ['A']),
      makeCommit('A', []),
    ];
    const resolver = createAncestryResolver(all, all);
    expect(resolver.resolve('C')).toEqual([{ oid: 'B', elided: false }]);
    expect(resolver.resolve('B')).toEqual([{ oid: 'A', elided: false }]);
    expect(resolver.resolve('A')).toEqual([]);
    expect(resolver.isTruncated('A')).toBe(false);
  });

  it('rewires hidden parent to nearest visible ancestor (dashed link)', () => {
    // All commits: C -> B -> A, but only C and A are visible (B is filtered out)
    const all = [
      makeCommit('C', ['B']),
      makeCommit('B', ['A']),
      makeCommit('A', []),
    ];
    const visible = [all[0], all[2]]; // C and A, B hidden
    const resolver = createAncestryResolver(visible, all);

    // C's true parent is B (hidden), nearest visible ancestor is A
    const resolved = resolver.resolve('C');
    expect(resolved).toEqual([{ oid: 'A', elided: true }]);
    expect(resolver.isTruncated('C')).toBe(false);
  });

  it('marks commit as truncated when no visible ancestor exists', () => {
    // C -> B (B is the only parent, but it's outside the loaded window entirely)
    const all = [makeCommit('C', ['B'])]; // B is not in ancestry map at all
    const visible = all;
    const resolver = createAncestryResolver(visible, all);

    // B is not in `parentsOf`, so nearestVisible returns null → resolve returns []
    const resolved = resolver.resolve('C');
    expect(resolved).toEqual([]);
    expect(resolver.isTruncated('C')).toBe(true);
  });

  it('BFS walks through multiple hidden commits to find visible ancestor', () => {
    // C -> B2 -> B1 -> A
    // Visible: C, A (B1, B2 hidden)
    const all = [
      makeCommit('C', ['B2']),
      makeCommit('B2', ['B1']),
      makeCommit('B1', ['A']),
      makeCommit('A', []),
    ];
    const visible = [all[0], all[3]];
    const resolver = createAncestryResolver(visible, all);

    const resolved = resolver.resolve('C');
    expect(resolved).toEqual([{ oid: 'A', elided: true }]);
  });

  it('deduplicates when two true parents map to same visible ancestor', () => {
    // Merge commit M with parents B1 and B2, both of which descend from A (visible).
    // M is visible, A is visible, B1 and B2 are hidden.
    const all = [
      makeCommit('M', ['B1', 'B2']),
      makeCommit('B1', ['A']),
      makeCommit('B2', ['A']),
      makeCommit('A', []),
    ];
    const visible = [all[0], all[3]]; // M and A
    const resolver = createAncestryResolver(visible, all);

    const resolved = resolver.resolve('M');
    // Both B1 and B2 should resolve to A — but deduplicated
    expect(resolved).toEqual([{ oid: 'A', elided: true }]);
    expect(resolved.length).toBe(1);
  });

  it('respects visible set: hidden commit referenced directly is not returned as itself', () => {
    // C -> B (visible), but C is visible and B is filtered out
    const all = [
      makeCommit('C', ['B']),
      makeCommit('B', ['A']),
      makeCommit('A', []),
    ];
    const visible = [all[0], all[2]]; // C, A
    const resolver = createAncestryResolver(visible, all);

    // nearestVisible('B') should skip B (not visible) and return A
    const resolved = resolver.resolve('C');
    expect(resolved[0].oid).toBe('A');
    expect(resolved[0].elided).toBe(true);
  });

  it('isTruncated returns false for root commits (no parents)', () => {
    const all = [makeCommit('ROOT', [])];
    const resolver = createAncestryResolver(all, all);
    expect(resolver.isTruncated('ROOT')).toBe(false);
  });

  it('memoizes results: repeated calls return same references', () => {
    const all = [
      makeCommit('C', ['B']),
      makeCommit('B', ['A']),
      makeCommit('A', []),
    ];
    const visible = [all[0], all[2]];
    const resolver = createAncestryResolver(visible, all);

    const r1 = resolver.resolve('C');
    const r2 = resolver.resolve('C');
    expect(r1).toBe(r2); // same array reference due to memoization
  });

  it('handles cycle in ancestry (defensive — should not infinite-loop)', () => {
    // A -> B -> A (cycle, malformed data)
    const all = [
      makeCommit('A', ['B']),
      makeCommit('B', ['A']),
    ];
    const visible = [all[0]]; // only A visible, B hidden
    const resolver = createAncestryResolver(visible, all);

    // BFS from B (hidden) walks to A (visible) — terminates correctly via `seen` set.
    // So nearestVisible('B') returns {oid: 'A', elided: true}.
    // This means A rewrites its own parent (hidden B) to itself — visually a self-loop,
    // which the layout treats as "no continuation".
    const resolved = resolver.resolve('A');
    expect(resolved).toEqual([{ oid: 'A', elided: true }]);
    // A has visible ancestor (itself), so not truncated
    expect(resolver.isTruncated('A')).toBe(false);
  });
});
