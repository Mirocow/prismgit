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
    const raw = localStorage.getItem(PREFIX + repoPath);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ProjectPrefs) : {};
  } catch {
    return {};
  }
}

export function saveProjectPrefs(repoPath: string, prefs: Partial<ProjectPrefs>): void {
  try {
    const merged = { ...loadProjectPrefs(repoPath), ...prefs };
    localStorage.setItem(PREFIX + repoPath, JSON.stringify(merged));
  } catch {
    /* ignore — private mode / quota */
  }
}

/** Remove all saved UI preferences for a repository (Window | Reset Perspective). */
export function clearProjectPrefs(repoPath: string): void {
  try {
    localStorage.removeItem(PREFIX + repoPath);
  } catch {
    /* localStorage unavailable */
  }
}
