import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the api module
vi.mock('../../src/lib/api', () => ({
  api: {
    settings: {
      getAll: vi.fn(),
      set: vi.fn(),
      getRepos: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
      updateRepo: vi.fn(),
      getRepoMetadataAll: vi.fn().mockResolvedValue([]),
      updateRepoMetadata: vi.fn(),
      toggleFavorite: vi.fn(),
      addTag: vi.fn(),
      removeTag: vi.fn(),
      refreshRepoStats: vi.fn().mockResolvedValue({}),
      getRepoGroups: vi.fn().mockResolvedValue([]),
      createRepoGroup: vi.fn(),
      renameRepoGroup: vi.fn(),
      deleteRepoGroup: vi.fn(),
      moveRepoGroup: vi.fn(),
      setRepoGroupExpanded: vi.fn(),
      setRepoGroup: vi.fn(),
    },
    git: {
      isRepo: vi.fn(),
      status: vi.fn(),
      raw: vi.fn().mockResolvedValue(''),
      pollRemoteSummaries: vi.fn().mockResolvedValue({}),
      invalidateCache: vi.fn().mockResolvedValue(undefined),
      trimRepoCaches: vi.fn().mockResolvedValue(undefined),
    },
    fs: {
      openRepositoryPicker: vi.fn(),
      pathBasename: vi.fn(),
    },
    watcher: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn(() => () => {}),
    },
  },
}));

import { api } from '../../src/lib/api';
import { useRepositoryStore } from '../../src/stores/repositoryStore';
import { useToastStore } from '../../src/stores/toastStore';

