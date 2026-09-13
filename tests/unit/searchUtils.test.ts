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
});
