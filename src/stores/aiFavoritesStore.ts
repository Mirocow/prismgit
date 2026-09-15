import { create } from 'zustand';
import {
  type AiFavoriteFolder,
  type AiFavoriteNode,
  type AiFavoriteRole,
  favId,
  noteNameFromContent,
  insertIntoTree,
  removeNodeFromTree,
  renameNodeInTree,
  moveNodeInTree,
  toggleFolderInTree,
  collapseAllInTree,
  isValidFavoritesTree,
  countNotesInTree,
} from '../lib/aiFavorites';

/**
 * AI chat favorites store — "save parts of the dialogue" with tree
 * navigation. Shares the persistence patterns of aiChatStore:
 *
 *  - localStorage key `prismgit-ai-favorites` (renderer-owned content,
 *    NOT a secret — no tokens/passphrases go here, only message snapshots)
 *  - debounced writes (fast typing/saving doesn't thrash the disk)
 *  - cross-window sync via the native 'storage' event (the floating
 *    AiAssistant popup and the full-page AiChatPage may live in the
 *    same window — zustand selectors handle that case automatically)
 */

const STORAGE_KEY = 'prismgit-ai-favorites';
const SAVE_DEBOUNCE_MS = 400;

interface AiFavoritesState {
  /** Root of the favorites tree (folders + notes). */
  tree: AiFavoriteNode[];
  /** Hydration flag — localStorage is read lazily on first mount. */
  loaded: boolean;

  ensureLoaded: () => void;
  /** Save a chat message snapshot (parentId null → root). */
  addNote: (parentId: string | null, msg: { content: string; role: AiFavoriteRole; repoPath?: string; name?: string }) => string;
  createFolder: (parentId: string | null, name: string) => string | undefined;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  move: (id: string, newParentId: string | null) => void;
  toggleFolder: (id: string) => void;
  collapseAll: () => void;
  reloadFromStorage: () => void;
}

function loadTree(): AiFavoriteNode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return isValidFavoritesTree(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(tree: AiFavoriteNode[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
  } catch {
    // localStorage full/unavailable — favorites stay in memory
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(get: () => AiFavoritesState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(get().tree), SAVE_DEBOUNCE_MS);
}

/** Wrap a pure tree mutation: set state + schedule persistence. */
function mutate(
  set: (partial: Partial<AiFavoritesState> | ((s: AiFavoritesState) => Partial<AiFavoritesState>)) => void,
  get: () => AiFavoritesState,
  fn: (tree: AiFavoriteNode[]) => AiFavoriteNode[]
): void {
  set((s) => ({ tree: fn(s.tree) }));
  schedulePersist(get);
}

export const useAiFavoritesStore = create<AiFavoritesState>((set, get) => ({
  tree: [],
  loaded: false,

  ensureLoaded: () => {
    if (!get().loaded) set({ loaded: true, tree: loadTree() });
  },

  addNote: (parentId, msg) => {
    const id = favId();
    const note = {
      id,
      type: 'note' as const,
      name: msg.name?.trim() || noteNameFromContent(msg.content),
      content: msg.content,
      role: msg.role,
      ...(msg.repoPath ? { repoPath: msg.repoPath } : {}),
      createdAt: Date.now(),
    };
    mutate(set, get, (tree) => insertIntoTree(tree, parentId, note));
    return id;
  },

  createFolder: (parentId, name) => {
    const clean = name.trim();
    if (!clean) return undefined;
    const folder: AiFavoriteFolder = {
      id: favId(),
      type: 'folder',
      name: clean,
      children: [],
      expanded: true,
      createdAt: Date.now(),
    };
    mutate(set, get, (tree) => insertIntoTree(tree, parentId, folder));
    return folder.id;
  },

  rename: (id, name) => mutate(set, get, (tree) => renameNodeInTree(tree, id, name)),

  remove: (id) => mutate(set, get, (tree) => removeNodeFromTree(tree, id) ?? tree),

  move: (id, newParentId) => mutate(set, get, (tree) => moveNodeInTree(tree, id, newParentId)),

  toggleFolder: (id) => mutate(set, get, (tree) => toggleFolderInTree(tree, id)),

  collapseAll: () => mutate(set, get, (tree) => collapseAllInTree(tree)),

  reloadFromStorage: () => set({ loaded: true, tree: loadTree() }),
}));

export { countNotesInTree };

// ── Cross-window sync ─────────────────────────────────────────────────────
// The popup and the page may run in different windows; the native 'storage'
// event fires in every OTHER window when one of them writes.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      useAiFavoritesStore.getState().reloadFromStorage();
    }
  });
}
