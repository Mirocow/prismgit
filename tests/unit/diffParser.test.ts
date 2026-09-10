import { describe, it, expect } from 'vitest';
import { parseDiff, countDiffStats, isBinaryDiff } from '../../src/lib/diffParser';

describe('parseDiff', () => {
  it('returns empty for empty diff', () => {
    const result = parseDiff('');
    expect(result.hunks).toEqual([]);
    expect(result.newFile).toBe(false);
    expect(result.deletedFile).toBe(false);
    expect(result.renamedFile).toBe(false);
  });

  it('parses a simple hunk', () => {
    const rawDiff = [
      'diff --git a/file.txt b/file.txt',
      'index 1234567..abcdefg 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,3 +1,3 @@',
      ' line1',
      '-old line2',
      '+new line2',
      ' line3',
    ].join('\n');

    const result = parseDiff(rawDiff);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[0].oldLines).toBe(3);
    expect(result.hunks[0].newStart).toBe(1);
    expect(result.hunks[0].newLines).toBe(3);
    expect(result.hunks[0].lines).toHaveLength(4);
    expect(result.hunks[0].lines[0].type).toBe('context');
    expect(result.hunks[0].lines[0].content).toBe('line1');
    expect(result.hunks[0].lines[0].oldLineNumber).toBe(1);
    expect(result.hunks[0].lines[0].newLineNumber).toBe(1);
    expect(result.hunks[0].lines[1].type).toBe('del');
    expect(result.hunks[0].lines[1].content).toBe('old line2');
    expect(result.hunks[0].lines[1].oldLineNumber).toBe(2);
    expect(result.hunks[0].lines[1].newLineNumber).toBeNull();
    expect(result.hunks[0].lines[2].type).toBe('add');
    expect(result.hunks[0].lines[2].content).toBe('new line2');
    expect(result.hunks[0].lines[2].oldLineNumber).toBeNull();
    expect(result.hunks[0].lines[2].newLineNumber).toBe(2);
    expect(result.hunks[0].lines[3].type).toBe('context');
    expect(result.hunks[0].lines[3].content).toBe('line3');
  });

  it('detects new file', () => {
    const rawDiff = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..1234567',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+line1',
      '+line2',
    ].join('\n');

    const result = parseDiff(rawDiff);
    expect(result.newFile).toBe(true);
  });

  it('detects deleted file', () => {
    const rawDiff = [
      'diff --git a/old.txt b/old.txt',
      'deleted file mode 100644',
      'index 1234567..0000000',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line1',
      '-line2',
    ].join('\n');

    const result = parseDiff(rawDiff);
    expect(result.deletedFile).toBe(true);
  });

  it('detects renamed file', () => {
    const rawDiff = [
      'diff --git a/old.txt b/new.txt',
      'similarity index 100%',
      'rename from old.txt',
      'rename to new.txt',
    ].join('\n');

    const result = parseDiff(rawDiff);
    expect(result.renamedFile).toBe(true);
  });

  it('parses multiple hunks', () => {
    const rawDiff = [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-old',
      '+new',
      '@@ -10,2 +10,2 @@',
      ' line10',
      '-old10',
      '+new10',
    ].join('\n');

    const result = parseDiff(rawDiff);
    expect(result.hunks).toHaveLength(2);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[1].oldStart).toBe(10);
  });

  it('handles mode change', () => {
    const rawDiff = [
      'diff --git a/script.sh b/script.sh',
      'old mode 100644',
      'new mode 100755',
    ].join('\n');

    const result = parseDiff(rawDiff);
    expect(result.modeChange).toEqual({ oldMode: 100644, newMode: 100755 });
  });

  it('handles single-line hunk headers (no comma)', () => {
    const rawDiff = [
      '@@ -5 +5 @@',
      ' context',
      '-old',
      '+new',
    ].join('\n');

    const result = parseDiff(rawDiff);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldLines).toBe(1);
    expect(result.hunks[0].newLines).toBe(1);
  });
});

describe('countDiffStats', () => {
  it('returns zeros for empty hunks', () => {
    expect(countDiffStats([])).toEqual({ additions: 0, deletions: 0 });
  });

  it('counts additions and deletions', () => {
    const rawDiff = [
      '@@ -1,4 +1,4 @@',
      ' line1',
      '-old1',
      '-old2',
      '+new1',
      ' line2',
    ].join('\n');
    const { hunks } = parseDiff(rawDiff);
    expect(countDiffStats(hunks)).toEqual({ additions: 1, deletions: 2 });
  });

  it('counts across multiple hunks', () => {
    const rawDiff = [
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      '@@ -10,2 +10,2 @@',
      '-old10',
      '+new10',
      '+new11',
    ].join('\n');
    const { hunks } = parseDiff(rawDiff);
    expect(countDiffStats(hunks)).toEqual({ additions: 3, deletions: 2 });
  });
});

describe('isBinaryDiff', () => {
  it('returns false for text diff', () => {
    expect(isBinaryDiff('diff --git a/file b/file\n@@ -1 +1 @@\n+text')).toBe(false);
  });

  it('returns true for "Binary files" marker', () => {
    expect(isBinaryDiff('Binary files a/file and b/file differ')).toBe(true);
  });

  it('returns true for "GIT binary patch"', () => {
    expect(isBinaryDiff('GIT binary patch\ndelta 10')).toBe(true);
  });
});
