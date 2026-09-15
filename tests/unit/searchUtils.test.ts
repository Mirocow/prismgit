import { describe, it, expect } from 'vitest';
import { parseGrepOutput, highlight, filterTrackedFiles } from '../../src/lib/searchUtils';

describe('parseGrepOutput', () => {
  it('parses standard git grep --line-number output', () => {
    const raw = 'src/lib/util.ts:10:export function util() {}\nsrc/app.ts:42:  const x = 1;';
    expect(parseGrepOutput(raw)).toEqual([
      { file: 'src/lib/util.ts', line: 10, text: 'export function util() {}' },
      { file: 'src/app.ts', line: 42, text: '  const x = 1;' },
    ]);
  });

  it('keeps colons inside the matched text', () => {
    const raw = 'a.md:1:key: value';
    expect(parseGrepOutput(raw)).toEqual([{ file: 'a.md', line: 1, text: 'key: value' }]);
  });

  it('drops malformed lines instead of crashing', () => {
    expect(parseGrepOutput('nocolonhere\n\n:bad:\nok.ts:3:fine')).toEqual([
      { file: 'ok.ts', line: 3, text: 'fine' },
    ]);
  });

  it('returns [] for empty output (git grep exit code 1 → "")', () => {
    expect(parseGrepOutput('')).toEqual([]);
  });
});

describe('highlight', () => {
  it('splits text into hit/miss segments (case-insensitive)', () => {
    const segs = highlight('Hello world, hello again', 'hello', true);
    expect(segs).toEqual([
      { seg: 'Hello', hit: true },
      { seg: ' world, ', hit: false },
      { seg: 'hello', hit: true },
      { seg: ' again', hit: false },
    ]);
  });

  it('is case-sensitive when ignoreCase is false', () => {
    const segs = highlight('Hello hello', 'hello', false);
    expect(segs.filter(s => s.hit)).toEqual([{ seg: 'hello', hit: true }]);
  });

  it('handles regex patterns', () => {
    const segs = highlight('foo123bar456', '\\d+', false);
    expect(segs.filter(s => s.hit).map(s => s.seg)).toEqual(['123', '456']);
  });

  it('never throws on an invalid regex — returns plain text', () => {
    expect(highlight('abc', '([unclosed', false)).toEqual([{ seg: 'abc', hit: false }]);
  });

  it('returns plain text for an empty pattern', () => {
    expect(highlight('abc', '  ', false)).toEqual([{ seg: 'abc', hit: false }]);
  });
});

describe('filterTrackedFiles', () => {
  const files = [
    'src/lib/util.ts',
    'src/App.tsx',
    'docs/notes.md',
    'README.md',
    'tests/util.test.ts',
  ];

  it('returns [] for an empty/blank query', () => {
    expect(filterTrackedFiles(files, '')).toEqual([]);
    expect(filterTrackedFiles(files, '   ')).toEqual([]);
  });

  it('matches basename first and ranks basename hits above path hits', () => {
    const res = filterTrackedFiles(files, 'util');
    // both basename hit (src/lib/util.ts) and path hit (tests/util.test.ts) —
    // basename hit must come first; alphabetical within the same tier
    expect(res[0]).toBe('src/lib/util.ts');
    expect(res).toContain('tests/util.test.ts');
  });

  it('is case-insensitive', () => {
    expect(filterTrackedFiles(files, 'APP')).toEqual(['src/App.tsx']);
  });

  it('matches path fragments too', () => {
    expect(filterTrackedFiles(files, 'src/')).toEqual(['src/App.tsx', 'src/lib/util.ts']);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 500 }, (_, i) => `f${i}.txt`);
    expect(filterTrackedFiles(many, 'f', 200)).toHaveLength(200);
  });

  // ─── New behaviour: multi-token space-separated queries ────────────────
  it('matches multi-token queries (all tokens must appear, in any order)', () => {
    // 'util test' should match tests/util.test.ts (basename contains both
    // 'util' and 'test') — previously this would have returned [] because
    // the search treated the whole string as one substring.
    const res = filterTrackedFiles(files, 'util test');
    expect(res).toContain('tests/util.test.ts');
    // But NOT src/lib/util.ts — its basename only has 'util', not 'test'.
    expect(res).not.toContain('src/lib/util.ts');
  });

  it('matches multi-token queries against the path too (not just basename)', () => {
    // 'src ts' should match src/App.tsx (path contains 'src', basename contains 'ts')
    const res = filterTrackedFiles(files, 'src ts');
    expect(res).toContain('src/App.tsx');
  });

  // ─── New behaviour: highlight with plain-alphanumeric pattern ───────────
  it('treats plain-alphanumeric patterns as literal substring search (no regex semantics)', () => {
    // Pattern 'function(' contains '(' which is NOT alphanumeric — this falls
    // into the regex path. But 'foo' (plain alphanumeric) should match 'foo'
    // literally even if 'foo' would also be a valid regex.
    const segs = highlight('foo bar foo', 'foo', false);
    expect(segs.filter(s => s.hit)).toHaveLength(2);
    expect(segs.filter(s => s.hit).every(s => s.seg === 'foo')).toBe(true);
  });

  it('escapes regex special chars in plain patterns (no surprise matches)', () => {
    // Pattern 'foo.bar' is plain alphanumeric + dot. As a regex this would
    // match 'fooXbar' too, but we want a LITERAL match.
    const segs = highlight('fooXbar foo.bar', 'foo.bar', false);
    // Only the literal 'foo.bar' should be a hit — not 'fooXbar'.
    expect(segs.filter(s => s.hit)).toEqual([{ seg: 'foo.bar', hit: true }]);
  });

  it('returns single empty segment for empty text input', () => {
    expect(highlight('', 'foo', false)).toEqual([{ seg: '', hit: false }]);
  });
});
