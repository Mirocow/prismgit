/**
 * Theme registry — all available UI themes for PrismGit.
 *
 * Each theme is a complete color system applied via a `data-theme="..."` attribute
 * on <html>. The `data-theme` selector in globals.css overrides the default CSS
 * variables (:root = light, .dark = dark) with theme-specific colors.
 *
 * The `isDark` flag controls two things:
 *   1. Whether to add the legacy `.dark` class (preserves backward-compat with
 *      components that check `theme === 'dark'` or `classList.contains('dark')`)
 *   2. The contrast-blend target (black for light themes, white for dark themes)
 *
 * The `preview` colors power the Settings → Themes pseudo-window preview. Each
 * color is a representative swatch from the theme — enough to give the user a
 * feel for the palette without rendering the entire app.
 */

export type ThemeId =
  | 'light'              // Ayu Light (default)
  | 'dark'               // Ayu Dark (default)
  | 'github-light'
  | 'github-dark'
  | 'dracula'
  | 'monokai'
  | 'solarized-light'
  | 'solarized-dark'
  | 'nord'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'one-dark'
  | 'gruvbox-dark'
  | 'slack-dark'         // Task 5 — Slack-inspired dark theme (aubergine + 4 accent colors)
  | 'discord'            // Task 5 — Discord-inspired (Blurple + grey-3 / channel-sidebar)
  | 'light-dim-sidebar'  // Light main + dimmed dark sidebar (VS Code style)
  | 'github-light-dim';  // GitHub Light main + dimmed dark sidebar

