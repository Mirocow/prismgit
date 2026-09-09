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

/**
 * Apply UI contrast as a CSS filter on the root element.
 *   100 = default (no filter)
 *   <100 = softer, washed-out
 *   >100 = punchier, more saturated
 *
 * We use `filter: contrast(N%)` which is GPU-accelerated and works on the
 * whole app including text, backgrounds, and images. Range is clamped to
 * 50–150 to avoid extreme values that would make text unreadable.
 *
 * The contrast is applied to #root (not <html>) to avoid affecting window
 * chrome like the title bar drag region in some Electron setups.
 */
function applyContrastToDOM(contrast: number) {
  const clamped = Math.max(50, Math.min(150, contrast));
  const root = document.getElementById('root');
  if (root) {
    root.style.filter = clamped === 100 ? '' : `contrast(${clamped}%)`;
  }
  // Persist for next load — read in main.tsx before React mounts to avoid FOUC
  try {
    localStorage.setItem('smartgit-contrast', String(clamped));
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
      // Apply all font sizes on load
      if (settings.fontSize) {
        document.documentElement.style.fontSize = `${settings.fontSize}px`;
        document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);
      }
      if (settings.fontSizeTree) document.documentElement.style.setProperty('--font-size-tree', `${settings.fontSizeTree}px`);
      if (settings.fontSizeList) document.documentElement.style.setProperty('--font-size-list', `${settings.fontSizeList}px`);
      if (settings.fontSizeDiff) document.documentElement.style.setProperty('--font-size-diff', `${settings.fontSizeDiff}px`);
      if (settings.fontSizeMonospace) document.documentElement.style.setProperty('--font-size-mono', `${settings.fontSizeMonospace}px`);
      // Apply UI contrast on load (default to 100 = no filter)
      applyContrastToDOM(settings.contrast ?? 100);
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
    // Apply font sizes immediately to CSS variables
    if (key === 'fontSize') {
      document.documentElement.style.fontSize = `${value}px`;
      document.documentElement.style.setProperty('--font-size-base', `${value}px`);
    }
    if (key === 'fontSizeTree') {
      document.documentElement.style.setProperty('--font-size-tree', `${value}px`);
    }
    if (key === 'fontSizeList') {
      document.documentElement.style.setProperty('--font-size-list', `${value}px`);
    }
    if (key === 'fontSizeDiff') {
      document.documentElement.style.setProperty('--font-size-diff', `${value}px`);
    }
    if (key === 'fontSizeMonospace') {
      document.documentElement.style.setProperty('--font-size-mono', `${value}px`);
    }
    if (key === 'sidebarWidth') {
      document.documentElement.style.setProperty('--sidebar-width', `${value}px`);
    }
    // Apply UI contrast live (slider drags will hit this rapidly — GPU-accelerated filter is cheap)
    if (key === 'contrast') {
      applyContrastToDOM(value as number);
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
