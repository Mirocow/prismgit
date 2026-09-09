import { describe, it, expect } from 'vitest';
import { parseConflicts, buildResolvedContent, hasConflicts, countConflicts } from '../../src/lib/conflictParser';

describe('parseConflicts', () => {
  it('returns empty array for content without conflicts', () => {
    const content = 'line1\nline2\nline3';
    expect(parseConflicts(content)).toEqual([]);
  });

  it('parses a single conflict', () => {
    const content = [
      'line1',
      '<<<<<<< HEAD',
      'ours line 1',
      'ours line 2',
      '=======',
      'theirs line 1',
      'theirs line 2',
      '>>>>>>> branch',
      'line9',
    ].join('\n');

    const hunks = parseConflicts(content);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].startLine).toBe(1);
    expect(hunks[0].oursLines).toEqual(['ours line 1', 'ours line 2']);
    expect(hunks[0].theirsLines).toEqual(['theirs line 1', 'theirs line 2']);
    expect(hunks[0].endLine).toBe(8);
  });

  it('parses multiple conflicts', () => {
    const content = [
      'line1',
      '<<<<<<< HEAD',
      'ours1',
      '=======',
      'theirs1',
      '>>>>>>> b1',
      'line7',
      '<<<<<<< HEAD',
      'ours2',
      '=======',
      'theirs2',
      '>>>>>>> b2',
      'line13',
    ].join('\n');

    const hunks = parseConflicts(content);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].oursLines).toEqual(['ours1']);
    expect(hunks[1].oursLines).toEqual(['ours2']);
  });

  it('handles empty ours section', () => {
    const content = [
      '<<<<<<< HEAD',
      '=======',
      'theirs',
      '>>>>>>> branch',
    ].join('\n');

    const hunks = parseConflicts(content);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oursLines).toEqual([]);
    expect(hunks[0].theirsLines).toEqual(['theirs']);
  });

  it('handles empty theirs section', () => {
    const content = [
      '<<<<<<< HEAD',
      'ours',
      '=======',
      '>>>>>>> branch',
    ].join('\n');

    const hunks = parseConflicts(content);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oursLines).toEqual(['ours']);
    expect(hunks[0].theirsLines).toEqual([]);
  });
});

describe('buildResolvedContent', () => {
  it('returns original content when no resolutions', () => {
    const content = 'line1\nline2\nline3';
    const hunks = parseConflicts(content);
    const resolutions = new Map<number, string[]>();
    expect(buildResolvedContent(content, hunks, resolutions)).toBe(content);
  });

  it('replaces conflict with ours', () => {
    const content = [
      'line1',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> branch',
      'line7',
    ].join('\n');

    const hunks = parseConflicts(content);
    const resolutions = new Map<number, string[]>([[0, ['ours']]]);
    const result = buildResolvedContent(content, hunks, resolutions);
    expect(result).toBe('line1\nours\nline7');
  });

  it('replaces conflict with theirs', () => {
    const content = [
      'line1',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> branch',
      'line7',
    ].join('\n');

    const hunks = parseConflicts(content);
    const resolutions = new Map<number, string[]>([[0, ['theirs']]]);
    const result = buildResolvedContent(content, hunks, resolutions);
    expect(result).toBe('line1\ntheirs\nline7');
  });

  it('replaces conflict with both', () => {
    const content = [
      'line1',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> branch',
      'line7',
    ].join('\n');

    const hunks = parseConflicts(content);
    const resolutions = new Map<number, string[]>([[0, ['ours', '', 'theirs']]]);
    const result = buildResolvedContent(content, hunks, resolutions);
    expect(result).toBe('line1\nours\n\ntheirs\nline7');
  });

  it('handles multiple conflicts with mixed resolutions', () => {
    const content = [
      '<<<<<<< HEAD',
      'ours1',
      '=======',
      'theirs1',
      '>>>>>>> b1',
      'middle',
      '<<<<<<< HEAD',
      'ours2',
      '=======',
      'theirs2',
      '>>>>>>> b2',
    ].join('\n');

    const hunks = parseConflicts(content);
    const resolutions = new Map<number, string[]>([
      [0, ['ours1']],
      [1, ['theirs2']],
    ]);
    const result = buildResolvedContent(content, hunks, resolutions);
    expect(result).toBe('ours1\nmiddle\ntheirs2');
  });
});

describe('hasConflicts', () => {
  it('returns false for clean content', () => {
    expect(hasConflicts('line1\nline2')).toBe(false);
  });

  it('returns true when markers present', () => {
    expect(hasConflicts('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b')).toBe(true);
  });

  it('returns false with only opening marker', () => {
    expect(hasConflicts('<<<<<<< HEAD\nours')).toBe(false);
  });
});

describe('countConflicts', () => {
  it('returns 0 for clean content', () => {
    expect(countConflicts('line1\nline2')).toBe(0);
  });

  it('counts single conflict', () => {
    const content = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b';
    expect(countConflicts(content)).toBe(1);
  });

  it('counts multiple conflicts', () => {
    const content = [
      '<<<<<<< HEAD',
      'ours1',
      '=======',
      'theirs1',
      '>>>>>>> b1',
      '<<<<<<< HEAD',
      'ours2',
      '=======',
      'theirs2',
      '>>>>>>> b2',
    ].join('\n');
    expect(countConflicts(content)).toBe(2);
  });
});
