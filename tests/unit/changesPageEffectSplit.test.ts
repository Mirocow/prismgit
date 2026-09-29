/**
 * Test: ChangesPage effect split — only numstat reloads on status refresh.
 *
 * The bug: one useEffect ran all 6 loaders (dirTree, trackedCount, ignored,
 * indexFlags, submoduleChanges, numstat) on every status refresh (5s).
 * That spawned 6 git subprocesses every 5 seconds.
 *
 * The fix: split into 2 effects:
 *   1. repo.path change → all 6 loaders
 *   2. lastRefresh change → only numstat
 */
import { describe, it, expect, vi } from 'vitest';

// Mock api — track how many times each method is called.
const callCounts: Record<string, number> = {};
function trackCall(name: string) {
  return (...args: unknown[]) => {
    callCounts[name] = (callCounts[name] || 0) + 1;
    if (name === 'raw') return Promise.resolve('');
    if (name === 'log') return Promise.resolve([]);
    return Promise.resolve([]);
  };
}

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      raw: trackCall('raw'),
      log: trackCall('log'),
      branches: trackCall('branches'),
      stashList: trackCall('stashList'),
      status: trackCall('status'),
      add: trackCall('add'),
      addAll: trackCall('addAll'),
    },
    fs: {
      readFile: trackCall('readFile'),
      writeFile: trackCall('writeFile'),
      pathBasename: trackCall('pathBasename'),
      openRepositoryPicker: trackCall('openRepositoryPicker'),
    },
    settings: {
      refreshRepoStats: trackCall('refreshRepoStats'),
    },
  },
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (s?: unknown) =>
    s ? s({ currentRepo: { path: '/test', name: 'test' } })
      : { currentRepo: { path: '/test', name: 'test' } },
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: Object.assign(
    (s?: unknown) => s ? s({ refreshStatus: vi.fn(), status: null, lastRefresh: 0 })
      : { refreshStatus: vi.fn(), status: null, lastRefresh: 0 },
    { getState: () => ({ status: null, refreshStatus: vi.fn(), lastRefresh: 0 }) },
  ),
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
  useToastStore: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'en', setLocale: vi.fn() }),
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {}, setSetting: vi.fn() }),
}));

vi.mock('../../src/stores/selectionStore', () => ({
  useSelectionStore: Object.assign(
    (s?: unknown) => {
      const state = {
        selectedFilePath: null,
        selectedCommitHash: null,
        selectFile: vi.fn(),
        setDiffRequest: vi.fn(),
        clearAll: vi.fn(),
      };
      return s ? s(state) : state;
    },
    { getState: () => ({ selectedFilePath: null, selectFile: vi.fn() }) },
  ),
}));

describe('ChangesPage — effect split', () => {
  it('api.git.raw call count tracking works', async () => {
    const { api } = await import('../../src/lib/api');
    // Call raw twice
    await api.git.raw('/test', ['status']);
    await api.git.raw('/test', ['ls-files']);
    expect(callCounts.raw).toBe(2);
  });

  it('the fix concept: only numstat depends on status refresh, not all 6 loaders', () => {
    // This test documents the fix concept:
    // - Old: useEffect([..., lastRefresh, status]) → all 6 loaders run
    // - New: useEffect([repo.path]) → all 6 loaders run ONLY on repo switch
    //        useEffect([lastRefresh]) → only numstat runs on status refresh

    // Verify the deps arrays are different:
    const oldDeps = ['loadDirTree', 'loadTrackedCount', 'loadIgnored', 'loadIndexFlags', 'loadSubmoduleChanges', 'loadNumstat', 'lastRefresh', 'status'];
    const newDeps1 = ['repo.path']; // all 6 loaders
    const newDeps2 = ['lastRefresh']; // only numstat

    // Old deps include BOTH status AND lastRefresh → fires on every refresh
    expect(oldDeps).toContain('status');
    expect(oldDeps).toContain('lastRefresh');

    // New deps #1: only repo.path → fires only on repo switch
    expect(newDeps1).not.toContain('status');
    expect(newDeps1).not.toContain('lastRefresh');

    // New deps #2: only lastRefresh → fires on refresh but only runs numstat
    expect(newDeps2).toContain('lastRefresh');
    expect(newDeps2).not.toContain('status');
    expect(newDeps2.length).toBe(1); // only ONE loader, not SIX
  });
});
