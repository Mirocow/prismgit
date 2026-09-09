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
    },
    git: {
      isRepo: vi.fn(),
      status: vi.fn(),
    },
    fs: {
      openRepositoryPicker: vi.fn(),
      pathBasename: vi.fn(),
    },
  },
}));

import { api } from '../../src/lib/api';
import { useRepositoryStore } from '../../src/stores/repositoryStore';

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
    it('loads repositories sorted by pinned then lastOpened', async () => {
      const mockRepos = [
        { path: '/a', name: 'a', lastOpened: 100, pinned: false },
        { path: '/b', name: 'b', lastOpened: 200, pinned: true },
        { path: '/c', name: 'c', lastOpened: 300, pinned: false },
      ];
      vi.mocked(api.settings.getRepos).mockResolvedValue(mockRepos);

      await useRepositoryStore.getState().loadRepos();

      const state = useRepositoryStore.getState();
      expect(state.repos).toHaveLength(3);
      // Pinned first, then by lastOpened descending
      expect(state.repos[0].path).toBe('/b'); // pinned
      expect(state.repos[1].path).toBe('/c'); // 300 > 100
      expect(state.repos[2].path).toBe('/a');
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

    it('throws for non-repository directory', async () => {
      vi.mocked(api.git.isRepo).mockResolvedValue(false);

      await expect(
        useRepositoryStore.getState().openRepository('/not/a/repo')
      ).rejects.toThrow('not a Git repository');

      const state = useRepositoryStore.getState();
      expect(state.currentRepo).toBeNull();
      expect(state.error).toBeTruthy();
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
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);
      useRepositoryStore.setState({
        currentRepo: { path: '/other', name: 'other', lastOpened: 0 },
      });

      await useRepositoryStore.getState().removeRepo('/repo');

      expect(useRepositoryStore.getState().currentRepo?.path).toBe('/other');
    });
  });
});
