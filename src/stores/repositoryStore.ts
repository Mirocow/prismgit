import { create } from 'zustand';
import { api, type RepositoryEntry, type RepositoryMetadata } from '../lib/api';

interface RepositoryState {
  repos: RepositoryEntry[];
  metadata: Record<string, RepositoryMetadata>;
  currentRepo: RepositoryEntry | null;
  currentMetadata: RepositoryMetadata | null;
  loading: boolean;
  error: string | null;

  loadRepos: () => Promise<void>;
  loadMetadata: () => Promise<void>;
  openRepository: (path: string) => Promise<void>;
  openRepositoryPicker: () => Promise<void>;
  closeRepository: () => void;
  removeRepo: (path: string) => Promise<void>;
  cloneRepository: (url: string, targetPath: string, options?: { depth?: number; branch?: string }) => Promise<string>;
  initRepository: (targetPath: string) => Promise<void>;
  pinRepo: (path: string, pinned: boolean) => Promise<void>;

  // Metadata operations
  updateMetadata: (path: string, updates: Partial<RepositoryMetadata>) => Promise<void>;
  toggleFavorite: (path: string) => Promise<void>;
  addTag: (path: string, tag: string) => Promise<void>;
  removeTag: (path: string, tag: string) => Promise<void>;
  refreshStats: (path: string) => Promise<void>;
}

export const useRepositoryStore = create<RepositoryState>((set, get) => ({
  repos: [],
  metadata: {},
  currentRepo: null,
  currentMetadata: null,
  loading: false,
  error: null,

  loadRepos: async () => {
    set({ loading: true, error: null });
    try {
      const repos = await api.settings.getRepos();
      // Sort: favorites first, then pinned — but DON'T re-sort by lastOpened.
      // The user complaint was that repos "jump around like a goat" every time
      // they open one — because lastOpened changed and the list re-sorted.
      // Now we keep stable insertion order (preserving the order repos were added).
      const sorted = [...repos].sort((a, b) => {
        const metaA = get().metadata[a.path];
        const metaB = get().metadata[b.path];
        // Favorites first
        if (metaA?.favorite && !metaB?.favorite) return -1;
        if (!metaA?.favorite && metaB?.favorite) return 1;
        // Pinned second
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // Otherwise: stable — keep insertion order (don't sort by lastOpened)
        return 0;
      });
      set({ repos: sorted, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadMetadata: async () => {
    try {
      const allMetadata = await api.settings.getRepoMetadataAll();
      const metadataMap: Record<string, RepositoryMetadata> = {};
      for (const m of allMetadata) {
        metadataMap[m.path] = m;
      }
      set({ metadata: metadataMap });
      // Re-sort repos with new metadata
      get().loadRepos();
    } catch (e) {
      set({ error: String(e) });
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
      // Refresh stats in background (don't block UI)
      api.settings.refreshRepoStats(path).then(() => {
        get().loadMetadata();
      }).catch(() => { /* ignore */ });

      const repo: RepositoryEntry = { path, name, lastOpened: Date.now() };
      await get().loadRepos();
      await get().loadMetadata();
      const metadata = get().metadata[path] || null;
      set({ currentRepo: repo, currentMetadata: metadata, loading: false });
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
    // Stop file watchers, clear git cache, release memory.
    const cur = get().currentRepo;
    if (cur) {
      // Stop watcher (no-op if not running)
      api.watcher.stop(cur.path).catch(() => { /* ignore */ });
    }
    // Clear all state — the git cache in the main process will be
    // invalidated when the next repo is opened (getGit creates a new
    // SimpleGit instance per repo path, and old ones are GC'd when
    // no longer referenced).
    set({ currentRepo: null, currentMetadata: null });
    // Clear global selections too — they were specific to this repo
    // (import here would create a cycle, so we use a window event)
    window.dispatchEvent(new CustomEvent('smartgit:repo-closed'));
  },

  removeRepo: async (path: string) => {
    await api.settings.removeRepo(path);
    await get().loadRepos();
    await get().loadMetadata();
    if (get().currentRepo?.path === path) {
      set({ currentRepo: null, currentMetadata: null });
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

  // Metadata operations
  updateMetadata: async (path, updates) => {
    await api.settings.updateRepoMetadata(path, updates);
    await get().loadMetadata();
    if (get().currentRepo?.path === path) {
      set({ currentMetadata: get().metadata[path] });
    }
  },

  toggleFavorite: async (path) => {
    await api.settings.toggleFavorite(path);
    await get().loadMetadata();
    if (get().currentRepo?.path === path) {
      set({ currentMetadata: get().metadata[path] });
    }
  },

  addTag: async (path, tag) => {
    await api.settings.addTag(path, tag);
    await get().loadMetadata();
    if (get().currentRepo?.path === path) {
      set({ currentMetadata: get().metadata[path] });
    }
  },

  removeTag: async (path, tag) => {
    await api.settings.removeTag(path, tag);
    await get().loadMetadata();
    if (get().currentRepo?.path === path) {
      set({ currentMetadata: get().metadata[path] });
    }
  },

  refreshStats: async (path) => {
    await api.settings.refreshRepoStats(path);
    await get().loadMetadata();
    if (get().currentRepo?.path === path) {
      set({ currentMetadata: get().metadata[path] });
    }
  },
}));
