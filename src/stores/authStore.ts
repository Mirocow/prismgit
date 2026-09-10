import { create } from 'zustand';
import { api, type GithubUser } from '../lib/api';

interface AuthState {
  user: GithubUser | null;
  authenticated: boolean;
  loading: boolean;
  error: string | null;

  loadAuthState: () => Promise<void>;
  loginWithPAT: (token: string) => Promise<GithubUser>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  authenticated: false,
  loading: false,
  error: null,

  loadAuthState: async () => {
    set({ loading: true });
    try {
      const state = await api.github.getAuthState();
      set({ user: state.user || null, authenticated: state.authenticated, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loginWithPAT: async (token: string) => {
    set({ loading: true, error: null });
    try {
      const user = await api.github.authWithPAT(token);
      set({ user, authenticated: true, loading: false });
      return user;
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  logout: async () => {
    await api.github.logout();
    set({ user: null, authenticated: false });
  },
}));
