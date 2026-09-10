import { create } from 'zustand';
import { api, type RepositoryEntry, type RepositoryMetadata, type RepoGroup, type RemoteCheckSummary } from '../lib/api';

interface RepositoryState {
  repos: RepositoryEntry[];
  groups: RepoGroup[];
  metadata: Record<string, RepositoryMetadata>;
  currentRepo: RepositoryEntry | null;
  currentMetadata: RepositoryMetadata | null;
  loading: boolean;
  error: string | null;

  /**
   * Periodic remote check results per repo path (fetch --all + incoming /
   * outgoing / dirty counters). Populated by checkRemotes() — used by the
   * sidebar repo list to show change indicators.
   */
  remoteChecks: Record<string, RemoteCheckSummary>;
  checkingRemotes: boolean;

  loadRepos: () => Promise<void>;
  loadGroups: () => Promise<void>;
  loadMetadata: () => Promise<void>;
  openRepository: (path: string) => Promise<void>;
  openRepositoryPicker: () => Promise<void>;
  closeRepository: () => void;
  removeRepo: (path: string) => Promise<void>;
  cloneRepository: (url: string, targetPath: string, options?: { depth?: number; branch?: string }) => Promise<string>;
  initRepository: (targetPath: string) => Promise<void>;
  pinRepo: (path: string, pinned: boolean) => Promise<void>;

  // Repository groups (tree in the sidebar)
  createGroup: (name: string, parentId?: string | null) => Promise<RepoGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  moveGroup: (id: string, newParentId: string | null) => Promise<void>;
  toggleGroupExpanded: (id: string, expanded: boolean) => Promise<void>;
  assignRepoGroup: (path: string, groupId: string | null) => Promise<void>;

  // Periodic remote check (fetch + incoming/outgoing indicators)
  checkRemotes: (paths?: string[]) => Promise<void>;

  // Metadata operations
  updateMetadata: (path: string, updates: Partial<RepositoryMetadata>) => Promise<void>;
  toggleFavorite: (path: string) => Promise<void>;
  addTag: (path: string, tag: string) => Promise<void>;
  removeTag: (path: string, tag: string) => Promise<void>;
  refreshStats: (path: string) => Promise<void>;
}

export const useRepositoryStore = create<RepositoryState>((set, get) => ({
  repos: [],
  groups: [],
  metadata: {},
  currentRepo: null,
  currentMetadata: null,
  loading: false,
  error: null,
  remoteChecks: {},
  checkingRemotes: false,

  loadRepos: async () => {
    set({ loading: true, error: null });
    try {
      const [repos, groups] = await Promise.all([
        api.settings.getRepos(),
        api.settings.getRepoGroups().catch(() => [] as RepoGroup[]),
      ]);
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
      set({ repos: sorted, groups, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadGroups: async () => {
    try {
      const groups = await api.settings.getRepoGroups();
      set({ groups });
    } catch (e) {
      set({ error: String(e) });
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
      // Perf: validity check and basename are independent — run them in one
      // round-trip instead of two sequential IPC hops (repo open latency).
      const [isRepo, name] = await Promise.all([
        api.git.isRepo(path),
        api.fs.pathBasename(path),
      ]);
      if (!isRepo) {
        throw new Error('Selected directory is not a Git repository');
      }
      await api.settings.addRepo({ path, name });
      // Refresh stats in background (don't block UI)
      api.settings.refreshRepoStats(path).then(() => {
        get().loadMetadata();
      }).catch(() => { /* ignore */ });

      const repo: RepositoryEntry = { path, name, lastOpened: Date.now() };
      // Perf: loadMetadata() already re-loads and re-sorts the repository
      // list at the end, so the explicit loadRepos() here was a duplicate
      // sequential IPC round-trip on the repo-open critical path.
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

  // ============= Repository groups (tree in the sidebar) =============

  createGroup: async (name, parentId = null) => {
    const group = await api.settings.createRepoGroup(name, parentId);
    await get().loadRepos();
    return group;
  },

  renameGroup: async (id, name) => {
    await api.settings.renameRepoGroup(id, name);
    await get().loadRepos();
  },

  deleteGroup: async (id) => {
    await api.settings.deleteRepoGroup(id);
    await get().loadRepos();
  },

  moveGroup: async (id, newParentId) => {
    // Throws on cycles / missing groups — caller surfaces a toast.
    await api.settings.moveRepoGroup(id, newParentId);
    await get().loadRepos();
  },

  toggleGroupExpanded: async (id, expanded) => {
    // Optimistic local update so the chevron reacts instantly; persisted after.
    const groups = get().groups.map((g) => (g.id === id ? { ...g, expanded } : g));
    set({ groups });
    try {
      await api.settings.setRepoGroupExpanded(id, expanded);
    } catch {
      /* non-critical UI state */
    }
  },

  assignRepoGroup: async (path, groupId) => {
    await api.settings.setRepoGroup(path, groupId);
    await get().loadRepos();
  },

  // ============= Periodic remote check =============

  checkRemotes: async (paths) => {
    const targets = paths ?? get().repos.map((r) => r.path);
    if (targets.length === 0) return;
    // Only one background check at a time — a second click is coalesced.
    if (get().checkingRemotes) return;
    set({ checkingRemotes: true });
    try {
      const summaries = await api.git.pollRemoteSummaries(targets);
      // Merge into existing map so unchecked repos keep their last result.
      const remoteChecks = { ...get().remoteChecks, ...summaries };
      set({ remoteChecks });
    } catch (e) {
      console.warn('[remote-check] failed:', e);
    } finally {
      set({ checkingRemotes: false });
    }
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
