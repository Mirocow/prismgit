/**
 * Unit tests for src/lib/patchStaging.ts — patch-level staging logic
 * (shared between Electron and Tauri backends, pure JS).
 *
 * Covers:
 *   - parseUnifiedZero: -U0 diff parsing, hunk types (add/del/mixed)
 *   - filterPureHunks: line-range filtering with recomputed zero-context
 *     headers (subset, full-keep, skip-empty)
 *   - filterMixedHunks: all-or-nothing semantics (git add -p parity)
 *   - buildFilteredPatch: end-to-end assembly + null on empty selection
 */
import { describe, it, expect } from 'vitest';
import {
  parseUnifiedZero,
  filterPureHunks,
  filterMixedHunks,
  buildFilteredPatch,
} from '../../src/lib/patchStaging';

const ADD_HUNK_DIFF = [
  'diff --git a/src/new.ts b/src/new.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1,4 @@',
  '+one',
  '+two',
  '+three',
  '+four',
].join('\n');

const DEL_HUNK_DIFF = [
  'diff --git a/src/old.ts b/src/old.ts',
  '--- a/src/old.ts',
  '+++ b/src/old.ts',
  '@@ -1,4 +0,0 @@',
  '-one',
  '-two',
  '-three',
  '-four',
].join('\n');

const MIXED_HUNK_DIFF = [
  'diff --git a/src/both.ts b/src/both.ts',
  '--- a/src/both.ts',
  '+++ b/src/both.ts',
  '@@ -1,2 +1,2 @@',
  '-old first',
  '-old second',
  '+new first',
  '+new second',
].join('\n');

describe('parseUnifiedZero', () => {
  it('parses an add-only diff: header + one add hunk with 4 lines', () => {
    const { header, hunks } = parseUnifiedZero(ADD_HUNK_DIFF);
    expect(header).toContain('diff --git a/src/new.ts');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
    expect(hunks[0].lines).toEqual(['+one', '+two', '+three', '+four']);
    expect(hunks[0].header).toBe('@@ -0,0 +1,4 @@');
  });

  it('parses a del-only diff with type=del', () => {
    const { hunks } = parseUnifiedZero(DEL_HUNK_DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('del');
    expect(hunks[0].lines).toHaveLength(4);
  });

  it('classifies interleaved +/- as mixed', () => {
    // The parser sees '-' first, then '+' → type becomes 'mixed' once a
    // line of the opposite sign joins the hunk.
    const { hunks } = parseUnifiedZero(MIXED_HUNK_DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('mixed');
  });

  it('returns empty hunks for a diff without @@ headers', () => {
    const { header, hunks } = parseUnifiedZero('no hunk here\nnothing');
    expect(hunks).toEqual([]);
    expect(header).toBe('');
  });

  it('splits multiple hunks and stops at a following diff --git', () => {
    const twoFiles = [
      ADD_HUNK_DIFF,
      'diff --git a/other.ts b/other.ts',
      '--- a/other.ts',
      '+++ b/other.ts',
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
    ].join('\n');
    const { hunks } = parseUnifiedZero(twoFiles);
    // The second file's hunk is a SEPARATE diff — the parser stops at
    // 'diff --git', so only the first file's hunks are returned.
    expect(hunks).toHaveLength(1);
  });
});

describe('filterPureHunks — add hunks', () => {
  const { hunks } = parseUnifiedZero(ADD_HUNK_DIFF);

  it('keeps the whole hunk when every line is selected', () => {
    const out = filterPureHunks(hunks, [{ start: 1, end: 4 }]);
    expect(out).toEqual(['@@ -0,0 +1,4 @@', '+one', '+two', '+three', '+four']);
  });

  it('keeps a subset with a recomputed @@ header', () => {
    // Select new-file lines 2..3 ("two", "three").
    const out = filterPureHunks(hunks, [{ start: 2, end: 3 }]);
    expect(out[0]).toBe('@@ -1,0 +2,2 @@');
    expect(out.slice(1)).toEqual(['+two', '+three']);
  });

  it('skips the hunk entirely when no line is selected', () => {
    expect(filterPureHunks(hunks, [{ start: 9, end: 10 }])).toEqual([]);
  });

  it('merges disjoint ranges into one contiguous keep-set', () => {
    // Lines 1 and 4 selected — output keeps both (contiguous run in the
    // resulting patch, since -U0 has no context).
    const out = filterPureHunks(hunks, [{ start: 1, end: 1 }, { start: 4, end: 4 }]);
    expect(out[0]).toContain('+1,2 @@');
    expect(out.slice(1)).toEqual(['+one', '+four']);
  });
});

describe('filterPureHunks — del hunks', () => {
  const { hunks } = parseUnifiedZero(DEL_HUNK_DIFF);

  it('keeps a subset of deletions with recomputed header', () => {
    // Old-file lines 2..3 ("two", "three") — new side becomes -1,0.
    const out = filterPureHunks(hunks, [{ start: 2, end: 3 }]);
    expect(out[0]).toBe('@@ -2,2 +1,0 @@');
    expect(out.slice(1)).toEqual(['-two', '-three']);
  });

  it('full selection keeps the original header', () => {
    const out = filterPureHunks(hunks, [{ start: 1, end: 4 }]);
    expect(out[0]).toBe('@@ -1,4 +0,0 @@');
    expect(out).toHaveLength(5);
  });
});

describe('filterMixedHunks — all-or-nothing (git add -p parity)', () => {
  const { hunks } = parseUnifiedZero(MIXED_HUNK_DIFF);

  it('keeps the whole mixed hunk when an old line is selected', () => {
    // Old line 1 ("old first") selected → whole hunk kept.
    const out = filterMixedHunks(hunks, [{ start: 1, end: 1 }]);
    expect(out).toHaveLength(5); // header + 4 lines
    expect(out[0]).toBe('@@ -1,2 +1,2 @@');
  });

  it('keeps the whole mixed hunk when a new line is selected', () => {
    // New line 2 ("new second") selected → whole hunk kept.
    const out = filterMixedHunks(hunks, [{ start: 2, end: 2 }]);
    expect(out).toHaveLength(5);
  });

  it('drops the hunk when neither old nor new lines are selected', () => {
    // Lines 3+ on both sides — nothing in this 2-line hunk.
    expect(filterMixedHunks(hunks, [{ start: 3, end: 8 }])).toEqual([]);
  });
});

describe('buildFilteredPatch — end to end', () => {
  it('assembles header + filtered hunks into an applicable patch', () => {
    const patch = buildFilteredPatch(ADD_HUNK_DIFF, [{ start: 2, end: 3 }]);
    expect(patch).toBeTruthy();
    expect(patch!.split('\n')[0]).toContain('diff --git a/src/new.ts');
    expect(patch).toContain('@@ -1,0 +2,2 @@');
    expect(patch!.endsWith('\n')).toBe(true);
  });

  it('returns null when the diff has no hunks', () => {
    expect(buildFilteredPatch('nothing', [{ start: 1, end: 2 }])).toBeNull();
  });

  it('returns null when the selection matches nothing', () => {
    expect(buildFilteredPatch(ADD_HUNK_DIFF, [{ start: 100, end: 200 }])).toBeNull();
  });
});
