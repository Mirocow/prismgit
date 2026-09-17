/**
 * Favorites Store — global favorite tools (sidebar pinning).
 *
 * WHY a Zustand store instead of useState in Sidebar:
 * The Sidebar component is rendered TWICE in App.tsx (once for no-repo
 * mode, once for repo-open mode). Each instance had its own useState
 * for favorites, causing a race condition on app restart where one
 * Sidebar instance overwrites localStorage before the other reads it.
 *
 * The store is a module-level singleton — both Sidebar instances read
 * from the same store, so there's no way for one to overwrite the other.
 */
import { create } from 'zustand';

const FAVORITES_KEY = 'prismgit-favorite-tools';
const DEFAULT_FAVORITES = ['/changes', '/history', '/branches', '/diff'];

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(s => typeof s === 'string');
    }
  } catch { /* ignore */ }
  return DEFAULT_FAVORITES;
}

function saveFavorites(favs: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch { /* ignore */ }
}

interface FavoritesState {
  favorites: string[];
  toggleFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: loadFavorites(),

  toggleFavorite: (path) => {
    const current = get().favorites;
    const next = current.includes(path)
      ? current.filter(p => p !== path)
      : [...current, path];
    // Save SYNCHRONOUSLY — not deferred to useEffect. This is the fix
    // for the "favorites restored after restart" bug: the old code used
    // useEffect to persist, which ran AFTER render. If the app closed
    // quickly (or the component unmounted before the effect ran), the
    // save never happened. Now we save IMMEDIATELY in the toggle handler.
    saveFavorites(next);
    set({ favorites: next });
  },

  isFavorite: (path) => get().favorites.includes(path),
}));
