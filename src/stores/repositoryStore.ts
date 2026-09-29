import { create } from 'zustand';
import { api, type RepositoryEntry, type RepositoryMetadata, type RepoGroup, type RemoteCheckSummary } from '../lib/api';
import { clearProjectPrefs } from '../lib/projectPrefs';
import { clearChatHistory } from './aiChatStore';
import { useToastStore } from './toastStore';

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
  /** v3.9 — user-visible PAUSE of the background remote poll («нет
   *  возможности остановить постоянный фетч»). True → the periodic poll
   * skips every cycle (both the timer tick and the window-focus resume);
   * the sidebar refresh spinner turns into a resume control. Session-level:
   * a restart resumes polling (Settings → Auto refresh is the persistent
   * lever). */
  remotePollingPaused: boolean;
  setRemotePollingPaused: (paused: boolean) => void;

  loadRepos: () => Promise<void>;
  loadGroups: () => Promise<void>;
  loadMetadata: () => Promise<void>;
  openRepository: (path: string) => Promise<void>;
  openRepositoryPicker: () => Promise<void>;
  closeRepository: () => void;
  removeRepo: (path: string) => Promise<void>;
  cloneRepository: (url: string, targetPath: string, options?: { depth?: number; branch?: string; groupId?: string | null; sslVerify?: boolean }) => Promise<string>;
  initRepository: (targetPath: string) => Promise<void>;

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
  /**
   * Force-refresh metadata (lastCommit, branchCount, commitCount, provider)
   * for every configured repo. Used by the Sidebar's "refresh" button.
   * Backed by `api.settings.refreshAllRepoStats()` — single IPC call that
   * loops the repo list in the main process and re-runs git per repo.
   */
  refreshAllStats: () => Promise<void>;
}

/**
 * PERF (v3.1, repo-switch): in-flight open dedupe, keyed by path.
 * A double-click on a sidebar row fires openRepository() twice before
 * currentRepo updates — the second call re-ran the whole open sequence
 * (isRepo + addRepo + stats fan-out) and re-set currentRepo with a NEW
 * object identity, which re-triggered the App's watcher effect (a full
 * chokidar teardown + worktree re-walk for nothing).
 */
let openRepoInFlight: { path: string; promise: Promise<void> } | null = null;

/**
 * Queued remote check — a check requested while another one is in flight
 * (was silently DROPPED before: "статистика в репозиториях не обновляется
 * даже если принудительно её запустить" — a forced refresh landing during
 * a background poll cycle did nothing). Runs immediately after the current
 * check completes, deduped by path.
 */
