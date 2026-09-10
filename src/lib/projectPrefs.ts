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
  fileStatusFilter?: 'all' | 'modified' | 'added' | 'deleted' | 'untracked';
  fileStatusFilterSet?: Array<'modified' | 'added' | 'deleted' | 'untracked' | 'staged' | 'unstaged' | 'renamed'>;
  fileSort?: { key: FileSortKey; dir: 1 | -1 };
  fileFilterRegex?: boolean;
  dirTreeVisible?: boolean;
  colWidths?: { state: number; dir: number };

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
