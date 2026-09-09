import { create } from 'zustand';
import { api, type RepositoryEntry } from '../lib/api';

interface RepositoryState {
  repos: RepositoryEntry[];
  currentRepo: RepositoryEntry | null;
  loading: boolean;
  error: string | null;

  loadRepos: () => Promise<void>;
  openRepository: (path: string) => Promise<void>;
  openRepositoryPicker: () => Promise<void>;
  closeRepository: () => void;
  removeRepo: (path: string) => Promise<void>;
  cloneRepository: (url: string, targetPath: string, options?: { depth?: number; branch?: string }) => Promise<string>;
  initRepository: (targetPath: string) => Promise<void>;
  pinRepo: (path: string, pinned: boolean) => Promise<void>;
}

export const useRepositoryStore = create<RepositoryState>((set, get) => ({
  repos: [],
  currentRepo: null,
  loading: false,
  error: null,

  loadRepos: async () => {
    set({ loading: true, error: null });
    try {
      const repos = await api.settings.getRepos();
      const sorted = [...repos].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.lastOpened - a.lastOpened;
      });
      set({ repos: sorted, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  openRepository: async (path: string) => {
    set({ loading: true, error: null });
    try {
      const isRepo = await api.git.isRepo(path);
      if (!isRepo) {
        throw new Error('Selected directory is not a Git repository');
      }
      const name = await api.fs.pathBasename(path);
      await api.settings.addRepo({ path, name });
      const repo: RepositoryEntry = { path, name, lastOpened: Date.now() };
      await get().loadRepos();
      set({ currentRepo: repo, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  openRepositoryPicker: async () => {
    const path = await api.fs.openRepositoryPicker();
    if (!path) return;
    await get().openRepository(path);
  },

  closeRepository: () => {
    set({ currentRepo: null });
  },

  removeRepo: async (path: string) => {
    await api.settings.removeRepo(path);
    await get().loadRepos();
    if (get().currentRepo?.path === path) {
      set({ currentRepo: null });
    }
  },

  cloneRepository: async (url, targetPath, options) => {
    set({ loading: true, error: null });
    try {
      const result = await api.git.clone(url, targetPath, options);
      await get().openRepository(result);
      return result;
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  initRepository: async (targetPath: string) => {
    set({ loading: true, error: null });
    try {
      await api.git.init(targetPath);
      await get().openRepository(targetPath);
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  pinRepo: async (path, pinned) => {
    await api.settings.updateRepo(path, { pinned });
    await get().loadRepos();
  },
}));
