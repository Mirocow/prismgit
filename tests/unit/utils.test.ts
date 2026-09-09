import { describe, it, expect } from 'vitest';
import {
  cn,
  formatDate,
  truncateMiddle,
  shortHash,
  getStatusColor,
  getStatusColorFromCode,
  getStatusCode,
} from '../../src/lib/utils';

describe('cn (className merge)', () => {
  it('joins class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('handles conditional classes', () => {
    const isActive = true;
    expect(cn('base', isActive && 'active', !isActive && 'inactive')).toBe('base active');
  });

  it('handles falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });
});

describe('formatDate', () => {
  it('returns empty string for empty input', () => {
    expect(formatDate('')).toBe('');
  });

  it('returns input for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('formats "just now" for very recent', () => {
    const now = new Date();
    expect(formatDate(now.toISOString())).toBe('just now');
  });

  it('formats minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatDate(date.toISOString())).toBe('5m ago');
  });

  it('formats hours ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatDate(date.toISOString())).toBe('3h ago');
  });

  it('formats days ago as "yesterday" for 1 day', () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(formatDate(date.toISOString())).toBe('yesterday');
  });

  it('formats days ago', () => {
    const date = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(formatDate(date.toISOString())).toBe('5d ago');
  });

  it('formats weeks ago', () => {
    const date = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    expect(formatDate(date.toISOString())).toBe('2w ago');
  });

  it('formats months ago', () => {
    const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(formatDate(date.toISOString())).toBe('2mo ago');
  });

  it('formats years ago', () => {
    const date = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    expect(formatDate(date.toISOString())).toBe('1y ago');
  });
});

describe('truncateMiddle', () => {
  it('returns short strings unchanged', () => {
    expect(truncateMiddle('short', 40)).toBe('short');
  });

  it('truncates long strings in the middle', () => {
    const result = truncateMiddle('a-very-long-string-that-exceeds-max', 20);
    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual(23);
    expect(result.startsWith('a-very')).toBe(true);
    // End should contain part of the original tail
    expect(result.length).toBeGreaterThan(10);
  });

  it('handles default max', () => {
    const result = truncateMiddle('x'.repeat(50));
    expect(result).toContain('...');
  });
});

describe('shortHash', () => {
  it('returns first 7 characters', () => {
    expect(shortHash('abcdef1234567890')).toBe('abcdef1');
  });

  it('handles short strings', () => {
    expect(shortHash('abc')).toBe('abc');
  });

  it('handles empty string', () => {
    expect(shortHash('')).toBe('');
  });
});

describe('getStatusColor', () => {
  it('returns modified color', () => {
    expect(getStatusColor('modified')).toBe('var(--status-modified)');
  });

  it('returns added color', () => {
    expect(getStatusColor('added')).toBe('var(--status-added)');
  });

  it('returns deleted color', () => {
    expect(getStatusColor('deleted')).toBe('var(--status-deleted)');
  });

  it('returns renamed color', () => {
    expect(getStatusColor('renamed')).toBe('var(--status-renamed)');
  });

  it('returns untracked color', () => {
    expect(getStatusColor('untracked')).toBe('var(--status-untracked)');
  });

  it('returns conflicted color', () => {
    expect(getStatusColor('conflicted')).toBe('var(--status-conflict)');
  });

  it('returns default for unknown status', () => {
    expect(getStatusColor('unknown')).toBe('var(--text-primary)');
  });
});

describe('getStatusColorFromCode', () => {
  it('maps single-letter codes to colors', () => {
    expect(getStatusColorFromCode('M')).toBe('var(--status-modified)');
    expect(getStatusColorFromCode('A')).toBe('var(--status-added)');
    expect(getStatusColorFromCode('D')).toBe('var(--status-deleted)');
    expect(getStatusColorFromCode('R')).toBe('var(--status-renamed)');
    expect(getStatusColorFromCode('C')).toBe('var(--status-renamed)');
    expect(getStatusColorFromCode('?')).toBe('var(--status-untracked)');
    expect(getStatusColorFromCode('U')).toBe('var(--status-conflict)');
    expect(getStatusColorFromCode('T')).toBe('var(--status-modified)');
  });

  it('returns default for unknown code', () => {
    expect(getStatusColorFromCode('X')).toBe('var(--text-tertiary)');
  });
});

describe('getStatusCode', () => {
  it('maps codes to status names', () => {
    expect(getStatusCode('?')).toBe('untracked');
    expect(getStatusCode('U')).toBe('conflict');
    expect(getStatusCode('M')).toBe('modified');
    expect(getStatusCode('A')).toBe('added');
    expect(getStatusCode('D')).toBe('deleted');
    expect(getStatusCode('R')).toBe('renamed');
    expect(getStatusCode('C')).toBe('copied');
    expect(getStatusCode('T')).toBe('typechanged');
  });

  it('returns modified as default', () => {
    expect(getStatusCode('X')).toBe('modified');
  });
});
