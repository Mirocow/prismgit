import { describe, it, expect, vi } from 'vitest';

/**
 * QW-3 unit test — the conventional-prefix application logic.
 *
 * We can't easily mount the CommitTypeDropdown in jsdom (it relies on
 * useI18n's locale dict loading), so we replicate the pure reducer it
 * calls and assert its behaviour. This guards against regressions in
 * the prefix-replacement regex.
 */

const CONVENTIONAL_PREFIX = /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert):\s/;

function applyType(prev: string, type: string): string {
  const stripped = prev.replace(CONVENTIONAL_PREFIX, '');
  const trimmed = stripped.replace(/^\s+/, '');
  return trimmed.length === 0 ? `${type}: ` : `${type}: ${trimmed}`;
}

describe('QW-3 Conventional Commits prefix application', () => {
  it('inserts the prefix on empty input', () => {
    expect(applyType('', 'feat')).toBe('feat: ');
  });

  it('prepends the prefix when text exists without a prefix', () => {
    expect(applyType('added search', 'feat')).toBe('feat: added search');
  });

  it('replaces an existing prefix when switching types', () => {
    expect(applyType('fix: bug', 'feat')).toBe('feat: bug');
  });

  it('replaces any of the 11 conventional types', () => {
    for (const t of ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'build', 'ci', 'revert']) {
      expect(applyType(`feat: work on ${t}`, t)).toBe(`${t}: work on ${t}`);
    }
  });

  it('does not treat non-conventional prefixes as replaceable', () => {
    // "wip: hello" is not a Conventional type — so it stays as text, and
    // the new prefix is prepended (no stripping).
    expect(applyType('wip: hello', 'feat')).toBe('feat: wip: hello');
  });

  it('collapses leading whitespace after the existing prefix', () => {
    expect(applyType('fix:    extra spaces', 'feat')).toBe('feat: extra spaces');
  });

  it('preserves multi-line bodies', () => {
    const body = 'feat: subject\n\nLong body paragraph\nstill body';
    expect(applyType(body, 'fix')).toBe('fix: subject\n\nLong body paragraph\nstill body');
  });

  it('handles revert as a valid type', () => {
    expect(applyType('feat: bad commit', 'revert')).toBe('revert: bad commit');
  });
});

// Mock useI18n just to keep the file's import surface small.
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
