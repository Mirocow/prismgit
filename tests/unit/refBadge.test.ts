/**
 * refBadge — parsing of git decorations (%D output) into clean badges.
 *
 * The log parser uses --decorate=full, which produces shapes like
 * "tag: refs/tags/v2.0" and "HEAD -> refs/heads/main". The History graph
 * rows previously only understood the short "tag: v2.0" form, so tags
 * rendered with raw "refs/tags/…" labels (or looked missing entirely).
 */
import { describe, it, expect } from 'vitest';
import { parseDecoratedRef, parseDecoratedRefs } from '../../src/lib/refBadge';

describe('parseDecoratedRef — --decorate=full shapes', () => {
  it('parses "tag: refs/tags/v2.0" as a clean tag label', () => {
    expect(parseDecoratedRef('tag: refs/tags/v2.0')).toEqual({
      kind: 'tag', label: 'v2.0', raw: 'tag: refs/tags/v2.0',
    });
  });

  it('parses "refs/tags/v1.0" (no tag: marker) as a tag', () => {
    expect(parseDecoratedRef('refs/tags/v1.0').kind).toBe('tag');
    expect(parseDecoratedRef('refs/tags/v1.0').label).toBe('v1.0');
  });

  it('parses "HEAD -> refs/heads/main" as HEAD with clean branch label', () => {
    const r = parseDecoratedRef('HEAD -> refs/heads/main');
    expect(r.kind).toBe('head');
    expect(r.label).toBe('main');
  });

  it('parses "refs/heads/feature" as a local branch (not remote)', () => {
    const r = parseDecoratedRef('refs/heads/feature');
    expect(r.kind).toBe('branch');
    expect(r.label).toBe('feature');
  });

  it('parses "refs/remotes/origin/dev" as a remote', () => {
    const r = parseDecoratedRef('refs/remotes/origin/dev');
    expect(r.kind).toBe('remote');
    expect(r.label).toBe('origin/dev');
  });

  it('parses "refs/stash"', () => {
    expect(parseDecoratedRef('refs/stash').kind).toBe('stash');
    expect(parseDecoratedRef('refs/stash').label).toBe('stash');
  });

  it('parses bare "HEAD" (detached)', () => {
    expect(parseDecoratedRef('HEAD')).toEqual({ kind: 'head', label: 'HEAD', raw: 'HEAD' });
  });
});

describe('parseDecoratedRef — legacy short shapes', () => {
  it('parses "tag: v2.0"', () => {
    expect(parseDecoratedRef('tag: v2.0')).toEqual({ kind: 'tag', label: 'v2.0', raw: 'tag: v2.0' });
  });

  it('parses "HEAD -> main"', () => {
    expect(parseDecoratedRef('HEAD -> main')).toEqual({ kind: 'head', label: 'main', raw: 'HEAD -> main' });
  });

  it('parses short "origin/dev" as remote, "feature" as branch', () => {
    expect(parseDecoratedRef('origin/dev').kind).toBe('remote');
    expect(parseDecoratedRef('feature').kind).toBe('branch');
  });
});

describe('parseDecoratedRefs — ordering', () => {
  it('sorts tags first, then HEAD, branches, remotes', () => {
    const parsed = parseDecoratedRefs([
      'refs/remotes/origin/dev',
      'tag: refs/tags/v2.0',
      'refs/heads/feature',
      'HEAD -> refs/heads/main',
      'tag: refs/tags/v1.0',
    ]);
    expect(parsed.map((r) => r.kind)).toEqual(['tag', 'tag', 'head', 'branch', 'remote']);
    expect(parsed.map((r) => r.label)).toEqual(['v2.0', 'v1.0', 'main', 'feature', 'origin/dev']);
  });
});
