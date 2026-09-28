import type { CustomThemeColors, CustomThemeEntry } from '../../electron/types/settings-api';

// Re-exported so renderer code can import everything theme-related from one
// place (the shape itself is owned by the shared settings contract).
export type { CustomThemeColors, CustomThemeEntry };

/**
 * Theme registry — PrismGit's curated theme set + user-created custom themes.
 *
 * CURATION (user request): the picker used to list 27 themes, which made
 * choosing harder, not easier. The registry now ships SIX curated themes —
 * the ones the user actually uses plus the dark-sidebar/light-main combo —
 * and anything else can be built in the visual Custom Theme editor
 * (Settings → Appearance → Themes → «Создать тему…»).
 *
 *   light              Ayu Light (default light)
 *   one-dark           One Dark (default dark)
 *   simple-light       Simple (minimal black/white/grey)
 *   material           Material Design light (Indigo)
 *   discord            Discord (Blurple + grey)
 *   light-dim-sidebar  Light main window + DARK left sidebar (VS Code style)
 *   custom-<id>        User-created (colors stored in settings.customThemes)
 *
 * Each built-in theme is a complete color system applied via a
 * `data-theme="..."` attribute on <html>; the matching selector in
 * globals.css overrides the default CSS variables (:root = light,
 * .dark = dark). Custom themes get their variables injected as a
 * <style> tag (see lib/customThemeCss.ts) scoped to their own
 * `data-theme="custom-<id>"` attribute.
 *
 * The `isDark` flag controls:
 *   1. Whether to add the legacy `.dark` class (backward-compat with
 *      components that check `classList.contains('dark')`)
 *   2. The contrast-blend target (black for light themes, white for dark)
 *   3. The native window background at boot (electron/services/themeDark.ts)
 *
 * OLD theme ids still found in a user's saved settings are migrated via
 * LEGACY_THEME_FALLBACK — see normalizeThemeId().
 */

export type ThemeId =
  | 'light'              // Ayu Light (default)
  | 'one-dark'           // One Dark (default dark)
  | 'simple-light'      // Minimal light theme (black/white/grey)
  | 'material'          // Material Design light (Indigo + grey)
  | 'discord'            // Discord (Blurple + grey-3)
  | 'light-dim-sidebar'  // Light main + dimmed dark sidebar (VS Code style)
  | (string & {});       // legacy ids (migrated on load) + custom-<id>

export interface ThemeMeta {
  id: ThemeId;
  /** i18n key for the theme's display name — OR a literal name for custom
   *  themes (labelKey starting with '@' is rendered verbatim). */
  labelKey: string;
  /** Whether this theme is dark (controls .dark class + contrast blend). */
  isDark: boolean;
  /** Representative colors for the Settings preview card. */
  preview: {
    bgPrimary: string;     // main background
    bgSecondary: string;   // panels / sidebar
    bgTertiary: string;    // headers / inputs
    textPrimary: string;
    textSecondary: string;
    accent: string;        // buttons / links / active state
    border: string;
    statusAdded: string;   // green swatch (added files)
    statusModified: string;// yellow/orange swatch (modified)
    statusDeleted: string; // red swatch (deleted)
  };
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'light',
    labelKey: 'settings.themeLight',
    isDark: false,
    preview: {
      bgPrimary: '#f7f8fa', bgSecondary: '#ffffff', bgTertiary: '#eef0f3',
      textPrimary: '#2c3138', textSecondary: '#5c6166',
      accent: '#399ee6', border: '#d8dade',
      statusAdded: '#86b300', statusModified: '#f2ae49', statusDeleted: '#f07171',
    },
  },
  {
    id: 'one-dark',
    labelKey: 'settings.themeOneDark',
    isDark: true,
    preview: {
      bgPrimary: '#282c34', bgSecondary: '#21252b', bgTertiary: '#2c313a',
      textPrimary: '#abb2bf', textSecondary: '#7f8c98',
      accent: '#61afef', border: '#3b4048',
      statusAdded: '#98c379', statusModified: '#e5c07b', statusDeleted: '#e06c75',
    },
  },
  {
    id: 'simple-light',
    labelKey: 'settings.themeSimpleLight',
    isDark: false,
    preview: {
      bgPrimary: '#ffffff', bgSecondary: '#fafafa', bgTertiary: '#f0f0f0',
      textPrimary: '#000000', textSecondary: '#666666',
      accent: '#0066ff', border: '#e0e0e0',
      statusAdded: '#009900', statusModified: '#ff9900', statusDeleted: '#cc0000',
    },
  },
  {
    id: 'material',
    labelKey: 'settings.themeMaterial',
    isDark: false,
    preview: {
      bgPrimary: '#FAFAFA', bgSecondary: '#FFFFFF', bgTertiary: '#F5F5F5',
      textPrimary: '#212121', textSecondary: '#757575',
      accent: '#3F51B5', border: '#E0E0E0',
      statusAdded: '#4CAF50', statusModified: '#FF9800', statusDeleted: '#F44336',
    },
  },
  {
    id: 'discord',
    labelKey: 'settings.themeDiscord',
    isDark: true,
    preview: {
      bgPrimary: '#36393f', bgSecondary: '#2f3136', bgTertiary: '#292b30',
      textPrimary: '#dcddde', textSecondary: '#b9bbbe',
      accent: '#5865f2', border: '#202225',
      statusAdded: '#3ba55c', statusModified: '#faa61a', statusDeleted: '#ed4245',
    },
  },
  // Light main window + dimmed dark sidebar — VS Code "Light+" with dark
  // activity bar. The sidebar uses dark colors while the main editor area
  // stays light (CSS: [data-theme="light-dim-sidebar"] overrides aside vars).
  {
    id: 'light-dim-sidebar',
    labelKey: 'settings.themeLightDimSidebar',
    isDark: false,
    preview: {
      bgPrimary: '#f7f8fa', bgSecondary: '#1e1e1e', bgTertiary: '#252526',
      textPrimary: '#2c3138', textSecondary: '#5c6166',
      accent: '#399ee6', border: '#d8dade',
      statusAdded: '#86b300', statusModified: '#f2ae49', statusDeleted: '#f07171',
    },
  },
];

