import { describe, it, expect } from 'vitest';
import {
  resolveCommentChar,
  isCommentLine,
  findCommentLines,
  stripCommitComments,
} from '../../src/lib/commitMessage';

describe('resolveCommentChar', () => {
  it('defaults to # when config is missing/blank', () => {
    expect(resolveCommentChar(undefined)).toBe('#');
    expect(resolveCommentChar(null)).toBe('#');
    expect(resolveCommentChar('')).toBe('#');
    expect(resolveCommentChar('   ')).toBe('#');
  });

  it('maps "auto" to #', () => {
    expect(resolveCommentChar('auto')).toBe('#');
  });

  it('passes through configured characters (incl. multi-char)', () => {
    expect(resolveCommentChar(';')).toBe(';');
    expect(resolveCommentChar(' //')).toBe('//');
  });
});

describe('isCommentLine', () => {
  it('matches lines starting with the comment char after whitespace', () => {
    expect(isCommentLine('# comment', '#')).toBe(true);
    expect(isCommentLine('   # indented', '#')).toBe(true);
    expect(isCommentLine('\t#tabbed', '#')).toBe(true);
  });

  it('does not match plain text or empty lines', () => {
    expect(isCommentLine('fix: something', '#')).toBe(false);
    expect(isCommentLine('', '#')).toBe(false);
    expect(isCommentLine('   ', '#')).toBe(false);
    // mid-line '#' is not a comment start
    expect(isCommentLine('see issue #12', '#')).toBe(false);
  });

  it('respects a custom comment char', () => {
    expect(isCommentLine('; note', ';')).toBe(true);
    expect(isCommentLine('# note', ';')).toBe(false);
  });
});

describe('findCommentLines', () => {
  it('returns indices of comment lines', () => {
    const msg = ['Subject', '', '# Please enter the commit message', 'Body', '# comment'].join('\n');
    expect(findCommentLines(msg, '#')).toEqual([2, 4]);
  });

  it('returns [] when there are no comments', () => {
    expect(findCommentLines('Subject\n\nBody', '#')).toEqual([]);
  });
});

describe('stripCommitComments', () => {
  it('removes comment lines and trims trailing blanks', () => {
    const msg = [
      'feat: add thing',
      '',
      '# Please enter the commit message for your changes.',
      '# Lines starting with \'#\' will be ignored.',
      '',
    ].join('\n');
    expect(stripCommitComments(msg, '#')).toBe('feat: add thing');
  });

  it('keeps body content between comments', () => {
    const msg = ['Subject', '', '# comment', 'Body line', '# another'].join('\n');
    expect(stripCommitComments(msg, '#')).toBe(['Subject', '', 'Body line'].join('\n'));
  });

  it('collapses blank runs left by removed comment blocks', () => {
    const msg = ['Subject', '', '', '# a', '', '', 'Body'].join('\n');
    expect(stripCommitComments(msg, '#')).toBe(['Subject', '', 'Body'].join('\n'));
  });

  it('supports custom comment chars', () => {
    const msg = 'Subject\n\n; note\nBody';
    expect(stripCommitComments(msg, ';')).toBe('Subject\n\nBody');
  });

  it('keeps mid-line hash characters intact', () => {
    const msg = 'fix: handle CRLF (#12)';
    expect(stripCommitComments(msg, '#')).toBe('fix: handle CRLF (#12)');
  });

  it('returns empty string for comment-only messages', () => {
    expect(stripCommitComments('# only\n# comments', '#')).toBe('');
  });
});
