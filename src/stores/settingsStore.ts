import { create } from 'zustand';
import { api, type AppSettings } from '../lib/api';
import { type ThemeId, THEMES, getThemeMeta, DEFAULT_THEME, isThemeDark, normalizeThemeId, isCustomThemeId, resolveAutoTheme, type CustomThemeEntry } from '../lib/themes';
import {
  applyCustomThemeStyleTag, removeCustomThemeStyleTag,
  persistActiveCustomTheme, clearActiveCustomTheme, loadActiveCustomTheme,
} from '../lib/customThemeCss';
import { computeContrastOverrides, cssVarName, CONTRAST_TOKENS, type ContrastToken } from '../lib/contrast';

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
 * 4.2 — resolve the theme to use in auto mode. Re-exported from the theme
 * registry so the pairing rules live in ONE place (curated poles:
 * light ↔ one-dark; custom themes are kept as-is).
 */
export { resolveAutoTheme } from '../lib/themes';

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

function applyThemeToDOM(theme: Theme, customThemes?: CustomThemeEntry[]) {
  const html = document.documentElement;
  // ── Custom themes: inject their variables + mirror to localStorage for
  // the pre-React boot (theme-init.ts reads the same mirror).
  if (isCustomThemeId(theme)) {
    const entry = customThemes?.find((e) => e.id === theme);
    if (entry) {
      applyCustomThemeStyleTag(entry);
      if (entry.isDark) html.classList.add('dark');
      else html.classList.remove('dark');
      html.setAttribute('data-theme', entry.id);
      try {
        const w = window as unknown as { smartgit?: { window?: { setBackgroundColor?: (c: string) => void } } };
        if (entry.colors.bgPrimary) w.smartgit?.window?.setBackgroundColor?.(entry.colors.bgPrimary);
      } catch { /* non-Electron — ignore */ }
      persistActiveCustomTheme(entry);
      try { localStorage.setItem('prismgit-theme', entry.id); } catch { /* ignore */ }
      return;
    }
    // Unknown custom id (deleted theme, foreign settings) → fall back.
    theme = DEFAULT_THEME;
  }
  removeCustomThemeStyleTag();
  clearActiveCustomTheme();
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
  // Keep the NATIVE window background in sync so dark themes don't flash a
  // white frame on (re)load / resize. Uses the theme's own bg color.
  try {
    const bg = meta?.preview?.bgPrimary;
    if (bg && typeof window !== 'undefined') {
      const w = window as unknown as { smartgit?: { window?: { setBackgroundColor?: (c: string) => void } } };
      w.smartgit?.window?.setBackgroundColor?.(bg);
    }
  } catch { /* non-Electron / Tauri — ignore */ }
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
  const root = document.documentElement;
  const isDark = root.classList.contains('dark');

  // Read BASE values: strip OUR OWN inline overrides FIRST.
  // getComputedStyle() resolves inline styles with the highest priority,
  // so without this the blend would COMPOUND on every slider tick (borders
  // marching toward white in dark themes) and a theme switch would keep
  // the previous theme's blended --border-* over the new [data-theme]
  // block — the root cause of "тёмные темы не адаптированы, разделители
  // слишком яркие".
  for (const token of CONTRAST_TOKENS) root.style.removeProperty(cssVarName(token));

  const style = getComputedStyle(root);
  const read = (token: ContrastToken): string | undefined => {
    const v = style.getPropertyValue(cssVarName(token)).trim();
    return v.startsWith('#') ? v : undefined;
  };
  const overrides = computeContrastOverrides({
    contrast,
    isDark,
    bgPrimary: style.getPropertyValue('--bg-primary').trim(),
    colors: {
      textPrimary: read('textPrimary'),
      textSecondary: read('textSecondary'),
      textTertiary: read('textTertiary'),
      borderDefault: read('borderDefault'),
      borderSubtle: read('borderSubtle'),
      borderStrong: read('borderStrong'),
    },
  });

  // applyContrastToDOM(100) → no overrides → base theme values restored.
  for (const [token, value] of Object.entries(overrides) as [ContrastToken, string][]) {
    root.style.setProperty(cssVarName(token), value);
  }

  // Persist for next load
  try {
    localStorage.setItem('prismgit-contrast', String(Math.max(50, Math.min(150, contrast))));
  } catch {
    /* ignore */
  }
}

