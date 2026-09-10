import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/api', () => ({
  api: {
    settings: {
      getRepos: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
      updateRepo: vi.fn(),
      getRepoMetadataAll: vi.fn(),
      updateRepoMetadata: vi.fn(),
      toggleFavorite: vi.fn(),
      addTag: vi.fn(),
      removeTag: vi.fn(),
      refreshRepoStats: vi.fn(),
    },
    git: {
      isRepo: vi.fn(),
    },
    fs: {
      pathBasename: vi.fn(),
      openRepositoryPicker: vi.fn(),
    },
  },
}));

import { api } from '../../src/lib/api';
import { useRepositoryStore } from '../../src/stores/repositoryStore';

describe('repositoryStore with metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRepositoryStore.setState({
      repos: [],
      metadata: {},
      currentRepo: null,
      currentMetadata: null,
      loading: false,
      error: null,
    });
  });

  describe('loadMetadata', () => {
    it('loads all metadata into map', async () => {
      const mockMetadata = [
        { path: '/a', name: 'a', tags: ['work'], favorite: true, lastOpened: 100, createdAt: 100, updatedAt: 100 },
        { path: '/b', name: 'b', tags: [], favorite: false, lastOpened: 200, createdAt: 200, updatedAt: 200 },
      ];
      vi.mocked(api.settings.getRepoMetadataAll).mockResolvedValue(mockMetadata);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);

      await useRepositoryStore.getState().loadMetadata();

      const state = useRepositoryStore.getState();
      expect(state.metadata['/a']).toBeDefined();
      expect(state.metadata['/a'].favorite).toBe(true);
      expect(state.metadata['/b']).toBeDefined();
      expect(state.metadata['/b'].favorite).toBe(false);
    });
  });

  describe('toggleFavorite', () => {
    it('calls API and updates metadata', async () => {
      vi.mocked(api.settings.toggleFavorite).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepoMetadataAll).mockResolvedValue([
        { path: '/repo', name: 'repo', tags: [], favorite: true, lastOpened: 0, createdAt: 0, updatedAt: 0 },
      ]);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);

      useRepositoryStore.setState({
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
      });

      await useRepositoryStore.getState().toggleFavorite('/repo');

      expect(api.settings.toggleFavorite).toHaveBeenCalledWith('/repo');
      expect(useRepositoryStore.getState().currentMetadata?.favorite).toBe(true);
    });
  });

  describe('addTag', () => {
    it('calls API and updates metadata', async () => {
      vi.mocked(api.settings.addTag).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepoMetadataAll).mockResolvedValue([
        { path: '/repo', name: 'repo', tags: ['new-tag'], favorite: false, lastOpened: 0, createdAt: 0, updatedAt: 0 },
      ]);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);

      useRepositoryStore.setState({
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
      });

      await useRepositoryStore.getState().addTag('/repo', 'new-tag');

      expect(api.settings.addTag).toHaveBeenCalledWith('/repo', 'new-tag');
      expect(useRepositoryStore.getState().currentMetadata?.tags).toContain('new-tag');
    });
  });

  describe('removeTag', () => {
    it('calls API and updates metadata', async () => {
      vi.mocked(api.settings.removeTag).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepoMetadataAll).mockResolvedValue([
        { path: '/repo', name: 'repo', tags: [], favorite: false, lastOpened: 0, createdAt: 0, updatedAt: 0 },
      ]);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);

      useRepositoryStore.setState({
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
        metadata: {
          '/repo': { path: '/repo', name: 'repo', tags: ['old-tag'], favorite: false, lastOpened: 0, createdAt: 0, updatedAt: 0 },
        },
      });

      await useRepositoryStore.getState().removeTag('/repo', 'old-tag');

      expect(api.settings.removeTag).toHaveBeenCalledWith('/repo', 'old-tag');
    });
  });

  describe('refreshStats', () => {
    it('calls API and updates metadata', async () => {
      vi.mocked(api.settings.refreshRepoStats).mockResolvedValue({ branchCount: 5 });
      vi.mocked(api.settings.getRepoMetadataAll).mockResolvedValue([
        { path: '/repo', name: 'repo', tags: [], favorite: false, lastOpened: 0, createdAt: 0, updatedAt: 0, branchCount: 5 },
      ]);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);

      useRepositoryStore.setState({
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
      });

      await useRepositoryStore.getState().refreshStats('/repo');

      expect(api.settings.refreshRepoStats).toHaveBeenCalledWith('/repo');
      expect(useRepositoryStore.getState().currentMetadata?.branchCount).toBe(5);
    });
  });

  describe('updateMetadata', () => {
    it('calls API and updates store', async () => {
      vi.mocked(api.settings.updateRepoMetadata).mockResolvedValue(undefined);
      vi.mocked(api.settings.getRepoMetadataAll).mockResolvedValue([
        { path: '/repo', name: 'repo', tags: [], favorite: false, lastOpened: 0, createdAt: 0, updatedAt: 0, description: 'Updated' },
      ]);
      vi.mocked(api.settings.getRepos).mockResolvedValue([]);

      useRepositoryStore.setState({
        currentRepo: { path: '/repo', name: 'repo', lastOpened: 0 },
      });

      await useRepositoryStore.getState().updateMetadata('/repo', { description: 'Updated' });

      expect(api.settings.updateRepoMetadata).toHaveBeenCalledWith('/repo', { description: 'Updated' });
      expect(useRepositoryStore.getState().currentMetadata?.description).toBe('Updated');
    });
  });
});
