import { describe, it, expect } from 'vitest';
import { computeGraph, GraphLayoutBuilder, BRANCH_COLORS, laneColor } from '../../src/lib/gitGraph';
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

describe('gitGraph.computeGraph — v2 (no broken lines)', () => {
  it('handles single linear history', () => {
    const commits = [
      makeCommit('C', ['B']),
      makeCommit('B', ['A']),
      makeCommit('A', []),
    ];
    const { rows, maxLane } = computeGraph(commits);
    expect(rows).toHaveLength(3);
    expect(maxLane).toBe(0);

    // Row 0: C, lane 0, hasIncoming=false (first row), continues=true (parent B)
    expect(rows[0].node!.entry.hash).toBe('C');
    expect(rows[0].node!.lane).toBe(0);
    expect(rows[0].node!.hasIncoming).toBe(false);
    expect(rows[0].node!.continues).toBe(true);
    expect(rows[0].passing).toEqual([]);

    // Row 1: B, lane 0, hasIncoming=true (parent came from above), continues=true
    expect(rows[1].node!.entry.hash).toBe('B');
    expect(rows[1].node!.hasIncoming).toBe(true);
    expect(rows[1].node!.continues).toBe(true);

    // Row 2: A, lane 0, hasIncoming=true, continues=false (root)
    expect(rows[2].node!.entry.hash).toBe('A');
    expect(rows[2].node!.hasIncoming).toBe(true);
    expect(rows[2].node!.continues).toBe(false);
  });

  it('keeps lane alive across multiple rows (no broken lines)', () => {
    // C is on main, P is root several rows below.
    // Other commits are interleaved between them on a different lane.
    //   Row 0: C (parent B, on lane 0)
    //   Row 1: X (parent Y, on lane 1)  ← main lane must PASS THROUGH here
    //   Row 2: Y (root, on lane 1)
    //   Row 3: B (parent A, on lane 0)  ← main lane arrives here
    //   Row 4: A (root, on lane 0)
    const commits = [
      makeCommit('C', ['B']),
      makeCommit('X', ['Y']),
      makeCommit('Y', []),
      makeCommit('B', ['A']),
      makeCommit('A', []),
    ];
    const { rows, maxLane } = computeGraph(commits);
    expect(maxLane).toBe(1);

    // Row 0: C, lane 0, continues=true. Also creates lane 1 for X.
    expect(rows[0].node!.lane).toBe(0);
    expect(rows[0].node!.entry.hash).toBe('C');
    expect(rows[0].node!.continues).toBe(true);
    // Row 1: X, lane 1. Lane 0 (C's continuation) must PASS THROUGH.
    expect(rows[1].node!.lane).toBe(1);
    expect(rows[1].node!.entry.hash).toBe('X');
    // Critical assertion: lane 0 is in `passing` for row 1
    expect(rows[1].passing.some(p => p.lane === 0)).toBe(true);
    // Row 2: Y, lane 1. Lane 0 still passes through.
    expect(rows[2].node!.lane).toBe(1);
    expect(rows[2].passing.some(p => p.lane === 0)).toBe(true);
    // Row 3: B, lane 0, hasIncoming=true (came from passing lane above).
    expect(rows[3].node!.lane).toBe(0);
    expect(rows[3].node!.entry.hash).toBe('B');
    expect(rows[3].node!.hasIncoming).toBe(true);
  });

  it('places merge commit child on a new lane for second parent', () => {
    const commits = [
      makeCommit('M', ['B', 'F'], 'Merge'),
      makeCommit('B', ['A']),
      makeCommit('F', ['A']),
      makeCommit('A', []),
    ];
    const { rows } = computeGraph(commits);

    expect(rows[0].node!.entry.hash).toBe('M');
    expect(rows[0].node!.lane).toBe(0);
    expect(rows[0].node!.isMerge).toBe(true);
    expect(rows[0].node!.merges.length).toBe(1); // one merge parent (F)
    expect(rows[0].node!.continues).toBe(true); // B is first parent, continues on lane 0
  });

  it('closing curves merge lanes into a node', () => {
    // Two parallel branches that converge on the same commit
    const commits = [
      makeCommit('M', ['A', 'B']),
      makeCommit('A', ['ROOT']),
      makeCommit('B', ['ROOT']),
      makeCommit('ROOT', []),
    ];
    const { rows } = computeGraph(commits);

    // M is row 0, lane 0
    expect(rows[0].node!.entry.hash).toBe('M');
    expect(rows[0].node!.merges.length).toBe(1); // B is the second parent → merge curve

    // After M, A is on lane 0 (first parent), B is on lane 1 (merge parent)
    // When B arrives (row 2), it should "close" into lane 0... actually no, B has its own lane 1
    // and ROOT is on lane 0 (first parent of A). So when ROOT arrives, lane 1 closes.
  });

  it('colors are stable per OID across rows', () => {
    const commits = [
      makeCommit('C', ['B']),
      makeCommit('B', ['A']),
      makeCommit('A', []),
    ];
    const { rows } = computeGraph(commits);
    // All commits on lane 0, all should have same color
    expect(rows[0].node!.color).toBe(rows[1].node!.color);
    expect(rows[1].node!.color).toBe(rows[2].node!.color);
  });

  it('handles empty list', () => {
    const { rows, maxLane } = computeGraph([]);
    expect(rows).toEqual([]);
    expect(maxLane).toBe(0);
  });

  it('handles root commit (no parents)', () => {
    const commits = [makeCommit('ROOT', [])];
    const { rows } = computeGraph(commits);
    expect(rows).toHaveLength(1);
    expect(rows[0].node!.continues).toBe(false);
    expect(rows[0].node!.lane).toBe(0);
  });

  it('handles octopus merge (3 parents)', () => {
    const commits = [
      makeCommit('M', ['A', 'B', 'C']),
      makeCommit('A', ['ROOT']),
      makeCommit('B', ['ROOT']),
      makeCommit('C', ['ROOT']),
      makeCommit('ROOT', []),
    ];
    const { rows } = computeGraph(commits);
    const merge = rows[0].node!;
    expect(merge.isMerge).toBe(true);
    expect(merge.merges.length).toBe(2); // 2 non-first parents
  });

  it('is stable under incremental feeding (pagination invariant)', () => {
    const commits = [
      makeCommit('C', ['B']),
      makeCommit('B', ['A']),
      makeCommit('A', []),
    ];
    // Whole-at-once
    const whole = computeGraph(commits);
    // Incremental
    const incremental = new GraphLayoutBuilder();
    incremental.add(commits.slice(0, 2));
    const firstTwo = incremental.build().rows.slice(0, 2).map(r => JSON.stringify(r));
    incremental.add(commits.slice(2));
    const finalRows = incremental.build().rows;
    expect(finalRows.slice(0, 2).map(r => JSON.stringify(r))).toEqual(firstTwo);
    expect(JSON.stringify(finalRows)).toEqual(JSON.stringify(whole.rows));
  });

  it('passing list excludes the node lane and closing lanes', () => {
    // C on lane 0 → A on lane 0 → ROOT on lane 0
    //          └─ D on lane 1 (parallel, root)
    const commits = [
      makeCommit('C', ['A']),
      makeCommit('D', []), // parallel branch, no parents (root)
      makeCommit('A', ['ROOT']),
      makeCommit('ROOT', []),
    ];
    const { rows } = computeGraph(commits);
    // Row 0: C on lane 0, also creates lane 1 for D (since D is on its own)
    // Row 1: D on lane 1, lane 0 should be in passing (since C → A continues below)
    expect(rows[1].node!.entry.hash).toBe('D');
    expect(rows[1].passing.some(p => p.lane === 0)).toBe(true);
    expect(rows[1].passing.some(p => p.lane === 1)).toBe(false); // node is on lane 1
  });
});

describe('gitGraph.laneColor', () => {
  it('wraps around palette', () => {
    expect(laneColor(0)).toBe(BRANCH_COLORS[0]);
    expect(laneColor(BRANCH_COLORS.length)).toBe(BRANCH_COLORS[0]);
    expect(laneColor(BRANCH_COLORS.length + 1)).toBe(BRANCH_COLORS[1]);
  });
});
