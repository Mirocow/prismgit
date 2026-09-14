import { create } from 'zustand';
import { api, type AppSettings } from '../lib/api';
import { type ThemeId, THEMES, getThemeMeta, DEFAULT_THEME, isThemeDark } from '../lib/themes';

export type Theme = ThemeId;

interface SettingsState {
  settings: Partial<AppSettings>;
  theme: Theme;
  /** 4.2 — 'auto' follows the OS light/dark preference (see resolveAutoTheme). */
  themeMode: 'manual' | 'auto';
  loading: boolean;

  loadSettings: () => Promise<void>;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
  /** 4.2 — switch between manual (saved theme) and system-following mode. */
  setThemeMode: (mode: 'manual' | 'auto') => Promise<void>;
  applyTheme: () => void;
}

// ── 4.2 — system light/dark auto mode ────────────────────────────────────

/** Read the OS color-scheme preference (false when unavailable). */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/**
 * 4.2 — resolve the theme to use in auto mode: stay on `saved` when its
 * darkness already matches the system preference, otherwise switch to the
 * light/dark PAIR of the same family (github-light ↔ github-dark). Families
 * without a pair fall back to DEFAULT_THEME (light) / 'dark' — mirroring
 * toggleTheme's pairing rules.
 */
export function resolveAutoTheme(saved: string, systemDark: boolean): Theme {
  const meta = getThemeMeta(saved as Theme);
  if (!meta) return systemDark ? ('dark' as Theme) : DEFAULT_THEME;
  if (meta.isDark === systemDark) return saved as Theme;
  const family = saved.split('-')[0];
  const pair = THEMES.find((t) => t.isDark === systemDark && t.id.startsWith(family));
  return pair ? pair.id : (systemDark ? ('dark' as Theme) : DEFAULT_THEME);
}

// Module-level matchMedia listener — one per app, (re)started when auto
// mode turns on and removed when it turns off.
let systemThemeMql: MediaQueryList | null = null;
let systemThemeHandler: ((e: MediaQueryListEvent) => void) | null = null;

function applyAutoThemeNow(): void {
  const { settings } = useSettingsStore.getState();
  const resolved = resolveAutoTheme(settings.theme ?? DEFAULT_THEME, systemPrefersDark());
  useSettingsStore.setState({ theme: resolved });
  useSettingsStore.getState().applyTheme();
}

function startSystemThemeSync(): void {
  stopSystemThemeSync();
  try {
    systemThemeMql = window.matchMedia('(prefers-color-scheme: dark)');
    systemThemeHandler = () => applyAutoThemeNow();
    systemThemeMql.addEventListener('change', systemThemeHandler);
  } catch {
    systemThemeMql = null;
    systemThemeHandler = null;
  }
}

function stopSystemThemeSync(): void {
  try {
    if (systemThemeMql && systemThemeHandler) {
      systemThemeMql.removeEventListener('change', systemThemeHandler);
    }
  } catch {
    /* ignore */
  }
  systemThemeMql = null;
  systemThemeHandler = null;
}

