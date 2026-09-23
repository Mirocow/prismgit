/**
 * Main-process theme utilities.
 *
 * BUGFIX "тёмные темы не адаптированы": the BrowserWindow used to be created
 * with a hardcoded light `backgroundColor: '#f8f9fa'` — every dark theme
 * flashed a white frame before the renderer painted. The main process
 * cannot import the renderer's theme registry (src/lib/themes.ts), so this
 * module keeps a dark-theme ID set. tests/unit/themeDarkSync.test.ts
 * cross-checks it against src/lib/themes.ts on every CI run — if a theme
 * is added there without updating this list, the test fails.
 */

/** Theme IDs whose palette is dark (mirror of THEMES[].isDark in src/lib/themes.ts). */
export const DARK_THEMES: ReadonlySet<string> = new Set([
  'dark',
  'github-dark',
  'dracula',
  'monokai',
  'solarized-dark',
  'nord',
  'tokyo-night',
  'catppuccin-mocha',
  'one-dark',
  'gruvbox-dark',
  'slack-dark',
  'discord',
  'purple',
]);

/** Light-window fallback (Ayu Light bg-primary). */
export const LIGHT_WINDOW_BG = '#f7f8fa';
/**
 * Dark-window fallback — a neutral near-black (not Ayu's #0b0e14) that sits
 * acceptably under every dark palette for the ~100ms before CSS paints.
 */
export const DARK_WINDOW_BG = '#111318';

/** Pick the native window background for a persisted theme id. */
export function windowBackgroundForTheme(theme: string | undefined | null): string {
  return theme && DARK_THEMES.has(theme) ? DARK_WINDOW_BG : LIGHT_WINDOW_BG;
}
