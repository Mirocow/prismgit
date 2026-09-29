import { create } from 'zustand';

// Toolbar button groups shared by BOTH toolbars:
//   - Toolbar (top header row) — renders the "utils" group
//   - GitToolbar (second row)  — renders sync/stage/stash/log/workflows
// A single reactive store guarantees the customize editor (gear icon in the
// top toolbar) applies instantly to every toolbar, not just one of them.

export const DEFAULT_TOOLBAR_GROUPS = {
  sync: true,
  stage: true,
  stash: true,
  changes: true,
  log: true,
  workflows: true,
  utils: true,
};

export type ToolbarGroups = typeof DEFAULT_TOOLBAR_GROUPS;
export type ToolbarGroupKey = keyof ToolbarGroups;

const STORAGE_KEY = 'prismgit-toolbar-groups';

function loadToolbarGroups(): ToolbarGroups {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, boolean>;
      // Build the groups in DEFAULT order, pulling visibility from saved.
      // This ensures the render order matches DEFAULT_TOOLBAR_GROUPS even
      // if the saved object has keys in a different order (e.g. from an
      // older PrismGit version where 'changes' came before 'stash').
      const ordered: Record<string, boolean> = {};
      for (const key of Object.keys(DEFAULT_TOOLBAR_GROUPS)) {
        ordered[key] = saved[key] ?? DEFAULT_TOOLBAR_GROUPS[key as keyof typeof DEFAULT_TOOLBAR_GROUPS];
      }
      return ordered as ToolbarGroups;
    }
  } catch { /* ignore */ }
  return DEFAULT_TOOLBAR_GROUPS;
}

function saveToolbarGroups(g: ToolbarGroups) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(g)); } catch { /* ignore */ }
}

interface ToolbarStoreState {
  groups: ToolbarGroups;
  /** Show/hide a single group. */
  setGroup: (key: ToolbarGroupKey, value: boolean) => void;
  /** Replace the whole set (used by drag-reorder and reset). Object key order = render order. */
  setGroups: (groups: ToolbarGroups) => void;
}

export const useToolbarStore = create<ToolbarStoreState>((set, get) => ({
  groups: loadToolbarGroups(),

  setGroup: (key, value) => {
    const next: ToolbarGroups = { ...get().groups, [key]: value };
    saveToolbarGroups(next);
    set({ groups: next });
  },

  setGroups: (groups) => {
    saveToolbarGroups(groups);
    set({ groups });
  },
}));
