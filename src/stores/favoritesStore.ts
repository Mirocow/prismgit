/**
 * Favorites Store — global favorite tools (sidebar pinning).
 *
 * WHY a Zustand store instead of useState in Sidebar:
 * The Sidebar component is rendered TWICE in App.tsx (once for no-repo
 * mode, once for repo-open mode). Each instance had its own useState
 * for favorites, causing a race condition:
 *   1. User removes a favorite in the repo-open Sidebar
 *   2. useEffect saves the updated list to localStorage
 *   3. App restarts → BOTH Sidebar instances mount
 *   4. The no-repo Sidebar initializes first with DEFAULT_FAVORITES
 *      (if localStorage was somehow cleared or not yet read)
 *   5. Its useEffect immediately saves DEFAULT_FAVORITES to localStorage
 *   6. The repo-open Sidebar reads the overwritten localStorage → defaults restored
 *
 * With a Zustand store, the favorites state is a SINGLE source of truth
 * shared by both Sidebar instances. localStorage is read ONCE on store
 * init, and written on every change — no race.
 */
import { create } from 'zustand';

const FAVORITES_KEY = 'prismgit-favorite-tools';
const DEFAULT_FAVORITES = ['/changes', '/history', '/branches', '/diff'];

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw !== null) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_FAVORITES;
}

function saveFavorites(favs: string[]): void {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs)); } catch { /* ignore */ }
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
    saveFavorites(next);
    set({ favorites: next });
  },
  isFavorite: (path) => get().favorites.includes(path),
}));