export interface ThemeMeta {
  id: ThemeId;
  /** i18n key for the theme's display name. */
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
    id: 'dark',
    labelKey: 'settings.themeDark',
    isDark: true,
    preview: {
      bgPrimary: '#0b0e14', bgSecondary: '#0f1218', bgTertiary: '#131721',
      textPrimary: '#bfbdb6', textSecondary: '#8a8f98',
      accent: '#39BAE6', border: '#1f2530',
      statusAdded: '#AAD94C', statusModified: '#FFD700', statusDeleted: '#F26D78',
    },
  },
  {
    id: 'github-light',
    labelKey: 'settings.themeGithubLight',
    isDark: false,
    preview: {
      bgPrimary: '#ffffff', bgSecondary: '#f6f8fa', bgTertiary: '#eaeef2',
      textPrimary: '#1f2328', textSecondary: '#59636e',
      accent: '#0969da', border: '#d0d7de',
      statusAdded: '#1a7f37', statusModified: '#9a6700', statusDeleted: '#cf222e',
    },
  },
  {
    id: 'github-dark',
    labelKey: 'settings.themeGithubDark',
    isDark: true,
    preview: {
      bgPrimary: '#0d1117', bgSecondary: '#161b22', bgTertiary: '#21262d',
      textPrimary: '#e6edf3', textSecondary: '#8b949e',
      accent: '#2f81f7', border: '#30363d',
      statusAdded: '#3fb950', statusModified: '#d29922', statusDeleted: '#f85149',
    },
  },
  {
    id: 'dracula',
    labelKey: 'settings.themeDracula',
    isDark: true,
    preview: {
      bgPrimary: '#282a36', bgSecondary: '#21222c', bgTertiary: '#343746',
      textPrimary: '#f8f8f2', textSecondary: '#bcbcbc',
      accent: '#bd93f9', border: '#44475a',
      statusAdded: '#50fa7b', statusModified: '#f1fa8c', statusDeleted: '#ff5555',
    },
  },
  {
    id: 'monokai',
    labelKey: 'settings.themeMonokai',
    isDark: true,
    preview: {
      bgPrimary: '#272822', bgSecondary: '#1e1f1c', bgTertiary: '#3e3d32',
      textPrimary: '#f8f8f2', textSecondary: '#a8a8a0',
      accent: '#a6e22e', border: '#49483e',
      statusAdded: '#a6e22e', statusModified: '#fd971f', statusDeleted: '#f92672',
    },
  },
  {
    id: 'solarized-light',
    labelKey: 'settings.themeSolarizedLight',
    isDark: false,
    preview: {
      bgPrimary: '#fdf6e3', bgSecondary: '#eee8d5', bgTertiary: '#eee8d5',
      textPrimary: '#586e75', textSecondary: '#93a1a1',
      accent: '#268bd2', border: '#eee8d5',
      statusAdded: '#859900', statusModified: '#b58900', statusDeleted: '#dc322f',
    },
  },
  {
    id: 'solarized-dark',
    labelKey: 'settings.themeSolarizedDark',
    isDark: true,
    preview: {
      bgPrimary: '#002b36', bgSecondary: '#073642', bgTertiary: '#073642',
      textPrimary: '#93a1a1', textSecondary: '#657b83',
      accent: '#268bd2', border: '#073642',
      statusAdded: '#859900', statusModified: '#b58900', statusDeleted: '#dc322f',
    },
  },
  {
    id: 'nord',
    labelKey: 'settings.themeNord',
    isDark: true,
    preview: {
      bgPrimary: '#2e3440', bgSecondary: '#3b4252', bgTertiary: '#434c5e',
      textPrimary: '#d8dee9', textSecondary: '#81a1c1',
      accent: '#88c0d0', border: '#4c566a',
      statusAdded: '#a3be8c', statusModified: '#ebcb8b', statusDeleted: '#bf616a',
    },
  },
  {
    id: 'tokyo-night',
    labelKey: 'settings.themeTokyoNight',
    isDark: true,
    preview: {
      bgPrimary: '#1a1b26', bgSecondary: '#16161e', bgTertiary: '#1f2335',
      textPrimary: '#c0caf5', textSecondary: '#a9b1d6',
      accent: '#7aa2f7', border: '#2a2e44',
      statusAdded: '#9ece6a', statusModified: '#e0af68', statusDeleted: '#f7768e',
    },
  },
  {
    id: 'catppuccin-mocha',
    labelKey: 'settings.themeCatppuccinMocha',
    isDark: true,
    preview: {
      bgPrimary: '#1e1e2e', bgSecondary: '#181825', bgTertiary: '#313244',
      textPrimary: '#cdd6f4', textSecondary: '#a6adc8',
      accent: '#89b4fa', border: '#45475a',
      statusAdded: '#a6e3a1', statusModified: '#f9e2af', statusDeleted: '#f38ba8',
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
    id: 'gruvbox-dark',
    labelKey: 'settings.themeGruvboxDark',
    isDark: true,
    preview: {
      bgPrimary: '#282828', bgSecondary: '#1d2021', bgTertiary: '#3c3836',
      textPrimary: '#ebdbb2', textSecondary: '#a89984',
      accent: '#fabd2f', border: '#504945',
      statusAdded: '#b8bb26', statusModified: '#fabd2f', statusDeleted: '#fb4934',
    },
  },
  // Task 5 — Slack-inspired dark theme. Slack's signature palette: dark
  // aubergine/charcoal backgrounds, four accent colors (red/orange/green/blue)
  // for status indicators. Designed for high message density — high contrast
  // secondary text so commits/files stand out.
  {
    id: 'slack-dark',
    labelKey: 'settings.themeSlackDark',
    isDark: true,
    preview: {
      bgPrimary: '#1a1d21', bgSecondary: '#1a1d21', bgTertiary: '#2c2f33',
      textPrimary: '#f0f0f0', textSecondary: '#cfc3f8',
      accent: '#611f69', border: '#3a3d41',
      statusAdded: '#2eb886', statusModified: '#f2c744', statusDeleted: '#e01e5a',
    },
  },
  // Task 5 — Discord-inspired theme. Discord uses 'Blurple' (#5865F2) accent
  // on a series of neutral greys (grey-3 / grey-2 / grey-1). Light secondary
  // text for readability. Designed for long-form reading.
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
  // Light main window + dimmed dark sidebar — VS Code "Light+" with dark activity bar.
  // The sidebar uses dark colors while the main editor area stays light.
  // Achieved via CSS: [data-theme="light-dim-sidebar"] overrides sidebar vars.
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
  // GitHub Light main + dimmed dark sidebar — matches GitHub.com's new UI where
  // the left sidebar is dark and the content area is light.
  {
    id: 'github-light-dim',
    labelKey: 'settings.themeGithubLightDim',
    isDark: false,
    preview: {
      bgPrimary: '#ffffff', bgSecondary: '#0d1117', bgTertiary: '#161b22',
      textPrimary: '#1f2328', textSecondary: '#59636e',
      accent: '#0969da', border: '#d0d7de',
      statusAdded: '#1a7f37', statusModified: '#bf8700', statusDeleted: '#cf222e',
    },
  },
];

export const DEFAULT_THEME: ThemeId = 'light';

export function getThemeMeta(id: ThemeId): ThemeMeta | undefined {
  return THEMES.find((t) => t.id === id);
}

export function isThemeDark(id: ThemeId): boolean {
  return getThemeMeta(id)?.isDark ?? false;
}
