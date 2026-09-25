import { describe, it, expect } from 'vitest';
import { buildRemoteContextMenu } from '../../src/lib/remoteContextMenu';
import type { RemoteInfo } from '../../src/lib/api';
import type { ContextMenuItem } from '../../src/lib/useContextMenu';

// v3.4: the remote menu is GROUPED into submenus (Copy / Manage Remote) —
// helpers below see through the nesting.
const flatItems = (items: ContextMenuItem[]): ContextMenuItem[] => {
  const out: ContextMenuItem[] = [];
  for (const i of items) {
    out.push(i);
    if (i.submenu) out.push(...flatItems(i.submenu));
  }
  return out;
};

const baseRemote: RemoteInfo = {
  name: 'origin',
  refs: { fetch: 'https://git.example.com/team/repo.git', push: 'https://git.example.com/team/repo.git' },
};

const baseState = { busy: false, expanded: false, backgroundFetch: false };

describe('buildRemoteContextMenu', () => {
  it('contains the core actions in SmartGit-like order', () => {
    const items = buildRemoteContextMenu(baseRemote, baseState);
    // Top level: fetch + preview + the two GROUPS + removal (v3.4 grouping).
    const labels = items.map((i) => i.label ?? '---');
    expect(labels).toEqual([
      "Fetch 'origin' (with prune)",
      'Preview remote refs (ls-remote)',
      '---',
      'Copy',
      'Manage Remote',
      '---',
      "Remove remote 'origin'...",
    ]);
    // …and every flat action is still reachable through the submenus.
    const flat = flatItems(items).map((i) => i.label);
    expect(flat).toContain('Copy fetch URL');
    expect(flat).toContain('Browse branches');
    expect(flat).toContain("Edit 'origin'...");
    expect(flat).toContain("Rename 'origin'...");
    expect(flat).toContain('Perform background Poll or Fetch');
    expect(flat).toContain('Repository Settings...');
  });

  it('opens Repository Settings via the same event as the sidebar menu', () => {
    const items = buildRemoteContextMenu(baseRemote, baseState);
    expect(flatItems(items).find((i) => i.clickId === 'repo-settings')).toMatchObject({
      label: 'Repository Settings...',
    });
  });

  it('does not include Copy push URL when push URL equals fetch URL', () => {
    const items = buildRemoteContextMenu(baseRemote, baseState);
    expect(flatItems(items).find((i) => i.clickId === 'copy-push')).toBeUndefined();
  });

  it('includes Copy push URL for a separate push URL', () => {
    const remote: RemoteInfo = {
      name: 'mirror',
      refs: { fetch: 'https://cdn.example.com/repo.git', push: 'ssh://git@host/repo.git' },
    };
    const items = buildRemoteContextMenu(remote, baseState);
    const flat = flatItems(items);
    const pushIdx = flat.findIndex((i) => i.clickId === 'copy-push');
    const fetchIdx = flat.findIndex((i) => i.clickId === 'copy-fetch');
    expect(pushIdx).toBeGreaterThan(fetchIdx);
    expect(flat[pushIdx].label).toBe('Copy push URL');
  });

  it('disables Fetch while the remote is busy', () => {
    const items = buildRemoteContextMenu(baseRemote, { ...baseState, busy: true });
    const flat = flatItems(items);
    const fetch = flat.find((i) => i.clickId === 'fetch');
    expect(fetch?.enabled).toBe(false);
    // everything else stays enabled
    expect(flat.find((i) => i.clickId === 'remove')?.enabled).not.toBe(false);
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
    const offCb = flatItems(off).find((i) => i.clickId === 'toggle-background');
    const onCb = flatItems(on).find((i) => i.clickId === 'toggle-background');
    expect(offCb).toMatchObject({ type: 'checkbox', checked: false });
    expect(onCb).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('uses the remote name in action labels for non-origin remotes', () => {
    const remote: RemoteInfo = { name: 'upstream', refs: { fetch: 'https://x', push: 'https://x' } };
    const items = buildRemoteContextMenu(remote, baseState);
    const flat = flatItems(items);
    expect(flat.find((i) => i.clickId === 'remove')?.label).toBe("Remove remote 'upstream'...");
    expect(flat.find((i) => i.clickId === 'rename')?.label).toBe("Rename 'upstream'...");
  });
});
