import { describe, it, expect } from 'vitest';
import { parsePushOutput } from '../../electron/services/git';
import { describePushResult } from '../../src/lib/pushResult';
import type { PushResult } from '../../electron/types/git-api';

describe('parsePushOutput — real git push stderr formats', () => {
  it('parses a normal ref update', () => {
    const out = [
      'To https://github.com/user/repo.git',
      '   27aa286..b7d1f2f  main -> main',
      '',
    ].join('\n');
    const { refs, upToDate } = parsePushOutput(out);
    expect(upToDate).toBe(false);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      localRef: 'main', remoteRef: 'main',
      oldHash: '27aa286', newHash: 'b7d1f2f',
    });
    expect(refs[0].created).toBeFalsy();
    expect(refs[0].rejected).toBeFalsy();
  });

  it('parses a new branch', () => {
    const out = [
      'To https://github.com/user/repo.git',
      ' * [new branch]      feature-x -> feature-x',
      '',
    ].join('\n');
    const { refs, upToDate } = parsePushOutput(out);
    expect(upToDate).toBe(false);
    expect(refs[0]).toMatchObject({ remoteRef: 'feature-x', created: true });
  });

  it('detects "Everything up-to-date" (exit 0, nothing sent)', () => {
    const out = 'Everything up-to-date\n';
    const { refs, upToDate } = parsePushOutput(out);
    expect(upToDate).toBe(true);
    expect(refs).toHaveLength(0);
  });

  it('parses remote rejection with protected-branch reason', () => {
    const out = [
      'To https://github.com/user/repo.git',
      ' ! [remote rejected] main -> main (protected branch hook declined)',
      'error: failed to push some refs to https://github.com/user/repo.git',
      '',
    ].join('\n');
    const { refs } = parsePushOutput(out);
    expect(refs[0]).toMatchObject({
      remoteRef: 'main', rejected: true,
      reason: 'protected branch hook declined',
    });
  });

  it('parses forced update and deletion', () => {
    const out = [
      'To https://host/repo.git',
      ' + 27aa286...b7d1f2f main -> main (forced update)',
      ' - [deleted]         tmp -> tmp',
      '',
    ].join('\n');
    const { refs } = parsePushOutput(out);
    expect(refs[0]).toMatchObject({ remoteRef: 'main', forced: true });
    expect(refs[1]).toMatchObject({ remoteRef: 'tmp', deleted: true });
  });

  it('handles the Main vs main case-mismatch (new branch created)', () => {
    const out = [
      'To https://github.com/user/repo.git',
      ' * [new branch]      Main -> Main',
      '',
    ].join('\n');
    const { refs } = parsePushOutput(out);
    expect(refs[0]).toMatchObject({ localRef: 'Main', remoteRef: 'Main', created: true });
  });
});

function mkResult(over: Partial<PushResult>): PushResult {
  return {
    upToDate: false, updated: true, refs: [], remote: 'origin',
    branch: 'main', summary: 'Pushed', ...over,
  };
}

describe('describePushResult — honest toasts', () => {
  it('reports an error when verification fails despite git exit 0', () => {
    const t = describePushResult(mkResult({
      verification: { branch: 'main', localHash: 'a'.repeat(40), remoteHash: 'b'.repeat(40), ok: false },
    }));
    expect(t.kind).toBe('error');
    expect(t.title).toMatch(/did NOT update/i);
    expect(t.detail).toContain('aaaaaaa');
    expect(t.detail).toContain('bbbbbbb');
  });

  it('reports an error when the branch is missing on the remote after push', () => {
    const t = describePushResult(mkResult({
      verification: { branch: 'main', localHash: 'a'.repeat(40), remoteHash: null, ok: false },
    }));
    expect(t.kind).toBe('error');
    expect(t.detail).toMatch(/missing on the remote/i);
  });

  it('reports info (not success) for Everything up-to-date', () => {
    const t = describePushResult(mkResult({
      upToDate: true, updated: false,
      verification: { branch: 'main', localHash: 'a'.repeat(40), remoteHash: 'a'.repeat(40), ok: true },
    }));
    expect(t.kind).toBe('info');
    expect(t.title).toMatch(/up-to-date/i);
  });

  it('reports created branch with a case-mismatch note (Main vs main)', () => {
    const t = describePushResult(mkResult({
      branch: 'Main',
      refs: [{ remoteRef: 'Main', localRef: 'Main', created: true }],
      verification: { branch: 'Main', localHash: 'a'.repeat(40), remoteHash: 'a'.repeat(40), ok: true },
    }), 'github');
    expect(t.kind).toBe('success');
    expect(t.title).toContain("Published 'Main' → github");
  });

  it('reports a normal push with hash range and verification', () => {
    const t = describePushResult(mkResult({
      refs: [{ remoteRef: 'main', localRef: 'main', oldHash: '27aa286', newHash: 'b7d1f2f' }],
      verification: { branch: 'main', localHash: 'b7d1f2f', remoteHash: 'b7d1f2f', ok: true },
    }, 'origin', 'main'));
    expect(t.kind).toBe('success');
    expect(t.title).toContain("(27aa286..b7d1f2f)");
    expect(t.detail).toMatch(/now at b7d1f2f/);
  });

  it('falls back to plain success when no result is available', () => {
    expect(describePushResult(undefined)).toEqual({ kind: 'success', title: 'Pushed successfully' });
  });
});
