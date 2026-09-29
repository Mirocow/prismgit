/**
 * prStacks — Stacked PR/MR chain detection (provider-agnostic).
 *
 * «Жаль что не видно фишек гитхаба которых нет в гите типа "Stacked PRs"» —
 * stacked PRs are a HOSTING-layer concept: a chain of PRs where each PR's
 * target branch is another PR's source branch:
 *
 *     !4  feature/auth     → main            (bottom — merge FIRST)
 *     !5  feature/profile  → feature/auth    (stacked on !4)
 *     !6  feature/settings → feature/profile (stacked on !5)
 *
 * Reviewers see the chain on GitHub/GitLab (or via Graphite/ghstack-style
 * tooling) and know the merge ORDER: bottom-up. Neither git itself nor
 * PrismGit previously surfaced this — the PR list showed !4/!5/!6 as three
 * unrelated items.
 *
 * Detection is purely branch-linkage based (works on ANY provider, no
 * special API): PR X is "stacked on" PR Y iff X.base.ref === Y.head.ref.
 *
 * Chain semantics (deterministic, cycle-safe):
 *   - The chain for PR X = X's ancestor line (bottom → X) extended upward
 *     while the continuation is UNAMBIGUOUS (exactly one child per level).
 *   - Branch points (2+ PRs on the same base) terminate the upward
 *     extension: each branch member reports its own ancestor line, so
 *     every PR still gets a valid, merge-ordered view of its dependencies.
 *   - Multiple open PRs from ONE source branch: the FIRST open one (then
 *     most recently updated) carries the branch for chain purposes.
 *   - Cycles (A→B, B→A — possible with closed MRs) are cut by the visited
 *     set; the chain degenerates gracefully.
 */

/** Minimal PR shape — structurally compatible with UnifiedPR / SelectedPR,
 *  so members can be fed straight into selectPR() for navigation. */
export interface StackMember {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  html_url: string;
  author: { login: string; avatar_url?: string };
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
}

export interface PRStackInfo {
  /** The chain, bottom → top (the merge ORDER: members[0] merges first). */
  members: StackMember[];
  /** 0-based index of THIS PR in members. */
  position: number;
}

/** Which PR "owns" a branch for chain purposes: open beats closed/merged;
 *  newer update beats older. */
function ownsBranch(a: StackMember, b: StackMember): boolean {
  if (a.state === 'open' && b.state !== 'open') return true;
  if (a.state !== 'open' && b.state === 'open') return false;
  return a.updated_at > b.updated_at;
}

/** Compute the stack info for every PR in the list. PRs that are not part
 *  of any chain (chain length < 2) get NO entry. */
export function computePRStacks(prs: StackMember[]): Map<number, PRStackInfo> {
  const result = new Map<number, PRStackInfo>();
  if (prs.length === 0) return result;

  // branch → the PR that owns it as a SOURCE branch.
  const byHead = new Map<string, StackMember>();
  for (const p of prs) {
    const cur = byHead.get(p.head.ref);
    if (!cur || ownsBranch(p, cur)) byHead.set(p.head.ref, p);
  }

  /** X's stack parent: the PR whose source branch IS X's target branch. */
  const parentOf = (p: StackMember): StackMember | null => {
    const q = byHead.get(p.base.ref);
    return q && q.number !== p.number ? q : null;
  };

  // children: parent's head branch → PRs stacked directly on it.
  // Only PRs that OWN their head branch register as children — a closed
  // duplicate from the same source branch must not create a fake fork.
  const childrenOf = new Map<string, StackMember[]>();
  for (const p of prs) {
    if (byHead.get(p.head.ref) !== p) continue;
    const q = parentOf(p);
    if (!q) continue;
    const list = childrenOf.get(q.head.ref) ?? [];
    list.push(p);
    childrenOf.set(q.head.ref, list);
  }

  for (const p of prs) {
    // ── 1. Walk DOWN the parent links to the bottom of the stack. ────────
    const downPath: StackMember[] = [p]; // p, parent(p), grandparent…
    const seen = new Set<number>([p.number]);
    let cur: StackMember = p;
    while (true) {
      const q: StackMember | null = parentOf(cur);
      if (!q || seen.has(q.number)) break;
      seen.add(q.number);
      downPath.push(q);
      cur = q;
    }
    // Ancestor line, bottom → p.
    const ancestors = downPath.slice().reverse();

    // ── 2. Extend UP from p while exactly ONE child continues the line. ──
    const members = ancestors.slice();
    const seenUp = new Set<number>(members.map((m) => m.number));
    let top: StackMember = p;
    while (true) {
      const kids = (childrenOf.get(top.head.ref) ?? []).filter((k) => !seenUp.has(k.number));
      if (kids.length !== 1) break; // 0 (top) or 2+ (branch point) — stop
      members.push(kids[0]);
      seenUp.add(kids[0].number);
      top = kids[0];
    }

    if (members.length < 2) continue;
    const position = members.findIndex((m) => m.number === p.number);
    if (position === -1) continue; // defensive — cannot happen by construction
    result.set(p.number, { members, position });
  }

  return result;
}

/** Human-readable chain for tooltips: "!4 ← !5 ← !6" (bottom first). */
export function formatStackChain(
  members: StackMember[],
  provider: 'github' | 'gitlab',
  maxLength = 6,
): string {
  const prefix = provider === 'gitlab' ? '!' : '#';
  const shown = members.slice(0, maxLength);
  const chain = shown.map((m) => `${prefix}${m.number}`).join(' \u2190 ');
  return members.length > maxLength
    ? `${chain} \u2026 +${members.length - maxLength}`
    : chain;
}
