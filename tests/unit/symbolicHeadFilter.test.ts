/**
 * Verifies that symbolic HEAD refs like "origin/HEAD" and "github/HEAD"
 * are filtered out of branch lists in the UI.
 *
 * Bug: User reported that the BranchesPage, HistoryPage branch picker,
 * RefActionDialog, GlobalSearch, and SetTrackedBranchDialog all show
 * "origin/HEAD" and "github/HEAD" rows. These are SYMBOLIC refs (git's
 * pointer to the default branch of a remote) — they are not real
 * branches. The backend branches() already strips them, but defense-
 * in-depth filtering on the UI side ensures they never appear even if
 * a cached list slips through.
 */
import { describe, it, expect } from 'vitest';
import {
  isSymbolicHead,
  filterSymbolicHeads,
  filterSymbolicHeadNames,
} from '../../src/lib/branchFilter';

describe('Symbolic HEAD ref filter (origin/HEAD, github/HEAD)', () => {
  it('filters out "origin/HEAD"', () => {
    expect(isSymbolicHead('origin/HEAD')).toBe(true);
  });

  it('filters out "github/HEAD"', () => {
    expect(isSymbolicHead('github/HEAD')).toBe(true);
  });

  it('filters out bare "HEAD"', () => {
    expect(isSymbolicHead('HEAD')).toBe(true);
  });

  it('does NOT filter real branches', () => {
    expect(isSymbolicHead('main')).toBe(false);
    expect(isSymbolicHead('feature/x')).toBe(false);
    expect(isSymbolicHead('origin/main')).toBe(false);
    expect(isSymbolicHead('github/feature/x')).toBe(false);
  });

  it('does NOT filter branches that happen to contain "head" in the name', () => {
    expect(isSymbolicHead('header-parser')).toBe(false);
    expect(isSymbolicHead('feature/headphone-support')).toBe(false);
    expect(isSymbolicHead('origin/my-head-branch')).toBe(false);
  });

  it('filterSymbolicHeads() filters a list of branch objects', () => {
    const branches = [
      { name: 'main', remote: false },
      { name: 'origin/main', remote: true },
      { name: 'origin/HEAD', remote: true },
      { name: 'github/main', remote: true },
      { name: 'github/HEAD', remote: true },
      { name: 'feature/x', remote: false },
      { name: 'HEAD', remote: false }, // bare detached HEAD ref
    ];
    const filtered = filterSymbolicHeads(branches);
    expect(filtered.map((b) => b.name).sort()).toEqual(
      ['feature/x', 'github/main', 'main', 'origin/main'].sort(),
    );
  });

  it('filterSymbolicHeadNames() filters a list of branch-name strings', () => {
    const names = [
      'main',
      'origin/main',
      'origin/HEAD',
      'github/main',
      'github/HEAD',
      'HEAD',
      'feature/x',
    ];
    const filtered = filterSymbolicHeadNames(names);
    expect(filtered.sort()).toEqual(
      ['feature/x', 'github/main', 'main', 'origin/main'].sort(),
    );
  });

  it('does not mutate the input array', () => {
    const input = [{ name: 'main' }, { name: 'origin/HEAD' }];
    const inputCopy = [...input];
    filterSymbolicHeads(input);
    expect(input).toEqual(inputCopy);
  });
});