export const DEFAULT_THEME: ThemeId = 'light';

/** Pre-curation theme ids → curated replacement. Applied when a saved
 *  settings/localStorage value references a removed theme. */
export const LEGACY_THEME_FALLBACK: Record<string, ThemeId> = {
  'dark': 'one-dark',
  'github-light': 'light',
  'github-dark': 'one-dark',
  'dracula': 'one-dark',
  'monokai': 'one-dark',
  'solarized-light': 'light',
  'solarized-dark': 'one-dark',
  'nord': 'one-dark',
  'tokyo-night': 'one-dark',
  'catppuccin-mocha': 'one-dark',
  'gruvbox-dark': 'one-dark',
  'slack-dark': 'one-dark',
  'purple': 'one-dark',
  'github-light-dim': 'light-dim-sidebar',
  'designer-light': 'simple-light',
  'midnight': 'one-dark',
  'kanagawa': 'one-dark',
  'rose-pine': 'one-dark',
  'everforest': 'one-dark',
  'vercel-dark': 'one-dark',
  'nord-light': 'light',
};

export function isCustomThemeId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith('custom-');
}

/** Build a pseudo ThemeMeta for a user-created theme (picker card). */
export function customThemeMeta(entry: CustomThemeEntry): ThemeMeta {
  const c = entry.colors;
  return {
    id: entry.id,
    // '@' prefix = literal name (see SettingsPage picker rendering).
    labelKey: `@${entry.name}`,
    isDark: entry.isDark,
    preview: {
      bgPrimary: c.bgPrimary ?? (entry.isDark ? '#282c34' : '#f7f8fa'),
      bgSecondary: c.bgSidebar ?? c.bgSecondary ?? (entry.isDark ? '#21252b' : '#ffffff'),
      bgTertiary: c.bgTertiary ?? (entry.isDark ? '#2c313a' : '#eef0f3'),
      textPrimary: c.textPrimary ?? (entry.isDark ? '#abb2bf' : '#2c3138'),
      textSecondary: c.textSecondary ?? (entry.isDark ? '#7f8c98' : '#5c6166'),
      accent: c.accent ?? '#399ee6',
      border: c.border ?? (entry.isDark ? '#3b4048' : '#d8dade'),
      statusAdded: c.statusAdded ?? '#86b300',
      statusModified: c.statusModified ?? '#f2ae49',
      statusDeleted: c.statusDeleted ?? '#f07171',
    },
  };
}

/** Resolve ANY persisted theme value to a valid current one:
 *  custom-<id> → kept as-is (validated against the custom list by callers
 *  that have it), curated id → kept, legacy id → migrated, unknown → default. */
export function normalizeThemeId(id: string | undefined | null): ThemeId {
  if (!id) return DEFAULT_THEME;
  if (isCustomThemeId(id)) return id;
  if (THEMES.some((t) => t.id === id)) return id as ThemeId;
  return LEGACY_THEME_FALLBACK[id] ?? DEFAULT_THEME;
}

export function getThemeMeta(id: string | undefined | null): ThemeMeta | undefined {
  if (!id) return undefined;
  return THEMES.find((t) => t.id === id);
}

export function isThemeDark(id: string | undefined | null): boolean {
  if (id && isCustomThemeId(id)) return false; // resolved by callers with the entry
  return getThemeMeta(id)?.isDark ?? false;
}

/** Auto light/dark pair used by themeMode 'auto' and toggleTheme's family
 *  flip: the two DEFAULT poles (Ayu Light ↔ One Dark). */
export function resolveAutoTheme(saved: string, systemDark: boolean): ThemeId {
  if (isCustomThemeId(saved)) return saved; // custom themes follow the system only when they match
  const meta = getThemeMeta(saved);
  if (meta && meta.isDark === systemDark) return saved as ThemeId;
  return systemDark ? 'one-dark' : 'light';
}
