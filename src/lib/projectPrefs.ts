/**
 * Per-project (per-repository) UI preferences.
 *
 * Problem (the user's complaint):
 *   Interface settings — view modes, filters, sort order, column widths,
 *   panel sizes — were either global or lived only in component state, so
 *   they were lost on restart and leaked between repositories. The user
 *   expects them to be remembered PER PROJECT (like SmartGit does).
 *
 * Solution:
 *   A tiny localStorage-backed store keyed by the repository path:
 *     `prismgit-ui-prefs:<repoPath>`
 *
 *   - `loadProjectPrefs(repoPath)` returns the saved prefs (or {}).
 *   - `saveProjectPrefs(repoPath, partial)` merges and persists.
 *
 *   Callers:
 *   - App.tsx loads selection-store prefs when a repo opens and subscribes
 *     to the store to save them back (debounced).
 *   - ChangesPage / DiffPage apply and save their panel sizes the same way.
 *
 * Note: values are clamped by the consumers (e.g. useResizableWidth min/max)
 * before being applied, so a stale or hand-edited localStorage entry cannot
 * break the layout.
 */

const PREFIX = 'prismgit-ui-prefs:';

export type FileSortKey = 'name' | 'state' | 'dir';

export interface ProjectPrefs {
  // --- Changes page: table & view modes (selectionStore) ---
  fileViewMode?: 'tree' | 'flat';
  commitViewMode?: 'tree' | 'flat';
  compressFilePaths?: boolean;
  fileSort?: { key: FileSortKey; dir: 1 | -1 };
  fileFilterRegex?: boolean;
  dirTreeVisible?: boolean;
  colWidths?: { state: number; dir: number; name: number };

  // --- Panel sizes ---
  /** Width of the Changes left panel (file list + journal + commit editor). */
  changesLeftWidth?: number;
  /** Width of the Changes directory-tree panel. */
  changesTreeWidth?: number;
  /** Height of the Changes Journal panel. */
  journalHeight?: number;
  /** Height of the Changes commit-message editor. */
  commitHeight?: number;
  /** Width of the Diff page file-list sidebar. */
  diffFileListWidth?: number;

  // --- Sidebar favorites ---
  /** Navigation paths the user pinned to the Favorites section (e.g. ['/changes', '/history']). */
  favoriteTools?: string[];

  // --- Commit message history ---
  /** Recent commit messages entered by the user, most-recent-first. */
  commitMessageHistory?: string[];

  // --- Sidebar collapsed groups ---
  /**
   * Sidebar section names the user has collapsed (e.g. ['Git Actions', 'Refs']).
   * Persisted so a user who collapsed groups does not see them all re-open on
   * next launch.
   *
   * Per-repo storage is the primary location. As a fallback (when no repo is
   * open yet, or to seed a freshly-opened repo's prefs), a GLOBAL default
   * lives in localStorage under GLOBAL_COLLAPSED_GROUPS_KEY so the user's
   * collapse choice for the Welcome screen / no-repo state is also remembered.
   */
  collapsedSidebarGroups?: string[];
}

/**
 * localStorage key for the GLOBAL sidebar collapsed-groups default. This is
 * the value used when NO repository is open (Welcome screen) and as the
 * initial value when a repo is opened for the first time (so the user's
 * collapse choices carry over to new repos without manual re-setup).
 */
const GLOBAL_COLLAPSED_GROUPS_KEY = 'prismgit-sidebar-collapsed-groups';

/** Read the global default for collapsed sidebar groups (no repo open / first run). */
/** Default groups that are collapsed on first run (before the user has
 *  toggled any group). The user asked for WORKING TREE, WORKFLOWS, and
 *  REFS to be collapsed by default — they expand only the section they
 *  need. Group names are stored in the user's current locale (the same
 *  string shown in the sidebar heading), so we include English variants
 *  here as the canonical defaults. */
const DEFAULT_COLLAPSED_GROUPS = ['Working Tree', 'Workflows', 'Refs'];