function applyThemeToDOM(theme: Theme) {
  const html = document.documentElement;
  const meta = getThemeMeta(theme);
  const dark = meta?.isDark ?? false;
  // Legacy .dark class — preserved for backward compat with components that
  // check `classList.contains('dark')` (e.g. contrast blending in this file).
  if (dark) html.classList.add('dark');
  else html.classList.remove('dark');
  // data-theme attribute — the actual theme selector used in globals.css.
  // Each [data-theme="..."] block overrides the default :root / .dark
  // variables with theme-specific colors.
  html.setAttribute('data-theme', theme);
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
function applySidebarModeToDOM(mode: 'default' | 'dim' | 'light') {
  const html = document.documentElement;
  html.classList.remove('sidebar-dim', 'sidebar-light');
  if (mode === 'dim') html.classList.add('sidebar-dim');
  else if (mode === 'light') html.classList.add('sidebar-light');
}

/**
 * Settings redesign — UI density (Compact / Comfortable).
 * Affects row padding: Compact → py-1, Comfortable → py-1.5.
 * Applied via CSS class on <html> so globals.css can target it.
 */
function applyUiDensityToDOM(density: 'compact' | 'comfortable') {
  const html = document.documentElement;
  html.classList.remove('density-compact', 'density-comfortable');
  html.classList.add(density === 'compact' ? 'density-compact' : 'density-comfortable');
}

/**
 * Settings redesign — zoom level (60-240%). Maps directly to
 * document.documentElement.style.zoom (Chromium-only; Electron/Tauri
 * both run on Chromium). Keyboard shortcuts Ctrl+= / Ctrl+- / Ctrl+0
 * call setSetting('zoomLevel', ...) in App.tsx.
 */
function applyZoomToDOM(zoomPct: number) {
  const clamped = Math.max(60, Math.min(240, zoomPct));
  document.documentElement.style.zoom = `${clamped / 100}`;
}

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
  const saved = localStorage.getItem('prismgit-theme') as Theme | null;
  // Accept any registered theme; fall back to default for unknown values
  // (handles old installs that had only 'light' / 'dark').
  const validIds = THEMES.map((t) => t.id);
  const theme = saved && validIds.includes(saved) ? saved : DEFAULT_THEME;
  applyThemeToDOM(theme);
} catch {
  applyThemeToDOM(DEFAULT_THEME);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  theme: 'light',
  themeMode: 'manual',
  loading: false,

  loadSettings: async () => {
    set({ loading: true });
    try {
      const settings = await api.settings.getAll();
      // Validate stored theme — old installs may have 'light'/'dark' only,
      // newer may have any of the registered themes.
      const stored = settings.theme as string | undefined;
      const validIds = THEMES.map((t) => t.id);
      const theme: Theme = stored && validIds.includes(stored as Theme) ? (stored as Theme) : DEFAULT_THEME;
      // 4.2 — resolve the effective theme under auto mode and (re)arm the
      // system listener. The manual base stays in settings.theme.
      const themeMode = settings.themeMode ?? 'manual';
      let effective: Theme = theme;
      if (themeMode === 'auto') {
        effective = resolveAutoTheme(theme, systemPrefersDark());
        startSystemThemeSync();
      } else {
        stopSystemThemeSync();
      }
      set({ settings, themeMode, theme: effective, loading: false });
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
      // Apply sidebar dim mode (Discord/Slack-style channel sidebar)
      applySidebarModeToDOM(settings.sidebarMode ?? 'default');
      // Settings redesign — apply UI density + zoom on load
      applyUiDensityToDOM(settings.uiDensity ?? 'comfortable');
      applyZoomToDOM(settings.zoomLevel ?? 100);
    } catch {
      set({ loading: false });
    }
  },

  setSetting: async (key, value) => {
    await api.settings.set(key, value);
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    if (key === 'theme') {
      const t = value as Theme;
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
    // Apply sidebar visual mode live (Discord/Slack-style dim)
    if (key === 'sidebarMode') {
      applySidebarModeToDOM(value as 'default' | 'dim' | 'light');
    }
    // Settings redesign — apply UI density live
    if (key === 'uiDensity') {
      applyUiDensityToDOM(value as 'compact' | 'comfortable');
    }
    // Settings redesign — apply zoom level live
    if (key === 'zoomLevel') {
      applyZoomToDOM(value as number);
    }
  },

  setTheme: async (theme) => {
    await get().setSetting('theme', theme);
    // Keep the resolved state consistent when auto mode rewrites it.
    set({ theme });
  },

  // 4.2 — SmartGit "Automatically select light/dark": 'auto' follows the
  // OS preference (light/dark pair of the saved theme family), 'manual'
  // returns to the explicitly chosen theme.
  setThemeMode: async (mode) => {
    await get().setSetting('themeMode', mode);
    set({ themeMode: mode });
    try { localStorage.setItem('prismgit-theme-mode', mode); } catch { /* ignore */ }
    if (mode === 'auto') {
      startSystemThemeSync();
      applyAutoThemeNow();
    } else {
      stopSystemThemeSync();
      const base = (get().settings.theme as Theme | undefined) ?? DEFAULT_THEME;
      set({ theme: base });
      get().applyTheme();
    }
  },

  toggleTheme: async () => {
    // Toggle between light and dark variants — flips isDark but keeps the
    // palette family when possible (e.g. github-light ↔ github-dark).
    // For themes without a paired opposite, falls back to DEFAULT_THEME.
    const current = get().theme;
    const currentMeta = getThemeMeta(current);
    if (!currentMeta) {
      await get().setTheme(DEFAULT_THEME);
      return;
    }
    // Try to find a paired opposite (same family, opposite darkness)
    const opposite = THEMES.find((t) => t.isDark !== currentMeta.isDark && t.id.startsWith(current.split('-')[0]));
    const next: Theme = opposite
      ? opposite.id
      : (currentMeta.isDark ? DEFAULT_THEME : 'dark');
    await get().setTheme(next);
  },

  applyTheme: () => {
    const { theme } = get();
    applyThemeToDOM(theme);
  },
}));
