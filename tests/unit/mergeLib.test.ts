/**
 * Tests for the 3-way merge engine: diff3, alignRows, resolveConflicts.
 */
import { describe, it, expect } from 'vitest';
import { diff3, countConflicts, hasConflicts } from '../../src/lib/merge/diff3';
import { alignRows } from '../../src/lib/merge/alignRows';
import type { Region } from '../../src/lib/merge/mergeTypes';
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

  // REGRESSION (found by the e2e conflict-resolution run): with the
  // trailing '' that `content.split('\n')` produces from `git show`
  // output, a stale anchor behind the walk cursor emitted a duplicate
  // stable region; after merging, the region lengths overcounted and
  // buildAutoMergeResult read past the array end (undefined lines →
  // 'Cannot read properties of undefined (reading startsWith)' toast in
  // MergeEditor3Way → "No conflict markers found").
  it('trailing-newline input (git show output) never overruns the arrays', () => {
    const base = 'original line 1\noriginal line 2\noriginal line 3\n'.split('\n');
    const ours = 'original line 1\nMAIN changed this line\noriginal line 3\n'.split('\n');
    const theirs = 'original line 1\nFEATURE changed this line\noriginal line 3\n'.split('\n');
    const regions = diff3(base, ours, theirs);
    // Every region stays within all three arrays.
    for (const r of regions) {
      expect(r.baseStart + r.baseLen).toBeLessThanOrEqual(base.length);
      expect(r.oursStart + r.oursLen).toBeLessThanOrEqual(ours.length);
      expect(r.theirsStart + r.theirsLen).toBeLessThanOrEqual(theirs.length);
    }
    expect(countConflicts(regions)).toBe(1);
    const auto = buildAutoMergeResult(base, ours, theirs, regions);
    // No undefined lines ever leak into the result.
    expect(auto.every((l) => typeof l === 'string')).toBe(true);
    // The conflict markers survive — the 3-way editor needs them.
    const markers = findConflictMarkers(auto);
    expect(markers).toHaveLength(1);
    expect(auto.join('\n')).toContain('<<<<<<<');
    expect(auto.join('\n')).toContain('>>>>>>>');
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

describe('buildAutoMergeResult hardening (user-reported crash)', () => {
  // EXACT regression of the user-reported toast:
  //   "Не удалось загрузить конфликт
  //    TypeError: Cannot read properties of undefined (reading 'startsWith')"
  // Root cause: the conflict branch of buildAutoMergeResult read
  // ours/theirs lines WITHOUT the `?? ''` out-of-bounds guard that the
  // other three branches already had. A conflict region with over-counted
  // lengths (stale-anchor duplicate after mergeAdjacentRegions) pushed
  // `undefined` into the Result; findConflictMarkers then called
  // `.startsWith()` on it.
  it('conflict regions that read past the array end never emit undefined lines', () => {
    const base = ['a'];
    const ours = ['b'];
    const theirs = ['c'];
    // Hand-crafted over-counted region: lens far beyond the 1-line arrays.
    const bogus: Region[] = [{
      kind: 'conflict', baseStart: 0, baseLen: 5,
      oursStart: 0, oursLen: 9,
      theirsStart: 0, theirsLen: 7,
    }];
    const result = buildAutoMergeResult(base, ours, theirs, bogus);
    expect(result.every((l) => typeof l === 'string')).toBe(true);
    // Markers still bracket the (padded) blocks — the editor stays usable.
    expect(result[0]).toBe('<<<<<<< ours');
    expect(result).toContain('=======');
    expect(result[result.length - 1]).toBe('>>>>>>> theirs');
    // The consumers that previously crashed must survive:
    expect(() => findConflictMarkers(result)).not.toThrow();
    expect(() => isResultClean(result)).not.toThrow();
  });

  it('all consumers tolerate undefined holes in the Result array', () => {
    const lines = ['ctx', '<<<<<<< ours', undefined as unknown as string, '=======', '>>>>>>> theirs'];
    expect(() => findConflictMarkers(lines)).not.toThrow();
    expect(findConflictMarkers(lines)).toEqual([1]);
    expect(() => isResultClean(lines)).not.toThrow();
    expect(isResultClean(lines)).toBe(false);
  });

  it('resolveHunk end-walk tolerates undefined lines', () => {
    const result = ['<<<<<<< ours', 'a', undefined as unknown as string, '=======', 'b', '>>>>>>> theirs', 'ctx'];
    const regions: Region[] = [{
      kind: 'conflict', baseStart: 0, baseLen: 0, oursStart: 0, oursLen: 1, theirsStart: 0, theirsLen: 1,
    }];
    expect(() => resolveHunk(result, [0], 0, 'ours', ['a'], ['b'], [], regions)).not.toThrow();
  });
});

describe('buildAutoMergeResult stable semantics', () => {
  it('keeps the AGREED change when both sides made the same edit (does not revert to base)', () => {
    // Both branches changed 'b' → 'SAME'. git auto-resolves this; our
    // merged Result must keep 'SAME', not silently take base's 'b'.
    const base = ['a', 'b', 'c'];
    const ours = ['a', 'SAME', 'c'];
    const theirs = ['a', 'SAME', 'c'];
    const regions = diff3(base, ours, theirs);
    const result = buildAutoMergeResult(base, ours, theirs, regions);
    expect(result).toEqual(['a', 'SAME', 'c']);
    expect(result.join('\n')).not.toContain('<<<<<<<');
  });

  it('keeps the agreed content when base is empty (add/add with same content)', () => {
    const base: string[] = [];
    const ours = ['new file line 1', 'line 2'];
    const theirs = ['new file line 1', 'line 2'];
    const regions = diff3(base, ours, theirs);
    const result = buildAutoMergeResult(base, ours, theirs, regions);
    expect(result.every((l) => typeof l === 'string')).toBe(true);
    expect(result).toContain('new file line 1');
  });

  it('fallback shape (HEAD, HEAD, worktree) yields the worktree body — the no-commit case', () => {
    // When the file has no unmerged stages (e.g. a repo with NO COMMITS),
    // MergeEditor3Way falls back to diff3(HEAD, HEAD, worktree) with
    // HEAD='' (unborn). The auto-merge result must equal the worktree
    // body so the editable center pane shows the change itself.
    const head: string[] = [];
    const worktree = ['hello', 'world'];
    const regions = diff3(head, head, worktree);
    const result = buildAutoMergeResult(head, head, worktree, regions);
    expect(result.join('\n')).toBe(worktree.join('\n'));
    expect(findConflictMarkers(result)).toHaveLength(0);
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
