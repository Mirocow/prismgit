/**
 * Tests for the 3-way merge engine: diff3, alignRows, resolveConflicts.
 */
import { describe, it, expect } from 'vitest';
import { diff3, countConflicts, hasConflicts } from '../../src/lib/merge/diff3';
import { alignRows } from '../../src/lib/merge/alignRows';
import { buildAutoMergeResult, findConflictMarkers, isResultClean, resolveHunk } from '../../src/lib/merge/resolveConflicts';

describe('diff3', () => {
  it('returns empty for three empty inputs', () => {
    expect(diff3([], [], [])).toEqual([]);
  });

  it('classifies all-stable when all three sides are identical', () => {
    const r = diff3(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('stable');
  });

  it('classifies conflict when both sides changed the same line differently', () => {
    const r = diff3(['a', 'b', 'c'], ['a', 'OURS', 'c'], ['a', 'THEIRS', 'c']);
    expect(countConflicts(r)).toBe(1);
    expect(hasConflicts(r)).toBe(true);
  });

  it('classifies stable when both sides made the SAME change', () => {
    const r = diff3(['a', 'b', 'c'], ['a', 'SAME', 'c'], ['a', 'SAME', 'c']);
    expect(countConflicts(r)).toBe(0);
  });

  it('handles asymmetric changes (ours changed line1, theirs changed line2)', () => {
    const r = diff3(['line1', 'line2'], ['MAIN', 'line2'], ['line1', 'FEATURE']);
    const c = r.find(x => x.kind === 'conflict');
    expect(c).toBeDefined();
    expect(c!.oursLen).toBeGreaterThan(0);
    expect(c!.theirsLen).toBeGreaterThan(0);
  });

  it('handles empty base (no common ancestor)', () => {
    const r = diff3([], ['a', 'b'], ['c', 'd']);
    expect(hasConflicts(r)).toBe(true);
  });
});

describe('alignRows', () => {
  it('produces 1:1:1 rows for stable regions', () => {
    const r = diff3(['a', 'b'], ['a', 'b'], ['a', 'b']);
    const rows = alignRows(['a', 'b'], ['a', 'b'], ['a', 'b'], r);
    expect(rows.length).toBe(2);
    rows.forEach(row => { expect(row.regionKind).toBe('stable'); expect(row.isGhost.ours).toBe(false); });
  });

  it('produces ghost rows for the shorter side in a conflict', () => {
    const r = diff3(['a', 'b', 'c'], ['a', 'X1', 'X2', 'c'], ['a', 'Y', 'c']);
    const rows = alignRows(['a', 'b', 'c'], ['a', 'X1', 'X2', 'c'], ['a', 'Y', 'c'], r);
    const conflictRows = rows.filter(x => x.regionKind === 'conflict');
    expect(conflictRows.some(x => x.isGhost.theirs)).toBe(true);
  });
});

describe('resolveConflicts', () => {
  it('buildAutoMergeResult emits markers for true conflicts', () => {
    const r = diff3(['a', 'b', 'c'], ['a', 'OURS', 'c'], ['a', 'THEIRS', 'c']);
    const result = buildAutoMergeResult(['a', 'b', 'c'], ['a', 'OURS', 'c'], ['a', 'THEIRS', 'c'], r);
    expect(result).toContain('<<<<<<< ours');
    expect(result).toContain('=======');
    expect(result).toContain('>>>>>>> theirs');
  });

  it('findConflictMarkers returns line indices', () => {
    const lines = ['ctx', '<<<<<<< ours', 'content', '=======', 'theirs', '>>>>>>> theirs', 'ctx'];
    expect(findConflictMarkers(lines)).toEqual([1]);
  });

  it('isResultClean detects remaining markers', () => {
    expect(isResultClean(['a', 'b'])).toBe(true);
    expect(isResultClean(['a', '<<<<<<< ours', 'x', '>>>>>>> theirs'])).toBe(false);
  });

  it('resolveHunk replaces conflict with ours', () => {
    const base = ['a', 'b', 'c']; const ours = ['a', 'O', 'c']; const theirs = ['a', 'T', 'c'];
    const regions = diff3(base, ours, theirs);
    const result = buildAutoMergeResult(base, ours, theirs, regions);
    const markers = findConflictMarkers(result);
    const resolved = resolveHunk(result, markers, 0, 'ours', ours, theirs, base, regions);
    expect(resolved).toContain('O');
    expect(resolved).not.toContain('T');
    expect(resolved).not.toContain('<<<');
  });

  it('resolveHunk replaces conflict with both-ours-first', () => {
    const base = ['a', 'b', 'c']; const ours = ['a', 'O', 'c']; const theirs = ['a', 'T', 'c'];
    const regions = diff3(base, ours, theirs);
    const result = buildAutoMergeResult(base, ours, theirs, regions);
    const markers = findConflictMarkers(result);
    const resolved = resolveHunk(result, markers, 0, 'both-ours-first', ours, theirs, base, regions);
    expect(resolved).toContain('O');
    expect(resolved).toContain('T');
    expect(resolved.indexOf('O')).toBeLessThan(resolved.indexOf('T'));
  });
});
