/**
 * Unit tests — default target selection for the Push / Pull dropdowns
 * (lib/pullPushDefaults).
 *
 * Pins the UNIFIED-STATE rule: working-copy operations default to the
 * CURRENTLY CHECKED-OUT branch. The global UI selection (Branches/History
 * browsing) must NOT hijack operation defaults — user-reported:
 * checked out feature/v3, Pull dialog pre-filled feature/v1 (browsed
 * earlier), `git pull origin feature/v1` merged the wrong branch into the
 * working tree ("у инструментов нет единного состояния").
 */
import { describe, it, expect } from 'vitest';
import { pickDefaultPullBranch, pickDefaultPushBranch } from '../../src/lib/pullPushDefaults';

describe('pickDefaultPullBranch (Pull dropdown default)', () => {
  const REMOTES = ['origin/feature/v1', 'origin/feature/v3', 'origin/main', 'upstream/main'];

  it('REGRESSION: the CURRENT checked-out branch wins over a stale previous pick', () => {
    // prev = the branch pulled last time (stale) — current is v3. The
    // dropdown re-resolves its default on every (re)open.
    expect(pickDefaultPullBranch(REMOTES, 'feature/v3', 'origin/feature/v1', true)).toBe('origin/feature/v3');
  });

  it('within an open session the user’s explicit pick is preserved (resetDefault=false)', () => {
    // In-session refresh (e.g. after Fetch): user deliberately chose v1.
    expect(pickDefaultPullBranch(REMOTES, 'feature/v3', 'origin/feature/v1', false)).toBe('origin/feature/v1');
  });

  it('in-session pick of a branch that no longer exists falls back to the current branch', () => {
    // prev was pruned — current branch takes over.
    expect(pickDefaultPullBranch(REMOTES, 'feature/v3', 'origin/deleted-branch', false)).toBe('origin/feature/v3');
  });

  it('detached HEAD (no current branch) falls back to the previous pick', () => {
    expect(pickDefaultPullBranch(REMOTES, null, 'origin/feature/v1', true)).toBe('origin/feature/v1');
  });

  it('detached HEAD with no previous pick takes the first remote branch', () => {
    expect(pickDefaultPullBranch(REMOTES, null, '', true)).toBe('origin/feature/v1');
  });

  it('multi-remote: matches the current branch on the first remote that has it', () => {
    // origin/main comes before upstream/main in the list → origin wins.
    expect(pickDefaultPullBranch(['origin/other', 'origin/main', 'upstream/main'], 'main', '', true)).toBe('origin/main');
  });

  it('current branch has no remote counterpart → first remote branch', () => {
    expect(pickDefaultPullBranch(REMOTES, 'local-only', '', true)).toBe('origin/feature/v1');
  });

  it('branch names with slashes match on the full tail segment', () => {
    expect(
      pickDefaultPullBranch(['origin/feature/smartgit-electron-v3', 'origin/main'], 'feature/smartgit-electron-v3', '', true),
    ).toBe('origin/feature/smartgit-electron-v3');
  });

  it('empty remote list → empty string', () => {
    expect(pickDefaultPullBranch([], 'main', '', true)).toBe('');
  });
});

describe('pickDefaultPushBranch (Push dropdown default)', () => {
  const LOCALS = [
    { name: 'feature/v1', current: false },
    { name: 'feature/v3', current: true },
    { name: 'main', current: false },
  ];

  it('REGRESSION: the CURRENT branch wins over the globally selected one', () => {
    // Global selection = v1 (browsed in Branches), checked out = v3.
    expect(pickDefaultPushBranch(LOCALS, 'feature/v1')).toBe('feature/v3');
  });

  it('detached HEAD: global selection is a sensible fallback', () => {
    const noCurrent = LOCALS.map((b) => ({ ...b, current: false }));
    expect(pickDefaultPushBranch(noCurrent, 'feature/v1')).toBe('feature/v1');
  });

  it('detached HEAD with unknown global selection → first local branch', () => {
    const noCurrent = LOCALS.map((b) => ({ ...b, current: false }));
    expect(pickDefaultPushBranch(noCurrent, 'nope')).toBe('feature/v1');
    expect(pickDefaultPushBranch(noCurrent, null)).toBe('feature/v1');
  });

  it('empty list → empty string', () => {
    expect(pickDefaultPushBranch([], 'main')).toBe('');
  });
});
