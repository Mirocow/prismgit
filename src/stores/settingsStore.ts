import { create } from 'zustand';
import { api, type AppSettings } from '../lib/api';

type Theme = 'dark' | 'light';

interface SettingsState {
  settings: Partial<AppSettings>;
  theme: Theme;
  loading: boolean;

  loadSettings: () => Promise<void>;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
  applyTheme: () => void;
}

function applyThemeToDOM(theme: Theme) {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
  // Persist for next load
  try {
    localStorage.setItem('smartgit-theme', theme);
  } catch {
    /* ignore */
  }
}

// Apply theme immediately on module load (prevents FOUC)
try {
  const saved = localStorage.getItem('smartgit-theme') as Theme | null;
  if (saved === 'dark' || saved === 'light') {
    applyThemeToDOM(saved);
  } else {
    applyThemeToDOM('light'); // default to light
  }
} catch {
  applyThemeToDOM('light');
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  theme: 'light',
  loading: false,

  loadSettings: async () => {
    set({ loading: true });
    try {
      const settings = await api.settings.getAll();
      const theme = settings.theme === 'light' ? 'light' : 'dark';
      set({ settings, theme, loading: false });
      get().applyTheme();
      // Apply fontSize on load
      if (settings.fontSize) {
        document.documentElement.style.fontSize = `${settings.fontSize}px`;
      }
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
    // Apply fontSize immediately to DOM
    if (key === 'fontSize') {
      document.documentElement.style.fontSize = `${value}px`;
    }
    // Apply sidebarWidth immediately
    if (key === 'sidebarWidth') {
      document.documentElement.style.setProperty('--sidebar-width', `${value}px`);
    }
  },

  setTheme: async (theme) => {
    await get().setSetting('theme', theme);
  },

  toggleTheme: async () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    await get().setTheme(next);
  },

  applyTheme: () => {
    const { theme } = get();
    applyThemeToDOM(theme);
  },
}));
