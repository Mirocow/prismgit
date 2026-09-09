/**
 * Global UI selection store — single source of truth for cross-page state.
 *
 * Problem (the user's complaint):
 *   Sidebar tools (Changes, History, Tags, Branches, etc.) each had their own local
 *   state and did not react to selections made in other tools. Selecting a commit
 *   in History didn't affect Tags or Changes; selecting a branch in Branches didn't
 *   filter History; there was no way to view "history for this file" because file
 *   selection lived only inside Changes.
 *
 * Solution:
 *   One Zustand store that holds the user's current selection across the whole app:
 *     - selectedCommitHash: which commit is selected (in History, Tags, Reflog, etc.)
 *     - selectedBranch:    which branch is selected (in Branches, History filter)
 *     - selectedFilePath:  which file is selected (in Changes, File History)
 *     - selectedTag:        which tag is selected (in Tags)
 *     - selectedStash:     which stash is selected (in Stashes)
 *
 *   All pages read from this store and update it. When the user clicks a commit in
 *   History, every other page that depends on `selectedCommitHash` re-renders.
 *
 *   Selecting a file from Changes (right-click → "View file history") sets
 *   `selectedFilePath` and navigates to `/history?file=...` — History reads the
 *   query string and filters the log to that file via `git log -- <path>`.
 */

import { create } from 'zustand';

export interface GlobalSelectionState {
  /** Currently selected commit hash (across History, Tags, Reflog, Annotate). */
  selectedCommitHash: string | null;
  /** Currently selected branch name (across Branches, History filter). */
  selectedBranch: string | null;
  /** Currently selected file path (across Changes, File History, Blame). */
  selectedFilePath: string | null;
  /** Currently selected tag name (across Tags, History). */
  selectedTag: string | null;
  /** Currently selected stash index (across Stashes). */
  selectedStashIndex: number | null;
  /** Multi-select branches for History (when user picks multiple in the branch picker). */
  selectedBranches: Set<string>;
  /** Optional path filter — used by History to show "history for this file". */
  pathFilter: string | null;
  /** Optional author filter (used by History, Changes). */
  authorFilter: string | null;
  /** View mode for file lists: 'tree' | 'flat'. */
  fileViewMode: 'tree' | 'flat';
  /** Whether long file paths should be compressed (chain-compression). */
  compressFilePaths: boolean;
  /** File extension filter — null = all, otherwise e.g. '.ts'. */
  fileExtensionFilter: string | null;
  /** Status filter for file lists: 'all' | 'modified' | 'added' | 'deleted' | 'untracked'. */
  fileStatusFilter: 'all' | 'modified' | 'added' | 'deleted' | 'untracked';
  /** Multi-select file status filter — empty set means all statuses visible. */
  fileStatusFilterSet: Set<'modified' | 'added' | 'deleted' | 'untracked' | 'staged' | 'unstaged' | 'renamed'>;
  /** File scope: 'all' = include nested directories, 'top' = current directory only. */
  fileScope: 'all' | 'top';
  /** Directory scope for the Changes file list (absolute-relative dir path, null = whole repo). */
  fileScopeDir: string | null;
  /** Sort spec for the Changes files table. */
  fileSort: { key: 'name' | 'state' | 'dir'; dir: 1 | -1 };
  /** Treat the Changes "File Filter" input as a regular expression. */
  fileFilterRegex: boolean;
  /** Whether the directory tree panel is visible on the Changes page. */
  dirTreeVisible: boolean;
  /** Column widths (px) for the Changes file table: State and Relative Directory. */
  colWidths: { state: number; dir: number };

