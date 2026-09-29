/**
 * Unit tests for src/lib/prStacks.ts — stacked PR/MR chain detection.
 *
 * Chains are built from branch linkage: X stacked on Y iff X.base.ref ===
 * Y.head.ref. These tests pin the semantics the UI relies on: merge order
 * (bottom first), position badges, branch-point behavior, cycles, and the
 * tooltip formatter.
 */
import { describe, it, expect } from 'vitest';
import { computePRStacks, formatStackChain, type StackMember } from '../../src/lib/prStacks';

let n = 0;
const mk = (head: string, base: string, over: Partial<StackMember> = {}): StackMember => ({
  number: ++n,
  title: `${head} → ${base}`,
  state: 'open',
  html_url: `https://example.test/pr/${n}`,
  author: { login: 'tester' },
  head: { ref: head, sha: 'abc' },
  base: { ref: base, sha: 'def' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  ...over,
});

describe('computePRStacks', () => {
  it('empty list → no stacks', () => {
    expect(computePRStacks([]).size).toBe(0);
  });

  it('single PR → no stack (chain length < 2)', () => {
    const stacks = computePRStacks([mk('feature/a', 'main')]);
    expect(stacks.size).toBe(0);
  });

  it('unrelated PRs (no shared branches) → no stacks', () => {
    const stacks = computePRStacks([
      mk('feature/a', 'main'),
      mk('feature/b', 'main'),
    ]);
    expect(stacks.size).toBe(0);
  });

  it('linear chain of 3 — every member sees the FULL chain, merge order bottom-first', () => {
    const a = mk('auth', 'main');        // bottom  (!1)
    const b = mk('profile', 'auth');     // middle  (!2)
    const c = mk('settings', 'profile'); // top     (!3)
    const stacks = computePRStacks([a, b, c]);

    expect(stacks.size).toBe(3);
    for (const pr of [a, b, c]) {
      const info = stacks.get(pr.number)!;
      expect(info.members.map((m) => m.number)).toEqual([a.number, b.number, c.number]);
    }
    expect(stacks.get(a.number)!.position).toBe(0);
    expect(stacks.get(b.number)!.position).toBe(1);
    expect(stacks.get(c.number)!.position).toBe(2);
  });

  it('chain of 2 — badge data on both', () => {
    const a = mk('base-br', 'main');
    const b = mk('top-br', 'base-br');
    const stacks = computePRStacks([a, b]);
    expect(stacks.size).toBe(2);
    expect(stacks.get(a.number)!.position).toBe(0);
    expect(stacks.get(b.number)!.position).toBe(1);
  });

  it('branch point: two PRs stacked on the SAME base — upward extension stops, each keeps its ancestor line', () => {
    const a = mk('auth', 'main');          // bottom
    const b1 = mk('profile', 'auth');      // branch 1
    const b2 = mk('billing', 'auth');      // branch 2
    const stacks = computePRStacks([a, b1, b2]);

    // The bottom PR sees only itself + nothing unambiguous → no extension:
    // its single-child continuation is ambiguous → chain length 1 → NO entry.
    expect(stacks.get(a.number)).toBeUndefined();
    // Each branch member sees its own 2-member ancestor line [a, itself].
    expect(stacks.get(b1.number)!.members.map((m) => m.number)).toEqual([a.number, b1.number]);
    expect(stacks.get(b1.number)!.position).toBe(1);
    expect(stacks.get(b2.number)!.members.map((m) => m.number)).toEqual([a.number, b2.number]);
    expect(stacks.get(b2.number)!.position).toBe(1);
  });

  it('branch with a single continuation extends past the fork member', () => {
    // main ← auth ← profile (fork) ; profile has ONE child settings.
    const a = mk('auth', 'main');
    const fork = mk('profile', 'auth');
    const c = mk('settings', 'profile');
    const stacks = computePRStacks([a, fork, c]);
    // fork's chain: [auth, profile] (+ settings: single child → extended)
    expect(stacks.get(fork.number)!.members.map((m) => m.number))
      .toEqual([a.number, fork.number, c.number]);
    // c's chain: its ancestor line [auth, profile, settings]
    expect(stacks.get(c.number)!.members.map((m) => m.number))
      .toEqual([a.number, fork.number, c.number]);
  });

  it('cycle (A on B, B on A) is cut safely — no infinite loop, degenerate chains', () => {
    const a = mk('br-a', 'br-b');
    const b = mk('br-b', 'br-a');
    const stacks = computePRStacks([a, b]);
    // Whatever comes out must be finite and consistent:
    for (const info of stacks.values()) {
      expect(info.members.length).toBeLessThanOrEqual(2);
      expect(new Set(info.members.map((m) => m.number)).size).toBe(info.members.length);
    }
  });

  it('a PR is never its own parent (same head/base branch self-link ignored)', () => {
    // Weird data: PR whose base.ref equals its own head.ref.
    const a = mk('br-x', 'br-x');
    const stacks = computePRStacks([a]);
    expect(stacks.size).toBe(0);
  });

  it('multiple PRs from ONE source branch: the OPEN one owns the chain, closed are shadowed', () => {
    const bottom = mk('auth', 'main');
    const openTop = mk('profile', 'auth', { state: 'open', updated_at: '2026-03-01T00:00:00Z' });
    const closedTop = mk('profile', 'auth', { state: 'closed', updated_at: '2026-02-01T00:00:00Z' });
    const stacks = computePRStacks([bottom, closedTop, openTop]);

    // Both tops resolve their parent to the same bottom; the chain from the
    // bottom's perspective extends through the OPEN child only.
    const bottomInfo = stacks.get(bottom.number);
    expect(bottomInfo).toBeDefined();
    expect(bottomInfo!.members.map((m) => m.number)).toEqual([bottom.number, openTop.number]);
  });

  it('merged bottom + open top still chain (state filter "all")', () => {
    const a = mk('auth', 'main', { state: 'merged', merged_at: '2026-01-05T00:00:00Z' });
    const b = mk('profile', 'auth');
    const stacks = computePRStacks([a, b]);
    expect(stacks.get(b.number)!.members.map((m) => m.number)).toEqual([a.number, b.number]);
    // The merged bottom: single child → chain [a, b], still badged.
    expect(stacks.get(a.number)!.members.length).toBe(2);
  });

  it('members carry the full navigation shape (selectPR-compatible)', () => {
    const a = mk('auth', 'main');
    const b = mk('profile', 'auth');
    const stacks = computePRStacks([a, b]);
    const m = stacks.get(b.number)!.members[0];
    // Fields PRReview/PullRequestsPage need for navigation all present:
    expect(m.number).toBe(a.number);
    expect(m.title).toBe(a.title);
    expect(m.html_url).toBe(a.html_url);
    expect(m.head.ref).toBe('auth');
    expect(m.base.ref).toBe('main');
    expect(m.state).toBe('open');
    expect(m.author.login).toBe('tester');
  });
});

describe('formatStackChain', () => {
  const member = (num: number) => mk(`br${num}`, 'main', { number: num });

  it('gitLab prefix (!) — bottom first, ← separators', () => {
    const chain = [member(4), member(5), member(6)];
    expect(formatStackChain(chain, 'gitlab')).toBe('!4 \u2190 !5 \u2190 !6');
  });

  it('github prefix (#)', () => {
    const chain = [member(4), member(5)];
    expect(formatStackChain(chain, 'github')).toBe('#4 \u2190 #5');
  });

  it('long chains are truncated with an overflow marker', () => {
    const chain = [1, 2, 3, 4, 5, 6, 7, 8].map(member);
    const out = formatStackChain(chain, 'gitlab', 6);
    expect(out).toContain('\u2026');
    expect(out).toContain('+2');
    expect(out).not.toContain('!8');
  });
});
