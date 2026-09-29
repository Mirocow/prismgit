import { create } from 'zustand';

/**
 * FAVORITE TOOLS store (v3.9) — the sidebar's «Избранные» section.
 *
 * Previously the favorite list lived as useState inside <Sidebar> (persisted
 * to localStorage) — fine for starring, but Settings could not reorder it
 * («Дай возможность через Settings сортировать пункты этого меню —
 * сортировать надо те что в фаворитах»). The list is now a zustand store:
 * the Sidebar subscribes for rendering/starring, the Settings page's
 * «Избранные инструменты» block reorders it (↑/↓), and one module-level
 * subscriber persists every change to localStorage as before.
 */

const KEY = 'prismgit-favorite-tools';
/** Default favorites — the daily drivers. */
export const DEFAULT_FAVORITE_TOOLS = ['/changes', '/history', '/branches', '/diff'];

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
    }
  } catch { /* ignore */ }
  return [...DEFAULT_FAVORITE_TOOLS];
}

interface FavoriteToolsState {
  /** Favorite tool paths, in DISPLAY ORDER (the order the sidebar shows). */
  favorites: string[];
  toggleFavorite: (path: string) => void;
  /** Replace the whole order (Settings sort UI). */
  setOrder: (paths: string[]) => void;
  /** Move one favorite up/down by one slot (Settings ↑/↓ buttons). */
  move: (path: string, dir: -1 | 1) => void;
}

export const useFavoriteToolsStore = create<FavoriteToolsState>((set, get) => ({
  favorites: load(),

  toggleFavorite: (path) => {
    const f = get().favorites;
    set({ favorites: f.includes(path) ? f.filter((p) => p !== path) : [...f, path] });
  },

  setOrder: (paths) => set({ favorites: [...paths] }),

  move: (path, dir) => {
    const f = [...get().favorites];
    const i = f.indexOf(path);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= f.length) return;
    [f[i], f[j]] = [f[j], f[i]];
    set({ favorites: f });
  },
}));

// Single persistence subscriber — every mutation writes localStorage, same
// contract the Sidebar's useEffect had.
useFavoriteToolsStore.subscribe((s) => {
  try { localStorage.setItem(KEY, JSON.stringify(s.favorites)); } catch { /* ignore */ }
});
