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
    localStorage.setItem('prismgit-theme', theme);
  } catch {
    /* ignore */
  }
}

/**
 * Apply UI contrast by adjusting TEXT and BORDER CSS variables only.
 *
 * Previous approach used `filter: contrast(N%)` on #root, which affected
 * EVERYTHING (backgrounds, shadows, images, etc.). The user requested that
 * contrast should ONLY affect:
 *   - Font contrast (text-primary, text-secondary, text-tertiary)
 *   - Border contrast (border-default, border-subtle, border-strong)
 *
 * Approach: compute adjusted colors in JS and set them as CSS overrides.
 *   - contrast > 100: text/borders become MORE distinct from the background
 *     (darker in light theme, lighter in dark theme)
 *   - contrast < 100: text/borders become LESS distinct (faded/softer)
 *   - contrast = 100: no change (original colors)
 *
 * The shift is a linear blend between the original color and a target:
 *   - High contrast target: black (light theme) / white (dark theme)
 *   - Low contrast target: the background color (fades text into bg)
 */
function applyContrastToDOM(contrast: number) {
  const clamped = Math.max(50, Math.min(150, contrast));
  const root = document.documentElement;
  const isDark = root.classList.contains('dark');

  // Calculate blend percentage (0 at contrast=100, max 0.5 at contrast=50 or 150)
  const shift = Math.abs(clamped - 100) / 100; // 0.0 to 0.5

  // High-contrast target: push text/borders toward the extreme
  const extremeColor = isDark ? '255, 255, 255' : '0, 0, 0';
  // Low-contrast target: fade text/borders toward the background
  const bgColor = isDark ? '11, 14, 20' : '247, 248, 250'; // --bg-primary

  // For contrast > 100: blend toward extreme (darker in light, lighter in dark)
  // For contrast < 100: blend toward background (faded)
  const target = clamped > 100 ? extremeColor : bgColor;

  // Helper: blend a hex color toward the target by `shift` amount
  function blend(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const [tr, tg, tb] = target.split(', ').map(Number);
    const nr = Math.round(r + (tr - r) * shift);
    const ng = Math.round(g + (tg - g) * shift);
    const nb = Math.round(b + (tb - b) * shift);
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
  }

  // Read the CURRENT (default) colors from computed style — these are the
  // base values we blend FROM. We read from :root so we get the theme's
  // default (not the previously-adjusted value).
  const style = getComputedStyle(root);
  const textPrimary = style.getPropertyValue('--text-primary').trim();
  const textSecondary = style.getPropertyValue('--text-secondary').trim();
  const textTertiary = style.getPropertyValue('--text-tertiary').trim();
  const borderDefault = style.getPropertyValue('--border-default').trim();
  const borderSubtle = style.getPropertyValue('--border-subtle').trim();
  const borderStrong = style.getPropertyValue('--border-strong').trim();

  // Only apply overrides if contrast != 100%
  if (clamped === 100) {
    // Remove overrides — restore defaults
    root.style.removeProperty('--text-primary');
    root.style.removeProperty('--text-secondary');
    root.style.removeProperty('--text-tertiary');
    root.style.removeProperty('--border-default');
    root.style.removeProperty('--border-subtle');
    root.style.removeProperty('--border-strong');
  } else {
    // Parse hex colors and blend
    if (textPrimary.startsWith('#')) root.style.setProperty('--text-primary', blend(textPrimary));
    if (textSecondary.startsWith('#')) root.style.setProperty('--text-secondary', blend(textSecondary));
    if (textTertiary.startsWith('#')) root.style.setProperty('--text-tertiary', blend(textTertiary));
    if (borderDefault.startsWith('#')) root.style.setProperty('--border-default', blend(borderDefault));
    if (borderSubtle.startsWith('#')) root.style.setProperty('--border-subtle', blend(borderSubtle));
    if (borderStrong.startsWith('#')) root.style.setProperty('--border-strong', blend(borderStrong));
  }

  // Persist for next load
  try {
    localStorage.setItem('prismgit-contrast', String(clamped));
  } catch {
    /* ignore */
  }
}

// Apply theme immediately on module load (prevents FOUC)
try {
  let saved = localStorage.getItem('prismgit-theme') as Theme | null;
  // Migrate from legacy 'smartgit-theme' key
  if (!saved && localStorage.getItem('smartgit-theme')) {
    saved = localStorage.getItem('smartgit-theme') as Theme;
    if (saved) localStorage.setItem('prismgit-theme', saved);
  }
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
