import { describe, it, expect } from 'vitest';
import { unquoteGitPath } from '../../electron/services/git';

/**
 * unquoteGitPath decodes git's C-style quoted paths. With the default
 * core.quotePath=true, git renders non-ASCII paths as "uni-\321\204..." —
 * the octal escapes are UTF-8 BYTES, not code points. Before the fix the
 * quoted string was stored as the file path: the Stashes viewer listed
 * garbage and clicking the file produced an empty diff.
 *
 * Reference bytes were produced with real git:
 *   git -c core.quotePath=true ls-files   (repo with 'uni-файл-文件.txt')
 */
describe('unquoteGitPath', () => {
  it('leaves plain ASCII paths untouched', () => {
    expect(unquoteGitPath('src/app/page.tsx')).toBe('src/app/page.tsx');
    expect(unquoteGitPath('with space.txt')).toBe('with space.txt');
    expect(unquoteGitPath("with'quote.txt")).toBe("with'quote.txt");
  });

  it('leaves non-quoted paths untouched even when they contain backslashes', () => {
    // core.quotePath only quotes the WHOLE path — an unquoted input must pass through
    expect(unquoteGitPath('dir\\file.txt')).toBe('dir\\file.txt');
    expect(unquoteGitPath('')).toBe('');
  });

  it('decodes cyrillic UTF-8 octal escapes (uni-файл)', () => {
    // real git output for 'uni-файл-文件.txt' with quotePath=true
    const quoted = '"uni-\\321\\204\\320\\260\\320\\271\\320\\273-\\346\\226\\207\\344\\273\\266.txt"';
    expect(unquoteGitPath(quoted)).toBe('uni-файл-文件.txt');
  });

  it('decodes latin-1 range (ü = \\303\\274)', () => {
    expect(unquoteGitPath('"M\\303\\274nchen.txt"')).toBe('München.txt');
  });

  it('decodes C escapes: \\t \\n \\\\ and \\"', () => {
    expect(unquoteGitPath('"tab\\there.txt"')).toBe('tab\there.txt');
    expect(unquoteGitPath('"new\\nline.txt"')).toBe('new\nline.txt');
    expect(unquoteGitPath('"back\\\\slash.txt"')).toBe('back\\slash.txt');
    expect(unquoteGitPath('"quo\\"te.txt"')).toBe('quo"te.txt');
  });

  it('handles a dangling backslash inside quotes without crashing', () => {
    expect(unquoteGitPath('"dangling\\"')).toBe('dangling\\');
  });

  it('returns input unchanged when quotes are unbalanced', () => {
    expect(unquoteGitPath('"not-quoted')).toBe('"not-quoted');
    expect(unquoteGitPath('not-quoted"')).toBe('not-quoted"');
    expect(unquoteGitPath('"partial\\"quote')).toBe('"partial\\"quote');
    expect(unquoteGitPath('"dangling\\')).toBe('"dangling\\');
  });
});