  // Actions
  selectCommit: (hash: string | null) => void;
  selectBranch: (name: string | null) => void;
  selectFile: (path: string | null) => void;
  selectTag: (name: string | null) => void;
  selectStash: (index: number | null) => void;
  toggleBranch: (name: string) => void;
  clearBranches: () => void;
  setPathFilter: (path: string | null) => void;
  setAuthorFilter: (author: string | null) => void;
  setFileViewMode: (mode: 'tree' | 'flat') => void;
  setCompressFilePaths: (compress: boolean) => void;
  setFileExtensionFilter: (ext: string | null) => void;
  setFileStatusFilter: (filter: 'all' | 'modified' | 'added' | 'deleted' | 'untracked') => void;
  toggleFileStatusFilter: (status: 'modified' | 'added' | 'deleted' | 'untracked' | 'staged' | 'unstaged' | 'renamed') => void;
  clearFileStatusFilterSet: () => void;
  setFileScope: (scope: 'all' | 'top') => void;
  setFileScopeDir: (dir: string | null) => void;
  setFileSort: (sort: { key: 'name' | 'state' | 'dir'; dir: 1 | -1 }) => void;
  toggleFileFilterRegex: () => void;
  toggleDirTreeVisible: () => void;
  /** Set the width (px) of one of the resizable Changes table columns. */
  setColWidth: (col: 'state' | 'dir', width: number) => void;
  /** Clear all selections (e.g. when switching repos). */
  clearAll: () => void;
}

export const useSelectionStore = create<GlobalSelectionState>((set, get) => ({
  selectedCommitHash: null,
  selectedBranch: null,
  selectedFilePath: null,
  selectedTag: null,
  selectedStashIndex: null,
  selectedBranches: new Set(),
  pathFilter: null,
  authorFilter: null,
  fileViewMode: 'flat',
  compressFilePaths: true,
  fileExtensionFilter: null,
  fileStatusFilter: 'all',
  fileStatusFilterSet: new Set(),
  fileScope: 'all',
  fileScopeDir: null,
  fileSort: { key: 'name', dir: 1 },
  fileFilterRegex: false,
  dirTreeVisible: true,
  colWidths: { state: 70, dir: 120 },

  selectCommit: (hash) => set({ selectedCommitHash: hash }),
  selectBranch: (name) => set({
    selectedBranch: name,
    // Clear multi-select when picking a single branch
    selectedBranches: new Set(),
  }),
  selectFile: (path) => set({ selectedFilePath: path }),
  selectTag: (name) => set({ selectedTag: name }),
  selectStash: (index) => set({ selectedStashIndex: index }),
  toggleBranch: (name) => {
    const next = new Set(get().selectedBranches);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    // Clear single-branch filter when using multi-select
    set({ selectedBranches: next, selectedBranch: next.size > 0 ? null : get().selectedBranch });
  },
  clearBranches: () => set({ selectedBranches: new Set(), selectedBranch: null }),
  setPathFilter: (path) => set({ pathFilter: path }),
  setAuthorFilter: (author) => set({ authorFilter: author }),
  setFileViewMode: (mode) => set({ fileViewMode: mode }),
  setCompressFilePaths: (compress) => set({ compressFilePaths: compress }),
  setFileExtensionFilter: (ext) => set({ fileExtensionFilter: ext }),
  setFileStatusFilter: (filter) => set({ fileStatusFilter: filter }),
  toggleFileStatusFilter: (status) => {
    const next = new Set(get().fileStatusFilterSet);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    set({ fileStatusFilterSet: next });
  },
  clearFileStatusFilterSet: () => set({ fileStatusFilterSet: new Set() }),
  setFileScope: (scope) => set({ fileScope: scope }),
  setFileScopeDir: (dir) => set({ fileScopeDir: dir }),
  setFileSort: (sort) => set({ fileSort: sort }),
  toggleFileFilterRegex: () => set({ fileFilterRegex: !get().fileFilterRegex }),
  toggleDirTreeVisible: () => set({ dirTreeVisible: !get().dirTreeVisible }),
  setColWidth: (col, width) => set((s) => ({ colWidths: { ...s.colWidths, [col]: width } })),
  clearAll: () => set({
    selectedCommitHash: null,
    selectedBranch: null,
    selectedFilePath: null,
    selectedTag: null,
    selectedStashIndex: null,
    selectedBranches: new Set(),
    pathFilter: null,
    authorFilter: null,
    fileScopeDir: null,
  }),
}));