// Apply theme immediately on module load (prevents FOUC)
try {
  const saved = localStorage.getItem('prismgit-theme');
  // Custom themes boot from their localStorage mirror (colors included) —
  // theme-init.ts already applied the class/attribute pre-React; this only
  // re-asserts + injects the style tag.
  if (saved && isCustomThemeId(saved)) {
    const entry = loadActiveCustomTheme();
    if (entry) {
      applyThemeToDOM(saved, [entry]);
    } else {
      applyThemeToDOM(DEFAULT_THEME);
    }
  } else {
    // Accept any registered theme; MIGRATE legacy ids (pre-curation picks
    // like dracula/monokai) to their curated replacement.
    applyThemeToDOM(normalizeThemeId(saved));
  }
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
      // newer may have any of the registered themes. LEGACY ids (pre-
      // curation picks like dracula) migrate to their curated replacement;
      // custom-<id> values are validated against the stored custom list.
      const stored = settings.theme as string | undefined;
      const customThemes = (settings as { customThemes?: CustomThemeEntry[] }).customThemes ?? [];
      let theme: Theme = normalizeThemeId(stored);
      if (isCustomThemeId(theme) && !customThemes.some((e) => e.id === theme)) {
        theme = DEFAULT_THEME;
      }
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
      // Left bar (Sidebar) font size — primary text + secondary (−1.5px)
      if (settings.fontSizeSidebar) {
        document.documentElement.style.setProperty('--font-size-sidebar', `${settings.fontSizeSidebar}px`);
        document.documentElement.style.setProperty('--font-size-sidebar-sm', `${Math.max(8, settings.fontSizeSidebar - 1.5)}px`);
      }
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
    // Custom theme list changed (created / edited / deleted in the theme
    // editor) — re-apply when the ACTIVE theme is custom so the change is
    // visible immediately (live preview writes go through here).
    if (key === 'customThemes') {
      if (isCustomThemeId(get().theme)) get().applyTheme();
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
    // Left bar (Sidebar) font size — applied live while the slider/input drags
    if (key === 'fontSizeSidebar') {
      document.documentElement.style.setProperty('--font-size-sidebar', `${value}px`);
      document.documentElement.style.setProperty('--font-size-sidebar-sm', `${Math.max(8, (value as number) - 1.5)}px`);
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
    // Flip light ↔ dark across the curated poles (Ayu Light ↔ One Dark).
    // Custom themes flip by their own isDark flag. The old per-family
    // pairing (github-light ↔ github-dark, …) died with the theme curation.
    const current = get().theme;
    let curDark: boolean;
    if (isCustomThemeId(current)) {
      const entry = (get().settings as { customThemes?: CustomThemeEntry[] }).customThemes?.find((e) => e.id === current);
      curDark = entry?.isDark ?? false;
    } else {
      curDark = getThemeMeta(current)?.isDark ?? false;
    }
    await get().setTheme(curDark ? 'light' : 'one-dark');
  },

  applyTheme: () => {
    const { theme, settings } = get();
    applyThemeToDOM(theme, (settings as { customThemes?: CustomThemeEntry[] }).customThemes);
    // Re-derive the contrast overrides from the NEW theme's tokens. Without
    // this, inline --text-*/--border-* values blended from the PREVIOUS
    // theme survive the switch and override the new [data-theme] block
    // (light-gray separators on a dark theme — "не адаптировано").
    applyContrastToDOM(settings.contrast ?? 100);
  },
}));
