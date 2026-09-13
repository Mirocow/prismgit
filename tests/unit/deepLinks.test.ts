/**
 * Unit tests for deep links (src/lib/deepLinks.ts).
 *
 * Deep links carry cross-tool selection state in the URL query:
 *   #/history?file=src/App.tsx&branch=main&commit=<hash>&tag=v1.0&stash=2&author=Ivan
 * parseDeepLink/buildDeepLink must round-trip, and malformed values must be
 * dropped (never throw) so a bad link degrades to a plain page navigation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDeepLink,
  buildDeepLinkQuery,
  buildDeepLink,
  sanitizeParam,
  isValidDeepLinkPath,
  applyDeepLink,
  setPendingDeepLinkPage,
  takePendingDeepLinkPage,
  clearPendingDeepLinkPage,
  currentHashPath,
  type DeepLinkParams,
} from '../../src/lib/deepLinks';
import { useSelectionStore } from '../../src/stores/selectionStore';

const HASH = 'abcdef0123456789abcdef0123456789abcdef01';

describe('sanitizeParam', () => {
  it('accepts a normal value', () => {
    expect(sanitizeParam('file', 'src/App.tsx')).toBe('src/App.tsx');
  });

  it('trims surrounding whitespace (hand-typed links)', () => {
    expect(sanitizeParam('branch', '  main  ')).toBe('main');
  });

  it('rejects a leading dash (git CLI option safety)', () => {
    expect(sanitizeParam('branch', '-rf')).toBeNull();
    expect(sanitizeParam('file', '--upload-pack=x')).toBeNull();
  });

  it('rejects control characters', () => {
    expect(sanitizeParam('file', 'a\u0000b')).toBeNull();
    expect(sanitizeParam('file', 'a\nb')).toBeNull();
  });

  it('rejects empty values', () => {
    expect(sanitizeParam('file', '')).toBeNull();
    expect(sanitizeParam('file', '   ')).toBeNull();
  });

  it('commit must be a hex hash (4..40 chars)', () => {
    expect(sanitizeParam('commit', 'abcdef12')).toBe('abcdef12');
    expect(sanitizeParam('commit', HASH)).toBe(HASH);
    expect(sanitizeParam('commit', 'main')).toBeNull();
    expect(sanitizeParam('commit', 'HEAD~3')).toBeNull();
    expect(sanitizeParam('commit', 'abc')).toBeNull(); // too short
  });

  it('stash must be a non-negative integer', () => {
    expect(sanitizeParam('stash', '3')).toBe('3');
    expect(sanitizeParam('stash', '-1')).toBeNull();
    expect(sanitizeParam('stash', 'abc')).toBeNull();
  });
});

describe('parseDeepLink', () => {
  it('parses a single file param', () => {
    expect(parseDeepLink('?file=src/App.tsx')).toEqual({ file: 'src/App.tsx' });
  });

  it('parses an encoded path', () => {
    expect(parseDeepLink('?file=src%2FApp.tsx')).toEqual({ file: 'src/App.tsx' });
  });

  it('supports aliases: path=file, hash=commit', () => {
    expect(parseDeepLink('?path=README.md')).toEqual({ file: 'README.md' });
    expect(parseDeepLink('?hash=abcdef12')).toEqual({ commit: 'abcdef12' });
  });

  it('parses all params together', () => {
    const q = `?file=a.ts&branch=main&commit=${HASH}&tag=v1.0&stash=2&author=Ivan`;
    expect(parseDeepLink(q)).toEqual({
      file: 'a.ts',
      branch: 'main',
      commit: HASH,
      tag: 'v1.0',
      stash: 2,
      author: 'Ivan',
    });
  });

  it('also accepts a full path with query', () => {
    expect(parseDeepLink('/history?file=a.ts&branch=dev')).toEqual({
      file: 'a.ts',
      branch: 'dev',
    });
  });

  it('drops invalid values, keeps valid ones', () => {
    expect(parseDeepLink('?commit=main&branch=ok')).toEqual({ branch: 'ok' });
    expect(parseDeepLink('?branch=-x&file=a.ts')).toEqual({ file: 'a.ts' });
  });

  it('returns null when nothing valid remains', () => {
    expect(parseDeepLink('?commit=main')).toBeNull();
    expect(parseDeepLink('?foo=bar')).toBeNull();
    expect(parseDeepLink('?file=')).toBeNull();
    expect(parseDeepLink('/history')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('?file=a.ts&file=')).toEqual({ file: 'a.ts' });
  });
});

describe('buildDeepLinkQuery / buildDeepLink', () => {
  it('builds a query from params', () => {
    expect(buildDeepLinkQuery({ file: 'src/App.tsx', branch: 'main' }))
      .toBe('?file=src%2FApp.tsx&branch=main');
  });

  it('empty params → empty query', () => {
    expect(buildDeepLinkQuery({})).toBe('');
    expect(buildDeepLinkQuery({ stash: -1 })).toBe('');
  });

  it('round-trips build → parse', () => {
    const params: DeepLinkParams = {
      file: 'src/lib/deep links.ts',
      branch: 'feature/deep-links',
      commit: HASH,
      tag: 'v2.0.1',
      stash: 7,
      author: 'Иван Иванов',
    };
    const parsed = parseDeepLink(buildDeepLinkQuery(params));
    expect(parsed).toEqual(params);
  });

  it('buildDeepLink prefixes the page and strips a page query', () => {
    expect(buildDeepLink('/history', { file: 'a.ts' })).toBe('/history?file=a.ts');
    expect(buildDeepLink('changes', {})).toBe('/changes');
    expect(buildDeepLink('/history?old=1', { file: 'a.ts' })).toBe('/history?file=a.ts');
  });
});

describe('isValidDeepLinkPath', () => {
  it('accepts page-only paths', () => {
    expect(isValidDeepLinkPath('/history')).toBe(true);
    expect(isValidDeepLinkPath('/changes')).toBe(true);
  });

  it('accepts paths with valid params', () => {
    expect(isValidDeepLinkPath('/history?file=src/App.tsx')).toBe(true);
    expect(isValidDeepLinkPath(`/history?commit=${HASH}`)).toBe(true);
  });

  it('rejects input without a leading slash', () => {
    expect(isValidDeepLinkPath('history?file=a.ts')).toBe(false);
    expect(isValidDeepLinkPath('')).toBe(false);
  });

  it('rejects a page-less path', () => {
    expect(isValidDeepLinkPath('/')).toBe(false);
    expect(isValidDeepLinkPath('/?file=a.ts')).toBe(false);
  });

  it('rejects garbage queries (query present but nothing valid)', () => {
    expect(isValidDeepLinkPath('/history?file=')).toBe(false);
    expect(isValidDeepLinkPath('/history?commit=main')).toBe(false);
    expect(isValidDeepLinkPath('/history?branch=-x')).toBe(false);
  });

  it('rejects whitespace/control chars in the page part', () => {
    expect(isValidDeepLinkPath('/his tory')).toBe(false);
    expect(isValidDeepLinkPath('/his\ntory')).toBe(false);
  });
});

describe('applyDeepLink', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
  });

  it('file sets both selectedFilePath and pathFilter (History + Changes react)', () => {
    applyDeepLink({ file: 'src/App.tsx' });
    const s = useSelectionStore.getState();
    expect(s.selectedFilePath).toBe('src/App.tsx');
    expect(s.pathFilter).toBe('src/App.tsx');
  });

  it('branch / commit / tag / stash / author land in the store', () => {
    applyDeepLink({ branch: 'main', commit: HASH, tag: 'v1.0', stash: 2, author: 'Ivan' });
    const s = useSelectionStore.getState();
    expect(s.selectedBranch).toBe('main');
    expect(s.selectedCommitHash).toBe(HASH);
    expect(s.selectedTag).toBe('v1.0');
    expect(s.selectedStashIndex).toBe(2);
    expect(s.authorFilter).toBe('Ivan');
  });

  it('clearAll resets everything a deep link applied', () => {
    applyDeepLink({ file: 'a.ts', branch: 'main' });
    useSelectionStore.getState().clearAll();
    const s = useSelectionStore.getState();
    expect(s.selectedFilePath).toBeNull();
    expect(s.pathFilter).toBeNull();
    expect(s.selectedBranch).toBeNull();
  });
});

describe('pending deep-link page (cold start before a repo opens)', () => {
  beforeEach(() => {
    clearPendingDeepLinkPage();
  });

  it('take returns the page once and clears it', () => {
    setPendingDeepLinkPage('/history');
    expect(takePendingDeepLinkPage()).toBe('/history');
    expect(takePendingDeepLinkPage()).toBeNull();
  });

  it('normalizes a page without the leading slash', () => {
    setPendingDeepLinkPage('blame');
    expect(takePendingDeepLinkPage()).toBe('/blame');
  });

  it('clearPending drops a pending page', () => {
    setPendingDeepLinkPage('/history');
    clearPendingDeepLinkPage();
    expect(takePendingDeepLinkPage()).toBeNull();
  });
});

describe('currentHashPath', () => {
  it('extracts the page from the hash, dropping the query', () => {
    window.location.hash = '#/history?file=a.ts';
    expect(currentHashPath()).toBe('/history');
    window.location.hash = '#/blame';
    expect(currentHashPath()).toBe('/blame');
  });

  it('defaults to / when the hash is empty', () => {
    window.location.hash = '';
    expect(currentHashPath()).toBe('/');
  });
});
