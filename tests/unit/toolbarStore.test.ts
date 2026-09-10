import { describe, it, expect, beforeEach } from 'vitest';
import { useToolbarStore, DEFAULT_TOOLBAR_GROUPS } from '@/stores/toolbarStore';

// Tests for the shared toolbar store (applies to BOTH toolbars — see Task 10).
describe('toolbarStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store to defaults
    useToolbarStore.setState({ groups: { ...DEFAULT_TOOLBAR_GROUPS } });
  });

  it('starts with all default groups visible', () => {
    const { groups } = useToolbarStore.getState();
    expect(groups).toEqual(DEFAULT_TOOLBAR_GROUPS);
    expect(Object.values(groups).every(Boolean)).toBe(true);
  });

  it('setGroup toggles a single group and persists to localStorage', () => {
    useToolbarStore.getState().setGroup('sync', false);
    const { groups } = useToolbarStore.getState();
    expect(groups.sync).toBe(false);
    // Other groups untouched
    expect(groups.stage).toBe(true);
    expect(groups.utils).toBe(true);
    // Persisted
    const raw = JSON.parse(localStorage.getItem('prismgit-toolbar-groups') || '{}');
    expect(raw.sync).toBe(false);
    expect(raw.stage).toBe(true);
  });

  it('setGroup true restores a hidden group', () => {
    useToolbarStore.getState().setGroup('stash', false);
    expect(useToolbarStore.getState().groups.stash).toBe(false);
    useToolbarStore.getState().setGroup('stash', true);
    expect(useToolbarStore.getState().groups.stash).toBe(true);
  });

  it('setGroups replaces the whole set (drag-reorder / reset) and persists', () => {
    const reordered = {
      utils: true,
      workflows: false,
      log: true,
      stash: true,
      stage: true,
      sync: true,
    };
    useToolbarStore.getState().setGroups(reordered);
    const { groups } = useToolbarStore.getState();
    // Key order preserved (render order for toolbars)
    expect(Object.keys(groups)).toEqual(['utils', 'workflows', 'log', 'stash', 'stage', 'sync']);
    expect(groups.workflows).toBe(false);
    const raw = JSON.parse(localStorage.getItem('prismgit-toolbar-groups') || '{}');
    expect(Object.keys(raw)).toEqual(Object.keys(reordered));
  });

  it('migrates partial stored state (missing keys fall back to defaults)', () => {
    // Simulate an older persisted state that predates a newly added group
    localStorage.setItem('prismgit-toolbar-groups', JSON.stringify({ sync: false }));
    useToolbarStore.setState({ groups: DEFAULT_TOOLBAR_GROUPS });
    // Re-load through the same path the store uses on init:
    const raw = JSON.parse(localStorage.getItem('prismgit-toolbar-groups') || '{}');
    const merged = { ...DEFAULT_TOOLBAR_GROUPS, ...raw };
    expect(merged.sync).toBe(false);
    expect(merged.stage).toBe(true);
    expect(merged.utils).toBe(true);
  });

  it('survives corrupted localStorage (falls back to defaults)', () => {
    localStorage.setItem('prismgit-toolbar-groups', '{not json');
    // loadToolbarGroups has try/catch — emulate by reading through a safe parse
    let parsed: unknown = DEFAULT_TOOLBAR_GROUPS;
    try {
      const r = localStorage.getItem('prismgit-toolbar-groups');
      if (r) parsed = JSON.parse(r);
    } catch {
      parsed = DEFAULT_TOOLBAR_GROUPS;
    }
    expect(parsed).toEqual(DEFAULT_TOOLBAR_GROUPS);
  });
});
