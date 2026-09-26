/**
 * Unit tests for src/lib/prSquash.ts — the bridge between the provider
 * PR/MR commit lists (GitHub/GitLab REST) and SquashToBranchDialog, which
 * needs (a) LogEntry-shaped commits ordered OLDEST → NEWEST and (b) the
 * commit objects to exist in the LOCAL repository.
 *
 * Covers:
 *   1. prHeadRefspec — the canonical PR/MR head ref per provider.
 *   2. prCommitsToLogEntries — message/subject/body split, author mapping
 *      with fallbacks, order preservation (the provider APIs return
 *      oldest → newest, which squashToBranch requires).
 *   3. ensureCommitsLocal — all-present fast path (no fetch), fetch when
 *      SHAs are missing, fetch failure mapping, still-missing detection.
 *      All checks must be output-based (rev-parse --verify --quiet resolves
 *      to an EMPTY string on unknown SHAs — it does not throw).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRaw = vi.fn();
const mockFetchRef = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      raw: (...args: unknown[]) => mockRaw(...args),
      fetchRef: (...args: unknown[]) => mockFetchRef(...args),
    },
  },
}));

import {
  prHeadRefspec, prCommitsToLogEntries, ensureCommitsLocal,
} from '../../src/lib/prSquash';
import type { GithubPRCommit } from '../../src/lib/api';

const SHA1 = '1111111111111111111111111111111111111111';
const SHA2 = '2222222222222222222222222222222222222222';
const SHA3 = '3333333333333333333333333333333333333333';

function prCommit(sha: string, message: string, name = 'A. Author', email = 'a@x.io', date = '2026-09-01T10:00:00Z'): GithubPRCommit {
  return {
    sha,
    commit: { message, author: { name, email, date } },
    author: { login: 'author-login' },
    html_url: `https://example/c/${sha}`,
  };
}

describe('prHeadRefspec', () => {
  it('builds the canonical head ref for GitHub and GitLab', () => {
    expect(prHeadRefspec('github', 42)).toBe('refs/pull/42/head');
    expect(prHeadRefspec('gitlab', 7)).toBe('refs/merge-requests/7/head');
  });
});

describe('prCommitsToLogEntries', () => {
  it('splits subject/body, maps the author and preserves OLDEST→NEWEST order', () => {
    const entries = prCommitsToLogEntries([
      prCommit(SHA1, 'feat: one\n\nbody line 1\nbody line 2'),
      prCommit(SHA2, 'feat: two'),
    ]);
    expect(entries.map((e) => e.hash)).toEqual([SHA1, SHA2]);
    expect(entries[0].subject).toBe('feat: one');
    expect(entries[0].body).toBe('body line 1\nbody line 2');
    expect(entries[0].message).toContain('body line 2');
    expect(entries[0].author.name).toBe('A. Author');
    expect(entries[0].author.email).toBe('a@x.io');
    expect(entries[0].author.timestamp).toBe(Math.floor(Date.parse('2026-09-01T10:00:00Z') / 1000));
    expect(entries[1].subject).toBe('feat: two');
    expect(entries[1].body).toBe('');
  });

  it('falls back to the PR author login and a safe date when the git author is empty', () => {
    const c = prCommit(SHA3, 'x', '', '', '');
    const entries = prCommitsToLogEntries([c]);
    expect(entries[0].author.name).toBe('author-login');
    expect(entries[0].author.email).toBe('');
    expect(entries[0].author.timestamp).toBe(0);
  });
});

describe('ensureCommitsLocal', () => {
  beforeEach(() => {
    mockRaw.mockReset();
    mockFetchRef.mockReset();
  });

  it('returns ok WITHOUT fetching when every object is present', async () => {
    mockRaw.mockResolvedValue(`${SHA1}^{commit}\n`);
    const doFetch = vi.fn();
    const res = await ensureCommitsLocal('/repo', [SHA1, SHA2], doFetch);
    expect(res).toEqual({ ok: true });
    expect(doFetch).not.toHaveBeenCalled();
    expect(mockRaw).toHaveBeenCalledTimes(2);
    for (const call of mockRaw.mock.calls) {
      expect(call[1]).toEqual(
        expect.arrayContaining(['rev-parse', '--verify', '--quiet']),
      );
    }
  });

  it('fetches the PR head ref when SHAs are missing and re-checks only those', async () => {
    // SHA1 present, SHA2 + SHA3 missing BEFORE the fetch; all present after.
    let round = 0;
    mockRaw.mockImplementation((_p: string, args: string[]) => {
      const sha = args[3]?.replace('^{commit}', '');
      round++;
      if (round <= 3) return Promise.resolve(sha === SHA1 ? `${SHA1}\n` : '');
      return Promise.resolve(`${sha}\n`);
    });
    const doFetch = vi.fn().mockResolvedValue(undefined);
    const res = await ensureCommitsLocal('/repo', [SHA1, SHA2, SHA3], doFetch);
    expect(res).toEqual({ ok: true });
    expect(doFetch).toHaveBeenCalledTimes(1);
    // 3 initial checks + 2 re-checks (only the missing ones).
    expect(mockRaw).toHaveBeenCalledTimes(5);
  });

  it('maps a fetch failure to { fetch-failed } with the error message', async () => {
    mockRaw.mockResolvedValue('');
    const doFetch = vi.fn().mockRejectedValue(new Error('fatal: Authentication failed'));
    const res = await ensureCommitsLocal('/repo', [SHA1], doFetch);
    expect(res).toEqual({ ok: false, reason: 'fetch-failed', detail: 'fatal: Authentication failed' });
  });

  it('reports hashes that are STILL missing after the fetch', async () => {
    mockRaw.mockResolvedValue(''); // nothing ever resolves
    const doFetch = vi.fn().mockResolvedValue(undefined);
    const res = await ensureCommitsLocal('/repo', [SHA2, SHA3], doFetch);
    expect(res).toEqual({ ok: false, reason: 'missing', missing: [SHA2, SHA3] });
  });
});
