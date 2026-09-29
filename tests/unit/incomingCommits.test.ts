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
 *
 * v3.1: fetchIncomingHashes additionally VALIDATES the refs before running
 * the range rev-list. When the upstream ref is gone (`git status` still
 * reports tracking from branch config, but refs/remotes/<upstream> was
 * pruned/deleted), the OLD argv died with
 *   "fatal: ambiguous argument 'v2..origin/v2': unknown revision"
 * which the main process logged as "Error occurred in handler for
 * 'git:raw'" on every History load. The tests below pin the fix: the
 * failing rev-list must never be spawned in that case.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  incomingRevListArgs,
  parseRevList,
  parseRefNames,
  refExists,
  fetchIncomingHashes,
} from '../../src/lib/incomingCommits';

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

describe('parseRefNames / refExists', () => {
  it('parses for-each-ref output into full refnames', () => {
    const refs = parseRefNames('refs/heads/main\nrefs/remotes/origin/main\nrefs/tags/v1\n');
    expect(refs.has('refs/heads/main')).toBe(true);
    expect(refs.has('refs/remotes/origin/main')).toBe(true);
    expect(refs.has('refs/tags/v1')).toBe(true);
    expect(refs.size).toBe(3);
  });

  it('matches short forms: local, remote, tag, and full refname', () => {
    const refs = parseRefNames('refs/heads/main\nrefs/remotes/origin/dev\nrefs/tags/v1\nrefs/heads/feature/x');
    expect(refExists('main', refs)).toBe(true);
    expect(refExists('origin/dev', refs)).toBe(true);
    expect(refExists('v1', refs)).toBe(true);
    expect(refExists('refs/heads/feature/x', refs)).toBe(true);
  });

  it('does NOT match when the ref is absent', () => {
    const refs = parseRefNames('refs/heads/v2\n');
    // The classic [gone] case: local v2 exists, origin/v2 does not.
    expect(refExists('origin/v2', refs)).toBe(false);
  });
});

describe('fetchIncomingHashes', () => {
  const REF_ARGS = ['for-each-ref', '--format=%(refname)'];

  it('valid refs → runs the scoped rev-list and parses its output', async () => {
    const raw = vi.fn(async (_p: string, args: string[]) => {
      if (args[0] === 'for-each-ref') {
        return 'refs/heads/v2\nrefs/remotes/origin/v2\n';
      }
      expect(args).toEqual(['rev-list', 'v2..origin/v2']);
      return 'aaaa1111\nbbbb2222\n';
    });
    const hashes = await fetchIncomingHashes(
      '/repo',
      { mode: 'head+upstream', currentBranch: 'v2', upstream: 'origin/v2' },
      raw,
    );
    expect([...hashes]).toEqual(['aaaa1111', 'bbbb2222']);
    expect(raw).toHaveBeenCalledTimes(2);
    // The ref-list call must use the pinned argv (shared with log()'s
    // validation so both hit the same main-process TTL cache entry).
    expect(raw.mock.calls[0][1]).toEqual(REF_ARGS);
  });

  it('gone upstream (origin/v2 pruned) → EMPTY set, rev-list NEVER spawned', async () => {
    const raw = vi.fn(async (_p: string, args: string[]) => {
      if (args[0] === 'for-each-ref') {
        // Local v2 exists; refs/remotes/origin/v2 was deleted on the remote.
        return 'refs/heads/v2\nrefs/heads/main\n';
      }
      throw new Error('fatal: ambiguous argument ' + args[1]);
    });
    const hashes = await fetchIncomingHashes(
      '/repo',
      { mode: 'head+upstream', currentBranch: 'v2', upstream: 'origin/v2' },
      raw,
    );
    expect(hashes.size).toBe(0);
    // Exactly ONE subprocess — the ref validation. The failing rev-list
    // (which produced the "Error occurred in handler for 'git:raw'" noise)
    // must not be spawned at all.
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0][1]).toEqual(REF_ARGS);
  });

  it('missing LOCAL side → empty set, no rev-list', async () => {
    const raw = vi.fn(async (_p: string, args: string[]) => {
      if (args[0] === 'for-each-ref') return 'refs/heads/main\nrefs/remotes/origin/v2\n';
      throw new Error('fatal');
    });
    const hashes = await fetchIncomingHashes(
      '/repo',
      { mode: 'head+upstream', currentBranch: 'v2', upstream: 'origin/v2' },
      raw,
    );
    expect(hashes.size).toBe(0);
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('ref-list call fails → falls through to the rev-list (old behavior)', async () => {
    const raw = vi.fn(async (_p: string, args: string[]) => {
      if (args[0] === 'for-each-ref') throw new Error('for-each-ref exploded');
      return 'cccc3333\n';
    });
    const hashes = await fetchIncomingHashes(
      '/repo',
      { mode: 'head+upstream', currentBranch: 'v2', upstream: 'origin/v2' },
      raw,
    );
    expect([...hashes]).toEqual(['cccc3333']);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('global scope → straight to the global rev-list, no ref validation', async () => {
    const raw = vi.fn(async (_p: string, args: string[]) => {
      expect(args).toEqual(['rev-list', '--remotes', '--not', '--branches']);
      return 'dddd4444\n';
    });
    const hashes = await fetchIncomingHashes('/repo', { mode: 'global' }, raw);
    expect([...hashes]).toEqual(['dddd4444']);
    expect(raw).toHaveBeenCalledTimes(1);
  });
});
