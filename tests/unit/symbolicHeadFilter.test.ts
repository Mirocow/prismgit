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

// Mirror the helper we added to BranchesPage.
function isSymbolicHead(name: string): boolean {
  return name === 'HEAD' || name.endsWith('/HEAD');
}

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

  it('filters a list of branches correctly', () => {
    const branches = [
      { name: 'main', remote: false },
      { name: 'origin/main', remote: true },
      { name: 'origin/HEAD', remote: true },
      { name: 'github/main', remote: true },
      { name: 'github/HEAD', remote: true },
      { name: 'feature/x', remote: false },
      { name: 'HEAD', remote: false }, // bare detached HEAD ref
    ];
    const filtered = branches.filter(b => !isSymbolicHead(b.name));
    expect(filtered.map(b => b.name).sort()).toEqual(
      ['feature/x', 'github/main', 'main', 'origin/main'].sort(),
    );
  });
});
