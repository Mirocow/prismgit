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
 *
 * CURATION: the registry now ships 6 curated themes; user-created
 * `custom-<id>` themes resolve their isDark from the customThemes list
 * passed in from the settings store.
 */

import type { CustomThemeEntry } from '../types/settings-api.js';

/** Theme IDs whose palette is dark (mirror of THEMES[].isDark in src/lib/themes.ts). */
export const DARK_THEMES: ReadonlySet<string> = new Set([
  'one-dark',
  'discord',
]);

/** Light-window fallback (Ayu Light bg-primary). */
export const LIGHT_WINDOW_BG = '#f7f8fa';
/**
 * Dark-window fallback — a neutral near-black (not One Dark's #282c34) that
 * sits acceptably under every dark palette for the ~100ms before CSS paints.
 */
export const DARK_WINDOW_BG = '#111318';

/** Pick the native window background for a persisted theme id. Custom ids
 *  resolve isDark (and bg) from the stored customThemes list. */
export function windowBackgroundForTheme(
  theme: string | undefined | null,
  customThemes?: CustomThemeEntry[],
): string {
  if (!theme) return LIGHT_WINDOW_BG;
  if (theme.startsWith('custom-')) {
    const entry = customThemes?.find((e) => e.id === theme);
    if (entry?.colors?.bgPrimary) return entry.colors.bgPrimary;
    return entry?.isDark ? DARK_WINDOW_BG : LIGHT_WINDOW_BG;
  }
  return DARK_THEMES.has(theme) ? DARK_WINDOW_BG : LIGHT_WINDOW_BG;
}
