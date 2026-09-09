import { create } from 'zustand';
import { api, type AppSettings } from '../lib/api';

interface SettingsState {
  settings: Partial<AppSettings>;
  theme: 'dark' | 'light';
  loading: boolean;

  loadSettings: () => Promise<void>;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  toggleTheme: () => Promise<void>;
  applyTheme: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  theme: 'dark',
  loading: false,

  loadSettings: async () => {
    set({ loading: true });
    try {
      const settings = await api.settings.getAll();
      const theme = settings.theme === 'light' ? 'light' : 'dark';
      set({ settings, theme, loading: false });
      get().applyTheme();
    } catch {
      set({ loading: false });
    }
  },

  setSetting: async (key, value) => {
    await api.settings.set(key, value);
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    if (key === 'theme') {
      const t = value === 'light' ? 'light' : 'dark';
      set({ theme: t });
      get().applyTheme();
    }
  },

  toggleTheme: async () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    await get().setSetting('theme', next);
  },

  applyTheme: () => {
    const { theme } = get();
    const html = document.documentElement;
    if (theme === 'light') {
      html.classList.remove('dark');
      html.classList.add('light');
    } else {
      html.classList.remove('light');
      html.classList.add('dark');
    }
  },
}));