export function loadGlobalCollapsedGroups(): string[] {
  try {
    const raw = localStorage.getItem(GLOBAL_COLLAPSED_GROUPS_KEY);
    if (!raw) return DEFAULT_COLLAPSED_GROUPS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : DEFAULT_COLLAPSED_GROUPS;
  } catch {
    return DEFAULT_COLLAPSED_GROUPS;
  }
}

/** Persist the global default for collapsed sidebar groups. */
export function saveGlobalCollapsedGroups(groups: string[]): void {
  try {
    localStorage.setItem(GLOBAL_COLLAPSED_GROUPS_KEY, JSON.stringify(groups));
  } catch {
    /* ignore */
  }
}

export function loadProjectPrefs(repoPath: string): ProjectPrefs {
  try {
    const key = PREFIX + repoPath;
    // Pending writes take precedence — they are more recent than what's
    // already flushed to localStorage (and may not be on disk yet).
    const pending = pendingWrites.get(key);
    const raw = localStorage.getItem(key);
    let disk: ProjectPrefs = {};
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') disk = parsed as ProjectPrefs;
    }
    return pending ? { ...disk, ...pending.prefs } : disk;
  } catch {
    return {};
  }
}

export function saveProjectPrefs(repoPath: string, prefs: Partial<ProjectPrefs>): void {
  try {
    // PERFORMANCE (ST-IO5): localStorage.setItem is synchronous and blocks
    // the renderer main thread. The previous code wrote on EVERY UI pref
    // change (panel resize, view-mode toggle, commit-message history push)
    // — a user dragging a splitter fired dozens of writes per second.
    // Debounce: buffer the latest prefs per repo and flush after 200 ms of
    // silence. The buffer is in-memory only — a tab close before the timer
    // fires loses at most 200 ms of pref changes (acceptable for UI state).
    const key = PREFIX + repoPath;
    const prev = pendingWrites.get(key);
    const merged = prev ? { ...prev.prefs, ...prefs } : prefs;
    pendingWrites.set(key, { repoPath, prefs: merged });
    if (!writeTimers.has(key)) {
      const t = setTimeout(() => {
        writeTimers.delete(key);
        const pending = pendingWrites.get(key);
        if (!pending) return;
        pendingWrites.delete(key);
        try {
          // Merge with whatever is on disk — multiple successive writes
          // within the debounce window have already been merged above.
          const existing = loadProjectPrefs(pending.repoPath);
          const final = { ...existing, ...pending.prefs };
          localStorage.setItem(key, JSON.stringify(final));
        } catch {
          /* ignore — private mode / quota */
        }
      }, 200);
      writeTimers.set(key, t);
    }
  } catch {
    /* ignore — private mode / quota */
  }
}

// Internal: pending debounced writes — keyed by localStorage key.
const pendingWrites = new Map<string, { repoPath: string; prefs: Partial<ProjectPrefs> }>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Flush any pending debounced writes immediately (for tests).
 *
 * In production the 200 ms debounce is fine — UI state doesn't need
 * fsync-level durability. Tests, however, assert `loadProjectPrefs`
 * immediately after `saveProjectPrefs` and need the write to be observable.
 */
export function flushProjectPrefs(): void {
  for (const [key, pending] of pendingWrites.entries()) {
    try {
      const existing = loadProjectPrefs(pending.repoPath);
      const final = { ...existing, ...pending.prefs };
      localStorage.setItem(key, JSON.stringify(final));
    } catch {
      /* ignore */
    }
  }
  pendingWrites.clear();
  for (const t of writeTimers.values()) clearTimeout(t);
  writeTimers.clear();
}

/** Remove all saved UI preferences for a repository (Window | Reset Perspective). */
export function clearProjectPrefs(repoPath: string): void {
  try {
    const key = PREFIX + repoPath;
    // Drop any pending debounced writes for this repo — otherwise a
    // pending write would re-create the localStorage entry after the
    // user just cleared it.
    pendingWrites.delete(key);
    const t = writeTimers.get(key);
    if (t) {
      clearTimeout(t);
      writeTimers.delete(key);
    }
    localStorage.removeItem(key);
  } catch {
    /* localStorage unavailable */
  }
}
