import { describe, it, expect } from 'vitest';
import { wordDiff } from '../../src/lib/wordDiff';

describe('wordDiff', () => {
  it('returns equal segments for identical lines', () => {
    const result = wordDiff('hello world', 'hello world');
    expect(result.old).toEqual([{ kind: 'equal', text: 'hello world' }]);
    expect(result.new).toEqual([{ kind: 'equal', text: 'hello world' }]);
  });

  it('detects added words', () => {
    const result = wordDiff('hello world', 'hello brave new world');
    const newAdded = result.new.filter(s => s.kind === 'added').map(s => s.text).join('');
    expect(newAdded).toContain('brave');
    expect(newAdded).toContain('new');
    expect(result.old.every(s => s.kind !== 'added')).toBe(true);
  });

  it('detects removed words', () => {
    const result = wordDiff('hello brave new world', 'hello world');
    const oldRemoved = result.old.filter(s => s.kind === 'removed').map(s => s.text).join('');
    expect(oldRemoved).toContain('brave');
    expect(oldRemoved).toContain('new');
  });

  it('handles completely different lines', () => {
    const result = wordDiff('aaa', 'bbb');
    expect(result.old.some(s => s.kind === 'removed')).toBe(true);
    expect(result.new.some(s => s.kind === 'added')).toBe(true);
  });

  it('handles empty old line', () => {
    const result = wordDiff('', 'new content');
    expect(result.old).toEqual([]);
    expect(result.new).toEqual([{ kind: 'added', text: 'new content' }]);
  });

  it('handles empty new line', () => {
    const result = wordDiff('old content', '');
    expect(result.old).toEqual([{ kind: 'removed', text: 'old content' }]);
    expect(result.new).toEqual([]);
  });

  it('handles both empty', () => {
    const result = wordDiff('', '');
    expect(result.old).toEqual([{ kind: 'equal', text: '' }]);
    expect(result.new).toEqual([{ kind: 'equal', text: '' }]);
  });

  it('merges consecutive segments of same kind', () => {
    const result = wordDiff('a b c', 'a X c');
    // 'a' + ' ' equal, 'b' removed / 'X' added, ' c' equal (whitespace stays with following token)
    const oldRemovedText = result.old.filter(s => s.kind === 'removed').map(s => s.text).join('');
    const newAddedText = result.new.filter(s => s.kind === 'added').map(s => s.text).join('');
    expect(oldRemovedText).toBe('b');
    expect(newAddedText).toBe('X');
  });

  it('preserves whitespace tokens', () => {
    const result = wordDiff('foo(bar)', 'foo(baz)');
    // Should detect change from 'bar' to 'baz' while keeping 'foo(' and ')'
    const newAddedText = result.new.filter(s => s.kind === 'added').map(s => s.text).join('');
    expect(newAddedText).toContain('baz');
  });

  it('falls back gracefully for very long lines', () => {
    const long1 = 'word '.repeat(1000);
    const long2 = 'word '.repeat(1000) + 'extra';
    const result = wordDiff(long1, long2);
    // Should not throw, returns something sensible
    expect(result.new.length).toBeGreaterThan(0);
  });
});
