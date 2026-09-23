/**
 * Unit tests — incoming-commits scope selection (lib/incomingCommits).
 *
 * Context (user-reported bug): after `git reset --hard` the History graph
 * still rendered remote commits as if they were merged into the local
 * branch. Two causes:
 *   1. the graph never reloaded (deps only watched the branch NAME), and
 *   2. the incoming set `rev-list --remotes --not --branches` goes EMPTY
 *      when ANY other local branch contains the remote commits.
 *
 * These tests pin the scope-selection logic that fixes (2) — the
 * head+upstream view must ask for `<current>..<upstream>`.
 */
import { describe, it, expect } from 'vitest';
import { incomingRevListArgs, parseRevList } from '../../src/lib/incomingCommits';

describe('incomingRevListArgs', () => {
  it('head+upstream scope uses the view-accurate range', () => {
    expect(
      incomingRevListArgs({ mode: 'head+upstream', currentBranch: 'main', upstream: 'origin/main' }),
    ).toEqual(['rev-list', 'main..origin/main']);
  });

  it('head+upstream with no upstream falls back to the global set', () => {
    // Local-only branch, never pushed — nothing to compare against.
    expect(
      incomingRevListArgs({ mode: 'head+upstream', currentBranch: 'main', upstream: null }),
    ).toEqual(['rev-list', '--remotes', '--not', '--branches']);
  });

  it('head+upstream with no current branch (detached HEAD) falls back to the global set', () => {
    expect(
      incomingRevListArgs({ mode: 'head+upstream', currentBranch: null, upstream: 'origin/main' }),
    ).toEqual(['rev-list', '--remotes', '--not', '--branches']);
  });

  it('head+upstream with current === upstream (self-tracking oddity) falls back', () => {
    expect(
      incomingRevListArgs({ mode: 'head+upstream', currentBranch: 'origin/main', upstream: 'origin/main' }),
    ).toEqual(['rev-list', '--remotes', '--not', '--branches']);
  });

  it('global scope keeps the repo-wide remote-only semantics', () => {
    expect(incomingRevListArgs({ mode: 'global' })).toEqual([
      'rev-list', '--remotes', '--not', '--branches',
    ]);
  });
});

describe('parseRevList', () => {
  it('parses newline-separated hashes, trimming whitespace', () => {
    const out = parseRevList(
      '  aaaa1111 \n\n bbbb2222\n\tcccc3333\t\n',
    );
    expect([...out]).toEqual(['aaaa1111', 'bbbb2222', 'cccc3333']);
  });

  it('returns an empty set for empty / whitespace-only output', () => {
    expect(parseRevList('')).toEqual(new Set());
    expect(parseRevList('   \n  \n')).toEqual(new Set());
  });
});
