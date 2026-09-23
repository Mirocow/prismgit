// Theme initialization — loaded before React to prevent FOUC.
// This file is loaded as a regular module, not inline script.
//
// Two things applied early:
//   1. Theme class (.dark) + data-theme attribute on <html>
//   2. UI contrast (text/border color overrides) applied to <html> CSS vars.
//      The contrast is read from localStorage; settingsStore re-applies once
//      React mounts. We can't apply it here because the CSS variables aren't
//      defined yet (they're in globals.css which loads after this module).
//      The settingsStore.loadSettings() call will apply it.
//
// BUGFIX "тёмные темы не адаптированы": the dark-theme list below used to be
// a hard-coded subset that drifted from src/lib/themes.ts — slack-dark,
// discord and purple were missing, so at boot those themes ran WITHOUT the
// .dark class and every token their [data-theme] block doesn't define
// (diff/tag/warning/graph colors, shadows, …) resolved to the :root LIGHT
// values. Deriving the list from the registry keeps it in sync forever.
import { THEMES } from './lib/themes';

const registryDarkThemes: string[] = THEMES.filter((t) => t.isDark).map((t) => t.id);
const registryLightThemes: string[] = THEMES.filter((t) => !t.isDark).map((t) => t.id);
// Fallback if reading the registry ever throws (defensive — same content).
const fallbackDarkThemes = [
  'dark', 'github-dark', 'dracula', 'monokai', 'solarized-dark', 'nord',
  'tokyo-night', 'catppuccin-mocha', 'one-dark', 'gruvbox-dark',
  'slack-dark', 'discord', 'purple',
];

try {
  var theme = localStorage.getItem('prismgit-theme') || 'light';
  var knownDarkThemes = registryDarkThemes.length > 0 ? registryDarkThemes : fallbackDarkThemes;
  var knownLightThemes = registryLightThemes;
  // 4.2 — "Automatically select light/dark": before React mounts we can't
  // compute the exact theme pair, but we can avoid a light flash when the
  // OS is dark. If the saved theme is light and the system prefers dark,
  // fall back to the generic dark theme; settingsStore resolves the proper
  // family pair once it loads.
  try {
    if (
      localStorage.getItem('prismgit-theme-mode') === 'auto' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      var isKnownDark = knownDarkThemes.indexOf(theme) >= 0;
      if (!isKnownDark && knownLightThemes.indexOf(theme) >= 0) {
        theme = 'dark';
      }
    }
  } catch (e2) { /* ignore */
  }
  // Apply both the legacy .dark class (for backward compat with code that
  // checks classList.contains('dark')) AND the data-theme attribute (the
  // actual theme selector used by globals.css to override CSS variables).
  if (knownDarkThemes.indexOf(theme) >= 0) {
    document.documentElement.classList.add('dark');
  }
  document.documentElement.setAttribute('data-theme', theme);
} catch (e) {
  // Default to light
}

// Contrast is applied by settingsStore after the CSS is loaded — we just
// persist the value here so it's available before React mounts.
try {
  var contrastRaw = localStorage.getItem('prismgit-contrast');
  if (contrastRaw) {
    var contrast = parseInt(contrastRaw, 10);
    if (!isNaN(contrast) && contrast !== 100) {
      // Store on a data attribute so settingsStore can pick it up
      document.documentElement.setAttribute('data-contrast', String(contrast));
    }
  }
} catch (e) {
  // Ignore
}