let queuedRemoteCheck: string[] | null = null;

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
  remotePollingPaused: false,
  setRemotePollingPaused: (paused) => set({ remotePollingPaused: paused }),

  loadRepos: async () => {
    set({ loading: true, error: null });
    try {
      const [repos, groups] = await Promise.all([
        api.settings.getRepos(),
        api.settings.getRepoGroups().catch(() => [] as RepoGroup[]),
      ]);
      // If the currently-open repo is no longer in the list (deleted from
      // disk by the OS file manager, then auto-removed by getRepos() in the
      // backend), close it properly — stop watcher, clear git status,
      // dispatch repo-closed event so App.tsx navigates to welcome screen.
      // Without this, the UI keeps stale git status from the deleted repo.
      const cur = get().currentRepo;
      if (cur && !repos.some((r) => r.path === cur.path)) {
        get().closeRepository();
      }
      // Preserve locally-modified `expanded` state from the current store
      // so that optimistic UI updates (toggleGroupExpanded) don't get
      // overwritten when loadRepos() fires (e.g. from refreshAllStats()
      // or a background poll). Without this merge, the user clicks to
      // expand a group → optimistic set() shows repos → loadRepos()
      // overwrites groups from store (which still has expanded=false if
      // the persist hasn't landed yet) → repos disappear → click again →
      // now persist has landed → repos reappear. This was the "глючить"
      // flicker the user reported.
      const prevGroups = get().groups;
      const prevExpanded = new Map(prevGroups.map((g) => [g.id, g.expanded]));
      const mergedGroups = groups.map((g) => ({
        ...g,
        expanded: prevExpanded.has(g.id) ? prevExpanded.get(g.id) : g.expanded,
      }));
      // Sort: favorites first (Task 29 + perf round: the legacy "pinned"
      // secondary sort was removed together with the pin button — favorites
      // already do the job and the pinned flag never had a working UI path;
      // «Из дерева репозиторий удали не нужный функциона "Закрепить", к
      // тому же он и не работает и есть ему замена фаворитес»).
      // DON'T re-sort by lastOpened.
      const sorted = [...repos].sort((a, b) => {
        const metaA = get().metadata[a.path];
        const metaB = get().metadata[b.path];
        if (metaA?.favorite && !metaB?.favorite) return -1;
        if (!metaA?.favorite && metaB?.favorite) return 1;
        return 0;
      });
      set({ repos: sorted, groups: mergedGroups, loading: false });
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
    // PERF (v3.1, repo-switch): re-click on the CURRENT repo — nothing to
    // open. The old flow re-set currentRepo with a new object identity,
    // which re-ran the App's watcher effect (chokidar teardown + full
    // worktree re-walk), re-wrote settings (addRepo) and re-fired the
    // stats fan-out — all for a repo that was already open.
    const cur = get().currentRepo;
    if (cur && cur.path === path) return;
    // Dedupe concurrent opens of the SAME path (double-click guard).
    if (openRepoInFlight?.path === path) return openRepoInFlight.promise;

    const run = (async () => {
      set({ loading: true, error: null });
      try {
        // RACE/LEAK FIX: if another repo is currently open, tear down its
        // watcher BEFORE switching. Previously, opening B while A was active
        // left A's watcher firing (its `git status` results would land in a
        // stale store slot when the user came back to A).
        const prev = get().currentRepo;
        if (prev && prev.path !== path) {
          api.watcher.stop(prev.path).catch(() => { /* ignore */ });
          // PERF (v3.1): switch-away is a SOFT trim now — the previous repo's
          // caches stay warm (LRU-capped in the main process: gitDir,
          // remotes TTL, read-coalescing, isRepo) so A → B → A switching
          // doesn't re-pay the cold-open subprocesses. invalidateCache stays
          // reserved for real mutations (removeRepo, credential changes)
          // where cached data would be WRONG, not merely possibly stale.
          api.git.trimRepoCaches?.().catch(() => { /* ignore */ });
        }
        // Perf: validity check and basename are independent — run them in one
        // round-trip instead of two sequential IPC hops (repo open latency).
        // isRepo() hits a positive-only session cache in the main process —
        // zero subprocesses for known repos.
        const [isRepo, name] = await Promise.all([
          api.git.isRepo(path),
          api.fs.pathBasename(path),
        ]);
        if (!isRepo) {
          // Show a friendly toast directly — the ONLY toast the user sees.
          useToastStore.getState().error(
            'Not a Git repository',
            `The selected directory is not a Git repository:\n${path}\n\nInitialize one with 'git init' or select a different directory.`,
          );
          set({ loading: false });
          // Return WITHOUT throwing — the toast is shown, the state is reset.
          // Throwing would propagate to callers that don't .catch(), triggering
          // the global unhandledrejection handler which shows a SECOND generic
          // "Operation failed (unhandled)" toast — confusing.
          return;
        }
        await api.settings.addRepo({ path, name });
        // PERF (v3.1): background stats refresh is DEFERRED (~1.2s) and
        // freshness-gated. Its 4 parallel git spawns (log -1 / branchLocal /
        // getRemotes / rev-list --count) used to fire the instant a repo
        // opened — competing with the foreground status / numstat /
        // ls-files burst the user is actually waiting for. Metadata that was
        // refreshed within the last 60s (rapid switch-backs) skips the
        // spawns entirely.
        const meta = get().metadata[path];
        const statsFresh = !!meta && Date.now() - (meta.updatedAt ?? 0) < 60_000;
        if (!statsFresh) {
          setTimeout(() => {
            // The user may have switched away before the timer fired —
            // refreshing an abandoned repo would spawn 4 subprocesses that
            // compete with whatever repo is open NOW.
            if (useRepositoryStore.getState().currentRepo?.path !== path) return;
            api.settings.refreshRepoStats(path).then(() => {
              get().loadMetadata();
            }).catch(() => { /* ignore */ });
          }, 1_200);
        }

        const repo: RepositoryEntry = { path, name, lastOpened: Date.now() };
        // Set currentRepo IMMEDIATELY — don't wait for loadMetadata().
        set({ currentRepo: repo, currentMetadata: null, loading: false });
        // Load metadata in the background — non-blocking.
        // RACE FIX: capture the path so if the user switches to repo B
        // before this completes, we don't overwrite B's metadata with A's.
        const targetPath = path;
        void get().loadMetadata().then(() => {
          // Only update currentMetadata if we're STILL on the same repo.
          if (get().currentRepo?.path === targetPath) {
            const metadata = get().metadata[targetPath] || null;
            set({ currentMetadata: metadata });
          }
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        set({ error: errMsg, loading: false });
        // Re-throw WITHOUT the Error object — just the message string.
        // Callers that do `.catch((e) => toast.error(..., e))` get the string
        // directly. Callers that DON'T catch will still propagate, but the
        // global unhandledrejection handler will show a clean toast instead
        // of a raw Error stack trace.
        throw errMsg;
      }
    })();

    openRepoInFlight = { path, promise: run };
    try {
      await run;
    } finally {
      if (openRepoInFlight?.promise === run) openRepoInFlight = null;
    }
  },

  openRepositoryPicker: async () => {
    const path = await api.fs.openRepositoryPicker();
    if (!path) return;
    try {
      await get().openRepository(path);
    } catch {
      // openRepository already shows a toast via the caller's .catch().
      // Swallow here so the rejection doesn't become unhandled.
    }
  },

  closeRepository: () => {
    // Stop file watchers; caches get a SOFT trim (LRU-capped in the main
    // process) so reopening the repo shortly after is warm.
    const cur = get().currentRepo;
    if (cur) {
      // Stop watcher (no-op if not running)
      api.watcher.stop(cur.path).catch(() => { /* ignore */ });
      // PERF (v3.1): soft trim instead of invalidateCache — closing a repo
      // is not a mutation; its gitDir path is immutable, its remotes/poll
      // entries are TTL'd, and its read-coalescing entries expire in 1s.
      // Reopening the same repo skips isRepo + rev-parse --git-dir.
      api.git.trimRepoCaches?.().catch(() => { /* ignore */ });
    }
    // Clear all state — the main-process caches were soft-trimmed above
    // (LRU-capped), so the next repo open reuses or recreates as needed.
    set({ currentRepo: null, currentMetadata: null });
    // Clear global selections too — they were specific to this repo
    // (import here would create a cycle, so we use a window event)
    window.dispatchEvent(new CustomEvent('smartgit:repo-closed'));
  },

  removeRepo: async (path: string) => {
    await api.settings.removeRepo(path);
    // Invalidate git cache for the removed repo — its SimpleGit instance
    // and child process pool are no longer needed.
    api.git.invalidateCache(path).catch(() => { /* ignore */ });
    // STORAGE LEAK FIX: clean up per-repo localStorage keys so they don't
    // accumulate forever in the browser origin. Previously, removing a
    // repo from the sidebar kept its AI chat history (10-500 KB) and UI
    // preferences (panel sizes, view modes, commit-message history) in
    // localStorage forever — over a year of adding/removing repos this
    // could grow to several MB and slow down every `localStorage.getItem`
    // call (which scans the entire origin key set on some browsers).
    try {
      clearChatHistory(path);
      clearProjectPrefs(path);
    } catch {
      /* localStorage might be unavailable in tests — non-critical */
    }
    // If the removed repo was the current repo, close it properly —
    // stop the file watcher, clear git status, dispatch the repo-closed
    // event so App.tsx clears global selections and navigates to the
    // welcome screen. Without this, the UI keeps stale git status
    // (branches, commits, etc.) from the deleted repo, which causes
    // errors when the user tries to interact with them.
    if (get().currentRepo?.path === path) {
      get().closeRepository();
    }
    await get().loadRepos();
    await get().loadMetadata();
  },

  cloneRepository: async (url, targetPath, options) => {
    set({ loading: true, error: null });
    try {
      const result = await api.git.clone(url, targetPath, options);
      // If a groupId was supplied, assign the newly cloned repo to that
      // group so it lands in the right place in the Sidebar's tree.
      // The repo was just added by api.settings.addRepo inside
      // openRepository() — we set the group via setRepoGroup, then
      // reload the repo list so the Sidebar shows the new repo under
      // the chosen group.
      if (options?.groupId) {
        try {
          await api.settings.setRepoGroup(result, options.groupId);
          // Auto-expand the group so the new repo is visible.
          await api.settings.setRepoGroupExpanded?.(options.groupId, true).catch(() => {});
          await get().loadRepos();
        } catch { /* non-fatal — repo is cloned, just not in the group */ }
      }
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
    // v3.2: poll the CURRENT repo first. pollRemoteSummaries works through a
    // 3-worker pool in input order, so with many sidebar repos a slow remote
    // up front kept the freshly-opened repo's ↓/↑ badge waiting behind the
    // whole list — part of the "switching repos takes longer and longer"
    // report (the in-flight cycle also coalesced away the new request).
    const current = get().currentRepo?.path;
    const ordered = current && targets.includes(current)
      ? [current, ...targets.filter((p) => p !== current)]
      : targets;
    // Only one background check at a time — a second request is QUEUED
    // (not dropped) and runs as soon as the current cycle finishes.
    if (get().checkingRemotes) {
      queuedRemoteCheck = [...new Set([...(queuedRemoteCheck ?? []), ...ordered])];
      return;
    }
    set({ checkingRemotes: true });
    try {
      const summaries = await api.git.pollRemoteSummaries(ordered);
      // Merge into existing map so unchecked repos keep their last result.
      const remoteChecks = { ...get().remoteChecks, ...summaries };
      set({ remoteChecks });
    } catch (e) {
      console.warn('[remote-check] failed:', e);
    } finally {
      set({ checkingRemotes: false });
      // Run whatever was queued while this check was in flight.
      const queued = queuedRemoteCheck;
      queuedRemoteCheck = null;
      if (queued && queued.length > 0) {
        void get().checkRemotes(queued);
      }
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

  refreshAllStats: async () => {
    // Single IPC call → main process loops the repo list and re-runs git
    // per repo (sequential to avoid saturating the system with N concurrent
    // git subprocesses). Once done, reload BOTH the repo list and metadata
    // into the store so the sidebar rows re-render with fresh lastCommit /
    // branchCount / etc. AND any repos that were removed externally (e.g.
    // via the OS file manager or another PrismGit instance) disappear from
    // the list.
    // Bug fix: previously this only called loadMetadata() — not loadRepos().
    // The user reported: "удалил репозиторий, жму обновить, репозитории
    // не пропали из группы". The refresh button didn't reload the repo list
    // from the store, so deleted repos stayed visible.
    await api.settings.refreshAllRepoStats();
    await get().loadRepos();
    await get().loadMetadata();
    const cur = get().currentRepo;
    if (cur) {
      set({ currentMetadata: get().metadata[cur.path] ?? null });
    }
  },
}));
