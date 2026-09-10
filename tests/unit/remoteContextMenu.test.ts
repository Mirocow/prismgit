import { describe, it, expect } from 'vitest';
import { buildRemoteContextMenu } from '../../src/lib/remoteContextMenu';
import type { RemoteInfo } from '../../src/lib/api';

const baseRemote: RemoteInfo = {
  name: 'origin',
  refs: { fetch: 'https://git.example.com/team/repo.git', push: 'https://git.example.com/team/repo.git' },
};

const baseState = { busy: false, expanded: false, backgroundFetch: false };

describe('buildRemoteContextMenu', () => {
  it('contains the core actions in SmartGit-like order', () => {
    const items = buildRemoteContextMenu(baseRemote, baseState);
    const labels = items.map((i) => i.label ?? '---');
    expect(labels).toEqual([
      "Fetch 'origin' (with prune)",
      'Preview remote refs (ls-remote)',
      'Copy fetch URL',
      '---',
      'Browse branches',
      "Edit 'origin'...",
      "Rename 'origin'...",
      '---',
      'Perform background Poll or Fetch',
      'Repository Settings...',
      '---',
      "Remove remote 'origin'...",
    ]);
  });

  it('opens Repository Settings via the same event as the sidebar menu', () => {
    const items = buildRemoteContextMenu(baseRemote, baseState);
    expect(items.find((i) => i.clickId === 'repo-settings')).toMatchObject({
      label: 'Repository Settings...',
    });
  });

  it('does not include Copy push URL when push URL equals fetch URL', () => {
    const items = buildRemoteContextMenu(baseRemote, baseState);
    expect(items.find((i) => i.clickId === 'copy-push')).toBeUndefined();
  });

  it('includes Copy push URL for a separate push URL', () => {
    const remote: RemoteInfo = {
      name: 'mirror',
      refs: { fetch: 'https://cdn.example.com/repo.git', push: 'ssh://git@host/repo.git' },
    };
    const items = buildRemoteContextMenu(remote, baseState);
    const pushIdx = items.findIndex((i) => i.clickId === 'copy-push');
    const fetchIdx = items.findIndex((i) => i.clickId === 'copy-fetch');
    expect(pushIdx).toBeGreaterThan(fetchIdx);
    expect(items[pushIdx].label).toBe('Copy push URL');
  });

  it('disables Fetch while the remote is busy', () => {
    const items = buildRemoteContextMenu(baseRemote, { ...baseState, busy: true });
    const fetch = items.find((i) => i.clickId === 'fetch');
    expect(fetch?.enabled).toBe(false);
    // everything else stays enabled
    expect(items.find((i) => i.clickId === 'remove')?.enabled).not.toBe(false);
  });

  it('toggles preview label based on expanded state', () => {
    const collapsed = buildRemoteContextMenu(baseRemote, baseState);
    const expanded = buildRemoteContextMenu(baseRemote, { ...baseState, expanded: true });
    expect(collapsed.find((i) => i.clickId === 'preview')?.label).toBe('Preview remote refs (ls-remote)');
    expect(expanded.find((i) => i.clickId === 'preview')?.label).toBe('Hide remote refs');
  });

  it('reflects the background fetch checkbox state', () => {
    const off = buildRemoteContextMenu(baseRemote, baseState);
    const on = buildRemoteContextMenu(baseRemote, { ...baseState, backgroundFetch: true });
    const offCb = off.find((i) => i.clickId === 'toggle-background');
    const onCb = on.find((i) => i.clickId === 'toggle-background');
    expect(offCb).toMatchObject({ type: 'checkbox', checked: false });
    expect(onCb).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('uses the remote name in action labels for non-origin remotes', () => {
    const remote: RemoteInfo = { name: 'upstream', refs: { fetch: 'https://x', push: 'https://x' } };
    const items = buildRemoteContextMenu(remote, baseState);
    expect(items.find((i) => i.clickId === 'remove')?.label).toBe("Remove remote 'upstream'...");
    expect(items.find((i) => i.clickId === 'rename')?.label).toBe("Rename 'upstream'...");
  });
});