describe('repositoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRepositoryStore.setState({
      repos: [],
      currentRepo: null,
      loading: false,
      error: null,
    });
  });

  describe('loadRepos', () => {
    it('loads repositories sorted by favorites (stable order, NOT by lastOpened)', async () => {
      const mockRepos = [
        { path: '/a', name: 'a', lastOpened: 100, pinned: false },
        { path: '/b', name: 'b', lastOpened: 200, pinned: false },
        { path: '/c', name: 'c', lastOpened: 300, pinned: false },
      ];
      vi.mocked(api.settings.getRepos).mockResolvedValue(mockRepos);
      // /b is a FAVORITE → must float to the top. (Task 29: the separate
      // "pinned" tier was removed with the pin button — favorites sort alone.)
      useRepositoryStore.setState({
        metadata: { '/b': { path: '/b', favorite: true } as never },
      });

      await useRepositoryStore.getState().loadRepos();

      const state = useRepositoryStore.getState();
      expect(state.repos).toHaveLength(3);
      // Favorite first, then STABLE insertion order (not by lastOpened)
      expect(state.repos[0].path).toBe('/b'); // favorite
      expect(state.repos[1].path).toBe('/a'); // /a was first in array → stays before /c
      expect(state.repos[2].path).toBe('/c');
      expect(state.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      vi.mocked(api.settings.getRepos).mockRejectedValue(new Error('Failed'));

      await useRepositoryStore.getState().loadRepos();

      const state = useRepositoryStore.getState();
      expect(state.error).toBeTruthy();
      expect(state.loading).toBe(false);
    });
  });

  describe('openRepository', () => {
    it('opens valid repository', async () => {
      vi.mocked(api.git.isRepo).mockResolvedValue(true);
      vi.mocked(api.fs.pathBasename).mockResolvedValue('my-repo');
      vi.mocked(api.settings.addRepo).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);

      await useRepositoryStore.getState().openRepository('/path/to/my-repo');

      const state = useRepositoryStore.getState();
      expect(state.currentRepo).not.toBeNull();
      expect(state.currentRepo?.path).toBe('/path/to/my-repo');
      expect(state.currentRepo?.name).toBe('my-repo');
      expect(api.settings.addRepo).toHaveBeenCalledWith({
        path: '/path/to/my-repo',
        name: 'my-repo',
      });
    });

    it('does NOT open a non-repository directory (sets error, no throw)', async () => {
      vi.mocked(api.git.isRepo).mockResolvedValue(false);
      // Show a friendly toast instead of throwing — this is intentional:
      // throwing would propagate to callers that don't .catch() and trigger
      // a second generic "unhandled" toast. The function resolves with
      // undefined and leaves currentRepo null.
      await useRepositoryStore.getState().openRepository('/not/a/repo');

      const state = useRepositoryStore.getState();
      expect(state.currentRepo).toBeNull();
      expect(state.loading).toBe(false);
      // The toast is shown via useToastStore — verified separately.
      expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
    });

    // ── PERF (v3.1, repo-switch) behaviors ──────────────────────────

    it('re-click on the CURRENT repo is a no-op (no addRepo, no state churn)', async () => {
      useRepositoryStore.setState({
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
      });
      vi.mocked(api.settings.addRepo).mockClear();

      await useRepositoryStore.getState().openRepository('/repo');

      // No settings write, no loading flicker, currentRepo identity UNCHANGED
      // (a new object identity would re-trigger the App's watcher effect —
      // chokidar teardown + worktree re-walk).
      expect(api.settings.addRepo).not.toHaveBeenCalled();
      expect(api.git.trimRepoCaches).not.toHaveBeenCalled();
      expect(useRepositoryStore.getState().loading).toBe(false);
      const current = useRepositoryStore.getState().currentRepo;
      expect(current?.path).toBe('/repo');
      expect(current?.lastOpened).toBe(0); // unchanged — no re-set happened
    });

    it('switching away calls trimRepoCaches (soft) — NOT invalidateCache', async () => {
      useRepositoryStore.setState({
        currentRepo: { path: '/repo-a', name: 'a', lastOpened: 0 },
      });
      vi.mocked(api.git.isRepo).mockResolvedValue(true);
      vi.mocked(api.fs.pathBasename).mockResolvedValue('b');
      vi.mocked(api.settings.addRepo).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);

      await useRepositoryStore.getState().openRepository('/repo-b');

      expect(api.git.trimRepoCaches).toHaveBeenCalledTimes(1);
      expect(api.git.invalidateCache).not.toHaveBeenCalled();
      expect(api.watcher.stop).toHaveBeenCalledWith('/repo-a');
      expect(useRepositoryStore.getState().currentRepo?.path).toBe('/repo-b');
    });

    it('defers refreshRepoStats (background stats no longer compete with the open burst)', async () => {
      vi.useFakeTimers();
      try {
        useRepositoryStore.setState({ currentRepo: null, metadata: {} });
        vi.mocked(api.git.isRepo).mockResolvedValue(true);
        vi.mocked(api.fs.pathBasename).mockResolvedValue('r');
        vi.mocked(api.settings.addRepo).mockResolvedValue(undefined);
        // The repo must be in the list — loadMetadata → loadRepos auto-closes
        // a currentRepo that vanished from the list (deleted-from-disk guard).
        vi.mocked(api.settings.getRepos).mockResolvedValue([
          { path: '/deferred', name: 'r', lastOpened: 0 },
        ]);
        vi.mocked(api.settings.refreshRepoStats).mockClear();

        await useRepositoryStore.getState().openRepository('/deferred');
        // NOT called synchronously — the old behavior fired 4 git spawns
        // (log -1 / branchLocal / getRemotes / rev-list --count) immediately,
        // competing with the foreground status/numstat/ls-files burst.
        expect(api.settings.refreshRepoStats).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_300);
        expect(api.settings.refreshRepoStats).toHaveBeenCalledWith('/deferred');
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips refreshRepoStats entirely when metadata is fresh (<60s)', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);
      try {
        useRepositoryStore.setState({
          currentRepo: null,
          metadata: { '/fresh': { path: '/fresh', updatedAt: now - 5_000 } },
        });
        vi.mocked(api.git.isRepo).mockResolvedValue(true);
        vi.mocked(api.fs.pathBasename).mockResolvedValue('fresh');
        vi.mocked(api.settings.addRepo).mockResolvedValue(undefined);
        vi.mocked(api.settings.refreshRepoStats).mockClear();

        await useRepositoryStore.getState().openRepository('/fresh');
        await vi.advanceTimersByTimeAsync(2_000);

        // Rapid switch-back to a recently-refreshed repo: zero stat spawns.
        expect(api.settings.refreshRepoStats).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('abandoned switch: no stats refresh for a repo the user already left', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);
      try {
        useRepositoryStore.setState({ currentRepo: null, metadata: {} });
        vi.mocked(api.git.isRepo).mockResolvedValue(true);
        vi.mocked(api.fs.pathBasename).mockResolvedValue('x');
        vi.mocked(api.settings.addRepo).mockResolvedValue(undefined);
        // '/other' stays in the list so the auto-close guard doesn't fire —
        // this test isolates the ABANDONED-switch guard in openRepository.
        vi.mocked(api.settings.getRepos).mockResolvedValue([
          { path: '/other', name: 'other', lastOpened: 0 },
        ]);
        vi.mocked(api.settings.refreshRepoStats).mockClear();

        await useRepositoryStore.getState().openRepository('/abandoned');
        // Switch away before the deferred stats timer fires.
        useRepositoryStore.setState({
          currentRepo: { path: '/other', name: 'other', lastOpened: 0 },
        });
        await vi.advanceTimersByTimeAsync(1_300);

        expect(api.settings.refreshRepoStats).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('dedupes concurrent opens of the SAME path (double-click guard)', async () => {
      let resolveIsRepo: (v: boolean) => void = () => {};
      vi.mocked(api.git.isRepo).mockImplementation(
        () => new Promise<boolean>((res) => { resolveIsRepo = res; }),
      );
      vi.mocked(api.fs.pathBasename).mockResolvedValue('dbl');
      vi.mocked(api.settings.addRepo).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);
      useRepositoryStore.setState({ currentRepo: null, metadata: {} });

      const p1 = useRepositoryStore.getState().openRepository('/dbl');
      const p2 = useRepositoryStore.getState().openRepository('/dbl');
      resolveIsRepo(true);
      await Promise.all([p1, p2]);

      // ONE open sequence — a second addRepo write would churn settings and
      // re-set currentRepo (new identity → watcher effect re-runs).
      expect(api.settings.addRepo).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeRepository', () => {
    it('clears currentRepo', () => {
      useRepositoryStore.setState({
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
      });

      useRepositoryStore.getState().closeRepository();

      expect(useRepositoryStore.getState().currentRepo).toBeNull();
    });

    it('soft-trims caches (trimRepoCaches), keeps hard invalidateCache for mutations', () => {
      useRepositoryStore.setState({
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
      });

      useRepositoryStore.getState().closeRepository();

      expect(api.git.trimRepoCaches).toHaveBeenCalledTimes(1);
      expect(api.git.invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('removeRepo', () => {
    it('removes repo from list and clears currentRepo if matching', async () => {
      vi.mocked(api.settings.removeRepo).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);
      useRepositoryStore.setState({
        repos: [{ path: '/repo', name: 'repo', lastOpened: 0 }],
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
      });

      await useRepositoryStore.getState().removeRepo('/repo');

      const state = useRepositoryStore.getState();
      expect(state.currentRepo).toBeNull();
      expect(api.settings.removeRepo).toHaveBeenCalledWith('/repo');
    });

    it('keeps currentRepo if different path', async () => {
      vi.mocked(api.settings.removeRepo).mockResolvedValue(undefined);
      // The currently-open repo ('/other') must be in the returned list —
      // otherwise loadRepos() correctly calls closeRepository() (the v3
      // feature that auto-closes a repo that was deleted from disk).
      vi.mocked(api.settings.getRepos).mockResolvedValue([
        { path: '/other', name: 'other', lastOpened: 0 },
      ]);
      useRepositoryStore.setState({
        currentRepo: { path: '/other', name: 'other', lastOpened: 0 },
      });

      await useRepositoryStore.getState().removeRepo('/repo');

      expect(useRepositoryStore.getState().currentRepo?.path).toBe('/other');
    });
  });

  describe('repository groups', () => {
    beforeEach(() => {
      useRepositoryStore.setState({ groups: [], repos: [] });
    });

    it('loadRepos loads groups alongside repos', async () => {
      const mockGroups = [
        { id: 'g1', name: 'Work', parentId: null, order: 1, createdAt: 1 },
      ];
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);
      vi.mocked(api.settings.getRepoGroups).mockResolvedValue(mockGroups);

      await useRepositoryStore.getState().loadRepos();

      expect(useRepositoryStore.getState().groups).toEqual(mockGroups);
    });

    it('createGroup delegates to api and refreshes', async () => {
      const created = { id: 'g2', name: 'Clients', parentId: null, order: 2, createdAt: 2 };
      vi.mocked(api.settings.createRepoGroup).mockResolvedValue(created);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);
      vi.mocked(api.settings.getRepoGroups).mockResolvedValue([created]);

      const result = await useRepositoryStore.getState().createGroup('Clients');

      expect(result).toEqual(created);
      expect(api.settings.createRepoGroup).toHaveBeenCalledWith('Clients', null);
      expect(useRepositoryStore.getState().groups).toEqual([created]);
    });

    it('createGroup passes parentId for subgroups', async () => {
      const created = { id: 'g3', name: 'Sub', parentId: 'g1', order: 3, createdAt: 3 };
      vi.mocked(api.settings.createRepoGroup).mockResolvedValue(created);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);
      vi.mocked(api.settings.getRepoGroups).mockResolvedValue([created]);

      await useRepositoryStore.getState().createGroup('Sub', 'g1');

      expect(api.settings.createRepoGroup).toHaveBeenCalledWith('Sub', 'g1');
    });

    it('moveGroup delegates and refreshes', async () => {
      vi.mocked(api.settings.moveRepoGroup).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);
      vi.mocked(api.settings.getRepoGroups).mockResolvedValue([]);

      await useRepositoryStore.getState().moveGroup('g1', null);

      expect(api.settings.moveRepoGroup).toHaveBeenCalledWith('g1', null);
    });

    it('moveGroup propagates cycle errors', async () => {
      vi.mocked(api.settings.moveRepoGroup).mockRejectedValue(new Error('Cannot move a group into its own subtree'));
      await expect(useRepositoryStore.getState().moveGroup('g1', 'g2')).rejects.toThrow('own subtree');
    });

    it('assignRepoGroup delegates to setRepoGroup', async () => {
      vi.mocked(api.settings.setRepoGroup).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);
      vi.mocked(api.settings.getRepoGroups).mockResolvedValue([]);

      await useRepositoryStore.getState().assignRepoGroup('/repo', 'g1');

      expect(api.settings.setRepoGroup).toHaveBeenCalledWith('/repo', 'g1');
    });

    it('toggleGroupExpanded updates state optimistically', async () => {
      useRepositoryStore.setState({
        groups: [{ id: 'g1', name: 'G', parentId: null, order: 1, createdAt: 1, expanded: true }],
      });
      vi.mocked(api.settings.setRepoGroupExpanded).mockResolvedValue(undefined);

      await useRepositoryStore.getState().toggleGroupExpanded('g1', false);

      expect(useRepositoryStore.getState().groups[0].expanded).toBe(false);
      expect(api.settings.setRepoGroupExpanded).toHaveBeenCalledWith('g1', false);
    });
  });

  describe('checkRemotes', () => {
    it('polls all repo paths and merges summaries', async () => {
      const summaries = {
        '/a': {
          path: '/a', hasRemote: true, remotes: ['origin'], incoming: 3, outgoing: 1,
          dirty: 2, branch: 'main', fetched: true, checkedAt: Date.now(),
        },
      };
      vi.mocked(api.git.pollRemoteSummaries).mockResolvedValue(summaries);
      useRepositoryStore.setState({
        repos: [
          { path: '/a', name: 'a', lastOpened: 0 },
          { path: '/b', name: 'b', lastOpened: 0 },
        ],
        remoteChecks: {},
      });

      await useRepositoryStore.getState().checkRemotes();

      expect(api.git.pollRemoteSummaries).toHaveBeenCalledWith(['/a', '/b']);
      expect(useRepositoryStore.getState().remoteChecks['/a'].incoming).toBe(3);
    });

    it('merges into existing results without losing unchecked repos', async () => {
      vi.mocked(api.git.pollRemoteSummaries).mockResolvedValue({});
      const previous = {
        '/old': {
          path: '/old', hasRemote: true, remotes: ['origin'], incoming: 5, outgoing: 0,
          dirty: 0, branch: 'dev', fetched: true, checkedAt: Date.now(),
        },
      };
      useRepositoryStore.setState({ repos: [], remoteChecks: previous });

      await useRepositoryStore.getState().checkRemotes();

      expect(useRepositoryStore.getState().remoteChecks['/old']).toBeDefined();
      expect(useRepositoryStore.getState().remoteChecks['/old'].incoming).toBe(5);
    });

    it('skips when a check is already running', async () => {
      useRepositoryStore.setState({ checkingRemotes: true });
      vi.mocked(api.git.pollRemoteSummaries).mockResolvedValue({});

      await useRepositoryStore.getState().checkRemotes();

      expect(api.git.pollRemoteSummaries).not.toHaveBeenCalled();
      useRepositoryStore.setState({ checkingRemotes: false });
    });

    it('does not throw when the api call rejects', async () => {
      vi.mocked(api.git.pollRemoteSummaries).mockRejectedValue(new Error('offline'));
      useRepositoryStore.setState({ repos: [{ path: '/a', name: 'a', lastOpened: 0 }], checkingRemotes: false });

      await expect(useRepositoryStore.getState().checkRemotes()).resolves.toBeUndefined();
      expect(useRepositoryStore.getState().checkingRemotes).toBe(false);
    });

    it('does nothing when the repo list is empty', async () => {
      useRepositoryStore.setState({ repos: [] });
      await useRepositoryStore.getState().checkRemotes();
      expect(api.git.pollRemoteSummaries).not.toHaveBeenCalled();
    });

    it('polls the CURRENT repo first so its badges update before slow remotes', async () => {
      // v3.2: pollRemoteSummaries walks targets in input order through a
      // 3-worker pool; without this reordering a slow remote at the head of
      // the sidebar kept the freshly-opened repo's ↓/↑ badge waiting behind
      // the whole list.
      vi.mocked(api.git.pollRemoteSummaries).mockResolvedValue({});
      useRepositoryStore.setState({
        repos: [
          { path: '/a', name: 'a', lastOpened: 1 },
          { path: '/b', name: 'b', lastOpened: 2 },
          { path: '/c', name: 'c', lastOpened: 3 },
        ],
        currentRepo: { path: '/c', name: 'c', lastOpened: 3 },
        checkingRemotes: false,
      });

      await useRepositoryStore.getState().checkRemotes();

      expect(api.git.pollRemoteSummaries).toHaveBeenCalledWith(['/c', '/a', '/b']);
    });
  });
});
